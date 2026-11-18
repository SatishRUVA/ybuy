param([string]$Container = 'supabase_db_YBuy')
$ErrorActionPreference = 'Stop'
$podman = (Get-Command podman -ErrorAction SilentlyContinue).Source
if (-not $podman) { $podman = Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe' }
if (-not (Test-Path $podman)) { throw 'Install Podman before running the local concurrency check.' }

# Uses independent psql processes, not sequential assertions in one transaction.
# Requires the running disposable local Supabase stack. No hosted database connection is accepted.
if ($Container -ne 'supabase_db_YBuy') { throw 'This check only targets the local YBuy database container.' }
$run = [guid]::NewGuid().ToString('N')
$ids = @{}
foreach ($key in @('owner','renter','session','category','listing','booking1','booking2','promotion')) {
  $ids[$key] = [guid]::NewGuid().ToString()
}
$code = "RACE_$($run.Substring(0,20).ToUpperInvariant())"
$claims = '{"sub":"' + $ids.renter + '","role":"authenticated","session_id":"' + $ids.session + '","exp":4102444800}'
$gate = $null

function Invoke-LocalSql([string]$Sql) {
  $output = $Sql | & $podman exec -i $Container psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join "`n") }
  return ($output -join "`n")
}

function Start-LocalSession([string]$Sql) {
  $info = [System.Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $podman
  foreach ($arg in @('exec','-i',$Container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At')) {
    $info.ArgumentList.Add($arg)
  }
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($info)
  $process.StandardInput.WriteLine($Sql)
  $process.StandardInput.Close()
  return @{
    Process = $process
    Output = $process.StandardOutput.ReadToEndAsync()
    Error = $process.StandardError.ReadToEndAsync()
  }
}

function Wait-LocalSession($Session) {
  if (-not $Session.Process.WaitForExit(20000)) {
    Stop-Process -Id $Session.Process.Id
    throw 'Local concurrency session timed out.'
  }
  return @{
    ExitCode = $Session.Process.ExitCode
    Output = $Session.Output.GetAwaiter().GetResult()
    Error = $Session.Error.GetAwaiter().GetResult()
  }
}

function Invoke-Race([string]$LockSql, [string]$FirstSql, [string]$SecondSql, [string]$ExpectedError) {
  # A coordinator holds the real shared lock while both independent callers start.
  # pg_stat_activity proves the coordinator acquired the lock and both callers overlap.
  $application = "ybuy_race_$run"
  $coordinator = Start-LocalSession @"
set application_name = '$application';
begin;
$LockSql
select pg_sleep(8);
commit;
"@
  $ready = $false
  for ($attempt=0; $attempt -lt 100; $attempt++) {
    $waiting = Invoke-LocalSql "select count(*) from pg_stat_activity where application_name='$application' and wait_event='PgSleep';"
    if ($waiting.Trim() -eq '1') { $ready = $true; break }
    Start-Sleep -Milliseconds 50
  }
  if (-not $ready) { throw 'Coordinator did not acquire the shared lock.' }
  $first = Start-LocalSession "set application_name='$($application)_first'; set role authenticated; set request.jwt.claims = '$claims'; $FirstSql"
  $second = Start-LocalSession "set application_name='$($application)_second'; set role authenticated; set request.jwt.claims = '$claims'; $SecondSql"
  $overlapped = $false
  for ($attempt=0; $attempt -lt 50; $attempt++) {
    $blocked = Invoke-LocalSql "select count(*) from pg_stat_activity where application_name in ('$($application)_first','$($application)_second') and wait_event_type='Lock';"
    if ($blocked.Trim() -eq '2') { $overlapped = $true; break }
    Start-Sleep -Milliseconds 50
  }
  $a = Wait-LocalSession $first
  $b = Wait-LocalSession $second
  $lock = Wait-LocalSession $coordinator
  if (-not $overlapped) { throw 'Could not verify both independent callers concurrently waiting on the shared lock.' }
  if ($lock.ExitCode -ne 0) { throw $lock.Error }
  $successes = @(@($a,$b) | Where-Object { $_.ExitCode -eq 0 }).Count
  $failures = @(@($a,$b) | Where-Object { $_.ExitCode -ne 0 -and $_.Error.Contains($ExpectedError) }).Count
  if ($successes -ne 1 -or $failures -ne 1) {
    throw "Expected one success and one '$ExpectedError' failure. First: $($a | ConvertTo-Json -Compress); second: $($b | ConvertTo-Json -Compress)"
  }
}

try {
  $gate = (Invoke-LocalSql "select row_to_json(g)::text from public.admin_financial_test_gate g;") | ConvertFrom-Json
  Invoke-LocalSql @"
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('$($ids.owner)','$run-owner@concurrency.invalid','{"full_name":"Concurrency owner"}'),
 ('$($ids.renter)','$run-renter@concurrency.invalid','{"full_name":"Concurrency renter"}');
insert into auth.sessions(id,user_id) values('$($ids.session)','$($ids.renter)');
insert into public.categories(id,name) values('$($ids.category)','Concurrency $run');
insert into public.listings(id,owner_id,category_id,title,price_per_day,status)
 values('$($ids.listing)','$($ids.owner)','$($ids.category)','Concurrency test listing',100,'published');
insert into public.bookings(id,listing_id,renter_id,owner_id,start_date,end_date,quantity,status,
 daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total)
select id,'$($ids.listing)','$($ids.renter)','$($ids.owner)',current_date+offset_days,current_date+offset_days+2,
 1,'requested',100,2,200,0.10,20,50,270 from
 (values('$($ids.booking1)'::uuid,10),('$($ids.booking2)'::uuid,20)) b(id,offset_days);
insert into public.promotions(id,code,discount_type,discount_value,starts_at,ends_at,max_redemptions,per_user_limit,active)
 values('$($ids.promotion)','$code','fixed',10,now()-interval '1 day',now()+interval '1 day',1,10,true);
insert into public.credit_ledger(user_id,amount,kind,idempotency_key,reason,created_by)
 values('$($ids.renter)',100,'manual','$run','Disposable concurrency fixture','$($ids.owner)');
update public.admin_financial_test_gate set enabled=true,environment='local_test';
commit;
"@ | Out-Null

  Invoke-Race `
    "select id from public.promotions where id='$($ids.promotion)' for update;" `
    "select public.redeem_test_promotion('$($ids.booking1)','$code');" `
    "select public.redeem_test_promotion('$($ids.booking2)','$code');" `
    'Promotion is not eligible'
  $promotionResult = Invoke-LocalSql "select count(*)||'|'||sum(discount_amount) from public.promotion_redemptions where promotion_id='$($ids.promotion)';"
  if ($promotionResult.Trim() -ne '1|10') { throw "Incorrect redemption totals: $promotionResult" }
  Write-Output 'PASS promotion race: two concurrent sessions, one redemption, one eligibility rejection; usage=1, discount=10.'

  # Use new bookings so promotion stacking does not mask wallet concurrency.
  $wallet1 = [guid]::NewGuid().ToString()
  $wallet2 = [guid]::NewGuid().ToString()
  Invoke-LocalSql @"
insert into public.bookings(id,listing_id,renter_id,owner_id,start_date,end_date,quantity,status,
 daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total)
select id,'$($ids.listing)','$($ids.renter)','$($ids.owner)',current_date+offset_days,current_date+offset_days+2,
 1,'requested',100,2,200,0.10,20,50,270 from
 (values('$wallet1'::uuid,30),('$wallet2'::uuid,40)) b(id,offset_days);
"@ | Out-Null
  Invoke-Race `
    "select id from public.profiles where id='$($ids.renter)' for update;" `
    "select public.reserve_test_credit('$wallet1');" `
    "select public.reserve_test_credit('$wallet2');" `
    'No available credit'
  $walletResult = Invoke-LocalSql "select count(*)||'|'||sum(amount) from public.credit_reservations where user_id='$($ids.renter)' and status='reserved';"
  if ($walletResult.Trim() -ne '1|100') { throw "Incorrect reservation totals: $walletResult" }
  Write-Output 'PASS wallet race: two concurrent sessions, one reservation, one insufficient-credit rejection; reserved=100 of balance=100.'
}
finally {
  # Disposable fixture rows must be removed without disabling append-only protection globally.
  # A local superuser transaction bypasses user triggers only for the exact generated fixture IDs.
  $enabled = if ($null -ne $gate -and $gate.enabled) { 'true' } else { 'false' }
  $environment = if ($null -ne $gate) { $gate.environment } else { 'disabled' }
  Invoke-LocalSql @"
begin;
set local session_replication_role=replica;
delete from public.admin_audit_log where actor_id in ('$($ids.owner)','$($ids.renter)');
delete from public.promotion_redemptions where promotion_id='$($ids.promotion)';
delete from public.credit_reservations where user_id='$($ids.renter)';
delete from public.credit_ledger where user_id='$($ids.renter)';
delete from public.promotions where id='$($ids.promotion)';
delete from public.bookings where listing_id='$($ids.listing)';
delete from public.listings where id='$($ids.listing)';
delete from public.categories where id='$($ids.category)';
delete from auth.sessions where id='$($ids.session)';
delete from public.profiles where id in ('$($ids.owner)','$($ids.renter)');
delete from auth.users where id in ('$($ids.owner)','$($ids.renter)');
update public.admin_financial_test_gate set enabled=$enabled,environment='$environment';
commit;
"@ | Out-Null
  Write-Output "CLEANUP fixture records removed; financial gate restored to environment=$environment enabled=$enabled."
}
