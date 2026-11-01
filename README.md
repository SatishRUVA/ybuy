# ybuy

## Preview 1 production integration

### Local city inventory

Run `node dev\seed-local-marketplace.mjs` to insert the same ten existing rental
templates in Dallas, Irving and Omaha (30 listings total). This command only
targets the isolated `supabase_db_YBuy` container and requires the local profile
picker accounts. It is transactional and idempotent: reruns leave existing seed
IDs unchanged. Existing listings, bookings and accounts are not replaced.
Availability starts on the insertion date and spans 30 days; enabled delivery
costs $15. Existing preview image URLs are reused, so image loading still depends
on the image host. Seeded listings do not invent ratings or owner verification.

The shared marketplace cards use the supplied card design: rounded photo/cards,
lime instant-booking badges, actual photo counts, owner avatars, handoff badges,
daily price and a working View Details link. Favorites retain their real mutation.

The current application defaults to Preview 1's cobalt/lime palette, not Ocean
Green. The live app and local preview share `src/styles/preview-one.css`.
Home, browse/search, listing details, favorites and checkout now render the actual
`src/preview-1` components through `MarketplaceProvider`, with real listings,
availability, favorites, messages and booking/payment commands. Confirmation
shares the original ticket template with the existing authoritative booking
loader. Header, sidebar and footer are also shared components, not lookalikes.
The main routes never mount the demo `PreviewProvider` as their backend.

Renter and owner dashboards, inventory, listing creation/editing, payouts,
messages, notifications, requests and profile/settings now use the native
Preview templates with typed live-data adapters. Bidding cards, bidding-room
layout/rules and the administrator page/tab layout are also shared between the
preview and production. Creating/editing keeps the original standalone wizard,
without the account-workspace sidebar. Real workflow tools that have no Preview
screen remain in separate dialogs or detail pages rather than replacing it.

| Preview screen | Main route |
| --- | --- |
| Home / browse / details | `/`, `/search`, `/listing/:id` |
| Bidding / bidding room | `/bidding`, `/auction/:id` |
| Requests | `/requests` |
| Booking / result | `/checkout/:id`, `/confirmation/:id` |
| Rentals / saved items | `/dashboard?tab=renting`, `/favorites` |
| Owner / inventory | `/dashboard?tab=lending`, `/dashboard/listings` |
| Listing wizard / earnings | `/create-listing`, `/edit-listing/:id`, `/payouts` |
| Messages / notifications / profile | `/messages`, `/messages/:id`, `/notifications`, `/profile` |
| Admin and its six sections | `/admin`, `/admin/:section` |

The interface-state gallery, sample role switches, fake payments, demo maintenance
controls and screen index stay preview-only. Main routes show real loading,
empty, failure and success states instead of installing simulated controls.
Administrator deep links retain their protected tool destinations and individual
permissions. Owners link published rentals to requests at the advertised price;
the new UI does not create private offers or counteroffers.

Real listing validation, uploads, draft saving, publication review, authentication
and booking/payment verification remain authoritative. Listing creation keeps
Preview 1's shared layout and stylesheet, with one validated production wizard
instead of a second wizard inside a modal. Required condition, pricing and private
pickup controls are available inline; AI assistance and optional item fields use
a details disclosure. Blocked-day failures offer a reload and prevent continuing
until availability can be verified. No sample photos,
fake publication success or demo payments are added to the main app.
The Photos step follows the supplied Preview 1 upload layout: a full-width
neutral upload area, no preview sidebar, and secondary Back / primary Continue
actions. The preview-only sample-photo button is replaced by real draft saving.
Uploaded photos retain cover selection, ordering, replacement and removal.

Earlier staging verification below describes the previous Ocean Green rollout;
it is not evidence of complete pixel parity for the current redesign.
Sharing tokens alone is not
pixel-level proof. Shared CSS resets have deliberately low specificity so they
cannot replace primary-button text, selected-filter colors or semantic feedback
with inherited ink. Preview typography still takes precedence over browser
heading defaults. Dialogs and dropdown portals share the same presentation scope.
Shared overlay roots explicitly stay transparent with no page minimum height:
a closed calendar must not inherit the page's white background and cover the app.
Incomplete descriptions can be saved privately as drafts; advancing and publishing
still enforce validation.

