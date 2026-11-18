# Implementation decisions and setup

Date: 2026-10-18.

## Owner and Renter completion increment (2026-10-21)

- Preserve Vite/React, current routing, tokens, components and independent
  transactional Owner/Renter personas. No role migration or UI replacement.
- All new identity/search/listing/checkout/agreement/bidding/matching/geography
  migrations are applied locally only. Production and the isolated hosted
  deployment are unchanged by this increment.
- The private, append-only Customer ID registry retires issued numbers and
  preserves canonical Auth UUIDs. Public listing/profile reads do not expose
  Customer IDs or investigation data.
- Investigators can filter/group current self-reported country/subdivision
  within the existing bounded batch, before pagination. Unknown/invalid IDs
  remain visible. Reuse the existing audited, permission-checked, rate-limited
  activity query; separately audit geographic filters/grouping. Missing areas
  sort last explicitly, without relying on locale-dependent sentinel ordering.
  Risk-level filtering is not invented without justified risk classifications.
- Five-mile search runs before pagination in Postgres/PostGIS. Dates are
  optional; selected zero coordinates remain valid. No automatic IP or GPS
  lookup is performed. Anonymous calendars expose capacity dates, not bookings.
- Material listing changes and photos/pickup changes cannot replace an item
  during an approved rental. Future prices remain editable without rewriting
  booked prices. Revision checks reject stale saves. Owners cannot self-assign
  verification through direct API writes.
- Use server-issued fifteen-minute checkout deadlines and a minute-level
  expiration scheduler. Provider session creation retains a stable idempotency
  key; Stripe's minimum thirty-minute expiry is not misrepresented as fifteen
  minutes. The separate test-only expiration worker must still be deployed and
  provider-verified.
- Late verified payments may reclaim only genuinely free inventory. Conflicts
  persist as financial exceptions, with an explicit no-second-payment message.
  Automatic refunds or exception resolution are not invented without policy.
- Persist immutable agreement snapshots at approval, including value,
  condition, photos, totals and policy version. No legal text is fabricated.
  No approved template means acceptance is disabled. Payment acceptance-gating
  remains a business decision; existing fixed-price behavior is preserved.
- Real bidding uses persisted current eligible renter proposals, not the
  separate mock auction demo. The public ticker excludes identity/proposal IDs,
  stale revisions, expired/withdrawn negotiations and unavailable inventory.
  Reduced-motion, pause and keyboard controls preserve existing UI patterns.
- Request matching uses live server eligibility and a durable bounded queue.
  Notification keys deduplicate per Owner/request and Renter/listing. Closing,
  making private or expiring a request suppresses future eligible email work.
  Already in-flight provider requests cannot be retracted.
- Country/subdivision validation uses pinned, MIT-licensed
  `country-region-data@4.1.0`, not a regex presented as a worldwide reference.
  The generated migration includes the upstream license and normalizes codes.
  Countries are ISO alpha-2; subdivision codes follow that reference, not an
  assertion that every upstream subdivision is independently ISO-certified.
  Optional self-reported profile geography is private; the server timestamps
  changes and freezes geography with new bookings/agreements. Currency remains
  explicitly USD for the current payment implementation, never inferred from
  country. Do not infer historical locations or build cross-border fraud scores
  from country changes. Retention duration still requires an approved policy.
- Immutable legal/financial test records are retained, not force-deleted.
  Unpaid fixtures are cancelled and their listings unpublished; attachments
  identify retained records. No production data is involved.

## Isolated test email and site access (2026-10-21)

- Target only Supabase `jzyjmsixfuwzfnntewqn` and the separate Vercel
  `ybuy-e2e-test` project; no production backend or site changes.
- Reuse Resend with `YBuy Test <onboarding@resend.dev>` because the configured
  `ybuy.com` domain is unverified. Redirect every test notification and Auth
  email to the explicitly approved `satish.babu1777@gmail.com` inbox.
