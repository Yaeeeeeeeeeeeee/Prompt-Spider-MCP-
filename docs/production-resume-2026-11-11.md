# Production resume check — 2026-11-11

Task resumed from c1e06a2 in the newly published environment. This is observed production evidence, not the earlier local fixtures.

## Environment and credentials

The current environment ID matches the newly attached environment, and environment_status reported current observations, enforced network policy, and a new published configuration version. All six requested process variables are present: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, SPIDER_D1_DATABASE_ID, SPIDER_D1_DATABASE_NAME, MCP_AUTH_TOKEN, SPIDER_READ_TOKEN. No values are included in this report. New credential isolation/length checks pass.

## Read-only production checks

- Cloudflare API token verification: HTTP200, active.
- D1 identity lookup: HTTP200; database ID/name match the configured target.
- Existing Worker settings: HTTP200; DB binding matches that same D1.
- Actual D1 schema compatibility: pass. Original events table and indexes idx_events_project_time / idx_events_time are present. Original events count is2, confirmed again after backup attempts.
- Original production /health: normal curl request returns HTTP200 and healthy. Python urllib's default request was rejected with Cloudflare1010/HTTP403; this was not evidence that the Worker was down.
- Token self-policy metadata endpoint returns403. It is not necessary to grant broad token-management permissions solely for introspection. Relevant D1/Worker read operations above were verified; production deployment-write permission has not yet been exercised or claimed.
- Actual current Worker code downloaded privately and parsed: /health and /api/events routes, existing SPIDER_INGEST_TOKEN reference and events INSERT logic are present. No source or secret values were printed.

## Backup status and real blocker

An actual API compatibility defect was found in the backup script: GET /scripts/{name}/content returns405; the supported /content/v2 download returned200 multipart source. The script was corrected and a new regression first failed on the old path, then passed after correction. Fifteen Python deployment guard tests and all sixteen Node tests pass.

The current partial backup is stored outside Git under the private directory:
`/workspace/shared/prompt-spider-private-backups/2026-11-11-fdd46970df77`

It contains Worker multipart source, settings, deployments, versions, D1 schema and the prior/new MCP deployment lookup. Files are private; they are not committed. D1's asynchronous official export completed, but its signed download is hosted on a destination not allowed by the running environment. Python transport was refused, and curl returned exit56, CONNECT tunnel failure and HTTP000. Signed URL/query parameters were never logged. No complete D1 SQL file, restore verification or completed backup manifest exists, so deployment remains fail-closed.

Required additional exact egress hosts:

- `1ad59b064bfa3690063414a9906129e4.r2.cloudflarestorage.com` — actual official export download destination.
- `prompt-spider-mcp.tohsakarin2018.workers.dev` — planned independent new Worker endpoint, needed for the final remote smoke.

These were saved to the environment configuration draft while preserving the original api.cloudflare.com and old Worker rules and package presets. Draft persistence does not apply or publish the changes. The user must review/save/publish the environment configuration before access can be reverified. Existing values need not be pasted into chat or reentered solely for this network change.

## No production mutation

No schema migration, Worker upload, new Secret upload, event insertion, or production MCP smoke was executed. No original Worker/D1 data was overwritten. Server-side export jobs are read-only backup operations. The new production MCP and dashboard are not yet deployed and have no confirmed live URL.

## Resume procedure

Once the two egress hosts are effective: refresh status, recheck with a fresh connection, create a new private backup directory and a fresh official export (do not reuse an expired signed URL), restore/verify the full SQL backup, inspect migration/schema/history diffs, run the deployment guard/test pipeline, deploy only the new Worker, and execute actual SDK smoke plus protected-reader checks. Do not bypass the backup guard or network policy.
