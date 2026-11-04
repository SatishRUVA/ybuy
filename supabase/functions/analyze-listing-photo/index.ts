// Combined listing-content moderation: deterministic contact-info/profanity checks (always run,
// no AI) plus a contextual vision+text check for prohibited items (Part 1 scope -
// convenience/soft-warn only; the ONE exception is auto-masking contact info, which is a
// deterministic pattern match, not a judgment call, so it's allowed to auto-edit content).
// OPENROUTER_API_KEY is a server-only secret and never reaches the client.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Filter from 'npm:bad-words@3';
import { withCors } from '../_shared/cors.ts';

// Mirrors the prohibited-items list on the public guidelines page (src/pages/guidelines.tsx) -
// keep both in sync if YBuy's real Community Guidelines content changes.
const PROHIBITED_ITEMS = [
  'weapons or ammunition (including replicas and BB/airsoft guns)',
  'illegal drugs or drug paraphernalia',
  'live animals',
  'counterfeit or replica branded goods',
  'hazardous materials (flammable, toxic, explosive, or radioactive substances)',
];

const CONTACT_PLACEHOLDER = '[contact info removed - message the owner in YBuy]';
// Matches common US-style phone formats incl. spaced/dashed/dotted obfuscation, e.g.
// "555-123-4567", "555.123.4567", "(555) 123 4567", "5551234567".
const PHONE_REGEX = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

type FlagType = 'contact_info' | 'profanity' | 'prohibited_item' | 'drug_related' | 'other_guideline';
type Confidence = 'low' | 'medium' | 'high';
type Source = 'photo' | 'text' | 'both';

interface Flag {
  type: FlagType;
  reason: string;
  confidence: Confidence;
  source: Source | null;
  auto_masked: boolean;
}

/** Task 1: deterministic, no AI. Replaces contact info with a fixed placeholder and flags profanity. */
function runDeterministicChecks(title: string, description: string): {
  maskedTitle: string;
  maskedDescription: string;
  flags: Flag[];
} {
  let contactFound = false;
  const mask = (text: string) => {
    let out = text.replace(PHONE_REGEX, () => { contactFound = true; return CONTACT_PLACEHOLDER; });
    out = out.replace(EMAIL_REGEX, () => { contactFound = true; return CONTACT_PLACEHOLDER; });
    return out;
  };
  const maskedTitle = mask(title);
  const maskedDescription = mask(description);

  const flags: Flag[] = [];
  if (contactFound) {
    flags.push({
      type: 'contact_info',
      reason: 'A phone number or email address was detected and automatically removed.',
      confidence: 'high',
      source: 'text',
      auto_masked: true,
    });
  }

  const filter = new Filter();
  if (filter.isProfane(`${maskedTitle} ${maskedDescription}`)) {
    flags.push({
      type: 'profanity',
      reason: 'This listing may contain inappropriate language.',
      confidence: 'medium',
      source: 'text',
      auto_masked: false,
    });
  }

  return { maskedTitle, maskedDescription, flags };
}

interface RawAIFlag {
  type?: unknown;
  reason?: unknown;
  confidence?: unknown;
  source?: unknown;
}

interface RawAIResult {
  suggested_title?: unknown;
  suggested_description?: unknown;
  suggested_category?: unknown;
  suggested_brand?: unknown;
  suggested_model?: unknown;
  flags?: unknown;
  photo_quality_suggestions?: unknown;
}

interface PhotoQualitySuggestion {
  photoIndex: number;
  reason: string;
  recommendation: string;
}

interface ValidAIResult {
  title: string;
  description: string;
  category: string;
  brand: string | null;
  model: string | null;
  flags: Flag[];
  photoQualitySuggestions: PhotoQualitySuggestion[];
}

