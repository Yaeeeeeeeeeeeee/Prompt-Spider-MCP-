# Remote MCP security review

Reviewed `src/worker.js`, `src/oauth.js`, `src/mcp.js`, `src/mcp-store.js`, relevant session-store behavior and D1 schema. Static review of the current independent Worker design; no production requests, deployment, credentials, or live ChatGPT authorization used. Findings refer to the reviewed snapshot and require rechecking after fixes.

## Fixed by root: wrong credential selected for reader and MCP authentication

`authenticate()` indexes `env[role==='reader'?'SPIDER_READ_TOKEN':'MCP_AUTH_TOKEN','MCP_OAUTH_APPROVAL_TOKEN']`. JavaScript's comma operator makes the selected key always `MCP_OAUTH_APPROVAL_TOKEN`. Consequently the approval secret grants both API reading and MCP access, intended reader/static MCP tokens fail, and configurations without OAuth return 503. Reproduce with distinct valid credentials and compare requests to `/api/sessions` and `/mcp` using each credential. Remove the comma expression and test that approval credentials never authenticate either resource; verify static and OAuth credentials independently.

## Important: default privacy leaves user-controlled identifier text in storage

`privacyArgs()` redacts event IDs/labels but passes `context.project_id/run_id/node_id`, export `filename`, and project `name` unchanged. Inputs such as `AliceMedicalCase` pass the schemas and become durable context, filenames, or artifact content. Context is returned through list/get and reader APIs. This defeats the strict default whitelist's intended protection against names/private text. Hash context identifiers, generate opaque default artifact names, and require the explicit public-label opt-in for descriptive artifact/project names. Add negative checks against these concrete channels.

## Fixed: wildcard OAuth CORS contradicts the requested policy

OAuth `json()` adds `Access-Control-Allow-Origin: *` to every JSON response, including token responses, and OPTIONS advertises unrestricted origin access. No demonstrated ChatGPT requirement justifies this. Remove broad CORS or implement a narrowly configured exact origin allowlist; verify discovery and server-to-server OAuth continue to work without it.

## Fixed: public OAuth cleanup is unbounded

Every rate-accepted public OAuth request executes five `DELETE ... WHERE expires < ?` statements. There are no expiry indexes and no deletion limits. These scan all active token/client rows repeatedly; rotating source IPs can add rows and force increasingly costly scans. This is not the bounded collection claimed in the source comment. Add expiry indexes and bounded indexed cleanup per request or scheduled bounded cleanup. Keep registration/rate state growth bounded globally as well as per IP.

## Fixed: consent lifetime mismatch

The approval page promises access for 30 days, but each refresh creates a new 30-day refresh token without retaining a grant creation time or absolute expiry. A client can retain access indefinitely. Either persist/enforce an absolute 30-day grant deadline across rotation or explain renewable access accurately in consent. Expired client registration also does not prevent refresh issuance.

## Verified positive design properties and remaining validation

D1 session updates use revision-checked retries and closing prevents stale writers from reopening rows. Session creation enforces the open-session count in the INSERT. Artifact filenames are unique at the database layer. OAuth code and refresh consumption use atomic DELETE RETURNING, codes use PKCE S256, redirect matching is exact against configured and registered lists, approval POST checks same-origin and a one-time form nonce, and tokens are stored as hashes. MCP transport uses the actual SDK Streamable HTTP implementation in stateless JSON response mode; there are 11 registered tool names and the guide/config/replay resources.

These observations do not establish deployed compatibility, a successful ChatGPT callback/token refresh, or preservation of the production old Worker/events. Those require deployment/binding inspection and authorized end-to-end verification. Origin allowlisting, request caps, rate limits, and secret exclusion should be tested at the Worker boundary after the authentication fix. Tool output schema validation errors should also be checked for echoing invalid request values before claiming all error responses are private.

Follow-up: OAuth now emits only exact configured origins for CORS, limits indexed cleanup to 100 rows/table/request, retains absolute grant expiry on rotation, caps access lifetime to that expiry, and rejects unsupported token-request scopes. Regression coverage directly exercises these cases plus administrative token deletion. Root corrected the credential expression independently. Default identifier/filename privacy remains assigned to a separate implementation task.
