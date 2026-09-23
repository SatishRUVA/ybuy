import { useState, useEffect } from 'react';
import { useRouter } from '@/router';
import { auctions, type Bid } from '@/data';
import { Rating, VerifiedBadge, ProtectionBadge } from '@/components/trust';
import { Gavel, Clock, ArrowLeft, MapPin, Eye, Trophy, AlertTriangle, CheckCircle2 } from 'lucide-react';

export function BiddingPage() {
  const { navigate } = useRouter();
  const [liveBids, setLiveBids] = useState(() => auctions.map((a) => a.currentBid));

  // Simulate live bidding
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveBids((prev) => {
        const idx = Math.floor(Math.random() * auctions.length);
        const next = [...prev];
        next[idx] = next[idx] + Math.floor(Math.random() * 5 + 2);
        return next;
      });
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-card-lg bg-accent-soft flex items-center justify-center">
            <Gavel size={22} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-main font-display">Live bidding</h1>
            <p className="text-sec text-sm">Bid on rental periods for high-demand items</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6 px-4 py-2.5 rounded-card-lg bg-success-soft border border-app">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse-soft" />
          <span className="text-sm text-success font-medium">Live · {auctions.length} active auctions</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 stagger">
          {auctions.map((auction, idx) => {
            const liveBid = liveBids[idx];
            const isEndingSoon = auction.endsInHours <= 3;
            return (
              <div
                key={auction.id}
                onClick={() => navigate({ name: 'auction', id: auction.id })}
                className="group p-4 rounded-card-xl bg-card border border-app shadow-card card-hover cursor-pointer animate-fade-up"
              >
                <div className="relative aspect-[5/3] rounded-card-lg overflow-hidden mb-3">
                  <img src={auction.image} alt={auction.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  <div className="absolute top-2 left-2 flex gap-1.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent text-accent-text flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse-soft" /> LIVE
                    </span>
                    {isEndingSoon && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-error text-white">
                        Ending soon
                      </span>
                    )}
                  </div>
                  <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-card/80 backdrop-blur-sm text-[10px] text-sec font-medium">
                    <Eye size={11} /> {auction.watchers}
                  </div>
                </div>

                <h3 className="font-semibold text-sm text-main line-clamp-1">{auction.title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <Rating value={auction.rating} size="sm" />
                  {auction.verified && <VerifiedBadge size="xs" />}
                </div>

                <div className="flex items-center justify-between mt-3">
                  <div>
                    <p className="text-xs text-muted">Current bid</p>
                    <p className="text-xl font-bold text-accent">${liveBid}<span className="text-xs text-sec font-normal">/{auction.rentalDays}d</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted flex items-center gap-1 justify-end">
                      <Clock size={11} className={isEndingSoon ? 'text-error' : ''} /> {auction.endsIn}
                    </p>
                    <p className="text-xs text-sec mt-1">{auction.bids.length} bids</p>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-app flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs text-sec"><MapPin size={12} /> {auction.distance} mi</span>
                  {auction.protectionEligible && <ProtectionBadge size="sm" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AuctionPage({ id }: { id: string }) {
  const { back } = useRouter();
  const auction = auctions.find((a) => a.id === id);
  const [bids, setBids] = useState<Bid[]>(auction?.bids ?? []);
  const [currentBid, setCurrentBid] = useState(auction?.currentBid ?? 0);
  const [bidAmount, setBidAmount] = useState((auction?.currentBid ?? 0) + 5);
  const [showBidPlaced, setShowBidPlaced] = useState(false);

  if (!auction) return <div className="p-8 text-center text-sec">Auction not found.</div>;

  const placeBid = () => {
    if (bidAmount <= currentBid) return;
    const newBid: Bid = {
      id: `b${Date.now()}`,
      bidder: 'You',
      avatar: 'https://images.pexels.com/photos/1462630/pexels-photo-1462630.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
      amount: bidAmount,
      time: 'Just now',
      isLeading: true,
    };
    setBids((b) => b.map((bid) => ({ ...bid, isLeading: false })).concat(newBid));
    setCurrentBid(bidAmount);
    setBidAmount(bidAmount + 5);
    setShowBidPlaced(true);
    setTimeout(() => setShowBidPlaced(false), 2000);
  };

  const isEndingSoon = auction.endsInHours <= 3;

  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <button onClick={back} className="flex items-center gap-1.5 text-sm text-sec mb-4 hover:text-main transition-colors">
          <ArrowLeft size={18} /> Back to auctions
        </button>

        <div className="grid sm:grid-cols-2 gap-6">
          {/* Left: image + info */}
          <div>
            <div className="relative aspect-[4/3] rounded-card-xl overflow-hidden mb-4">
              <img src={auction.image} alt={auction.title} className="w-full h-full object-cover" />
              <div className="absolute top-3 left-3 flex gap-2">
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-accent text-accent-text flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse-soft" /> LIVE
                </span>
              </div>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-main font-display">{auction.title}</h1>
            <div className="flex items-center gap-2 mt-2">
              <Rating value={auction.rating} size="md" />
              {auction.verified && <VerifiedBadge />}
            </div>
            <div className="flex items-center gap-3 mt-2 text-sm text-sec">
              <span className="flex items-center gap-1"><MapPin size={14} /> {auction.distance} mi</span>
              <span className="flex items-center gap-1"><Eye size={14} /> {auction.watchers} watching</span>
            </div>
            <p className="text-sm text-sec mt-3 leading-relaxed">
              {auction.rentalDays}-day rental period. Highest bidder wins the rental slot. Security hold and rental protection apply.
            </p>
          </div>

          {/* Right: bidding panel */}
          <div>
            <div className="p-5 rounded-card-xl bg-card border border-app mb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted uppercase tracking-wide">Current bid</span>
                <span className={`flex items-center gap-1 text-xs font-medium ${isEndingSoon ? 'text-error' : 'text-sec'}`}>
                  <Clock size={12} className={isEndingSoon ? 'text-error' : ''} /> {auction.endsIn}
                </span>
              </div>
              <p className="text-3xl font-bold text-accent mb-1">${currentBid}</p>
              <p className="text-xs text-sec">Starting at ${auction.startingPrice} · {bids.length} bids</p>

              <div className="mt-4 pt-4 border-t border-app">
                <label className="text-xs font-semibold text-sec uppercase tracking-wide">Your bid</label>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 flex items-center gap-1 px-3 py-2.5 rounded-card-lg border border-app bg-card">
                    <span className="text-muted">$</span>
                    <input
                      type="number"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(Number(e.target.value))}
                      className="flex-1 bg-transparent text-sm text-main outline-none"
                    />
                  </div>
                  <button
                    onClick={placeBid}
                    disabled={bidAmount <= currentBid}
                    className="px-5 py-2.5 rounded-card-lg bg-accent text-accent-text font-semibold text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
                  >
                    Bid
                  </button>
                </div>
                {bidAmount <= currentBid && (
                  <p className="text-xs text-error mt-1.5 flex items-center gap-1">
                    <AlertTriangle size={12} /> Bid must be higher than ${currentBid}
                  </p>
                )}
                {showBidPlaced && (
                  <p className="text-xs text-success mt-1.5 flex items-center gap-1 animate-fade-in">
                    <CheckCircle2 size={12} /> Bid placed! You are now the leading bidder.
                  </p>
                )}
              </div>
            </div>

            {/* Bid history */}
            <div className="p-5 rounded-card-xl bg-card border border-app">
              <h3 className="font-semibold text-main mb-3 flex items-center gap-2">
                <Trophy size={16} className="text-accent" /> Bid history
              </h3>
              <div className="space-y-2">
                {[...bids].reverse().map((bid) => (
                  <div key={bid.id} className={`flex items-center gap-3 p-2.5 rounded-card-lg ${bid.isLeading ? 'bg-accent-soft border border-accent' : 'bg-subtle border border-app'}`}>
                    <img src={bid.avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-main">{bid.bidder === 'You' ? 'You' : bid.bidder}</p>
                      <p className="text-xs text-muted">{bid.time}</p>
                    </div>
                    <span className={`text-sm font-bold ${bid.isLeading ? 'text-accent' : 'text-sec'}`}>${bid.amount}</span>
                    {bid.isLeading && <span className="text-xs text-accent font-medium">Leading</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Owner info */}
        <div className="mt-6 p-4 rounded-card-xl bg-card border border-app flex items-center gap-3">
          <img src={auction.ownerAvatar} alt="" className="w-12 h-12 rounded-full object-cover" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-main">{auction.owner}</span>
              <VerifiedBadge size="xs" />
            </div>
            <p className="text-xs text-sec">{auction.category} · {auction.distance} mi away</p>
          </div>
          {auction.protectionEligible && <ProtectionBadge size="md" />}
        </div>
      </div>
    </div>
  );
}
