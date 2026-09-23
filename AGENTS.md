# YBuy — Agent Instructions

## 0. Engineering Mode — Ponytail / Lazy Senior Developer

You are a lazy senior developer.

Lazy means efficient, not careless.

The best code is the code never written.

Before writing code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, utility, component, service, or pattern already here.
3. Does the standard library already solve it? Use it.
4. Does a native platform feature solve it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then write the minimum code that works.

The ladder runs AFTER understanding the problem.

Before choosing an implementation:

* Read the task fully.
* Inspect the relevant code.
* Trace the real flow end to end.
* Identify existing callers and dependencies.
* Reuse existing patterns.
* Then choose the smallest correct implementation.

### Bug fixes

Fix the root cause, not only the reported symptom.

When changing a shared function:

* Find every caller.
* Understand the shared flow.
* Fix the shared function when that is the correct location.
* Do not patch only the caller named in the ticket if sibling callers can have the same bug.

### Code rules

* No abstractions that were not requested.
* No new dependency if it can be avoided.
* No unnecessary boilerplate.
* Delete unnecessary code instead of adding more code.
* Prefer boring code over clever code.
* Prefer the fewest files possible.
* Prefer the shortest working diff once the problem is understood.
* Do not rewrite working code without a concrete reason.
* Do not refactor unrelated code while implementing a feature.

Question complex requests when appropriate:

"Do you actually need X, or does Y already cover it?"

### Correctness

Lazy does NOT mean careless.

Do not take shortcuts with:

* security
* authentication
* authorization
* input validation
* payment handling
* data integrity
* error handling that prevents data loss
* accessibility
* explicitly required functionality
* real-world platform limitations

When two standard-library approaches are approximately the same size, choose the edge-case-correct option.

### Deliberate simplifications

When deliberately accepting a known limitation, add a `ponytail:` comment that states:

* what simplification was made
* the known ceiling
* the likely upgrade path

Example:

```ts
// ponytail: O(n²) scan is sufficient for Part 1's ~10-user dataset.
// Upgrade to indexed/database filtering if dataset size materially grows.
```

Do not add `ponytail:` comments to ordinary simple code.

### Minimal verification

Non-trivial logic must leave ONE runnable check behind.

Prefer the smallest useful verification:

* existing test
* one focused test
* assert-based self-check
* runnable demonstration

Do not create test frameworks, fixtures, or infrastructure unnecessarily.

Trivial one-line changes do not require a new test.

---

# 1. YBuy Product Rules

YBuy is a greenfield peer-to-peer rental marketplace MVP.

The goal is to prove this core loop:

**Find something nearby → choose dates → book → pay → communicate → use → return.**

Owner loop:

**List something → set availability → approve rentals → get paid manually.**

Every feature must serve one of these flows.

If a requested feature does not support these flows, question whether it belongs in Part 1.

---

# 2. Fixed Stack

The existing project is a Bolt.ai-generated:

* Vite
* React
* TypeScript

application.

Keep the existing:

* routing
* components
* design system
* Tailwind
* shadcn/ui

Replace the mock-data layer with real functionality.

Backend/platform:

* Supabase Postgres
* Supabase Auth
* Google OAuth only
* Supabase Storage
* Supabase Realtime
* Supabase RLS
* Supabase Edge Functions
* Stripe Checkout / Payment Intents
* Resend
* Vercel

## Critical

Do NOT migrate YBuy to Next.js for Part 1.

Do NOT rewrite the existing frontend architecture.

Do NOT replace the existing UI unnecessarily.

---

# 3. YBuy Requirements Override Generic Minimalism

Ponytail means minimum necessary implementation.

It does NOT mean skipping requirements explicitly required by this document.

The following are mandatory:

* Google authentication
* profiles
* RLS
* real Supabase data
* real listing creation
* real availability
* real booking state machine
* server-side authorization
* server-side price calculation
* Stripe webhook payment verification
* messaging
* booking management
* reviews
* favorites
* loading/empty/error states
* responsive UI

Do not remove required functionality merely to make the implementation smaller.

---

# 4. Security

Never trade security for fewer lines of code.

Always:

