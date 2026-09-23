# YBuy — Series A Part 1 (Lean Shippable) — Agent Instruction

## 0. ROLE
You are the lead engineer building YBuy Part 1: the smallest version of a peer-to-peer rental
marketplace that proves the core loop end to end for a small real user group (up to ~10 users,
deployed free on Vercel + a free-tier Postgres host). No admin UI. No feature flags. No config
system beyond environment variables. Ship working code, not scaffolding.

## 1. STACK (fixed — do not substitute without asking)
**Revised 2026-09-22: building on top of the existing Bolt.ai-generated Vite/React prototype
instead of a Next.js rewrite. Do not migrate the app to Next.js for Part 1.**
- Vite + React + TypeScript (existing prototype — keep its routing, components, and design system;
  replace only the mock-data layer, not the UI)
- Supabase: Postgres (managed), Auth (Google provider ONLY), Storage (images), Realtime
  (messaging/booking-status updates)
- Row Level Security (RLS) policies are the server-side authorization layer for this stack —
  every table needs RLS enabled before it holds real data. This replaces "API route checks
  ownership" from the original plan; it does the same job at the DB layer.
- Stripe Checkout (Payment Intents) — no Connect, no payouts automation. Webhook handling via a
  Supabase Edge Function (Deno), verified against the Stripe webhook secret.
- Tailwind + shadcn/ui (already in the prototype)
- Resend for the one or two transactional emails needed, called from a Supabase Edge Function
- Deploy target: Vercel (hobby/free tier) for the static/SPA build, pointed at the Supabase project
- Known trade-off accepted for Part 1: this is client-rendered, so public listing pages are not
  server-rendered. SEO/structured data work (§2.9 of the Part 2 doc) is deferred, not lost — a
  later move to Next.js or Vite SSR is still possible without touching the Supabase layer.

## 2. CORE PRINCIPLE
"Find something nearby → choose dates → book → pay → communicate → use → return."
"List something you own → set availability → approve rentals → get paid (manually, for now)."
Every feature below exists to serve these two flows. If a feature doesn't serve one of them, cut it.

## 3. IN SCOPE
1. **Auth** — Google Sign-In only. Auto-create profile on first login (name, email, photo, phone
   optional, location, created date). Protect all user-specific routes server-side.
2. **Single role model** — every user can rent AND own. No account-type split anywhere in the schema.
3. **Home** — search bar, location, popular categories, nearby/recent listings, two CTAs.
4. **Categories** — seed a fixed list in the DB (not hardcoded in UI components), each with
   name/icon/active/sort order. No category management UI — edit via DB/seed script.
5. **Search** — keyword, category, location radius, date range, price range, sort
   (recommended/distance/price/rating/newest). Server-side pagination — never load all listings.
6. **Listing detail** — photos, price/day (+optional weekly), description, approximate location
   only (exact address hidden until booking confirmed), availability calendar, owner rating, reviews.
7. **Create/edit listing** — single-page form (not a 9-step wizard): basics + category, photos
   (min 1, drag reorder, compressed on upload), pricing, location, availability. Allow drafts.
8. **Availability** — per-listing calendar. Server validates availability immediately before booking
   creation, inside a DB transaction, to prevent double-booking race conditions. Never trust client.
9. **Booking state machine** (implement exactly, no shortcuts):
   `Requested → Pending Payment → Confirmed → Active → Return Pending → Completed`
   plus `Cancelled` / `Rejected` as terminal branches. Reject any invalid transition server-side.
10. **Pricing engine** — `subtotal = daily_rate × days × quantity`, then service fee (env-configured
    percentage constant, not hardcoded inline) + optional deposit = total. Store the full breakdown
    on the booking row at creation time — never recompute historical bookings from current config.
11. **Payments** — Stripe Checkout. Payment status is driven ONLY by verified Stripe webhook events,
    never by a frontend "success" callback. No Connect/automated payouts — owner payout is manual
    for Part 1 (mark a booking "paid out" by hand); still record it as a Payout row for later.
12. **Messaging** — conversation list + thread, tied to a booking/listing. Send, read/unread,
    timestamp. No attachments, no block/report workflow yet (a simple mailto-style report link is fine).
13. **Booking management** — renter (upcoming/active/completed/cancelled) and owner
    (requests/upcoming/active/completed/cancelled) list views with the relevant actions from the
    master spec (approve/reject/cancel/message/mark return/review).
