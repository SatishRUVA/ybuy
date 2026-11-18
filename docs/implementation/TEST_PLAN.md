# Verification status and deferred checks

Date: 2026-10-18.

No real OAuth journey is claimed passing.

## Pickup address publication

Migration `20261117000005_atomic_pickup_timezone.sql` saves the validated pickup
time zone in the address upsert, before publication checks read that address.
First-time manual and geocoded addresses can be submitted without a separate
draft save; incomplete addresses still fail and roll back atomically.

```powershell
node dev\supabase-local.mjs test db supabase\tests\pickup_address_publication.sql supabase\tests\listing_flow.sql --local
```

Verified locally: **159 assertions passed** across these two database suites.

## Versioned owner/renter handoff

The design board is a workflow reference, not a separate page for every box.
Both roles use **Arrange -> Record condition -> Confirm exchange**, with the
current action and blockers supplied by `get_booking_handoff_workflow`.

- Before an exchange starts, either participant may propose a replacement time;
  the other participant must approve it. A pending replacement does not erase
  the current approved slot.
- Pickup opens two hours before the approved start and stays open until that
  window ends. Server time enforces the boundary; displayed opening times use
  the pickup location's time zone, not the participant's device time zone.
  Only the owner can begin, with a verified rental payment and a ready hold
  when required. Code verification may start the rental early; the scheduled
  return date does not change. Return opening times are unchanged.
- The owner saves a private inspection draft and explicitly publishes it with
  2-12 photos. Published revisions and their evidence remain available.
  Corrections require a new revision and fresh renter consent; previous consent
  and codes cannot authorize changed evidence.
- Pickup activation requires the current inspection agreement, a valid code,
  payment readiness and a provider-confirmed deposit hold when required.
  An expired hold does not erase an already-started inspection.
- Return condition agreement and physical receipt are separate. A renter may
  dispute the condition with a reason and still share the receipt OTP.
  Receipt is not acceptance of damage, deduction consent, or a waiver.
- An owner's report of receipt without a code opens a support verification case;
  it does not unilaterally verify the return.
- A physically returned item is not presented as a closed booking while
  condition disputes or financial processing remain unresolved. The handoff
  screen does not initiate settlement merely because it was opened.
- Recovery preserves handoff progress. Uncertain provider outcomes must be
  reconciled before another authorization attempt. Existing live holds lacking
  sufficient provider history can require support reconciliation.
- Hold expiry does not automatically cancel, suspend, or return an active
  rental. No new grace-period or continued-use policy is implied.

### Compatibility and rollout

Apply migrations in order:

1. `20261117000001_inspection_photo_participant_read.sql`
2. `20261117000002_handoff_workflow.sql`
3. `20261117000003_handoff_financial_recovery.sql`

The two-hour pickup rule additionally requires
`20261117000007_early_paid_pickup.sql` and the matching client. Apply intervening
repository migrations through the normal rollout process.

Deploy the matching deposit authorization/setup, authorization processor,
settlement and Stripe webhook functions before enabling the new client.
Do not roll back by deleting published evidence, authorization attempts, or
handoff history. A frontend rollback must retain the compatible database
adapters and financial safeguards.

Legacy save/upload RPCs remain supported. An owner's legacy acknowledgment
publishes a complete draft; a renter cannot acknowledge an unpublished draft.
Existing bookings keep their recorded evidence and financial history.

### Focused checks

```powershell
node dev\supabase-local.mjs test db supabase\tests\booking_handoff.sql supabase\tests\handoff_workflow.sql supabase\tests\handoff_financial_recovery.sql --local
node node_modules\@playwright\test\cli.js test booking-handoff.spec.ts --workers=1
```

The browser suite uses independent owner/renter contexts at 1440px and 390px.
REST, storage and provider responses in that suite are synthetic; it does not
prove live payment-provider behavior or mutate the original hosted booking.
Database suites exercise the actual local functions in rollback-only fixtures.

First publication does not require pressing **Save draft** separately:
**Publish & confirm** saves the draft, registers its photos and publishes the
returned version. Desktop/mobile journeys exercise this with the initial
server permissions containing only `save_draft`; the return journey separately
covers explicitly saving a private draft first. Required checklist fields,
photo validation, stale-edit protection and server publication checks remain.
Verified the first-publish path locally at both widths and against the real
local backend, including correction, renter review and code verification.

