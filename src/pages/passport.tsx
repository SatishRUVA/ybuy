import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { fetchListingById, toUiListing } from '@/lib/listings';
import { Alert, Button, Badge, EmptyState } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { ListingPhoto } from '@/components/listing-card';
import { WorkspaceHeader } from '@/components/account-workspace';
import { ArrowLeft, Check, FileText, UserRound } from 'lucide-react';
import type { Listing } from '@/data';

export function ItemPassportPage({ id }: { id: string }) {
  const { back, navigate } = useRouter();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setListing(null);
    setError(null);
    fetchListingById(id).then(row => {
      if (!active) return;
      const item = row ? toUiListing(row) : null;
      setListing(item && row ? { ...item, owner: { ...item.owner, avatar: row.owner?.avatar_url ?? '' } } : null);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load this item.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, attempt]);

  return <div className="p1-container p1-page p1-account">
    <button type="button" onClick={back} className="p1-back"><ArrowLeft size={16} aria-hidden="true" /> Back</button>
    <WorkspaceHeader title="Know the gear before you go." description="The owner's published item details. A listing is not proof of ownership, condition or insurance coverage." />
    {error && <Alert tone="error">{error}<Button variant="secondary" className="mt-3" onClick={() => setAttempt(value => value + 1)}>Try again</Button></Alert>}
    {loading ? <div aria-busy="true" aria-label="Loading item details"><Skeleton className="h-64 w-full" /></div> : !error && !listing ? <EmptyState className="p1-empty account-empty" icon={<FileText size={24} />} title="Listing not found" description="This item may no longer be available." actionLabel="Browse rentals" onAction={() => navigate({ name: 'search' })} /> : listing && <>
      <div className="account-detail-layout">
        <section className="p1-panel account-panel" aria-label="Item passport">
          <div className="p1-section-head"><div><Badge tone="accent" icon={<FileText size={14} aria-hidden="true" />}>Item passport</Badge><h2 className="mt-4">{listing.title}</h2></div></div>
          <dl className="account-fact-grid">
            <div><dt>Listing reference</dt><dd>{listing.id}</dd></div>
            <div><dt>Owner-declared value</dt><dd>${listing.declaredValue.toLocaleString()}</dd></div>
            <div><dt>Condition (owner-declared)</dt><dd>{listing.condition || 'Not provided'}</dd></div>
            <div><dt>Brand / model</dt><dd>{[listing.brand, listing.model].filter(Boolean).join(' · ') || 'Not provided'}</dd></div>
            <div><dt>Listing status</dt><dd>{listing.listingStatus?.replace(/_/g, ' ') || 'Unavailable'}</dd></div>
            <div><dt>Pickup area</dt><dd>{listing.pickup || 'Arrange after approval'}</dd></div>
          </dl>
          <p className="p1-muted">Serial numbers, verified ownership, damage records and private rental history are not available in this passport.</p>
          <section className="mt-8"><h3>Included with the item</h3>
            {listing.whatsIncluded.length ? <ul className="p1-included">{listing.whatsIncluded.map((item, index) => <li key={`${item}-${index}`}><Check size={16} aria-hidden="true" />{item}</li>)}</ul> : <p className="p1-muted">The owner has not listed included accessories.</p>}
            <p className="p1-muted">Owner-declared contents, not a saved pickup or return checklist.</p>
          </section>
          {listing.description && <section className="mt-8"><h3>About this item</h3><p className="mt-3 whitespace-pre-wrap">{listing.description}</p></section>}
        </section>
        <aside className="p1-panel account-context" aria-label="Listing owner">
          <div className="account-context-photo"><ListingPhoto src={listing.images[0]} alt={listing.title} /></div>
          <h2>From {listing.owner.name}</h2>
          {listing.owner.avatar ? <img className="p1-avatar mt-4" src={listing.owner.avatar} alt="" /> : <span className="p1-avatar account-chat-avatar mt-4" aria-hidden="true"><UserRound size={20} /></span>}
          <p>Confirm the item and its included accessories together at pickup.</p>
          <Button variant="secondary" onClick={() => navigate({ name: 'listing', id: listing.id })}>Back to listing</Button>
        </aside>
      </div>
    </>}
  </div>;
}