/** Fails closed: returns null unless every field (and every flag item) matches the expected shape. */
function validateAIResult(raw: unknown, validCategoryNames: string[], photoCount: number): ValidAIResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawAIResult;
  if (typeof r.suggested_title !== 'string' || !r.suggested_title.trim()) return null;
  if (typeof r.suggested_description !== 'string' || !r.suggested_description.trim()) return null;
  if (typeof r.suggested_category !== 'string') return null;
  const category = validCategoryNames.find((n) => n.toLowerCase() === (r.suggested_category as string).toLowerCase());
  if (!category) return null;
  for (const value of [r.suggested_brand, r.suggested_model]) {
    if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 80)) return null;
  }
  if (!Array.isArray(r.flags)) return null;
  if (!Array.isArray(r.photo_quality_suggestions)) return null;

  const flags: Flag[] = [];
  for (const item of r.flags) {
    if (!item || typeof item !== 'object') return null;
    const f = item as RawAIFlag;
    if (f.type !== 'prohibited_item' && f.type !== 'drug_related' && f.type !== 'other_guideline') return null;
    if (typeof f.reason !== 'string' || !f.reason.trim()) return null;
    if (f.confidence !== 'low' && f.confidence !== 'medium' && f.confidence !== 'high') return null;
    if (f.source !== 'photo' && f.source !== 'text' && f.source !== 'both') return null;
    flags.push({ type: f.type, reason: f.reason.trim(), confidence: f.confidence, source: f.source, auto_masked: false });
  }

  const photoQualitySuggestions: PhotoQualitySuggestion[] = [];
  const seenPhotoIndexes = new Set<number>();
  for (const item of r.photo_quality_suggestions) {
    if (!item || typeof item !== 'object') return null;
    const suggestion = item as Record<string, unknown>;
    if (!Number.isInteger(suggestion.photo_index) || Number(suggestion.photo_index) < 0 || Number(suggestion.photo_index) >= photoCount) return null;
    if (seenPhotoIndexes.has(Number(suggestion.photo_index))) return null;
    if (typeof suggestion.reason !== 'string' || !suggestion.reason.trim() || suggestion.reason.length > 240) return null;
    if (typeof suggestion.recommendation !== 'string' || !suggestion.recommendation.trim() || suggestion.recommendation.length > 240) return null;
    const photoIndex = Number(suggestion.photo_index);
    seenPhotoIndexes.add(photoIndex);
    photoQualitySuggestions.push({
      photoIndex,
      reason: suggestion.reason.trim(),
      recommendation: suggestion.recommendation.trim(),
    });
  }

  return { title: r.suggested_title.trim(), description: r.suggested_description.trim(), category,
    brand: typeof r.suggested_brand === 'string' ? r.suggested_brand.trim() : null,
    model: typeof r.suggested_model === 'string' ? r.suggested_model.trim() : null,
    flags, photoQualitySuggestions };
}