- Keep email verification enabled. A signed Supabase Send Email Hook handles
  real Auth verification tokens and restricts redirects to the isolated test
  app. Secure email change retains both old/new confirmations with the
  documented reversed token-hash mapping. Test-only guards fail closed.
- Notification details are service-only and verify booking participation;
  never include pickup addresses or private message bodies. Persist the first
  rendered provider payload so changing booking state cannot change retries.
- Register a separate signed Resend delivery webhook. Confirmed actual
  notification deliveries and a real UI signup/emailed-link confirmation;
  preserve Auth rate limits and report HTTP 429 instead of claiming delivery.
- Enable the existing shared TOTP site gate with fresh test-only secrets.
  This is not individual user MFA. Provisioning and signing secrets stay in
  private files/platform stores and never enter Vite client variables.
- Apply settlement migrations and deploy handlers to the isolated backend;
  hosted monetary execution still requires its own test Stripe secrets and
  signed webhook configuration. Locally verified deposit refunds/Connect
  transfers do not prove bank payouts or define cancellation-refund policy.

## Super Admin Vault Chest

- Add `/admin/vault` only to the existing Super Admin console navigation;
  backend RPCs independently require an active `super_admin` row.
- Require Supabase Auth TOTP step-up verification. Every status/write request
  verifies `aal2`, a currently verified TOTP factor, an `amr` TOTP timestamp
  no older than five minutes, the active admin session and current role.
- Use Supabase Vault for encrypted storage. The browser may add or replace
  allowlisted values and see configured/version/timestamp metadata only. Never
  return secret text or raw Vault identifiers. Keep audit values and reason
  fixed/generic so user-submitted credentials cannot enter the audit log.
- Use an explicit five-entry integration allowlist (Stripe, Resend, OpenRouter).
  Platform bootstrap credentials, Google OAuth provider credentials,
  deployment-signing keys and client/public `VITE_` config are excluded.
- **Do not migrate current values.** Vault entries do not feed the running
  integrations. Provider cutover requires a separate, reviewed procedure to
  update server-side consumers and deployment environments.
- Local TOTP enrollment/verification enabled for verification. The user
  authorized local-only implementation; no hosted migration, Auth config
  change, secret migration or deployment is authorized/performed.
- Version-checked writes and an advisory lock prevent lost concurrent updates.
  Adding replacement behavior does not reveal, rotate or revoke the provider's
  existing credential.

## Reactive feature flags

- Use the installed Supabase Realtime client over WebSockets, not gRPC or polling.
  `useFeatureFlags` shares one lazy subscription across mounted consumers via
  React's `useSyncExternalStore`; no new provider or dependency is needed.
- Wait for the database-change subscription before taking a snapshot. Invalidate
  snapshots on every flag insert/update/delete and on reconnect. Discard a
  response if another event arrived while it was loading.
- Fail closed while disconnected or unable to load flags, surface the error,
  retry reads automatically and recreate unexpectedly closed channels.
- Admin flag controls, request creation/discovery and listing/request offers
  use this shared source. Preserve the other agent's requests/offers implementation;
  do not restore mock auction code or wire the retained `mock_bidding` row to it.
- Migration 10 adds only the Realtime publication membership; it does not change
  RLS, grants, enabled values, financial gates, or server-side authorization.
  Hosted membership and migration history were verified as applied during this
  pass; this pass itself did not execute a migration push.
- Unconsumed database flags remain descriptive; build-time UI constants are not
  runtime flags. Live propagation is subject to connection and network latency.

## Notification delivery

- Migration `20261018000008_notification_delivery.sql` consolidates existing
  marketplace/case notification records and captures booking transitions,
  messages, and reviews. In-app rows and private email jobs are created by
  database triggers in the same transaction as their source records.
- Recipient RLS and preferences are enforced in Postgres. Each supported
  category has separate in-app and email controls; promotional messaging is
  disabled by default. Email jobs are private to trusted Edge Functions.
