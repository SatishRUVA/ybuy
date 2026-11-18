import { ArrowLeft } from 'lucide-react';
import { getBooking360, getCustomer360, type AdminAccess } from '@/admin/api';
import { Alert, Badge, Button, EmptyState } from '@/main-site/components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/main-site/components/shadcn/card';
import { Skeleton } from '@/main-site/components/skeleton';
import { fmtDate, fmtDay, money, useLoad } from '@/main-site/components/operations/query-utils';
import { PageHeader, StatusBadge } from '@/main-site/components/operations/shared';

type SelectRecord = (section: string, recordId?: string) => void;

function Fields({ items }: { items: [string, string | number | null | undefined][] }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="mt-0.5 break-words text-main">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function RecordCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-3">{children}</CardContent></Card>;
}

function LoadState({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => void }) {
  if (loading) return <Skeleton className="h-52 w-full" rounded="rounded-card-lg" />;
  if (error) return <Alert tone="error" title="Record could not be loaded">{error}<Button className="mt-3" size="sm" variant="secondary" onClick={reload}>Try again</Button></Alert>;
  return null;
}

export function Booking360({ id, access, onSelect }: { id: string; access: AdminAccess; onSelect: SelectRecord }) {
  const query = useLoad(() => getBooking360(id, 100), [id]);
  const data = query.data;
  if (!data) return <div className="space-y-4"><Button size="sm" variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => onSelect('bookings')}>Back to bookings</Button><LoadState loading={query.loading} error={query.error} reload={query.reload} /></div>;

  const booking = data.booking;
  return (
    <div className="space-y-4">
      <Button size="sm" variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => onSelect('bookings')}>Back to bookings</Button>
      <PageHeader title="Booking 360" subtitle={`Booking ${booking.id}`} action={<StatusBadge status={booking.status} />} />
      <div className="grid gap-4 xl:grid-cols-2">
        <RecordCard title="Booking and listing">
          <p className="font-semibold text-main">{booking.listing.title}</p>
          <Fields items={[
            ['Listing status', booking.listing.status], ['Listing ID', booking.listing.id],
            ['Rental dates', `${fmtDay(booking.start_date)} – ${fmtDay(booking.end_date)}`], ['Quantity', booking.quantity],
            ['Daily rate', money(booking.daily_rate)], ['Rental subtotal', money(booking.subtotal)],
            ['Service fee', money(booking.service_fee_amount)], ['Deposit', money(booking.deposit)],
            ['Total charged', money(booking.total)], ['Deposit collection', booking.deposit_collection_model],
            ['Created', fmtDate(booking.created_at)], ['Last updated', fmtDate(booking.updated_at)],
          ]} />
        </RecordCard>
        <RecordCard title="Participants">
          {[booking.renter, booking.owner].map((person, index) => (
            <div key={person.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-app pb-3 last:border-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-xs text-muted">{index === 0 ? 'Renter' : 'Owner'}</p>
                <p className="font-semibold text-main">{person.full_name}</p>
                <p className="text-sm text-sec">{person.email} · {person.customer_id}</p>
              </div>
              {access.permissions.includes('users.manage') &&
                <Button size="sm" variant="secondary" onClick={() => onSelect('users', person.id)}>Customer 360</Button>}
            </div>
          ))}
        </RecordCard>
        <RecordCard title="Handoff and inspections">
          {booking.handoff ? <Fields items={[
            ['Handoff status', booking.handoff.status], ['Pickup arrived', fmtDate(booking.handoff.pickup_arrived_at)],
            ['Actual pickup', fmtDate(booking.handoff.actual_pickup_at)], ['Return initiated', fmtDate(booking.handoff.return_initiated_at)],
            ['Actual return', fmtDate(booking.handoff.actual_return_at)],
            ['Pickup exception', fmtDate(booking.handoff.support_exception_pickup_at)],
            ['Return exception', fmtDate(booking.handoff.support_exception_return_at)],
          ]} /> : <p className="text-sm text-sec">No handoff record.</p>}
          {booking.inspections.map((inspection) => (
            <div key={inspection.kind} className="rounded-card border border-app p-3 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2"><Badge>{inspection.kind} inspection</Badge><span className="text-xs text-muted">{fmtDate(inspection.submitted_at)}</span></div>
              <p><span className="font-medium">Condition:</span> {inspection.appearance_condition}</p>
              <p><span className="font-medium">Existing damage:</span> {inspection.existing_damage}</p>
              <p><span className="font-medium">Function:</span> {inspection.functional_condition}</p>
              <p><span className="font-medium">Accessories:</span> {inspection.included_accessories.join(', ') || 'None listed'}</p>
              <p><span className="font-medium">Serial number:</span> {inspection.serial_number || 'Not provided'}</p>
            </div>
          ))}
        </RecordCard>
        {(data.payments || data.refund_requests || data.deposit_authorizations || data.settlement || data.legacy_payouts) && (
          <RecordCard title="Financial records">
            {data.payments && <>
              <h4 className="text-sm font-semibold">Payments ({data.payments.total})</h4>
              {data.payments.rows.map((payment) => <Fields key={payment.id} items={[
                ['Payment', payment.id], ['Amount', money(payment.amount)], ['Status', payment.status],
                ['Payment intent', payment.stripe_payment_intent_id], ['Created', fmtDate(payment.created_at)],
              ]} />)}
              {data.payments.rows.length === 0 && <p className="text-sm text-sec">No payment records.</p>}
            </>}
            {data.refund_requests && <>
              <h4 className="text-sm font-semibold">Refund requests ({data.refund_requests.total})</h4>
              {data.refund_requests.rows.map((refund) => <Fields key={refund.id} items={[
                ['Refund request', refund.id], ['Amount', money(refund.amount)], ['Status', refund.status],
                ['Reason', refund.reason], ['Requested', fmtDate(refund.created_at)],
                ['Approved', fmtDate(refund.approved_at)], ['Execution enabled', refund.execution_enabled ? 'Yes' : 'No'],
              ]} />)}
              {data.refund_requests.rows.length === 0 && <p className="text-sm text-sec">No refund requests.</p>}
            </>}
            {data.deposit_authorizations?.map((authorization) => <div key={authorization.id} className="rounded-card border border-app p-3">
              <h4 className="mb-2 text-sm font-semibold">Deposit authorization · {authorization.status}</h4>
              <Fields items={[
                ['Authorized', money(authorization.authorized_amount)], ['Captured', money(authorization.captured_amount)],
                ['Attempt', authorization.attempt], ['Capture before', fmtDate(authorization.capture_before)],
                ['Released', fmtDate(authorization.released_at)], ['Captured at', fmtDate(authorization.captured_at)],
                ['Failure reason', authorization.failure_reason],
              ]} />
            </div>)}
            {data.settlement && <Fields items={[
              ['Settlement deposit', money(data.settlement.deposit_amount)], ['Owner amount', money(data.settlement.owner_amount)],
              ['Refund status', data.settlement.refund_status], ['Transfer status', data.settlement.transfer_status],
            ]} />}
            {data.legacy_payouts?.map((payout) => <Fields key={payout.id} items={[
              ['Legacy payout', payout.id], ['Amount', money(payout.amount)], ['Status', payout.status], ['Paid', fmtDate(payout.paid_at)],
            ]} />)}
          </RecordCard>
        )}
        {data.cases && <RecordCard title={`Cases (${data.cases.length})`}>
          {data.cases.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-app py-2 last:border-0">
            <div><p className="font-medium text-main">{item.subject}</p><p className="text-xs text-sec">{item.kind} · {item.category} · {item.priority}</p></div>
            <Button size="sm" variant="secondary" onClick={() => onSelect(item.kind === 'dispute' ? 'disputes' : 'support', item.id)}>Open case</Button>
          </div>)}
          {data.cases.length === 0 && <p className="text-sm text-sec">No authorized case records.</p>}
        </RecordCard>}
        {data.reviews && <RecordCard title={`Reviews (${data.reviews.length})`}>
          {data.reviews.map((review) => <div key={review.id} className="border-b border-app py-2 last:border-0">
            <p className="font-semibold text-main">{review.rating} / 5</p>
            <p className="whitespace-pre-wrap text-sm text-sec">{review.body || 'No written comment.'}</p>
            <p className="mt-1 text-xs text-muted">{fmtDate(review.created_at)}</p>
          </div>)}
          {data.reviews.length === 0 && <p className="text-sm text-sec">No reviews.</p>}
        </RecordCard>}
        {(data.promotion_redemption || data.credit_reservation) && <RecordCard title="Promotions and credits">
          {data.promotion_redemption && <Fields items={[
            ['Promotion', data.promotion_redemption.code], ['Discount', money(data.promotion_redemption.discount_amount)],
            ['Redeemed', fmtDate(data.promotion_redemption.created_at)],
          ]} />}
          {data.credit_reservation && <Fields items={[
            ['Credit reserved', money(data.credit_reservation.amount)], ['Status', data.credit_reservation.status],
            ['Created', fmtDate(data.credit_reservation.created_at)], ['Released', fmtDate(data.credit_reservation.released_at)],
          ]} />}
        </RecordCard>}
      </div>
      <RecordCard title="Activity timeline">
        {data.timeline.length === 0 && <p className="text-sm text-sec">No timeline events.</p>}
        <ol className="space-y-3">
          {data.timeline.map((event, index) => <li key={`${event.type}:${event.created_at}:${index}`} className="border-l-2 border-app pl-3">
            <p className="text-sm font-medium text-main">{event.type.replace(/_/g, ' ')}{event.status ? ` · ${event.status}` : ''}</p>
            <p className="text-xs text-sec">{fmtDate(event.created_at)}{event.actor_id ? ` · ${event.actor_id}` : ''}</p>
          </li>)}
        </ol>
      </RecordCard>
    </div>
  );
}

