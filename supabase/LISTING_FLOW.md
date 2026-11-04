# Owner listing flow

## Latest E2E deployment

All current changes were deployed to `https://ybuy-e2e-test.vercel.app` as
`dpl_EouNhsY3AMuSybukmfedNTP7jY7W`. Vercel reports Ready and the access gate
responds with HTTP 200 after redirect. Main production was not changed.
Hosted-test migration history now includes the missing discount/promotion,
test-terms and scheduling prerequisites, local auction times, optional identity,
automatic auction winners and weekly/monthly discount migrations through
`20261028000004`. Existing feature gates remain unchanged.

Verification passed TypeScript, scoped lint, the production build and 299 local
SQL assertions. Of 24 focused Playwright checks, 22 passed; the calendar check
timed out during reload after passing selection/bounds checks, and an older
draft scenario could not find its expected photo-quality warning. Calendar
screenshots now show the month grid on mobile and dark desktop; its entrance
animation no longer hides content behind zero opacity. Authenticated hosted
booking, auction settlement and a fresh Stripe sandbox payment were not retested.

## Optional brand and model

Brand and Model are optional in Details, including at publication.
Photo analysis fills both automatically when clearly identified in the photos
or owner-provided text. Unknown values can stay blank; AI must not
guess a brand/model or insert placeholders. Owners can correct suggestions.
Regeneration, late AI responses and draft resume preserve owner-edited values.
Photo-only drafts can still be saved before Details is complete.

The AI response includes nullable `brand` and `model` fields. The browser tolerates
their absence during endpoint rollout. Supplied values retain their length and
plain-text validation. The updated `analyze-listing-photo` function is deployed
to hosted test with JWT verification enabled.
Migration `20261028000001_optional_identity_availability.sql` removes the former
required-identity trigger without clearing existing values or changing RLS,
owner authorization, publication review, inventory or payment guards.
Browser/provider tests use mocks rather than a real photo/provider inference.

Migration `20261021000025_listing_flow.sql` was applied locally and to the
`ybuy-e2e-test` hosted project on 2026-10-22. It has not been applied to the
separate `YBuy` hosted project.
Follow-up migrations `20261022000001` through `20261022000004` are also applied
to `ybuy-e2e-test`. Availability, value bands, and required descriptions were
deployed on 2026-10-22 with Vercel deployment
`dpl_8oCvygBjpVmYj2p9QwfK1saELfbK`. The alias was verified Ready; HTTP smoke
checks reached the existing access gate. Authenticated hosted journeys were not
retested during deployment.
The browser contract is `src/lib/listing-flow.ts`; there is no legacy fallback.

## Competitive auctions

### Public bidding directory

The expanded LIVE BIDDING label links to `/bidding`. It now browses real open
auctions under the `bidding` flag; the old simulated bidding experience remains
available only under its separate `mock_bidding` gate when real bidding is off.
The directory filters by category, reports global category counts, and loads
24 auctions per page, ordered by closing time then listing ID.
Auctions without bids display the starting daily price, not a fabricated bid.
Expired, unpublished and restricted-owner auctions are excluded; restricted
bidders do not contribute to the displayed highest bid. No bidder identity,
private pickup data or private negotiation proposals are exposed.

Migration `20261027000007_bidding_directory.sql` adds the public read-only
`get_listing_auction_feed(p_category_id, p_offset)` RPC. Its response is
`{ items, total, categories }`. Polling refreshes every loaded page together
every 15 seconds; local deadline checks hide expired cards between refreshes.
Category changes reset pagination and ignore stale responses. Errors remain
visible with Retry; failed refreshes never become synthetic results.

The ribbon and directory share 10 sample rental items. Samples appear only in
test builds with an empty successful feed and are labeled TEST DATA. Directory
samples cannot create bids, bookings or payments. A real feed with no matching
filtered category stays empty instead of switching to samples.

The directory migration is installed locally and on hosted test
`jzyjmsixfuwzfnntewqn` (2026-10-27). Hosted smoke verification returned the expected
array/count contract and confirmed anonymous read access. Local tests passed
18 directory assertions plus 80 existing auction lifecycle assertions. Main
production and Vercel deployments were not changed.

