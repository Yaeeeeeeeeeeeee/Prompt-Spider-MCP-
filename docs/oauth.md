# ChatGPT OAuth connector setup

Apply `migrations/0003_oauth.sql` to the Worker's D1 database before enabling OAuth. Configure:

- `MCP_OAUTH_ORIGIN`: the canonical HTTPS origin, for example `https://spider.example.com` (no trailing slash or path).
- `MCP_OAUTH_REDIRECT_URIS`: a JSON array of exact HTTPS callback URLs copied from your connector's official setup instructions. There is no default callback and no wildcard matching. Obtain the callback for the actual ChatGPT deployment you use; this project does not guess it.
- `MCP_OAUTH_APPROVAL_TOKEN`: a new random secret of at least 32 characters, stored as a Worker secret. Keep it independent of `MCP_AUTH_TOKEN` and all Spider ingest/read/write credentials.

Set the connector's remote MCP URL to `https://spider.example.com/mcp` and choose OAuth authentication. Discovery publishes the authorization, token and dynamic client registration endpoints. Public clients register with `token_endpoint_auth_method: none`; authorization requires PKCE S256 and the exact resource URL `https://spider.example.com/mcp`. Token and refresh requests must also include this `resource`.

During authorization, the owner enters the approval secret into the password field on this Worker's approval page. Approval grants access to all MCP tools. Never put this secret in the callback URL, chat prompts or connector client-secret field. The page shows the callback destination and uses a one-use five-minute approval form with same-origin submission. Credentials are never embedded in HTML or redirect URLs. This is an owner-approved connector, not a multi-user identity provider.

Access tokens last at most one hour. Each approved grant has an absolute 30-day deadline; rotating refresh tokens retains that deadline and cannot extend it. Access tokens issued near that deadline expire at the deadline too. After 30 days the owner must authorize again. Authorization codes last 60 seconds and are single use. D1 stores hashes of all bearer tokens, codes and form nonces. Tokens are bound to the canonical `/mcp` resource. A consumed credential stays consumed if subsequent token issuance fails; restart authorization in that case. Refresh rotation does not revoke already issued hour-long access tokens.

The OAuth endpoints enforce a 16 KiB request-body limit and a D1-backed 30-request/minute limit per public endpoint and hashed Cloudflare caller IP. Only a keyed IP hash is persisted. Each OAuth request removes at most 100 expired rows per state table using indexed expiry lookup. Keep the Worker behind Cloudflare so `CF-Connecting-IP` is trusted. No request bodies or approval secrets should be logged by upstream middleware.

Configuration failures disable OAuth with HTTP 503. Changing the origin invalidates tokens for the old resource. Removing a callback prevents new code exchanges for that callback. To revoke all OAuth credentials, delete rows from `oauth_tokens`, `oauth_codes`, and `oauth_forms`; rotate the approval secret as needed. Existing public client registrations contain only client IDs and redirect URLs.

Local development may set `MCP_OAUTH_ALLOW_LOCAL_HTTP=true` with an exact localhost/loopback `MCP_OAUTH_ORIGIN`. Callback URLs still require explicitly allowlisted HTTPS URLs. Production defaults require HTTPS. Browser CORS permits only the canonical origin and the exact origins of configured HTTPS callback URLs. Other origins receive no CORS permission; unknown-origin preflights return 403. Server-to-server requests need no Origin header. Approval POSTs additionally require an exact canonical `Origin` header.

This implementation intentionally supports exact configured callbacks only, with no loopback port wildcard. A live ChatGPT account integration must be verified against its current callback documentation and connector behavior before claiming end-to-end compatibility.

For immediate administrative revocation, use an authenticated D1 administration session to delete all rows in `oauth_tokens`, `oauth_codes`, and `oauth_forms`. To revoke a particular registered client, delete its token rows by `client`, then delete its `oauth_clients` row; clear pending codes/forms too because their client information is embedded in JSON. This affects OAuth credentials only and does not rotate the independent static MCP credential. Rotating the approval secret alone does not revoke already issued bearer tokens.

Migration 0003 remains unapplied in this development change. Its token schema includes `grant_expires`; do not assume re-running CREATE TABLE updates an already-existing OAuth table. An installation that applied an older development version must explicitly add/backfill that column (or clear and recreate the OAuth tables during a planned credential revocation) before using this version.
