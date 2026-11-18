# Requirements traceability

Date: 2026-10-18. Status separates code implementation from deployment verification.

The current [Owner & Renter validation report](OWNER_RENTER_VALIDATION_STATUS.md)
supersedes older validation statements below, including historical email-delivery
and browser-test limitations. Older sections are retained as dated implementation history.

## Owner and Renter increment (2026-10-21)

This section supersedes older local-validation/deployment statements for these
features. New migrations `20261021000005` through `20261021000023` are local-only.
The earlier isolated-hosted Auth/email/settlement setup is unchanged.

| Requirement | Implementation | Verified boundary / remaining acceptance |
| --- | --- | --- |
| Stable global Customer ID | Server sequence, immutable ID, retired-number registry, backfill | SQL and genuine concurrent local signups; destructive migration-failure/replay rehearsal not executed |
| International profile geography | Maintained reference, private optional country/region, server timestamps | Country/subdivision/RLS/currency/transaction-snapshot SQL; real profile save/reload |
| Bulk investigation | Explicit permission, CSV normalization, country/region filters and grouping before pagination, audit/rate limits | SQL and genuine private admin UI; invalid/unknown IDs retained, self-reported geography labeled; no invented device, chargeback or cross-border score |
| Radius and optional dates | Authoritative PostGIS search and capacity calendar | Boundary-distance/date/quantity SQL and real browser discovery |
| Declared value, deposits and safe edits | Wizard, category rules, revision RPC, protected material/photo edits, history | Database tests; complete address-backed publication/edit browser journey still needs provider setup |
| Fifteen-minute checkout | Server deadlines, capacity release, session binding, exception queue | Expiration/idempotency/free-inventory reclaim/conflict SQL; provider worker and hosted paid E2E pending |
| Persisted agreements | Immutable snapshots, policy versions, participant read/acceptance | SQL snapshot/privacy/immutability/test-template acceptance; real legal approval remains blocked |
| Optional bidding and real top-five ticker | Listing rules, persisted ranked public feed, motion controls | SQL minimum/guardrail/expiry/top-five/privacy/withdrawal/feature gate; mocked-browser five-link, keyboard pause, reduced-motion, mobile, invalid-feed and expiry/retry checks pass; genuine complete bidding E2E not run |
| Request an Item | Explicit geocoded area, radius, existing-listing suggestions, live matches | Genuine create/suggestion/confirmation/matching UI plus SQL; bounded >100-match processing and queued-email suppression verified |
| Deposit refunds and Owner transfers | Existing guarded test-only Stripe settlement | Current unit/SQL checks and earlier actual sandbox receipts; hosted credentials and bank-payout acceptance remain blocked |

## Super Admin Vault Chest

| Requirement | Status | Implementation / evidence | Boundary |
| --- | --- | --- | --- |
| Super Admin-only vault navigation and server authorization | Implemented; locally verified | Admin role gate plus `admin_vault_prepare`, `admin_vault_status`, `admin_vault_save`; database checks cover ordinary users/admins, revocation and sessions | Hosted migration not deployed |
| Authenticator-app MFA required for vault reads/writes | Implemented; real local Authenticator code verified | Supabase TOTP enrollment/challenge, `aal2`, verified factor and recent `amr` TOTP check on every RPC | Hosted Supabase Auth TOTP remains unchanged/off unless separately configured |
| Encrypted secret storage with no read-back | Implemented; local database/browser checks passed | Supabase Vault; masked status; no browser Vault schema privilege; generic audit reason omits supplied value | No actual environment secret was migrated and entries do not feed existing integrations |
| Prevent unsafe concurrency and secret overwrite | Implemented; local check passed | Expected version plus per-key advisory transaction lock; local race permits only one matching-version replacement | Replacing in the chest does not rotate a provider credential |

## Reactive feature flags

| Requirement | Status | Implementation / evidence | Boundary |
| --- | --- | --- | --- |
| Flag changes reach mounted consumers without user action | Implemented; focused store/WebSocket browser checks executed | Shared `useFeatureFlags` store; Admin switches, request creation/discovery and listing/request offers | Network-dependent WebSocket delivery; unconsumed flags do not activate modules |
| Reconnect resync, initial-load races, explicit failure states and cleanup | Implemented; focused checks executed | Revision-checked snapshots, automatic read retry, closed-channel recovery and fail-closed consumers | Server-side authorization and financial gates remain independent |
| Database publishes flag changes | Hosted publication and migration history verified read-only | [migration 10](../../supabase/migrations/20261018000010_feature_flags_realtime.sql); real anonymous subscription returned `SUBSCRIBED` | No hosted flag toggle, migration push or frontend deployment performed by this pass |

