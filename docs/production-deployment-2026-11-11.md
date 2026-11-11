# Prompt Spider Cloud V1 — production deployment, 2026-11-11

## Result

Independent Worker **prompt-spider-mcp** is deployed and its live HTTPS health/dashboard return200. The original prompt-spider-api remains deployed and untouched. Existing prompt-spider-db is reused through DB; only audited new tables/indexes were created. Original events data remain exactly equal to the verified backup (2 rows).

- Dashboard: https://prompt-spider-mcp.tohsakarin2018.workers.dev/
- MCP Streamable HTTP: https://prompt-spider-mcp.tohsakarin2018.workers.dev/mcp
- Health: https://prompt-spider-mcp.tohsakarin2018.workers.dev/health
- Original API retained: https://prompt-spider-api.tohsakarin2018.workers.dev
- Deployed application source Git revision: **a4291afc6770bb99176054bc996b49595e94ac53**. This report is a later documentation-only commit; it does not alter the deployed code.
- Final active Cloudflare version: **0dbb9b44-905e-4d0a-989b-f9a892228787**,100% traffic.
- Same-source rollback probe version: **d484f4f6-fc87-453b-809e-d5cb9465672e**, retained inactive.

## Actual backup and isolated recovery

A new official Cloudflare D1 export was requested for this run; no previous signed URL was reused. The full SQL was downloaded and restored in an isolated SQLite memory database with host filesystem/extension operations denied. integrity_check returned ok; the sets of original user tables/indexes and their exact SQL definitions matched, and all four fields of both old events rows matched by whole-record fingerprint.

Private backup directory (outside Git): `/workspace/shared/prompt-spider-private-backups/fresh-2026-11-11-35779956316b`

- D1 SQL: `d1.sql` — 721 bytes.
- SHA256: `77ff85615d2990429a2e68c9bc3700157fe711b1c89feb9374a636b361e77fe1`.
- `manifest.json`: checksums and target validation for the original Worker multipart code/settings/deployments/versions, D1 schema/SQL and recovery reports.
- `restore-validation.json` and `extended-restore-report.json`: successful isolated recovery, table/index and record comparisons.
- `predeploy-tests.json`: all7 test/build commands succeeded before deployment.
- `live-sdk-report.json`: actual production SDK acceptance evidence.
- `rollback-baseline-version.json`, `rollback-validation.json`, `mcp-deployed.json`: known-good version, rollback drill, final deployment receipt.

Private SQL/source/settings and signed export URLs are not in Git or this report. No secret plaintext was retrieved from Cloudflare. Backup filesystem permissions are0700/0600. The backup is in this managed environment, not an independently verified encrypted/offsite archive; retain it using your private backup policy before deleting the environment.

## Predeployment validation

Four new HTTPS connections reached the allowed destinations: R2 root400 (expected without a signed object request), Cloudflare API root301, original Worker health200 and not-yet-created new Worker404. Cloudflare Token verification was active, D1 identity/name and original DB binding matched. Actual official export download subsequently succeeded.

All migrations were restricted to CREATE TABLE/INDEX IF NOT EXISTS, verified against real existing schema, with hashes recorded privately. No DROP/ALTER/DELETE or legacy record rewrite was used.

Executed and passed before production deployment:

| Suite | Result |
|---|---|
| Node backend/protocol/SDK/OAuth/UI tests |16 passed|
| Optional Windows collector/install safeguards |18 passed, Linux execution only|
| Optional Cloud reporter |2 passed|
| Deployment/backup/recovery guards |15 passed|
| Original upstream STDIO MCP |3 passed, including5000 events and clean export/install|
| Chromium local Worker/D1 dashboard |21 checks passed|
| Wrangler deployment packaging dry-run |passed|

## Actual production acceptance

Official MCP SDK made real HTTPS requests through the environment proxy. **41 checks passed**, covering connection/initialize, all11 tools discovered, guide/config/replay resources, spider_list_sessions, both declared Windows/cloud session creation/query, event updates, stable-ID deduplication, project status reading, configure/complete/seek, authenticated replay download, import, editable project export, and a new SDK connection observing persisted sessions.

