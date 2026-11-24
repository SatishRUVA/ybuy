import type { ListingAuction, OwnerAuctionBid } from './listing-auctions';

export function deadlineLabel(status: ListingAuction['status']): string {
  if (status === 'scheduled') return 'Bidding opens';
  if (status === 'owner_selection') return 'Decision due';
  if (status === 'awaiting_payment') return 'Payment due';
  return 'Bidding closes';
}

export function winnerRental(
  auction: Pick<ListingAuction, 'start_date' | 'end_date' | 'date_flexible'>,
  bid: Pick<OwnerAuctionBid, 'start_date' | 'end_date' | 'daily_rate' | 'total_value'>,
): { start: string; end: string; subtotal: number } | null {
  const start = auction.date_flexible ? bid.start_date : auction.start_date;
  const end = auction.date_flexible ? bid.end_date : auction.end_date;
  if (!start || !end) return null;
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  if (!Number.isInteger(days) || days <= 0 || !Number.isFinite(bid.daily_rate)) return null;
  const subtotal = auction.date_flexible ? bid.total_value : Math.round(bid.daily_rate * days * 100) / 100;
  if (subtotal == null || !Number.isFinite(subtotal)) return null;
  return { start, end, subtotal };
}
