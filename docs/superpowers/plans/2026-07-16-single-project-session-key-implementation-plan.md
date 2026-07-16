# Single-Project Session Key Implementation Record

> **Completed archival record:** Implementation and verification finished on 2026-07-16. This file retains its `implementation-plan` filename for stable links; it records completed outcomes and residual follow-ups, not commands awaiting execution.

**Goal:** Replace browser-supplied project paths and Origin-based authorization with one canonical bridge project plus a per-process access key, then prove the repaired annotation workflow in packaged Chromium.

**Architecture:** The bridge resolves one project at startup and injects that trusted configuration into every route. A typed authenticated extension client owns bridge calls and drives explicit `offline`, `key-required`, and `ready` connection states. The background service worker serializes pending-list mutations. Store operations reject static symbolic links in managed directories, and Playwright loads the built MV3 extension to verify the real workflow.

**Tech stack:** TypeScript, Node.js HTTP and filesystem APIs, React 18, Chrome Manifest V3, Zod, Vitest, pnpm 9, Node.js 22, Playwright Chromium, and GitHub Actions.

**Implementation date:** 2026-07-16

## Completed Tasks

### Task 1: Canonical bridge startup configuration

- [x] Added startup configuration tests for missing, relative, non-directory, unreadable, and unwritable project paths.
- [x] Added `loadBridgeConfig`, which requires `UI_ANNOTATIONS_PROJECT_PATH`, resolves it with `realpath`, verifies a readable and writable directory, derives the project name, and generates a random per-process key.
- [x] Made bridge startup validate the project and managed annotation directories before listening on `127.0.0.1`.

Outcome: one bridge process owns one canonical project; browser requests cannot select or switch it.

### Task 2: Access-key authentication

- [x] Added unit coverage for accepted, missing, empty, and incorrect keys.
- [x] Added timing-safe equal-length comparison for `X-WebPin-Key`.
- [x] Kept `GET /health` and CORS preflight public while requiring the key for every project route.

Outcome: `Origin` is CORS metadata only, not authorization.

### Task 3: Managed-directory symbolic-link hardening

- [x] Added regressions for symbolic links at `.ui-annotations/` and managed child directories.
- [x] Implemented `ensureManagedDirectory` with the correct sequence: `lstat`; create only after `ENOENT`; tolerate a concurrent `EEXIST`; then `lstat` the resulting entry and require a real directory.
- [x] Applied the helper in parent-before-child order to `.ui-annotations/`, `tasks/`, `runs/`, `assets/`, `screenshots/`, `crops/`, and `dom-snapshots/`.
- [x] Retained narrow filename validation and containment checks for task, run, and asset writes.

Outcome: static managed-tree symbolic links are rejected without claiming protection from a hostile concurrent parent-directory swap.

### Task 4: Single-project authenticated bridge routes

- [x] Added public health metadata and authenticated `/session` project metadata.
- [x] Converted annotations, project settings, assets, tasks, and agent-run routes to the closed-over canonical project.
- [x] Made request schemas strict and reject obsolete `projectPath` fields or query parameters.
- [x] Limited the controlled agent request to `{ taskId, agent: "codex" }` and the browser response to `{ run: { runId, status } }`.
- [x] Kept full command, output, timing, exit, prompt, and task metadata only in the local run record.

Outcome: the browser has neither filesystem-selection authority nor arbitrary-command authority.

### Task 5: Authenticated extension bridge client

- [x] Added one typed client for health, session, annotation CRUD, project settings, assets, tasks, and agent runs.
- [x] Added `X-WebPin-Key` to protected calls and normalized offline, authentication, and HTTP failures.
- [x] Rejected malformed or non-JSON bridge responses without leaking credentials.

Outcome: panel and background bridge traffic share one narrow request contract.

### Task 6: Connection state and acknowledgement-only pending saves

- [x] Added explicit `offline`, `key-required`, and authenticated `ready` state; health alone never produces `ready`.
- [x] Added stale-attempt gating and compare-before-remove credential cleanup so an old rejected request cannot clear a newer session.
- [x] Refined pending saves to take a snapshot, write sequentially, and acknowledge an item only after its `201` response.
- [x] Made the background owner remove the first matching ID from the latest stored list and return the resulting current state; the panel renders that returned state instead of writing a calculated stale remainder.
- [x] Covered partial failure, retry, duplicate IDs, an item appended during a save, and refresh failure after the final acknowledgement.

Outcome: confirmed writes stay removed, unconfirmed work stays pending, and acknowledgement cannot overwrite newer pending state.

### Task 7: Background ownership and panel migration

