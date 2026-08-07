# Benchmax — launch plan (2026-08-01)

Everything between the current state and a publicly launched product, in order.
Owner tags: **[Codex]** implements, **[Claude]** reviews/verifies, **[You]** are the
only one who can do accounts, payments, domains, and product decisions.
Reference docs: PLAN.md (product spec); open code items and session state live in
the local (untracked) handoff.md.

---

## Phase 0 — Finish the code (complete 2026-08-01)

1. **[Codex]** Round-3.1 and Round-3.2 code residuals are implemented, including
   migration metadata, frozen-evaluation guards, durable repair backoff, the legacy
   seal, catalog invariants, and the public-surface/CI hygiene pass.
2. **[Codex]** The three curated commits (schema/catalogs/retirement · pipeline ·
   UI/docs/deploy) and the bounded residual follow-up are on
   `codex/community-results-pivot`.
3. **[Claude]** Verification is green on the committed code: typecheck, lint, full
   tests, D1 invariants, rendered HTML, and deployment dry-runs.
4. **[You]** One product decision, needed before beta: the submission-vs-judging cap
   ratio (today: 20 publishes/day but 5 judged/day per account — either lower the
   publish cap or accept a visible "pending review" queue by design).

**Exit criteria:** clean worktree, curated commits plus the residual follow-up, and
full suite + typecheck + lint + dry-runs green. Remaining work is staging validation,
the cap decision, and the explicitly deferred launch polish listed below.

## Phase 1 — Repo safety (complete 2026-08-01)

1. **[Codex]** Private GitHub repo `ItsJazii/BenchMax` contains the complete project
   tree on both `main` and `codex/community-results-pivot`; the starter commit was
   preserved as merge history.
2. **[Codex/Claude]** The clean-checkout CI workflow passed on GitHub with the
   mandatory evaluator-smoke flag (run `30710201657`).
3. **[Codex/You]** From Phase 2 onward, all code/config changes use focused PRs.
   GitHub rejected branch protection for this private repository's current plan, so
   `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS`, CI, and human approval are the
   active PR safety controls until repository settings support required checks.

**Exit criteria:** code on GitHub, CI green on a machine that isn't yours.

## Phase 2 — Accounts and services (in progress 2026-08-05; mostly [You])

1. **[Devin/You]** Replacement Cloudflare account access is confirmed through
   Wrangler OAuth and the Workers Bindings MCP. Production and staging D1,
   their six disjoint queues, and private R2 buckets `benchmax-uploads` and
   `benchmax-uploads-staging` are provisioned. The owner login has 2FA; verify
   account-level enforcement. Staging deliberately starts on Workers Free in
   attended mode, with the DLQ checked after every lifecycle batch and at least
   every 12 hours. A Paid upgrade is deferred until measured CPU, bundle-size,
   queue-volume, retention, or unattended-operation needs require owner-approved
   billing.
2. **[You]** Domain(s): one main domain (e.g. benchmax.dev) and one SEPARATE domain
   or distinct registrable origin for user content (cookieless isolation per PLAN §3;
   a `*.workers.dev` subdomain is acceptable for the usercontent origin at launch).
3. **[You]** Clerk app (free tier): enable Google, GitHub, email-code; add production
   domain; collect publishable + secret keys.
4. **[You]** Anthropic API key (judge). **[You + Claude]** near launch: compare
   current Sonnet-class snapshots on the calibration set, pin the winner
   (recommendation: current Sonnet snapshot; never an alias).
5. **[You]** E2B account; **[Codex]** build `sandbox/browser-web-v1` as a template,
   record immutable template ID + build hash.
6. **[Devin]** Keep the provisioned buckets private, deploy both Workers with
   isolated staging/production environments, attach only the selected HTTPS
   origins, and configure the disjoint queue consumers/crons. All secrets go via
   `wrangler secret put` (Clerk, judge key/origin/model, provenance key, calibration
   hash/key, owner subjects) — never in files.

**Exit criteria:** all prerequisites in PLAN §8.2 exist; `.env.example` fully
mappable to real secrets.

## Phase 3 — Staging validation (PLAN §8.2; ~1–2 days)

1. **[Codex]** Deploy both workers to staging (workers.dev), apply migrations 0000→
   latest, seed metadata catalogs via the owner endpoint.
2. **[Codex]** Upload calibration fixtures to private R2; activate the evaluation
   version; run calibration — must pass with the pinned snapshot.