## Notification system

| Requirement | Status | Implementation / evidence | Boundary |
| --- | --- | --- | --- |
| Persistent recipient-only center, filters, mark-read, unread count, incremental history and Realtime refresh | Implemented; locally verified; backend deployed | `/notifications`, bell badge, `notifications` RLS and read RPC in [migration 08](../../supabase/migrations/20261018000008_notification_delivery.sql) | Hosted RLS verified; full authenticated browser flow remains an acceptance check |
| Booking, message, marketplace, case and review events | Implemented in database code | Transactional database triggers create in-app events and email jobs; message emails are conversation-throttled | Payment confirmation is announced from the verified booking state transition; no speculative frontend success event |
| Independent category preferences | Implemented in code; database verification pending | Per-user in-app/email preferences, owner-only RLS and promotional opt-in defaults | No promotional event producer or one-click unsubscribe flow is enabled |
| Resend sender, templates, bounded retries and delivery tracking | Implemented; templates and local database behavior verified | `RESEND_API_KEY` only in server env; local/test recipient redirect; signed webhook records delivered/bounced/complained/failed | No real email sent; production sender and webhook configuration remain pending |
| Safe destinations, private jobs and duplicate protection | Implemented; local SQL and template-security tests pass | Service-role-only outbox, stable event keys, Resend idempotency and webhook replay keys | Do not deploy without applying migrations and configuring Edge Function/Vercel secrets |
| Scheduled global queue processing | Deployed and verified | [migration 11](../../supabase/migrations/20261018000011_notification_supabase_cron.sql), five-minute Supabase Cron, pg_net and Vault-backed worker secret | Automatic Cron run succeeded; manual worker check returned HTTP 200 and one Resend-accepted email; signed delivery webhook remains unconfigured |

## Item requests and rental offers

| Requirement | Status | Implementation / evidence | Boundary |
| --- | --- | --- | --- |
| Renters create, search, edit and close item requests | Implemented in code; local migration verification pending | `/requests`, `/need-something`; `item_requests` table and server RPCs in [migration 06](../../supabase/migrations/20261018000006_item_requests_and_negotiation.sql) | `item_requests` flag defaults off; no hosted migration applied |
| Owners submit listing-backed or unlinked offers; participants negotiate | Implemented in code; local migration verification pending | Persistent negotiation/proposal rows, listing linking, request response counts and feature-gated counteroffers | `bidding` flag defaults off; an unlinked offer cannot be accepted |
| Accepted offer creates a booking with server-calculated totals | Implemented in code; SQL test added | Acceptance locks and revalidates listing inventory/availability and creates `pending_payment` booking | Payment remains unconfirmed until the existing verified Stripe webhook |
| Direct listing offers honor owner opt-in | Implemented in code; verification pending | Listing owner controls `negotiation_enabled` and quantity; listing detail shows offers only for eligible listings | Fixed-price checkout is preserved |
| Marketplace notifications and admin moderation | Implemented in code; SQL verification pending | `/notifications`, Admin Item requests, participant-scoped RLS and audited moderation using `listings.moderate` | No email-delivery claim; hosted migration not applied |

## Operations increment