Earlier, pre-direct-integration local verification included a successful build and typecheck,
17 route layouts at 375/768/1440px, wizard template geometry/typography/colors at
those sizes, calendar and modal focus/viewport checks, exact primary/filter colors,
owner approval-before-payment, renter status routing, payment retry on the same
booking, and delivery/note RPC payloads and estimates. Account regressions also
cover favorites, notifications, handoff retry and return confirmation. The build
still reports its existing large-chunk warning.

The direct integration has focused regressions in `tests/preview-backend.spec.ts`
for original tag/class hierarchy, exact hero-copy screenshot equality at
375/768/1440px, empty real catalogs, authoritative search filters and errors,
favorite mutation failures, checkout state/delivery/note persistence, exclusive
return dates, same-booking payment retry and exact receipt amount/currency checks.
The old main-site page fade is not applied to these routes: its compositing
changed text rendering even with matching markup and colors.
All 13 focused browser regressions passed after the direct integration.
Application typecheck, targeted lint and production build also passed; lint
reports nine Fast Refresh export warnings and the build retains its large-chunk
warning. The unmocked local homepage returned HTTP 200 with no page errors or
alerts; the nearby catalog was empty. These checks did not create live bookings,
charge cards, transfer payouts or send notification emails.

This is not a claim of all-page screenshot identity. Extra admin subsection,
case/evidence and wallet controls retain real production features in separate
tools. Real listings, authentication state, location lookup and missing local
fixture photos differ from the preview's sample content; unavailable photos are
reported rather than replaced with misleading demo listing images. Hosted
deployment and live provider transactions have not been validated by these checks.

Native checkout creates a booking once before starting Stripe, then retries
payment against that same returned ID. It cannot simulate card success or a
decline on a main route. Owner approval is not payment confirmation; a confirmed
ticket requires the webhook-written receipt to match the booking amount in cents
and USD currency. Promo codes, booking agreements, pickup/reservation/settlement,
wallet/support/claims and sign-out remain accessible in separate dialogs.
Rental occupancy is `[pickup, return)`: a booked return day is allowed when the
occupied days are clear, but cannot be selected as pickup.

### Current validation and deployment

The essential TypeScript check and production build pass. The local Vite server
responds at `http://localhost:5174`. All 24 Preview views (including six admin
sections and the state gallery) rendered without JavaScript errors. The main
route render check also found no JavaScript crashes; this is not full workflow QA.

These additional migrations are applied locally, not to the hosted database:

- `20261101000001_atomic_owner_availability.sql`: one owner-only transaction for
  availability and blocked days, with revision and booking guards.
- `20261101000002_public_request_listing_links.sql`: links an owner's matching
  published listing using existing matching rules and notification deduplication.
- `20261101000003_profile_bio.sql`: restores the Preview's About you field with
  owner-scoped profile persistence, length and database plain-text validation.

Local `item_requests` and `bidding` feature flags remain disabled. The local
`owner-payout-status` function returns 503 because Stripe settlement is not
configured; that failure is surfaced, not replaced by simulated payout data.
Hosted migration deployment and authorized provider configuration remain needed
before those workflows can be used there. Do not enable private offers.

Deferred QA: full owner/renter workflow regression; mutation failures and retries;
all-screen pixel, mobile/tablet and accessibility checks; hosted Stripe checkout,
webhooks, settlement and bank-payout verification. No new automated tests or
full regression suites were executed in this minimal-validation phase.

### Checkout delivery and notes

The local database has applied `20261031000002_checkout_delivery_notes.sql`.
Only this exact, successfully applied version was recorded using local migration
repair; unrelated historical drift was not marked as applied or reset. The hosted
database has not been changed.

