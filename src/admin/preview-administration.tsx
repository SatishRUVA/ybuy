import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, FileDown, Search, ShieldCheck } from 'lucide-react';
import { useAdminAccess, fetchOverview, listListings, listUsers, getListingPublicationReview, approveListingPublication, setUserRestriction,
  type AdminAccess, type AdminListingRow, type AdminUserRow, type ListingPublicationReview, type Overview } from '@/admin/api';
import { AdminPage } from '@/admin/legacy-pages/admin-page';
import { Button, Empty, ErrorNote, Field, Modal, PageHead, Tag, money } from '@/preview-1/ui';
import { AdminLayout } from '@/preview-1/admin';
import { href } from '@/preview-1/state';

const pageSize = 50;
const failure = (reason: unknown) => reason instanceof Error ? reason.message : 'The request failed. Please try again.';

type PreviewSection = 'Overview' | 'Moderation' | 'Members' | 'Disputes' | 'Reporting' | 'Settings';
const tabs: { name: PreviewSection; allowed: (access: AdminAccess) => boolean }[] = [
  { name: 'Overview', allowed: access => access.permissions.includes('analytics.view') },
  { name: 'Moderation', allowed: access => access.permissions.some(permission => ['listings.moderate', 'reviews.moderate'].includes(permission)) },
  { name: 'Members', allowed: access => access.permissions.some(permission => ['users.manage', 'fraud.investigate'].includes(permission)) },
  { name: 'Disputes', allowed: access => access.permissions.some(permission => permission === 'disputes.manage' || permission === 'support.manage') },
  { name: 'Reporting', allowed: access => access.permissions.some(permission =>
    ['analytics.view', 'bookings.view', 'payments.view', 'payouts.view', 'refunds.issue', 'refunds.approve', 'refunds.senior'].includes(permission)) },
  { name: 'Settings', allowed: access => access.permissions.some(permission =>
    ['categories.manage', 'config.manage', 'flags.manage', 'admins.manage', 'integrations.view', 'audit.view',
      'promotions.manage', 'credits.manage', 'refunds.issue', 'refunds.approve', 'refunds.senior'].includes(permission)) },
];

function normalizedSection(section?: string): PreviewSection | undefined {
  const value = section?.toLowerCase();
  if (!value) return undefined;
  if (['overview', 'analytics'].includes(value)) return 'Overview';
  if (['moderation', 'listings', 'requests', 'reviews'].includes(value)) return 'Moderation';
  if (['members', 'users', 'investigations'].includes(value)) return 'Members';
  if (['disputes', 'support', 'cases'].includes(value)) return 'Disputes';
  if (['reporting', 'bookings', 'payments', 'payouts', 'refunds'].includes(value)) return 'Reporting';
  if (['settings', 'categories', 'flags', 'integrations', 'audit', 'admins', 'promotions', 'insurance'].includes(value)) return 'Settings';
  return tabs.find(tab => tab.name.toLowerCase() === value)?.name;
}

