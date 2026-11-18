export { useAdminAccess, type AdminAccess, type AdminPermission } from '@/lib/admin-access';
import type { AdminPermission } from '@/lib/admin-access';
import { supabase } from '@/lib/supabase';
import type { FeatureFlag } from '@/lib/feature-flag-store';
import { signListingImages } from '@/lib/listings';
import type { ListingFlowResult } from '@/lib/listing-flow';

export interface Paged<T> { total: number; rows: T[] }

export interface AuctionDecisionRow {
  id: string; listing_id: string; listing_title: string; owner_id: string; owner_name: string; customer_id: string;
  deadline_at: string; detected_at: string; eligible_bid_count: number; owner_missed_decision_count: number;
  rating_eligible: boolean; exclusion_reason: string | null; exclusion_detail: string | null;
}
export const listAuctionDecisions = (limit: number, offset: number, filters: { search?: string; ownerId?: string } = {}) =>
  rpc<Paged<AuctionDecisionRow>>('admin_search_auction_decisions', {
    p_limit: limit, p_offset: offset, p_search: filters.search ?? null, p_owner_id: filters.ownerId ?? null,
  });

export interface CheckoutPaymentException {
  id: string;booking_id: string;payment_intent_id: string;amount: number;currency: string;
  reason: string;status: string;created_at: string;
}
export const listCheckoutExceptions = (limit: number,offset: number) =>
  rpc<Paged<CheckoutPaymentException>>('admin_list_checkout_exceptions',{ p_limit: limit,p_offset: offset });

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface Overview {
  period: { from: string; to: string };
  users_total: number;
  users_new: number;
  listings_published: number;
  listings_suspended: number;
  bookings_by_status: Record<string, number>;
  gross_rental: number;
  platform_fees: number;
  refunds: number;
  deposit_liability: number;
  payables_outstanding: number;
  recent_actions: AuditRow[];
}
export const fetchOverview = (from: Date, to: Date) =>
  rpc<Overview>('admin_overview', { p_from: from.toISOString(), p_to: to.toISOString() });

export interface PageArgs { search?: string; status?: string; limit: number; offset: number }

export interface AdminUserRow {
  id: string; full_name: string; email: string; phone: string | null; created_at: string;
  customer_id?: string;
  missed_decision_count?: number; last_missed_decision_at?: string | null;
  restricted_reason: string | null; restricted_at: string | null; listing_count: number; is_admin: boolean;
}
export const listUsers = (a: PageArgs) =>
  rpc<Paged<AdminUserRow>>('admin_list_users', { p_search: a.search ?? null, p_limit: a.limit, p_offset: a.offset });
export const setUserRestriction = (userId: string, restricted: boolean, reason: string) =>
  rpc<{ ok: boolean; listings_suspended: number }>('admin_set_user_restriction', { p_user_id: userId, p_restricted: restricted, p_reason: reason });

export interface CustomerInvestigationRow {
  customer_id: string;
  country_code: string | null;
  state_region_code: string | null;
  location_updated_at: string | null;
  result_status: 'found' | 'invalid' | 'unknown';
  event_count: number;
  failed_payments: number;
  cancellations: number;
  unresolved_disputes: number;
  events: { kind: string; record_id: string; created_at: string; status: string;
    detail: { booking_id?: string; amount?: number; currency?: string; role?: string; category?: string; provider_status?: string } }[];
}
export interface InvestigationArgs {
  identifiers: string[]; from: string; to: string; reason: string;
  country?: string | null; region?: string | null; groupBy?: 'input' | 'country' | 'region';
}
export const investigateCustomers = (args: InvestigationArgs, limit: number, offset: number) =>
  rpc<Paged<CustomerInvestigationRow>>('admin_investigate_customers_geography', {
    p_customer_ids: args.identifiers, p_from: args.from, p_to: args.to, p_reason: args.reason,
    p_limit: limit, p_offset: offset, p_country_code: args.country ?? null,
    p_region_code: args.region ?? null, p_group_by: args.groupBy ?? 'input',
  });

