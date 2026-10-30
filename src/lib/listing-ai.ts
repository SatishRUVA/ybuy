import { supabase } from '@/lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { plainTextError } from '@/lib/text-safety';

export interface ListingFlag {
  type: 'contact_info' | 'profanity' | 'prohibited_item' | 'drug_related' | 'other_guideline';
  reason: string;
  confidence: 'low' | 'medium' | 'high';
  source: 'photo' | 'text' | 'both' | null;
}

export interface ListingModerationResult {
  masked: { title: string; description: string; changed: boolean };
  suggestion: { title: string; description: string; categoryId: string | null; brand: string | null; model: string | null } | null;
  aiError?: string | null;
  flags: ListingFlag[];
  photoQualitySuggestions: { photoIndex: number; reason: string; recommendation: string }[];
}

/**
 * Calls the analyze-listing-photo Edge Function (deterministic contact-info/profanity checks
 * plus an OpenRouter photo+text check). Reports failures to the wizard's manual-entry notice.
 */
export async function moderateListingContent(params: {
  listingId: string;
  photoUrls?: string[];
  title: string;
  description: string;
}, purpose: 'suggestions' | 'publication' = 'suggestions'): Promise<ListingModerationResult> {
  const { data, error } = await supabase.functions.invoke('analyze-listing-photo', {
    body: params,
    // Two bounded provider attempts plus authentication/storage/database overhead.
    signal: AbortSignal.timeout(45_000),
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let response;
      try {
        response = await error.context.json();
      } catch {
        throw new Error('AI request failed. Please retry or enter details manually.');
      }
      throw new Error(typeof response?.error === 'string' ? response.error : 'AI request failed. Please retry or enter details manually.');
    }
    throw new Error(purpose === 'publication'
      ? 'The listing review service could not be reached or took too long. Retry publication.'
      : 'AI could not connect or took too long. Please retry or enter details manually.');
  }
  if (!data?.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'AI is unavailable. Enter details manually, or retry when you are ready.');
  if (!data.masked || typeof data.masked.title !== 'string' || typeof data.masked.description !== 'string'
    || typeof data.masked.changed !== 'boolean' || !Array.isArray(data.flags)
    || (data.suggestion !== null && (!data.suggestion || typeof data.suggestion.title !== 'string'
      || !data.suggestion.title.trim() || typeof data.suggestion.description !== 'string'
      || !data.suggestion.description.trim()
      || (data.suggestion.categoryId !== null && typeof data.suggestion.categoryId !== 'string')))) {
    throw new Error('AI returned invalid suggestions. Please retry or enter details manually.');
  }
  if (data.suggestion) {
    for (const field of ['brand', 'model'] as const) {
      const value: unknown = data.suggestion[field];
      // Older hosted functions omit these fields until the AI endpoint is deployed.
      if (value == null) continue;
      if (typeof value !== 'string' || !value.trim() || plainTextError(field === 'brand' ? 'Brand' : 'Model', value, 80)) {
        throw new Error('AI returned invalid item identity. Please retry or enter brand and model manually.');
      }
    }
  }
  return {
    masked: data.masked,
    suggestion: data.suggestion ? {
      ...data.suggestion,
      brand: data.suggestion.brand?.trim() ?? null,
      model: data.suggestion.model?.trim() ?? null,
    } : null,
    aiError: typeof data.aiError === 'string' ? data.aiError : null,
    flags: data.flags,
    photoQualitySuggestions: Array.isArray(data.photoQualitySuggestions)
      ? data.photoQualitySuggestions.filter((suggestion: unknown): suggestion is ListingModerationResult['photoQualitySuggestions'][number] => {
        if (!suggestion || typeof suggestion !== 'object') return false;
        const item = suggestion as Record<string, unknown>;
        return Number.isInteger(item.photoIndex) && Number(item.photoIndex) >= 0 && Number(item.photoIndex) < 6
          && typeof item.reason === 'string' && typeof item.recommendation === 'string';
      })
      : [],
  };
}