Deno.serve(withCors(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, error: 'Missing Authorization header' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return json({ ok: false, error: 'Not signed in' }, 401);

    const { data: activeSession, error: sessionError } = await supabase.rpc('has_active_session');
    // PGRST202 = migration 20261018000001 is not applied yet; getUser() above already rejects revoked tokens.
    if (sessionError && sessionError.code !== 'PGRST202') {
      console.error('Session verification failed', sessionError.message);
      return json({ ok: false, error: 'Could not verify your session. Please try again.' }, 503);
    }
    if (!sessionError && activeSession !== true) return json({ ok: false, error: 'Your session has expired. Please sign in again.' }, 401);

    const { listingId, photoUrls: inputPhotoUrls, photoUrl, title, description } = await req.json();
    if (!listingId || typeof listingId !== 'string') return json({ ok: false, error: 'listingId is required' }, 400);
    const photoUrls = Array.isArray(inputPhotoUrls)
      ? inputPhotoUrls
      : typeof photoUrl === 'string' ? [photoUrl] : [];
    if (photoUrls.length > 6 || photoUrls.some((url) => typeof url !== 'string' || url.length > 2048)) {
      return json({ ok: false, error: 'Invalid listing photos' }, 400);
    }
    const rawTitle = typeof title === 'string' ? title : '';
    const rawDescription = typeof description === 'string' ? description : '';

    // RLS already scopes this select to the caller's own (or published) listings, but we still
    // explicitly re-check ownership before spending an AI-provider call on someone else's draft.
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, owner_id')
      .eq('id', listingId)
      .single();
    if (listingError || !listing) return json({ ok: false, error: 'Listing not found' }, 404);
    if (listing.owner_id !== userData.user.id) return json({ ok: false, error: 'Not your listing' }, 403);

    if (photoUrls.length > 0) {
      const { data: listingPhotos, error: photosError } = await supabase
        .from('listing_images')
        .select('url')
        .eq('listing_id', listingId);
      if (photosError || !listingPhotos) return json({ ok: false, error: 'Could not verify listing photos' }, 503);
      const validPhotoKeys = new Set(listingPhotos.map((photo: { url: string }) => storagePhotoKey(photo.url, 'public')));
      const validUrls = photoUrls.every((url) => {
        const key = storagePhotoKey(url, 'sign');
        return key !== null && validPhotoKeys.has(key);
      });
      if (!validUrls) return json({ ok: false, error: 'Photos must belong to this listing' }, 400);
    }

    // Task 1 - deterministic, always runs, no AI call.
    const { maskedTitle, maskedDescription, flags: deterministicFlags } = runDeterministicChecks(rawTitle, rawDescription);

    const { data: categoryRows, error: categoryError } = await supabase
      .from('categories')
      .select('id, name')
      .eq('active', true);
    if (categoryError || !categoryRows || categoryRows.length === 0) {
      return json({ ok: false, error: 'No categories available. Please try again later.' }, 503);
    }
    const categoryNames = categoryRows.map((c: { name: string }) => c.name);

    // Task 2 - contextual AI check (photo + post-mask text together), one OpenRouter call.
    let aiResult: ValidAIResult | null = null;
    let aiError: string | null = null;
    const openRouterKey = Deno.env.get('OPENROUTER_API_KEY')?.trim();
    if (!openRouterKey) {
      console.error('Listing AI configuration missing: OPENROUTER_API_KEY');
      aiError = 'AI is not configured. Please contact support or enter details manually.';
    } else if (photoUrls.length > 0 || maskedTitle || maskedDescription) {
      try {
        aiResult = await runAiCheck(openRouterKey, categoryNames, maskedTitle, maskedDescription, photoUrls);
      } catch (error) {
        aiError = error instanceof Error ? error.message : 'AI analysis failed. Please retry or enter details manually.';
        console.error('Listing AI analysis failed:', aiError);
      }
    } else {
      aiError = 'Upload a photo or enter item details before generating suggestions.';
    }

    const allFlags: Flag[] = [...deterministicFlags, ...(aiResult?.flags ?? [])];

    // Every flag is logged unconditionally at analysis time, before the client ever sees the
    // response - a client dismissing the notice (or never showing it) can't suppress this.
    if (allFlags.length > 0) {
      const serviceClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const { error: flagError } = await serviceClient.from('listing_flags').insert(
        allFlags.map((f) => ({
          listing_id: listingId,
          type: f.type,
          reason: f.reason,
          confidence: f.confidence,
          source: f.source,
          auto_masked: f.auto_masked,
        })),
      );
      if (flagError) {
        console.error('Could not persist listing flags:', flagError.code);
        return json({ ok: false, error: 'Could not save the analysis. Please try again.' }, 503);
      }
    }

    const categoryId = aiResult
      ? categoryRows.find((c: { name: string; id: string }) => c.name === aiResult!.category)!.id
      : null;

    return json({
      ok: true,
      masked: { title: maskedTitle, description: maskedDescription, changed: deterministicFlags.some((f) => f.type === 'contact_info') },
      suggestion: aiResult ? { title: aiResult.title, description: aiResult.description, categoryId, brand: aiResult.brand, model: aiResult.model } : null,
      aiError,
      flags: allFlags.map((f) => ({ type: f.type, reason: f.reason, confidence: f.confidence, source: f.source })),
      photoQualitySuggestions: aiResult?.photoQualitySuggestions ?? [],
    });
  } catch (err) {
    console.error('analyze-listing-photo error:', err);
    return json({ ok: false, error: 'Unexpected error' }, 500);
  }
}));

