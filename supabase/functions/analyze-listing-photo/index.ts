// Combined listing-content moderation: deterministic contact-info/profanity checks (always run,
// no AI) plus a contextual vision+text check for prohibited items (Part 1 scope -
// convenience/soft-warn only; the ONE exception is auto-masking contact info, which is a
// deterministic pattern match, not a judgment call, so it's allowed to auto-edit content).
// OPENROUTER_API_KEY is a server-only secret and never reaches the client.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Filter from 'npm:bad-words@3';

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

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  flags?: unknown;
}

interface ValidAIResult {
  title: string;
  description: string;
  category: string;
  flags: Flag[];
}

/** Fails closed: returns null unless every field (and every flag item) matches the expected shape. */
function validateAIResult(raw: unknown, validCategoryNames: string[]): ValidAIResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawAIResult;
  if (typeof r.suggested_title !== 'string' || !r.suggested_title.trim()) return null;
  if (typeof r.suggested_description !== 'string' || !r.suggested_description.trim()) return null;
  if (typeof r.suggested_category !== 'string') return null;
  const category = validCategoryNames.find((n) => n.toLowerCase() === (r.suggested_category as string).toLowerCase());
  if (!category) return null;
  if (!Array.isArray(r.flags)) return null;

  const flags: Flag[] = [];
  for (const item of r.flags) {
    const f = item as RawAIFlag;
    if (f.type !== 'prohibited_item' && f.type !== 'drug_related' && f.type !== 'other_guideline') return null;
    if (typeof f.reason !== 'string' || !f.reason.trim()) return null;
    if (f.confidence !== 'low' && f.confidence !== 'medium' && f.confidence !== 'high') return null;
    if (f.source !== 'photo' && f.source !== 'text' && f.source !== 'both') return null;
    flags.push({ type: f.type, reason: f.reason.trim(), confidence: f.confidence, source: f.source, auto_masked: false });
  }

  return { title: r.suggested_title.trim(), description: r.suggested_description.trim(), category, flags };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

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

    const { listingId, photoUrl, title, description } = await req.json();
    if (!listingId || typeof listingId !== 'string') return json({ ok: false, error: 'listingId is required' }, 400);
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

    // Task 1 - deterministic, always runs, no AI call.
    const { maskedTitle, maskedDescription, flags: deterministicFlags } = runDeterministicChecks(rawTitle, rawDescription);

    const { data: categoryRows, error: categoryError } = await supabase
      .from('categories')
      .select('id, name')
      .eq('active', true);
    if (categoryError || !categoryRows || categoryRows.length === 0) {
      return json({ ok: false, error: 'No categories available' });
    }
    const categoryNames = categoryRows.map((c: { name: string }) => c.name);

    // Task 2 - contextual AI check (photo + post-mask text together), one OpenRouter call.
    let aiResult: ValidAIResult | null = null;
    const openRouterKey = Deno.env.get('OPENROUTER_API_KEY');
    if (openRouterKey && (photoUrl || maskedTitle || maskedDescription)) {
      aiResult = await runAiCheck(openRouterKey, categoryNames, maskedTitle, maskedDescription, typeof photoUrl === 'string' ? photoUrl : null);
    }

    const allFlags: Flag[] = [...deterministicFlags, ...(aiResult?.flags ?? [])];

    // Every flag is logged unconditionally at analysis time, before the client ever sees the
    // response - a client dismissing the notice (or never showing it) can't suppress this.
    if (allFlags.length > 0) {
      const serviceClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      await serviceClient.from('listing_flags').insert(
        allFlags.map((f) => ({
          listing_id: listingId,
          type: f.type,
          reason: f.reason,
          confidence: f.confidence,
          source: f.source,
          auto_masked: f.auto_masked,
        })),
      );
    }

    const categoryId = aiResult
      ? categoryRows.find((c: { name: string; id: string }) => c.name === aiResult!.category)!.id
      : null;

    return json({
      ok: true,
      masked: { title: maskedTitle, description: maskedDescription, changed: deterministicFlags.some((f) => f.type === 'contact_info') },
      suggestion: aiResult ? { title: aiResult.title, description: aiResult.description, categoryId } : null,
      flags: allFlags.map((f) => ({ type: f.type, reason: f.reason, confidence: f.confidence, source: f.source })),
    });
  } catch (err) {
    console.error('analyze-listing-photo error:', err);
    return json({ ok: false, error: 'Unexpected error' }, 500);
  }
});

async function runAiCheck(
  openRouterKey: string,
  categoryNames: string[],
  title: string,
  description: string,
  photoUrl: string | null,
): Promise<ValidAIResult | null> {
  const systemPrompt = [
    'You help renters write a listing for a peer-to-peer rental marketplace, and screen it for problems.',
    'You are given the current title/description text (already screened for clearly-formatted phone ' +
      'numbers and emails - do not re-flag those) and, if provided, a photo of the item.',
    'Respond with ONLY a single JSON object, no other text, matching exactly this shape:',
    '{"suggested_title": string, "suggested_description": string, "suggested_category": string, ' +
      '"flags": [{"type": "prohibited_item" | "drug_related" | "other_guideline", "reason": string, ' +
      '"confidence": "low" | "medium" | "high", "source": "photo" | "text" | "both"}]}',
    `"suggested_category" MUST be exactly one of these existing categories: ${categoryNames.join(', ')}.`,
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
  ].join('\n');

  const userText = ['Current title:', title || '(none yet)', 'Current description:', description || '(none yet)'].join('\n');

  const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
    { type: 'text', text: userText },
  ];
  if (photoUrl) content.push({ type: 'image_url', image_url: { url: photoUrl } });

  try {
    // OpenRouter's OpenAI-compatible endpoint, called directly with our own OpenRouter key -
    // sidesteps the Gemini-key-specific auth issue found in isolated testing (that key was
    // rejected from Supabase's Edge Runtime egress even though it worked from a local machine).
    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
        max_tokens: 800,
      }),
    });

    if (!aiResponse.ok) {
      console.error('OpenRouter call failed:', aiResponse.status, await aiResponse.text());
      return null;
    }
    const aiJson = await aiResponse.json();
    const responseText: unknown = aiJson?.choices?.[0]?.message?.content;
    if (typeof responseText !== 'string' || !responseText.trim()) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      return null;
    }
    return validateAIResult(parsed, categoryNames);
  } catch (err) {
    console.error('OpenRouter call failed:', err);
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