Verification also passed the production build, TypeScript, scoped lint, eight
focused browser checks and a selected-category regression rerun. Directory
screenshots were reviewed at 1440px, 375px and 812px, including reduced-motion
filtering and wrapped category controls. Browser data was mocked; this did not
exercise a fresh hosted bid, booking or payment.

Migration `20261027000005_competitive_listing_auctions.sql` adds the separate
competitive-auction lifecycle. Private negotiation continues to use its existing
approved price boundaries; its proposals are no longer included in the public
`get_top_listing_bids()` feed.

Applied to hosted test `jzyjmsixfuwzfnntewqn` on 2026-10-27 with migration history
recorded. The checkout-expiry Edge Function update was deployed first. Hosted
verification confirmed the auction columns/RPC, enabled bidding flag, active
minute scheduler and private internal worker grants. The production project
was not changed. Local validation passed 80 auction SQL assertions, 164 listing
assertions, two auction UI tests, seven checkout-worker tests and the production
build. A real Stripe sandbox purchase was not performed. Older standalone
marketplace SQL suites remain blocked by existing date/country fixture mismatch.

- Owners configure negotiation after publication, below the success hero or
  from My listings > Negotiation options. Pending review does not expose setup.
  `20261027000008_post_publication_negotiation.sql` adds the authenticated,
  owner/revision-checked `owner_configure_listing_negotiation` RPC, saving
  private offers and auction preferences atomically.
- Owners choose local bidding timestamps and separate fixed rental pickup/return
  dates within listing availability. New auctions close at least one local
  calendar day before pickup; the first close is ten minutes before the hard
  deadline, allowing bounded two-minute anti-sniping extensions.
- The first bid is at least the asking daily price;
  later bids increase the highest submitted rate by at least $1/day. A renter
  may submit three bids, with idempotent retries not consuming another attempt.
  Bid validation and inventory allocation serialize on the listing row.
- Only the top three current anonymous bidders are public. Raw bid tables have
  RLS enabled and no client access. Only the current renter sees their booking
  ID and private bid usage. Owners cannot bid on their own listings; restricted
  accounts cannot bid or win.
- Owners may select any eligible current top bid while bidding is open. If they
  do not, the highest eligible bid is selected automatically by the minute
  scheduler after closing, with equal bids ordered by earliest submission.
  Selection creates a one-unit pending-payment booking at the winning rate,
  with normal fees, deposit and rental agreement capture, but no additional
  owner promotion/duration discount. Payment is not taken when placing a bid.
- Auction checkout lasts one hour; ordinary checkout remains 15 minutes.
  Confirmation still requires the existing trusted Stripe verification path.
  An unpaid/declined winner is passed to the next eligible bidder only when any
  associated Stripe checkout is known closed. Processing delayed payments stay
  reserved. Failed delayed-payment intents must be canceled before passing.
  Late verified receipts for already-passed bids become support exceptions,
  never a second booking. A Stripe outage pauses safe runner-up progression.
- One unit is held against other overlapping booking requests while the auction
  is scheduled/open/selecting. Listing terms, photos, pickup and blocked dates are locked
  during the auction. Existing paid rentals and capacity guards remain intact.
  An auction cannot be restarted by toggling its setting.
- The trusted `process_listing_auctions()` cron runs each minute. Winners and
  selection reminders use existing notification preferences/dedupe. Future
  auctions do not consume its bounded work batch. Opening is evaluated using
  server time on each bid/read, not dependent on the cron tick.
  Auctions with no eligible bids, insufficient inventory or insufficient time
  to finish payment before pickup end without a new reservation.

The six-step creation/edit form no longer writes negotiation preferences. Existing
settings are preserved by ordinary saves. The post-publication control surfaces
schema/permission errors instead of claiming success. Scheduled auctions appear
as `scheduled` with `starts_at` in the listing panel; early bids are rejected by
the database and scheduled auctions are excluded from the live directory/ribbon.

