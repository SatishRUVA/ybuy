# YBuy — Part 2: Prod-Ready + Admin Console — Agent Instruction

## 0. ROLE
You are the lead engineer hardening YBuy from the Part 1 (Series A) build into a real production
release: full payments automation, verification, dispute handling, an admin console, and the
operational scaffolding (observability, security, tests, CI/CD) needed to run this for real users
at scale. This is additive to Part 1 — do not rewrite working Part 1 code unless a section below
requires changing its behavior. Prerequisite: Part 1's definition of done is already met and stable.

## 1. STACK ADDITIONS
**Matches the Part 1 stack: Vite + React + Supabase (not Next.js). All "server-side" logic below
runs as a Supabase Edge Function (Deno) or a Postgres RLS policy — there is no Next.js API route
layer in this project.**
- Stripe Connect (Express accounts) for automated owner payouts — onboarding + transfer logic in
  an Edge Function using the Stripe secret key, never exposed to the client
- Stripe Identity for verification — session creation + webhook handling in an Edge Function
- Feature flag store: a simple `feature_flags` table (RLS: readable by all, writable only by
  `is_admin`) + admin UI (do not reach for LaunchDarkly/paid tooling at this stage)
- Sentry (or equivalent) for error tracking — works the same in a Vite SPA as anywhere else
- Playwright for E2E
- GitHub Actions (or equivalent) for CI/CD
- Supabase CLI for schema migrations (replaces any assumption of a Drizzle/Prisma migration tool)
- Keep everything else from the Part 1 stack — no framework swaps

## 2. IN SCOPE

### 2.1 Admin Console (new)
Build a separate, role-gated `/admin` area in the existing Vite app (require an `is_admin` flag on
`profiles`, enforced two ways — never client-only gating):
- RLS policies on every admin-touched table require `is_admin = true` for the relevant operation
- Any privileged action that can't be a plain RLS-guarded query (e.g. triggering a refund, calling
  Stripe) goes through a Supabase Edge Function that independently re-checks `is_admin` from the
  caller's JWT before doing anything — the client route being hidden behind `/admin` in the UI is
  not, by itself, authorization.

Admin can manage:
- Users (view, deactivate, view verification status)
- Listings (view, unpublish, edit category)
- Categories (create/edit/reorder/activate-deactivate — this replaces the Part 1 DB-seed-only
  approach)
- Bookings (view, force-cancel with reason, view full state history)
- Payments/Payouts (view, trigger manual refund, view Stripe object references)
- Disputes/Damage reports (view, add resolution notes, close)
- Reports/blocks (view reported users/listings, action them)
- Verification queue (view pending Stripe Identity results)
- Platform configuration (fee percentages, category list, feature flags) — this is what makes fees
  and categories configurable instead of env constants

### 2.2 Payments — full automation
- Migrate from manual payout tracking to Stripe Connect Express: owner onboarding flow, connected
  account status, automated transfers on rental completion (or per your payout schedule).
- All Stripe secret-key calls (onboarding link creation, transfers) live in Supabase Edge
  Functions — the client only ever gets a redirect URL or a status back, never the secret key.
- Handle payment failures, refunds, and disputes via webhook-driven state updates only, processed
  by an Edge Function that verifies the Stripe webhook signature before touching the database.
- Payout dashboard for owners: pending/available earnings, payout history, per-booking net amount
  after platform fee.

### 2.3 Identity verification
- Stripe Identity integration: not-started/pending/verified/failed states on `profiles`. Session
  creation and the result webhook are both handled in Edge Functions, same pattern as 2.2.
- Gate certain actions (e.g., listing high-value items, or renting them) on verified status if you
  want that policy — otherwise verification is informational only for v1 of this phase.
- Store only verification status + Stripe reference ID. Never log or persist raw identity documents.

### 2.4 Damage / protection / dispute workflow
- Add `protection_status`, `coverage_amount`, `damage_report`, `claim_status` to Booking (or a
  linked table).
- Flow: report → upload photos → description → booking enters `Disputed` state → both parties can
  message inside the existing conversation → admin resolves via the admin console → resolution
  recorded.
- UI copy must clearly distinguish security deposit vs. platform protection vs. actual insurance —
  do not imply YBuy provides insurance unless a real insurance provider is integrated.

### 2.5 Feature flags & configuration
- `feature_flags` table (key, enabled, description) + admin toggle UI.
- Fee percentages and category list move from env constants (Part 1) to the `PricingConfiguration`
  table, admin-editable. Existing bookings keep their stored pricing breakdown — never recompute
  historical bookings when config changes.

### 2.6 Notifications
- Replace the direct Resend calls from Part 1 with a proper `NotificationService` abstraction —
  an Edge Function that both writes an in-app `notifications` row and calls Resend, so the client
  never talks to Resend directly. Covers every event in the original spec §24. Push/SMS-ready
  later by adding providers inside this one function, not scattered across the app.