Pickup/delivery, the listing's delivery fee and the renter's optional
500-character note are frozen on booking creation. The fee is calculated during
the insert, before instant bookings capture their immutable rental agreement;
that agreement therefore includes the correct total and handoff details. Owner
settlement includes the frozen delivery fee, but excludes platform fees, insurance
and deposit. Promotions do not discount delivery. Availability, active-session
checks, RLS and exact verified payment remain authoritative.

`supabase/tests/checkout_delivery_notes.sql` exercises 23 local SQL assertions:
pickup and delivery amounts, note bounds/persistence, capacity, direct-write RLS,
immutable agreement totals, promotion/insurance combinations, verified payment
and owner-only return/settlement. Fixtures and synthetic payment receipts are
rolled back; no provider charge, refund, transfer or email is sent by these tests.

## Main v1 staging

`existing/main-v1` starts from the `redesign` application's real workflows and
retains the Ocean Green theme. The separate Vercel project is
`ybuy-redesign-v1`; its authorized backend is the existing `ybuy-e2e-test`
Supabase project. This backend is shared with other test deployments, not
production. Do not reset it or import production customer data.

This section describes the earlier staging rollout, not the current direct
Preview integration. The current build includes the Preview source directories
because main routes import shared templates from them; `.vercelignore` no longer
excludes those sources. The isolated demo route remains separate from live data
and action providers. Remaining financial release gates are recorded below.

Use Stripe test mode only. Set `NOTIFICATION_DELIVERY_DISABLED=true` on the test
backend before booking tests: `NOTIFICATION_LIVE_DELIVERY=false` alone still
allows redirected test emails. The delivery-disabled switch leaves jobs queued
and returns an explicit disabled response before claiming jobs or calling Resend.

Run `pnpm exec playwright test --config playwright.staging.config.ts` for the
deployed baseline smoke checks: real listing data at three viewport sizes,
Ocean Green, listing navigation, persisted sign-in and the no-email guard.
The staging suite also verifies real owner block/unblock persistence and renter
RLS denial, plus real UI instant checkout through Stripe sandbox card payment,
the signed webhook's persisted payment receipt, check-in, return initiation and
owner-only completion. It rejects live checkout sessions before entering payment
details and does not enroll test actors in Link. Synthetic payment/agreement
records are retained for audit; their listings are returned to draft.

Owner availability spans at most 30 calendar days, including blocked days.
The stored end date remains exclusive: November 1 through December 1 makes
November 1-30 available, before blocking. The existing 180-day advance scheduling
horizon is unchanged. Retained historical windows are not rewritten; the guard
checks new windows, changed dates and draft publication without bypassing
reservation protection. Validate it without persistent fixture writes using
`pnpm exec supabase db query --linked --project-ref jzyjmsixfuwzfnntewqn --file tests\staging\listing-window.sql`.

### Workflow component rollout

The application reuses its Radix select primitive for shared dropdowns, search
sorting, listing category/delivery radius, dashboard availability selection,
notification filters and admin operation forms. Menu selection uses Ocean Green
tokens, keyboard/typeahead navigation and right-aligned checkmarks; named admin
controls still participate in `FormData`.

Both listing-card variants show the actual owner's name, the backend verification
badge beside that name, and distance when available. Reviews never grant a
verification badge. Ratings remain independent of owner identity.

The creation/edit wizard now includes immediate owner-blocked-date management
within its availability step, reusing the same API and booked-date protection as
the dashboard. Blocking errors require reloading authoritative dates before retry;
the UI does not claim an unsaved change succeeded.

### Page workflow migration

The earlier adapted-page rollout translated the approved Preview 1 page hierarchy and
interactions, not its private theme or simulated data:

- Marketplace: persistent search filters, grid/list/map results, uploaded-photo
  listing galleries, owner contact, date continuity and authoritative favorites.
- Renting: stepped checkout, task-led bookings, pickup/return, messages,
  notifications, saved items, item requests and account/trust pages.
- Owning: inventory and incoming approvals, a five-step listing wizard,
  real draft/publish controls, availability and blocked-date management.
- Administration: permission-filtered task groups for queues, people, cases,
  bookings/money, marketplace configuration and platform controls; existing
  operation forms retain audit reasons and named form values.

