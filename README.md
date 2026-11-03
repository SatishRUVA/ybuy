# ybuy

## Test-backend deposit function repair (November 3, 2026)

The test backend `jzyjmsixfuwzfnntewqn` had the deposit database migrations
but was missing `create-deposit-setup-session` and
`create-deposit-authorization-session`. Their browser preflights returned 404,
surfacing as "Failed to send a request to the Edge Function" during checkout.
The booking insert precedes deposit setup, so this error does not mean that no
booking exists; check rental history before starting another request.

The authorized repair deployed those functions, `process-deposit-authorizations`,
and the matching `create-checkout-session`, `stripe-webhook`, and `settle-rental`
handlers to that explicit test project. No database migrations, secret changes,
frontend changes, or production deployments were required.

Verification: all four browser-callable handlers returned 204 preflights with
the exact `http://localhost:5174` origin and required request headers. Browser
invocations of checkout and both deposit functions reached HTTP 401 when signed
out, rather than failing at the network/CORS boundary. The reminder worker
rejected missing credentials (401), and the webhook rejected a missing Stripe
signature (400). All 32 focused checkout-pricing and rental-settlement tests
passed. Authenticated card setup, authorization, payment, and signed webhook
delivery were not exercised in this repair; no provider transaction was made.

## Main-site renter request journey

The `VITE_SITE_VARIANT=main` build keeps the restored green main-site components,
layouts and palette. The request journey is main-site-only; Preview 1's adapters
and presentation are unchanged.

- Renters choose open-to-offers or fixed daily budget, and a per-request **in-app**
  matching notification preference. Fixed budgets require a positive daily amount.
  Existing daily-price-per-unit matching semantics are retained; this choice does
  not create a competitive auction or a private negotiation.
- Category suggestions use matching published inventory and can be overridden.
  Posting success summarizes the item, dates, area, daily budget and preferences.
- Owners can select a verified city/postal area, filter requests within 5, 10, 25
  or 50 miles, and inspect actual geographic distances or requests needed in the
  next seven days. Without coordinates, the page explicitly labels unfiltered
  results instead of claiming proximity.
- Owners respond with an eligible existing rental or a request-linked listing
  wizard. Fresh drafts inherit the request details without overwriting resumed
  drafts or edits. Request context survives local draft resume and the
  `/edit-listing/:id?request=:requestId` approval follow-up.
- Only confirmed **published** listings expose link-and-notify/skip actions.
  Listings awaiting approval cannot notify the renter as available.
- Renter notification links open `/requests/:requestId/matches`. Results use the
  authoritative category, budget, geographic, quantity and date-capacity matcher,
  not generic search. Listing links preserve request dates and quantity through
  checkout, including modified clicks/new tabs. Booking and payment validation
  remain authoritative. Matching cards use real saved-item mutations, not
  preview-only favorite state.

The new [request journey migration](supabase/migrations/20261102000003_main_request_journey.sql)
depends on the
[notification policy migration](supabase/migrations/20261102000002_notification_center_policy.sql).
Creation saves preferences atomically and checks idempotent retries. RPCs require
an active, unrestricted session; renter preference/match operations verify
ownership and owner links require the caller's published matching inventory.
Nearby discovery returns only eligible public, active requests, excluding the
caller's own requests.

Per-request opt-outs cannot override account category opt-outs or mute required
booking/payment/safety alerts. The preference affects future in-app alerts, not
email settings or existing inbox history. Notify/skip actions deduplicate against
automatic matching events; skipping cannot retract an alert already created by
the matcher and does not reserve inventory. **Web Push/device notifications are
explicitly deferred.**

Local verification uses
[rollback-only SQL assertions](supabase/tests/main_request_journey.sql) against the
explicit `supabase_db_YBuy` container and
[compiled main-site browser tests](tests/main-site-variant.spec.ts).
The SQL assertions cover creation/retries, authorization, distance filters,
date/quantity capacity, notify/skip, automatic alert suppression, mandatory alerts
and legacy/redesign isolation. Browser tests cover posting, owner linking,
publication/approval, notification routing, preference failures, mobile/desktop
matching and original main-site regressions.

