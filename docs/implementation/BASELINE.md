# Implementation baseline

Date: 2026-10-18.

## Scope and working tree

The selected first batch was user data isolation and Google authentication. The
latest direction prioritizes the authentication UI and setup, and pauses test
execution. This is not a completion claim for the full attached product brief.

YBuy remains React 18, Vite, TypeScript, Tailwind, Supabase and Stripe. Existing
routes, visual primitives, records and unrelated uncommitted work are preserved.
The repository already had staged and unstaged changes before this batch.

## Evidence and root causes

| Area | Baseline evidence | Change in this batch |
| --- | --- | --- |
| Account state | [AuthProvider](../../src/auth-context.tsx) restored sessions without surfacing errors; profiles and page state could survive account changes. | Account-scoped rendering, profile identity checks, visible errors, session verification. |
| Google OAuth | Redirected directly from multiple controls without account selection. Navigation to protected pages started OAuth before recording the destination. | Shared sign-in/join dialog; protected destination is retained; PKCE; `prompt=select_account`; same-origin return URL without OAuth parameters or fragments. |
| Logout | Supabase errors were ignored. | Errors and busy state are visible. Successful global logout clears local state. Switching accounts first ends only the current device's session. |
| Profile privacy | `profiles_select_any` exposed contact columns. Display joins already selected only ID, name and avatar. | Public display-column grants plus an authenticated current-profile RPC. |
| RPC permissions | Giving `EXECUTE` to one role did not revoke PostgreSQL's default `PUBLIC` permission. Participant comparisons with a null UID were unsafe for anonymous invocation. | Anonymous execution revoked; payment confirmation restricted to service role. |
| Revoked sessions | Existing RLS checked user identity but not whether the JWT's session still existed. | Session lookup, restrictive RLS, booking write trigger, Edge Function checks. |
| Unexpected user activity | [Development startup](../../package.json) ran [demo personalization](../../scripts/seed-demo.mjs) against every real profile. Disabling demo mode invoked destructive cleanup. | Startup only runs Vite. Seeding is explicit, local-only and restricted to a dedicated demo member. Automatic cleanup removed. |
| Favorites/profile errors | Failed removal could reject without a user message; profile load could leave a blank page. | Visible failure/recovery states; unsuccessful removal retains the saved item. |
| Admin authorization and operations | No administrator roles, server-side admin RPCs, audit history or operations console existed. Existing tables contain listings, bookings, payments, payouts, reviews and categories. | Added permission-checked admin RPCs, a responsive Admin/Super Admin console over existing data, moderation actions and an additive migration. |

## Initial auth-batch validation

- Production build succeeds, with the existing large-bundle warning.
- Focused auth-file ESLint succeeds, with the existing React Fast Refresh warning.
- Full lint already failed in [date-range-picker.tsx](../../src/components/date-range-picker.tsx):
  unused `rangeHasUnavailable`.
- Full TypeScript already failed in the same file: three `MonthGrid` calls omit
  `bookedDates` and `blockedDates`. No new auth TypeScript errors remain.
- Browser test execution was interrupted; tests are now paused at the user's
  request. The added checks are not evidence of a passing flow.
- Local database checks could not connect: Docker/local Postgres was unavailable.
- No migration, Edge Function, provider settings or frontend deployment was
  applied to production.
- Real Google OAuth, two-account linking behavior, hosted session settings and
  hosted RLS have not been verified.
- Admin/Super Admin migration has been applied and tested locally; the initial
  super admin is not yet provisioned. The health function returned 401 without
  authorization; it has not been deployed or tested with an authenticated admin.
  See [test plan](TEST_PLAN.md).

## Admin-batch validation

- Current `pnpm run typecheck` and `pnpm run build` pass. `pnpm run lint` passes
  with 0 errors and 7 existing warnings.
- Local `supabase test db --local` passes 82 assertions across the admin and
  authentication-isolation SQL suites.
- The role-gated console was browser-smoke-tested with mocked Supabase responses.
- Hosted migration/deployment, OAuth, and real-admin browser verification remain
  outstanding.

Existing demo-created records have not been deleted or hidden using heuristics.
Separating them from legitimate records needs a reviewed, provenance-based
cleanup. A listing title or a demo counterparty alone is not sufficient evidence
that a real user's record is disposable.
