# MCP privacy hardening

Default privacy now hashes context project/run/node IDs before persistence while preserving declared source and simulated values. Event IDs remain deterministic hashes, so repeated updates using the original producer ID update the existing event without duplicate counts.

Session exports hash caller-provided filenames, and generated default filenames are also opaque SHA-256 basenames. Project exports hash names in both the portable body and artifact filename. Lowercase 64-hex project names are preserved for reuse. Import lookup uses the actual filename returned by export. Explicit MCP_ALLOW_PUBLIC_LABELS=true retains human-friendly public-safe identifiers and names.

Session tool arguments and imported recording IDs require actual UUID syntax. Session list metadata is joined to database rows by decoded session ID rather than positional ordering.

Regression coverage uses the actual SDK handler and Miniflare D1: persisted state/context/artifact bodies and filenames contain no identifying test strings, repeated event updates do not increase counts, exported filenames round-trip through import, project names are opaque, list contexts retain correct session association, invalid session IDs fail, and public-label opt-in retains public names.

Validation: node tests/mcp.test.js requires elevated loopback permissions because Miniflare opens a local server. The first sandbox run failed with listen EPERM at 127.0.0.1. The elevated integration run passed; the final expanded regression run is recorded in the task response.

No root router, OAuth, vendor, build, production, commit, or deployment changes were made in this hardening task. Hashes are deterministic identifiers, not encryption or secret detection; callers must not submit secrets.