```powershell
$env:VITE_SITE_VARIANT='main'
npm run typecheck
npm run build
npx playwright test --config playwright.main-site.config.ts --reporter=list --workers=2
```

On November 2, 2026, the validated main-site build was deployed to
https://ybuy-e2e-test.vercel.app as `dpl_AGCzhitsmJrAMpPSn7PQUrmGzvwo`.
Only migration `20261102000003` was applied transactionally to the explicit test
Supabase project `jzyjmsixfuwzfnntewqn`, with migration history recorded.
The implicitly linked production database was not changed. Local SQL validation
rolls back both schema and fixture changes.

Hosted smoke checks confirmed the READY deployment and correct E2E alias, an
entry bundle matching the validated build byte-for-byte, accessible request
journey chunks, the enabled access-code gate, and the new database columns/RPCs
with anonymous match reads denied. Preview 1 remains on
`dpl_BvvDmFinF65quJ2aKSiGBVJud6ay`. Unrelated concurrent booking/tax/discovery
changes were excluded by deploying the preserved validated build, not rebuilding
the current worktree. Authenticated hosted journeys and real payment transactions
were not rerun by these deployment smoke checks.

On November 2, 2026, a subsequent hosted sandbox test used the synthetic owner5
and renter5 accounts. Request posting, five-mile owner discovery, listing
link/notification, notification-to-matches navigation, preference toggling and
request dates/two-unit quantity reaching checkout passed through the main-site UI.
Stripe Checkout used a `cs_test_` session; the $40 USD payment succeeded and the
booking became confirmed before any rental lifecycle calls. Booking reference:
`6e255776-7ef6-4590-9cd4-087b3c74a22c`. Normal authenticated RPCs then verified
pickup, return initiation, denial of renter-only return completion, and owner
completion. The synthetic listing was withdrawn and its request closed; financial
and booking audit records were retained.

This was not a clean full UI pass: checkout estimated $39.50 with $0.50 insurance,
while the authoritative two-unit booking and Stripe charged $40 with $1 insurance.
The renter Bookings dashboard reported `Cannot read properties of null (reading
'listing_images')`, so lifecycle checks used authenticated APIs rather than that
dashboard. At that point, deposit refund and owner payout were pending: `settle-rental`
returned HTTP 503 because its isolated-backend/test-credential safety gate is not
enabled for this environment. No settlement configuration or safety gate was
changed during that initial run, and no live-mode payment was submitted.

### Rental history, pricing and sandbox settlement follow-up

Booking history loaders now tolerate RLS-hidden listing/profile relationships.
They retain the booking, use the participant-visible immutable agreement snapshot
for saved titles/names, and explicitly label unavailable legacy details. They do
not widen listing RLS to expose an owner's unpublished inventory.

Main-site listing and checkout insurance estimates include the requested quantity.
Main-site pricing waits for the current platform service fee rather than briefly
displaying the legacy default. A fee lookup failure is shown explicitly and
blocks booking submission. Instant checkout now creates one pending-payment
booking, displays its authoritative line items and final total, and requires a
second confirmation before opening Stripe. Payment retries reuse that booking.

On November 2, the missing `SETTLEMENT_TEST_MODE=true` opt-in was enabled only on
the test backend `jzyjmsixfuwzfnntewqn`; live-key and backend allowlist checks remain
intact. The synthetic booking above received its $15 deposit refund
(`re_3UXMCfKV5pAwlJVi09y2BddG`). Owner transfer remains pending because the synthetic
owner has no Stripe Connect account. The test-only `settle-rental` deployment now
preserves database errors and returns `Owner must complete Stripe Connect setup`
instead of the misleading generic `Provider settlement failed`. Repeating the
request did not create a second refund. Connect onboarding must be completed
before the $20 owner transfer can be verified; no onboarding details were invented.

