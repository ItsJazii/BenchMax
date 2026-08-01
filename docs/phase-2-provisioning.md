# Phase 2 provisioning and security handoff

Status: infrastructure foundation in progress, 2026-08-01.

This runbook records the external prerequisites for staging. It deliberately
does not contain credentials, tokens, private keys, or database exports.

## Current Cloudflare evidence

- Account access is available through the Cloudflare MCP.
- D1 `benchmax-d1` exists with ID
  `1b90635c-2906-472f-a0d1-242cbceee802`. The current API response reports
  `jurisdiction: null`; do not treat the database as APAC-specific until the
  Cloudflare account reports an explicit jurisdiction.
- Queues `benchmax-evaluate`, `benchmax-judge`, and
  `benchmax-pipeline-dlq` exist.
- R2 is not enabled yet, so `benchmax-uploads` cannot be created.
- No BenchMax Workers or custom domains exist yet.
- Account-level two-factor enforcement is currently off.

## Secure order of operations

1. The account owner enables two-factor authentication on their own Cloudflare
   identity first, then enables account-level enforcement. Do not enforce it
   before every member has enrolled or access can be lost.
2. Enable R2 and the Workers Paid capability in the Cloudflare Dashboard. Do
   not bypass billing or use a temporary preview account for staging data.
3. Create the private `benchmax-uploads` bucket. Keep public access disabled;
   evidence is served only through the separate user-content Worker.
4. Choose a main HTTPS domain and a separate HTTPS user-content origin. The
   origins must not share application cookies. A workers.dev hostname is an
   acceptable temporary user-content origin.
5. Create the Clerk application with Google, GitHub, and email-code sign-in.
   Configure exact authorized parties and production origins; do not use a
   wildcard origin.
6. Create the judge-provider and E2B accounts. Pin an immutable judge snapshot
   and evaluator template/build hash only after calibration.
7. Build the main application before deployment. Vinext emits the built main
   Worker at `dist/server/wrangler.json`; select its staging or production
   Worker with `--name` rather than deploying the unbuilt `worker/index.ts`.
   The standalone user-content Worker uses the named environments in
   `wrangler.usercontent.jsonc`.
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
npx wrangler deploy --dry-run --config dist/server/wrangler.json --name benchmax-staging --outdir .wrangler-dry-run/main
npx wrangler deploy --dry-run --config wrangler.usercontent.jsonc --env staging --outdir .wrangler-dry-run/usercontent
```

A green preflight proves configuration consistency only. It does not prove that
Cloudflare, Clerk, the judge provider, or E2B are safe to use until the staging
checks in `LAUNCH-PLAN.md` pass.
