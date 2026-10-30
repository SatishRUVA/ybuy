import { existsSync, readFileSync } from 'node:fs';

export interface TestActor {
  id: string;
  email: string;
  password: string;
  name: string;
}

export function loadTestActors(hosted: boolean): TestActor[] {
  const candidates = hosted
    ? ['test-accounts.json', 'ybuy-hosted-test-accounts.local']
    : ['ybuy-test-accounts.local'];
  const accountFile = candidates.find(existsSync);
  if (!accountFile) throw new Error(`Missing test account file: ${candidates.join(' or ')}`);

  const source = readFileSync(accountFile, 'utf8').trim();
  const document = source.startsWith('{') ? source : `{${source}}`;
  const parsed = JSON.parse(document) as { accounts?: TestActor[] };
  if (!Array.isArray(parsed.accounts) || parsed.accounts.some((actor) =>
    !actor.id || !actor.email || !actor.password || !actor.name)) {
    throw new Error(`Invalid accounts in ${accountFile}`);
  }
  return parsed.accounts;
}