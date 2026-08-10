# BenchMax

BenchMax is a public feed for community-run AI Tests.

Anyone can browse every Test. A contributor signs in only to submit one prompt,
the declared model/version, harness, reasoning, and the resulting output or
evidence. Title, settings, and notes are optional. After the mandatory safety
scan passes, the Test appears publicly as **Awaiting review** under its contributor
and declared model.

AI and trusted-human reviews are additive later layers; they do not gate a safe
Test from the public feed. Reviewed Tests may eventually enter a top-rated
submissions leaderboard across prompts. That leaderboard is a showcase, not a
scientific like-for-like benchmark.

BenchMax never calls the model being tested and never asks contributors for a
tested-model API key.

## Stack

- vinext/React on Cloudflare Workers
- D1 for tests, submissions, judge records, and immutable leaderboard snapshots
- R2 for quarantined evidence, evaluation artifacts, and backup manifests
- A separate cookieless Worker/origin for every public user-controlled byte
- Clerk for verified contributor accounts
- Cloudflare Queues for upload processing, optional evaluation, later judging,
  retries, and DLQ
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
npm run phase2:prepare-main -- staging
npx wrangler deploy --dry-run --config dist/server/wrangler.staging.json
npx wrangler deploy --dry-run --config wrangler.usercontent.jsonc --env staging
```

## Production setup

Copy `.env.example` into the encrypted runtime secret/config system; never
commit a filled environment file.

1. Configure Clerk and exact authorized HTTPS origins.
2. Create D1 and R2 resources and apply every migration in `drizzle/`.
3. Build the main application, then prepare and deploy the environment-specific
   generated config with `npm run phase2:prepare-main -- staging` or
   `npm run phase2:prepare-main -- production`. Deploy
   `wrangler.usercontent.jsonc` with `--env staging` or `--env production` on a
   distinct, cookieless HTTPS site
   (prefer a separate registrable domain, not a subdomain that can receive the
   application's domain cookies). Bind it read-only in practice to the same
   `benchmax-d1` database and `benchmax-uploads` bucket, set
   `BENCHMAX_APP_ORIGIN` to the exact application origin, and set
   `NEXT_PUBLIC_USERCONTENT_ORIGIN` on the main application to the Worker
   origin. The Worker must never share Clerk or application secrets.
4. Build the pinned E2B evaluator template and record its measured hash. Compatible
   source ZIP evaluation is optional, asynchronous enrichment and must never delay
   or remove an otherwise safe public Test.
5. Seed the metadata catalog. Model families include GPT, Claude, Gemini, Kimi,
   GLM, MiniMax, Qwen, and DeepSeek; this catalog is descriptive, not a launch
   restriction.

AI reviews and leaderboards are a later rollout stage. Before enabling them,
upload the calibration set to private R2, configure its SHA-256, calibrate an exact
immutable judge snapshot, and set `BENCHMAX_JUDGE_DAILY_SAMPLE_BUDGET` from measured
cost. Pricing or cost multiples are not hard-coded.

## Product invariants

- Every safe Test is public as Awaiting review after mandatory safety processing;
  AI-judge availability is not a publication or launch gate.
- One submission creates one public Test containing its prompt, declared setup,
  output/evidence, and contributor. There is no contributor-facing reusable-test
  definition or rubric-approval step.
- Prompt, model/version, harness, reasoning, and output/evidence are required.
  Title, settings, and notes are optional.
- Model, version, harness, reasoning, and settings are contributor-declared and
  labeled "Declared by contributor — not independently verified". Optional catalog
  mapping standardizes names but does not prove which configuration produced the
  evidence.
- BenchMax cannot observe unsubmitted attempts, so best-of-N cherry-picking is
  possible. Reviews assess submitted evidence, not independently reproduced pass@1
  model performance.
- Free-text model and harness labels do not block publication; catalog linking may
  normalize them later.
- Mandatory upload or safety-processing failure keeps the Test private and gives
  the contributor a retry path.
- Compatible source ZIP evaluation runs after publication as non-blocking
  enrichment. Failure leaves the Test public and shows **Automated preview
  unavailable** without exposing technical details publicly.
- AI, admin, and approved-human reviews are append-only additions to the original
  submission. Only reviewed, eligible Tests may enter a leaderboard.
- The main leaderboard is a top-rated submissions showcase across different
  prompts, not a like-for-like benchmark. Same-prompt comparison groups may be a
  separate later view.
- Submitted evidence is untrusted. When AI review is enabled, judge prompts are
  pinned and evidence is bounded and identity-blinded. Injection signals enter
  moderation before any ranking decision.
- Public evidence is authorized from D1 and streamed from R2 only by the
  separate cookieless user-content Worker. The main application emits absolute
  user-content URLs; its compatibility artifact routes only redirect and never
  read or stream R2 objects. Private source and quarantined, blocked, removed,
  or unpublished evidence fail closed.
- No tested-model credentials exist in application state, logs, storage, or
  queue messages. A later AI-review stage may use only an operator-managed judge
  key.

## Operations

- `/operations` exposes owner-only queue, judge, dispute, report, and storage
  state.
- `/moderation` records written, append-only decisions.
- `docs/backup-restore.md` is the restore runbook.