The two-hour pickup regression verifies role-specific next steps, payment readiness,
readable scheduling blockers and the opening time in the pickup location's time
zone, even when the owner and renter devices use different time zones. It checks
mobile overflow and the transition at exactly two hours before pickup to
owner-only initiation without any payment or handoff mutation. Desktop owner
and mobile renter screenshots were visually checked locally.

The two-hour change passed **194 assertions** across `booking_handoff.sql`,
`handoff_workflow.sql` and `handoff_financial_recovery.sql`, run directly through
local `psql` in their rollback-only transactions, plus all five handoff browser
scenarios. The CLI test runner could not resolve its pgTAP assertions in this
environment. The additional legacy `handoff_windows.sql` run remains blocked
before assertions by an incomplete pickup-address fixture; it is not claimed
passing.

The real-backend journey is
[`tests/local/handoff-workflow.spec.ts`](../../tests/local/handoff-workflow.spec.ts).
Run it with `playwright.local.config.ts`, using the local public anon key required
by that configuration and no other server occupying port 5174. It refuses any
browser base URL other than `http://localhost:5174/`.
It creates synthetic local participants, a zero-deposit paid fixture, an approved
future pickup slot within the two-hour lead-in and a legacy return-scheduling
exemption. It then uses real authentication, RPCs and private storage for correction/republication, activation
and a disputed-but-physically-verified return. It checks that actual pickup
verification precedes the scheduled start. It does not test real provider
payments or a newly scheduled return window. Immutable local evidence is retained.

Verified locally: **188 database assertions**, application typecheck, focused
lint, the production build, and the real owner/renter browser journey.
Desktop/mobile handoff, evidence retry, stale-edit preservation, refresh recovery,
non-mutating returned-booking details, the two scheduling scenarios, both main-site
notification destinations and 22 settlement/provider-isolation checks passed in
focused runs at `http://localhost:5174/`.
Two legacy preview notification checks remain blocked before reaching the handoff:
their test harness imports the removed `src/App.tsx` entrypoint. A fully green
legacy-preview suite is not claimed.
The expired-window regression is included: an already-started pickup retains
participant address access and can finish inspection and OTP verification with
a valid hold; an unstarted pickup cannot use an expired window.
Provider money movement and live webhooks still require sandbox-provider
validation; the hosted rollout below does not certify those paths.
A dispute check and a provider call cannot share
one database transaction; provider-side concurrency remains a release concern.

### Hosted test rollout

Deployed to Supabase `jzyjmsixfuwzfnntewqn` and
<https://ybuy-e2e-test.vercel.app/> using Vercel deployment
`dpl_DH7D3QnQ5V3HDWzKeNT59LVxSec8`. The production Supabase project was not changed.
All eight pending migrations through `20261117000008` applied, all 13 Edge
Functions report active, and Vercel reports the source build ready with the
requested alias. Hosted secrets were retained; downloaded secret placeholders
were not used for a prebuilt deployment.

The legacy inspection metadata backfill temporarily suspends only the audit
and timestamp triggers while holding the migration's table lock, then restores
both. Before/after aggregate fingerprints matched for all three existing
inspection records, excluding only the new metadata columns, and all seven
existing audit records. Both triggers were verified enabled afterward.
The address backfill updates only coordinates needing rounding, leaving the
legacy zero-delivery-fee listing unchanged.

All three authoritative pickup functions contain the two-hour opening rule.
Safe hosted checks returned 401 for unauthenticated photo analysis and 405 for
a non-POST deposit authorization request. No payment or participant handoff
was submitted. Live frontend route, bundle and browser smoke checks remain
unverified because this machine rejected the site's TLS certificate chain,
including on the deployment-specific URL. Certificate validation was not bypassed.

## Earlier targeted handoff repair (2026-11-17)

- Run `node node_modules\@playwright\test\cli.js test booking-handoff.spec.ts --workers=1`
  for independent owner/renter browser sessions at 1440px and 390px. These use
  synthetic REST/storage responses, not real payments or hosted booking mutations.
- The browser journey covers slot proposal/approval, blocked pickup before readiness,
  renter arrival, owner inspection, two-photo validation/upload, shared sign-off,
  invalid and valid OTPs, pickup-to-return navigation, return scheduling/inspection,
  completion, draft preservation during polling, and visible refresh failures.