- [x] Added annotation construction from the authenticated project name while preserving DOM and visual anchors.
- [x] Removed browser project-path inference, selection, storage, request bodies, and query strings except for deliberate cleanup of the legacy storage key.
- [x] Added `createPendingMutationQueue`; append and remove operations share one serialized promise chain, read current Chrome storage immediately before mutation, and keep the chain usable after a failed storage write.
- [x] Routed panel pending acknowledgements and inline/background appends through that owner.
- [x] Added a project-ID mismatch guard that blocks writing pending annotations into a different authenticated project.
- [x] Migrated protected panel and background actions to the authenticated client and disabled them outside `ready`.
- [x] Updated English and Chinese connection copy.

Outcome: the background service worker is the serialized pending-state owner. A narrow Chrome-storage compare/remove window remains if an independent actor bypasses that owner.

### Task 8: Packaged-extension and CI verification

- [x] Added Playwright and `test:e2e:install` / `test:e2e:extension` commands.
- [x] Added a packaged MV3 Chromium test that starts an isolated bridge/project, loads the built extension, authenticates, selects an element, saves and reloads it, updates status, generates JSON/Markdown/prompt task files, deletes it, and checks browser errors.
- [x] Kept screenshot capture out of this test pending an explicit `activeTab` grant and crop-verification design.
- [x] Added `.github/workflows/verify.yml` for pushes and pull requests with read-only repository contents, per-ref cancellation, pnpm 9, Node.js 22, frozen installs, and pnpm caching.
- [x] Split CI into a fast `pnpm verify` job and an isolated E2E job that installs Chromium with system dependencies before running `pnpm test:e2e:extension`.

Outcome: the original packaged-extension GET/session reliability failure is covered locally and in CI.

### Task 9: Documentation, audit, and handoff

- [x] Rewrote the README as the user setup and operating guide for one startup project and copied terminal key.
- [x] Updated project status to the factual MVP-stabilization state, verified capabilities, remaining work, and residual risks.
- [x] Marked the design implemented and verified; documented acknowledgement/current-state semantics, serialized ownership, mismatch blocking, run-response minimization, and the filesystem threat boundary.
- [x] Recorded completed implementation outcomes in this plan instead of leaving stale unchecked instructions.
- [x] Added the CI workflow and documented local/CI E2E setup.
- [x] Audited obsolete project-path inputs and forbidden cloud/collaboration scope.
- [x] Ran complete verification and whitespace validation before the documentation commit.

## Verification Evidence

Fresh verification on 2026-07-16:

```bash
CI=true pnpm verify
CI=true pnpm test:e2e:extension
git diff --check
```

Results:

- Type checks passed for the shared, bridge, and extension packages.
- 20 test files passed with 103 tests: shared 3, bridge 43, extension 57.
- Production builds passed for all three packages.
- Packaged Chromium completed the authenticated annotation/task workflow with no browser console or page errors.
- The documentation/CI diff passed whitespace validation.

The CI equivalent uses:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm exec playwright install --with-deps chromium
pnpm test:e2e:extension
```

with `CI=true` on both verification commands.

## Scope Audit

- [x] No cloud backend, remote screenshot storage, accounts, multi-user collaboration, assignments, comments, or live sync were added.
- [x] No browser request can supply a project path.
- [x] No arbitrary command, arguments, prompt text, or working directory can be supplied to the agent route.
- [x] No direct iOS source modification or DOM-to-SwiftUI mapping assumption was added.
- [x] Visual-region drawing, source-anchor extraction, DOM snapshot capture, and an asynchronous runner remain future work.

## Residual Risks and Follow-ups

1. A hostile local process can still swap a parent directory after validation and before high-level Node filesystem I/O. Closing this time-of-check/time-of-use gap requires lower-level descriptor-relative operations or a different platform-specific boundary.
2. Chrome storage has no atomic compare-and-remove primitive. Serialization protects mutations routed through the background owner, but an independent actor that writes the same key outside that owner can still race it.
3. Packaged-browser automation does not yet verify the screenshot `activeTab` grant or crop output.
4. Task response paths use platform-native separators; Windows responses may contain backslashes.
5. A table-driven every-route authentication matrix and deeper error-metadata assertions would further strengthen bridge coverage.
6. The synchronous Codex request should become an asynchronous queue with polling before broader or longer-running use.
7. The large panel `App` should be decomposed into narrower components and hooks.

## Commit Handoff

- CI workflow: `ci: verify packaged extension workflow`
- Documentation: `docs: document authenticated single-project workflow`
- Push is intentionally left to the repository owner.
