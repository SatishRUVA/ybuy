import { useState, type FormEvent, type ReactNode } from 'react';
import { auctions } from '@/data';
import { useRouter } from '@/router';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { Alert, Button, EmptyState } from '@/components/ui';
import { fieldClass } from '@/components/form-classes';
import { Gavel } from 'lucide-react';

function MockBiddingGate({ children }: { children: ReactNode }) {
  const { enabled, loading, error, reload } = useFeatureFlag('mock_bidding');
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <h1 className="text-2xl font-bold font-display text-main">Mock bidding</h1>
      {loading ? <p role="status">Checking demo availability...</p>
        : error ? <Alert tone="error" title="Could not check demo availability">
          <p>{error}</p><Button onClick={() => void reload()}>Try again</Button>
        </Alert>
          : !enabled ? <Alert tone="warning" title="Mock bidding is offline">
            The bidding demo is not available. A Super Admin can enable mock_bidding in Feature flags.
          </Alert>
            : <>
              <Alert tone="info" title="Demo only">
                All auctions and bids are simulated. No real bids, bookings or payments are created.
                Demo bids reset when you leave this page.
              </Alert>
              {children}
            </>}
    </div>
  );
}

export function BiddingPage() {
  const { navigate } = useRouter();
  return (
    <MockBiddingGate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {auctions.map((auction) => (
          <button
            key={auction.id}
            onClick={() => navigate({ name: 'auction', id: auction.id })}
            className="group text-left p-4 rounded-card-xl bg-card border border-app shadow-card card-hover"
          >
            <img src={auction.image} alt="" loading="lazy" className="aspect-[5/3] w-full object-cover rounded-card-lg mb-3" />
            <h2 className="font-semibold text-main">{auction.title}</h2>
            <p className="text-sm text-sec">{auction.rentalDays}-day demo rental</p>
            <p className="mt-3 font-bold text-accent">Current demo bid: ${auction.currentBid}</p>
            <span className="text-sm text-sec">View demo auction</span>
          </button>
        ))}
      </div>
    </MockBiddingGate>
  );
}

export function AuctionPage({ id }: { id: string }) {
  return <MockBiddingGate><DemoAuction key={id} id={id} /></MockBiddingGate>;
}

function DemoAuction({ id }: { id: string }) {
  const { navigate } = useRouter();
  const auction = auctions.find((row) => row.id === id);
  const [bids, setBids] = useState(() => auction?.bids ?? []);
  const [amount, setAmount] = useState(String((auction?.currentBid ?? 0) + 5));
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const currentBid = bids[bids.length - 1]?.amount ?? auction?.currentBid ?? 0;

  function placeBid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = Number(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || next <= currentBid || next > 1_000_000) {
      setError(`Enter a bid above $${currentBid} and no more than $1,000,000, with up to two decimal places.`);
      setPlaced(false);
      return;
    }
    setBids((previous) => [...previous.map((bid) => ({ ...bid, isLeading: false })), {
      id: crypto.randomUUID(), bidder: 'You (demo)', avatar: '', amount: next, time: 'Just now', isLeading: true,
    }]);
    setAmount(String(Math.min(next + 5, 1_000_000)));
    setError(null);
    setPlaced(true);
  }

  return (
    <div className="space-y-5">
      <Button variant="secondary" onClick={() => navigate({ name: 'bidding' })}>Back to demo auctions</Button>
      {!auction ? <EmptyState icon={<Gavel size={20} />} title="Demo auction not found" description="Choose an auction from the demo list." />
        : <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <img src={auction.image} alt="" className="aspect-[4/3] w-full object-cover rounded-card-xl mb-4" />
            <h2 className="text-xl font-bold text-main">{auction.title}</h2>
            <p className="text-sm text-sec">{auction.rentalDays}-day simulated rental. No real rental slot is reserved.</p>
          </div>
          <div className="space-y-4">
            <p className="text-lg font-bold text-accent" role="status">Current demo bid: ${currentBid}</p>
            <form onSubmit={placeBid} className="space-y-3">
              <label htmlFor="demo-bid" className="block text-sm font-semibold text-main">Your demo bid</label>
              <input id="demo-bid" type="number" step="0.01" max="1000000" required value={amount}
                onChange={(event) => setAmount(event.target.value)} className={fieldClass()}
                aria-invalid={Boolean(error)} aria-describedby={error ? 'demo-bid-error' : undefined} />
              {error && <p id="demo-bid-error" role="alert" className="text-sm text-error">{error}</p>}
              <Button type="submit">Place demo bid</Button>
            </form>
            {placed && <Alert tone="success">Demo bid placed. No money was charged.</Alert>}
            <h3 className="font-semibold text-main">Demo bid history</h3>
            <ul className="space-y-2 text-sm text-sec">
              {[...bids].reverse().map((bid) => (
                <li key={bid.id} className="flex justify-between gap-3">
                  <span>{bid.bidder}{bid.isLeading ? ' - Leading' : ''}</span><span>${bid.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>}
    </div>
  );
}
