import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth-context';
import { Owner, Payouts, type LiveOwner, type LivePayouts } from '@/preview-1/owning';
import { Button, Empty } from '@/preview-1/ui';
import { CreateListingPage } from '@/pages/create-listing';
import { OwnerDashboard } from '@/pages/dashboards';
import { fetchBookingsAsOwner, respondToBookingRequest, type UiBooking } from '@/lib/bookings';
import { fetchListingById, fetchListingsByOwner, publishListing, toUiListing } from '@/lib/listings';
import { fetchBankPayoutStatus, fetchPayoutsByOwner, startConnectOnboarding } from '@/lib/payouts';
import { fetchUnavailableDates } from '@/lib/availability';
import { saveOwnerAvailability } from '@/lib/owner-availability';
import { listingAvailabilityError } from '@/lib/listing-availability';
import { useUtcDay } from '@/lib/use-utc-day';
import { supabase } from '@/lib/supabase';
import { getOrCreateConversation, sendMessage, MESSAGE_MAX_LENGTH } from '@/lib/messages';
import { assertPlainText } from '@/lib/text-safety';
import type { Listing } from '@/data';
import type { Avail } from '@/preview/dates';

const message = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Please retry.';

function SignInRequired() {
  const { openSignIn } = useAuth();
  return <main className="p1-work-page"><Empty title="Your owner workspace" body="Sign in to manage your own listings, rentals and payouts."><Button onClick={openSignIn}>Sign in</Button></Empty></main>;
}

export function PreviewOwner({ listingView = false }: { listingView?: boolean }) {
  const { user } = useAuth();
  return user ? <ConnectedOwner key={user.id} userId={user.id} listingView={listingView} /> : <SignInRequired />;
}

async function fetchOwnerInventory(userId: string) {
  const [rows, archivedIds] = await Promise.all([
    fetchListingsByOwner(userId),
    supabase.from('listings').select('id').eq('owner_id', userId).eq('status', 'archived'),
  ]);
  if (archivedIds.error) throw archivedIds.error;
  const ids = (archivedIds.data ?? []).filter(row => !rows.some(item => item.id === row.id));
  const archived = await Promise.all(ids.map(row => fetchListingById(row.id)));
  return [...rows, ...archived.filter((row): row is NonNullable<typeof row> => Boolean(row && row.status === 'archived'))]
    .filter(row => row.owner_id === userId).map(toUiListing);
}

