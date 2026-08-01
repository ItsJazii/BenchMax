# Benchmax

Benchmax is a public hub for community-run AI model tests.

Contributors choose or create a test, declare the exact model version,
reasoning level, harness, and settings, then upload the result as code, images,
video, logs, or any supported combination. Safe submissions appear publicly
before scoring. The pinned Benchmax AI judge may take up to 24 hours to review
the evidence and publish an eligible per-test ranking.

Benchmax never calls the model being tested and never asks contributors for a
tested-model API key.

## Stack

- vinext/React on Cloudflare Workers
- D1 for tests, submissions, judge records, and immutable leaderboard snapshots
- R2 for quarantined evidence, evaluation artifacts, and backup manifests
- A separate cookieless Worker/origin for every public user-controlled byte
- Clerk for verified contributor accounts
- Cloudflare Queues for evaluation, judging, publication, retries, and DLQ
- E2B for optional no-network execution of compatible source bundles

## Local verification

```powershell
npm ci
npm ci --prefix sandbox/browser-web-v1
Push-Location sandbox/browser-web-v1
npx playwright install chromium ffmpeg
Pop-Location
$env:BENCHMAX_REQUIRE_EVALUATOR_SMOKE="1"
npm test
npx tsc --noEmit
npm run lint
npx wrangler deploy --dry-run --config dist/server/wrangler.json
npx wrangler deploy --dry-run --config wrangler.usercontent.jsonc
```

## Production setup

Copy `.env.example` into the encrypted runtime secret/config system; never
commit a filled environment file.

1. Configure Clerk and exact authorized HTTPS origins.
2. Create D1 and R2 resources and apply every migration in `drizzle/`.
3. Deploy `wrangler.usercontent.jsonc` on a distinct, cookieless HTTPS site
   (prefer a separate registrable domain, not a subdomain that can receive the
   application's domain cookies). Bind it read-only in practice to the same
   `benchmax-d1` database and `benchmax-uploads` bucket, set
   `BENCHMAX_APP_ORIGIN` to the exact application origin, and set
   `NEXT_PUBLIC_USERCONTENT_ORIGIN` on the main application to the Worker
   origin. The Worker must never share Clerk or application secrets.
4. Build the pinned E2B evaluator template and record its measured hash.
5. Upload the judge calibration set to private R2 and configure its SHA-256.
6. Configure and pin the AI judge provider, model snapshot, and HTTPS origin.
7. Set `BENCHMAX_JUDGE_DAILY_SAMPLE_BUDGET` from the measured calibration-set
   cost. Benchmax reserves at most five initial judged submissions per account
   per UTC day and leaves excess results public and pending.
8. Seed the metadata catalog. Model families include GPT, Claude, Gemini, Kimi,
   GLM, MiniMax, Qwen, and DeepSeek; this catalog is descriptive, not a launch
   restriction.

The exact judge snapshot must be chosen from current calibration results before
production leaderboards are enabled. Pricing or cost multiples are not
hard-coded; measure current providers against the calibration set when setting
budgets.

## Product invariants

- Every safe submitted result is public whether AI review is pending, delayed,
  ranked, or not ranked.
- Every result points to one immutable test version.
- Model, version, harness, reasoning, and settings are contributor-declared and
  labeled "declared, unverified"; catalog mapping standardizes names but does
  not prove which configuration produced the evidence.
- Benchmax cannot observe unsubmitted attempts, so best-of-N cherry-picking is
  possible. Rankings compare submitted evidence, not independently reproduced
  pass@1 model performance.
- Unknown model or harness labels create catalog-review requests; they do not
  block publication.
- Only canonical, safe, successfully judged results are ranking-eligible.
- Rankings are per test version and pinned evaluation version. Equal scores
  share rank.
- Initial judging uses one sample. Results entering the top ten are rechecked
  to three samples until the leaderboard reaches a fixpoint.
- Judge work is admitted through idempotent daily reservations. When the
  account or global daily capacity is exhausted, the result remains public and
  pending while its original 24-hour deadline continues.
- Submitted evidence is untrusted. Judge prompts are pinned, evidence is
  bounded and identity-blinded, and injection signals disqualify ranking.
- Public evidence is authorized from D1 and streamed from R2 only by the
  separate cookieless user-content Worker. The main application emits absolute
  user-content URLs; its compatibility artifact routes only redirect and never
  read or stream R2 objects. Private source and quarantined, blocked, removed,
  or unpublished evidence fail closed.
- No tested-model credentials exist in application state, logs, storage, or
  queue messages. The only provider credential is the operator-managed judge
  key.

## Operations

- `/operations` exposes owner-only queue, judge, dispute, report, and storage
  state.
- `/moderation` records written, append-only decisions.
- `docs/backup-restore.md` is the restore runbook.