function OverviewContent({ overview, loading, error, retry, reporting, onOpenTools }: {
  overview: Overview | null; loading: boolean; error: string | null; retry: () => void; reporting: boolean; onOpenTools: () => void;
}) {
  if (loading) return <p role="status" aria-busy="true">Loading live marketplace reporting…</p>;
  if (error) return <section><ErrorNote>{error}</ErrorNote><Button variant="secondary" onClick={retry}>Retry reporting</Button></section>;
  if (!overview) return <Empty title="Reporting is unavailable." body="No live report has been returned yet. Retry to request current platform data."><Button onClick={retry}>Retry reporting</Button></Empty>;

  const statuses = Object.entries(overview.bookings_by_status);
  const bookings = statuses.reduce((total, [, count]) => total + count, 0);
  const report = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(overview, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `ybuy-admin-report-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <div className="p1-admin-metrics">
      <div><span>Live listings</span><strong>{overview.listings_published}</strong></div>
      <div><span>New members · 30 days</span><strong>{overview.users_new}</strong></div>
      <div><span>Bookings · 30 days</span><strong>{bookings}</strong></div>
      <div><span>{reporting ? 'Platform fees · 30 days' : 'Gross rental · 30 days'}</span><strong>{money(reporting ? overview.platform_fees : overview.gross_rental)}</strong></div>
    </div>
    {reporting ? <section>
      <div className="p1-section-head"><div><h2>Rental status distribution</h2><p>{new Date(overview.period.from).toLocaleDateString()} – {new Date(overview.period.to).toLocaleDateString()}</p></div>
        <Button variant="secondary" onClick={report}><FileDown size={16} aria-hidden="true" /> Download report</Button></div>
      <div className="p1-report-bars">{statuses.map(([status, count]) => <div key={status}><span>{status.replace(/_/g, ' ')}</span><div><i style={{ width: `${bookings ? count / bookings * 100 : 0}%` }} /></div><b>{count}</b></div>)}</div>
      <div className="p1-data-list">
        <article><span>Refunds</span><strong>{money(overview.refunds)}</strong></article>
        <article><span>Deposit liability</span><strong>{money(overview.deposit_liability)}</strong></article>
        <article><span>Unsettled rental subtotal</span><strong>{money(overview.payables_outstanding)}</strong></article>
      </div>
      <p className="p1-info-copy">Rental subtotal excludes deposits. Platform fees and deposit liabilities are reported separately.</p>
    </section> : <div className="p1-admin-overview">
      <section><div className="p1-section-head"><h2>Marketplace activity</h2><Button variant="quiet" onClick={onOpenTools}>Open admin tools <ArrowRight size={16} aria-hidden="true" /></Button></div>
        <p>{overview.listings_suspended} suspended listings · {overview.users_total} members total</p>
        <p className="p1-info-copy">Rental subtotal excludes deposits; platform fees and deposit liabilities are reported separately.</p>
      </section>
      <section><div className="p1-section-head"><h2>Recent actions</h2><Button variant="quiet" onClick={() => onOpenTools()}>View audit tools</Button></div>
        {overview.recent_actions.length ? overview.recent_actions.slice(0, 3).map(action => <div className="p1-admin-issue-row" key={action.id}>
          <ShieldCheck size={20} aria-hidden="true" /><div><b>{action.action.replace(/_/g, ' ')}</b><p>{action.entity_type} · {new Date(action.created_at).toLocaleString()}</p></div>
        </div>) : <p>No administrator actions in this reporting period.</p>}
      </section>
    </div>}
  </>;
}

function ModerationContent({ onOpenTools }: { onOpenTools: () => void }) {
  const [rows, setRows] = useState<AdminListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminListingRow | null>(null);
  const [review, setReview] = useState<ListingPublicationReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void listListings({ status: 'pending_approval', limit: 100, offset: 0 })
      .then(result => { if (active) setRows(result.rows); })
      .catch(reason => { if (active) setError(failure(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);

  function retryQueue() { setLoadAttempt(value => value + 1); }

  async function loadReview(row: AdminListingRow) {
    setSelected(row); setReview(null); setReason(''); setReviewError(null); setReviewLoading(true);
    try { setReview(await getListingPublicationReview(row.id)); }
    catch (reason) { setReviewError(failure(reason)); }
    finally { setReviewLoading(false); }
  }
  async function approve() {
    if (!review || !reason.trim() || review.blocking_flags.length) return;
    setSaving(true); setSaveError(null);
    try {
      const saved = await approveListingPublication(review.id, review.revision, reason.trim());
      if (saved.status !== 'published') throw new Error('The listing was not published.');
      setSelected(null); setReview(null);
      setRows(current => current.filter(row => row.id !== review.id));
    } catch (reason) { setSaveError(failure(reason)); }
    finally { setSaving(false); }
  }

  return <>
    <div className="p1-section-head"><div><h2>Ready for review</h2><p>Publication decisions are checked against the current listing revision on the server.</p></div>
      <Button variant="secondary" onClick={onOpenTools}>Open all moderation tools</Button></div>
    {loading && <p role="status" aria-busy="true">Loading listings awaiting approval…</p>}
    {error && <><ErrorNote>{error}</ErrorNote><Button variant="secondary" onClick={retryQueue}>Retry moderation</Button></>}
    {!loading && !error && rows.length === 0 && <Empty title="The queue is clear." body="No live listings are waiting for publication review." />}
    {!error && <div className="p1-moderation-list">{rows.map(row => <article key={row.id}><div>
      <Tag tone="pending">Awaiting review</Tag><h2>{row.title}</h2>
      <p>by {row.owner_name} · {row.category ?? 'Uncategorized'} · {money(row.price_per_day)} / day</p>
      {row.open_flags > 0 && <p className="p1-muted">{row.open_flags} open moderation {row.open_flags === 1 ? 'flag' : 'flags'}</p>}
    </div><Button variant="secondary" onClick={() => void loadReview(row)}>Review listing</Button></article>)}</div>}
    <Modal open={Boolean(selected)} onClose={() => { if (!saving) { setSelected(null); setReview(null); setSaveError(null); } }}
      title="Give this listing a fair look." description="Review the current listing revision before approving it." wide>
      {reviewLoading && <p role="status" aria-busy="true">Loading listing review…</p>}
      {reviewError && <><ErrorNote>{reviewError}</ErrorNote><Button variant="secondary" disabled={reviewLoading} onClick={() => selected && void loadReview(selected)}>Retry review</Button></>}
      {review && <div className="p1-review-listing">
        {review.images[0] && <img src={review.images[0].url} alt={review.title} />}
        <div><h2>{review.title}</h2><p>{review.description}</p><p><b>{money(review.price_per_day)}</b> / day · {review.available_quantity} available</p>
          <p>Rental window {review.availability_start} – {review.availability_end} · Deposit {money(review.deposit)}</p>
          {review.blocking_flags.map(flag => <ErrorNote key={`${flag.type}:${flag.reason}`}>{flag.type}: {flag.reason}</ErrorNote>)}
          <Field label="Reason for approval"><textarea value={reason} onChange={event => setReason(event.target.value)} minLength={5} maxLength={500} required rows={3} /></Field>
          {saveError && <ErrorNote>{saveError}</ErrorNote>}
          <div className="p1-actions"><Button disabled={saving || reason.trim().length < 5 || review.blocking_flags.length > 0} onClick={() => void approve()}>
            <Check size={17} aria-hidden="true" />{saving ? 'Approving…' : 'Approve listing'}</Button>
            <Button variant="secondary" disabled={saving} onClick={() => void loadReview(selected!)}>Reload review</Button>
            <Button variant="quiet" disabled={saving} onClick={onOpenTools}>Other listing actions</Button>
          </div>
        </div>
      </div>}
    </Modal>
  </>;
}

function MembersContent({ onOpenTools }: { onOpenTools: () => void }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void listUsers({ search, limit: pageSize, offset: page * pageSize })
      .then(result => { if (active) { setRows(result.rows); setTotal(result.total); } })
      .catch(reason => { if (active) setError(failure(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, page, refresh]);

  async function saveRestriction() {
    if (!selected || !reason.trim()) return;
    setSaving(true); setSaveError(null);
    try {
      await setUserRestriction(selected.id, !selected.restricted_at, reason.trim());
      setSelected(null); setReason(''); setRefresh(value => value + 1);
    } catch (reason) { setSaveError(failure(reason)); }
    finally { setSaving(false); }
  }

  return <>
    <div className="p1-section-head"><div><h2>The people behind the gear.</h2><p>Member status and restrictions come from the administrator service.</p></div>
      <Button variant="secondary" onClick={onOpenTools}>Open all member tools</Button></div>
    <form className="p1-query p1-space-bottom" onSubmit={event => { event.preventDefault(); setPage(0); setSearch(query.trim()); }}>
      <Search size={17} aria-hidden="true" /><input aria-label="Search members" placeholder="Search members" value={query} onChange={event => setQuery(event.target.value)} />
      <Button type="submit" variant="quiet">Search</Button>
    </form>
    {loading && <p role="status" aria-busy="true">Loading members…</p>}
    {error && <><ErrorNote>{error}</ErrorNote><Button variant="secondary" onClick={() => setRefresh(value => value + 1)}>Retry members</Button></>}
    {!error && !loading && rows.length === 0 && <Empty title="No members found." body="Try another search or clear the current query." />}
    {!error && <div className="p1-member-list">{rows.map(user => <article key={user.id}>
      <div className="p1-avatar" aria-hidden="true">{user.full_name.trim().charAt(0).toUpperCase() || '?'}</div>
      <div><h2>{user.full_name || user.email}</h2><p>{user.email} · {user.listing_count} listings</p>
        {user.restricted_reason && <small>{user.restricted_reason}</small>}</div>
      <Tag tone={user.restricted_at ? 'bad' : 'good'}>{user.restricted_at ? 'restricted' : user.is_admin ? 'administrator' : 'active'}</Tag>
      {!user.is_admin && <Button variant="secondary" onClick={() => { setSelected(user); setReason(''); setSaveError(null); }}>
        {user.restricted_at ? 'Restore member' : 'Review member'}</Button>}
    </article>)}</div>}
    {!error && total > pageSize && <div className="p1-actions"><Button variant="secondary" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>Previous</Button>
      <span>Page {page + 1} of {Math.ceil(total / pageSize)}</span><Button variant="secondary" disabled={(page + 1) * pageSize >= total || loading} onClick={() => setPage(value => value + 1)}>Next</Button></div>}
    <Modal open={Boolean(selected)} onClose={() => { if (!saving) setSelected(null); }} title={selected?.restricted_at ? 'Restore member access.' : 'Review this member.'}
      description="Administrator permissions and server-side restrictions remain authoritative.">
      {selected && <form onSubmit={event => { event.preventDefault(); void saveRestriction(); }}>
        <p>{selected.full_name || selected.email} · {selected.email}</p>
        <Field label="Reason for this decision"><textarea required minLength={5} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} rows={4} /></Field>
        {saveError && <ErrorNote>{saveError}</ErrorNote>}
        <Button type="submit" disabled={saving || reason.trim().length < 5}>{saving ? 'Saving…' : selected.restricted_at ? 'Restore member' : 'Restrict member'}</Button>
      </form>}
    </Modal>
  </>;
}

function HandoffSection({ section, onOpenTools }: { section: 'Disputes' | 'Settings'; onOpenTools: (section: string) => void }) {
  const disputes = section === 'Disputes';
  return <section className="p1-settings-form">
    <h2>{disputes ? 'Make room for a fair outcome.' : 'Platform settings, thoughtfully.'}</h2>
    <p>{disputes
      ? 'Open the protected disputes and support workspace to review live cases, evidence and server-validated outcomes.'
      : 'Open the protected platform tools to manage current configuration, categories, feature flags, integrations and audit history.'}</p>
    <div className="p1-policy-note"><ShieldCheck size={24} aria-hidden="true" /><div>
      <h3>{disputes ? 'Payment decisions stay verified.' : 'Product rules stay protected.'}</h3>
      <p>{disputes
        ? 'A case decision does not itself create a refund or transfer. Refunds and payment changes require their authorized, verified operations.'
        : 'Availability caps, booked dates, authorization, payment verification and data integrity remain enforced by the existing services.'}</p>
    </div></div>
    <Button onClick={() => onOpenTools(disputes ? 'disputes' : 'settings')}>Open {disputes ? 'dispute' : 'platform'} tools <ArrowRight size={16} aria-hidden="true" /></Button>
  </section>;
}

export function PreviewAdmin({ section }: { section?: string }) {
  const { access, loading: accessLoading, error: accessError, retry: retryAccess } = useAdminAccess();
  const [active, setActive] = useState<PreviewSection>(() => normalizedSection(section) ?? 'Overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewRetry, setOverviewRetry] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolSection, setToolSection] = useState(section ?? 'overview');
  const availableTabs = useMemo(() => access ? tabs.filter(tab => tab.allowed(access)).map(tab => tab.name) : [], [access]);
  useEffect(() => {
    const requested = normalizedSection(section);
    if (requested) setActive(requested);
    if (section && !tabs.some(item => item.name.toLowerCase() === section.toLowerCase())) {
      setToolSection(section); setToolsOpen(true);
    }
  }, [section]);
  const tab = availableTabs.includes(active) ? active : availableTabs[0];

  useEffect(() => {
    if (!access?.permissions.includes('analytics.view') || (tab !== 'Overview' && tab !== 'Reporting')) return;
    let current = true;
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 30);
    setOverviewLoading(true); setOverviewError(null);
    void fetchOverview(from, to).then(value => { if (current) setOverview(value); })
      .catch(reason => { if (current) setOverviewError(failure(reason)); })
      .finally(() => { if (current) setOverviewLoading(false); });
    return () => { current = false; };
  }, [access, tab, overviewRetry]);

  function openTools(sectionName = 'overview') { setToolSection(sectionName); setToolsOpen(true); }

  if (accessLoading) return <main className="p1-work-page"><PageHead title="Keep the good plans running." /><p role="status" aria-busy="true">Verifying administrator access…</p></main>;
  if (accessError) return <main className="p1-work-page"><PageHead title="Keep the good plans running." /><ErrorNote>{accessError}</ErrorNote><Button variant="secondary" onClick={retryAccess}>Retry access check</Button></main>;
  if (!access) return <main className="p1-work-page"><PageHead title="Keep the good plans running." description="Administrator access is required to review live marketplace activity." /><Empty title="Administrator access required." body="Your account does not have permission to open this workspace." /></main>;
  if (!availableTabs.length) return <main className="p1-work-page"><PageHead title="Platform settings, thoughtfully." /><Empty title="No administrator permissions." body="Ask a super administrator to grant access to the relevant tools." /></main>;

  const descriptions: Record<PreviewSection, string> = {
    Overview: 'Review live marketplace activity using protected administrator reporting.',
    Moderation: 'Review real listings and make publication decisions checked by the server.',
    Members: 'Search account records and review permitted member access actions.',
    Disputes: 'Review live disputes and support cases with their authorized case tools.',
    Reporting: 'Explore current marketplace, booking and financial reports.',
    Settings: 'Open platform configuration and governance tools.',
  };
  return <AdminLayout section={tab} title={tab === 'Reporting' ? 'A clear view of the marketplace.' : undefined} description={descriptions[tab]} action={<Button variant="secondary" onClick={() => openTools()}>Open full admin tools</Button>}
    sections={availableTabs.map(name => <a key={name} href={href('admin', name.toLowerCase())} aria-current={tab === name ? 'page' : undefined}>{name}</a>)}>
    {(tab === 'Overview' || tab === 'Reporting') && access.permissions.includes('analytics.view') && <OverviewContent overview={overview} loading={overviewLoading} error={overviewError}
      retry={() => setOverviewRetry(value => value + 1)} reporting={tab === 'Reporting'} onOpenTools={() => openTools(tab === 'Reporting' ? 'bookings' : 'audit')} />}
    {tab === 'Reporting' && !access.permissions.includes('analytics.view') && <Button onClick={() => openTools('bookings')}>Open reporting tools</Button>}
    {tab === 'Moderation' && (access.permissions.includes('listings.moderate') ? <ModerationContent onOpenTools={() => openTools('listings')} /> : <Button onClick={() => openTools('reviews')}>Open review moderation</Button>)}
    {tab === 'Members' && (access.permissions.includes('users.manage') ? <MembersContent onOpenTools={() => openTools('users')} /> : <Button onClick={() => openTools('investigations')}>Open customer investigations</Button>)}
    {(tab === 'Disputes' || tab === 'Settings') && <HandoffSection section={tab} onOpenTools={openTools} />}
    <Modal open={toolsOpen} onClose={() => setToolsOpen(false)} title="Administrator tools" description="Live, permission-checked platform operations." wide>
      {toolsOpen && <AdminPage section={toolSection} />}
    </Modal>
  </AdminLayout>;
}
