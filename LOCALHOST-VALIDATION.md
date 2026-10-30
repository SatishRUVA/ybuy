# YBuy Localhost Validation Log

Date: 2026-10-30

## Redesign Status Snapshot

Estimated completion: **45%**. This is a conservative scope estimate, not a line-count metric.

- Discovery: mostly complete. Product, routes, data-backed workflows, and nine desktop baseline captures are documented. Tablet/mobile baseline coverage is not evidenced.
- Design direction: partially complete. `PRODUCT.md` and `.21st/design.json` exist, but there is no `DESIGN.md` or final after-capture set. The 21st direction artifact includes private-offer settings and simulated insurance pricing, which conflict with the brief's two-path and preserve-business-logic requirements.
- Implementation: substantial work exists across production UI files, but no complete page-by-page acceptance or visual comparison is recorded. A shared localhost screenshot showed the current category grid only; it is not a full-page QA artifact.
- Business logic: partial verification. The earlier hosted suite passed 17 cases, failed 2, and skipped 3; later targeted pair fixes were reported but not independently verified in a final full run. Local Supabase E2E remains blocked by Docker availability.
- Visual QA: incomplete. No stored after screenshots, tablet captures, all-route interaction pass, or full responsive/overflow/loading/error-state matrix is evidenced.

## Safety Boundary

- Browser app and local E2E base URLs use `http://localhost:5174`; local Supabase API uses `http://localhost:54321`.
- The supplied `test-accounts.json` is preferred for hosted-backend tests and is ignored by Git. Credentials are not printed in test logs.
- Do not invoke `send-notification-emails`, `send-test-auth-email`, Resend, signup flows that send confirmation email, or hosted tests that can queue email while the Resend quota is constrained.
- The email worker uses Resend even when test messages are redirected to the designated test inbox. A redirect is not a no-send guarantee.

## Validation

- Playwright discovery: 22 cases found across the account and discovery specs; discovery does not execute test cases.
- Earlier hosted E2E run, before the explicit no-email instruction: 17 passed, 2 failed, 3 skipped. Pair 4 remained `requested`; instant pair 5 timed out waiting for the payment action. Later session updates reported both targeted pairs passing after fixture changes, but that result was not independently rerun or captured in this validation pass.
- Local Supabase E2E was unavailable because Docker Desktop's Linux engine was not running.
- `pnpm run typecheck`: passed before the final test-only account-loader/import edits.
- `pnpm run build`: passed before the final test-only account-loader/import edits.
- `pnpm run lint`: 0 errors and 7 existing warnings after removing the unused checkout capture. The account-loader change then exposed two unused imports; those were removed and targeted ESLint passed for the account loader and both affected specs.
- VS Code diagnostics: no errors in the affected Playwright config/spec files.
- Source scans: no `127.0.0.1` occurrences in `tests/**` or `playwright*.config.ts`.
- No email sender function was invoked during this validation pass. Because hosted E2E ran earlier and could enqueue notifications, this log does not claim that no email was delivered by an independent scheduled worker during that earlier run.

## Remaining

- Do not rerun hosted booking/auth E2E until mail delivery is confirmed disabled or safely stubbed at the backend boundary.
- Re-run the complete multi-account suite when a no-email test environment is available; confirm owner-approval pairs 1-4 and instant pair 5 together.
- Re-run full lint, typecheck, and build after the account-loader edits if needed for release sign-off.
