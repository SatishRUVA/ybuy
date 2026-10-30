import { supabase } from '@/lib/supabase';

export interface OwnerPromotion {
  id: string;
  listing_id: string;
  code: string;
  discount_percent: number;
  active: boolean;
  redemptions: number;
}

export async function fetchOwnerPromotion(listingId: string): Promise<OwnerPromotion | null> {
  const { data, error } = await supabase.rpc('owner_list_promotion', { p_listing_id: listingId });
  if (error) throw new Error(error.message);
  return data as OwnerPromotion | null;
}

export async function saveOwnerPromotion(input: {
  listingId: string; code: string; discountPercent: number; active: boolean;
}): Promise<OwnerPromotion> {
  const { data, error } = await supabase.rpc('owner_save_promotion', {
    p_listing_id: input.listingId, p_code: input.code, p_discount_percent: input.discountPercent, p_active: input.active,
  });
  if (error) throw new Error(error.message);
  return data as OwnerPromotion;
}

export async function quoteOwnerPromotion(input: {
  listingId: string; code: string; days: number; quantity?: number;
}): Promise<{ discount_amount: number; discount_percent: number; source: 'promotion'; test_only: true }> {
  const { data, error } = await supabase.rpc('owner_quote_promotion', {
    p_listing_id: input.listingId, p_code: input.code, p_days: input.days, p_quantity: input.quantity ?? 1,
  });
  if (error) throw new Error(error.message);
  return data as { discount_amount: number; discount_percent: number; source: 'promotion'; test_only: true };
}
