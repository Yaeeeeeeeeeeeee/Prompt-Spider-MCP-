# Upstream source and local fallback

Source: https://github.com/Kirito14IT/prompt-spider-ui
Pinned revision: `24a5db96fff2579baaa6fefce7d7051a929a8d57`.
MIT, copyright (c) 2026 Kirito14IT; complete notice is in LICENSE.

The app, root package/server, and mcp source/package-lock/tests are copied from this revision. Shared lib files may contain the hosting project's remote-adaptation changes; consult the repository diff. No upstream dependency trees, videos, credentials or Git metadata are distributed. SVG branding belongs to the same upstream source/license.

The principal product is the remote Worker described in ../../docs/mcp.md. This directory also preserves the original local STDIO MCP as a fallback. With Node >=20:

```sh
npm --prefix vendor/prompt-spider-ui/mcp ci
node vendor/prompt-spider-ui/mcp/server.mjs
```

Configure a local MCP host with command `node`, args `["/absolute/path/vendor/prompt-spider-ui/mcp/server.mjs"]`. This process uses STDIO and opens localhost previews; it does not connect to the remote Worker. `npm --prefix vendor/prompt-spider-ui start` runs the ordinary dependency-free preview server. The pinned lock is supplied; package availability and installation require npm registry access. Final verification: `npm run test:stdio` at the host root passes all three original protocol tests, including 5,000 events, portable replay and a clean independent project/MCP install. Running the test directly initially failed because the original test guesses npm-cli.js relative to a nonstandard Node executable; invoking through npm supplies the supported npm_execpath.
