# BenchMax v1 — Public AI Test Feed

BenchMax is a simple public site where people share AI tests and their outputs.

Anyone can browse every submitted test. A user logs in only when they want to
submit one. Each submission clearly shows the prompt, model, harness, reasoning,
output/evidence, and contributor. Review and leaderboards are important, but they
are a later layer and must never block the core public test feed.

## 1. Product in one sentence

> Submit an AI test with the prompt, setup, and output; let everyone inspect it;
> then let AI and trusted humans review and rank it later.

## 2. Product principles

1. **Browse first.** No login is required to see tests, outputs, contributors,
   models, or leaderboards.
2. **One simple submission.** A user does not create a reusable test and then a
   separate result. One form creates one public test submission.
3. **Attribution is always visible.** Every test shows who submitted it and which
   model, harness, and reasoning setting they declared.
4. **Publish before ranking.** A safe test can be public while it is waiting for
   review. AI-judge availability is not a launch blocker.
5. **Leaderboard is the end game.** Reviews and rankings add value later; the
   public All Tests page is useful from day one.
6. **Be honest.** Model and setup details are contributor-declared, not verified
   by BenchMax, unless a reviewer explicitly verifies something.

## 3. The core object: a Test

The public product calls every submission a **Test**. Internally it may be stored
as a submission or result, but users should not need to understand that.

Every Test contains:

- Contributor/user
- Optional title
- Prompt
- Model family and model version
- Harness/tool, such as Cursor, Claude Code, Codex, Cline, aider, or custom
- Reasoning level or reasoning description
- Optional settings and notes
- Output/evidence: images, video, source ZIP, logs, text, or a supported combination
- Submission date
- Review status
- Reviews, score, and leaderboard rank when available

Free-text model and harness names are allowed. Catalog normalization may improve
filtering later, but an unknown label must not stop a safe Test from publishing.
Supporting this is a real Phase 1 data-model/API change: the current catalog-keyed
schema must accept and preserve the contributor's declared free-text values while
optionally linking normalized catalog entries later.

## 4. Main user flow

### Visitor

1. Visit BenchMax.
2. Land on **All Tests**.
3. Browse or filter tests by model, harness, contributor, status, or category.
4. Open a Test page to see its prompt, declared setup, evidence, contributor,
   review status, reviews, score, and rank.
5. Optionally open model pages, contributor profiles, or the leaderboard.

### Contributor

1. Log in.
2. Open **Submit Test**.
3. Enter the prompt, model, harness, and reasoning; optionally add a title,
   settings, and notes.
4. Upload the actual output/evidence.
5. Submit.
6. BenchMax performs the required safety scan.
7. If safe, the Test appears publicly under that contributor as
   **Awaiting review**.
8. For compatible source ZIPs, the sandbox evaluator runs afterward as
   non-blocking enrichment and attaches derived screenshots, video, console,
   and accessibility evidence when available.
9. Reviews and leaderboard placement are added later without changing the
   original submission.

There is no separate test-creation flow, rubric-approval gate, or active-judge
requirement before a Test can appear publicly.

## 5. Public pages

### Required for the simple product

- `/` or `/tests` — **All Tests**, the main product page
- `/tests/[slug]` — one complete Test and its evidence/reviews
- `/submit` — one submission form, login required
- `/contributors/[handle]` — everything submitted by one user
- `/models` and `/models/[slug]` — tests grouped by declared model
- `/leaderboards` — ranked reviewed tests; during Stage A it may show an honest
  empty state explaining that reviews and rankings are coming later
- `/dashboard` — the signed-in user's submissions and statuses

### Admin pages

- `/moderation` — blocked/flagged tests and abuse reports
- `/operations` — review queue, system health, and judge spend

Explore, Compare, and other discovery pages are optional polish. They must not
delay the All Tests experience.

## 6. Test statuses

Users should see one plain status:

