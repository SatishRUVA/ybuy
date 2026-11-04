import { useEffect,useState } from 'react';
import { Alert,Button,Surface } from '@/components/ui';
import { acceptRentalAgreement,fetchRentalAgreement,type RentalAgreement as Agreement } from '@/lib/agreements';

export function RentalAgreement({bookingId,isOwner}:{bookingId:string;isOwner:boolean}) {
  const [agreement,setAgreement]=useState<Agreement | null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string | null>(null);
  const [retry,setRetry]=useState(0);
  const [checked,setChecked]=useState(false);
  const [busy,setBusy]=useState(false);
  useEffect(() => {
    let active=true;
    setLoading(true);setError(null);setChecked(false);
    fetchRentalAgreement(bookingId).then((value)=>{if(active)setAgreement(value);})
      .catch((error:unknown)=>{if(active)setError(error instanceof Error?error.message:'Could not load the rental agreement.');})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[bookingId,retry]);
  if(error)return <Alert tone="error" title="Rental agreement unavailable" className="mb-4">{error}<Button className="mt-2" size="sm" variant="secondary" onClick={()=>setRetry(value=>value+1)}>Retry agreement</Button></Alert>;
  if(loading)return <p className="text-sm text-sec mb-4" role="status">Loading rental agreement…</p>;
  if(!agreement)return null;
  const snapshot=agreement.snapshot;
  const accepted=agreement.acceptances.some(value=>value.role===(isOwner?'Owner':'Renter'));
  return <Surface className="p-5 mb-4">
    <h2 className="font-semibold text-main mb-2">Rental agreement {agreement.agreement_reference} · version {agreement.version}</h2>
    <p className="text-xs text-sec mb-3">Booking reference: {snapshot.booking_reference} · Snapshot created {new Date(agreement.created_at).toLocaleString()}. Later listing edits do not change this record.</p>
    {snapshot.legal_status==='test_dummy'&&<Alert tone="warning" className="mb-3">TEST ONLY: These fictional sample terms are not a legal contract and must never be used for real rentals.</Alert>}
    {snapshot.legal_status==='approval_pending'&&<Alert tone="warning" className="mb-3">This is a stored operational booking record, not an approved rental contract. Legal terms await approval; acceptance is disabled.</Alert>}
    <details>
      <summary className="text-accent font-semibold cursor-pointer">View saved rental details and terms</summary>
      <dl className="mt-3 text-sm space-y-2 text-sec">
        <div><dt className="font-semibold text-main">References</dt><dd>Booking {snapshot.booking_reference} · rental agreement {snapshot.agreement_reference}</dd></div>
        <div><dt className="font-semibold text-main">Parties</dt><dd>Owner: {snapshot.owner_name} · Renter: {snapshot.renter_name}</dd></div>
        <div><dt className="font-semibold text-main">Item</dt><dd>{snapshot.listing.title}</dd><dd className="whitespace-pre-line">{snapshot.listing.description}</dd><dd>Condition: {snapshot.listing.condition?.replace(/_/g,' ')||'Not recorded'}</dd></div>
        <div><dt className="font-semibold text-main">Rental period</dt><dd>{snapshot.start_date} to {snapshot.end_date} · {snapshot.quantity} item(s)</dd></div>
        <div><dt className="font-semibold text-main">Price snapshot ({snapshot.currency})</dt><dd>Rental {snapshot.rental_subtotal}{snapshot.owner_discount_amount?` · package savings ${snapshot.owner_discount_amount}${snapshot.promo_code?` (${snapshot.promo_code})`:''}`:''} · fee {snapshot.service_fee}{snapshot.insurance_amount?` · insurance ${snapshot.insurance_amount}`:''}{!snapshot.payment_first ? ` · deposit ${snapshot.deposit}` : ''} · total {snapshot.total}</dd></div>
        {snapshot.payment_first && <div><dt className="font-semibold text-main">Separate security hold</dt><dd>{snapshot.deposit} {snapshot.currency} · Not included in rental payment.</dd></div>}
        {(Number(snapshot.tax_rate ?? 0) > 0 || snapshot.sandbox_tax) && <div><dt className="font-semibold text-main">{snapshot.sandbox_tax ? 'Tax (7% test)' : 'Tax (7%)'}</dt><dd>{Number(snapshot.tax_amount ?? 0).toFixed(2)} {snapshot.currency} · Included in the immutable total.</dd></div>}
        <div><dt className="font-semibold text-main">Owner-declared value</dt><dd>{snapshot.listing.owner_declared_value??'Not recorded'} {snapshot.currency} (not independently verified)</dd></div>
        <div><dt className="font-semibold text-main">Pickup area</dt><dd>{snapshot.listing.approximate_pickup_area||'Not recorded'}</dd></div>
        <div><dt className="font-semibold text-main">Deposit handling</dt><dd>{snapshot.deposit_model}</dd></div>
      </dl>
      {snapshot.terms&&<div className="mt-4"><h3 className="font-semibold text-main">{snapshot.legal_status==='test_dummy'?'Test-only sample terms':'Approved policy'} · version {snapshot.terms_version}</h3><p className="whitespace-pre-wrap text-sm text-sec mt-2">{snapshot.terms}</p></div>}
      {snapshot.missing_policy_approval.length>0&&<p className="text-sm text-sec mt-3">Policy approval pending: {snapshot.missing_policy_approval.join(', ')}.</p>}
      <div className="flex gap-2 flex-wrap mt-4">{snapshot.listing.photos.map((url,index)=><img key={`${url}:${index}`} src={url} alt={`Saved item photo ${index+1}`} className="h-20 w-20 rounded-card object-cover"/>)}</div>
    </details>
    {agreement.acceptances.map(value=><p key={value.role} className="text-xs text-sec mt-2">{value.role} accepted {new Date(value.accepted_at).toLocaleString()}</p>)}
    {agreement.template_id&&!accepted&&<div className="mt-4">
      <label className="flex items-start gap-2 text-sm text-sec"><input type="checkbox" checked={checked} onChange={event=>setChecked(event.target.checked)} className="mt-1"/>{snapshot.legal_status==='test_dummy'?'I understand these are fictional test terms and accept for this test only.':'I have reviewed and accept this exact agreement version and its approved terms.'}</label>
      <Button className="mt-3" disabled={!checked} loading={busy} onClick={async()=>{
        setBusy(true);setError(null);
        try{await acceptRentalAgreement(agreement);setRetry(value=>value+1);}
        catch(error){setError(error instanceof Error?error.message:'Could not record acceptance.');}
        finally{setBusy(false);}
      }}>Accept agreement</Button>
    </div>}
  </Surface>;
}
