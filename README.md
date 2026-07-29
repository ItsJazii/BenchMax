# Benchmax

Benchmax is an evidence-first community model-testing hub. Community Test
Reports are publicly inspectable but never ranked. Official leaderboard rows
come only from platform-generated pass@1 runs executed and judged under frozen,
versioned contracts.

`PLAN.md` is the product and security source of truth.

## Stack

- Next-compatible React app via vinext on Cloudflare Workers
- D1 for structured and append-only records
- R2 for quarantined uploads, generated source, evaluation artifacts, encrypted
  provenance, and backup manifests
- Clerk for Google, GitHub, and email-code authentication
- Cloudflare Durable Objects for memory-only BYOK generation
- Cloudflare Queues for platform generation, evaluation, judging, publication,
  retries, and DLQ handling
- E2B for secure, no-internet browser execution

The playable-output Worker is separate: `wrangler.usercontent.jsonc`. It must
run on a cookieless origin distinct from the main app.

## Local verification

```powershell
npm install
npx wrangler d1 migrations apply site-creator-d1 --local --persist-to .\.wrangler\state
npm test
npx tsc --noEmit
npx wrangler deploy --dry-run
npx wrangler deploy --dry-run --config wrangler.usercontent.jsonc
```

`npm audit --omit=dev` must report zero production vulnerabilities before a
release. Development-only findings are reviewed separately because Wrangler,
the bundler, and lint tooling are not shipped as runtime dependencies.

## Required production setup

Copy `.env.example` into the encrypted secret/config system; never commit a
filled environment file.

1. Create Clerk Google, GitHub, and email-code sign-in and configure the exact
   HTTPS origins in `CLERK_AUTHORIZED_PARTIES`.
2. Build `sandbox/browser-web-v1` as an E2B template. Put the immutable returned
   template ID in `E2B_TEMPLATE_ID`; it becomes part of every environment hash.
3. Upload a small calibration JSON document shaped like
   `examples/calibration-set.example.json` to private R2, then configure its
   exact object key and SHA-256.
4. Set a 32-byte base64 provenance encryption key as an encrypted Worker secret.
5. Configure the pinned judge and, if platform credits are enabled, the
   Moonshot platform key as encrypted Worker secrets.
6. Deploy the main Worker and user-content Worker on separate HTTPS origins.
   Set both origins explicitly. Never use a wildcard authorized party.
7. Call the owner-only catalog seed endpoint once after every dependency is
   present. It fails closed if any frozen value is absent.

## Security invariants

- BYOK keys exist only in one live Durable Object generation job and are never
  written to D1, R2, logs, analytics, or a queue.
- Browser uploads land in quarantine and cannot publish until MIME, magic bytes,
  path traversal, expansion ratio, executable, and secret checks pass.
- Generated content never executes on the main origin.
- Queue stages use D1 compare-and-swap leases, immutable outputs, bounded
  retries, and DLQ routing.
- Judge outputs use a pinned prompt/model, three samples, per-dimension medians,
  injection screening, source blinding, and scheduled drift calibration.
- Rankings aggregate exact configurations over all platform runs; benchmark
  medians, N, IQR, coverage, dates, and provisional state remain visible.
- Credits are admin-granted only. There is no payment or purchase path.

## Operations

- `/operations` is owner-only and exposes pipeline, judge, spend, dispute,
  report, and bounded R2 inventory state.
- `/moderation` is owner/moderator-only and requires a written, append-only
  reason for decisions.
- `docs/backup-restore.md` is the restore runbook.
- `npm run load:leaderboards` only accepts an explicit localhost target through
  `BENCHMAX_LOAD_TARGET`; remote load generation is disabled by construction.