Customer-facing references are added by
[`20261102000006_customer_rental_references.sql`](supabase/migrations/20261102000006_customer_rental_references.sql):
booking `YB-26-000123`, matching agreement `RA-26-000123`, and a separate
`Version 1` document revision. References are database-assigned and permanent;
existing bookings/agreements are backfilled. UUIDs remain internal identifiers for
routes, joins and authorization. Main, shared and preview booking/agreement
displays use the stored reference and show `Not assigned` for an unmigrated
record rather than inventing a reference from its UUID. Adding a number does not
change the agreement's legal approval or acceptance status.

On November 2, the isolated rental-fixes release was deployed to the main E2E
site as `dpl_2gzhQisn1bffsWqAmNssMyX3ujRR`. Its source snapshot uses the tracked
baseline plus the restored main site, existing bidding/request journey and
approved rental fixes; unrelated frontend tax and discovery changes were excluded.
Only reference migration `20261102000006` was applied by this release to test
backend `jzyjmsixfuwzfnntewqn`. It backfilled 66 bookings and 47 agreements.
Rollback and apply assertions verified that existing booking/agreement data,
including booking update timestamps and agreement acceptances, were preserved
apart from the new reference fields. The synthetic completed rental is now
`YB-26-000066`, agreement `RA-26-000066`, Version 1.

The exact isolated release passed typechecking, its build and all 22 main-site
browser tests. Hosted checks verified matching entry/checkout/CSS hashes,
the enabled access gate, and normal renter-authenticated access to the saved
agreement while withdrawn listing details remain hidden by RLS. The shared
browser connection was unavailable, so no new hosted UI payment was performed.

During final verification, an independent deployment moved Preview 1 to
`dpl_tdtcgfrkR3TFa6NenMd6Wr2dhJpd` and added migrations `20261102000004`,
`20261102000005` and `20261102000007` to the shared test backend. This release
did not perform those deployments or revert them. Their integration with the
isolated main frontend has not been fully retested; backend tax changes may
affect new bookings. The user then requested skipping further deployment, so
no additional rollout or rollback was performed.

Local validation passed the build, TypeScript checking, scoped lint, and 38
booking-history, reference-formatting, pricing and settlement tests. All 22
main-site browser cases passed across the initial run and isolated reruns of five
cases whose first run lost trace files to a shared-output collision. These checks
include mobile/desktop quantity pricing, the explicit final-price confirmation,
fee-load failures, request notification routing and preserved dashboard layouts.
The reference migration also passed 26 rollback-only SQL assertions, including
supplied-reference protection. An isolated local concurrency check verified
distinct allocations across the six-digit boundary under overlapping sessions;
it uses minimal booking/agreement tables rather than the complete booking flow.

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
Rental, bidding and community request cards share the same bordered white
surface, corner radius, title scale and body spacing, with actions aligned at
the bottom. List views retain their horizontal layout. Shared Preview dialogs
keep their headers visible and scroll long content internally; date/filter
actions use a separate footer, while request form actions stay in their form
with a sticky footer. Existing Radix dialog action footers also remain sticky.

The current application defaults to Preview 1's cobalt/lime palette, not Ocean
Green. The live app and local preview share `src/styles/preview-one.css`.
The approved palette uses ink `#172321`, cobalt `#3157E1`, lime `#D8FF68`,
forest `#163D34`, white `#FFFFFF`, paper `#F7F6F1`, sand `#EEEAE0`,
border `#DCDED7` and muted text `#62706D`. Category backgrounds and
success/pending/information states are centralized in the same shared CSS tokens.
Camping and Garden use Outdoor's color; Party and Music use Fashion's color,
and Electronics uses Vehicles' color. Error states retain their accessible red.
Primary CTAs consistently use cobalt with white text, including bidding,
request cards and promotional actions. The legacy lime button variant maps to
the same primary treatment; lime remains available for non-button highlights.
Secondary navigation and Cancel/Back stay neutral; destructive actions stay red.