export function Customer360({ id, onSelect }: { id: string; onSelect: SelectRecord }) {
  const query = useLoad(() => getCustomer360(id, 100), [id]);
  const data = query.data;
  if (!data) return <div className="space-y-4"><Button size="sm" variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => onSelect('users')}>Back to users</Button><LoadState loading={query.loading} error={query.error} reload={query.reload} /></div>;

  const customer = data.customer;
  return (
    <div className="space-y-4">
      <Button size="sm" variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => onSelect('users')}>Back to users</Button>
      <PageHeader title="Customer 360" subtitle={`${customer.full_name} · ${customer.customer_id}`} />
      {customer.restriction && <Alert tone="warning" title="Account restricted">{customer.restriction.reason} · {fmtDate(customer.restriction.restricted_at)}</Alert>}
      <div className="grid gap-4 xl:grid-cols-2">
        <RecordCard title="Customer profile">
          <Fields items={[
            ['Name', customer.full_name], ['Customer ID', customer.customer_id], ['Email', customer.email],
            ['Phone', customer.phone], ['Joined', fmtDate(customer.created_at)], ['Account status', customer.restriction ? 'Restricted' : 'Active'],
          ]} />
        </RecordCard>
        {data.bookings && <RecordCard title={`Bookings (${data.bookings.total})`}>
          {data.bookings.rows.map((booking) => <div key={booking.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-app py-2 last:border-0">
            <div><p className="font-medium text-main">{booking.listing_title}</p><p className="text-xs text-sec">{booking.role} · {fmtDay(booking.start_date)} – {fmtDay(booking.end_date)} · {money(booking.total)}</p></div>
            <Button size="sm" variant="secondary" onClick={() => onSelect('bookings', booking.id)}>Booking 360</Button>
          </div>)}
          {data.bookings.total > data.bookings.rows.length && <p className="text-xs text-muted">Showing the most recent {data.bookings.rows.length} of {data.bookings.total} bookings.</p>}
          {data.bookings.rows.length === 0 && <p className="text-sm text-sec">No bookings.</p>}
        </RecordCard>}
        {data.cases && <RecordCard title={`Cases (${data.cases.total})`}>
          {data.cases.rows.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-app py-2 last:border-0">
            <div><p className="font-medium text-main">{item.subject}</p><p className="text-xs text-sec">{item.kind} · {item.status} · {item.priority}</p></div>
            <Button size="sm" variant="secondary" onClick={() => onSelect(item.kind === 'dispute' ? 'disputes' : 'support', item.id)}>Open case</Button>
          </div>)}
          {data.cases.total > data.cases.rows.length && <p className="text-xs text-muted">Showing the most recently updated {data.cases.rows.length} of {data.cases.total} cases.</p>}
          {data.cases.rows.length === 0 && <p className="text-sm text-sec">No authorized case records.</p>}
        </RecordCard>}
        {data.reviews && <RecordCard title={`Reviews (${data.reviews.total})`}>
          {data.reviews.rows.map((review) => <div key={review.id} className="border-b border-app py-2 last:border-0">
            <p className="font-semibold text-main">{review.rating} / 5</p><p className="whitespace-pre-wrap text-sm text-sec">{review.body || 'No written comment.'}</p>
            <p className="mt-1 text-xs text-muted">{fmtDate(review.created_at)}</p>
          </div>)}
          {data.reviews.rows.length === 0 && <p className="text-sm text-sec">No reviews.</p>}
        </RecordCard>}
        {data.credits && <RecordCard title="Credits">
          <Fields items={[
            ['Available', money(data.credits.available)], ['Balance', money(data.credits.balance)],
            ['Reserved', money(data.credits.reserved)], ['Ledger entries', data.credits.total],
          ]} />
          {data.credits.rows.map((credit) => <div key={credit.id} className="flex justify-between gap-3 border-t border-app pt-2 text-sm">
            <span>{credit.kind} · {fmtDate(credit.created_at)}</span><span>{money(credit.amount)}</span>
          </div>)}
        </RecordCard>}
        {data.promotion_redemptions && <RecordCard title={`Promotion redemptions (${data.promotion_redemptions.total})`}>
          {data.promotion_redemptions.rows.map((redemption) => <Fields key={`${redemption.booking_id}:${redemption.created_at}`} items={[
            ['Promotion', redemption.promotion_code], ['Discount', money(redemption.discount_amount)],
            ['Redeemed', fmtDate(redemption.created_at)], ['Booking', redemption.booking_id],
          ]} />)}
          {data.promotion_redemptions.rows.length === 0 && <p className="text-sm text-sec">No promotion redemptions.</p>}
        </RecordCard>}
      </div>
      {!data.bookings && !data.cases && !data.reviews && !data.credits && !data.promotion_redemptions &&
        <EmptyState title="No additional details available" description="Your administrator permissions allow profile access only." />}
    </div>
  );
}
