import type { ListingAuction } from '@/lib/listing-auctions';

export function canPlacePreviewBid(auction: ListingAuction, now: number): boolean {
  return auction.status === 'open' && auction.my_bid_count < 3 && !!auction.ends_at && Date.parse(auction.ends_at) > now;
}

export function canSelectPreviewWinner(auction: ListingAuction, now: number): boolean {
  return auction.is_owner && (
    (auction.status === 'open' && !!auction.ends_at && Date.parse(auction.ends_at) > now)
    || (auction.status === 'owner_selection' && !!auction.selection_deadline && Date.parse(auction.selection_deadline) > now)
  );
}