- **Processing** — evidence is being scanned
- **Awaiting review** — public and safe, but not scored yet
- **Reviewed** — has one or more AI/human reviews
- **Ranked** — eligible and included in a leaderboard
- **Blocked** — hidden because of a safety or moderation issue

Do not expose the full internal queue/state-machine vocabulary in the main UI.

If upload or mandatory safety processing fails before publication, the Test stays
private and the contributor sees **Processing failed** in their dashboard with a
retry path. If optional sandbox enrichment fails, the public Test remains
**Awaiting review** and shows **Automated preview unavailable**; the technical
failure details remain private to the contributor/admin.

## 7. Review and leaderboard layer

Review is additive. It does not control whether a safe Test exists publicly.

Reviewers may include:

- BenchMax AI judge
- Admin/owner
- Approved human reviewers or moderators

Every review records who or what reviewed the Test, when it happened, its score,
and its written reasoning. Reviews are append-only; corrections create another
review or an explicit moderation action.

The main leaderboard is a **top-rated submissions showcase across different
prompts**, not a scientific like-for-like benchmark. The exact scoring and
consensus policy can be chosen after the public feed works. The first simple policy
may be one AI review plus one trusted human/admin approval. Only reviewed, eligible
Tests enter leaderboards.

Later, a contributor may choose **Use the same prompt as this Test** to create
comparable prompt groups without bringing back the separate reusable-test/result
creation flow. Those groups may support like-for-like leaderboards as a distinct
view.

Leaderboards should support useful filters such as model, harness, category,
contributor, and date. A Test that is not ranked remains visible on All Tests.

## 8. Safety and trust

Keep the security infrastructure already built:

- Verified account required to submit
- Upload quarantine and type/signature validation
- ZIP traversal, executable, secret, and zip-bomb rejection
- Private R2 storage and separate cookieless user-content delivery
- Prompt-injection screening
- Moderation and abuse reporting
- Append-only audit records
- Rate limits and storage quotas

Contributor-declared model, harness, reasoning, and settings must be labeled
**Declared by contributor — not independently verified**.

BenchMax never needs the tested model's API key and does not generate the tested
output. The contributor runs the model elsewhere and uploads the result.

## 9. Simple launch scope

### Stage A — Public Tests product

Launch when all of these work:

- Anyone can browse All Tests without logging in
- A user can log in and submit one complete Test
- Prompt, model, harness, reasoning, evidence, and contributor are visible
- Safe submissions become public as Awaiting review
- Compatible source ZIPs receive sandbox-generated preview evidence asynchronously;
  enrichment failure never removes an otherwise safe public Test
- Contributor and model pages list the correct Tests
- Admin can block or remove unsafe submissions
- Mobile and keyboard use are acceptable

An AI judge, final scoring formula, and populated leaderboard are not required
to launch this stage.

### Stage B — Reviews and leaderboards

Add after the public feed is stable:

- AI judge reviews
- Admin and approved-human reviews
- Review history on Test pages
- Final score/consensus policy
- Leaderboard eligibility and ranking
- Disputes and re-review

### Stage C — Growth polish

- Better search and filters
- Compare view
- More model/harness normalization
- Reviewer reputation or permissions
- Better leaderboard slices and trends
- Optional same-prompt comparison groups

## 10. What is explicitly out of scope for v1

- Separate reusable Test definitions and Test Results
- Mandatory AI-generated rubrics before submission
- Blocking publication until an immutable AI judge is active
- BenchMax-funded model generation
- Tested-model API keys or BYOK
- Payments
- Comments and voting
- Reproducing or verifying every contributor's model run

## 11. Build strategy

Reuse the working authentication, uploads, evidence security, user-content Worker,
moderation, audit, model pages, contributor pages, and queue infrastructure.

Simplify the product surface around **All Tests → Submit Test → Test page** before
adding or repairing anything related to judge calibration or advanced ranking.
The code may keep some internal result terminology during the transition, but the
public experience and product copy must use this simple Test model.
