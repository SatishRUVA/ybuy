import { useState } from 'react';
import { Alert, Badge, Button } from '@/main-site/components/ui';
import {
  listBookings, listListings, listPayments, listPayouts, listReviews, listUsers,
  removeReview, setListingSuspension, setUserRestriction,
  listCheckoutExceptions,
  getListingPublicationReview, approveListingPublication,
  useAdminAccess,
  type ListingPublicationReview,
  type AdminListingRow, type AdminUserRow, type AdminReviewRow,
} from '@/admin/api';
import { fmtDate, fmtDay, money, usePagedQuery } from '@/main-site/components/operations/query-utils';
import { PageHeader, PagedTable, ReasonDialog, SearchBox, StatusBadge, StatusFilter } from '@/main-site/components/operations/shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/main-site/components/shadcn/dialog';
import { AuctionDecisionsSection } from '@/admin/pages/auction-decisions';

const Muted = ({ children }: { children: React.ReactNode }) => <span className="text-xs text-muted block">{children}</span>;
const Person = ({ name, email }: { name: string; email: string }) => (
  <div className="min-w-0"><span className="font-medium">{name}</span><Muted>{email}</Muted></div>
);
const filterArg = (v: string) => (v === 'all' ? undefined : v);

export function UsersSection() {
  const { access } = useAdminAccess();
  const canReviewBidding = access?.permissions.includes('config.manage') ?? false;
  const [search, setSearch] = useState('');
  const [historyUser, setHistoryUser] = useState<AdminUserRow | null>(null);
  const [target, setTarget] = useState<AdminUserRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const query = usePagedQuery((limit, offset) => listUsers({ search, limit, offset }), [search]);
  const restricting = target ? !target.restricted_at : false;

  return (
    <>
      <PageHeader title="Users" subtitle="Search accounts and restrict or reinstate access. Restricting suspends the user's published listings." action={<SearchBox onChange={setSearch} placeholder="Name, email or Customer ID" />} />
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      <PagedTable
        query={query} rowKey={(u) => u.id} emptyTitle="No users found" emptyDescription="Try a different name, email or Customer ID."
        columns={[
          { header: 'User', cell: (u) => <Person name={u.full_name} email={u.email} /> },
          { header: 'Customer ID', cell: (u) => <span className="font-mono text-xs select-all">{u.customer_id ?? 'Migration required'}</span> },
          { header: 'Joined', cell: (u) => fmtDate(u.created_at) },
          { header: 'Listings', cell: (u) => <span className="tnum">{u.listing_count}</span> },
          { header: 'Status', cell: (u) => (
            <div className="flex flex-wrap gap-1">
              {u.restricted_at ? <Badge tone="error">restricted</Badge> : <Badge tone="success">access active</Badge>}
              {u.is_admin && <Badge tone="accent">admin</Badge>}
              {canReviewBidding && (u.missed_decision_count ?? 0) > 0 && <Badge tone="warning">{u.missed_decision_count} missed bidding decision{u.missed_decision_count === 1 ? '' : 's'}</Badge>}
            </div>
          ) },
          { header: '', className: 'text-right', cell: (u) => (
            <div className="flex flex-wrap justify-end gap-2">
            {canReviewBidding && <Button size="sm" variant="secondary" onClick={() => setHistoryUser(u)}>Bidding history</Button>}
            <Button size="sm" variant={u.restricted_at ? 'secondary' : 'danger'} disabled={u.is_admin} onClick={() => setTarget(u)}>
              {u.restricted_at ? 'Reinstate' : 'Restrict'}
            </Button>
            </div>
          ) },
        ]}
      />
      <Dialog open={historyUser !== null} onOpenChange={open => { if (!open) setHistoryUser(null); }}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Bidding history: {historyUser?.full_name}</DialogTitle>
            <DialogDescription>{historyUser?.customer_id} · {historyUser?.restricted_at ? 'Account restricted' : 'Account access active'}. Missed decisions do not automatically restrict an account or change review stars.</DialogDescription>
          </DialogHeader>
          {historyUser && <div className="mt-5 min-w-0">
            {historyUser.last_missed_decision_at && <p className="mb-3 text-sm text-sec">Last recorded missed decision: {fmtDate(historyUser.last_missed_decision_at)}</p>}
            <AuctionDecisionsSection key={historyUser.id} ownerId={historyUser.id} />
          </div>}
        </DialogContent>
      </Dialog>
      <ReasonDialog
        open={target !== null} onOpenChange={(o) => !o && setTarget(null)} danger={restricting}
        title={`${restricting ? 'Restrict' : 'Reinstate'} ${target?.full_name ?? 'user'}?`}
        description={restricting
          ? 'They will be unable to create listings, bookings, messages or reviews, and their published listings will be suspended.'
          : 'They regain access. Suspended listings stay suspended until reinstated individually.'}
        confirmLabel={restricting ? 'Restrict user' : 'Reinstate user'}
        onConfirm={async (reason) => {
          const res = await setUserRestriction(target!.id, restricting, reason);
          setNotice(restricting ? `User restricted; ${res.listings_suspended} listing(s) suspended.` : 'User reinstated.');
          query.reload();
        }}
      />
    </>
  );
}

