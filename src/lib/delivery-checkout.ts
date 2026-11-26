import { supabase } from '@/lib/supabase';

export type DeliveryTrip = 'dropoff' | 'return' | 'both';
export type DeliveryWindow = 'morning' | 'afternoon' | 'evening';

export const DELIVERY_WINDOW_LABELS: Record<DeliveryWindow, string> = {
  morning: '9am – 12pm',
  afternoon: '12 – 3pm',
  evening: '3 – 6pm',
};

export interface DeliveryAddress {
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
}

export interface DeliverySelection {
  trip: DeliveryTrip;
  setup: boolean;
  dropoff_window: DeliveryWindow | null;
  return_window: DeliveryWindow | null;
  address: DeliveryAddress;
}

export interface DeliveryWindowAvailability {
  window: DeliveryWindow;
  dropoff_available: boolean;
  return_available: boolean;
}

export async function fetchDeliveryWindows(listingId: string, startDate: string, endDate: string): Promise<{
  timeZone: string;
  windows: DeliveryWindowAvailability[];
}> {
  const { data, error } = await supabase.rpc('get_checkout_delivery_windows', {
    p_listing_id: listingId, p_start_date: startDate, p_end_date: endDate,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data.time_zone !== 'string' || !Array.isArray(data.windows)
    || data.windows.some((item: DeliveryWindowAvailability) =>
      !['morning', 'afternoon', 'evening'].includes(item.window)
      || typeof item.dropoff_available !== 'boolean' || typeof item.return_available !== 'boolean')) {
    throw new Error('The server returned invalid delivery window availability.');
  }
  return { timeZone: data.time_zone, windows: data.windows };
}
