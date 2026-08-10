# BenchMax simple-product launch plan

This launch plan implements `PLAN.md`. The public All Tests product comes first.
AI judging and leaderboards come after the feed and submission flow work.

## Current position

The repository already contains substantial infrastructure: authentication,
uploads, safety scanning, public evidence delivery, model/contributor pages,
moderation, queues, judging, ranking, audits, and staging resources.

The product surface is currently more complicated than the new plan. The next job
is simplification, not more infrastructure or judge work.

## Phase 1 — Simplify the product

1. Make `/tests` the primary All Tests feed and make it useful when no item has a
   score yet.
2. Collapse the current create-test/result workflow into one **Submit Test** form.
3. Require: prompt, model, harness, reasoning, and output/evidence.
4. Change the current catalog-keyed model/harness schema and APIs to preserve
   contributor-declared free-text values, with optional catalog normalization later.
   Treat this as a data-model change, not a copy or UI-only task.
5. Keep compatible source-ZIP sandbox evaluation as asynchronous enrichment: publish
   after the mandatory safety scan, then attach generated preview/accessibility
   evidence when evaluation finishes. Enrichment failure must not unpublish the Test.
6. Show contributor attribution and declared-model/setup caveats everywhere.
7. Make one Test page show the complete submission and later reviews.
8. Use the simple public statuses: Processing, Awaiting review, Reviewed, Ranked,
   and Blocked.
9. Keep mandatory processing failures private to the contributor dashboard with a
   retry path; show optional enrichment failure publicly only as
   **Automated preview unavailable**.
10. Remove or hide rubric approval, immutable test-version, and active-judge gates
   from the contributor flow.
11. Keep `/leaderboards` reachable with an honest empty state until reviewed Tests
    exist.

**Exit:** a visitor can browse Tests and a logged-in user can submit one complete
Test without understanding BenchMax's internal pipeline.

## Phase 2 — Validate the public feed on staging

1. Submit image, video, source ZIP, and mixed-evidence Tests.
2. Confirm safe submissions become public as Awaiting review.
3. Confirm compatible source ZIPs publish before optional evaluator enrichment,
   derived artifacts attach later, and evaluator failure leaves the Test public.
4. Confirm mandatory processing failures stay private with a retry path.
5. Confirm unsafe submissions remain blocked/private.
6. Verify All Tests, Test detail, model, contributor, dashboard, and moderation
   pages on desktop and mobile.
7. Verify Google, GitHub, and email-code login.
8. Repeat public leak, private-source, secret, accessibility, queue, and DLQ checks.

**Exit:** the no-score public product is safe, understandable, and usable.

## Phase 3 — Public beta

1. Deploy production with submissions initially disabled.
2. Apply migrations and verify the production resource isolation.
3. Smoke-test authentication and evidence delivery on the real domain.
4. Add 10–20 honest seed Tests so the feed is not empty.
5. Enable submissions and monitor moderation, storage, queues, and abuse.

**Exit:** strangers can browse and submit Tests; safe Tests appear publicly under
the correct model and contributor.

## Phase 4 — Add reviews

1. Define the smallest review schema and UI shared by AI and humans.
2. Let the owner/admin review and score a Test.
3. Add approved human reviewers.
4. Select and calibrate an immutable AI judge snapshot.
5. Display append-only review history and reviewer identity/type.
6. Define the minimum review policy for leaderboard eligibility.

**Exit:** a Test can receive trustworthy AI/human reviews without changing its
original submitted evidence.

## Phase 5 — Leaderboards

1. Calculate a final score from the approved review policy.
2. Rank eligible Tests as a top-rated submissions showcase across prompts; do not
   describe it as a like-for-like benchmark.
3. Add model, harness, category, contributor, and date filters.
4. Keep unreviewed/unranked Tests visible in All Tests.
5. Add disputes and re-review only after the basic ranking works.
6. Consider optional same-prompt comparison groups later as a separate leaderboard
   view.

**Exit:** reviewed Tests enter a useful leaderboard while All Tests remains the
main product.

## Confirmed Phase 1 decisions

- Required form fields are prompt, model, harness, reasoning, and output/evidence.
- Title and notes are optional.
- Safe Tests publish immediately as Awaiting review after the mandatory safety scan.

## Decisions still needed from the owner

### Needed before public beta

- Seed Tests and outputs
- Final Terms/Privacy review
- Abuse/contact email
- Submission rate limit

### Needed later, not now

- AI judge provider and immutable snapshot
- Human reviewer invitations
- Scoring/consensus formula
- Leaderboard eligibility rules

## Immediate next step

Audit the current routes and data model against this approved plan, then prepare a
focused Phase 1 implementation plan. Do not deploy or redesign judging before the
All Tests and Submit Test experience is simplified.