export function ListingsSection() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [target, setTarget] = useState<AdminListingRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [review, setReview] = useState<ListingPublicationReview | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const query = usePagedQuery((limit, offset) => listListings({ search, status: filterArg(status), limit, offset }), [search, status]);
  const suspending = target ? target.status !== 'suspended' : false;

  return (
    <>
      <PageHeader title="Listings" subtitle="Moderate listings. Suspended listings are hidden from search and cannot be re-published by the owner." />
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <SearchBox onChange={setSearch} placeholder="Search title or owner email" />
        <StatusFilter label="Filter by status" value={status} onChange={setStatus} options={['pending_approval', 'published', 'draft', 'archived', 'suspended']} />
      </div>
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      {reviewError && <Alert tone="error" className="mb-4">{reviewError}</Alert>}
      <PagedTable
        query={query} rowKey={(l) => l.id} emptyTitle="No listings match" emptyDescription="Adjust the search or status filter."
        columns={[
          { header: 'Listing', cell: (l) => <div className="min-w-0 max-w-[260px]"><span className="font-medium line-clamp-2">{l.title}</span><Muted>{l.category ?? 'Uncategorised'}</Muted></div> },
          { header: 'Owner', cell: (l) => <Person name={l.owner_name} email={l.owner_email} /> },
          { header: 'Price / day', cell: (l) => <span className="tnum">{money(l.price_per_day)}</span> },
          { header: 'Status', cell: (l) => <StatusBadge status={l.status} /> },
          { header: 'Flags', cell: (l) => l.open_flags > 0 ? <Badge tone="warning">{l.open_flags} open</Badge> : <span className="text-muted">—</span> },
          { header: '', className: 'text-right', cell: (l) => (
            <div className="flex justify-end gap-2">
            {l.status === 'pending_approval' && <Button size="sm" variant="secondary" disabled={reviewBusy} onClick={async () => {
              setReviewBusy(true); setReviewError(null);
              try { setReview(await getListingPublicationReview(l.id)); }
              catch (error) { setReviewError((error as Error).message); }
              finally { setReviewBusy(false); }
            }}>Review publication</Button>}
            <Button size="sm" variant={l.status === 'suspended' ? 'secondary' : 'danger'} onClick={() => setTarget(l)}>
              {l.status === 'suspended' ? 'Reinstate' : 'Suspend'}
            </Button>
            </div>
          ) },
        ]}
      />
      <ReasonDialog open={review !== null} onOpenChange={(open) => !open && setReview(null)}
        title={`Approve "${review?.title ?? 'listing'}"?`}
        description="Review the exact saved listing. Approval is audited and is rejected if the listing changes or has blocking moderation flags."
        confirmLabel="Approve publication"
        onConfirm={async reason => {
          const saved = await approveListingPublication(review!.id, review!.revision, reason);
          if (saved.status !== 'published') throw new Error('The listing was not published.');
          setNotice('Listing reviewed and published.'); query.reload();
        }}>
        {review && <div className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap">{review.description}</p>
          <p>Declared value: {money(review.estimated_value)} · Deposit: {money(review.deposit)} · Daily price: {money(review.price_per_day)}</p>
          <p>{review.available_quantity} unit(s) · {review.availability_start} to {review.availability_end} (exclusive) · Delivery fee: {money(review.delivery_fee)}</p>
          <div className="flex gap-2 overflow-x-auto">{review.images.map((image, index) =>
            <img key={image.url} src={image.url} alt={`Listing photo ${index + 1}`} className="h-28 w-28 rounded object-cover" />)}</div>
          {review.blocking_flags.map((flag, index) => <p key={index} role="alert" className="text-error">{flag.type}: {flag.reason}</p>)}
        </div>}
      </ReasonDialog>
      <ReasonDialog
        open={target !== null} onOpenChange={(o) => !o && setTarget(null)} danger={suspending}
        title={`${suspending ? 'Suspend' : 'Reinstate'} "${target?.title ?? 'listing'}"?`}
        description={suspending
          ? 'The listing is hidden immediately. Existing bookings are not cancelled.'
          : 'The listing returns to draft; the owner must publish it again.'}
        confirmLabel={suspending ? 'Suspend listing' : 'Reinstate listing'}
        onConfirm={async (reason) => {
          await setListingSuspension(target!.id, suspending, reason);
          setNotice(suspending ? 'Listing suspended.' : 'Listing reinstated as a draft.');
          query.reload();
        }}
      />
    </>
  );
}

