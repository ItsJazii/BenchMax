# Benchmax backup and restore runbook

The owner-only backup endpoint writes a content-hashed R2 inventory and D1
table-count manifest under `private/backups/manifests/`. It is an integrity
index, not a substitute for a database backup.

Before a production migration, an operator must also capture an authenticated
D1 export with Wrangler and retain the Cloudflare D1 Time Travel bookmark. R2
object versioning or bucket replication should be enabled in the Cloudflare
account. Restore is performed into a new D1 database and R2 bucket first,
validated against the manifest, then bindings are switched during a controlled
maintenance window. Never restore over the live bindings.

Required restore checks:

1. Apply schema migrations to the new D1 database.
2. Import the D1 export and compare every table count to the manifest.
3. Restore R2 objects and compare prefix counts, bytes, and content hashes.
4. Confirm private provenance objects remain private and encrypted.
5. Run the acceptance suite against the replacement bindings.
6. Switch bindings only after owner approval; retain the old resources for
   rollback.