- Resend credentials are read only through `Deno.env` by server-side
  functions. Local delivery is redirected to `NOTIFICATION_TEST_RECIPIENT`;
  live delivery requires explicit `NOTIFICATION_LIVE_DELIVERY=true`.
- Provider acceptance means `sent`. Only a signature-verified Resend webhook
  can mark a job `delivered`. Retries are capped at five and use exponential
  backoff and a stable provider idempotency key.
- `send-notification-emails` processes a signed-in user's queue, or the global
  queue when authenticated by the Vault-backed worker secret, in batches of ten.
  Migration 11 schedules Supabase Cron every five minutes using `pg_net`.
  Vercel Hobby does not support this frequency; its redundant Cron proxy was
  removed. Scheduler execution is restricted to trusted database roles.
- With owner approval on 2026-10-18, deployed all six Edge Functions and all
  pending migrations through `20261018000010` to `xwmnfnhnnxxaarbfkqrp`.
  Uploaded the local Resend key without exposing it, configured the Resend test
  sender and owner-selected test inbox, and kept live delivery false. Email links
  target `http://127.0.0.1:5174`; the approved CORS allowlist includes production
  plus localhost/127.0.0.1 on ports 5173 and 5174. No email was sent.
- Subsequently deployed migration 11 and synchronized the generated Vault worker
  secret with the Edge Function. The scheduler is active; an automatic Cron run
  succeeded and a manual worker check processed one email accepted by Resend.
  Live delivery remains false. Email links now target `https://ybuy.vercel.app`.
  Production sender-domain verification and Resend webhook registration/signing
  secret setup remain outstanding.
- Deployed the current Vite workspace to Vercel production on 2026-10-18,
  preserving the existing access gate. Explicit Vite build/output settings and
  frontend environment variables prevent a missing-config production bundle.
  Deployment excludes local env files and backend/test sources. Private mirror
  tarball URLs in the pnpm lockfile were replaced with public npm URLs without
  changing package versions or integrity hashes.

## Item requests and rental offers (2026-10-19)

- Item requests and structured rental offers are implemented in the Vite app and
  additive migration `20261018000006_item_requests_and_negotiation.sql`.
- `item_requests` enables request creation/discovery and owner responses;
  `bidding` enables direct listing offers and counteroffers. Both flags default
  off. Feature flags gate the UI and are independently enforced by database
  mutation functions.
- Published listings default to one available unit and negotiation disabled.
  Owners explicitly opt into direct offers and may set quantity from 1 to 100.
- An accepted proposal creates a server-priced `pending_payment` booking. It
  neither confirms payment nor bypasses the existing Stripe webhook. Fixed-price
  booking remains available.
- Request images use private Storage with validated paths; request content,
  negotiation history, notifications and moderation records are database-backed.
  Admin request closure requires `listings.moderate` and an audited reason.
- The migration and marketplace SQL tests are local-validation scope only.
  Hosted migration application, live payment execution and deployment are not
  authorized by this feature request.

## Approved operations increment (2026-10-18)

- Subsequent deployment authorization: the project owner explicitly requested
  deploying the completed operations migration to hosted Supabase. Applied only
  `20261018000005_admin_operations.sql`; retained the disabled financial gate
  and all production execution restrictions. This supersedes the initial
  local-only deployment boundary, not the financial activation boundary.
- Scope: persistent disputes/claims, support tickets, platform-funded promotion
  administration and test-only wallet foundations within the existing workspace.
  Customer case intake, replies, private evidence and notifications support those modules.
- Development and verification use local Supabase only. No hosted migration,
  financial activation, automatic production reward, or production deployment is authorized.
- Preserve Admin/Super Admin with explicit permissions and optional Operations,
  Support, Disputes and Finance presets. Presets are assignments, not a second role system.
- Product-dispute filing deadlines and authoritative pickup/return policy remain
  unresolved. Record existing booking timestamps; do not invent handoff events.
  Booking/payment support never inherits a product-condition deadline.