The approved notification center is available at `/notifications`, with the same
category/day grouping and responsive settings as `/preview-1#/notifications`.
Production uses real account notifications (including marketplace requests),
saved in-app category preferences, selection/mark-read actions and a numeric
unread bell. Counts within the center describe loaded history; older updates
remain available through pagination. Email preferences remain in Profile &
settings. Bookings, payments and safety/support cannot be muted in either
channel. Winning bids and time-sensitive auction actions bypass optional
bid-activity preferences. Database constraints and delivery triggers enforce
this policy, including direct notification inserts. Muting does not remove
existing inbox history. The preview still uses isolated sample data and
session-only preferences.
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

On November 1, 2026, the current frontend was deployed to
`https://ybuy-redesign-v1.vercel.app` and all ten repository Edge Functions were
deployed to its authorized test backend, `jzyjmsixfuwzfnntewqn`. The checkout
delivery/notes, atomic availability, request-listing link and profile bio
migrations were applied there; the hosted migration history is up to date.
Anonymous execution of the new owner/checkout RPCs is denied, profile RLS remains
enabled, and the rollback-only 30-day scheduling checks passed. Provider secrets
were unchanged and notification email delivery remains disabled. Full hosted
checkout, settlement and payout regression has not been rerun.

On November 1, 2026, the current workspace frontend was subsequently deployed to
both `https://ybuy-redesign-v1.vercel.app` and
`https://ybuy-e2e-test.vercel.app`. Competitive bidding migration
`20261102000001_competitive_bidding_completion.sql` was applied first to their
shared test backend, `jzyjmsixfuwzfnntewqn`; the production backend was not changed.
Rollback-only checks passed before and after applying the migration, covering
the two-hour cutoff, configured increments, bidder privacy/history, one-hour
owner decision window, pending-payment booking and missed-decision notification.
They leave no synthetic fixture users behind. Rerun those checks with:

```powershell
npx supabase db query --linked --project-ref jzyjmsixfuwzfnntewqn --file tests\staging\competitive-bidding-completion.sql
```

Typecheck, focused bidding lint, the production build and the hosted test-profile
safety test passed. Both deployed entry bundles returned HTTP 200. The redesign
site's live bidding directory loaded real auctions; the main test site's security
code gate remains enabled. These are deployment smoke checks, not a full hosted
payment regression or a run of the complete pgTAP suite. Preview 1 remains a
sample-only demo. Deposits still use the existing combined checkout charge,
not a separate authorization hold.

The main test site's build must set `VITE_SITE_VARIANT=main`. This selects the
complete October 30 UI from `00bb794`, isolated in `src/main-site`: original
pages, navigation, controls, cards, dialogs, layout rules and global stylesheet.
It reuses current marketplace APIs and authentication, not the old backend.
The restored bidding screens retain scheduled opening/closing times, configured
increments, renter-only bid history/rank, owner full history/profiles/ratings,
and the one-hour post-close winner-selection window. Both UUID auction URL forms
use real bidding; sample auction IDs and empty-feed samples require `mock_bidding`.
Leave the setting unset on `ybuy-redesign-v1` to preserve its redesign.
The entry points load their own stylesheets so Preview 1 styles cannot override
main-site layouts. The main entry fixes its theme to `main`, ignoring saved demo
themes, and uses the original Inter/Plus Jakarta Sans typography and corner radii.
Legacy `/dashboard/listings` and `/payouts` URLs open the original lending
dashboard, which contains inventory, availability and earnings together.
Its palette is primary `#0E7C66`, hover `#096653`, deep green `#075B4D`,
light green `#D8F0E8`, pale green `#EFF8F4`, highlight `#E9B949`,
secondary accent `#F28B64`, background `#F6F7F3`, cards `#FFFFFF`,
text `#172321`, secondary text `#687873`, borders `#E1E8E4`,
success `#25865B`, warning `#D99A29`, and error `#C94C4C`.
Shared template color aliases resolve to this palette on the main site only;
the redesign keeps its cobalt/lime theme. The compiled-browser regression checks
all 15 exact tokens, the page background, primary-button normal/hover colors,
and shared bidding aliases with a stale Preview 1 preference in browser storage.
The earlier router/homepage-only restoration was incomplete: shared redesigned
components still changed inner pages. The full isolated UI replaces that partial
fix without rolling back the bidding database or deploying the redesign project.
The focused compiled-browser regression covers public home/search/listing/bidding,
sign-in, authenticated renter/owner dashboards, listing creation and notifications
at 390, 768 and 1440 pixels using mocked API responses. This is UI regression
coverage, not a hosted authentication/payment regression. Run it with:

