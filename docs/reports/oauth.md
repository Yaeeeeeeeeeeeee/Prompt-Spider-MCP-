# OAuth implementation report

Implemented fail-closed OAuth authorization and protected-resource discovery, exact-allowlist dynamic client registration, owner approval with same-origin one-use form nonces, S256 PKCE code exchange, hashed one-use 60-second codes, hashed resource-bound access tokens, rotating refresh tokens, bounded body reads, distributed keyed-IP rate limiting, and D1 expiry cleanup. Approval secret must be independent of existing API credentials. No default ChatGPT callback is assumed.

Added migration `0003_oauth.sql`, integration interface `handleOAuth(request, env)` and `validateOAuthBearer(token, env, requestOrigin)`, and configuration/operator instructions in `docs/oauth.md`.

Verification: `node tests/oauth.test.js` passes with actual Miniflare D1: one executed test, one pass, zero failures. It checks discovery, redirect rejection, origin CSRF protection, nonce replay, incorrect PKCE verifier, concurrent code replay, token resource binding, refresh rotation/replay, maximum request body size and disabled configuration. The Miniflare test used sandbox escalation to permit local loopback listening. Actual Worker routing and live ChatGPT connection require parent integration validation.

Atomic D1 `DELETE ... RETURNING` consumes codes and refresh tokens before issuance. Concurrent exchanges cannot both succeed. Issuance is a D1 transactional batch. A crash between consumption and issuance requires fresh authorization rather than allowing credential replay. Previously issued access tokens remain valid until their one-hour expiry when refreshing.