- Run `node dev\supabase-local.mjs test db supabase\tests\booking_handoff.sql`
  for 63 rollback-only database assertions, including renter reads of owner-uploaded
  photos through storage RLS and denial of unrelated users and renter uploads.
- Handoff state refreshes every ten seconds and when the page becomes visible.
  Scheduling still uses the server's approved windows and deposit readiness.
- Migration `20261117000001_inspection_photo_participant_read.sql` permits both
  booking participants to read registered evidence; only the owner may upload.
  Do not disable private storage or handoff gates to demonstrate the flow.
- Verified: all three browser checks and 63 database assertions passed, alongside
  focused lint, application typecheck, and the isolated Vercel deployment build.
- The frontend and migration are deployed to the isolated test projects. Hosted
  participant API checks confirmed renter arrival and owner handoff start.
  Live browser verification was blocked by certificate trust errors; actual item
  evidence and the scheduled return were not fabricated or bypassed.

## Ocean Green responsive styling

The cosmetic pass preserves the existing palette, fonts, components and routing.
Shared fixes cover wrapping headers/actions, bounded mobile form fields,
disabled/invalid field styling, visible search focus, missing semantic utilities,
scrollable keyboard-accessible tables, and viewport-bounded dialogs. Accent and
warning feedback use darker token-derived text inks to meet 4.5:1 contrast on
their soft backgrounds; brand fills and reward gold are unchanged.

Page refinements cover profile layout, listing actions, request tabs, notification
preferences, message wrapping, admin metrics/settings/pagination, and safe-area
spacing for navigation and sticky checkout/listing actions. The mobile listing
shortcut is hidden on conversations and notifications to avoid covering controls.

Responsive checks are in [ui-remediation.spec.ts](../../tests/ui-remediation.spec.ts).
They exercise marketplace page families and all 20 existing admin sections at
375, 768 and 1440 pixels, plus a short 812x375 landscape form. Fixtures use fake
authentication, REST responses and Realtime acknowledgements; no hosted records
or feature flags are changed.

```powershell
npx playwright test ui-remediation.spec.ts success-feedback.spec.ts --workers=1 --output "$env:TEMP\ybuy-ui-polish"
```

`YBUY_TEST_APP_URL` optionally selects a separate local Vite server for the UI
suite; it defaults to port 5174. The success suite continues to use port 5174.

Executed in focused runs: **45 checks passed**:

- All 26 success-feedback checks.
- Eleven responsive/visual checks: marketplace page families at three widths
  (including support, claims and wallet), all 20 admin sections at three widths,
  long conversations/notification preferences at three widths, short-landscape
  dialog scrolling, and measured feedback text contrast.
- Eight existing regressions: catalog/search error recovery, mobile filter focus
  trapping, calendar state, availability/review/favorite failures, handoff and
  return transitions.

Screenshots were inspected for mobile/desktop messages, preferences, admin
metrics, landscape scrolling and centered confirmations. Broader reruns hit
timeouts during category-page reload and map-view keyboard focus, including
attempts with a separate local Vite server. Those checks remain unresolved; a
fully green combined suite is not claimed. The isolated server was stopped.

TypeScript, lint (zero errors, seven existing warnings) and the production build
passed. The existing large-chunk build warning remains. Real OAuth, live payment,
every populated-data state and deployment are outside this cosmetic verification.

## Super Admin Vault Chest

- `npx supabase test db supabase\tests\super_admin_vault.sql --local`:
  **36 pgTAP assertions passed** for role/MFA/session gates, five-minute age,
  unauthenticated access denial, no direct Vault/API table reads, allowlist,
  validation, encrypted value at rest, masked status, audit redaction,
  version conflicts and revocation.
- `node --experimental-websocket scripts\verify-vault-local.mjs`:
  **passed** using a local-only fixture session; Supabase accepted a real
  TOTP-generated code, upgraded the session to AAL2, allowed encrypted storage,
  denied AAL1/raw Vault reads and accepted only one concurrent versioned write.
  Test user and entry were removed. Google OAuth was not part of this test.