```powershell
$env:VITE_SITE_VARIANT='main'
npm run build
npx playwright test --config playwright.main-site.config.ts --reporter=list
```

The full restoration is deployed to `ybuy-e2e-test.vercel.app` as
`dpl_FVkEzAi75E4zE33AL6hAkjCJvxWF`. Typecheck, focused lint (no errors), both
variant builds and all eight compiled-browser tests passed. The owner bidding
test also verifies full bidder profiles/history and selection beyond rank three
only after bidding closes. Hosted checks confirmed deployment readiness, all
15 palette tokens, original fonts/radii and the enabled security-code gate.
The redesign deployment remains `dpl_BvvDmFinF65quJ2aKSiGBVJud6ay`; no database
changes were made for this restoration.

Shared Preview 1 form controls have persistent borders and padding before focus.
Native checkboxes use the cobalt checked state and retain keyboard, disabled,
indeterminate and system high-contrast behavior. Sign-in fields and actions use
consistent spacing.
The homepage retains the supplied camping, mixer and drill imagery. Production
only shows a rental price and listing link when the matching published inventory
exists; otherwise those are editorial category links.

Hosted passwordless test-profile selection is restricted to
`ybuy-redesign-v1.vercel.app` and `jzyjmsixfuwzfnntewqn`. Enable
`VITE_TEST_PROFILE_LOGIN=true` and `YBUY_TEST_PROFILE_LOGIN=true`, and configure
server-only `YBUY_TOTP_SECRET`, `YBUY_ACCESS_SESSION_SECRET` and
`SUPABASE_SERVICE_ROLE_KEY`. The existing authenticator verifier grants a signed,
HttpOnly, two-hour tester cookie; both listing and selecting profiles require it.
Only the existing marked `owner1`-`owner5` and `renter1`-`renter5` synthetic
accounts are allowed, and any account in `admin_users` is excluded.
No accounts, permissions or emails are created by the picker. Keep the site-wide
`YBUY_TEMP_ACCESS_ENABLED` flag separate; missing tester configuration fails closed.
The top-right avatar opens a compact anchored dropdown with Sign out and, in
enabled test environments, Switch profile. It does not open a modal; workspace
links remain in the existing navigation.

The essential TypeScript check and production build pass. The local Vite server
responds at `http://localhost:5174`. All 24 Preview views (including six admin
sections and the state gallery) rendered without JavaScript errors. The main
route render check also found no JavaScript crashes; this is not full workflow QA.

The earlier local-only validation included these migrations (now also applied
to the authorized hosted test backend as recorded above):

- `20261101000001_atomic_owner_availability.sql`: one owner-only transaction for
  availability and blocked days, with revision and booking guards.
- `20261101000002_public_request_listing_links.sql`: links an owner's matching
  published listing using existing matching rules and notification deduplication.
- `20261101000003_profile_bio.sql`: restores the Preview's About you field with
  owner-scoped profile persistence, length and database plain-text validation.

### Owner-flow corrections and default charged tax

- Discovery queries and auction feeds exclude a listing when its exclusive
  `availability_end` is today or earlier (UTC). Owner inventory keeps the record
  and displays **Expired**, so it can be recovered without deleting rental history.
  Mounted discovery and owner pages recheck at UTC midnight and after returning
  to a visible browser tab.