The approved scope and financial boundaries are recorded in
[decisions](DECISIONS.md#approved-operations-increment-2026-10-18).
This increment is developed locally; the existing hosted deployment does not
automatically receive new migrations or screens.

Update: the owner explicitly authorized the operations migration deployment on
2026-10-18. It is now applied to hosted Supabase and the local hosted-backed
frontend menus/queues were browser-verified. Financial gates remain disabled;
see [deployment verification](TEST_PLAN.md#authorized-hosted-operations-deployment-2026-10-18).

| Requirement | Route / surface | Permission / boundary |
| --- | --- | --- |
| Persistent disputes, evidence, investigation and decisions | `/admin/disputes`, `/claims` | `disputes.manage`; participants limited to their own cases; private evidence |
| Support queue, replies, notes and assignments | `/admin/support`, `/support` | `support.manage`; internal notes never exposed to participants |
| Platform-funded promotions and campaign history | `/admin/promotions` | `promotions.manage`; test-only redemption; no checkout stacking |
| Test credit issuance, ledger and reservation | `/admin/promotions`, `/wallet` | `credits.manage`; test environment gate; no direct balance edits |
| Refund request and approval records | Admin financial dependencies | `refunds.issue`, `refunds.approve`, `refunds.senior`; execution disabled |
| Participant notification history | `/notifications` | Authenticated recipient only; no claim of email delivery |

The backend is delivered in
[the additive migration](../../supabase/migrations/20261018000005_admin_operations.sql).
Verification includes [database assertions](../../supabase/tests/admin_operations.sql),
[real-session concurrency](../../supabase/tests/admin_operations_concurrency.ps1),
[local REST/Storage checks](../../scripts/verify-admin-operations-local.mjs), and
[browser behavior](../../tests/admin-operations.spec.ts). Financial test gates
remain disabled outside explicitly scoped local fixtures.

Implementation and executed-check results for this increment are recorded in
[test plan](TEST_PLAN.md); pending financial policies must not be represented as
production-ready functionality.

| Requirement | Status | Implementation/evidence | Remaining work |
| --- | --- | --- | --- |
| Issues 19-23, 29-30: Google sign-in, account selection, restoration, logout | Partially implemented | [Auth context](../../src/auth-context.tsx), [Supabase client](../../src/lib/supabase.ts), [sign-in dialog](../../src/components/sign-in-dialog.tsx). Shared sign-in/join, PKCE, account picker, surfaced errors and busy states. | Configure and verify the real provider, callback allowlist and two real Google accounts. |
| One account can rent and lend | Implemented in existing flow; live verification pending | Both dashboard tabs and listing creation use the same authenticated user, without selecting a permanent renter/owner account type. | Real renter/owner smoke journey. |
| Safe authentication return path | Implemented; unverified end-to-end | [Navigation](../../src/components/nav.tsx) retains protected destination; OAuth returns to current origin/path/query, strips OAuth parameters and fragments. No caller-supplied external return URL. | Confirm Supabase production redirect allowlist. |
| Public versus private routes | Implemented | Existing [route gates](../../src/App.tsx) remain; see [decisions](DECISIONS.md). | Hosted direct-API validation. |
| Session expiry and revocation | Partially implemented | Expiry/focus checks in UI; [migration](../../supabase/migrations/20261018000001_auth_data_isolation.sql) checks JWT expiry and `auth.sessions`; booking writes and authenticated RLS use it. Both authenticated Edge Functions check sessions. | Apply migration and redeploy functions; verify against hosted Auth. |
| Inactivity/absolute session policy | Requiring business decision for any non-default limit | No invented 30-minute timeout. Local access tokens expire after one hour and refresh automatically; hosted settings unverified. | Choose optional limits in Supabase if required; see [decisions](DECISIONS.md). |
| Account linking / duplicate prevention | Partially implemented | Uses Supabase's Google identity handling and unique profile IDs. No client-side account merging by email; new-profile trigger remains idempotent. | Real repeat-login and account-linking checks. |
| Facebook and Apple | Implemented in code; not verified | [Providers](../../src/lib/auth-providers.ts), [dialog](../../src/components/sign-in-dialog.tsx), [auth context](../../src/auth-context.tsx). Buttons appear via `VITE_AUTH_PROVIDERS`. | Provider credentials in Supabase and real sign-in; see [decisions](DECISIONS.md). |
| Issues 7-11: listing validation and Publish feedback | Implemented; unverified at runtime | [Rules](../../src/lib/listing-rules.ts), [form](../../src/pages/create-listing.tsx), [trigger migration](../../supabase/migrations/20261018000002_listing_field_validation.sql). | Confirm limits and description policy; apply migration; browser check. |
| Issue 24: Electronics category fails | Root causes fixed by code review; live repro impossible | [Search page](../../src/pages/search.tsx), [listings lib](../../src/lib/listings.ts). | Supabase project host does not resolve; confirm against live data once reachable. |
| Issues 2, 15-17: calendar | Partially implemented | [Picker](../../src/components/date-range-picker.tsx): fixed blank calendar at 1024-1279px, booked/blocked dates disabled, ranges cannot span taken dates; typecheck and lint errors resolved. | Server-side overlap exists in booking RPC; owner calendar, positioning and navigation not re-verified. |
| Issues 12-14, 18, 27-28: personal data and zero new-user activity | Partially implemented | Existing owner/renter/favorite filters retained. [App](../../src/App.tsx) remounts page state by user identity. Demo startup/personalization no longer affects real users. Private profile columns restricted. | Execute database isolation checks; review existing demo contamination without deleting legitimate data. |
| Favorites/profile failure states | Implemented; runtime verification pending | [Favorites](../../src/pages/favorites.tsx), [profile](../../src/pages/trust-profile.tsx). No success-shaped removal or blank profile. | Resume browser checks. |
| Issues 1-11, 15-17, 24-26 | Pending later batches | Location, categories, calendars, listing validation, AI classification and general responsive fixes are not certified by this auth batch. | Reproduce individually; preserve existing work. |
| Payment lifecycle, handoff, notifications and other expanded features | Pending/outside current batch | Only authentication/session checks and payment-confirmation execution permissions changed. | No claim of completed payments, refunds, payouts or full marketplace readiness. |
| Admin overview | Implemented in code; DB execution pending | `/admin/overview`; `admin_overview` reports period-based bookings, fees/refunds and current user/listing/deposit/payable snapshots. | Run [admin DB tests](../../supabase/tests/admin_foundation.sql), provision a super admin and verify with real records. |
| User restriction | Implemented in code; DB execution pending | `/admin/users`; `admin_list_users`, `admin_set_user_restriction`, `user_restrictions`; restriction blocks listing, booking, message and review writes and suspends published listings. | Verify all trigger/RLS paths locally; later add account-wide auth/session revocation if product requires it. |
| Listing moderation | Implemented in code; DB execution pending | `/admin/listings`; `admin_list_listings`, `admin_set_listing_suspension`; suspended rows are removed from public listings and owners cannot self-reinstate. | Run permission and owner-bypass tests. |
| Bookings, payments and payouts | Implemented read-only in code; DB execution pending | `/admin/bookings`, `/admin/payments`, `/admin/payouts`; paginated permission-checked RPCs over `bookings`, `payments`, `payouts`. | Operational refunds/payout transitions and reconciliation are part of the separate financial module; no UI claims to execute them. |
| Reviews and categories | Implemented in code; DB execution pending | `/admin/reviews`, `/admin/categories`; review deletion preserves prior row in audit; category updates use permission-checked RPCs. | Verify policy, uniqueness, audit and active-category behavior locally. |
| Super Admin settings and feature flags | Implemented in code; DB execution pending | `/admin/settings`, `/admin/flags`; validated persistent `app_settings` and `feature_flags`, audited updates, deploy-safe default seeding. Booking fee is read by `create_booking_request` and snapshotted on booking; `item_requests` and `bidding` gate the marketplace request/offer features. | Verify test cases; unrelated remaining flags are descriptive until their modules are implemented. |
| Admin accounts, roles and permissions | Implemented in code; DB execution pending | `/admin/admins`; `admin_users`, `admin_upsert_admin`, last-super-admin guard, immutable permission catalog. | Provision initial super admin using the documented trusted DB procedure; run role escalation tests. |
| Audit history and integration status | Implemented in code; DB execution pending | `/admin/audit`; append-only `admin_audit_log`; `admin-system-health` returns database health and credential-configured booleans only. | Deploy edge function; verify no secret values are returned. Permission-denial forensics are not included. |
| Other admin navigation areas | Clearly marked unavailable | Insurance and extended analytics retain explicit non-functional placeholders. Disputes, support and promotions are covered by the operations increment above. | Implement only separately approved modules; no fake counts or success responses. |
| Live financial execution and Stripe Connect | Not implemented here | Request/offer booking acceptance still enters `pending_payment`; it does not imply live refunds, deposits, payouts or Stripe Connect. | Resolve financial policies before any execution; unrelated modules remain deferred. |

Prepared checks: [browser regressions](../../tests/auth-isolation.spec.ts) and
[database policies](../../supabase/tests/auth_data_isolation.sql). Test execution
is paused; neither suite is marked passing.