const BOOKING_STATUSES = ['requested', 'pending_payment', 'confirmed', 'active', 'return_pending', 'completed', 'cancelled', 'rejected'];

export function BookingsSection() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const query = usePagedQuery((limit, offset) => listBookings({ search, status: filterArg(status), limit, offset }), [search, status]);
  return (
    <>
      <PageHeader title="Bookings" subtitle="Read-only view of every booking and its verified payment state." />
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <SearchBox onChange={setSearch} placeholder="Listing, email or booking ID" />
        <StatusFilter label="Filter by status" value={status} onChange={setStatus} options={BOOKING_STATUSES} />
      </div>
      <PagedTable
        query={query} rowKey={(b) => b.id} emptyTitle="No bookings match" emptyDescription="Adjust the search or status filter."
        columns={[
          { header: 'Listing', cell: (b) => <div className="max-w-[220px]"><span className="font-medium line-clamp-2">{b.listing_title}</span><Muted>{fmtDay(b.start_date)} → {fmtDay(b.end_date)}</Muted></div> },
          { header: 'Renter', cell: (b) => <Person name={b.renter_name} email={b.renter_email} /> },
          { header: 'Owner', cell: (b) => <Person name={b.owner_name} email={b.owner_email} /> },
          { header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
          { header: 'Payment', cell: (b) => <StatusBadge status={b.payment_status} /> },
          { header: 'Rental', cell: (b) => <span className="tnum">{money(b.subtotal)}</span> },
          { header: 'Fee', cell: (b) => <span className="tnum">{money(b.service_fee_amount)}</span> },
          { header: 'Deposit', cell: (b) => <span className="tnum">{money(b.deposit)}</span> },
          { header: 'Total', cell: (b) => <span className="tnum font-semibold">{money(b.total)}</span> },
        ]}
      />
    </>
  );
}