- Refund request thresholds are proposed test defaults: up to USD 250 single
  authorization, over USD 250 two-person approval, over USD 1,000 senior approval.
  Initiators cannot provide the second approval. Refund execution stays disabled:
  component allocation, responsibility and treatment after owner payout are unresolved.
- Promotion and credit operations are test-only, platform-funded, rental-subtotal
  only, excluding fees/deposits, with no stacking. Owner-funded campaigns and referrals
  remain disabled. Proposed signup defaults: USD 5, 90-day expiry, 20% redemption
  ceiling and USD 1 minimum. Expiry must not be silently extended on restoration.
- No production credit restoration or refund is activated by a case decision.
  No separate deposit hold, automated payout, identity verification, or retention
  policy is introduced. Financial history and case records are preserved.
- Email is not reported delivered without a configured delivery provider and
  authoritative response. Persistent in-app notification records are the baseline.
- The additive operations migration is
  `20261018000005_admin_operations.sql`. Its database-owned financial test gate
  defaults disabled; ordinary Admin/Super Admin APIs cannot activate it.
  Trusted local test fixtures temporarily set `environment = 'local_test'` and
  restore the prior gate after execution. Never run that setup on hosted data.
- The existing Stripe Checkout amount and booking snapshots are unchanged.
  Test promotion redemption and credit reservation primitives do not apply a
  live checkout discount. Refund receipt reconciliation stores provider events
  separately from approval and execution; unmatched/mismatched outcomes remain
  actionable exceptions. Execution and credit restoration remain disabled.

## Admin and Super Admin (2026-10-19)

- Authorization is database-owned: `admin_users` maps an Auth user to `admin` or
  `super_admin`; an admin receives only the allowlisted permissions, while
  super admin receives the fixed complete catalog. UI visibility is not an
  authorization boundary. Every admin read/write RPC checks permission server
  side. Admin tables have RLS enabled and no client table policies.
- Bootstrap the first super admin only after that person signs in and a profile
  exists. A trusted project owner runs this once in the Supabase SQL editor,
  substituting the verified profile email:

  ```sql
  insert into public.admin_users (user_id, role, permissions)
  select id, 'super_admin', '{}' from public.profiles
  where lower(email) = lower('verified-admin@example.com')
  on conflict (user_id) do update set role = 'super_admin', permissions = '{}', active = true;
  ```

  Do not expose a public signup or client-side bootstrap. Subsequent grants,
  changes and revocations are made in `/admin/admins` and audited. At least one
  active super admin must remain; admins cannot edit their own access.
- Admin access covers overview, users, listings, bookings, payments, payouts,
  reviews and categories, plus the local operations increment above. Item
  request moderation uses `listings.moderate`; insurance and extended analytics
  remain visibly unavailable, not simulated.
- Initial feature flags default off. They do not enable code that has not shipped.
  Initial defaults are inserted only when a key is absent; deployments do not
  overwrite saved values.
- `platform_fee_pct` defaults to 10%, accepts 0–30%, and applies only to future
  booking requests. The booking row stores the rate/amount snapshot. Booking
  price on the server remains authoritative; listing and checkout displays are
  estimates only. Existing bookings are not repriced.
- Overview period metrics use `[from, to)` on record creation timestamps.
  GMV excludes deposits. Period rental/fee totals count confirmed and later
  booking states; refunds count payments marked `refunded`. Deposit exposure,
  payable outstanding, total users and listing counts are snapshots as of query
  time. Operations queues report their own filtered totals; the existing overview
  does not invent dispute, ticket, request or bid metrics.
- Deposit amounts are only reported as a database exposure estimate; the current
  Stripe integration does not implement a separate deposit hold/release flow.
- Sensitive actions require a 3–500 character reason. Successful writes record
  actor, timestamp, old/new values, reason and outcome in append-only audit.
  Invalid setting values are recorded as failed outcomes. Authorization denials
  are rejected but not audited.
