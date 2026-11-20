# GitHub Actions: staging and production releases

## Release flow

- Pull requests: typecheck, lint, customer, administrator, and combined
  production builds, plus migration replay against a disposable Supabase
  instance. No hosted credentials are available.
- Manually run **Deploy staging backend** on `staging` to replay migrations,
  then apply pending migrations and deploy Edge Functions.
- Manually run **Deploy staging frontend** on `staging` to run app checks,
  verify the test database has no pending migrations, and publish the prebuilt
  frontend to <https://ybuy-e2e-test.vercel.app>. This does not deploy functions.
- Pushes to `dev` run **Deploy dev to production** after layer-specific CI
  checks. Supabase changes deploy migrations and Edge Functions; frontend
  changes deploy the combined app to <https://ybuys.netlify.app>. If both layers
  change, Supabase deploys first; an unchanged layer is skipped.
- When both layers change, deploy and verify the backend first. A current
  migration history does not prove that the correct function versions are deployed.

Node, Playwright, and pgTAP tests are disabled in CI, including reusable checks
called by deployment workflows. Typecheck, lint, build, and migration replay
failures still block deployment. Passing CI does not verify tested application
or database behavior.

GitHub Actions is the deployment owner for production. Disable automatic Git
production deployments for the Netlify `ybuys` site and Vercel
`ybuy-e2e-test`; otherwise a provider can publish before backend deployment
succeeds or create duplicate deploys.

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

The frontend workflow clears local `.vercel` configuration before pulling
settings using the configured Vercel team and project IDs. It does not run
`vercel link`. Resetting configuration does not grant access: the token must
already authorize that team and project.

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
- For staging frontend rollback, promote a previous Vercel deployment only
  after checking its compatibility with the current database/functions. For
  production, restore a previous Netlify deploy only after the same check.

## Automatic `dev` production deploy

The production workflow is intentionally path-aware. Frontend changes include
the app, APIs, Netlify functions/configuration, and build inputs; backend changes
include `supabase/**`. It runs only the corresponding reusable CI checks, skips
an unchanged deploy layer, and deploys Supabase before Netlify when both change.
Deploys are serialized and never canceled mid-migration. Production migrations
are applied automatically after CI succeeds, as requested.

Create a GitHub **production** environment with `dev` allowed as a deployment
branch and no required reviewer if every successful push must deploy
automatically. Configure these environment secrets:

| Environment secrets | Source |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase account access token for the selected project |
| `SUPABASE_DB_PASSWORD` | Database password for project `jzyjmsixfuwzfnntewqn` |
| `NETLIFY_AUTH_TOKEN` | Netlify personal access token authorized for the `ybuys` site |

Configure these production environment variables:

| Environment variables | Value |
| --- | --- |
| `SUPABASE_PROJECT_REF` | `jzyjmsixfuwzfnntewqn` |
| `NETLIFY_SITE_ID` | Site ID from Netlify site configuration for `ybuys` |

The selected Supabase project `jzyjmsixfuwzfnntewqn` is the isolated test
backend currently used by this repository, not a separate live-customer
database. The workflow pins its target to this exact ref and refuses any other
project. Netlify's production `VITE_SUPABASE_URL` must match this project; the
workflow checks it before building. Keep `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` as public build variables in Netlify, not secrets.

The frontend deploy uses Netlify CLI to build with the site's production
environment. Keep `VITE_SITE_VARIANT=combined`,
`VITE_TEST_ENVIRONMENT=true`, `VITE_TEST_PROFILE_LOGIN=true`, and
`VITE_TEST_PROFILE_HOSTS=ybuys.netlify.app` configured for the build. Keep
TOTP seeds, session keys, and `SUPABASE_SERVICE_ROLE_KEY` in Netlify's server
environment; they are not synchronized from GitHub Actions. Existing Auth,
payment, email, scheduler, and other Supabase runtime secrets are likewise not
changed by this workflow.

Before enabling deploys, verify these variables and secrets are configured.
Changes to `supabase/**` deploy the backend; changes to app/API/Netlify/build
paths deploy the frontend. The workflow does not provision users, change
database roles, or automatically roll back migrations. Keep schema changes
backward-compatible with the currently published frontend and functions.
