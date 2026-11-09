import { supabase } from '@/lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { plainTextError } from '@/lib/text-safety';

export interface ListingFlag {
  type: 'contact_info' | 'profanity' | 'prohibited_item' | 'drug_related' | 'other_guideline' | 'content_violation';
  reason: string;
  confidence: 'low' | 'medium' | 'high';
  source: 'photo' | 'text' | 'both' | null;
}

export interface ListingPhotoDecision {
  photoIndex: number;
  decision: 'approved' | 'replace' | 'rejected' | 'manual_review';
  reason: string;
}

function isListingFlag(value: unknown): value is ListingFlag {
  if (!value || typeof value !== 'object') return false;
  const flag = value as Record<string, unknown>;
  return ['contact_info', 'profanity', 'prohibited_item', 'drug_related', 'other_guideline', 'content_violation'].includes(String(flag.type))
    && typeof flag.reason === 'string' && Boolean(flag.reason.trim())
    && ['low', 'medium', 'high'].includes(String(flag.confidence))
    && (flag.source === null || flag.source === 'photo' || flag.source === 'text' || flag.source === 'both');
}

export interface ListingModerationResult {
  masked: { title: string; description: string; changed: boolean };
  suggestion: { title: string; description: string; categoryId: string | null; brand: string | null; model: string | null } | null;
  aiError?: string | null;
  flags: ListingFlag[];
  photoQualitySuggestions: { photoIndex: number; reason: string; recommendation: string }[];
  photoDecisions: ListingPhotoDecision[];
}

/**
 * Calls the analyze-listing-photo Edge Function (deterministic contact-info/content checks
 * plus an OpenRouter content check). Text-only reviews return flags without generating
 * item suggestions and reuse persisted photo decisions.
 */
export async function moderateListingContent(params: {
  listingId: string;
  photoUrls?: string[];
  title: string;
  description: string;
  reviewMode?: 'photos' | 'text';
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
    || typeof data.masked.changed !== 'boolean'
    || (data.suggestion !== null && (!data.suggestion || typeof data.suggestion.title !== 'string'
      || !data.suggestion.title.trim() || typeof data.suggestion.description !== 'string'
      || !data.suggestion.description.trim()
      || (data.suggestion.categoryId !== null && typeof data.suggestion.categoryId !== 'string')))) {
    throw new Error('AI returned invalid suggestions. Please retry or enter details manually.');
  }
  if (!Array.isArray(data.flags) || !data.flags.every(isListingFlag)) {
    throw new Error('AI returned invalid moderation flags. Please retry or enter details manually.');
  }
  const photoDecisions: ListingPhotoDecision[] = Array.isArray(data.photoDecisions)
    ? data.photoDecisions.filter((decision: unknown): decision is ListingPhotoDecision => {
      if (!decision || typeof decision !== 'object') return false;
      const item = decision as Record<string, unknown>;
      return Number.isInteger(item.photoIndex) && Number(item.photoIndex) >= 0
        && Number(item.photoIndex) < (params.photoUrls?.length ?? 0)
        && ['approved', 'replace', 'rejected', 'manual_review'].includes(String(item.decision))
        && typeof item.reason === 'string' && Boolean(item.reason.trim());
    })
    : [];
  if (photoDecisions.length !== (params.photoUrls?.length ?? 0)
    || new Set(photoDecisions.map((decision: ListingPhotoDecision) => decision.photoIndex)).size !== photoDecisions.length) {
    throw new Error('AI could not review every photo. Please retry or contact support before publishing.');
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
        return Number.isInteger(item.photoIndex) && Number(item.photoIndex) >= 0 && Number(item.photoIndex) < 4
          && typeof item.reason === 'string' && typeof item.recommendation === 'string';
      })
      : [],
    photoDecisions,
  };
}