- `npx playwright test vault.spec.ts --workers=1`: **8 checks passed** for
  locked UI, role visibility, invalid codes, QR enrollment, expiry cleanup,
  save errors, server denial, missing-backend readiness and no client-side
  secret retention. (Run with the Vite dev server on port 5174.)
- `npm run typecheck`, `npm run lint` (zero errors, seven existing warnings),
  and `npm run build` passed. The existing large-chunk warning remains.
- Local Supabase Auth TOTP was enabled and restarted with local data preserved.
  The vault migration was applied and tested only against local Supabase.
  Hosted Auth settings, migrations, secret values and deployments were not
  changed. No existing `.env` or platform secret was read or moved.

## Reactive feature flags

Run the focused store and WebSocket browser checks against Vite on port 5174:

```powershell
npx playwright test feature-flag-store.spec.ts marketplace.spec.ts --workers=1 --output "$env:TEMP\ybuy-realtime-tests"
```

Executed result: **15 checks passed** (five store checks and ten browser checks).
Coverage includes shared subscription cleanup, insert/update/delete invalidation,
an event racing an initial snapshot, automatic read retry, stale callback
rejection, fail-closed errors, transport reconnects and closed-channel recreation.
Browser checks inject actual Phoenix WebSocket frames into the installed
Supabase client and assert mounted offers, Admin switches, request forms and
listing offer forms change without reload/focus/navigation. REST fixtures and
fake authentication isolate these tests from hosted mutations.

`npm run typecheck`, `npm run lint` (zero errors, seven existing warnings), and
`npm run build` passed; the existing bundle-size warning remains.

Read-only hosted verification found migration 10 applied and `feature_flags` in
`supabase_realtime`. An anonymous WebSocket subscription using
`postgres_changes_options.wait = true` returned `SUBSCRIBED` and was removed.
The shared browser was signed out, so no authenticated hosted flag-toggle
journey is claimed. No hosted flag values, financial settings or records were
changed by this verification; no migration push or frontend deployment was
executed in this pass.

## Item requests and rental offers

Focused database assertions are in
[item_requests_and_negotiation.sql](../../supabase/tests/item_requests_and_negotiation.sql).
Run them with `npx supabase test db --local` after the additive migration is
available in the local Supabase database. They cover feature-flag enforcement,
request and offer idempotency, private negotiation visibility, notifications,
counteroffers, requested quantity and the `pending_payment` booking boundary.

The migration has not been applied to hosted Supabase. No live checkout,
Stripe webhook or two-real-user request/offer journey is claimed passing.

## Authorized hosted operations deployment (2026-10-18)

After the local-only implementation and access trial below, the project owner
explicitly authorized deployment to the linked hosted Supabase project.

- Dry run identified only `20261018000005_admin_operations.sql`; applied that
  migration with no seeds, other migrations or Edge Function deployments.
- Follow-up dry run reports the remote database up to date.
- Verified the owner's active Super Admin access and all 20 effective permissions.
- Verified private `admin-case-evidence` storage and the case detail RPC.
- Verified the financial gate remains `environment = 'disabled', enabled = false`.
  No production rewards, live refunds, credit spending or restoration were enabled.
- Reloaded the authenticated browser at `127.0.0.1:5174` and verified the
  Disputes & claims, Support tickets and Promotions & rewards menus and pages.
  Queues loaded their real empty states without adding hosted test records.
- The frontend remains a local Vite process backed by hosted Supabase. No Vercel
  frontend deployment or real Stripe refund webhook journey was performed.

This explicitly authorized migration deployment supersedes the earlier
local-only deployment status below; financial restrictions remain unchanged.

## Inline success feedback

Run `npx playwright test success-feedback.spec.ts --workers=1` against a Vite dev
server or preview on `http://127.0.0.1:5174`. For preview, build with
`VITE_SUPABASE_URL=http://127.0.0.1:54321`, a fake `VITE_SUPABASE_ANON_KEY`,
and fake `VITE_GOOGLE_MAPS_API_KEY` / `VITE_MAP_API_KEY` values. This avoids
unbundled development dependency reloads during browser checks.
Browser fixtures intercept Supabase and
Google Places requests; these tests do not verify hosted RLS, real Stripe
webhooks, OAuth or receipt delivery and do not mutate hosted data.

