import type { Notice } from './state';

export const previewNotificationCategories = [
  { key: 'bookings', label: 'Bookings', description: 'Reservations, pickup, returns and cancellations', mandatory: true },
  { key: 'requests', label: 'Requests', description: 'Nearby item requests and matching rentals', mandatory: false },
  { key: 'listings', label: 'Listings', description: 'Listing reviews, publication and availability', mandatory: false },
  { key: 'bidding', label: 'Offers & bids', description: 'Bid activity and auction updates', mandatory: false },
  { key: 'payments', label: 'Payments', description: 'Payments, refunds and payouts', mandatory: true },
  { key: 'messages', label: 'Messages', description: 'New conversations and replies', mandatory: false },
  { key: 'safety', label: 'Safety & support', description: 'Disputes, account security and support cases', mandatory: true },
  { key: 'promotions', label: 'Promotions', description: 'Optional offers and community news', mandatory: false },
] as const;
export type PreviewNotificationCategory = typeof previewNotificationCategories[number]['key'];

export function noticeCategory(notice: Pick<Notice, 'to' | 'category'>): PreviewNotificationCategory {
  if (notice.category) return notice.category;
  switch (notice.to) {
    case 'auction': case 'bidding': return 'bidding';
    case 'requests': return 'requests';
    case 'messages': return 'messages';
    case 'listings': case 'listing': case 'create': return 'listings';
    case 'payouts': return 'payments';
    case 'profile': case 'admin': return 'safety';
    case 'home': case 'search': case 'favorites': case 'states': case 'notifications': return 'promotions';
    default: return 'bookings';
  }
}

export function mandatoryNotice(notice: Pick<Notice, 'to' | 'category' | 'mandatory'>): boolean {
  return notice.mandatory === true || previewNotificationCategories.some(category => category.key === noticeCategory(notice) && category.mandatory);
}
