import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { listBookings, listListings, listUsers, type AdminAccess } from '@/admin/api';
import { Alert, Button } from '@/main-site/components/ui';
import { fieldClass } from '@/main-site/components/form-classes';
import { listCases } from '@/lib/operations';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/main-site/components/shadcn/dialog';

interface SearchResult {
  id: string;
  type: string;
  title: string;
  detail: string;
  section: string;
}

const SEARCH_LIMIT = 6;

async function searchRecords(query: string, access: AdminAccess): Promise<SearchResult[]> {
  const permissions = access.permissions;
  const searches: Promise<SearchResult[]>[] = [];

  if (permissions.includes('users.manage')) {
    searches.push(listUsers({ search: query, limit: SEARCH_LIMIT, offset: 0 }).then(({ rows }) => rows.map((user) => ({
      id: user.id, type: 'Customer', title: user.full_name, detail: `${user.email} · ${user.customer_id ?? 'Customer ID unavailable'}`, section: 'users',
    }))));
  }
  if (permissions.includes('listings.moderate')) {
    searches.push(listListings({ search: query, limit: SEARCH_LIMIT, offset: 0 }).then(({ rows }) => rows.map((listing) => ({
      id: listing.id, type: 'Listing', title: listing.title, detail: `${listing.owner_name} · ${listing.status}`, section: 'listings',
    }))));
  }
  if (permissions.includes('bookings.view')) {
    searches.push(listBookings({ search: query, limit: SEARCH_LIMIT, offset: 0 }).then(({ rows }) => rows.map((booking) => ({
      id: booking.id, type: 'Booking', title: booking.listing_title, detail: `${booking.renter_name} · ${booking.status} · ${booking.start_date} – ${booking.end_date}`, section: 'bookings',
    }))));
  }
  if (permissions.includes('disputes.manage')) {
    searches.push(listCases('dispute', query, 'all', 'all', true, SEARCH_LIMIT, 0).then(({ rows }) => rows.map((item) => ({
      id: item.id, type: 'Dispute', title: item.subject, detail: `${item.status} · ${item.category.replace(/_/g, ' ')}`, section: 'disputes',
    }))));
  }
  if (permissions.includes('support.manage')) {
    searches.push(listCases('support', query, 'all', 'all', true, SEARCH_LIMIT, 0).then(({ rows }) => rows.map((item) => ({
      id: item.id, type: 'Support', title: item.subject, detail: `${item.status} · ${item.category.replace(/_/g, ' ')}`, section: 'support',
    }))));
  }

  const groups = await Promise.all(searches);
  return groups.flat();
}

export function AdminGlobalSearch({ access, onSelect }: { access: AdminAccess; onSelect: (section: string, recordId?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (!open || normalized.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      searchRecords(normalized, access)
        .then((items) => { if (active) setResults(items); })
        .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : 'Search failed.');
        })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [access, open, query]);

  return (
    <>
      <Button variant="secondary" size="sm" icon={<Search size={15} />} onClick={() => setOpen(true)}
        aria-label="Search admin records" className="ml-auto">
        <span className="hidden sm:inline">Search records</span>
        <kbd className="ml-2 hidden rounded border border-app px-1.5 py-0.5 text-[10px] text-muted sm:inline">Ctrl K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Search admin records</DialogTitle>
          <DialogDescription>Search customers, listings, bookings, disputes, and support tickets you are permitted to view.</DialogDescription>
          <div className="relative mt-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Enter a name, email, title, or reference" aria-label="Search admin records"
              maxLength={100} className={fieldClass('pl-10')} />
          </div>
          <div className="mt-4 max-h-[55dvh] overflow-y-auto" aria-live="polite" aria-busy={loading}>
            {query.trim().length < 2 && <p className="py-6 text-center text-sm text-muted">Type at least two characters to search.</p>}
            {loading && <p className="py-6 text-center text-sm text-sec">Searching...</p>}
            {error && <Alert tone="error" title="Search could not be completed">{error}</Alert>}
            {!loading && !error && query.trim().length >= 2 && results.length === 0
              && <p className="py-6 text-center text-sm text-muted">No matching records.</p>}
            {!loading && results.length > 0 && <ul className="divide-y divide-[var(--border)]">
              {results.map((result) => (
                <li key={`${result.type}:${result.id}`}>
                  <button type="button" className="w-full rounded-card px-3 py-3 text-left hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    onClick={() => {
                      setOpen(false);
                      onSelect(result.section, ['Customer', 'Booking', 'Dispute', 'Support'].includes(result.type) ? result.id : undefined);
                    }}>
                    <span className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-main">{result.title}</span>
                        <span className="block truncate text-xs text-sec">{result.detail}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{result.type}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