Migration 00008 is installed locally and on hosted test
`jzyjmsixfuwzfnntewqn` (2026-10-27). Verification passed 27 scheduling assertions,
80 auction lifecycle assertions, 18 directory assertions, TypeScript, scoped
lint, the production build and the scoped 21st review. All five focused browser
scenarios passed across targeted runs: pending-review gating, post-publication
schedule saving and owner-management restoration, scheduled renter bidding,
private-offer validation/persistence/error handling, and unconfigured offer policy.
Initial test failures were corrected selectors, missing realtime fixture replies
and a clock mock; the final owner test fixes Date without replacing timers.
Desktop/mobile negotiation screenshots were reviewed.
The frontend is deployed to `https://ybuy-e2e-test.vercel.app`, deployment
`dpl_6accv4im9dFzi2JAdiQntwHifCZ5`, with the existing access gate retained.
Main production is unchanged.

## Policy and administration

Super Admin → System configuration uses the existing audited settings framework.
The secure `get_listing_flow_policy()` RPC returns only listing policy and category
deposit rules, not unrelated private application settings. Missing settings fail closed.

Existing ceilings remain quantity 100, six photos, 10 MiB uploads, and 320-pixel
minimum dimensions. Migration `20261028000001_optional_identity_availability.sql`
supersedes the former 30-day span and 90-day horizon, setting
`listing_duration_days` to 180. Owners can choose dates from today through
today + 180 days without a separate 30-day cap. The return date is exclusive
and must follow pickup; the latest pickup is today + 179. November 19–20
is one rental day, returned by November 20. Both client and server enforce the
same bounds, with the owner's validated browser timezone retained by the save RPC.
Month navigation transitions immediately without waiting for an exit animation,
respects reduced motion, and no longer shows the former rules list.
Existing saved windows remain unchanged on unrelated edits. Changed windows and
draft publication obey the new bounds. Reservation, quantity, authorization and
payment guards remain in place. All rates remain daily.

Asymmetric offer percentages remain unapproved. The approved replacement-value
bands are applied by `20261022000003_listing_value_bands.sql`:

- `listing_offers_configured=false` makes both public offer percentages null.
  Configure the below/above **fractions**, then enable this setting and the
  existing `bidding` flag. Numeric zero placeholders do not constitute approval.
- `listing_high_value_threshold=1000`: declared values **$0–$1,000 inclusive**
  can publish after all other checks pass. Values **above $1,000 through $5,000**
  remain `pending_approval` until individually reviewed.
- `listing_max_estimated_value=5000`: values above this cannot be saved in a
  draft or published, including by an administrator. Both limits are controlled
  through the existing Super Admin settings; an inconsistent review threshold
  above the maximum fails closed. Setting the review threshold to zero still
  disables automatic publication.
- Zero must be explicitly entered; a blank value does not count as zero.
  Existing pending listings are not bulk-published by the migration. An owner
  can explicitly republish a now-eligible pending listing; all publication and
  moderation checks run again.
- Listings → Pending approval shows saved terms/photos. An authorized moderator
  explicitly approves the exact current revision with an audited reason.
  Owners cannot write approval records. Content/media changes invalidate
  individual approval; offer-only changes retain it when policy-valid.
- Delivery fees are approved at **$1–$99 per trip** when delivery is enabled.
  Migration `20261022000001_delivery_fee_range.sql` sets the configured maximum
  to 99 and constrains new/updated delivery-enabled rows to this range.
  Existing out-of-range rows are not repriced; owners must correct them on edit.
  `delivery_fee` is persisted and validated but **is not an additional checkout
  charge**. Do not advertise collection of this fee without a separately approved
  checkout/payment change.

Deposits are calculated in the database on listing writes:
`clamp(round(estimated_value * suggested_pct, 2), minimum_amount, maximum_amount)`.
Existing category rules are preserved; missing rules are seeded with the existing
approved 30% default, minimum 0, maximum 10,000. New categories receive the same
rule. Owners cannot set a different deposit.

## Saving and publishing