- Integration status reports only whether server environment variables are
  configured; it never returns key values. The health Edge Function must be
  deployed before that screen is operational.

## Authentication UX

- Google is the implemented provider. One shared dialog handles sign-in and
  first-time registration; one account supports renting and lending.
- The Google picker always receives `prompt=select_account`.
- OAuth uses Supabase's PKCE flow. Supabase handles code exchange/session
  persistence; YBuy does not implement a separate token-exchange endpoint.
- Returns stay on the current origin and route, retaining booking/search query
  state. OAuth parameters and fragments are removed from the return URL.
- Native modal dialog semantics provide focus containment, Escape dismissal and
  focus restoration; the page cannot be interacted with behind the modal.
- Ordinary sign-out retains Supabase's existing global scope, ending the user's
  YBuy sessions across devices. It does not sign the browser out of Google.
- Account switching first signs out the current device's YBuy session with local
  scope, then opens Google's picker. Other devices are not signed out by switching.
- Account-specific React content is remounted on identity change. Old profile
  data is never exposed as the next user's profile.

## Routes

Public marketplace browsing: `/`, `/search`, `/listing/:id`, `/guidelines`.
The existing `/access` deployment gate is separate from Supabase authentication.

Require authentication: `/dashboard` (including legacy aliases), `/create-listing`,
`/checkout/:id`, `/confirmation/:id`, `/check-in/:id`, `/check-out/:id`,
`/profile`, `/favorites`, `/messages` and `/messages/:id`.
Out-of-scope routes retain their existing unavailable behavior.

Client gates are only UX. RLS, booking functions, session checks and authenticated
Edge Functions are the authorization boundary.

## Sessions and timeouts

- Local Supabase configuration uses a 3,600-second access-token lifetime with
  refresh-token rotation. A one-hour JWT is not a one-hour absolute session.
- No browser inactivity timer or custom absolute-session duration is introduced.
  Without an explicit Supabase limit, sessions refresh until ended/revoked.
- Hosted timeout settings have not been read or changed. Optional inactivity,
  time-box or single-session settings require a business decision and an eligible
  Supabase plan. Supabase evaluates these policies during refresh; do not promise
  an exact client-side inactivity deadline.
- The new session helper checks JWT expiry, the matching user/session row and
  `auth.sessions.not_after` when set. Signing out removes the session row, so
  protected database operations can reject the old JWT before its natural expiry.
- Authenticated RLS policies also guard Storage writes to the listing image bucket.
  Public listing images and intentional anonymous browsing remain public.
- Booking RPCs bypass RLS by design, so a booking statement trigger also checks
  active sessions. Service-role webhook processing and trusted DB maintenance
  remain separate from user-session checks.
- The browser hides private UI on expiry, rejects failed session verification and
  rechecks on focus/visibility changes. Network failures are not reported as
  successful logout.