That earlier rollout retained Ocean Green and the existing backend APIs. Private pricing and
counteroffer creation are not part of the new navigation/workflows; historical
records remain available where required. Booking approval and checkout redirects
never count as verified payment. Provider webhook confirmation remains
authoritative. The public bidding directory displays real auctions or a real
empty/offline state, never automatic sample auctions or a mock fallback.

Focused workflow regressions are in `account-workspace.spec.ts`,
`admin-console.spec.ts`, `success-feedback.spec.ts`, `workflow-components.spec.ts`,
`hero-search.spec.ts` and `ui-remediation.spec.ts`. Browser tests using mock data
are separate from the real-backend staging checks.

### Main v1 verification and remaining gates

- Application typecheck and production build pass. Focused source lint has no
  errors; the existing search-map dependency warning and bundle-size warning
  remain.
- Page-family layout checks pass at 375, 768 and 1440 pixels. Owner wizard,
  admin navigation/dialogs, galleries, dropdowns, date bounds, bidding privacy,
  checkout and handoff/return failure recovery have focused passing regressions.
- The deployed baseline and real owner availability/RLS checks pass. Real
  owner-approval UI independently reaches payment-pending, rejects unauthorized
  approval/premature handoff and verifies cancellation releases the dates.
- Real staged UI checkout, sandbox charge, signed payment webhook, exact
  persisted amount/currency and authorized rental lifecycle pass. An approval
  or a successful redirect alone is never reported as paid.

Deposit-refund and owner-payout provider receipts have not been verified in this
rollout. Privileged admin writes are covered by frontend/API fixtures, not
hosted financial/configuration mutations. Check-in photo/evidence capture remains
explicitly unavailable; the checklist does not pretend to save images or file a
claim. These are release/feature gaps, not success-shaped substitutes.

## Brand assets

The shared `BrandLogo` uses the latest supplied transparent wordmark and a
compact favicon-derived mark on phone navigation. Empty margins are trimmed
without changing the artwork. Dark mode adds a light backing to keep its dark
lettering readable. The supplied ICO is served as the favicon, with derived
Apple touch and web-manifest icons. Social previews use the same wordmark on
a light background. These assets do not add offline support or change routing.

## Marketplace countries

Global Settings → `marketplace_country_codes` controls countries allowed for
city/postal-code discovery, GPS/IP location detection, pickup address selection
and new item requests. The initial setting is United States (`US`) only.
Administrators with `config.manage` can add/remove countries from the existing
country reference; at least one must remain enabled. Changes require a reason
and are audited. This does not restrict self-reported profile nationality/region.

Apply `20261026000005_marketplace_countries.sql` before deploying this frontend.
Missing or unreadable configuration blocks location selection explicitly.
New/changed pickup addresses and new requests validate the configured country
on the server; request creation without a country is no longer available.
Existing rentals, request history and unchanged pickup addresses are retained.
Saved city selections are rechecked on load and when the window regains focus.
New lookups read the current policy without a frontend deployment.

## Local frontend with hosted Supabase

To run against the isolated hosted test backend, configure the ignored
`.env.hosted.local` with that project's `VITE_SUPABASE_URL` and public
`VITE_SUPABASE_ANON_KEY`, then run:

```powershell
pnpm dev -- --host localhost --mode hosted
```

Open `http://localhost:5174/`. This mode overrides the default Supabase
configuration without changing `.env.local` or applying hosted migrations.
Use only a public anonymous key in the frontend, never a service-role key.
Browsing supports hosted schemas without optional duration-discount columns;
newer write flows still require their corresponding migrations.

[Owner & Renter validation status report](docs/implementation/OWNER_RENTER_VALIDATION_STATUS.md)
separates verified local behavior, unresolved failures and hosted release gates.

## Homepage category discovery

