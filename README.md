# ybuy

[Owner & Renter validation status report](docs/implementation/OWNER_RENTER_VALIDATION_STATUS.md)
separates verified local behavior, unresolved failures and hosted release gates.

## Owner and Renter implementation increment (2026-10-21)

The listing detail uses a gallery-led, two-column desktop layout with one sticky
booking panel (non-sticky on short screens). On mobile the same panel follows
the gallery, and a bottom **Review booking** shortcut sits above the existing
navigation. One date-range picker handles availability; rental, configured
service fee, refundable deposit and estimated total appear before requesting.
Tax is not calculated by the current estimate; this is disclosed rather than
inventing a tax amount. Checkout still uses backend-authoritative prices, owner
approval and the existing fifteen-minute payment reservation. Eligible listings
retain secondary offers only when bidding is enabled. Owner reviews do not imply
identity verification, account age or a completed-rental count.

The current implementation adds stable Customer IDs; private country and
region settings; server-side five-mile discovery with optional dates; listing
value/condition and revision-safe edits; fifteen-minute payment reservations;
immutable rental snapshots; listing bidding rules and a real top-five feed; and
coordinate-based Request an Item matching.

Apply the additive `20261021000005` through `20261021000023` migrations with
`npx supabase migration up --local`. Do not reset a database containing retained
payment or agreement evidence. The isolated
[hosted test application](https://ybuy-e2e-test.vercel.app) received migrations
05–23, all nine current Edge Functions and the latest frontend on 2026-10-21.
Its existing test-site authenticator setup is unchanged. All 16 hosted smoke
cases passed (ten account sessions, five booking-to-payment-pending journeys and
invalid-password rejection). Production is unchanged. Hosted Stripe credentials,
approved legal terms and complete paid/recovery journeys remain release gates.

The isolated test site's `bidding` flag is enabled. Its five published Owner
fixture listings accept offers, with five persisted synthetic Renter offers for
the top-five news ribbon. These demo offers expire seven days after creation;
they are not real customer demand and are not automatically renewed. The banner
appears above marketplace page content, refreshes every 15 seconds, and retains
keyboard-accessible bid links. It stays visible with an honest
empty state when enabled but no eligible offers exist. Production flags are unchanged.
The compact, approximately 72px dark emerald ribbon scrolls continuously like a
TV news feed, with mint prices, gold ranks and a slow heartbeat glow on LIVE BIDDING.
It has no navigation arrows or separate pause/resume buttons. The LIVE BIDDING
badge toggles motion; hover pauses scrolling, and keyboard focus or reduced-motion
preferences expose a static, wrapping list with no glow animation. Duplicate visual
copies are hidden from screen readers and keyboard navigation. Missing or failed images
show an item icon; the banner never invents percentage gains or bid activity.

- The server, not the browser countdown, controls checkout expiry. A late
  verified payment must revalidate inventory; conflicts enter a private
  reconciliation queue rather than displacing another renter.
- Agreement snapshots without approved legal terms are explicitly operational
  records, not approved rental contracts. A Super Admin can publish externally
  approved terms in Global Settings. Historical snapshots are never rewritten.
- New publications require an Owner-declared item value and condition. Category
  deposit suggestions are editable within configured limits; a declared value
  is neither insurance coverage nor an independent appraisal.
- Request locations require an explicit city/postal-code selection. Matching is
  based on coordinates, dates, quantity, category and budget, not city-name
  substrings. More than 100 matches are processed across durable batches.
- Country and region are optional self-reported profile fields, separate from
  the permanent Customer ID and payment currency. New rentals snapshot them;
  existing transactions are not retroactively populated. Public profile joins
  cannot read them. The reference uses pinned MIT-licensed
  `country-region-data@4.1.0`: 249 countries/territories and 4,208 coded
  subdivisions. Uncoded source entries are not invented as valid region codes.
  Generate a future additive reference refresh with
  `node scripts\build-region-reference.mjs <new-migration.sql>`; review it before
  applying, retaining old codes needed by historical records.
- Authorized investigations can filter and group a bounded Customer ID batch
  by current self-reported country/subdivision before pagination. Invalid and
  unknown IDs remain visible. Each query and its geographic filters are audited;
  country changes never generate a fraud verdict or invented risk score.

Hosted Stripe configuration, real provider-side session expiration, legal-policy
approval, bank payouts and the complete paid browser journey remain separate
acceptance gates. A successful build does not establish any of these.

## Local lifecycle test accounts

The sign-in dialog uses Supabase email/password sign-in and registration instead
of social sign-in. It preserves the destination route and existing session/RLS
checks. Registration displays a confirmation notice when Auth requires email
verification; the client never treats an unverified signup as authenticated.
Hosted deployments must enable email Auth in their own project settings.

Local `supabase/config.toml` enables email/password Auth for isolated test actors.
Production hosted Auth settings are unchanged. Restart local Supabase after changing that
configuration. With it running, create or reuse five Owner and five Renter test
personas with real password authentication:

```powershell
$status = npx supabase status --output json
if ($LASTEXITCODE -ne 0) { throw 'Local Supabase must be running.' }
($status -join "`n") | node --experimental-websocket scripts\seed-local-test-users.mjs
```

By default the script accepts only `http://127.0.0.1:54321`, never loads hosted environment
files, and refuses to overwrite unrelated users. Accounts use
`owner1@example.test` through `owner5@example.test` and
`renter1@example.test` through `renter5@example.test`. Generated passwords are
saved to the Git-ignored `ybuy-test-accounts.local` file; keep it private.
Rerunning reuses these accounts and verifies real sign-in, profile/session
identity, wrong-password rejection and sign-out. No emails are sent.

These are admin-created fixtures, not registration E2E passes.
Owner/Renter are test personas, not exclusive permission roles.

The separate demo-catalog script also requires explicit `DEMO_MODE=true` and
accepts only the exact local Supabase URLs. Disabled mode makes no changes;
it never removes existing data. Missing local service credentials fail explicitly.

## Isolated deployed test environment

The standalone test app is https://ybuy-e2e-test.vercel.app and uses only Supabase
project `jzyjmsixfuwzfnntewqn` (`ybuy-e2e-test`), not the production backend.
Its banner identifies it as a test environment. Production application/backend
settings are unchanged. Hosted email confirmation remains enabled. The existing
Resend integration is configured with its sandbox sender; all application and
Auth verification emails are redirected only to `satish.babu1777@gmail.com`.
The unverified `ybuy.com` sender domain is not used.

The test site requires the existing shared authenticator-code access gate,
using new test-only secrets. This is an additional site gate, not per-account
Supabase MFA. Provision the test seed privately in your authenticator. Hosted
Playwright runs require `YBUY_E2E_GATE_SECRET`; tests submit genuine TOTP codes
to obtain the secure access cookie rather than manufacturing sessions.

Notification emails include escaped HTML, a plaintext alternative, intended
test actor, booking/item/dates and authoritative price and settlement details.
The first rendered notification payload is frozen for retry stability.
Resend acceptance is `sent`; only a signed provider receipt marks it `delivered`.
The five-minute scheduler is bound to this test backend through Vault.
`send-test-auth-email` is a signed, test-only Supabase Send Email Hook for signup,
recovery, magic links, invitations, reauthentication and email changes. It
preserves real verification tokens and restricts redirects to the test app.
Auth email rate limits remain enforced; HTTP 429 is not a successful send.

The account script has an explicit `--hosted-test` mode restricted to that exact
test project. Supply `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY` JSON through stdin
from that project's CLI output; never use production keys. Hosted passwords are
saved to Git-ignored `ybuy-hosted-test-accounts.local` and differ from local ones.
`--with-listings` creates/reuses five published synthetic camera listings for
manual testing, using authenticated Owner APIs rather than a simulated backend.
They are persistent fixtures, not proof that the listing wizard passed.

Run real browser checks with:

```powershell
$env:NODE_OPTIONS = '--experimental-websocket' # Node 20; not needed on Node 22+
npx playwright test --config playwright.local.config.ts
npx playwright test --config playwright.hosted.config.ts
```

Local tests use real local Supabase keys obtained from the running CLI; hosted
tests are hard-bound to the separate test URL/backend. Tests never confirm
payment synthetically. Fixtures without rental agreements are deleted.
Agreement-backed fixtures are instead cancelled when unpaid and taken out of
public inventory; immutable bookings/agreements are retained and identified in
test attachments. The ten accounts and optional manual-test listings remain available.
HTML reports are in `playwright-local-report` / `playwright-hosted-report`.
Reports, traces and credentials are ignored by Git and excluded from deployment.
Keep traces private because they can contain authenticated requests.
The latest hosted run passed all ten account-session tests, all five real
request/approval pairs and invalid-password rejection (16 passed). The two local
auto-confirm registration tests are intentionally skipped on hosted Auth.
A separate real UI registration, delivered HTML confirmation and verified
email-link sign-in passed. Password-recovery email verification remains blocked
by Auth's HTTP 429 email-send quota; no rate limit was disabled to bypass it.

Payment, pickup, return, completed-review and payout E2E verification remains
blocked on the hosted test site until its Stripe sandbox secrets/webhook are
configured. Local sandbox Checkout, charged-deposit refund and Stripe Connect
transfer have been verified separately; a Connect balance transfer is not
confirmation of a bank payout. Cancellation refunds remain disabled pending a
policy decision. Settlement functions fail closed outside explicitly allowed
test backends and test-mode credentials.
Listing publication through the UI also needs a test Google Maps key: currently
the wizard requires address selection and has no manual-address fallback.

## Category artwork

Home's category tiles use fixed artwork defined in `src/lib/listings.ts`.
Publishing or editing listings never changes category thumbnails. Categories
without mapped artwork use their category icon.

## Super Admin Vault Chest

The admin console includes a Super Admin-only Vault Chest at `/admin/vault`.
It requires Supabase Auth TOTP step-up verification; Postgres checks the active
Super Admin role, verified factor, `aal2` JWT and a five-minute TOTP age on
every vault RPC. The UI locks and clears its secret field when that interval
expires. Secrets are write-only in the page, encrypted by Supabase Vault, and
excluded from audit payloads.

This is a storage foundation, not a migration or runtime-secret source. No
existing `.env`, Edge Function, OAuth, deployment or hosted secret values were
moved. Stripe/Resend/provider integrations continue reading their existing
server-side environment configuration. The initial allowlist is Stripe,
Resend and OpenRouter only; Supabase/service-role, Google OAuth and signing
credentials remain in platform secret stores. To make entries operational,
separately review provider-specific cutover and deployment procedures.

Apply [migration 12](supabase/migrations/20261018000012_super_admin_vault.sql)
and enable authenticator enrollment/verification in Supabase Auth before
unlocking the page. TOTP is enabled in the local `supabase/config.toml` only;
hosted Auth configuration was not changed. Migration and a real Authenticator
flow were verified against local Supabase; nothing was deployed to hosted
Supabase.

Run local policy and real TOTP/encrypted-write checks with
`npx supabase test db supabase\tests\super_admin_vault.sql --local` and
`node --experimental-websocket scripts\verify-vault-local.mjs`. The smoke
script uses temporary local test credentials, refuses to overwrite a populated
test slot, and cleans up its test account and value.

## Item requests and rental offers

`/requests` lets signed-in renters post and manage item requests. Owners can
discover active requests, submit offers, link published listings and negotiate
through a persistent proposal history. Real offers remain in `/requests`.

`/bidding` and `/auction/:id` are mock-only demo routes using the existing sample
auctions. Enable `mock_bidding` in Admin Feature flags to show the Home demo rail
and allow demo bids. Disabling it immediately hides the rail and replaces both
demo routes with an offline banner. Demo bids live only in page memory, reset
when leaving the auction or disabling the flag, and never create real offers,
bookings or payments. The independent `bidding` flag does not enable this demo.

The `item_requests` feature flag controls request discovery, creation and
request-based offers. The `bidding` flag controls direct offers on listings that
opted into negotiation and all counteroffers. Both flags remain off by default
and are managed in Admin Feature flags. Admins with `listings.moderate` can review
and close active requests with an audited reason.

Accepting an offer creates a booking in `pending_payment`; it does not confirm
payment. Existing Stripe Checkout and the signature-verified webhook remain the
source of truth for confirmation. Fixed-price booking remains available and
unchanged. Listings default to quantity 1 and negotiation disabled.

The database implementation is in
[20261018000006_item_requests_and_negotiation.sql](supabase/migrations/20261018000006_item_requests_and_negotiation.sql).
Run its focused SQL assertions locally with
`npx supabase test db --local`; do not apply this migration to hosted Supabase
without separate authorization.

## UI/UX skill

[UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) is installed
for this project in [.github/skills/ui-ux-pro-max](.github/skills/ui-ux-pro-max).
Source: `ui-ux-pro-max-cli@2.15.0` (MIT). The installer output is adapted from the
legacy Copilot prompt layout to a discoverable `SKILL.md`, with Windows script paths.
Only the requested skill is included.

Start a new Copilot session after installation to discover the skill. Python 3 is
required for its local searches; no additional Python packages are needed.

```powershell
python .github\skills\ui-ux-pro-max\scripts\search.py "keyboard focus" --domain ux -n 1
```

The skill provides guidance; repository instructions still govern implementation.
Preserve YBuy's existing Vite/React UI and design system.

## 21st MCP in VS Code

The local [.vscode/mcp.json](.vscode/mcp.json) configuration already registers `21st`
using streamable HTTP at `https://21st.dev/api/mcp`. It sends `x-api-key` through
`${input:21st_api_key}`, a password-masked VS Code input, rather than a literal key.
This local configuration is ignored by Git.

1. Run **MCP: List Servers** in the VS Code Command Palette.
2. Select **21st**, start the server, approve trust if prompted, and enter your API
   key in VS Code's password prompt. Do not paste the key into chat or source files.
3. In chat's **Configure Tools** menu, enable the 21st tools and confirm `search`
   and `get_component` are listed. Start a new chat session if tools are not refreshed.

Configuration alone does not establish a verified connection: successful
authentication and tool discovery are required.

## Notifications and email

In-app notifications are persisted in Supabase and are created from booking
state changes, new messages, marketplace notifications, case notifications and
reviews. Row-level security limits notification history and preferences to the
signed-in recipient. Email jobs are written transactionally with those events;
Resend calls are made only by the server-side `send-notification-emails`
Edge Function. Signed-in users can process their own queue; a Vercel Cron
endpoint can process the global queue using a separately shared worker secret.
Resend webhooks update accepted email jobs to delivered or failed after
signature verification.

For local development, keep `RESEND_API_KEY` in the ignored `.env.local` file,
set `RESEND_FROM_EMAIL`, `PUBLIC_APP_URL`, and a controlled
`NOTIFICATION_TEST_RECIPIENT`, then run:

```powershell
npx supabase functions serve --env-file .env.local
```

Email is redirected to `NOTIFICATION_TEST_RECIPIENT` unless the trusted
Edge Function environment explicitly sets `NOTIFICATION_LIVE_DELIVERY=true`.
Production requires a Resend-verified sender domain and matching
`RESEND_FROM_EMAIL`; configure a `RESEND_WEBHOOK_SECRET` for the `resend-webhook`
function and subscribe it to email sent, delivered, bounced, complained and
failed events. Configure the public Vercel origin in `PUBLIC_APP_URL` and the
Supabase `APP_ORIGIN` allowlist. Never use a `VITE_` prefix for provider
credentials.

Retries are bounded to five attempts, use exponential backoff and the same
Resend idempotency key. Messages are batched per conversation for email for
five minutes; in-app message notices are not throttled. Resend acceptance is
recorded as `sent`, never `delivered`; signed provider webhook events provide
delivery state. Each worker invocation processes up to ten jobs. Supabase Cron
runs every five minutes using `pg_cron` and `pg_net`, independently of Vercel's
Hobby plan. Migration 11 creates the schedule and generates a worker secret in
Vault. Set Vault's `notification_project_url` to your Supabase project URL and
copy Vault's `notification_worker_secret` into the Edge Function's
`NOTIFICATION_WORKER_SECRET` server environment; never expose it to clients.

Supabase migrations through `20261018000011`, all six Edge Functions, and the
Vite app at `https://ybuy.vercel.app` were deployed on 2026-10-18. The existing
temporary access gate remains enabled. Hosted email stays in test-recipient
mode with the Resend test sender; email links now target the production app.
A worker check processed one queued email accepted by Resend. Actual delivery
confirmation still requires Resend webhook registration/signing-secret setup.
## Live feature flags

Database-backed feature flags use one shared Supabase Realtime/WebSocket
subscription per active app instance. Admin flag switches and the implemented
`item_requests` / `bidding` consumers update without refresh, focus, or navigation.
The current bidding route is the requests/offers implementation, not the earlier
mock auction; the retained `mock_bidding` row does not activate a mock page.

Apply [migration 10](supabase/migrations/20261018000010_feature_flags_realtime.sql)
to publish flag changes. The client waits for the database subscription before
loading its snapshot, refetches after insert/update/delete events and reconnects,
and retries failed reads automatically. Disconnected consumers show an error
and temporarily disable feature actions rather than trusting stale enabled flags.
Delivery is network-dependent, not a zero-latency guarantee. Database permissions,
RLS, mutation-time feature checks and financial gates remain authoritative.

Flags without implemented consumers do not activate unavailable modules.
Build-time UI constants in `src/lib/feature-flags.ts` remain build-time switches,
not database flags. Focused checks (with Vite running on port 5174):

```powershell
npx playwright test feature-flag-store.spec.ts marketplace.spec.ts --workers=1 --output "$env:TEMP\ybuy-realtime-tests"
```
