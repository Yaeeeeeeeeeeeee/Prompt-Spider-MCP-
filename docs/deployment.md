Latest actual deployment and safe rollback version: [production report](production-deployment-2026-11-11.md). The original preparation instructions below remain reusable.

# Independent remote MCP deployment

The new service is **prompt-spider-mcp**, with HTTPS Streamable HTTP at `/mcp`. The existing **prompt-spider-api** service is backed up and is never deployed or rolled back by this runner. Both use the existing **prompt-spider-db**, binding `DB`. The original `events` table is retained. No database ID is invented or committed.

Install locked dependencies with `npm ci`. Supply credentials through the process environment, never shell arguments or Git: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, the real `SPIDER_D1_DATABASE_ID`, `SPIDER_D1_DATABASE_NAME=prompt-spider-db`, independent `MCP_AUTH_TOKEN`, and independent `SPIDER_READ_TOKEN` for the dashboard. Optional source ingestion credentials `SPIDER_WINDOWS_TOKEN` and `SPIDER_CLOUD_TOKEN` must be supplied together and remain independent. The legacy `SPIDER_INGEST_TOKEN` is never uploaded to the new Worker. Any supplied `SPIDER_*_TOKEN` must differ from the MCP token. The deploy script requires the fixed new Worker name; do not set the legacy Worker name.

Optional OAuth additionally requires an independent `MCP_OAUTH_APPROVAL_TOKEN` of at least 32 characters, exact HTTPS `MCP_OAUTH_ORIGIN` without a trailing slash, and `MCP_OAUTH_REDIRECT_URIS` containing a JSON array of exact HTTPS callbacks. Wildcards are rejected. Do not enable OAuth without the real client's verified callback list. Approval credentials are server secrets, never client configuration.

Run from the checkout:

```sh
python3 scripts/cloud.py preflight
python3 scripts/cloud.py backup --backup-dir /tmp/private-spider-backup-UNIQUE
python3 scripts/cloud.py deploy --backup-dir /tmp/private-spider-backup-UNIQUE
```

Choose a new private directory outside the repository. Backup downloads the legacy Worker content, settings, deployment and version metadata, database schema and full D1 SQL export, and records original events count/hash. It also records the new Worker's previous deployment if one exists. The SQL export is restored in an isolated in-memory SQLite connection with ATTACH/DETACH, extension loading, filesystem functions and unsafe pragmas denied. PRAGMA integrity_check must return ok and every original events row must match its captured count/hash. Restored schema, integrity results and migration checksums are recorded in the manifest and reverified before deployment. Files are mode 0600, directory 0700, with integrity hashes. Retain this private directory in approved encrypted storage. The manifest does not assert that encrypted Worker secret values were recovered: Cloudflare does not return secret plaintext. Keep independently managed credentials available.

Preflight, backup and deploy inspect the actual database: the original events table must retain request_id/event/project/received_at. Expected new table columns, declared types, NOT NULL and primary-key positions are derived by applying the audited migrations in memory; any existing conflicting table/view is rejected before remote writes. Existing compatible tables and repeated migrations are accepted. Deployment fails closed on missing backups, file tampering, different targets, schema drift, changed migration SQL since the backup snapshot, or changed original rows. Before any remote mutation it runs npm run build, npm test, npm run test:python and the deployment Python tests with checked exit status. Generated assets therefore exist before Wrangler bundles the SDK. The production config uses compatibility date 2026-06-01 and nodejs_compat, matching local configuration. It applies only `0001_v1.sql`, `0002_mcp.sql`, `0003_oauth.sql`, restricted to additive CREATE TABLE/INDEX IF NOT EXISTS statements, with checksums written privately before execution. It verifies the old records again after migration and deployment. Schedule a quiet window because legitimate legacy writes change this fingerprint and deliberately stop deployment. Do not rerun a partial operation blindly: inspect private state and create a fresh verified backup. Cloudflare API atomicity does not span schema, code and secrets; the Worker rejects missing authentication during that interval.

After deployment set `MCP_SMOKE_URL=https://REAL-HOST/mcp`, supply the same MCP token and all old reader/source tokens to test cross-role rejection, then run `node scripts/smoke.mjs`. This writes clearly SIMULATED Windows/cloud sessions, initializes the SDK transport, checks 11 tools/resources, reads the guide, creates sessions with context, updates/retries a stable event, compares counts, gets/completes sessions, seeks playback, downloads replay, imports replay, exports projects and closes sessions. Omitted reader/source credentials cannot be tested by this command. This is simulated injection, not native Windows Hooks or global Cloud Hooks installation. The deployment runner's history fingerprints independently protect original records; the smoke command does not have database administrator credentials.

Rollback restores only the previous **new MCP Worker** version:

```sh
python3 scripts/cloud.py rollback --backup-dir /tmp/private-spider-backup-UNIQUE
```

A first deployment has no previous MCP version and rollback therefore stops by default. To explicitly disable only a freshly created new MCP Worker, run the same rollback command with `--disable-new`. This deletes the new Worker (not D1 or the old API); it requires the backup to prove no prior MCP deployment and a private successful-deployment receipt matching the current deployment, otherwise it refuses. Worker deletion is an explicit action and removes the new Worker settings/secrets as well as its endpoint; redeployment is required to bring it back. Split prior versions require deliberate manual restoration. This command never deploys the old API Worker, restores SQL, drops tables, or erases MCP sessions/history. Worker secrets/settings may require separate reconciliation; run authenticated smoke again. Any destructive D1 restoration requires a separate incident procedure and explicit authorization.

Local guard verification: `python3 scripts/test_cloud.py`. Use `node tests/run.mjs` for repository JS tests; this environment's wrapper can swallow `node --test` execution. Production completion requires actual private backup, deployment evidence and remote smoke, none of which can be inferred from local tests.