The homepage translates Preview 1's split hero, inventory collage, prominent
search, image-led categories, four-item discovery shelf, outdoor story and
renter/owner entry points into Ocean Green. It uses real inventory only; empty
or failed catalog loads never substitute preview listings. The outdoor story
appears only when its category and a real outdoor listing are available.
When coordinates are selected, discovery uses the server's radius-filtered
search rather than claiming nearby results from a global 24-item sample.
Saved-item failures are visible, and hearts are disabled during initial loading
and writes. The homepage and remaining page families have been migrated and
checked; the verification section distinguishes frontend checks from provider
and real-backend evidence.
Listings without uploaded photos no longer receive an unrelated stock photo.
Cards and rental thumbnails share an explicit photo-unavailable fallback; the
existing detail gallery already handles an empty photo collection.

Browse by category uses the active database categories in their configured order
and fixed, distinct category artwork (never user listing uploads). Cards form a
two-column phone grid, expanding to four columns on tablets and eight on desktops, with full-card
navigation, visible keyboard focus and reduced-motion-aware hover feedback.
Missing or failed photos retain the category icon and destination. Loading
skeletons, empty categories and catalog errors remain distinct states.

Category cards open the existing category-filtered search. **Explore all
categories** and **More** open the existing unfiltered search with its category
filters; there is no separate category discovery route. Search, dates, location
and filter logic are unchanged.

## Top Offers banner

The shared mint offer banner retains the reference's curved accents, white cards,
top-corner ranks/status pills and green TEST DATA pill. It is 100px tall on desktop
and phones, with compact
site typography and continuous news-style scrolling instead of navigation arrows.
Cards share fixed dimensions, equal padding, a one-pixel border and aligned
48px images. Long titles truncate with an ellipsis and retain their full tooltip.
Displayed daily prices round to whole dollars; underlying offer amounts do not
change. LIVE BIDDING has a slow double-heartbeat glow and toggles motion on click.
Hover pauses scrolling; keyboard focus and reduced motion provide a static,
manually scrollable feed. Visual loop copies are hidden from assistive technology
and cannot receive keyboard focus.

The existing bidding flag, fifteen-second refresh, expiry filtering, retry and
listing destinations remain unchanged. Real offers always take priority.
Only an empty test-environment feed shows clearly labeled sample offers; its
first three photos are cropped from the supplied reference. HOT, POPULAR and
GREAT DEAL are illustrative sample labels, never inferred claims for real offers.

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

The owner listing journey follows five sequential screens: Photos, Details,
Rental settings, Availability, and Location & review. It preserves revision-safe
drafts, photo/AI editing, private pickup, and backend-confirmed publication.
Owners can select 1–30 consecutive available calendar days within the next 90
days. The owner selects pickup and return dates: November 19–20 is one rental
day, returned by November 20. The return date is exclusive, matching the rental
API. Return dates beyond pickup + 30 days or the 90-day horizon are disabled.
The city is derived from the selected pickup address, with the marketplace
location used as a search hint only. Drafts are saved before publication review;
review failures expose Retry publication, not a misleading Retry save.
Existing reservations cannot
be displaced. Apply `20261027000001_listing_scheduling_window.sql` before releasing
this policy to a hosted environment; it has only been applied locally. Offer
preferences retain their existing post-publication authorization gate.

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

### Password-free local profile selection

Start Docker Desktop, then run:

```powershell
pnpm exec supabase start
pnpm exec supabase migration up --local
pnpm dev:local
```

Click **Login**, then select a named profile from the **Profile** dropdown:
ten Owners, ten Renters, Grace Mitchell (Admin), or Daniel Lawson (Super Admin).
There is no password prompt and no automatic login. The selected profile persists
across reloads. Click the current name in the header to switch profiles; the
existing mobile menu also offers Switch account and Sign out.
Loopback development skips the hosted `/access` security-code screen and returns
to its requested destination. Production and hosted site-access verification
remain unchanged.

This mode configures the ignored `.env.local-profiles.local` file from the running
local Supabase CLI. Existing hosted environment files and lifecycle test accounts
are unchanged. The dev-only endpoint provisions its own marked synthetic accounts
and issues a one-use local Auth token; no password or service-role key is sent to
the browser. Profile/session validation, RLS, actual database admin permissions,
and additional sensitive-action MFA requirements remain enforced. Owners and
Renters are personas, not exclusive permission roles.

