# WebPin: Chrome UI Annotation and AI Task Packages

WebPin is a local-first Chrome extension for a solo product builder. It captures feedback on web prototypes, stores annotations beside one configured project, and generates structured JSON, Markdown, and Codex prompt task files.

## Current Status

WebPin is in **MVP stabilization**. The authenticated single-project flow is implemented and verified: the packaged extension can select an element, save and reload an annotation, update its status, delete it, and generate task files through the Local File Bridge.

Screenshot and crop capture is implemented and configurable because pages may contain sensitive information. Automated browser coverage for Chrome's `activeTab` grant and crop behavior remains a hardening task. Visual-region drawing, source-anchor extraction, and DOM snapshot capture are not implemented.

## Architecture

The MVP uses a **Chrome Extension + Local File Bridge**:

- The extension provides the element-selection overlay, inline editor, side panel, pending list, saved-annotation controls, and task-package controls.
- The bridge binds to `127.0.0.1` and owns one canonical project chosen at process startup with `UI_ANNOTATIONS_PROJECT_PATH`.
- The browser never sends or selects a filesystem path. Every protected request uses the startup access key in `X-WebPin-Key`.
- `Origin` is used only for CORS response metadata; it is not authorization.
- Project data is stored under the configured project's `.ui-annotations/` directory.
- The bridge does not accept arbitrary shell commands. Its optional agent endpoint invokes only the fixed Codex runner for an existing generated task prompt.

The local store uses this layout:

```text
.ui-annotations/
  project.json
  annotations.jsonl
  events.jsonl
  tasks/
    <task-id>.json
    <task-id>.md
    <task-id>.prompt.md
  runs/
    <run-id>.json
  assets/
    screenshots/
    crops/
    dom-snapshots/
```

The `dom-snapshots/` directory is reserved by the storage layout; capture is not yet implemented.

## Install and Verify

```bash
CI=true pnpm install --frozen-lockfile
CI=true pnpm verify
pnpm test:e2e:install
CI=true pnpm test:e2e:extension
```

`pnpm verify` runs type checks, unit/API tests, and production builds. The packaged-extension test builds the shared package, extension, and bridge, then loads the MV3 extension in Chromium and exercises the authenticated annotation flow. If Chromium installation needs system packages in CI, use `pnpm exec playwright install --with-deps chromium`.

## Solo User Workflow

1. Build the extension:

   ```bash
   CI=true pnpm build
   ```

   The root build compiles the shared package before building the extension and bridge, so this also works from a clean clone after dependency installation.

2. Load `apps/extension/dist` as an unpacked extension in Chrome. For `file://` prototypes, enable **Allow access to file URLs** in the extension details.

3. Start the bridge for exactly one project:

   ```bash
   UI_ANNOTATIONS_PROJECT_PATH=/absolute/project/path pnpm dev:bridge
   ```

   The path must be an existing readable and writable directory. The bridge resolves it once to a canonical path before listening.

4. Copy the access key printed by the bridge.
5. Open the extension side panel, paste the key, and click **Connect**.
6. Confirm the panel shows **Ready** and the configured project name. A public health response alone does not make the panel ready.
7. Open the prototype page and click **Select element**, or use `Ctrl+Shift+Y` (`MacCtrl+Shift+Y` on macOS).
8. Click an element, enter the note, change type, priority, and target platforms in the inline editor, then click **Save**. The annotation enters the pending list.
9. Review pending annotations and click **Save all to files**. Each confirmed write is acknowledged individually; a failed remainder stays pending for retry.
10. Use **Saved annotations** to refresh from disk, filter, change status, delete active annotations, and choose annotations for task generation.
11. Use **Task package** to set a task ID, intent, acceptance criteria, prompt template, and suggested files, then generate the JSON, Markdown, and prompt files.
12. Optionally click **Send to Codex**. The panel reports the final status and run ID; complete command output and execution metadata remain local in `.ui-annotations/runs/<run-id>.json`.

Restarting the bridge generates a new access key. Paste the new key and reconnect; stale credentials are cleared without intentionally clearing pending annotations.

### Optional screenshot and crop evidence

Screenshot capture defaults off and can be enabled in the panel for the configured project. When enabled, the existing capture path can write local files under `.ui-annotations/assets/screenshots/` and `.ui-annotations/assets/crops/` and add their relative paths to the visual anchor. Treat this as sensitive local data. The packaged Chromium test does not yet exercise Chrome's `activeTab` permission and crop behavior.

## Controlled Codex Runner

`POST /agent-runs` accepts only this authenticated body:

```json
{
  "taskId": "task_001",
  "agent": "codex"
}
```

The browser cannot provide a project path, command, arguments, prompt text, or working directory. The bridge validates the task ID, reads `.ui-annotations/tasks/<task-id>.prompt.md`, and invokes:

```bash
codex exec --sandbox workspace-write "<prompt file contents>"
```

The HTTP response exposes only the run ID and final status. The complete run record, including command result details, stays local under `.ui-annotations/runs/<run-id>.json`.

## Implemented and Remaining Scope

Implemented in the stabilized flow:

- DOM element selection with selector, XPath, text excerpt, bounding box, page, and viewport metadata.
- Pending annotations with sequential acknowledgement and serialized background storage mutations.
- Saved annotation loading, filtering, status updates, and deletion event traceability.
- JSON, Markdown, and prompt task-package generation.
- Configurable local screenshot/crop capture path.
- Fixed-shape local Codex execution for generated prompts.
- Packaged MV3 Chromium verification and CI enforcement.

Remaining work includes visual-region drawing, source anchors, DOM snapshot capture, screenshot `activeTab`/crop browser hardening, an asynchronous Codex queue, and broader decomposition of the panel application.

## Non-Goals for MVP

- No cloud backend or remote screenshot storage.
- No accounts, multi-user collaboration, assignments, comments, or live sync.
- No direct iOS source modification from the extension.
- No guaranteed DOM-to-SwiftUI component mapping.
- No arbitrary shell-command execution from the bridge.

## Key Documents

- Product requirements: `docs/superpowers/specs/2026-07-01-chrome-ui-annotation-ai-task-prd.md`
- Authenticated single-project design: `docs/superpowers/specs/2026-07-16-single-project-session-key-design.md`
- Implementation evidence: `docs/superpowers/plans/2026-07-16-single-project-session-key-implementation-plan.md`
- Current factual status: `docs/PROJECT_STATUS.md`