`owner_save_listing_flow(listing_id, revision, details, pickup, publish)` holds the
listing lock for the complete transaction, reuses existing pickup/edit protections,
and returns the **actual final** `{revision,status,deposit}`. Dates are
`availability_start` and `availability_end` (exclusive). Refresh the revision after
photo changes. No-op repeat publication is idempotent; stale revisions still fail.
Identical details and pickup do not cause unnecessary revision changes.

Description is required (at least 10 trimmed plain-text characters, 2,000 total maximum) before continuing
past Item details. Migration `20261022000004_listing_description_required.sql`
enforces the minimum on submission to review, publication, and description edits
to live/pending listings, regardless of the client. Incomplete private drafts
remain saveable. Existing listings are not rewritten or unpublished, and unrelated
updates to legacy descriptions remain allowed. The old browser environment flag
cannot make description optional.

Publication requires a valid description, declared value, condition, at least one photo, private pickup,
valid availability, and no unresolved high-confidence `prohibited_item` or
`drug_related` flag. Advisory/quality flags do not block publication.
These checks do not prove moderation ran: existing moderation remains advisory
except for authoritative persisted blocking flags.
Clean AI regeneration does not resolve historical blocking flags. A trusted
reviewer must resolve a false positive through the existing database moderation
workflow; there is not yet an owner-facing appeal or flag-resolution RPC.

`20261027000002_draft_offer_preferences.sql` lets owners save offer preferences
on draft, pending and published listings. Archived/suspended listings remain blocked.
The existing `owner_save_listing_flow` RPC accepts nested `offer_preferences` in
details and saves listing terms, preferences and requested publication in one
transaction. Invalid preferences roll back the entire save. The wrapped legacy
implementation is private. Renters still require a published listing before bidding.
The current UI configures offers after publication using percentage range inputs
based on approved policy, independently of competitive bidding. New owners
explicitly choose an expiry; existing narrower offer dates and targets are
preserved unless changed. Legacy draft preferences remain supported by the
original RPC but are no longer edited by the creation wizard.

`owner_save_offer_preferences(listing_id, revision, preferences)` also remains an
explicit owner-only RPC. Its maximum is
`offer_maximum_daily`, **not** `offer_target_daily`. The platform asymmetric
bounds constrain narrower owner bounds; offer dates must fit listing availability.
The browser sends the actual availability dates when the owner selects "Use listing
availability"; null dates are not accepted for enabled offers. Owners must choose
an expiry of 1 to 168 whole hours before enabling offers. Existing saved expiry
values are retained; new listings do not silently receive a response deadline.
Valid owner bounds survive asking-price edits; invalid bounds disable negotiation
without silently changing the owner's saved target/minimum/maximum.

`owner_reorder_listing_images(p_listing_id, p_urls)` accepts a complete permutation
of exact persisted URLs, atomically updates ordering, and returns the final revision.
Signed URLs must first be normalized to their persisted storage URL representation.

## Availability and media limits

Capacity includes requested, unexpired checkout, confirmed, active and return-pending
units. Shared capacity checks, the booking RPC, booking writes/approval and listing
offers enforce persisted availability. Shrinking dates or quantity cannot displace
reserved rentals. Existing active-rental material-edit protections remain in place.
Legacy listings with null availability retain their old unbounded behavior until
the owner saves dates; no speculative existing booking windows are backfilled.

Storage enforces actual upload bytes and permitted MIME types. Changing
`listing_max_photo_bytes` updates the bucket limit. Photo count uses a listing lock.
SQL cannot decode uploaded image dimensions; the 320-pixel dimension policy remains
browser validation, **not a server-side security guarantee**. Existing external
image URLs are not retrospectively downloaded or verified. A trusted image-decoding
service would be required to enforce dimensions authoritatively.

## Local validation

### Renter-selected auction dates