Coverage includes server-confirmed publication versus drafts/errors, request
creation without premature celebration, pending-to-confirmed payment polling,
authoritative amount/reference/dates/image, failed/refunded/pending payments,
retryable lookup errors, per-user/event animation deduplication across remounts
and reloads, inline routine notices, reduced motion, keyboard navigation and
mobile portrait/landscape layout. Screenshots are written into Playwright's
test output directory.

Receipt delivery is not exposed by the current payment schema. The UI says
that its status is unavailable rather than claiming an email was sent.
First-time achievement cards are intentionally omitted.

### Smooth success motion

The shared success indicator anchors particles to the icon rather than dropping
them from a clipped card edge. Standard milestones (publication, saved reviews,
handoff and completed returns) emit 14 particles; verified booking/payment
confirmation emits 24. Routine availability saves use a subtle icon
notice without particles. No reward or wallet functionality is introduced.

Success timing is defined in `src/index.css`: 400ms icon entrance, 300ms
checkmark-path reveal, 320ms contextual entrance, 700ms fading halo, and 1300ms
particle motion with up to 105ms stagger. The particle layer is removed after
1500ms, ignores pointer input and is hidden from assistive technology. Reduced
motion disables these transitions; switching it on also stops an active burst.
Per-user/event session deduplication survives route remounts and reloads, and
the mount claim survives React StrictMode effect replay.

Run the success suite plus affected handoff/return regressions with:

```powershell
npx playwright test success-feedback.spec.ts ui-remediation.spec.ts --grep 'success-feedback|handoff only|return confirmation only' --workers=1 --output "$env:TEMP\ybuy-premium-success-tests"
```

Additional assertions measure icon-origin coordinates, particle size/color
variation and bounded motion, checkmark drawing, animation duration, immediate
action availability, live reduced-motion changes, and server save failures
before successful review/return retries. Handoff and return-page reloads show
their persisted status without replaying a celebration.

Smooth-motion validation: **all 28 focused browser checks passed** on port 5174,
including the affected handoff/return checks. Desktop and 375px mid-burst
screenshots were inspected. TypeScript, ESLint (zero errors, seven existing
warnings), Vite production build (existing large-chunk warning) and scoped
whitespace checks passed. These remain fixture-driven local checks, not a
real-user OAuth or Stripe webhook certification.

Previous inline-feedback validation: all 21 success-feedback browser checks passed on port 5174;
TypeScript, ESLint (zero errors, seven existing warnings), Vite build (existing
large-chunk warning), and task-scoped whitespace checks passed. Desktop and
375px mobile screenshots were inspected. A combined legacy auth/location run
was not green (28 passed, 12 failed); observed failures include outdated copy,
ambiguous locators and development-source imports that are unavailable in
preview. No fixes to those unrelated behaviors are claimed.

## Approved operations increment: executed locally

The following checks exercise the local-only operations increment, not the hosted
application. No new hosted migration, function deployment, financial activation,
production signup award or live refund was performed.

| Check | Actual result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed: zero errors, seven existing warnings |
| `npm run build` | Passed: existing large-chunk warning |
| `npx supabase test db --local` | Passed: 272 assertions across three SQL suites, including 190 operations assertions |
| `pwsh -NoProfile -File .\supabase\tests\admin_operations_concurrency.ps1` | Passed: two concurrent sessions competing for one promotion redemption and two competing for one wallet reservation; exactly one winner in each race |
| `node .\scripts\verify-admin-operations-local.mjs` | Passed: actual local REST contracts and private Storage upload/register/sign/download; outsider denied |
| `npx playwright test admin-operations.spec.ts refund-event.spec.ts --workers=1` | Passed: seven mocked browser checks and three refund receipt mapping checks |
| Refund receipt parser TypeScript check | Passed using the installed TypeScript compiler |
| Task-scoped `git diff --check` | Passed; full-worktree check reports unrelated whitespace in a tracked location-test failure artifact |

The browser checks require an isolated Vite server or preview on `127.0.0.1:5175` with
`VITE_SUPABASE_URL=http://127.0.0.1:54321` and a fake anon key. They verify
permission-aware navigation, staff/participant controls, case management,
explicit server failures, a 375px ticket form, campaign submission and
credit-only access. They are not RLS or real OAuth evidence. The final run used
a separately built preview bundle: 10 passed in 17.4 seconds. A preceding
development-server run hit page-load timeouts during concurrent hot reloads;
the stable preview run passed without increasing timeouts or adding retries.