- Owners choose **Available from** and **Available through**, including both dates.
  A one-day selection is valid; the saved return cutoff is the following day.
  The existing 30-day limit and 180-day scheduling horizon still apply.
- Photo validation tells owners to select a larger original and upload again.
  Replacement-value limits remain controlled by `listing_max_estimated_value`
  and enforced by the database, rather than a hard-coded form maximum.
- **Use my location** fills a complete pickup address using browser geolocation
  and Google reverse geocoding. It requires location permission, configured Google
  Maps access and an enabled marketplace country. A failed lookup keeps the prior
  address and gives recovery instructions.
- Private-offer controls are removed from both production variants. The discovery
  migration turns off the private-offer flag without deleting historical records.
- Saved bidding settings confirm the actual opening/closing schedule and link to
  auction management. The ribbon is mounted in both variants, includes zero-bid
  open auctions at their opening rate, shows the newest 24 first, and refreshes
  after saving and every 15 seconds. Scheduled auctions appear only when they open.
  Sample ribbon cards require the explicit `mock_bidding` flag.
- **Default charged tax** is 7% of discounted rental plus service fees for new
  bookings, with both test and live Stripe keys. Deposits, insurance and delivery
  are excluded. Migration `20261102000007_default_booking_tax.sql` supersedes the
  old sandbox gate without changing existing booking/agreement tax snapshots or
  totals. Historical sandbox-only bookings still cannot use live Stripe keys.
  Both variants show **Tax (7%)** and use the server-confirmed total for payment.
  This is a fixed policy, not jurisdiction-based Stripe Tax.

On November 2, 2026, migrations `20261102000004` through `20261102000007` and
checkout function version 13 were deployed to the authorized hosted test backend
`jzyjmsixfuwzfnntewqn`. All 66 existing booking totals were preserved
(aggregate $5,156.05). The redesign test site serves the updated tax UI.
The main tax release `dpl_AMBNoFh2w8V85oEsPSAx6r9V1hfH` is ready and its
tax-enabled assets were verified, but a concurrent main-site deployment replaced
the public alias; the user chose to keep that newer deployment. Its pre-booking
estimate UI is not this tax release. The shared backend still charges new bookings.
The production backend was not changed and no payment was initiated.

Validation passed: 49 tax, 14 discovery and 26 customer-reference SQL assertions,
13 checkout pricing tests, five compiled browser tests across both variants with
test mode disabled, TypeScript, both builds and focused lint (no errors).

Local `item_requests` and `bidding` feature flags remain disabled. The local
`owner-payout-status` function returns 503 because Stripe settlement is not
configured; that failure is surfaced, not replaced by simulated payout data.
Hosted migrations are now applied; authorized provider configuration and full
workflow verification remain release gates. Do not enable private offers.

Deferred QA: full owner/renter workflow regression; mutation failures and retries;
all-screen pixel, mobile/tablet and accessibility checks; hosted Stripe checkout,
webhooks, settlement and bank-payout verification. No new automated tests or
full regression suites were executed in this minimal-validation phase.

### Checkout delivery and notes

The local database has applied `20261031000002_checkout_delivery_notes.sql`.
Only this exact, successfully applied version was recorded using local migration
repair; unrelated historical drift was not marked as applied or reset. The authorized hosted test database now has the same migration, as recorded above.

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
bid form or leaderboard. Renters see the anonymous top three and their own bid
history and current rank; competing renter identities remain private. Owners see
all bids, bidder profiles, ratings, payment state and the decision deadline in My
auctions. After bidding closes, owners have one hour to select any eligible bidder;
the highest eligible bid is selected automatically if the window expires. The
minimum bid increase is configured in Admin global settings.
Regular bookings can coexist with open bidding. Pending booking requests do not
reserve auction capacity, while a confirmed overlapping booking closes the
auction. A selected winner's pending checkout reserves inventory until payment or
verified checkout expiry is reconciled.
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
