import { supabase } from '@/lib/supabase';
import { assertPlainText, InputValidationError } from '@/lib/text-safety';
import type { Review } from '@/data';

export const REVIEW_MAX_LENGTH = 2000;

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
  missedDecisionCount: number;
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
    text: r.body?.split('\u2014').join('-') ?? '',
  }));
  const stats = (await fetchOwnerRatings([userId])).get(userId);
  return { reviews, rating: stats?.rating ?? 0, reviewCount: reviews.length, missedDecisionCount: stats?.missedDecisionCount ?? 0 };
}

/** Booking ids (among the given set) that the current user has already reviewed - used to hide the "leave a review" button. */
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
  missedDecisionCount: number;
  ratingAdjustment: number;
}

/**
 * Aggregates each owner's rating + review count from the public `reviews` table (reviewee = owner).
 * Owner-level because `bookings` is participant-only under RLS, so per-listing rental counts can't
 * be read by a non-participant - the owner's completed-rental reviews are the readable signal.
 */
export async function fetchOwnerRatings(ownerIds: string[]): Promise<Map<string, OwnerRatingStats>> {
  const result = new Map<string, OwnerRatingStats>();
  const ids = [...new Set(ownerIds)].filter(Boolean);
  if (ids.length === 0) return result;

  const { data, error } = await supabase.rpc('get_owner_rating_stats', { p_owner_ids: ids });
  if (error) throw error;
  for (const row of (data ?? []) as {
    owner_id: string; rating: number; review_count: number; missed_decision_count: number; rating_adjustment: number;
  }[]) {
    result.set(row.owner_id, { rating: Number(row.rating), count: row.review_count,
      missedDecisionCount: row.missed_decision_count, ratingAdjustment: Number(row.rating_adjustment) });
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
  if (!Number.isInteger(params.rating) || params.rating < 1 || params.rating > 5) throw new InputValidationError('Choose a star rating from 1 to 5.');
  assertPlainText('Review', params.body.trim(), REVIEW_MAX_LENGTH);
  const { error } = await supabase.from('reviews').insert({
    booking_id: params.bookingId,
    reviewer_id: params.reviewerId,
    reviewee_id: params.revieweeId,
    rating: params.rating,
    body: params.body.trim() || null,
  });
  if (error) throw error;
}