The SQL suite covers role grants, cross-user isolation, per-kind transitions,
staff notes, evidence privacy, escalation, proposed decisions, search/priority
filters, promotion calculations/limits/expiry, signup/manual credit permissions,
90-day credit expiry, exact test-only USD 5 signup awards, refund thresholds and self-approval denial, receipt
idempotency, exception queues and append-only history. Concurrent checks use
separate PostgreSQL sessions and verify simultaneous lock contention, not a
sequential approximation. The REST smoke independently checks HTTP behavior
against local Supabase. Fixture rows are removed and the financial test gate is
restored to disabled.

The existing checkout charge, booking snapshots and payment-confirmation flow
are preserved. New signature-verified `refund.created`, `refund.updated` and
`refund.failed` receipts use test Stripe credentials, require the database test
gate, and return retryable failure if persistence fails. Live refund events are
not processed by the test-only reconciliation branch. Database receipts never
mark a booking/payment refunded or enable refund execution.
Provider `requires_action` receipts are retained as explicit reconciliation
exceptions; duplicate receipts remain idempotent.

### Remaining acceptance boundaries

- No real Stripe provider refund or signed HTTP webhook journey was executed.
  Receipt mapping and database duplicate/mismatch handling were tested separately.
- No live checkout discount/credit spending is enabled. Test promotion redemption
  and credit reservations are foundations, not production checkout integration.
- Signup credits are explicitly issued through authorized test operations;
  automatic production signup awards and referrals remain disabled.
- Credit restoration always rejects until the allocation policy is approved;
  releasing an unused test reservation is not refund restoration.
- Refund allocation/responsibility, dispute filing deadlines and retention policy
  remain unresolved. Cases do not move money.
- Persistent notifications and email queue isolation were verified against the
  local database. Email templates passed focused tests, but no real Resend email
  was sent. Hosted migrations through `20261018000010` and all six Edge Functions
  were deployed on 2026-10-18. Hosted notification RLS and service-role-only global
  queue permissions were verified. Unauthenticated worker/admin calls returned
  401; unsigned Resend/Stripe webhook calls returned 400.
- Migration 11 schedules the Vault-authenticated worker in Supabase every five
  minutes. `npx supabase test db --local supabase/tests/notification_cron.sql
  supabase/tests/notification_delivery.sql` passed 23 assertions. Hosted Cron
  recorded a successful automatic run; a manual pg_net invocation returned HTTP
  200 with one email accepted by Resend for the configured test inbox.
- Vercel production is Ready at `https://ybuy.vercel.app`. HTTP smoke checks
  confirmed the existing access gate redirects home/notifications to `/access`,
  the access page returns 200, and its API rejects GET with 405. Typecheck, build,
  access-gate self-check and lint passed (seven existing warnings). Full
  authenticated production rental flows and signed Resend delivery remain
  acceptance checks.
- Notification Realtime subscriptions use unique channel names so the header
  bell and notification center can coexist. Run
  `npx playwright test tests/notifications-realtime.spec.ts` to verify independent
  subscriptions, cleanup isolation, and remounting.
- Full real-user Admin/Super Admin browser coverage and every responsive,
  keyboard and provider journey remain acceptance checks, not claimed passes.

## Hosted admin migration deployment (2026-10-18)

- After an explicitly approved local-only access trial, the project owner
  requested returning to the hosted-backed frontend. Removed the temporary
  local startup command, restored the prior local redirect configuration, and
  restored the previously verified owner account to active `super_admin` through
  a trusted database operation with an audit entry. Verified 13 effective hosted
  permissions. The operations migration remains local-only; no new migration
  deployment or financial activation accompanied this access correction.
- Applied migrations `20261018000001` through `20261018000004` to hosted project
  `xwmnfnhnnxxaarbfkqrp`; verified local and hosted migration histories match.
- Verified `public.get_my_admin_access()` exists and the REST API recognizes it.
  Anonymous execution is rejected with PostgreSQL permission error `42501`.
- Provisioned the first active super admin for the account explicitly confirmed
  by the project owner, using the procedure in [decisions](DECISIONS.md);
  verified the resulting role and active status.
- Hosted authenticated admin UI verification and health-function deployment remain pending.

## Admin / Super Admin verification added