Reference: [Supabase session lifecycle](https://supabase.com/docs/guides/auth/sessions).

## Account linking

Keep Supabase's built-in Google identity handling. Do not merge database users
because an email string matches, and do not insert profiles from the client.
The existing trigger inserts a profile by the Auth user ID and ignores duplicate
IDs. Reusing the same Google identity should reuse its Supabase user, but this has
not been verified against the hosted project. Facebook/Apple linking is not
implemented or verified.

## Required values and where they belong

Do not paste secrets into chat or commit them.

| Value | Where to configure | Browser-safe? |
| --- | --- | --- |
| Supabase project URL | Vercel/local `VITE_SUPABASE_URL` | Yes |
| Supabase publishable or legacy anon key | Vercel/local `VITE_SUPABASE_ANON_KEY` | Yes; RLS must be applied |
| Google OAuth Web application Client ID | Supabase Dashboard > Authentication > Sign In / Providers > Google | Not a secret, but no frontend OAuth client-ID variable is needed |
| Google OAuth Client Secret | Same Supabase provider settings, never `VITE_*` | No |
| Final production origin | Supabase URL Configuration and Google OAuth web-client configuration | Yes |
| Local Google client ID/secret, if running local Supabase | `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, read by [config.toml](../../supabase/config.toml) | Secret stays server-side |

No Supabase service-role key is required in the frontend or for the Google
sign-in button. Existing Edge Functions retain their separate server-side secrets.

### Dashboard configuration

1. In Google Cloud, create an OAuth **Web application** client and configure the
   consent screen. If it is in testing mode, add the intended Google test users.
2. In Google, allow the exact Supabase callback shown in its provider settings:
   `https://<project-ref>.supabase.co/auth/v1/callback`.
   This is not the frontend home page. Local Supabase uses its own callback.
3. Enable Google in Supabase and save its client ID and secret there.
4. Set the Supabase Site URL to the confirmed production origin. Allow return
   routes for that origin, for example `https://your-domain/**`, plus the precise
   local development origins. Do not allow arbitrary production domains.
5. Local config uses port 5173 for Vite, not the previous port 3000.
6. Keep nonce verification enabled. No manual account-linking feature is added.

## Facebook and Apple (code complete, not verified)

- The dialog renders one button per provider in `VITE_AUTH_PROVIDERS` (comma list, e.g.
  `google,facebook,apple`). Unset means Google only, so no button leads to a
  "provider is not enabled" error. Set it only after enabling the provider in Supabase.
- Google sends `prompt=select_account`; Facebook sends `auth_type=reauthenticate` when switching
  accounts; Apple has no account-chooser parameter and always prompts.
- Account linking is Supabase's behavior: identities with the same verified email link to one
  user. Apple "Hide My Email" relay addresses differ from the user's real email, so those create a
  separate YBuy account. Not verified against the hosted project.

| Provider | Values needed | Where |
| --- | --- | --- |
| Facebook | App ID, App Secret; Valid OAuth Redirect URI `https://<project-ref>.supabase.co/auth/v1/callback` | Supabase > Authentication > Providers > Facebook |
| Apple | Services ID, Team ID, Key ID, `.p8` private key (Supabase generates the client secret; it expires about every 6 months and must be rotated) | Supabase > Authentication > Providers > Apple |

## Listing field rules (Issues 7-11)

Defaults below are recommendations that need business confirmation.

| Field | Rule | Enforced |
| --- | --- | --- |
| Title | required, 3-100 chars, plain text | UI; DB trigger (max length, markup; 3+ chars to publish) |
| Description | **optional by default** (existing behavior); 10-2000 chars when provided; plain text. `VITE_LISTING_DESCRIPTION_REQUIRED=true` makes it required in the UI only | UI; DB trigger (max length, markup) |
| Price per day | USD, 1-5000, up to 2 decimals; no negatives, exponents, symbols, NaN or Infinity | UI (env can tighten); DB trigger (range) |
| Security deposit | USD, 0-10000, up to 2 decimals. Zero is allowed by default; `VITE_LISTING_MIN_DEPOSIT` can require more | UI; DB trigger (range) |

- Markup (`<tag`, `javascript:`) and control characters are rejected, never silently cleaned.
  React renders descriptions as text, so nothing is executed.
- Env overrides (`VITE_LISTING_MIN_PRICE`, `..._MAX_PRICE`, `..._MIN_DEPOSIT`, `..._MAX_DEPOSIT`)
  can only tighten the form. The database ceiling (5000 / 10000) changes by a new migration.
- The trigger checks a column only on INSERT or when it changes, so existing rows are never
  invalidated by unrelated updates. "Description required" is not enforced in the database.
- Publish and Continue are never silently disabled. Clicking shows an error summary, field-level
  messages, switches to the step with the first problem and focuses that field. Pickup confirmation
  has its own explicit message.

## Category loading (Issue 24)

Live reproduction was impossible: the Supabase host in `.env.local` does not resolve in DNS
(project likely paused or deleted). Defects found by code review and fixed:

- A category in the URL was passed straight into a UUID column filter. A name such as
  `/search?category=Electronics` produced a raw Postgres cast error. URLs now accept an id or a
  case-insensitive name, resolved against the real categories before any query; unknown values show
  a notice and all items.
- A failing listing-count request rejected the category load and broke the page. Counts are now
  non-fatal.
- The page ignored later category changes in the URL while mounted; it now follows them.
- The error message is friendly and has a retry. `searchListings` refuses non-UUID category ids.

Not confirmed as the production cause of the reported failure.

## Script and SQL injection protection

Free-text fields that are stored: listing title and description, pickup address parts, messages and
reviews. Search keywords and the city box are not stored.

- **Script injection:** these fields are plain text. Tags, `javascript:` and control characters are
  rejected with a clear message (never silently cleaned). Checked in the form
  ([listing-rules.ts](../../src/lib/listing-rules.ts)), in the data layer
  ([text-safety.ts](../../src/lib/text-safety.ts), used by messages, reviews and pickup saves), and in the
  database by triggers (migrations `20261018000002` and `20261018000003`). Output is escaped by React;
  no `dangerouslySetInnerHTML` or `innerHTML` is used for user text.
- **SQL injection:** prevented by parameterization, not by word filtering (blocking words such as
  `select` or `drop` would reject legitimate text and still be bypassable). All access goes through
  supabase-js/PostgREST and typed SQL function arguments; the triggers only read values. The one
  place values are spliced into a string is PostgREST `.or()`: ids are checked as UUIDs and keywords
  are stripped of grammar characters (`, ( ) " \ * %`).
- **Not covered:** profile fields (no edit form; React escapes them). Request and
  offer content is stored through the separate marketplace migration noted above.
- **Existing data:** listing `ced189e7-41e1-4567-bdf6-c9e446d9b8ab` held a literal `<script>` tag plus
  filler text (the only one of 1,020 listings). Its description was cleaned on 2026-10-18 with a single
  targeted update; the original is backed up in the session files. No other rows were changed.

## Deployment order / blockers

1. Review and apply
   [20261018000001_auth_data_isolation.sql](../../supabase/migrations/20261018000001_auth_data_isolation.sql)
   [20261018000002_listing_field_validation.sql](../../supabase/migrations/20261018000002_listing_field_validation.sql)
   and [20261018000003_text_input_validation.sql](../../supabase/migrations/20261018000003_text_input_validation.sql)
   to the intended Supabase project. Back up first and validate in staging.
2. Deploy the updated `create-checkout-session` and `analyze-listing-photo`
   functions (they now share `supabase/functions/_shared/cors.ts`). Their `APP_ORIGIN` secret is a
   comma-separated allowlist; the live project currently allows only `https://ybuy.vercel.app`, so
   browsers on localhost get a CORS error until it is widened:
   `supabase secrets set APP_ORIGIN="https://ybuy.vercel.app,http://localhost:5173,http://127.0.0.1:5173"`
   then `supabase functions deploy analyze-listing-photo create-checkout-session`. Remove the
   localhost entries for production. Also allow `http://localhost:5173/**` in the Supabase Auth
   redirect URLs. The Stripe webhook remains the source of payment confirmation.
   Done 2026-10-18: `APP_ORIGIN`, `OPENROUTER_API_KEY`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
   were pushed to the project and both functions deployed (the functions tolerate the session-check
   migration being absent; apply it to enable revocation checks). Live CORS was verified for the
   listed origins; the AI photo analysis itself was not verified end to end.
3. Configure OAuth as above and deploy the frontend.
4. Resume real-user verification when requested.

The new frontend needs `has_active_session` and `get_my_profile`. Deploying it
without the migration will fail closed with a session-verification error.
Restricting private profile columns also changes old clients' `select('*')`
behavior; coordinate migration and frontend rollout rather than leaving old
frontend builds in service. No records are dropped or rewritten by this migration.
