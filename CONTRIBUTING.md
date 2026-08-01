# Contributing to BenchMax

BenchMax is developed through pull requests. Do not push feature or fix commits
directly to `main`.

1. Create a focused `codex/...` branch from `main`.
2. Keep the change set narrow and explain the security impact in the PR body.
3. Run the relevant focused tests, then the complete local gate:
   `npm test`, `npx tsc --noEmit`, `npm run lint`,
   `npm run phase2:preflight`, `npm run phase2:prepare-main -- staging`, both
   Worker dry-runs, and `npm audit --omit=dev --audit-level=high`.
4. Open a draft PR first. Promote it only after the diff, security boundaries,
   and CI results have been reviewed.
5. Never commit secrets, filled environment files, private evidence, database
   exports, generated local state, or credentials copied from a dashboard.

Security-sensitive changes must identify the protected asset, the trust boundary
being changed, and the regression test that proves the boundary still holds.
See [SECURITY.md](SECURITY.md) for private reporting instructions.