function ConnectedOwner({ userId, listingView }: { userId: string; listingView: boolean }) {
  const utcDay = useUtcDay();
  const [items, setItems] = useState<Listing[]>([]);
  const [bookings, setBookings] = useState<UiBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void Promise.all([fetchOwnerInventory(userId), fetchBookingsAsOwner(userId)]).then(([listings, rentals]) => {
      if (active) { setItems(listings); setBookings(rentals.filter(b => b.isOwner)); }
    }).catch(reason => { if (active) setError(message(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, retry, utcDay]);

  async function refresh() {
    const [listings, rentals] = await Promise.all([fetchOwnerInventory(userId), fetchBookingsAsOwner(userId)]);
    if (mounted.current) { setItems(listings); setBookings(rentals.filter(b => b.isOwner)); }
  }
  async function run(action: () => Promise<void>, success: string): Promise<boolean> {
    if (running.current) return false;
    running.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      await action(); await refresh();
      if (mounted.current) setNotice(success);
      return true;
    } catch (reason) {
      let failure = message(reason);
      try { await refresh(); } catch (refreshError) { failure += ` Could not reload the saved server state: ${message(refreshError)}`; }
      if (mounted.current) setError(failure);
      return false;
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function ownRow(id: string) {
    const row = await fetchListingById(id);
    if (!row || row.owner_id !== userId || !Number.isSafeInteger(row.revision)) throw new Error('Could not verify your listing and its latest revision. Reload before continuing.');
    return row;
  }
  const live: LiveOwner = {
    items, bookings, loading, error, notice, busy,
    retry: () => setRetry(value => value + 1),
    decide: (id, approve, reason) => run(async () => {
      const booking = bookings.find(b => b.id === id && b.isOwner);
      if (!booking) throw new Error('This request does not belong to your owner workspace.');
      if (!approve && (!reason || reason.trim().length < 5)) throw new Error('Enter a reason of at least five characters.');
      if (!approve && reason) assertPlainText('Decline reason', reason.trim(), MESSAGE_MAX_LENGTH);
      if (approve || booking.status !== 'rejected') {
        const result = await respondToBookingRequest(id, approve);
        if (result.status !== (approve ? 'pending_payment' : 'rejected')) throw new Error('The server did not confirm the request decision.');
        if (!approve && mounted.current) setBookings(rows => rows.map(row => row.id === id ? { ...row, status: 'rejected' } : row));
      }
      if (!approve && reason) {
        try {
          const conversation = await getOrCreateConversation({ currentUserId: userId, otherUserId: booking.counterpartId, listingId: booking.listingId, bookingId: id });
          await sendMessage(conversation, userId, reason.trim());
        } catch (reasonError) {
          throw new Error(`Request already declined. Only the reason failed to send: ${message(reasonError)}. Retry here to send the reason without declining again.`);
        }
      }
    }, approve ? 'Request approved. The renter must complete payment.' : 'Request declined and the reason sent to the renter.'),
    toggle: async item => { await run(async () => {
      const row = await ownRow(item.id);
      if (row.status === 'published') {
        const { data, error: updateError } = await supabase.from('listings').update({ status: 'archived' }).eq('id', row.id).eq('owner_id', userId).eq('revision', row.revision!).select('status').single();
        if (updateError) throw updateError;
        if (data.status !== 'archived') throw new Error('The server did not confirm that the listing was paused.');
      } else if (row.status === 'archived') {
        await publishListing(row.id);
      } else throw new Error('Only live or paused listings can be toggled. Review this listing in the editor.');
    }, item.listingStatus === 'published' ? 'Listing paused.' : 'The server confirmed your listing is live.'); },
    availability: async id => {
      const [row, dates] = await Promise.all([ownRow(id), fetchUnavailableDates(id)]);
      return { value: { start: row.availability_start ?? '', end: row.availability_end ?? '', blocked: [...dates.blocked] }, locked: [...dates.booked] };
    },
    saveAvailability: (id, value: Avail) => run(async () => {
      const row = await ownRow(id);
      const retained = row.status !== 'draft' && row.availability_start === value.start && row.availability_end === value.end;
      const invalid = listingAvailabilityError(value.start, value.end);
      if (invalid && !retained) throw new Error(invalid);
      const dates = await fetchUnavailableDates(id);
      if ([...dates.booked].some(date => date < value.start || date >= value.end || value.blocked.includes(date))) throw new Error('Keep reserved rental days inside the availability window and unblocked.');
      await saveOwnerAvailability(id, row.revision!, value.start, value.end, value.blocked);
    }, 'Availability saved.'),
    extras: <OwnerDashboard listingView={listingView} />,
  };
  return <Owner listingView={listingView} live={live} />;
}

export function PreviewPayouts() {
  const { user } = useAuth();
  return user ? <ConnectedPayouts key={user.id} userId={user.id} /> : <SignInRequired />;
}

function ConnectedPayouts({ userId }: { userId: string }) {
  const [bookings, setBookings] = useState<LivePayouts['bookings']>(null);
  const [transfers, setTransfers] = useState<LivePayouts['transfers']>(null);
  const [bank, setBank] = useState<LivePayouts['bank']>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const connecting = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setBookings(null); setTransfers(null); setBank(null);
    void Promise.allSettled([fetchBookingsAsOwner(userId), fetchPayoutsByOwner(userId), fetchBankPayoutStatus()]).then(([rentals, payouts, bankPayouts]) => {
      if (!active) return;
      const errors: string[] = [];
      if (rentals.status === 'fulfilled') setBookings(rentals.value.filter(b => b.isOwner)); else errors.push(`Rental activity: ${message(rentals.reason)}`);
      if (payouts.status === 'fulfilled') setTransfers(payouts.value); else errors.push(`Stripe transfers: ${message(payouts.reason)}`);
      if (bankPayouts.status === 'fulfilled') setBank(bankPayouts.value); else errors.push(`Bank payouts: ${message(bankPayouts.reason)}`);
      setError(errors.length ? errors.join(' ') : null); setLoading(false);
    });
    return () => { active = false; };
  }, [userId, retry]);
  return <Payouts live={{ bookings, transfers, bank, error, loading, busy, retry: () => setRetry(value => value + 1), connect: async () => {
    if (connecting.current) return;
    connecting.current = true; setBusy(true); setError(null);
    try { window.location.assign(await startConnectOnboarding()); }
    catch (reason) { setError(message(reason)); }
    finally { connecting.current = false; setBusy(false); }
  } }} />;
}

export function PreviewListingWizard({ editId }: { editId?: string }) {
  const { user, profile, error } = useAuth();
  if (!user) return <SignInRequired />;
  if (!profile || profile.id !== user.id) return <main className="p1-work-page"><p role={error ? 'alert' : 'status'}>{error || 'Loading your owner profile…'}</p></main>;
  return <CreateListingPage key={`${user.id}:${editId ?? 'new'}`} editId={editId} />;
}