Migrations `20261103000007_renter_date_auctions.sql`,
`20261103000008_owner_required_auction_winners.sql`, and
`20261103000009_required_renter_date_windows.sql` are additive. **All winners must be chosen
by the owner before bidding closes**. There is no owner decision grace period and
no automatic winner or unpaid-winner fallback in either mode. New auctions always
allow renters to choose a subrange of the owner's dates. This is not an owner
opt-in; older clients sending `date_flexible: false` are normalized to true when
creating an auction. Invalid non-boolean values remain rejected.
The persisted listing field is `auction_date_flexible`; the auction response
field is `date_flexible`. Migration 09 upgrades still-scheduled/open, unselected
auctions whose closing time has not passed, preserving every existing bid's dates
and value. Auctions with selected bookings and historical closed auctions retain
their original mode. Owners cannot reconfigure an existing auction.

Flexible bids require `p_start_date` and `p_end_date` in
`place_listing_auction_bid`, alongside the existing listing ID, daily rate,
idempotency key and deposit-hold consent. End dates are exclusive. Dates must fit
the owner's auction window and available inventory. Three attempts are shared
across all ranges in one auction; retries must retain the original dates/rate.

The leaderboard orders eligible bids by descending `total_value`
(`daily_rate * (end_date - start_date)`), with submission time and bid ID breaking
ties. Overlapping winners are mutually exclusive even for multi-unit listings;
nonoverlapping ranges can each win. Rank is display information, never winner
selection. Flexible owners may choose eligible disjoint bids while bidding is
open; their first selection does not close bidding or prevent further choices
before the original closing deadline. Fixed-period owner selection still closes
that auction and starts its single winner's payment window.

`get_listing_auction(p_listing_id)` returns all ranked flexible bids, plus
`participant_count` and `total_bid_count`. Top, personal and owner bids include
`start_date`, `end_date`, `total_value` and `selected`. Personal and owner bids also
include `booking_id`, `payment_deadline` and `payment_status` (`pending`, `paid`,
`expired`, or null before selection); public top bids never expose booking IDs.
The three-argument overload additionally accepts `p_start_date` and `p_end_date`
and filters top bids to overlapping ranges. Its `minimum_next_bid` is the exact
daily rate, rounded up to cents, required to exceed the highest nonpassed
overlapping total by the configured daily increment times the selected days.
Without overlaps (or without a date filter), the flexible minimum is the opening
daily rate.

Each winner has its own booking/payment deadline. Renter checkout should use
`my_booking_id`, `my_payment_deadline`, and `my_payment_status`, or the per-bid
fields when one renter wins multiple nonoverlapping ranges. Flexible auctions do
not populate the legacy singular `selected_bid_id` or `payment_deadline`.
Aggregate flexible status remains `open` until bidding closes, then becomes
`awaiting_payment` until all surviving owner-selected winners have successful
payments, and finally `completed` (or `ended` if none survive). Without any owner
selection the auction expires immediately at closing; retrieval advances expired
auctions as well as the minute-based lifecycle worker. A failed winner's range is
not released until its checkout session is closed. A replacement requires another
explicit owner choice before closing, never automatic selection. Late payments
after replacement are recorded as support-review exceptions.

Owner nondecisions create admin-only audit events. Migration
`20261103000010_admin_only_auction_decisions.sql` restricts decision-event reads
and auction count/flag fields to active administrators with `config.manage`.
Public and owner responses omit counts and flags and return a null missed timestamp.
`get_owner_rating_stats` returns zero for non-admin missed counts, without changing
the actual review average or its always-zero adjustment. Marketplace pages never
display decision counts, even when visited by an administrator. Existing
administrator event exclusions remain available.

The separate administrator portal provides **Super admin > Missed bidding decisions**
(`/admin/auction-decisions`). Migration `20261103000011_admin_auction_decision_list.sql`
adds the `config.manage`-protected, server-paginated `admin_list_auction_decisions`
RPC. Its read-only table shows owner, listing, closing and detection times,
eligible bids, attributable owner miss count, and any audit exclusion.

