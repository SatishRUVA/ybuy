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
  photoQualitySuggestions: { photoIndex: number; reason: string; recommendation: string }[];
}

/**
 * Calls the analyze-listing-photo Edge Function (deterministic contact-info/profanity checks
 * plus a contextual Gemini photo+text check). Fails closed: any error, network failure, or
 * malformed AI response returns null so the wizard degrades to plain manual entry rather than
 * erroring out or blocking the flow.
 */
export async function moderateListingContent(params: {
  listingId: string;
  photoUrls?: string[];
  title: string;
  description: string;
}): Promise<ListingModerationResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke('analyze-listing-photo', {
      body: params,
      signal: AbortSignal.timeout(15_000),
    });
    if (error || !data?.ok) return null;
    return {
      masked: data.masked,
      suggestion: data.suggestion,
      flags: data.flags ?? [],
      photoQualitySuggestions: Array.isArray(data.photoQualitySuggestions)
        ? data.photoQualitySuggestions.filter((suggestion: unknown): suggestion is ListingModerationResult['photoQualitySuggestions'][number] => {
          if (!suggestion || typeof suggestion !== 'object') return false;
          const item = suggestion as Record<string, unknown>;
          return Number.isInteger(item.photoIndex) && Number(item.photoIndex) >= 0 && Number(item.photoIndex) < 6
            && typeof item.reason === 'string' && typeof item.recommendation === 'string';
        })
        : [],
    };
  } catch {
    return null;
  }
}
