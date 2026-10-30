import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const source = readFileSync('supabase\\functions\\analyze-listing-photo\\index.ts', 'utf8')
  .replace(/^import .*;\r?$/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const suggestion = {
  suggested_title: 'Camera case', suggested_description: 'A camera carrying case with a zip closure.',
  suggested_brand: 'Sony', suggested_model: 'LCS-U21',
  suggested_category: 'Electronics', flags: [], photo_quality_suggestions: [],
};
const providerResponse = (value: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });

function runtime(fetch: typeof globalThis.fetch) {
  const timeouts: number[] = [];
  const hooks: {
    runAiCheck: (key: string, categories: string[], title: string, description: string, photos: string[]) => Promise<unknown>;
  } = runInNewContext(`${compiled}\n({ runAiCheck });`, {
    Deno: { serve() {}, env: { get() { return undefined; } } },
    withCors: (handler: unknown) => handler,
    console: { error() {} },
    fetch,
    AbortSignal: { timeout(ms: number) { timeouts.push(ms); return AbortSignal.timeout(ms); } },
    setTimeout: (callback: () => void) => { callback(); },
  });
  return { analyze: () => hooks.runAiCheck('test-key', ['Electronics'], 'Camera case', '', []), timeouts };
}

test('listing AI retries a transient provider failure once with bounded attempt timeouts', async () => {
  let attempts = 0;
  const { analyze, timeouts } = runtime(async (_url, options) => {
    expect(options?.signal).toBeTruthy();
    expect(JSON.parse(String(options?.body)).model).toBe('openai/gpt-4o-mini');
    attempts += 1;
    return attempts === 1 ? new Response('', { status: 503 }) : providerResponse(suggestion);
  });
  expect(await analyze()).toMatchObject({ title: 'Camera case', category: 'Electronics', brand: 'Sony', model: 'LCS-U21' });
  expect(attempts).toBe(2);
  expect(timeouts).toEqual([18_000, 18_000]);
});

test('listing AI reports exhausted key limits without retrying or leaking provider details', async () => {
  let attempts = 0;
  const { analyze } = runtime(async () => {
    attempts += 1;
    return Response.json({ error: { message: 'private operator details', metadata: { limit_source: 'openrouter_key_limit' } } }, { status: 403 });
  });
  await assert.rejects(analyze(), /AI provider credits or usage limit are exhausted/);
  expect(attempts).toBe(1);
});

test('listing AI reports authentication failures without retrying', async () => {
  let attempts = 0;
  const { analyze } = runtime(async () => { attempts += 1; return new Response('', { status: 401 }); });
  await assert.rejects(analyze(), /AI provider authentication failed/);
  expect(attempts).toBe(1);
});

test('listing AI stops after two transport failures and allows manual entry', async () => {
  let attempts = 0;
  const { analyze } = runtime(async () => { attempts += 1; throw new DOMException('Timed out', 'TimeoutError'); });
  await assert.rejects(analyze(), /Please retry or enter details manually/);
  expect(attempts).toBe(2);
});

for (const [name, result] of [
  ['null moderation flag', { ...suggestion, flags: [null] }],
  ['unknown category', { ...suggestion, suggested_category: 'Invented category' }],
  ['missing quality array', { ...suggestion, photo_quality_suggestions: undefined }],
  ['missing brand', { ...suggestion, suggested_brand: undefined }],
  ['numeric model', { ...suggestion, suggested_model: 123 }],
  ['blank brand', { ...suggestion, suggested_brand: '  ' }],
  ['overlong model', { ...suggestion, suggested_model: 'x'.repeat(81) }],
]) {
  test(`listing AI rejects ${name} rather than fabricating a suggestion`, async () => {
    const { analyze } = runtime(async () => providerResponse(result));
    await assert.rejects(analyze(), /AI returned invalid suggestions/);
  });
}

test('listing AI leaves unidentifiable brand and model null rather than guessing', async () => {
  const { analyze } = runtime(async (_url, options) => {
    const prompt = JSON.parse(String(options?.body)).messages[0].content;
    expect(prompt).toContain('never guess');
    return providerResponse({ ...suggestion, suggested_brand: null, suggested_model: null });
  });
  expect(await analyze()).toMatchObject({ brand: null, model: null });
});

const clientSource = ['src\\lib\\text-safety.ts', 'src\\lib\\listing-ai.ts', 'src\\lib\\listing-item-details.ts']
  .map(path => readFileSync(path, 'utf8').replace(/^import .*;\r?$/gm, '').replace(/^export /gm, ''))
  .join('\n');
const clientCompiled = ts.transpileModule(clientSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function clientRuntime(identity: Record<string, unknown>) {
  const hooks: {
    moderateListingContent: (params: { listingId: string; title: string; description: string }) => Promise<{
      suggestion: { brand: string | null; model: string | null };
    }>;
    listingItemDetailsError: (details: { brand: string; model: string; included_items: string[]; additional_details: string; delivery_radius_miles: null }) => string | null;
  } = runInNewContext(`${clientCompiled}\n({ moderateListingContent, listingItemDetailsError });`, {
    supabase: { functions: { invoke: async () => ({ data: {
      ok: true, masked: { title: '', description: '', changed: false }, flags: [],
      suggestion: { title: 'Camera', description: 'Camera with a carrying case.', categoryId: null, ...identity },
    } }) } },
    AbortSignal,
  });
  return {
    analyze: () => hooks.moderateListingContent({ listingId: 'test-listing', title: '', description: '' }),
    validate: hooks.listingItemDetailsError,
  };
}

test('listing AI client accepts and trims brand and model and tolerates older hosted responses', async () => {
  expect((await clientRuntime({ brand: ' Sony ', model: ' FX3 ' }).analyze()).suggestion).toMatchObject({ brand: 'Sony', model: 'FX3' });
  expect((await clientRuntime({}).analyze()).suggestion).toMatchObject({ brand: null, model: null });
});

for (const identity of [{ brand: 123 }, { model: '<script>bad</script>' }, { brand: ' ' }, { model: 'x'.repeat(81) }]) {
  test(`listing AI client rejects invalid identity ${JSON.stringify(identity)}`, async () => {
    await assert.rejects(clientRuntime(identity).analyze(), /AI returned invalid item identity/);
  });
}

test('listing identity is optional while supplied values remain validated', () => {
  const { validate } = clientRuntime({});
  const details = { brand: '', model: '', included_items: [], additional_details: '', delivery_radius_miles: null };
  expect(validate(details)).toBeNull();
  expect(validate({ ...details, brand: 'Sony' })).toBeNull();
  expect(validate({ ...details, model: 'FX3' })).toBeNull();
  expect(validate({ ...details, brand: 'Sony', model: 'FX3' })).toBeNull();
  expect(validate({ ...details, brand: 'x'.repeat(81) })).not.toBeNull();
});
