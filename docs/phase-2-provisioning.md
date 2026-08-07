# Phase 2 provisioning and security handoff

Status: replacement-account resources provisioned, 2026-08-05.

This runbook records the external prerequisites for staging. It deliberately
does not contain credentials, tokens, private keys, or database exports.

## Current Cloudflare evidence

- Account access is available through the least-privilege Cloudflare Workers
  Bindings MCP and Wrangler OAuth.
- D1 `benchmax-d1` exists with ID
  `b3947917-6bd5-4a92-a0ec-40f583acdb08` in region EEUR.
- Staging D1 `benchmax-staging-d1` exists with ID
  `b5f6150a-7160-4ce7-bd87-2a9038683019` in region EEUR, matching production
  so Phase 3 latency and behavior measurements use the intended placement. The
  previous empty APAC staging database (`490090cb-d8c1-42b2-8c6a-90651c20c44f`)
  was deleted on 2026-08-07 before migrations or application data; it was
  recreated in EEUR specifically for production-region parity.
- Queues `benchmax-evaluate`, `benchmax-judge`, and
  `benchmax-pipeline-dlq` exist.
- Staging queues `benchmax-staging-evaluate`, `benchmax-staging-judge`, and
  `benchmax-staging-pipeline-dlq` also exist; staging and production queues are
  intentionally disjoint.
- R2 is enabled. Private buckets `benchmax-uploads` and
  `benchmax-uploads-staging` exist with public access disabled by default.
- No BenchMax Workers or custom domains exist yet, and no remote migrations
  have been applied.
- The owner login has two-factor authentication. Account-level enforcement
  still needs dashboard verification.
- Staging starts on Workers Free. Its 10 ms CPU, 3 MB Worker, five-cron,
  10,000-queue-operation/day, and 24-hour queue-retention limits are release
  measurements; upgrade to Workers Paid only after owner approval if a limit
  blocks staging or launch reliability. Free-plan staging is attended only:
  inspect the DLQ after every lifecycle batch and at least every 12 hours, and
  triage any message before its 24-hour expiry. The DLQ consumer normally drains
  messages immediately and records each one as `run.pipeline_dead_lettered` or
  `run.pipeline_dead_letter_ignored`. The two-minute cron separately samples
  Cloudflare's realtime queue metrics to detect a stuck consumer: it records
  `operations.pipeline_dlq_nonempty` when backlog opens or grows and every 12
  hours while nonzero, plus `operations.pipeline_dlq_cleared` when it drains.
  Cloudflare prices message writes, reads, and deletes as queue operations; the
  metrics call is an observability read, but Free-plan usage is still reviewed
  during staging. Unattended beta or an inability to meet the 12-hour rule
  requires the Paid retention upgrade before proceeding. The 2026-08-05 dry-run
  measured the main Worker at 750.52 KiB gzip and the user-content Worker at
  7.48 KiB gzip, both below the Free-plan bundle limit; runtime CPU remains a
  staging measurement.

## Dependency maintenance notes

- The `postcss` override was raised to `8.5.23` in PR #11 to close
  GHSA-fxqj-rqcc-2cmp and restore the gating production dependency audit; it is
  not a styling-toolchain feature upgrade.
- Remove the `undici8` override after E2B ships a release whose optional Undici
  8 dependency is `>=8.9.0`. Until then it intentionally replaces E2B's exact
  vulnerable `8.8.0` pin; removal requires a clean install, full suite, and
  `npm audit --omit=dev --audit-level=high` to remain green.

## Secure order of operations

1. Verify account-level two-factor enforcement now that the owner identity has
   enrolled. Do not enforce it before every future member has enrolled or
   access can be lost.
2. Keep staging on Workers Free while its CPU, bundle-size, cron, queue-volume,
   and retention limits pass. Workers Paid is an owner-approved launch upgrade,
   not a staging prerequisite; do not bypass billing or use a temporary preview
   account for staging data.
3. Keep both provisioned R2 buckets private; evidence is served only through
   the separate user-content Worker.
4. Choose a main HTTPS domain and a separate HTTPS user-content origin. The
   origins must not share application cookies. A workers.dev hostname is an
   acceptable temporary user-content origin.
5. Create the Clerk application with Google, GitHub, and email-code sign-in.
   Configure exact authorized parties and production origins; do not use a
   wildcard origin.
6. Clerk, Kimi, and E2B accounts exist. Kimi K3 is calibration-only while its
   API exposes only the moving `kimi-k3` ID; do not activate rankings until
   Moonshot exposes an immutable ID or another provider's pinned snapshot passes
   calibration. Pin the evaluator template/build hash only after its build.
7. Build the main application before deployment. Then run
   `npm run phase2:prepare-main -- staging` or `npm run phase2:prepare-main -- production`.
   This creates an environment-specific config from the built Worker, so staging
   cannot fall back to production D1, R2, or queues. Never deploy the unbuilt
   `worker/index.ts`; the standalone user-content Worker uses the named
   environments in `wrangler.usercontent.jsonc`.
8. Store server values with `wrangler secret put` (or the approved Cloudflare
   secret store). Public values may be configured as vars; secret values must
   never enter JSONC, `.env`, GitHub logs, queue payloads, or D1.
9. Generate a fresh 32-byte `PROVENANCE_ENCRYPTION_KEY` with a CSPRNG and store
   it as base64. Never reuse a development key in staging or production.
10. Apply migrations to staging, seed only non-secret catalog metadata, upload
   the calibration set to private R2, and run calibration before enabling
   submissions.

## Required values

`.env.example` is the complete naming contract. Before deployment, every blank
required value must have an owner-approved source. Exact HTTPS origins,
calibration hashes, judge model snapshots, E2B template IDs, and pricing values
must be recorded in the deployment change and never inferred at runtime.

## Preflight

From a clean checkout, run:

```powershell
npm ci
npm run phase2:preflight
npx tsc --noEmit
npm test
npm run phase2:prepare-main -- staging
npx wrangler deploy --dry-run --config dist/server/wrangler.staging.json --outdir .wrangler-dry-run/main
npx wrangler deploy --dry-run --config wrangler.usercontent.jsonc --env staging --outdir .wrangler-dry-run/usercontent
npm run phase2:prepare-main -- production
npx wrangler deploy --dry-run --config dist/server/wrangler.production.json --outdir .wrangler-dry-run/main-production
npx wrangler deploy --dry-run --config wrangler.usercontent.jsonc --env production --outdir .wrangler-dry-run/usercontent-production
```

**Migrations never use the generated deploy configs.** The
`dist/server/wrangler.<environment>.json` files exist only for `wrangler
deploy` (the generator strips `migrations_dir`, so migration commands against
them fail fast). Apply migrations exclusively through the source config with an
explicit environment:

```powershell
npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc --env staging
```

A green preflight proves configuration consistency only. It does not prove that
Cloudflare, Clerk, the judge provider, or E2B are safe to use until the staging
checks in `LAUNCH-PLAN.md` pass.