- [x] Apply `20261018000004_admin_foundation.sql` to a disposable local Supabase database.
- [x] Run `supabase test db --local`: all admin and existing auth database tests pass.
- [x] Verify a plain user cannot invoke admin reads/writes or read private admin tables.
- [x] Verify an admin can only use granted permissions; a super admin can manage settings, flags and admin access.
- [x] Verify owner cannot lift listing suspension, user restriction blocks protected writes, last active super admin cannot be removed, and audit records cannot be mutated.
- [x] Verify global fee update validates bounds, is audited and is snapshotted only on future booking rows.
- [x] Provision the first super admin through the trusted SQL procedure in [decisions](DECISIONS.md).
- [x] Mocked browser smoke: `/admin/overview` as super admin, permission-filtered route as limited admin, denial as ordinary user.
- [ ] Browser-test every enabled section with a real local admin, including mobile navigation, mutations and pagination.
- [ ] Deploy `admin-system-health`; verify that responses expose configured/not-configured status but never secret values.

## Admin / Super Admin checks performed (2026-10-18)

| Check | Result |
| --- | --- |
| Local Supabase start and all migrations, including `20261018000004_admin_foundation.sql` | Passed |
| `supabase test db --local` | Passed: 82 pgTAP assertions across admin and existing auth isolation tests |
| `pnpm run typecheck` | Passed |
| `pnpm run lint` | Passed with 0 errors; 7 existing warnings |
| `pnpm run build` | Passed; existing large-chunk warning |
| `git diff --check` | Passed; line-ending warnings only |
| Local health-function unauthenticated request | Returned HTTP 401 as expected |

The admin SQL suite covers permissions, RLS isolation, listing suspension,
restricted-user writes, fee validation/snapshotting, flags, admin privilege
escalation, reasons and append-only audit. The UI role smoke test used mocked
Supabase responses; it did not provision a real local admin. Do not treat local
test credentials or database state as production setup.

## Checks performed

| Command | Result |
| --- | --- |
| `npm run build` | Passed; existing large-chunk warning. |
| Focused ESLint on changed authentication/UI files and demo script | Passed with the existing auth-context Fast Refresh warning. |
| `npm run typecheck` | Passed (previous date-picker errors fixed). |
| `npm run lint` | Passed with 0 errors; 7 existing warnings. |
| `git diff --check` | Passed. |
| Editor test discovery | Did not discover the Playwright file. |
| Initial Playwright CLI path selector | No tests found (Windows path interpreted as regex); corrected filename-selector run was interrupted. |
| `supabase test db --local` | Passed: 82 assertions across both database suites. |

## Prepared, not run

- [Browser checks](../../tests/auth-isolation.spec.ts) use mocked Supabase responses
  and separate account fixtures to exercise UI state, destination retention,
  OAuth picker parameters, logout/error handling and empty new-user data.
  They do not verify Google's service, JWT signatures or RLS.
- [Database checks](../../supabase/tests/auth_data_isolation.sql) use authenticated
  roles and separate users in a rollback-only transaction. They cover personal
  data isolation, public profile joins, private profile columns, participant
  permissions and service-only payment confirmation.

When tests resume, run the browser file with a filename regex selector:
`npx playwright test auth-isolation --workers=1`.
It expects a Vite server at `http://127.0.0.1:5175` configured with
`VITE_SUPABASE_URL=http://127.0.0.1:54321` and a fake anon key. Never point mocked
browser tests at a production app. Run database tests only on a disposable local
Supabase instance with all migrations applied.

## Required before production acceptance

1. Real Google first login, repeat login, consent cancellation and callback error.
2. Same account rents and lists; no duplicate profile on repeat login.
3. Switch A to B and back after logout, including another browser tab.
4. Expired access token, rejected refresh, revoked session and network loss.
5. Replay a revoked JWT against RLS, booking RPCs, Storage and authenticated Edge
   Functions; verify no protected operation is accepted.
6. Verify two actual users cannot read or modify each other's private data by ID.
7. Confirm public listing/profile-display queries remain available.
8. Keyboard and mobile sign-in dialog review, including focus return and Escape.
9. Verify the configured production return URL and document actual hosted timeout
   settings. Do not infer those values from local config.
10. Apply any existing-demo cleanup only after a reviewed provenance inventory.
