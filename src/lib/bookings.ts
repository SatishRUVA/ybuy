import { supabase } from '@/lib/supabase';
import { signListingImages } from '@/lib/listings';

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
  booking_reference?: string;
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
  owner_discount_amount?: number;
  delivery_mode?: 'pickup' | 'delivery';
  delivery_fee_amount?: number;
  renter_note?: string | null;
  service_fee_amount: number;
  insurance_amount: number;
  tax_amount?: number;
  tax_rate?: number;
  sandbox_tax?: boolean;
  deposit: number;
  deposit_collection_model?: 'captured' | 'authorization';
  deposit_hold_consent_at?: string | null;
  payment_first?: boolean;
  total: number;
  created_at: string;
  listing: DbBookingListing | null;
  renter: DbBookingProfile | null;
  owner: DbBookingProfile | null;
  agreement?: { snapshot: {
    listing: { title: string; photos: string[] };
    owner_name: string;
    renter_name: string;
  } } | null;
}

const BOOKING_SELECT = `
  *,
  listing:listings(id, title, listing_images(url, sort_order)),
  agreement:rental_agreements(snapshot),
  renter:profiles!renter_id(id, full_name, avatar_url),
  owner:profiles!owner_id(id, full_name, avatar_url)
`;

export interface BookingPickup {
  address: string;
  city: string;
  state: string;
  postalCode: string;
}

export async function fetchBookingPickup(bookingId: string): Promise<BookingPickup> {
  const { data, error } = await supabase.rpc('get_booking_pickup', { p_booking_id: bookingId });
  if (error) throw new Error(error.message);
  if (!data || typeof data.address !== 'string' || !data.address.trim()
    || typeof data.city !== 'string' || typeof data.state !== 'string' || typeof data.postalCode !== 'string') {
    throw new Error('The pickup address could not be loaded. Please contact the owner.');
  }
  return { address: data.address, city: data.city, state: data.state, postalCode: data.postalCode };
}

export interface UiBooking {
  id: string;
  bookingReference: string | null;
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
  ownerDiscountAmount: number;
  deliveryMode: 'pickup' | 'delivery';
  deliveryFeeAmount: number;
  renterNote: string | null;
  serviceFeeAmount: number;
  insuranceAmount: number;
  taxAmount: number;
  taxRate: number;
  sandboxTax: boolean;
  deposit: number;
  depositCollectionModel: 'captured' | 'authorization';
  paymentFirst?: boolean;
  total: number;
  isOwner: boolean;
  counterpartId: string;
}

const PLACEHOLDER_IMAGE = 'https://images.pexels.com/photos/163069/box-cardboard-package-moving-163069.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop';

export function toUiBooking(row: DbBookingRow, currentUserId: string): UiBooking {
  const isOwner = row.owner_id === currentUserId;
  const counterpart = isOwner ? row.renter : row.owner;
  const sortedImages = [...(row.listing?.listing_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return {
    id: row.id,
    bookingReference: row.booking_reference ?? null,
    listingId: row.listing_id,
    listingTitle: row.listing?.title ?? row.agreement?.snapshot.listing.title ?? 'Unavailable listing',
    listingImage: sortedImages[0]?.url ?? PLACEHOLDER_IMAGE,
    counterpartName: counterpart?.full_name ?? (isOwner ? row.agreement?.snapshot.renter_name : row.agreement?.snapshot.owner_name) ?? 'Unavailable account',
    counterpartAvatar: counterpart?.avatar_url ?? null,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    quantity: row.quantity,
    dailyRate: row.daily_rate,
    days: row.days,
    subtotal: row.subtotal,
    ownerDiscountAmount: Number(row.owner_discount_amount ?? 0),
    deliveryMode: row.delivery_mode === 'delivery' ? 'delivery' : 'pickup',
    deliveryFeeAmount: Number(row.delivery_fee_amount ?? 0),
    renterNote: row.renter_note ?? null,
    serviceFeeAmount: row.service_fee_amount,
    insuranceAmount: Number(row.insurance_amount ?? 0),
    taxAmount: Number(row.tax_amount ?? 0),
    taxRate: Number(row.tax_rate ?? 0),
    sandboxTax: row.sandbox_tax === true,
    deposit: row.deposit,
    depositCollectionModel: row.deposit_collection_model ?? 'captured',
    paymentFirst: row.payment_first === true,
    total: row.total,
    isOwner,
    counterpartId: counterpart?.id ?? (isOwner ? row.renter_id : row.owner_id),
  };
}

export async function fetchBookingById(id: string, currentUserId: string): Promise<UiBooking | null> {
  const { data, error } = await supabase.from('bookings').select(BOOKING_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as DbBookingRow;
  if (row.listing) row.listing.listing_images = await signListingImages(row.listing.listing_images);
  return toUiBooking(row, currentUserId);
}

export async function fetchBookingsAsRenter(currentUserId: string): Promise<UiBooking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(BOOKING_SELECT)
    .eq('renter_id', currentUserId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return Promise.all((data ?? []).map(async (value) => {
    const row = value as unknown as DbBookingRow;
    if (row.listing) row.listing.listing_images = await signListingImages(row.listing.listing_images);
    return toUiBooking(row, currentUserId);
  }));
}

export async function fetchBookingsAsOwner(currentUserId: string): Promise<UiBooking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(BOOKING_SELECT)
    .eq('owner_id', currentUserId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return Promise.all((data ?? []).map(async (value) => {
    const row = value as unknown as DbBookingRow;
    if (row.listing) row.listing.listing_images = await signListingImages(row.listing.listing_images);
    return toUiBooking(row, currentUserId);
  }));
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
  deliveryMode?: 'pickup' | 'delivery';
  renterNote?: string;
}): Promise<DbBookingRow> {
  const note = params.renterNote?.trim();
  const args = {
    p_listing_id: params.listingId,
    p_start_date: params.startDate,
    p_end_date: params.endDate,
    p_quantity: params.quantity ?? 1,
    p_delivery_mode: params.deliveryMode ?? 'pickup',
    p_renter_note: note ? note : null,
  };
  return callBookingRpc('create_booking_request', args);
}

export async function respondToBookingRequest(bookingId: string, approve: boolean): Promise<DbBookingRow> {
  return callBookingRpc('respond_to_booking_request', { p_booking_id: bookingId, p_approve: approve });
}

export async function cancelBooking(bookingId: string): Promise<DbBookingRow> {
  return callBookingRpc('cancel_booking', { p_booking_id: bookingId });
}

export async function startBookingReturn(bookingId: string): Promise<DbBookingRow> {
  return callBookingRpc('start_booking_return', { p_booking_id: bookingId });
}