3. **[Claude]** Measure real judge cost per result on the calibration set; set the
   global daily judge budget and per-account caps from measurement (PLAN §7 says
   caps come from measurement, not estimates).
4. **[You + Codex]** Full synthetic lifecycle on staging, all three evidence types
   (image, video, source-zip): create test → rubric draft → approve → submit →
   scan → public-pending → judged → ranked. Plus: unknown model → catalog request →
   admin approve → becomes ranked; a dispute → re-judge; a safety-blocked upload
   (stays private, owner sees reason); an overdue simulation.
5. **[Claude]** Review staging behavior against PLAN §9 release gates; browser pass
   on mobile viewport + keyboard accessibility; verify no secret/private-source/
   judge-trace leaks in any public payload.

**Exit criteria:** every PLAN §9 release gate demonstrably passes on staging.

## Phase 4 — Production rollout (PLAN §8.2 order; ~half a day)

1. **[Codex]** Back up staging-verified state; capture D1 export + Time Travel
   bookmark procedure per docs/backup-restore.md.
2. **[Codex]** Deploy production with **submissions disabled** → apply migrations →
   seed catalogs → activate judge/evaluation version → verify calibration in prod.
3. **[You]** Smoke-test signup with all three auth methods on the real domain.
4. **[Codex]** Enable submissions. Watch `/operations`: queue age, overdue count,
   error rates, judge spend.
5. **[Codex]** After the first real results judge cleanly: enable leaderboard
   publication.

**Exit criteria:** a stranger can sign up, submit, get judged, and appear ranked.

## Phase 5 — Launch content (before announcing; ~1–2 days, mostly [You])

An empty community site launches dead. Before telling anyone:

1. **[You]** Create 6–10 good seed tests across the categories (frontend, browser
   game, browser 3D, other) — real prompts you'd actually want models compared on.
   Approve their rubrics carefully; they're immutable per version and they set the
   site's quality bar.
2. **[You]** Submit 3–5 honest seed results per popular test (your own runs of
   different models, correctly declared) so leaderboards and Explore aren't empty.
3. **[You]** Review ToS/privacy pages content (they exist; make sure you're happy
   putting your name behind them) and set a real DMCA/abuse contact address.
4. **[Claude]** Final copy pass: methodology page accuracy (declared-provenance
   caveats, judge identity, cost/caps), OG images, 404s, mobile nav.
5. **[You]** Optional: invite 1–2 trusted moderators (owner can grant roles).

**Exit criteria:** site looks alive and trustworthy to a first-time visitor.

## Phase 6 — Launch and operate

1. **[You]** Announce wherever your audience is (X, HN Show, Reddit r/LocalLLaMA
   etc.). Lead with the honest pitch: community evidence, AI-judged, per-test
   leaderboards, provenance declared-not-verified.
2. Operating rhythm: **[You/moderators]** clear the moderation queue (injection
   flags, catalog requests, disputes) — catalog requests are the growth bottleneck,
   keep them under ~24h; **[Claude]** periodic health reviews (`/operations` spend,
   overdue trends, DLQ, calibration drift alerts).
3. **[Codex]** Weekly backups per runbook; dependency updates only with green suite.
4. First-month iteration candidates (deliberately NOT in v1): submission-cap tuning
   from real data, more seeded catalogs, evidence-verified tier, richer compare
   views, build-step execution.

---

## Decisions only you can make (collect them here)

| Decision | Needed by | Recommendation |
|---|---|---|
| Submission vs judging cap ratio | Phase 0 exit | Lower publishes to ~8/day at launch |
| Domain name(s) | Phase 2 | One .dev/.com + workers.dev for usercontent |
| Workers Paid upgrade | Phase 3–4 | Stay Free for staging; upgrade only if measured limits block reliability |
| Judge snapshot to pin | Phase 3 | Current Sonnet snapshot, chosen via calibration set |
| Budget caps (from measurement) | Phase 3 | Set from calibration cost × expected volume |
| Seed tests + rubrics | Phase 5 | 6–10, you author them |
| Moderators | Phase 5–6 | Optional at launch |

## Cost picture

Prelaunch Cloudflare infrastructure stays within Workers, Queues, and R2 free
allowances while staging measurements pass. Public-launch fixed cost may become
~$5–10/mo after an owner-approved Workers Paid upgrade plus domain amortization;
variable judge spend is measured in Phase 3 and capped by budget. Sandbox time is
pennies. No generation costs, no BYOK — the judge key is the only provider credential.
