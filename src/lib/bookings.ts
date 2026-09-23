import { supabase } from '@/lib/supabase';

export type BookingStatus =
  | 'requested'
  | 'pending_payment'
  | 'confirmed'
  | 'active'
  | 'return_pending'
  | 'completed'
  | 'cancelled'
  | 'rejected';

interface DbBookingProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

interface DbBookingListing {
  id: string;
  title: string;
  listing_images: { url: string; sort_order: number }[];
}

export interface DbBookingRow {
  id: string;
  listing_id: string;
  renter_id: string;
  owner_id: string;
  start_date: string;
  end_date: string;
  quantity: number;
  status: BookingStatus;
  daily_rate: number;
  days: number;
  subtotal: number;
  service_fee_amount: number;
  deposit: number;
  total: number;
  created_at: string;
  listing: DbBookingListing;
  renter: DbBookingProfile;
  owner: DbBookingProfile;
}

const BOOKING_SELECT = `
  *,
  listing:listings(id, title, listing_images(url, sort_order)),
  renter:profiles!renter_id(id, full_name, avatar_url),
  owner:profiles!owner_id(id, full_name, avatar_url)
`;

export interface UiBooking {
  id: string;
  listingId: string;
  listingTitle: string;
  listingImage: string;
  counterpartName: string;
  counterpartAvatar: string | null;
  startDate: string;
  endDate: string;
  status: BookingStatus;
  quantity: number;
  dailyRate: number;
  days: number;
  subtotal: number;
  serviceFeeAmount: number;
  deposit: number;
  total: number;
  isOwner: boolean;
  counterpartId: string;
}

const PLACEHOLDER_IMAGE = 'https://images.pexels.com/photos/163069/box-cardboard-package-moving-163069.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop';

export function toUiBooking(row: DbBookingRow, currentUserId: string): UiBooking {
  const isOwner = row.owner.id === currentUserId;
  const counterpart = isOwner ? row.renter : row.owner;
  const sortedImages = [...(row.listing?.listing_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: row.listing?.title ?? 'Listing',
    listingImage: sortedImages[0]?.url ?? PLACEHOLDER_IMAGE,
    counterpartName: counterpart?.full_name ?? 'User',
    counterpartAvatar: counterpart?.avatar_url ?? null,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    quantity: row.quantity,
    dailyRate: row.daily_rate,
    days: row.days,
    subtotal: row.subtotal,
    serviceFeeAmount: row.service_fee_amount,
    deposit: row.deposit,
    total: row.total,
    isOwner,
    counterpartId: counterpart?.id ?? (isOwner ? row.renter_id : row.owner_id),
  };
}

export async function fetchBookingById(id: string, currentUserId: string): Promise<UiBooking | null> {
  const { data, error } = await supabase.from('bookings').select(BOOKING_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toUiBooking(data as unknown as DbBookingRow, currentUserId) : null;
}

export async function fetchBookingsAsRenter(currentUserId: string): Promise<UiBooking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(BOOKING_SELECT)
    .eq('renter_id', currentUserId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => toUiBooking(row as unknown as DbBookingRow, currentUserId));
}

export async function fetchBookingsAsOwner(currentUserId: string): Promise<UiBooking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(BOOKING_SELECT)
    .eq('owner_id', currentUserId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => toUiBooking(row as unknown as DbBookingRow, currentUserId));
}

async function callBookingRpc(fn: string, args: Record<string, unknown>): Promise<DbBookingRow> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as DbBookingRow;
}

export async function createBookingRequest(params: {
  listingId: string;
  startDate: string;
  endDate: string;
  quantity?: number;
}): Promise<DbBookingRow> {
  return callBookingRpc('create_booking_request', {
    p_listing_id: params.listingId,
    p_start_date: params.startDate,
    p_end_date: params.endDate,
    p_quantity: params.quantity ?? 1,
  });
}

export async function respondToBookingRequest(bookingId: string, approve: boolean): Promise<DbBookingRow> {
  return callBookingRpc('respond_to_booking_request', { p_booking_id: bookingId, p_approve: approve });
}

export async function cancelBooking(bookingId: string): Promise<DbBookingRow> {
  return callBookingRpc('cancel_booking', { p_booking_id: bookingId });
}

export async function markBookingActive(bookingId: string): Promise<DbBookingRow> {
  return callBookingRpc('mark_booking_active', { p_booking_id: bookingId });
}

export async function startBookingReturn(bookingId: string): Promise<DbBookingRow> {
  return callBookingRpc('start_booking_return', { p_booking_id: bookingId });
}

export async function completeBookingReturn(bookingId: string): Promise<DbBookingRow> {
  return callBookingRpc('complete_booking_return', { p_booking_id: bookingId });
}
