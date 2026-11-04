import { useEffect, useState } from 'react';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';
import { cancelBooking, fetchBookingsAsRenter, startBookingReturn, type UiBooking } from '@/lib/bookings';
import { createCheckoutSession } from '@/lib/payments';
import { getOrCreateConversation } from '@/lib/messages';
import { createCase } from '@/lib/operations';
import { createReview, fetchReviewedBookingIds, REVIEW_MAX_LENGTH } from '@/lib/reviews';
import { assertPlainText } from '@/lib/text-safety';
import { Rentals, type RentalSummary } from '@/preview-1/renting';
import { Button, Dropdown, ErrorNote, Field } from '@/preview-1/ui';
import { BookingPickup } from '@/components/booking-pickup';
import { RentalAgreement } from '@/components/rental-agreement';
import { RentalSettlement } from '@/components/rental-settlement';
import { CheckoutReservation } from '@/components/checkout-reservation';

const STATUSES: Record<UiBooking['status'], RentalSummary['status']> = {
  requested: 'pending', pending_payment: 'approved', confirmed: 'upcoming', active: 'active',
  return_pending: 'return_pending', completed: 'past', cancelled: 'cancelled', rejected: 'cancelled',
};
const LABELS: Record<UiBooking['status'], string> = {
  requested: 'Awaiting owner approval', pending_payment: 'Awaiting payment', confirmed: 'Confirmed',
  active: 'Active', return_pending: 'Return in progress', completed: 'Completed', cancelled: 'Cancelled', rejected: 'Declined',
};

export function PreviewRentals() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [bookings, setBookings] = useState<UiBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true); setError(null); setBookings([]);
    void fetchBookingsAsRenter(userId).then((rows) => { if (active) setBookings(rows); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load your rentals.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, attempt]);

  const find = (id: string) => {
    const booking = bookings.find((row) => row.id === id);
    if (!booking || !userId) throw new Error('Rental is unavailable. Refresh and try again.');
    return booking;
  };
  const change = async (id: string, action: () => Promise<unknown>) => {
    find(id);
    await action();
    if (!userId) throw new Error('Sign in again to check this rental.');
    setBookings(await fetchBookingsAsRenter(userId));
  };
  return <Rentals live={{
    bookings: bookings.map((booking) => ({
      id: booking.id, bookingReference: booking.bookingReference, listingId: booking.listingId, title: booking.listingTitle, image: booking.listingImage,
      start: booking.startDate, end: booking.endDate, total: booking.depositCollectionModel === 'authorization' ? booking.total : booking.total - booking.deposit, ownerName: booking.counterpartName,
      status: STATUSES[booking.status], label: LABELS[booking.status],
      pickup: booking.deliveryMode === 'delivery' ? 'Delivery. Arrange the handoff in messages.' : 'The private pickup address is available after verified confirmation.',
      cancellation: 'Cancellation is checked by the server. Any refund or deposit release requires verified settlement.',
    })),
    loading, error, retry: () => setAttempt((value) => value + 1),
    pickup: async (id) => { find(id); navigate({ name: 'check-in', id }); },
    startReturn: (id) => change(id, () => startBookingReturn(id)),
    cancel: (id) => change(id, () => cancelBooking(id)),
    pay: async (id) => { find(id); window.location.assign(await createCheckoutSession(id)); },
    contact: async (id) => {
      const booking = find(id);
      const conversationId = await getOrCreateConversation({ currentUserId: userId!, otherUserId: booking.counterpartId, listingId: booking.listingId, bookingId: id });
      navigate({ name: 'conversation', id: conversationId });
    },
    report: async (id, issue) => {
      const booking = find(id);
      assertPlainText('Issue', issue, 5000);
      if (issue.length < 10) throw new Error('Describe what happened in at least 10 characters.');
      const data = new FormData();
      data.set('booking_id', id); data.set('category', 'other');
      data.set('subject', `Rental issue: ${booking.listingTitle}`.slice(0, 160)); data.set('description', issue);
      const record = await createCase('dispute', data, false);
      navigate({ name: 'claim-detail', id: record.id });
    },
    details: (id) => {
      const booking = bookings.find((row) => row.id === id);
      return booking && <RentalDetails key={id} booking={booking} />;
    },
  }} />;
}

function RentalDetails({ booking }: { booking: UiBooking }) {
  const { user } = useAuth();
  const [reviewed, setReviewed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState('5');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const userId = user?.id;
  useEffect(() => {
    if (!userId || booking.status !== 'completed') return;
    let active = true;
    setError(null); setReviewed(null);
    void fetchReviewedBookingIds(userId, [booking.id]).then((ids) => { if (active) setReviewed(ids.has(booking.id)); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load your review.'); });
    return () => { active = false; };
  }, [userId, booking.id, booking.status, attempt]);
  return <details><summary>Agreement, payment & rental tools</summary>
    <p>Booking reference: {booking.bookingReference ?? 'Not assigned'}</p>
    <p>Rental ${booking.subtotal.toFixed(2)} · service ${booking.serviceFeeAmount.toFixed(2)} · delivery ${booking.deliveryFeeAmount.toFixed(2)} · insurance ${booking.insuranceAmount.toFixed(2)} · rental total ${(booking.depositCollectionModel === 'authorization' ? booking.total : booking.total - booking.deposit).toFixed(2)}</p>
    <p>Separate security-deposit transaction: ${booking.deposit.toFixed(2)} {booking.depositCollectionModel === 'authorization' ? 'temporary hold, not part of rental payment' : 'legacy charged deposit'}.</p>
    {(booking.taxRate > 0 || booking.sandboxTax) && <p>{booking.sandboxTax ? 'Tax (7% test)' : 'Tax (7%)'}: ${booking.taxAmount.toFixed(2)} · Included in the stored total.</p>}
    {booking.renterNote && <p>Note for owner: {booking.renterNote}</p>}
    <BookingPickup bookingId={booking.id} status={booking.status} paymentFirst={booking.paymentFirst} />
    <RentalAgreement bookingId={booking.id} isOwner={false} />
    {['pending_payment', 'cancelled'].includes(booking.status) && <CheckoutReservation bookingId={booking.id} canPay />}
    {['completed', 'cancelled'].includes(booking.status) && <RentalSettlement bookingId={booking.id} isOwner={false} />}
    {error && <ErrorNote>{error}<Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Retry review status</Button></ErrorNote>}
    {booking.status === 'completed' && reviewed === null && !error && <p role="status">Loading review status…</p>}
    {reviewed && <p role="status">Your review has been saved.</p>}
    {booking.status === 'completed' && reviewed === false && <form onSubmit={(event) => {
      event.preventDefault();
      if (!userId || busy) return;
      setBusy(true); setError(null);
      void createReview({ bookingId: booking.id, reviewerId: userId, revieweeId: booking.counterpartId, rating: Number(rating), body })
        .then(() => { setReviewed(true); setBody(''); })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not save your review.'))
        .finally(() => setBusy(false));
    }}>
      <Field label="Rating"><Dropdown label="Rating" value={rating} onChange={setRating} options={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} stars` }))} /></Field>
      <Field label="Your review"><textarea rows={3} disabled={busy} maxLength={REVIEW_MAX_LENGTH} value={body} onChange={(event) => setBody(event.target.value)} /></Field>
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Submit review'}</Button>
    </form>}
  </details>;
}