export interface AdminListingRow {
  id: string; title: string; status: string; price_per_day: number; deposit: number; created_at: string;
  owner_id: string; owner_name: string; owner_email: string; category: string | null; open_flags: number;
}
export const listListings = (a: PageArgs) =>
  rpc<Paged<AdminListingRow>>('admin_list_listings', { p_search: a.search ?? null, p_status: a.status ?? null, p_limit: a.limit, p_offset: a.offset });
export const setListingSuspension = (listingId: string, suspend: boolean, reason: string) =>
  rpc<{ ok: boolean }>('admin_set_listing_suspension', { p_listing_id: listingId, p_suspend: suspend, p_reason: reason });

export interface ListingPublicationReview {
  id: string; revision: number; title: string; description: string | null;
  estimated_value: number; deposit: number; price_per_day: number; available_quantity: number;
  availability_start: string; availability_end: string; delivery_fee: number;
  images: { url: string; sort_order: number }[];
  blocking_flags: { type: string; reason: string }[];
}
export async function getListingPublicationReview(listingId: string): Promise<ListingPublicationReview> {
  const review = await rpc<ListingPublicationReview>('admin_get_listing_publication_review', { p_listing_id: listingId });
  return { ...review, images: await signListingImages(review.images) };
}
export const approveListingPublication = (listingId: string, revision: number, reason: string) =>
  rpc<ListingFlowResult>('admin_approve_listing_publication', { p_listing_id: listingId, p_revision: revision, p_reason: reason });

export interface AdminBookingRow {
  id: string; status: string; start_date: string; end_date: string; subtotal: number; service_fee_amount: number;
  deposit: number; total: number; created_at: string; listing_title: string; renter_name: string; renter_email: string;
  owner_name: string; owner_email: string; payment_status: string | null;
}
export const listBookings = (a: PageArgs) =>
  rpc<Paged<AdminBookingRow>>('admin_list_bookings', { p_search: a.search ?? null, p_status: a.status ?? null, p_limit: a.limit, p_offset: a.offset });

export interface AdminPaymentRow {
  id: string; booking_id: string; amount: number; currency: string; status: string;
  stripe_payment_intent_id: string | null; created_at: string; renter_email: string; listing_title: string;
}
export const listPayments = (a: PageArgs) =>
  rpc<Paged<AdminPaymentRow>>('admin_list_payments', { p_status: a.status ?? null, p_limit: a.limit, p_offset: a.offset });

export interface AdminPayoutRow {
  id: string; booking_id: string; amount: number; status: string; paid_at: string | null; notes: string | null;
  created_at: string; owner_name: string; owner_email: string;
  source: 'legacy_manual' | 'stripe_connect'; provider_ref: string | null;
  deposit_amount: number | null; refund_status: string | null;
}
export const listPayouts = (a: PageArgs) =>
  rpc<Paged<AdminPayoutRow>>('admin_list_payouts', { p_status: a.status ?? null, p_limit: a.limit, p_offset: a.offset });

export interface AdminReviewRow {
  id: string; rating: number; body: string | null; created_at: string; booking_id: string;
  reviewer_name: string; reviewee_name: string;
}
export const listReviews = (a: PageArgs) =>
  rpc<Paged<AdminReviewRow>>('admin_list_reviews', { p_search: a.search ?? null, p_limit: a.limit, p_offset: a.offset });
export const removeReview = (id: string, reason: string) =>
  rpc<{ ok: boolean }>('admin_remove_review', { p_review_id: id, p_reason: reason });

