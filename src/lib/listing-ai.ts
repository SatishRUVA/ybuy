import { supabase } from '@/lib/supabase';

export interface ListingFlag {
  type: 'contact_info' | 'profanity' | 'prohibited_item' | 'drug_related' | 'other_guideline';
  reason: string;
  confidence: 'low' | 'medium' | 'high';
  source: 'photo' | 'text' | 'both' | null;
}

export interface ListingModerationResult {
  masked: { title: string; description: string; changed: boolean };
  suggestion: { title: string; description: string; categoryId: string | null } | null;
  flags: ListingFlag[];
}

/**
 * Calls the analyze-listing-photo Edge Function (deterministic contact-info/profanity checks
 * plus a contextual Gemini photo+text check). Fails closed: any error, network failure, or
 * malformed AI response returns null so the wizard degrades to plain manual entry rather than
 * erroring out or blocking the flow.
 */
export async function moderateListingContent(params: {
  listingId: string;
  photoUrl?: string;
  title: string;
  description: string;
}): Promise<ListingModerationResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke('analyze-listing-photo', { body: params });
    if (error || !data?.ok) return null;
    return { masked: data.masked, suggestion: data.suggestion, flags: data.flags ?? [] };
  } catch {
    return null;
  }
}
