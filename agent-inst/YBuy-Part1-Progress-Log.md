# YBuy Part 1 — Progress Log

Reference doc for this build session. Update as steps complete. Authoritative spec is
[YBuy-Series-A-Part1-Agent-Instructions.md](./YBuy-Series-A-Part1-Agent-Instructions.md).

## Environment facts (verified 2026-09-22)

- **Workspace root / project root:** `D:\gigs-workspace\YBuy` (previously empty except
  `agent-inst/`; source now lives here).
- **Reference prototype (source of copied UI):** `D:\personal\rental-platform` — do not build
  there; it was only used as a copy source.
- **Package manager:** pnpm only. Always use `pnpm`/`pnpm exec`, never `npm`/`npx`, per user
  instruction.
- **CLIs** (resolve via `pnpm exec <tool> --version` in this root, not globally on PATH):
  - `pnpm` 9.15.9
  - `supabase` 2.117.0 (devDependency)
  - `vercel` 59.25.4 (devDependency)
  - `@playwright/test` 1.63.0 (devDependency)
  - `eslint` 9.39.5 (devDependency, run via `pnpm run lint`)
- **Scripts** (`package.json`): `dev`, `build`, `lint`, `preview`, `typecheck`
  (`tsc --noEmit -p tsconfig.app.json`).

## Preflight (original checklist) — outcome

| Item | Status |
|---|---|
| Session running "wrapped" (headroom/Claude/OpenCode) | N/A — running as GitHub Copilot in VS Code, no such wrapper exists here |
| VS Code extensions (Copilot, Supabase, ESLint, Prettier, Tailwind IntelliSense, Error Lens, GitLens, Playwright, Stripe, Thunder Client, EditorConfig) | Unverifiable — no tool available to list installed extensions |
| `supabase --version` | ✅ via `pnpm exec supabase --version` → 2.117.0 |
| `vercel --version` | ✅ via `pnpm exec vercel --version` → 59.25.4 |
| `stripe --version` | ❌ not installed anywhere yet — needed before Step 6 (Stripe work) |
| `npx playwright --version` / `pnpm exec playwright --version` | ✅ → 1.63.0 |
| MCP servers (21st.dev Magic, Playwright MCP, Context7) | Unverifiable — not present in current tool set |
| Skills (Vercel Web Interface Guidelines, frontend-design) | Unverifiable — not present in current skills list |

**Open gap:** User confirms Stripe CLI 1.51.1 is installed and resolves in their own fresh
`cmd`/system terminal, but it does not resolve in this agent's terminal tool (tried `pwsh`, a
fresh `powershell -NoProfile` process, and `cmd /c`) — likely a stale PATH inherited by the VS
Code/tool process from before install. Not a blocker yet (not needed until build-order §7 step 6);
re-verify from this tool at that point, or after a VS Code restart.

## Step 1 — Orient (summary)

Prototype at copy time was 100% mock-data UI, no backend:
- Pages: home, search, listing, checkout, create-listing, dashboards (renter/owner), requests,
  messaging, trust-profile, claims, check-in-out, passport, protection, bidding/auction.
- Data: static `src/data.ts` (listings, users, bookings, categories, conversations, claims).
- Routing: in-memory state router (`src/router.tsx`), not URL-based.
- No auth, no Supabase calls in UI (despite `@supabase/supabase-js` being a dependency), no
  Stripe, no persistence.

**Resolved (2026-09-22):** Bidding/Auction + Passport/Protection/Claims pages are gated behind
`VITE_SHOW_OUT_OF_SCOPE_PAGES` (default unset/hidden) — see `src/lib/feature-flags.ts` and
`src/pages/out-of-scope.tsx`. This is a single env var, not a feature-flag system, so it doesn't
violate §4's "no feature flags" rule. Code stays in the repo but is inert by default.

## Actions taken so far

1. Copied from `D:\personal\rental-platform` into this root: `src/`, `index.html`,
   `vite.config.ts`, `tsconfig*.json`, `tailwind.config.js`, `postcss.config.js`,
   `eslint.config.js`.
