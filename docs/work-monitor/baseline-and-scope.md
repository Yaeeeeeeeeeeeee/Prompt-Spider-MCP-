# Work monitoring V1: real baseline gate

## User-confirmed target

Windows ChatGPT Desktop, Work mode (not Codex). Desktop version unknown; do not guess it. The user reports successful native local MCP discovery of11 tools, guide/config reads and real session/event calls. Actual local code path is D:\prompt-spider-ui, command node, args D:\prompt-spider-ui\mcp\server.mjs, cwd D:\prompt-spider-ui. A separately built adapter plugin does not establish whether that source checkout has local modifications.

Official user-supplied product reference:
https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex

## Observed limits of this execution context

This task runs in Linux, not on that Windows desktop. No D: mount is available. Its tools do not expose the user's local prompt-spider or a Work task-launch/lifecycle-control API. No actual Git remote/branch/HEAD/status for D:\prompt-spider-ui has been read, and the two user-reported genuine sessions have not been accessed here. The vendored UI in this repo is a pinned reference, not proof of the user's current Windows source baseline.

The official Help URL fetch currently returns proxy CONNECT403, HTTP000. The environment draft adds only help.openai.com for documentation access while preserving every existing custom domain/preset. Saving the draft does not apply or publish it. No claim that the official product supports or lacks global lifecycle hooks follows from an inaccessible page. No supported global hook or automatic Skill-installation directory has been established.

## Concrete work completed before the integration gate

`tools/local-audit/audit.mjs` is a dependency-free Node audit for the actual local directory. It reads sanitized remotes, actual branch/full commit, tracked/untracked status, source diff statistics and working-source SHA256s. It does not fetch/pull, install packages, modify source/index/refs, or read/export task history, .env values or source contents. Remote URL userinfo/query/fragment are stripped before output.

`node tools/local-audit/audit.test.mjs` executes2 tests: credential-safe remote parsing; actual clean/modified Git fixture metadata plus index/source/ref preservation and no source/environment-value disclosure. These are audit-tool tests, not Work monitoring acceptance.

## Required evidence before applying an upgrade

Obtain the audit from the real Windows checkout. If clean at an accessible known commit, inspect that exact commit before implementing the compatible patch. If there are source modifications, inspect those actual changes through a private source handoff or an agent running on that machine. Do not reset, checkout, overwrite or assume a public upstream checkout equals the local source. Back up actual code/config/history before applying any upgrade.

The proposed incremental implementation remains: reuse the original MCP factory and all11 original interfaces, add a local persistent SessionStore adapter and workspace routes using the original spider/replay modules, and add a reusable Work integration Skill only through a verified supported mechanism. Stable host task identity is required for reliable retry/resume de-duplication. Instruction-driven calls must be labeled best effort, never a universal global interceptor. Missing completion must remain unknown/disconnected, not success. Test fixtures and imports of unknown provenance cannot become genuine Work records.

No application/MCP/UI code, Windows installation, local history or Cloudflare production resource was changed in this baseline phase. The three-real-Work-task acceptance has not been run. Do not present programmatic SDK fixtures as that acceptance.
