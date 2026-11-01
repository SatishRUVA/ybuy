import type { ListingAuction } from '@/lib/listing-auctions';

export function canPlacePreviewBid(auction: ListingAuction, now: number): boolean {
  return auction.status === 'open' && auction.my_bid_count < 3 && !!auction.ends_at && Date.parse(auction.ends_at) > now;
}

export function canSelectPreviewWinner(auction: ListingAuction, now: number): boolean {
  if (!auction.is_owner) return false;
  if (auction.status === 'open') return !!auction.ends_at && Date.parse(auction.ends_at) > now;
  return auction.status === 'owner_selection' && !!auction.selection_deadline && Date.parse(auction.selection_deadline) > now;
}