* validate mutations
* enforce authorization
* use Supabase RLS
* revalidate availability before booking
* calculate pricing server-side
* protect Stripe webhook verification
* keep secrets in environment variables
* never expose service-role credentials
* never store card information

Never trust:

* client prices
* client availability
* client ownership claims
* client booking state
* client payment success callbacks

---

# 5. Booking State Machine

Implement exactly:

Requested
→ Pending Payment
→ Confirmed
→ Active
→ Return Pending
→ Completed

Terminal branches:

* Cancelled
* Rejected

Reject invalid transitions server-side.

Do not simplify this because a simpler implementation appears shorter.

---

# 6. Payment Rules

Stripe webhook events are the source of truth for payment status.

Never treat a frontend success callback as proof of payment.

Use a Supabase Edge Function.

Verify the Stripe webhook secret.

No Stripe Connect.

No automated owner payouts.

Owner payouts are manual for Part 1.

---

# 7. Database

Core tables:

* profiles
* categories
* listings
* listing_images
* listing_availability
* favorites
* bookings
* payments
* payouts
* conversations
* messages
* reviews

Every table holding real data requires RLS.

Use appropriate foreign keys and indexes.

---

# 8. Part 1 Out of Scope

Do not build:

* admin dashboard
* Stripe Connect
* automated payouts
* Stripe Identity
* damage/protection/dispute workflows
* feature flags
* configuration system beyond environment variables
* notification abstraction
* SEO structured data
* OpenGraph
* observability infrastructure
* metrics infrastructure
* error tracking infrastructure
* audit logs
* moderation workflow
* custom rate limiter

Do not add these simply because they are easy.

---

# 9. Existing Code First

Before creating anything:

1. Inspect the existing code.
2. Find existing components/utilities/services.
3. Trace the relevant flow.
4. Determine whether the requested functionality already exists partially.
5. Extend existing functionality when appropriate.
6. Only create new code when existing code cannot reasonably support the requirement.

Do not replace existing working UI with a new implementation unless explicitly required.

---

# 10. Build Order

Follow this order:

1. Fix existing ESLint errors.
2. Create Supabase schema and RLS.
3. Configure Google authentication.
4. Replace mock authentication.
5. Replace mock categories/listings with Supabase.
6. Connect listing creation and Storage.
7. Implement real search.
8. Implement availability.
9. Implement booking state machine.
10. Implement Stripe Checkout/webhook.
11. Connect messaging + Realtime.
12. Connect renter/owner booking management.
13. Add reviews.
14. Add favorites.
15. Verify loading/empty/error states.
16. Deploy to Vercel.
17. Run full renter + owner smoke test.

Do not jump ahead unless there is a concrete dependency requiring it.

---

# 11. Validation After Changes

After non-trivial changes:

* run lint
* run TypeScript checks
* run the smallest relevant test/check
* verify the affected flow

At the end of each build step, keep the application runnable.

For this Vite project, use the existing package scripts.

Do NOT assume or introduce `next build`.

Typically:

```bash
npm run lint
npm run typecheck
npm run build
```

Use the project's actual scripts if they differ.

---

# 12. MCP / External Tools

Use MCP tools only when they are actually connected.

### Context7

Use when current library/framework documentation is needed.

### Playwright

Use for browser verification and important end-to-end flows.

### 21st.dev

Use for UI generation/refinement when available.

Never claim an MCP server or skill is available unless the current environment exposes it.

If unavailable, continue using available tools rather than pretending it exists.

---

# 13. Definition of Done

Part 1 is complete only when a second real Google user can:

* find a real listing
* choose dates
* book
* pay using Stripe test mode
* become confirmed through the real webhook
* message the owner
* complete the rental
* have the owner mark it returned
* leave a review

The owner must be able to:

* create a listing
* set availability
* receive the request
* approve/reject
* see payment status
* message the renter
* mark returned
* review the renter

If the renter or owner flow breaks, Part 1 is not done.

---

# 14. Final Rule

Do not confuse "smallest implementation" with "incomplete implementation."

Build the complete required flow with the fewest moving parts.

**Understand first. Reuse second. Simplify third. Code last.**
