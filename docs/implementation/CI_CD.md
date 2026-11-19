# GitHub Actions: staging releases

## Release flow

- Pull requests: typecheck, lint, customer and administrator production builds,
  and migration replay against a disposable Supabase instance. No hosted
  credentials are available.
- Manually run **Deploy staging backend** on `staging` to replay migrations,
  then apply pending migrations and deploy Edge Functions.
- Manually run **Deploy staging frontend** on `staging` to run app checks,
  verify the test database has no pending migrations, and publish the prebuilt
  frontend to <https://ybuy-e2e-test.vercel.app>. This does not deploy functions.
- When both layers change, deploy and verify the backend first. A current
  migration history does not prove that the correct function versions are deployed.
- No production release workflow is enabled.

Node, Playwright, and pgTAP tests are disabled in CI, including reusable checks
called by deployment workflows. Typecheck, lint, build, and migration replay
failures still block deployment. Passing CI does not verify tested application
or database behavior.

GitHub Actions is the sole deployment owner. Disable automatic Git deployments
for the Vercel `ybuy-e2e-test` project before enabling this pipeline; otherwise
Vercel can publish before backend deployment succeeds.

## One-time setup

In the repository's **Settings > Environments**, create `staging` and restrict
deployment branches to `staging`. Configure the following environment values.
Never paste credentials into chat or commit them.

| Environment secrets | Source |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase account access token for a dedicated deployment account with access to the test project |
| `SUPABASE_DB_PASSWORD` | Database password for project `jzyjmsixfuwzfnntewqn` |
| `VERCEL_TOKEN` | Vercel deployment token with access to the team owning `ybuy-e2e-test` |

| Environment variables | Value |
| --- | --- |
| `SUPABASE_PROJECT_REF` | `jzyjmsixfuwzfnntewqn` |
| `VERCEL_ORG_ID` | `orgId` from the linked Vercel project's `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | `projectId` from that same project file |

Keep the existing frontend and server configuration in Vercel's **Production**
environment for the **test project**, including its staging Supabase URL and
public anon key. Here `--prod` means the stable alias of `ybuy-e2e-test`, not the
live customer project. The workflow refuses a different project ID or backend
URL. Existing Stripe, email, scheduler, and other runtime secrets remain in
Supabase Edge Function secrets; no service-role key is needed in Actions.

The frontend workflow explicitly links the configured Vercel team and project
before pulling settings. Fresh Actions runners have no retained Vercel link.
Linking does not grant access: the token must already authorize that team and
project.

Commit the workflows and all intended release files first. Create `staging`
from a reviewed commit, push it, and select `staging` when dispatching a workflow.
GitHub registers a new manually dispatched workflow only after its file exists
on the default branch. Uncommitted local changes are never deployed by Actions.
These pipelines do not create test
accounts, apply development seed data remotely, change Auth settings, provision
webhooks, delete retired functions, or synchronize runtime secrets.

Protect `staging` and `main` against direct/force pushes; require pull requests
and passing **App checks**, **Database checks**, and the existing Trivy scan.
Select the exact check names GitHub displays after the first run. Anyone able
to change workflows on the release branch can potentially access deployment
credentials, so restrict merge permissions and review workflow changes.

## Safety and recovery

- Backend and frontend deployment runs share a concurrency group and are never
  canceled mid-migration. Review pending runs before dispatching another run.
- CLI versions come from the committed pnpm lockfile; installs are frozen.
- Public dependencies resolve through public npm tarball URLs, retaining pinned
  versions and integrity hashes; no workstation registry credentials are needed.
- Functions use API-side bundling (`--use-api`), so deployment does not depend on
  the workstation's authenticated npm registry. JWT verification settings come
  from `supabase/config.toml`; do not globally disable verification.
- History drift fails the release. Investigate it rather than automatically
  repairing migration history or using `--include-all`.
- SQL changes must remain compatible with the currently running frontend and
  functions. Deployments across Supabase and Vercel are not atomic.
- A failed backend deployment may leave migrations and individual functions
  applied. Do not publish a frontend that depends on a failed or incomplete
  backend deployment. Review the failure, fix forward, and rerun; do not
  automatically reverse financial migrations.
- The final check verifies that the public alias serves the app shell. It is not
  an authenticated booking/payment test. If Vercel Deployment Protection is
  enabled, explicitly configure an approved automation bypass before replacing
  this check; never silently accept an authentication page.
- For frontend rollback, promote a previous Vercel deployment only after
  checking its compatibility with the current database/functions.

## Adding production later

Use a separate GitHub `production` environment, distinct Supabase/Vercel
projects and credentials, required reviewers (where supported by your GitHub
plan), and a manually selected reviewed release commit. Keep a database backup
and recovery procedure before allowing production migrations. Do not repurpose
the staging project or point this workflow at production.