async function runAiCheck(
  openRouterKey: string,
  categoryNames: string[],
  title: string,
  description: string,
  photoUrls: string[],
): Promise<ValidAIResult> {
  const qualityGuidelines = Deno.env.get('LISTING_PHOTO_QUALITY_GUIDELINES')?.trim().slice(0, 2000)
    || 'Prefer a sharp, well-lit photo that clearly shows the full item against a tidy, non-distracting background.';
  const systemPrompt = [
    'You help renters write a listing for a peer-to-peer rental marketplace, and screen it for problems.',
    'You are given the current title/description text (already screened for clearly-formatted phone ' +
      'numbers and emails - do not re-flag those) and, if provided, photos of the item.',
    'Never invent or infer a brand, model, condition, included accessory, or technical specification. ' +
      'Only mention a detail if it is clearly visible and identifiable in the supplied photo or already stated by the owner. ' +
      'When uncertain, omit the detail. Do not describe hidden contents or claim an item is tested or verified.',
    'Respond with ONLY a single JSON object, no other text, matching exactly this shape:',
    '{"suggested_title": string, "suggested_description": string, "suggested_category": string, ' +
      '"suggested_brand": string | null, "suggested_model": string | null, ' +
      '"flags": [{"type": "prohibited_item" | "drug_related" | "other_guideline", "reason": string, ' +
      '"confidence": "low" | "medium" | "high", "source": "photo" | "text" | "both"}], ' +
      '"photo_quality_suggestions": [{"photo_index": number, "reason": string, "recommendation": string}]}',
    `"suggested_category" MUST be exactly one of these existing categories: ${categoryNames.join(', ')}.`,
    'Return the brand and model as separate suggested_brand and suggested_model fields, each at most 80 characters. ' +
      'Use only clearly identifiable markings in the photos or details explicitly stated by the owner. ' +
      'Return null for either field when unknown; never guess or use placeholders such as "Unknown" or "N/A".',
    'Add a flag if the photo or text suggests one of these prohibited items from YBuy\'s Community ' +
      `Guidelines: ${PROHIBITED_ITEMS.join('; ')}. Use "drug_related" for drugs/paraphernalia, ` +
      '"prohibited_item" for weapons/live animals/counterfeit goods/hazardous materials.',
    'Also use "other_guideline" if the text tries to share contact information in an obfuscated or ' +
      'disguised way to avoid detection - e.g. spelled-out digits ("five five five..."), phone numbers ' +
      'split with unusual wording, or requests to "text/call/email me at..." - since YBuy requires all ' +
      'contact to stay in-platform. Do NOT flag plain, clearly-formatted phone numbers or emails (already handled). ' +
      `If you see the exact text "${CONTACT_PLACEHOLDER}" already in the description, that attempt was already ` +
      'handled - do not flag it again.',
    'Do NOT flag profanity. If nothing is concerning, return an empty flags array.',
    `Review each supplied photo for these quality guidelines: ${qualityGuidelines} ` +
      'Only report concrete, visible issues and practical fixes; keep suggestions advisory and return an empty array if none apply.',
  ].join('\n');

  const userText = ['Current title:', title || '(none yet)', 'Current description:', description || '(none yet)'].join('\n');

  const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
    { type: 'text', text: userText },
  ];
  for (const photoUrl of photoUrls) content.push({ type: 'image_url', image_url: { url: photoUrl } });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let aiResponse: Response;
    try {
      aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content },
          ],
          max_tokens: 2000,
        }),
        signal: AbortSignal.timeout(18_000),
      });
    } catch (error) {
      console.error('Listing AI transport failure:', error instanceof Error ? error.name : 'unknown');
      if (attempt === 0) continue;
      throw new Error('AI analysis timed out or could not connect. Please retry or enter details manually.');
    }

    if (!aiResponse.ok) {
      console.error('Listing AI provider HTTP status:', aiResponse.status);
      let keyLimitExceeded = false;
      if (aiResponse.status === 403) {
        try {
          const failure = await aiResponse.json();
          keyLimitExceeded = failure?.error?.metadata?.limit_source === 'openrouter_key_limit';
        } catch {
          console.error('Listing AI provider returned an unreadable error response');
        }
      } else {
        await aiResponse.body?.cancel();
      }
      if (attempt === 0 && (aiResponse.status === 429 || aiResponse.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      if (keyLimitExceeded || aiResponse.status === 402) {
        throw new Error('AI provider credits or usage limit are exhausted. Please contact support or enter details manually.');
      }
      if (aiResponse.status === 401 || aiResponse.status === 403) {
        throw new Error('AI provider authentication failed. Please contact support or enter details manually.');
      }
      throw new Error('AI provider is temporarily unavailable. Please retry or enter details manually.');
    }
    let aiJson;
    try {
      aiJson = await aiResponse.json();
    } catch {
      throw new Error('AI returned an unreadable response. Please retry or enter details manually.');
    }
    const responseText: unknown = aiJson?.choices?.[0]?.message?.content;
    if (typeof responseText !== 'string' || !responseText.trim()) {
      throw new Error('AI returned no suggestions. Please retry or enter details manually.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new Error('AI returned incomplete suggestions. Please retry or enter details manually.');
    }
    const result = validateAIResult(parsed, categoryNames, photoUrls.length);
    if (!result) throw new Error('AI returned invalid suggestions. Please retry or enter details manually.');
    return result;
  }
  throw new Error('AI analysis failed. Please retry or enter details manually.');
}

function storagePhotoKey(value: string, access: 'public' | 'sign'): string | null {
  try {
    const url = new URL(value);
    const supabaseOrigin = new URL(Deno.env.get('SUPABASE_URL')!).origin;
    const prefix = `/storage/v1/object/${access}/listing-images/`;
    const storageOrigin = Deno.env.get('LISTING_STORAGE_ORIGIN');
    const configuredOrigin = storageOrigin ? new URL(storageOrigin).origin : supabaseOrigin;
    if ((url.origin !== supabaseOrigin && url.origin !== configuredOrigin) || !url.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