### 2.7 Security hardening
- Rate limiting on auth, booking creation, and messaging — apply at the Edge Function layer
  (Supabase supports this natively) and/or Vercel edge config for the front end; there's no
  Next.js middleware layer here to hang it on.
- CSRF is a lower risk on token-based Supabase auth than on cookie-session auth, but still audit
  the Edge Functions for expecting the right auth header and rejecting anonymous calls where
  appropriate; review secure headers on the Vercel-hosted static build regardless.
- File upload MIME + size validation on Storage bucket policies, SSRF protection on any
  URL-fetching Edge Function.
- Webhook signature validation audit (Stripe, and any other provider added) in every Edge Function
  that receives one.
- RLS sweep: re-verify every table's policies actually match Part 1's authorization intent, not
  just that a policy exists — a permissive policy is as bad as no policy.

### 2.8 Observability & auditability
- Structured logging (timestamp, request ID, user ID when safe, endpoint, error category) inside
  every Edge Function — never log payment/identity secrets.
- Error tracking (Sentry) wired into the Vite client and every Edge Function.
- Metrics: listings created, requests, successful bookings, cancellations, payment failures, GMV,
  platform fees, payouts, active users.
- Audit log table for: listing published/edited, booking requested/approved/rejected/cancelled,
  payment completed, refund issued, review created, damage report created, user blocked/deactivated.

### 2.9 SEO
**Flag before starting this section:** the app is a client-rendered Vite SPA, so search engines see
an empty shell on first load unless one of these is added:
- Prerendering (e.g. `vite-plugin-ssr`/Vike, or a prerender service) for public listing/category
  pages only — the pragmatic middle ground, keeps the rest of the app as-is
- A partial migration to a framework with SSR (Next.js, Astro) for just the public marketing/listing
  routes, proxied alongside the existing SPA — more work, better long-term SEO ceiling
Pick one explicitly before implementing dynamic titles/OpenGraph/structured data — none of that
metadata helps a crawler if the page never executes JavaScript to produce it. Default to
prerendering the public routes unless SEO is a top business priority by this phase.

### 2.10 Testing & CI/CD
- Unit tests: pricing, availability, state transitions, authorization, fee calc, cancellation,
  review eligibility.
- Integration tests: auth, listing creation, booking, payment, messaging, reviews.
- E2E (Playwright, mobile + desktop viewports): the full renter and owner flows from the original
  spec §34, including the new admin resolution path for a disputed booking.
- CI pipeline: lint, typecheck, unit + integration tests, build, on every PR; E2E on main before
  deploy. Staging environment before production promotion.

## 3. OUT OF SCOPE (still — even for Part 2)
Per the original spec §42, do not implement: Apple/email/SMS login, push notifications, multi-item
checkout, coupons/referrals, subscriptions, delivery/shipping, AI features, dynamic pricing,
advanced analytics dashboards, vendor/corporate accounts, calendar integrations. These stay
architecturally possible but out of scope until explicitly requested.

## 4. BUILD ORDER
1. Admin console shell (auth-gated, empty sections)
2. Category + platform configuration management (moves off env constants)
3. Stripe Connect onboarding + automated payouts (replace Part 1 manual payout tracking)
4. Stripe Identity verification
5. Damage/dispute workflow + admin resolution tooling
6. Feature flags
7. Notification service abstraction
8. Security hardening pass (full checklist in §2.7)
9. Observability (logging, Sentry, metrics, audit log)
10. SEO pass
11. Full test suite + CI/CD pipeline
12. Staging soak test, then production deploy

## 5. DEFINITION OF DONE (Part 2)
Everything in Part 1's definition of done still works, PLUS: an owner can complete Stripe Connect
onboarding and receive an automated payout without manual intervention; a renter can go through
Stripe Identity verification; a damage report can be filed, disputed, and resolved entirely through
the app including the admin console; an admin can change the platform fee and see it apply only to
new bookings; CI is green on lint/typecheck/unit/integration on every PR, and E2E passes on staging
before any production deploy.

## 6. AGENT BEHAVIOR
- Do not touch Part 1's core booking/pricing/auth logic unless a section above explicitly requires
  a behavior change (e.g., payout automation replacing manual tracking).
- Every new admin action must be authorized against `is_admin` via RLS and/or an Edge Function
  re-check — no UI-only gating, and no assuming the `/admin` route path itself is protection.
- Do not fake verification results or dispute resolutions — if a Stripe Identity/Connect test
  credential is unavailable, say so rather than stubbing a fake "verified" state.
- Run lint, typecheck, unit tests, and relevant E2E at the end of each numbered step in §4.