2. Merged `package.json`: kept existing `supabase`/`vercel`/`@playwright/test` devDependencies
   already added here, added the rest of the prototype's dependencies/devDependencies/scripts.
   Not copied: `scripts/` (screenshot tooling), `deliverables/`, `graphify-out/`,
   `p2p-rental-presentation.html`, `req.md`, `.bolt/` — judged unnecessary for Part 1 build.
3. Added `.gitignore` (matches prototype's).
4. Ran `pnpm install` — clean, no errors.
5. **Build-order §7 Step 0 (hygiene pass):** fixed 36 ESLint errors (all unused
   imports/variables, no behavior changes) across `nav.tsx`, `search.tsx` (component + page),
   `bidding.tsx`, `checkout.tsx`, `claims.tsx`, `create-listing.tsx`, `dashboards.tsx`, `home.tsx`,
   `listing.tsx`, `messaging.tsx`, `requests.tsx`, `trust-profile.tsx`, `router.tsx`.

### Verified command output (last run)

```
pnpm run lint       → 0 errors, 2 warnings (react-refresh/only-export-components in
                       router.tsx + theme-context.tsx — pre-existing pattern, not errors) EXIT:0
pnpm run typecheck  → EXIT:0
pnpm run build      → built in 1m 14s, EXIT:0 (advisory only: main chunk >500kB, optional
                       code-splitting, not a DoD blocker)
```

## Next steps (per user's original multi-step instructions)

- **Step 2 — DONE, stop point cleared (2026-09-22):** Real Google OAuth wired end-to-end.
  Verified via live REST query against `profiles` table (anon key): a real row was created by
  the `handle_new_user()` trigger for the user's actual Google account
  (`satishsoft007@gmail.com`), proving sign-in, trigger, and `profiles_select_any` RLS policy all
  work together. Files added: `src/lib/supabase.ts`, `src/auth-context.tsx`,
  `src/components/require-auth.tsx`; `App.tsx` gates user-specific routes; `nav.tsx` +
  `trust-profile.tsx` wired to real auth state/sign-out.
- **Step 3 — DONE (2026-09-22):** `data.ts` mock categories/listings replaced with real Supabase
  queries on `home.tsx`, `search.tsx`, `listing.tsx`; `create-listing.tsx` wired to real
  draft→published lifecycle (real `listings`/`listing_images` inserts, real Supabase Storage
  uploads via new `listing-images` bucket + RLS, category picker uses real category ids,
  publish requires title/category/location). New files: `src/lib/listings.ts` (queries +
  `toUiListing`/`toUiCategory` adapters that fill non-DB-backed decorative fields — rating,
  reviews, verification, §4 passport/protection fields — with honest zero/empty defaults, not
  fake data), `src/pages/out-of-scope.tsx`, `src/lib/feature-flags.ts`. New migration
  `20260922000002_listing_images_storage.sql` (public-read bucket, owner-scoped write/delete via
  path-prefix RLS). Fixed `seed.sql` category icon values to match `lucide-react` PascalCase
  export names (were lowercase-hyphenated, silently falling back to a generic icon for every
  category). §4 out-of-scope pages (Bidding/Auction/Claims/Item-Passport/Protection) and the
  in-listing-page Item-Passport/Condition/Trust-checklist sections are hidden by default via
  `VITE_SHOW_OUT_OF_SCOPE_PAGES` (not removed, per AGENTS.md UI-preservation rule); the 10-theme
  demo switcher is separately hidden by default via `VITE_SHOW_DEMO_THEMES` (Coral remains
  default theme either way).
  **Verified:** lint/typecheck/build all pass. Full draft→images→details→publish→read-back
  sequence verified against the real cloud DB via REST (service-role for the write simulation,
  anon key read-back to confirm RLS lets published listings through publicly) — confirmed live in
  the running dev server (listing rendered on home page with real title/price/image, category
  count incremented live), then test data was deleted. **Not yet verified live through the actual
  browser UI with a real interactive Google-signed-in session** (user deferred that manual check)
  — recommend doing one real create-listing walkthrough (sign in → add a real/sample photo →
  pick category → publish) before moving on, to catch anything the server-side simulation
  couldn't (file input UX, button disabled-states, navigation after publish).
- **UI/branding pass (2026-09-22, between steps 3 and 4):** real logo (`src/assets/logo.png` +
  `public/logo.png` favicon) replacing the "R" text badge in `nav.tsx`/`home.tsx`/`index.html`;
  brand renamed "Rental Platform"/"Rently" → "YBuy"; footer copyright year now
  `new Date().getFullYear()` instead of hardcoded; new `src/components/hero-carousel.tsx`
  (auto-rotating background photo carousel on the home hero, no prev/next controls, neutral
  black overlay — kept theme-neutral per user request); site `defaultTheme` switched from
  `coral` to `ocean` in `src/themes.ts`, and the `ocean` theme's accent recolored from teal
  (#0E7C86) to ocean-green (#0E7C66), renamed "Ocean Green" in the switcher. New standalone
  `theme-palettes.html` at repo root (open directly in a browser, not part of the app) renders
  swatches for all 10 theme packs — reference/demo only.
- **Step 4 — DONE (2026-09-22):** real server-side search. `src/lib/listings.ts` gained
  `searchListings()` (keyword `ilike` on title/description with comma/paren/percent sanitization
  against PostgREST filter injection, category filter, max-price filter, sort by
  price-low/price-high/newest, `count: 'exact'` + `.range()` pagination — `SEARCH_PAGE_SIZE = 24`)
  and `fetchCategoryCounts()` (separate lightweight query so counts don't require loading every
  listing row). `search.tsx` rewired: keyword comes from the real `SearchBar` submit, category/
  price/sort changes re-query the server and reset to page 0, a "Load more" button fetches
  subsequent pages instead of loading the whole table. Distance/rating/verified-owner/instant-
  booking/protection/delivery filters remain client-side no-ops over the loaded page (marked with
  a `ponytail:` comment) — not backed by any real column yet (no geolocation, reviews, or
  verification data exists in Part 1's schema), unchanged from Step 3's honest-empty-defaults
  convention. Verified: lint/typecheck/build pass; live-clicked through the running dev server
  (empty DB currently → "0 of 0 items", sort dropdown shows real options, keyword submit fires
  the query with no errors).
- **Stop points remaining:** end of booking-state-machine step, end of Stripe+webhook step.
- **Non-negotiables to keep enforcing:** no fake payment success, no fake auth, no stubbed state
  machine, no client-trusted prices/availability, RLS before any table holds real data, nothing
  from §4 gets built.
- **Step 5 — DONE (2026-09-22):** booking state machine implemented as Postgres
  `SECURITY DEFINER` RPC functions (`supabase/migrations/20260922000003_booking_state_machine.sql`),
  not an Edge Function — leaner and consistent with using RLS as the authorization layer. Dropped
  the old `bookings_update_participant` RLS policy so every booking mutation must go through an
  RPC: `create_booking_request` (renter-initiated, row-locks the listing, checks overlap against
  active bookings + `listing_availability`, computes pricing server-side), `respond_to_booking_request`
  (owner only, accept/decline), `cancel_booking` (either party, only from
  requested/pending_payment/confirmed), `mark_booking_active` / `start_booking_return` /
  `complete_booking_return` (either party — relaxed since Part 1 has no two-sided confirm UX).
  States: `requested → pending_payment → confirmed → active → return_pending → completed`,
  terminal `cancelled`/`rejected`. Pricing: `subtotal = daily_rate × days × qty`,
  `service_fee = round(subtotal × 0.10, 2)` (fixed 10% constant, intentionally not a settings
  table), `total = subtotal + fee + deposit` — same formula duplicated client-side for preview
  only, the RPC is authoritative. `src/lib/bookings.ts` is the data-access layer (mirrors
  `listings.ts`): fetch helpers + RPC wrappers + a flattened `UiBooking` type. Wired into
  `listing.tsx` (real date inputs), `checkout.tsx` (request + confirmation pages, confirmation
  route id is now a booking id, not a listing id), `dashboards.tsx` (real renter/owner dashboards
  with accept/decline/cancel/start-return actions), `check-in-out.tsx`. Verified via
  lint/typecheck/build (clean).
- **Step 6 — DONE + LIVE-VERIFIED (2026-09-22):** Stripe Checkout + webhook.
  `supabase/migrations/20260922000004_stripe_payments.sql` adds `confirm_booking_payment()`
  (service-role-only grant — only the webhook Edge Function can call it; requires
  `status='pending_payment'`, flips to `confirmed`, inserts a `payments` row). Two Edge Functions:
  `create-checkout-session` (validates renter id + status server-side, prices the Stripe Checkout
  Session from the booking's server-computed `total`, stores `booking_id` in session metadata) and
  `stripe-webhook` (verifies the Stripe signature, only acts on `checkout.session.completed`,
  calls `confirm_booking_payment` via a service-role client). `config.toml` sets
  `verify_jwt = false` for the webhook function (Stripe signs requests itself). `src/lib/payments.ts`
  → `createCheckoutSession(bookingId)` wired to a "Pay now" button on `pending_payment` bookings in
  the renter dashboard. **Live end-to-end test passed:** created a real booking via the actual UI,
  flipped it to `pending_payment` via service-role (simulating owner approval — no second real
  Google account available), clicked Pay Now, completed a real Stripe test-mode Checkout with card
  4242 4242 4242 4242, webhook fired, booking flipped to `confirmed`, `payments` row inserted with
  real Stripe ids. All test data cleaned up afterward.
- **Step 8 — DONE (2026-09-22), not yet live-clicked through the UI:** messaging + Realtime.
  `src/lib/messages.ts` (fetchConversations/fetchMessages/sendMessage/getOrCreateConversation/
  subscribeToMessages via `supabase.channel` + `postgres_changes`). New migration
  `20260922000005_messages_realtime.sql` adds `messages` to the `supabase_realtime` publication
  (was missing, required for the channel subscription to receive events). Rewired 3 entry points
  to open a real conversation instead of a hardcoded route: `listing.tsx` "Owner" card,
  `checkout.tsx` confirmation "Message owner" button, and "Message" buttons on both dashboards.
  Deliberately did not implement read receipts/unread badges (no `UPDATE` RLS policy on
  `messages`, not in the mandatory requirements) — removed from the UI rather than faked.
  Verified via lint/typecheck/build + a service-role structural smoke test; a real click-through
  test of Realtime delivery in the browser is still recommended.
- **Out-of-scope gating audit — DONE (2026-09-23):** found + fixed 6 places where
  Protection/Claims/Bidding elements rendered even with `VITE_SHOW_OUT_OF_SCOPE_PAGES=false`:
  `ProtectionBadge` in `listing.tsx` + both `ListingCard`/`ListingCardWide` variants, the "Rental
  protection" toggle in `search.tsx` filters, the "Protection eligible" line in
  `create-listing.tsx`'s AI-demo suggestions, the "claims" tab in the renter dashboard, and
  `BottomNav` showing "Bidding" unconditionally in `nav.tsx` (desktop nav already gated it
  correctly) — swaps in a "Favorites" entry when Bidding is hidden so the tab count stays
  constant.
- **Email notifications — SKIPPED by user request (2026-09-23):** spec §1 calls for "the one or
  two transactional emails needed" via Resend. Asked the user for a `RESEND_API_KEY`; user chose
  to skip and continue with Step 9. Not implemented. If revisited: email the owner on new booking
  request, email both parties when payment confirms (call Resend's REST API directly from Edge
  Functions, no SDK/abstraction layer).
- **Step 9 — DONE + LIVE-VERIFIED (2026-09-23):** reviews + favorites (spec §3.14-15). The
  `reviews`/`favorites` tables + RLS already existed in the initial migration — no new migration
  needed. New `src/lib/reviews.ts` (fetchReviewsForUser, fetchReviewedBookingIds, createReview) and
  `src/lib/favorites.ts` (fetchFavoriteListingIds, fetchFavoriteListings, addFavorite/
  removeFavorite; had to export `LISTING_SELECT` from `listings.ts` for reuse). Wired into
  `listing.tsx` (real Heart button + reviews section), `listing-card.tsx` (controlled
  `favorited`/`onToggleFavorite` props, falls back to local state when omitted), new
  `src/pages/favorites.tsx` page + nav entries, and a shared `ReviewModal` in `dashboards.tsx`
  (star picker + optional comment) wired to "Leave a review" buttons on completed bookings in both
  dashboards. Verified via lint/typecheck/build AND a full live service-role smoke test (2
  synthetic users, listing, completed booking, favorite, review — confirmed the 3 embedded-select
  query shapes match real REST output byte-for-byte, then fully cleaned up).
- **Step 10 — DONE (2026-09-23):** loading/empty/error state pass. Fixed a real bug in
  `messaging.tsx` — a failed conversation fetch had no `.catch()` at all, leaving the page stuck
  on "Loading…" forever with no error shown; added proper error state. Fixed `dashboards.tsx`
  (both renter and owner) and `favorites.tsx` silently converting any fetch failure into an empty
  list (indistinguishable from "you genuinely have no bookings/favorites") — added a distinct
  load-error banner in each. Also revisited the hero/search bar as a follow-up UI request: the
  hero `SearchBar`'s typed keyword was being silently discarded on "Search" click (now navigates
  to `/search?q=...` and pre-fills the results page); "Near me" now uses the real browser
  Geolocation API + haversine distance against each listing's stored `location_lat`/`location_lng`
  (previously `distance` was hardcoded to 0, so the distance filter and "Nearest first" sort were
  both silently inert); the static "Aug 28 → Aug 29" date text was replaced with real
  `<input type="date">` range inputs. Fixed an RWD regression this introduced (date inputs
  overflowed the bar at the `md` (768px) breakpoint) by moving that section to `lg` (1024px).
  Verified via lint/typecheck/build + manual viewport checks at 375/820/1280px.
- **DEMO_MODE seed feature (2026-09-23):** added `scripts/seed-demo.mjs`, which runs
  automatically before Vite starts (`pnpm run dev` → `node --env-file=.env.local
  scripts/seed-demo.mjs && vite`) and no-ops instantly unless `DEMO_MODE=true` is set in
  `.env.local`. Using a service-role client it idempotently: creates 3 synthetic demo-owner
  accounts + 1 demo-renter account; seeds a 12-item published catalog spanning all 8 real
  categories (content reused from the old prototype's mock listings in `src/data.ts`, including
  their already-verified Pexels image URLs); and, for every real signed-in profile, adds a
  favorite, a completed booking with mutual review + message thread, a paid/confirmed upcoming
  booking, a pending booking request, and a brand-new listing owned by that real user (with its
  own pending request + completed/reviewed booking from the demo renter) so both the renter and
  owner dashboards look populated. Verified idempotent (ran twice, second run no-op'd) and
  verified row counts directly against the DB; lint/typecheck clean.
- **Availability calendar + payouts UI + search bar overhaul (2026-09-23):** closed the 2 real
  gaps found during the completeness audit, plus fixed several search-bar bugs reported by the
  user. Availability: `src/lib/availability.ts` + `src/components/availability-calendar.tsx`
  (reusable month-grid), wired read-only into `listing.tsx` (disables booking when the picked
  range overlaps a booked/blocked date) and editable into `dashboards.tsx`'s OwnerDashboard (a
  "Manage availability" modal per listing, toggling `listing_availability` rows directly — no
  new RPC needed, existing RLS already allowed owner writes). Payouts: `payouts` table had only
  a select RLS policy, so added migration `20260923000001_payouts_owner_write.sql` (owner-scoped
  insert/update, validated against the booking's real owner + status) and `src/lib/payouts.ts`;
  wired a "Mark paid out" action into the OwnerDashboard's upcoming/completed booking rows.
  Along the way, fixed a real bug: OwnerDashboard's "Your items" section was still 100% mock
  data from `data.ts`, never wired to the signed-in owner — now uses
  `fetchListingsByOwner`. Search bar: `onSearch` now passes a structured `{keyword, coords,
  locationLabel, startDate, endDate}` object instead of silently dropping location/dates (root
  cause of "Near me not working" — both call sites only ever used the keyword); added a real
  Dallas-area city-coordinate lookup (`src/lib/geo.ts`), a rotating example-item placeholder, an
  accessible label on the keyword input, `min=today`/max-span date constraints (configurable via
  `VITE_MAX_BOOKING_RANGE_DAYS`, default 30), and real date-range availability filtering on the
  search results page. Verified via lint/typecheck/build (clean) and `supabase db push` (migration
  applied); not yet visually confirmed in a live signed-in browser session.
- **Not started:** Step 11 (Vercel deploy + `APP_ORIGIN` secret update + full 2-account
  renter/owner smoke test per the spec's Definition of Done).