Two completed visible sessions are deliberately marked SIMULATED and remain available for dashboard inspection. Two imported replay sessions were soft-closed, retaining their data. D1 was independently queried:4 stored session rows,2 visible; one simulated original session per Windows/cloud source. This validates production transport and persistence; it is **not** proof of native Windows Hooks, real ChatGPT account authorization or automatic instrumentation of every Codex Cloud project.

Unauthorized MCP, reader-as-MCP, anonymous dashboard access, MCP-as-dashboard-reader and anonymous artifact download were rejected401. Project exports exclude the actual supplied credentials. A nonexistent session returned a controlled tool error; an oversized request returned413; health remained200 afterward.

## Live rollback validation

A new inactive version was uploaded from the same source. It retained both independent secret bindings, the same D1 binding and the same code ETag as the validated baseline. Traffic was moved100% to that version, health and authenticated dashboard reads succeeded, then traffic was restored100% to the baseline. Post-rollback health/reads succeeded; old event and MCP session fingerprints were unchanged. **17 checks passed**. No old Worker update, D1 restore/drop, secret exposure or data deletion was used.

To restore this known-good version after a future MCP release, run with the existing secure Cloudflare environment credentials:

```sh
npx wrangler versions deploy 0dbb9b44-905e-4d0a-989b-f9a892228787@100 --name prompt-spider-mcp --yes
```

Then verify health, authenticated SDK list/get and original event history. This changes only the new Worker's version, not D1. For later deployments, create a fresh backup and use the guarded rollback procedure in deployment.md. This first release had no earlier MCP service: the original backup's --disable-new option intentionally deletes only the new Worker and is an explicit shutdown operation, not the preferred version rollback.

Never restore d1.sql over the live database to undo an additive release: later session data would be at risk. For disaster recovery, restore into a separate empty isolated database, validate all data and schema, then plan a separately authorized cutover while retaining the current database.

## Client configuration

Use the real /mcp URL above. In a local Codex CLI that supports remote MCP, first inspect any existing registration with the same name, then add it:

```sh
codex mcp add prompt-spider-cloud --url https://prompt-spider-mcp.tohsakarin2018.workers.dev/mcp --bearer-token-env-var MCP_AUTH_TOKEN
```

Securely configure the already-provided independent MCP_AUTH_TOKEN in that client's environment. It grants the MCP tool/resource/artifact capability; it is not the old event-ingest token and cannot read the separate dashboard API. Open the dashboard and enter the already-provided SPIDER_READ_TOKEN in its password input; it is kept only in page memory. Never put either value in chat, URLs, source, browser persistent storage or Git.

The11 tool names and full usage/limits are in mcp.md, and available from tools/list plus spider://guide. Default privacy hashes task/project/run/node identifiers and restricts arbitrary user text.

## Explicit remaining boundaries

- ChatGPT OAuth is implemented and locally tested but **not enabled in this production deployment**: no exact ChatGPT callback list or independent OAuth approval credential was supplied. Set MCP_OAUTH_ORIGIN, verified MCP_OAUTH_REDIRECT_URIS and a new independent MCP_OAUTH_APPROVAL_TOKEN through the safe deployment workflow before claiming ChatGPT OAuth login works. The static authenticated remote MCP endpoint is live and SDK-verified.
- Optional HTTP Windows/cloud collectors require their distinct write credentials and explicit new-Worker endpoint; those optional credentials were not supplied. Remote MCP does not require installing Python locally. The original ingestion Worker/token remain unchanged.
- No actual Windows machine installation or native Hook trust bypass was performed. Codex Web also requires the product to expose the connector to the task; a repo file cannot inject tools globally.
- The final production-browser command was interrupted by the user before it completed; no production Chromium result is claimed. The21 local Chromium checks, production static/API checks,41 live SDK checks and live rollback verification above are separate completed evidence.
