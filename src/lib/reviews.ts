import { supabase } from '@/lib/supabase';
import type { Review } from '@/data';

interface DbReviewRow {
  id: string;
  booking_id: string;
  rating: number;
  body: string | null;
  created_at: string;
  reviewer: { id: string; full_name: string; avatar_url: string | null } | null;
}

const REVIEW_SELECT = 'id, booking_id, rating, body, created_at, reviewer:profiles!reviewer_id(id, full_name, avatar_url)';

export interface OwnerReviewsResult {
  reviews: Review[];
  rating: number;
  reviewCount: number;
}

/** Fetches all reviews left for a given user (as the reviewee), newest first, plus the average rating. */
export async function fetchReviewsForUser(userId: string): Promise<OwnerReviewsResult> {
  const { data, error } = await supabase
    .from('reviews')
    .select(REVIEW_SELECT)
    .eq('reviewee_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as DbReviewRow[];
  const reviews: Review[] = rows.map((r) => ({
    id: r.id,
    author: r.reviewer?.full_name ?? 'Renter',
    avatar: r.reviewer?.avatar_url ?? '',
    rating: r.rating,
    date: new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }),
    text: r.body ?? '',
  }));
  const rating = reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;
  return { reviews, rating, reviewCount: reviews.length };
}

/** Booking ids (among the given set) that the current user has already reviewed — used to hide the "leave a review" button. */
export async function fetchReviewedBookingIds(reviewerId: string, bookingIds: string[]): Promise<Set<string>> {
  if (bookingIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('reviews')
    .select('booking_id')
    .eq('reviewer_id', reviewerId)
    .in('booking_id', bookingIds);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.booking_id as string));
}

export interface OwnerRatingStats {
  rating: number;
  count: number;
}

/**
 * Aggregates each owner's rating + review count from the public `reviews` table (reviewee = owner).
 * Owner-level because `bookings` is participant-only under RLS, so per-listing rental counts can't
 * be read by a non-participant — the owner's completed-rental reviews are the readable signal.
 */
export async function fetchOwnerRatings(ownerIds: string[]): Promise<Map<string, OwnerRatingStats>> {
  const result = new Map<string, OwnerRatingStats>();
  const ids = [...new Set(ownerIds)].filter(Boolean);
  if (ids.length === 0) return result;

  const { data, error } = await supabase
    .from('reviews')
    .select('reviewee_id, rating')
    .in('reviewee_id', ids);
  if (error) throw error;

  const sums = new Map<string, { total: number; count: number }>();
  for (const row of (data ?? []) as { reviewee_id: string; rating: number }[]) {
    const acc = sums.get(row.reviewee_id) ?? { total: 0, count: 0 };
    acc.total += row.rating;
    acc.count += 1;
    sums.set(row.reviewee_id, acc);
  }
  for (const [ownerId, { total, count }] of sums) {
    result.set(ownerId, { rating: count > 0 ? total / count : 0, count });
  }
  return result;
}

export async function createReview(params: {
  bookingId: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  body: string;
}): Promise<void> {
  const { error } = await supabase.from('reviews').insert({
    booking_id: params.bookingId,
    reviewer_id: params.reviewerId,
    reviewee_id: params.revieweeId,
    rating: params.rating,
    body: params.body.trim() || null,
  });
  if (error) throw error;
}
