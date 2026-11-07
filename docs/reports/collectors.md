# Collectors and provenance validation

Completed optional V1 Windows/cloud collectors, explicit new-Worker endpoint requirement, source-specific credentials, opaque identifiers, persistent retry with stable IDs, merge/backup/rollback protections, and regression coverage. Updated documentation to identify the remote MCP as the final product and optional collectors as separate instrumentation.

Validation: `python -m unittest discover -s tools/windows-hooks -v`: 18 passed. `python -m unittest discover -s collectors/cloud -v`: 2 passed. Includes execution of actual original ZIP sender's project-root assertion, forced Git timeout fallback, and worktree/submodule root selection. The original real assertion passes here; the timeout test demonstrates a failure mechanism without claiming an observed Windows timeout.

Full original upstream local STDIO fallback source and pinned package lock are preserved. npm ci could not retrieve dependencies in this environment; offline retry failed ENOTCACHED for zod 4.6.7. Do not interpret a no-output Node test wrapper as protocol validation. Windows shell/registry/trust, actual cloud native instrumentation, remote production persistence and original STDIO runtime remain unverified here. No Windows configuration was installed and no production event was sent.

Final integration update: root subsequently verified the unchanged original STDIO suite through `npm run test:stdio` with the supported npm_execpath. All3 tests passed, including clean independent dependency installation/export. Earlier dependency/path blockers above describe the initial scoped attempt, not the final runtime result. Windows native execution remains unverified.