export interface AdminCategory { id: string; name: string; icon: string | null; active: boolean; sort_order: number }
export const listCategories = () => rpc<AdminCategory[]>('admin_list_categories');
export const upsertCategory = (c: { id: string | null; name: string; icon: string | null; active: boolean; sort_order: number }, reason: string) =>
  rpc<{ ok: boolean }>('admin_upsert_category', { p_id: c.id, p_name: c.name, p_icon: c.icon, p_active: c.active, p_sort_order: c.sort_order, p_reason: reason });
export const saveDepositRule = (categoryId: string, percentage: number, minimum: number, maximum: number, reason: string) =>
  rpc<void>('admin_save_deposit_rule', { p_category_id: categoryId,p_pct: percentage/100,p_min: minimum,p_max: maximum,p_reason: reason });
export const getAgreementTerms = () => rpc<{version:number;terms:string;approval_reference:string;created_at:string}|null>('admin_get_agreement_terms');
export const publishAgreementTerms = (terms:string,approvalReference:string,reason:string) =>
  rpc<number>('admin_publish_agreement_terms',{p_terms:terms,p_approval_reference:approvalReference,p_reason:reason});
export const publishTestDummyAgreementTerms = (reason:string) =>
  rpc<number>('admin_publish_test_dummy_terms',{p_reason:reason});

export interface AdminSetting {
  key: string; value: number | boolean | string[]; value_type: 'number' | 'integer' | 'boolean' | 'country_codes';
  min_value: number | null; max_value: number | null; description: string; is_public: boolean; updated_at: string;
}
export const listSettings = () => rpc<AdminSetting[]>('admin_list_settings');
export async function listCountryOptions(): Promise<{ code: string; name: string }[]> {
  const { data, error } = await supabase.from('reference_countries').select('code,name').order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
}
export const updateSetting = (key: string, value: number | boolean | string[], reason: string) =>
  rpc<{ ok: boolean; error?: string }>('admin_update_setting', { p_key: key, p_value: value, p_reason: reason });

export type { FeatureFlag } from '@/lib/feature-flag-store';
export async function listFlags(): Promise<FeatureFlag[]> {
  const { data, error } = await supabase.from('feature_flags').select('key, enabled, description, updated_at').order('key');
  if (error) throw new Error(error.message);
  return data as FeatureFlag[];
}
export const setFeatureFlag = (key: string, enabled: boolean, reason: string) =>
  rpc<{ ok: boolean }>('admin_set_feature_flag', { p_key: key, p_enabled: enabled, p_reason: reason });

export interface AdminUserAccess {
  user_id: string; full_name: string; email: string; role: 'super_admin' | 'admin';
  permissions: AdminPermission[]; active: boolean; created_at: string;
}
export const listAdmins = () => rpc<AdminUserAccess[]>('admin_list_admins');
export const upsertAdmin = (a: { email: string; role: 'super_admin' | 'admin'; permissions: AdminPermission[]; active: boolean }, reason: string) =>
  rpc<{ ok: boolean }>('admin_upsert_admin', { p_email: a.email, p_role: a.role, p_permissions: a.permissions, p_active: a.active, p_reason: reason });

export interface AuditRow {
  id: string; actor_id?: string; actor_email: string | null; action: string; entity_type: string; entity_id: string | null;
  old_value?: unknown; new_value?: unknown; reason?: string | null; outcome: 'success' | 'failed'; created_at: string;
}
export const listAudit = (a: { entityType?: string; action?: string; limit: number; offset: number }) =>
  rpc<Paged<AuditRow>>('admin_list_audit', { p_entity_type: a.entityType ?? null, p_action: a.action ?? null, p_limit: a.limit, p_offset: a.offset });

export interface SystemHealth {
  checked_at: string;
  database: { ok: boolean; latency_ms: number };
  integrations: { name: string; configured: boolean }[];
}
export async function fetchSystemHealth(): Promise<SystemHealth> {
  const { data, error } = await supabase.functions.invoke('admin-system-health');
  if (error) throw new Error('System health is unavailable. Is the admin-system-health function deployed?');
  return data as SystemHealth;
}
