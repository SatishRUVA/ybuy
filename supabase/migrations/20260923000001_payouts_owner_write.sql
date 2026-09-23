-- Owner-initiated "mark as paid out" bookkeeping (spec §6: manual payouts for Part 1).
-- The payouts table previously had select-only RLS (service-role/manual DB access only). This adds
-- scoped insert/update policies so an owner can record a payout for their own completed/paid booking
-- directly from the client, without needing a new Edge Function for a non-payment-critical action.

create policy "payouts_insert_own" on public.payouts
  for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and b.owner_id = auth.uid()
        and b.status in ('confirmed', 'active', 'return_pending', 'completed')
    )
  );

create policy "payouts_update_own" on public.payouts
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
