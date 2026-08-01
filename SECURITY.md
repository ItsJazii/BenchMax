# Security policy

BenchMax treats security as a release gate. Do not report a vulnerability in a
public issue, pull request, or chat thread. Use GitHub's private vulnerability
reporting or security-advisory flow for this repository when it is available.
If that flow is unavailable, contact the repository owner privately through
GitHub and include only the minimum reproducible details.

Never include API keys, Clerk tokens, judge credentials, E2B credentials,
Cloudflare secrets, private evidence, or database exports in a report.

## Non-negotiable invariants

- All changes land through a pull request with the full CI workflow green.
- Secrets are runtime-managed and never committed to source, `.env` files, logs,
  queue messages, or public responses.
- Private evidence and provenance remain behind D1 authorization and the
  separate cookieless user-content Worker.
- Uploads are bounded, scanned, and fail closed on type, size, traversal, ZIP,
  secret, SSRF, or authentication violations.
- D1 migrations, append-only audit records, frozen contracts, and ranking
  snapshots are verified before release.

## Response expectations

Reports are triaged privately. A fix must include a regression test where
practical, a short root-cause note, and a PR review focused on whether the fix
weakens any privacy, authorization, provenance, or immutability boundary.
