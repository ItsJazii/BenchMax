# BenchMax handoff

**Checkpoint date:** 2026-08-02 (Asia/Karachi)  
**Repository:** `E:\benchmax`  
**Current branch:** `codex/phase-2-foundation`  
**Local checkpoint:** `580df53` — `Complete secure Phase 2 foundation`  
**Remote Phase 2 branch:** `496ab05` (the local checkpoint has not been pushed)  
**Remote main:** `ce96c5c`  

This file is a restart point for the next session. It contains no credentials,
tokens, private keys, database exports, or provider secrets.

## Current phase status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 | Complete | Code residuals, schema/catalog work, pipeline work, and launch docs are on the repository. |
| Phase 1 | Complete | Private GitHub repository, clean-checkout CI, PR controls, security docs, and CODEOWNERS are in place. |
| Phase 2 repository foundation | Complete | Secure environment isolation, Cloudflare config validation, deployment preparation, CI gates, and docs are committed locally. |
| Phase 2 external provisioning | In progress | Waiting on owner-controlled Cloudflare billing/security, domains, Clerk, judge, and E2B setup. |
| Phase 3 | Not started | Staging deployment, migrations, calibration, and lifecycle validation happen after Phase 2 exits. |

## What is complete locally

- Production and isolated staging D1/Queue resource names are separated in both
  Worker configurations.
- `scripts/phase2-config.mjs` parses JSONC safely, including comments,
  trailing commas, and strings containing comment-like characters.
- `scripts/phase2-preflight.mjs` validates both configs, resource IDs, queue
  separation, required environment keys, malformed `.env.example` lines, and
  forbidden image-binding usage.
- `scripts/prepare-main-deploy.mjs` creates an environment-specific config from
  the built Worker so the Vinext-generated config cannot silently fall back to
  production resources.
- CI has explicit read-only permissions, pinned checkout/setup actions,
  disabled checkout credentials, generated Wrangler types plus a check, full
  tests, typecheck, lint, deployment dry-runs, and production dependency audit.
- The browser-heavy evaluator and lifecycle test files run serially in the full
  test command. This prevents resource contention from exceeding the evaluator
  child-process timeout.
- Documentation was updated in `README.md`, `CONTRIBUTING.md`,
  `LAUNCH-PLAN.md`, and `docs/phase-2-provisioning.md`.
- Devin's previous findings were addressed: staging isolation, JSONC parsing,
  generated main deploy configs, strict env-key parsing, and repo-wide image
  binding checks.

## Verification evidence

The following passed before checkpoint commit `580df53`:

- `npm run phase2:preflight`
- `npx tsc --noEmit --pretty false`
- `npm run lint -- --no-cache`
- `npm audit --omit=dev --audit-level=high` — 0 vulnerabilities
- `npm test` — pretests (3), core security/integration tests (102),
  evaluator/lifecycle tests (3), D1 invariants, build, and rendered HTML tests
  (28) all passed
- Main Worker staging and production Wrangler dry-runs
- User-content Worker staging and production Wrangler dry-runs

Only known non-fatal warnings remained: Playwright/Vinext experimental output,
the Vite native config-loader warning, and a rendered-test temporary-directory
cleanup warning on Windows.

## Current Cloudflare evidence

Account ID (non-secret): `be0217f3d7fe3bd6ecaac6f55178f99e`

- Account-level 2FA enforcement: **off**.
- The current owner identity also reports 2FA: **not enrolled**.
- R2 bucket listing returns Cloudflare error `10042`: R2 must be enabled in the
  Dashboard first.
- Workers scripts: none.
- Worker custom domains: none.
- Workers.dev subdomain: not provisioned.
- Zones attached to the account: none.
- Production D1: `benchmax-d1`, ID
  `1b90635c-2906-472f-a0d1-242cbceee802`, 0 tables, jurisdiction `null`.
- Staging D1: `benchmax-staging-d1`, ID
  `5d44e60d-bff8-4036-9c4d-383464230670`, 0 tables, jurisdiction `null`.
- Production queues exist: `benchmax-evaluate`, `benchmax-judge`,
  `benchmax-pipeline-dlq`.
- Staging queues exist: `benchmax-staging-evaluate`,
  `benchmax-staging-judge`, `benchmax-staging-pipeline-dlq`.
- All six queues currently have zero consumers.
- No D1 migrations have been applied; this is intentionally deferred to Phase 3
  staging validation.

Do not enable account enforcement before the owner enrolls 2FA. Do not enable
paid services, create public origins, deploy Workers, or apply migrations to
production until the required owner decisions and security prerequisites exist.

## Remaining Phase 2 work

Owner actions:

1. Enroll the Cloudflare owner account in 2FA, then enable account-level 2FA
   enforcement.
2. Enable R2 and the Workers Paid capability in the Cloudflare Dashboard.
3. Choose the main HTTPS application origin and a separate cookieless
   user-content origin. A workers.dev origin is acceptable for user content if
   deliberately chosen.
4. Create the private buckets `benchmax-uploads-staging` and
   `benchmax-uploads` after R2 is enabled. Keep public access disabled.
5. Create/configure Clerk with Google, GitHub, and email-code sign-in and exact
   production origins.
6. Choose and pin the immutable judge model snapshot after calibration.
7. Build the E2B `sandbox/browser-web-v1` template and record its immutable
   template ID and build hash.
8. Store secrets only through the approved runtime secret path (for example,
   `wrangler secret put` or Cloudflare Secret Store). Never paste secrets into
   chat, Markdown, JSONC, `.env`, GitHub logs, queue messages, or D1.

After these prerequisites exist, Codex can create/verify the buckets, deploy
isolated staging Workers, configure the disjoint queue consumers, and proceed
to Phase 3. Do not treat the local dry-runs as proof that Cloudflare resources
are deployed.

## PR state and required workflow

- Draft PR: https://github.com/ItsJazii/BenchMax/pull/1
- PR head currently on GitHub: `496ab05`.
- CI and Devin were green for that older remote head.
- Local commit `580df53` and this handoff file are not pushed yet.
- Keep the PR draft and do not merge while Phase 2 external prerequisites are
  incomplete.

When Phase 2 is genuinely complete:

1. Run the full validation gates again.
2. Push the complete local branch to the existing PR.
3. Wait for CI and Devin review.
4. Fix every Devin finding, rerun all gates, push again, and wait for a second
   Devin approval.
5. Merge only after the second review is clear.

## Resume commands

```powershell
Set-Location E:\benchmax
git status
git switch codex/phase-2-foundation
git log -1 --oneline --decorate
npm run phase2:preflight
```

After owner prerequisites are confirmed, rerun the full suite and the four
environment-specific dry-runs before pushing. The local app was listening at
`http://localhost:5173` at the last check; use `npm run dev` if it is no longer
running.

## Prior browser-wallet issue

The `Cannot redefine property: ethereum` popup came from the external wallet
extension at `chrome-extension://.../evmAsk.js`, not from BenchMax. Repository
search found no wallet, EVM, MetaMask, wagmi, or viem integration. Test with a
clean browser profile or only one wallet extension enabled.

## Important pause state

The user requested a pause after saving the checkpoint. Do not push, merge,
deploy, enable billing, change account security, install plugins, or apply
database migrations until the user resumes and the prerequisites are reviewed.