The picker is unavailable in production builds, hosted-backend modes, and the
existing `e2e` mode. Its endpoint only accepts loopback clients and same-origin
selection requests. Anyone with access to this development machine can select
these local staff accounts; never expose the local server or database publicly.
Local mode clears inherited payment/email provider credentials rather than
sending real payments or emails.

Verify the 22 real account sessions, Owner/Renter versus staff permissions,
profile switching, reload persistence, mobile layout, sign-out, and rejected
invalid/cross-origin requests with:

```powershell
pnpm exec playwright test --config playwright.profiles.config.ts
```

The sign-in dialog offers Supabase email/password sign-in and registration alongside
Google sign-in (including Gmail accounts). It preserves the destination route and existing session/RLS
checks. Registration displays a confirmation notice when Auth requires email
verification; the client never treats an unverified signup as authenticated.
Hosted deployments must enable email and Google Auth in their own project settings.
Google requires a server-side OAuth client ID/secret and an authorized Google Cloud
redirect URI of `https://<project-ref>.supabase.co/auth/v1/callback`. Allow the app's
return URLs in Supabase Auth URL Configuration. Never put the OAuth client secret
in a `VITE_` variable. Account switching ends the local session before starting a
new sign-in; Google asks the user to select an account. Initialization and callback
errors remain visible, and email/password stays available.
On 2026-10-22, the e2e project (`jzyjmsixfuwzfnntewqn`) was verified to have email
Auth enabled and Google disabled. An operator must enable/configure Google before
hosted Google sign-in can complete; rendering the button does not establish this.

Local `supabase/config.toml` enables email/password Auth for isolated test actors.
Production hosted Auth settings are unchanged. Restart local Supabase after changing that
configuration. With it running, create or reuse five Owner and five Renter test
personas with real password authentication:

```powershell
$status = npx supabase status --output json
if ($LASTEXITCODE -ne 0) { throw 'Local Supabase must be running.' }
($status -join "`n") | node --experimental-websocket scripts\seed-local-test-users.mjs
```

By default the script accepts only `http://localhost:54321`, never loads hosted environment
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

`/bidding` is the live competitive-auction section. Owners manage their listings'
auctions in My auctions. Explore auctions excludes the signed-in user's own listings
before pagination and category counts; anonymous visitors see all eligible auctions.
Renters explore auctions and place bids on the dedicated
`/bidding/:listingId` page. Listings only link into Bidding; they do not contain a
bid form or leaderboard. The owner view shows anonymous top bids only. Owners
can select an eligible top bid during bidding, which closes the auction and
starts a one-hour payment window.
Each accepted new bid creates an unread owner in-app notification linking to
Bidding, without exposing the bidder's identity. Bid retries do not duplicate
alerts, and the owner's Bookings and rentals in-app preference is respected.
Renters also receive bid-accepted and outbid alerts. Owners and participating
renters receive auction-extension and bidding-closed updates. Selected renters
keep the existing winner alert and receive one payment reminder in the last
15 minutes of their checkout window. Not-selected alerts are final: they are
sent only after another renter pays or the auction ends without a booking,
preserving runner-up selection. Existing verified-booking confirmation alerts
are reused for both parties. All new alerts are in-app only, respect the
Bookings and rentals preference, and do not duplicate on retries.
Auction countdowns use days and weeks for longer waits and approximate 30-day
months (labeled "About") beyond a month. Within 24 hours they show live hours,
minutes and seconds; actual auction deadlines and payment windows are unchanged.

`/auction/:id` remains a mock-only demo route using the existing sample auctions.
Enable `mock_bidding` in Admin Feature flags to show the Home demo rail and allow
demo bids. Disabling it immediately hides the rail and replaces the demo route
with an offline banner. Demo bids live only in page memory, reset when leaving
the auction or disabling the flag, and never create real offers, bookings or
payments. The independent `bidding` flag does not enable this demo.

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
The `bidding` flag controls competitive listing auctions and continues to update
their directory and owner-management view without refresh, focus, or navigation.
The separate `mock_bidding` flag only controls the simulated demo route.

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