Migration `20261103000012_admin_user_auction_history.sql` adds owner/Customer ID/
email/listing search through `admin_search_auction_decisions` and private count/
last-miss fields to `admin_list_users` for `config.manage` administrators only.
**Users > Bidding history** opens the same decision ledger filtered by owner ID.
Counts are review indicators, not account restrictions or review-star adjustments.
Localhost and hosted test environments have independent records; local events
are not copied or manufactured in hosted databases.

Local checkout also requires migrations `20261103000005` and `20261103000006`
(rental-first payment and pre-check-in). Missing these while serving current
Edge Functions can fail booking reads on the absent `payment_first` column.
Deposit functions report database failures separately from missing bookings;
apply missing migrations without resetting or deleting existing reservations.

`supabase\tests\renter_date_auctions.sql` uses rollback-only fixtures and covers
configuration, range validation, overlap quotes, independent winners/payment
windows, retries, capacity, session closure, late receipts, notifications and
fixed-period compatibility.

### Photo analysis reliability

`analyze-listing-photo` authenticates the active owner and verifies that signed
photos belong to the listing before contacting OpenRouter. Provider calls have
an 18-second timeout and at most two attempts for network failures, HTTP 429,
or HTTP 5xx. The browser allows 45 seconds for both attempts and other work.
Authentication, billing/usage-limit failures, and invalid AI output are not
automatically retried. Errors are shown inline; manual entry remains available,
and regeneration preserves owner-edited fields.
On draft resume, blank title/description fields remain eligible for AI fill.
The provisional category on an empty photo-only draft is replaced by the AI's
category; a category accompanying saved item details is preserved. Saved
nonblank owner text and edits made during analysis remain protected.

`ok: true` means deterministic moderation completed, not that AI succeeded.
Check `suggestion` and `aiError`; no suggestion is invented on failure.
Moderation flag persistence failures return HTTP 503 instead of silently succeeding.
Provider bodies, keys, and private photo URLs are not logged.

The 2026-10-22 hosted diagnostic found the OpenRouter key's non-resetting
$0.10 total usage cap exhausted. An operator must raise/remove that limit in
OpenRouter settings or securely configure an authorized replacement
`OPENROUTER_API_KEY` in the **e2e** Supabase project. No application retry can
restore exhausted credit or guarantee external-provider uptime.
After provider access was restored, authenticated hosted text-only analysis and
photo-only analysis both returned complete title/description/category suggestions.
The photo smoke used a temporary owned draft and signed private image; its image,
listing, and account were deleted afterward. The main YBuy project was not changed.
The reliability fix was deployed to the e2e Edge Function and Vercel deployment
`dpl_Fo1GKte85xGRHKz5iWdbP1VM5Ver`. All 14 focused AI/provider/browser regression
tests passed, along with frontend typecheck, focused lint, and production build.

```powershell
npx --no-install supabase migration up --local
npx --no-install supabase test db supabase\tests\listing_flow.sql --local
npx --no-install supabase db lint --local --schema public --level error
```

The focused SQL test transaction rolls back fixtures and policy changes.
Hosted changes require explicit approval and verification that the database
project matches the target Vercel environment.

## Owner interface

The existing Vite/React route uses Photos → Details → Rental settings →
Availability → Location & review.
The mint-and-white owner layout follows the supplied screenshot with a compact
horizontal progress rail and exactly one centered active card. Photos/details
and rental settings use a bounded 672px workspace; availability/location use a
wider card. There is no persistent preview or guidance sidebar. The final screen
places the private pickup/handoff fields beside the renter-facing preview;
smaller screens stack these groups. Rental settings include price, quantity,
replacement value and booking approval. Owners configure percentage-based offer
limits, response deadlines and competitive bidding only after publication.
Migration `20261027000002_draft_offer_preferences.sql` was applied and recorded
on the local development database and hosted test project on 2026-10-27.
It preserves policy, ownership, revision and publication checks. No non-persisted brand/model/accessory fields or fabricated reminders
have been added. Existing
semantic theme tokens, accessible controls, and success components are reused.
The supplied DM Sans/Manrope fonts are scoped to the journey. Item condition uses
native radio inputs styled as pills, including arrow-key navigation and visible
focus. The template's sample data, static quality badges, hardcoded offer
percentages, and simulated publication behavior are not used.
AI generation shows the existing reduced-motion-aware skeletons on Photos and
Item details without disabling manual editing. Success, failure, or cancellation
removes the loader. Replacement-value limits are disclosed in Rental settings;
backend limits and deposit calculations remain enforced. Daily USD
pricing is a single amount field with a fixed `/ day` suffix, not a period selector.
Step transitions use the existing Motion dependency and respect reduced motion.
The availability screen reuses the accessible month grid, shows two months on
larger screens and one navigable month on phones, and explains inclusive owner
pickup/return dates without an inclusive-end conversion. Keyboard day navigation and linked
cross-step validation are preserved.