export function PaymentsSection() {
  const [status, setStatus] = useState('all');
  const query = usePagedQuery((limit, offset) => listPayments({ status: filterArg(status), limit, offset }), [status]);
  const exceptions=usePagedQuery(listCheckoutExceptions,[]);
  return (
    <>
      <PageHeader title="Payments" subtitle="Payment records are written only by the verified Stripe webhook." />
      <div className="mb-4"><StatusFilter label="Filter by status" value={status} onChange={setStatus} options={['pending', 'succeeded', 'failed', 'refunded']} /></div>
      <PagedTable
        query={query} rowKey={(p) => p.id} emptyTitle="No payments yet" emptyDescription="Payments appear after a renter checks out."
        columns={[
          { header: 'Booking', cell: (p) => <div className="max-w-[220px]"><span className="font-medium line-clamp-2">{p.listing_title}</span><Muted>{p.renter_email}</Muted></div> },
          { header: 'Amount', cell: (p) => <span className="tnum font-semibold">{money(p.amount)}</span> },
          { header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
          { header: 'Stripe reference', cell: (p) => <code className="text-xs text-sec">{p.stripe_payment_intent_id ?? '—'}</code> },
          { header: 'Created', cell: (p) => fmtDate(p.created_at) },
        ]}
      />
      <h2 className="text-lg font-semibold mt-8 mb-3">Paid bookings requiring reconciliation</h2>
      <Alert tone="warning" className="mb-3">These are verified payment receipts that could not allocate a rental. No automatic refund policy is enabled. Resolve with the payment provider and support; never ask the renter to pay again.</Alert>
      <PagedTable query={exceptions} rowKey={(row) => row.id} emptyTitle="No payment allocation exceptions"
        columns={[
          { header: 'Booking',cell: (row) => <code className="text-xs break-all">{row.booking_id}</code> },
          { header: 'Received',cell: (row) => `${row.amount} ${row.currency.toUpperCase()}` },
          { header: 'Reason',cell: (row) => row.reason },
          { header: 'Status',cell: (row) => <StatusBadge status={row.status} /> },
          { header: 'Provider reference',cell: (row) => <code className="text-xs break-all">{row.payment_intent_id}</code> },
          { header: 'Created',cell: (row) => fmtDate(row.created_at) },
        ]} />
    </>
  );
}

export function PayoutsSection() {
  const [status, setStatus] = useState('all');
  const query = usePagedQuery((limit, offset) => listPayouts({ status: filterArg(status), limit, offset }), [status]);
  return (
    <>
      <PageHeader title="Payouts & deposit refunds" subtitle="Stripe Connect transfers are not bank payouts. Legacy manual entries are bookkeeping, not provider verification." />
      <div className="mb-4"><StatusFilter label="Filter by status" value={status} onChange={setStatus} options={['pending', 'processing', 'succeeded', 'reversed', 'paid']} /></div>
      <PagedTable
        query={query} rowKey={(p) => p.id} emptyTitle="No settlements recorded" emptyDescription="Owner-confirmed returns create deposit refunds and earnings transfers."
        columns={[
          { header: 'Owner', cell: (p) => <Person name={p.owner_name} email={p.owner_email} /> },
          { header: 'Amount', cell: (p) => <span className="tnum font-semibold">{money(p.amount)}</span> },
          { header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
          { header: 'Source / reference', cell: (p) => <span className="break-all">{p.source === 'stripe_connect' ? 'Stripe Connect' : 'Legacy manual'}<br />{p.provider_ref}</span> },
          { header: 'Deposit refund', cell: (p) => p.refund_status ? `${money(p.deposit_amount ?? 0)}: ${p.refund_status}` : 'Not recorded' },
          { header: 'Verified at', cell: (p) => fmtDate(p.paid_at) },
          { header: 'Notes', cell: (p) => <span className="text-sec">{p.notes ?? '—'}</span> },
        ]}
      />
    </>
  );
}

export function ReviewsSection() {
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<AdminReviewRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const query = usePagedQuery((limit, offset) => listReviews({ search, limit, offset }), [search]);
  return (
    <>
      <PageHeader title="Reviews" subtitle="Remove reviews that break the guidelines. The full review is preserved in the audit log." action={<SearchBox onChange={setSearch} placeholder="Search review text" />} />
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      <PagedTable
        query={query} rowKey={(r) => r.id} emptyTitle="No reviews found"
        columns={[
          { header: 'Rating', cell: (r) => <span className="tnum font-semibold">{r.rating} / 5</span> },
          { header: 'Review', cell: (r) => <p className="max-w-[320px] line-clamp-3 whitespace-normal">{r.body || <span className="text-muted">No text</span>}</p> },
          { header: 'From → To', cell: (r) => `${r.reviewer_name} → ${r.reviewee_name}` },
          { header: 'Date', cell: (r) => fmtDate(r.created_at) },
          { header: '', className: 'text-right', cell: (r) => <Button size="sm" variant="danger" onClick={() => setTarget(r)}>Remove</Button> },
        ]}
      />
      <ReasonDialog
        open={target !== null} onOpenChange={(o) => !o && setTarget(null)} danger
        title="Remove this review?" description="This permanently deletes the review. It cannot be restored from the app."
        confirmLabel="Remove review"
        onConfirm={async (reason) => {
          await removeReview(target!.id, reason);
          setNotice('Review removed.');
          query.reload();
        }}
      />
    </>
  );
}