14. **Reviews** — 1–5 stars + optional text, only after `Completed`, one per party per booking.
15. **Favorites** — add/remove, favorites page, persisted.
16. **Responsive UI** — mobile-first, test at 375/768/1024/1440. Every screen has loading/empty/
    error states — never a blank screen.

## 4. EXPLICITLY OUT OF SCOPE FOR PART 1
Do not build these now — they belong to Part 2:
- Admin dashboard of any kind
- Stripe Connect / automated owner payouts
- Stripe Identity verification
- Damage/protection/dispute workflow
- Feature flags or any config system beyond env vars
- Notification-provider abstraction layer (just call Resend directly for the 1–2 emails you need)
- SEO structured data / OpenGraph
- Observability/metrics/error-tracking infrastructure
- Audit log table
- Report/block moderation workflow (beyond a simple report link)
- Rate limiting infrastructure (keep basic Vercel/Next defaults; don't build a custom limiter)

If a requirement is ambiguous, pick the simplest version that still satisfies the flow in §2 — do
not gold-plate.

## 5. SECURITY BASELINE (non-negotiable even in a lean build)
- Every API route re-checks that the authenticated user owns/may access the resource. Never trust
  a listing/booking/user ID from the client as proof of authorization.
- Never trust client-submitted prices or availability — always recompute/revalidate server-side.
- No card data touches your server — Stripe-hosted Checkout only.
- Secrets in environment variables only, never committed.
- Basic input validation (Zod or similar) on every mutation.

## 6. DATABASE (core tables only)
User (mirrors Supabase `auth.users` via a `profiles` table keyed on `auth.uid()`), Category,
Listing, ListingImage, ListingAvailability, Favorite, Booking, Payment, Payout (manual-entry for
now), Conversation, Message, Review. Foreign keys everywhere. Indexes on: listing location,
category, owner_id, renter_id, booking dates, conversation_id.

RLS policy baseline (write these before any table holds real rows):
- `profiles`: user can read any profile, update only their own row
- `listings`: anyone can read published listings; only the owner (`owner_id = auth.uid()`) can
  insert/update/delete their own
- `bookings`: only the renter or the listing's owner on that booking can read/update it
- `messages`: only participants of the conversation can read/insert
- `payments`/`payouts`: readable only by the user they belong to; writes happen only from the
  Stripe webhook Edge Function using the service role key, never from the client

## 7. BUILD ORDER
0. Hygiene pass on the existing prototype: fix all ESLint errors before adding any backend code.
   Do not build real data flows on top of a codebase that doesn't lint clean.
1. Create Supabase project, define schema + RLS policies (§6), enable Google OAuth provider
2. Wire real auth into the existing UI (replace any mock login), auto-create `profiles` row on
   first sign-in, protect the existing authenticated routes for real
3. Replace `data.ts` mock categories/listings with real Supabase queries; wire up existing
   create-listing UI to real inserts + Supabase Storage for photos
4. Search + listing detail page against real data (server-side filtering via Supabase queries,
   not client-side array filtering)
5. Availability calendar + booking request flow — implement the real state machine (§3.9) against
   the `bookings` table; use a Postgres transaction/row lock to prevent double-booking
6. Stripe Checkout + Supabase Edge Function webhook handler driving payment status
7. Wire existing messaging UI to real Supabase tables (+ Realtime subscriptions for live updates)
8. Wire existing booking management/dashboard UI to real data for both roles
9. Reviews + favorites against real data, with the completed-booking + one-per-party constraints
10. Re-pass every screen for loading/empty/error states now that data is real and can fail
11. Deploy to Vercel, smoke-test full renter + owner flow with 2 real Google accounts

## 8. DEFINITION OF DONE (Part 1)
A real second person, using their own Google account, can: find your test listing, pick dates, pay
via Stripe test mode, get confirmed, message you, and after you mark it returned, leave a review —
and you can do the mirror flow as the owner (approve the request, see it as "paid," mark it
returned, review the renter). If either path breaks, Part 1 is not done, regardless of what else
is built.

## 9. AGENT BEHAVIOR
- Inspect existing code before changing it; reuse what's there.
- Keep the app runnable after every change; fix errors before moving on.
- Do not fake payment success, fake booking confirmation, or stub out the state machine "for now."
- Do not add anything from §4 even if it seems easy — it dilutes focus from shipping the loop.
- Run lint + typecheck + `next build` at the end of each numbered step in §7.