Selecting a complete pickup address automatically prepares it for private saving;
City/State/ZIP and the extra confirmation button are not shown. Their values are still
captured from Places and saved. "Do not share yet" describes the enforced default,
not permission to publish without an address or expose it before confirmation.
The marketplace city and coordinates guide address suggestions, but do not
confirm a private address. Draft publication saves the draft before required
moderation. Review transport errors are distinct from save errors, keep the draft,
and offer Retry publication; they never bypass moderation or mark a listing live.
Migration `20261022000005_confirmed_pickup_access.sql` adds
`get_booking_pickup(booking_id)`: active-session Owner/Renter participants can read
an exact address only while their booking is confirmed, active, or return-pending.
Pending payment, declined, cancelled, completed, unrelated and revoked sessions
cannot retrieve it. Direct location-table reads remain owner-only. Booking cards,
the confirmation page, and check-in reuse the same authorized pickup panel.
The pickup migration and frontend were deployed only to e2e on 2026-10-22
(`dpl_743Te6CFAFyFiWCjEFPWw9hYXuje`). All 17 pickup authorization SQL cases and
101 existing listing-policy cases passed, as did schema lint, typecheck, focused
ESLint (one existing Fast Refresh warning), and production build.
AI skeleton/edit/cancellation tests and all three responsive listing journeys
passed. Google request/initialization-error and email/password browser tests
passed; subsequent broader browser runs encountered navigation/startup timeouts,
so the complete browser suite is not claimed green. Hosted Google remains
disabled pending operator configuration; a real Google OAuth round trip has
not been verified. No production database or application was changed.

Continue validates the current step, saves that step's fields to the database,
and advances only after the save succeeds. Typing and leaving do not trigger
timed or implicit form saves. Explicit Save draft and Retry save use the same
step validation. Photo uploads and gallery edits still persist immediately.
Local storage holds only an owner-scoped resume
ID. Photo changes refresh the optimistic revision. Listing and offer preferences
save atomically; publication remains explicit. Pending review does not show live
listing actions or confetti, and cannot receive rental offers.

The inline Rental settings offer editor uses the configured asymmetric bounds
and preserves existing narrower rental windows and valid targets on resume.
There is no required offer step or popup. Renter offer and booking
date controls also respect the saved listing window.
Confirmed publication ends with a centered achievement hero, the actual cover
photo/title, and View listing, Manage listing and Share listing actions. A
64-piece decorative burst plays once per listing/account in the browser session
and is removed after 2.8 seconds. A compact confirmation check replaces the trophy;
List another item sits in a divided card footer, without offer-configuration notes.
Reduced motion keeps the check static;
pending review never gets a live-listing celebration. Completion resets scroll
to the top and focuses the headline so the hero is not obscured by navigation.
Customer-facing native date inputs are replaced by the shared premium date
picker, including request filters, request/offer forms, and post-publication
offers. The shared grid supports arrow/Home/End keys within a month, full date
labels, visible selection and disabled days. Single-date dialogs use existing
Radix focus trapping/return and retain required-field checks. Admin calendars
are unchanged.

UI/UX Pro Max guidance applied: functional minimalism, existing Ocean Green
tokens and typefaces, linked validation summaries, retained inline errors,
button alternatives for reordering, responsive layouts, 44px controls, and
reduced-motion support through the existing success component. No new design
system or dependencies were introduced.
