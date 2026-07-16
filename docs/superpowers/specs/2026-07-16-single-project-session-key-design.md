# Single-Project Session Key Design

## Status

- Date: 2026-07-16
- State: Approved for implementation planning
- Scope: Local File Bridge authentication, active project selection, path safety, extension connection state, and browser-level verification

## Context

WebPin currently accepts a `projectPath` from every browser request and combines a global origin allowlist with a global project-root allowlist. Real Chromium verification exposed a compatibility failure: extension GET requests to `/annotations` and `/project-settings` omit the `Origin` header, so the bridge rejects them with `403 origin_not_allowed` even though POST annotation writes succeed. The panel therefore reports the bridge as connected while saved annotations cannot be loaded.

The current path checks are lexical. A project path inside an allowed root can be a symbolic link to a directory outside that root, allowing `.ui-annotations/` writes outside the intended boundary.

The MVP is primarily for one local user and does not need multi-project switching, accounts, cloud identity, or a high-friction pairing protocol. The repair should make the primary workflow reliable while reducing the browser's authority over filesystem paths.

## Goals

1. Make extension GET and write requests reliable without depending on an `Origin` header.
2. Restrict each bridge process to one explicitly configured local project.
3. Remove `projectPath` from browser-controlled API payloads and query parameters.
4. Protect bridge APIs with a simple per-process access key.
5. Surface truthful connection states in the extension panel.
6. Reject symbolic-link layouts that could redirect `.ui-annotations/` writes.
7. Prove the repaired workflow with a packaged-extension Chromium test.

## Non-Goals

- Persistent user accounts or cloud authentication.
- Multiple simultaneous project bindings in one bridge process.
- A browser-to-bridge pairing code protocol.
- Long-lived access-key rotation or recovery workflows.
- Remote bridge access.
- Multi-user permissions or collaboration.
- Implementing visual region capture, source anchors, DOM snapshots, or the asynchronous Codex runner in this slice.

## Approved Product Decisions

### One active project per bridge process

The bridge requires `UI_ANNOTATIONS_PROJECT_PATH` at startup. The value must be an existing, writable, absolute directory. The bridge resolves it to a canonical physical path once and uses that path for every store operation.

The browser cannot provide, override, or switch the project path. To work on another project, the user starts another bridge process with a different project path.

### Per-process startup access key

The bridge generates a cryptographically random access key at startup and prints it to the terminal. The user pastes the complete key into the extension panel.

The key exists only in bridge memory and Chrome local storage. It is not written to `.ui-annotations/`, project logs, event records, task packages, or run records. A bridge restart generates a new key. When the extension receives `401 invalid_access_key`, it removes the stale key while preserving pending annotations.

An optional fixed environment key is not part of this implementation. It can be added later if repeated local startup proves too inconvenient.

### Header authentication instead of Origin authentication

Every protected request carries:

```http
X-WebPin-Key: <startup access key>
```

`Origin` remains useful CORS metadata but is not an authentication credential. The bridge allows `content-type` and `x-webpin-key` during preflight.

Only `GET /health` and CORS `OPTIONS` are public. All other endpoints require the access key.

## Startup Behavior

The development command becomes:

```bash
UI_ANNOTATIONS_PROJECT_PATH=/absolute/project/path pnpm dev:bridge
```

Startup performs these checks before listening:

1. The environment variable exists.
2. The configured path is absolute.
3. The directory exists and resolves through `realpath`.
4. The resolved directory is readable and writable.
5. `.ui-annotations/` and its managed subdirectories are real directories, not symbolic links.
6. A random access key is generated.

On success the terminal prints the listening URL, active project name, and startup key. It may print the project basename, but normal HTTP responses must not expose the absolute path or access key.

On configuration or filesystem failure, the process exits non-zero before opening the port. The bridge must not enter a partially usable state.

## HTTP API

### Public health endpoint

`GET /health` returns only service availability and the authentication requirement:

```json
{
  "ok": true,
  "authentication": "access-key"
}
```

This endpoint does not claim that a particular extension client is ready.

### Authenticated session endpoint

`GET /session` verifies the access key and returns non-sensitive active-project metadata:

```json
{
  "ready": true,
  "projectName": "WebPin"
}
```

### Protected existing endpoints

The following endpoints require `X-WebPin-Key` and use the bridge's canonical active project internally:

- `GET /annotations`
- `POST /annotations`
- `PATCH /annotations/:id`
- `DELETE /annotations/:id`
- `GET /project-settings`
- `PATCH /project-settings`
- `POST /assets`
- `POST /tasks`
- `POST /agent-runs`

All `projectPath` query parameters and request fields are removed. Request schemas are strict so a stale client that sends `projectPath` receives `400 invalid_schema` rather than silently continuing.

### Authentication errors

Missing or incorrect keys return:

```json
{
  "error": "invalid_access_key",
  "message": "Enter the current bridge access key in the extension."
}
```

The status is `401`. Key comparison uses equal-length buffers and a timing-safe comparison. The implementation never includes the submitted key in an error or log message.

## Extension Connection Model

The panel uses three user-facing states:

| State | Meaning | Primary action |
|---|---|---|
| `offline` | `/health` cannot be reached | Start the bridge and retry |
| `key-required` | Bridge is online but no valid key is available | Paste the terminal key |
| `ready` | `/session` accepted the current key | Use annotation and task features |

The panel no longer labels a successful health request as fully connected.

The access key is stored in Chrome local storage so restarting Chrome does not require re-entry while the same bridge process remains alive. A `401` clears only the key and connection state. Pending annotations and the most recent selection remain intact.

All bridge requests go through one extension client module. That module adds `X-WebPin-Key`, parses JSON errors, distinguishes network failures from authentication failures, and provides typed methods for annotations, settings, assets, tasks, and agent runs.

## Save Semantics

Saving pending annotations remains sequential so the panel can identify which item failed. After each `201` response, that annotation is removed from the pending list immediately. If a later write fails, only the unsaved remainder stays pending. Retrying therefore does not append another copy of already confirmed annotations.

Loading the saved list after a partial success is best-effort. A refresh failure must not restore annotations already acknowledged by the bridge.

## Filesystem Safety

The bridge stores one canonical project root created with `realpath` at startup. Store functions receive this trusted path from server configuration instead of accepting a path from request data.

Before creating or writing managed directories, the store checks each existing path component with `lstat`. The following managed directories must not be symbolic links:

- `.ui-annotations/`
- `.ui-annotations/tasks/`
- `.ui-annotations/runs/`
- `.ui-annotations/assets/`
- `.ui-annotations/assets/screenshots/`
- `.ui-annotations/assets/crops/`
- `.ui-annotations/assets/dom-snapshots/`

New directories are created normally and checked again before use. File paths continue to use containment checks against the canonical annotation root. A detected symbolic link causes the operation to fail without following the link.

## Code Boundaries

### Bridge

- `apps/bridge/src/config.ts`: startup environment parsing, canonical project validation, writeability checks, and random key creation.
- `apps/bridge/src/auth.ts`: key extraction and timing-safe validation.
- `apps/bridge/src/server.ts`: route definitions and dependency injection of the active project configuration.
- `apps/bridge/src/store.ts`: store operations against a trusted project root plus managed-directory symbolic-link checks.

### Extension

- `apps/extension/src/bridge-client.ts`: authenticated typed HTTP client and normalized errors.
- `apps/extension/src/panel/connection.ts`: connection-state transitions and access-key storage behavior.
- `apps/extension/src/panel/App.tsx`: renders connection controls and delegates bridge operations to the client. Broader panel decomposition remains a later task.
- `apps/extension/src/background.ts`: uses the shared bridge client contract for asset uploads and inline annotation state.

## Testing Strategy

### Bridge unit and API tests

- Reject a missing project environment variable.
- Reject a relative, missing, or non-writable project directory.
- Resolve and retain the canonical active project path.
- Generate a non-empty random startup key.
- Reject missing and incorrect access keys for every protected route.
- Accept a correct key for GET and write routes.
- Confirm `/health` is public and `/session` is protected.
- Reject obsolete `projectPath` fields and query parameters.
- Verify that the access key never appears in responses or run/event files.
- Reproduce a project or managed-directory symbolic-link escape and verify rejection.

### Extension unit tests

- Add `X-WebPin-Key` to every protected request.
- Map network failure to `offline`.
- Map missing or rejected key to `key-required`.
- Map a successful `/session` response to `ready`.
- Clear only the stale key on `401`.
- Preserve pending annotations across authentication failures.
- Remove pending annotations one by one after confirmed writes.

### Packaged-extension Chromium test

The automated test starts a bridge against a temporary project, loads the built MV3 extension, supplies the startup key, and verifies this sequence:

1. The panel reports `ready`.
2. Selection mode highlights a sample element.
3. An inline annotation is added to pending storage.
4. Saving writes `annotations.jsonl`.
5. A GET refresh displays the saved annotation.
6. Status update and deletion work.
7. A selected saved annotation generates JSON, Markdown, and prompt task files.

Screenshot permission and crop behavior are tested in a later screenshot-hardening slice because automated `activeTab` grants require a separate browser interaction design.

## Migration

This is a breaking local API change for version `0.1.0`. No compatibility layer is required.

Existing `.ui-annotations/` data remains valid. The migration changes only bridge startup, request authentication, and removal of browser-supplied project paths. Chrome storage keys for pending annotations and last selection remain valid. The existing stored project path is ignored and removed after the first successful authenticated session.

## Documentation Updates During Implementation

Implementation must update:

- `README.md` with the new startup and key-entry workflow.
- `docs/PROJECT_STATUS.md` with the corrected MVP status and verified browser flow.
- The implementation plan under `docs/superpowers/plans/`.
- Extension manual-check instructions so `Bridge ready` means authenticated session readiness.

## Acceptance Criteria

1. The browser cannot select a project path through any HTTP request.
2. All protected endpoints reject requests without the current startup key.
3. A real extension GET request can load saved annotations after key entry.
4. The panel never reports `ready` based only on `/health`.
5. A symbolic link cannot redirect managed annotation writes outside the canonical project root.
6. Pending annotations survive offline and authentication failures without duplicating confirmed writes.
7. Type checks, all unit/API tests, builds, and the packaged-extension Chromium workflow pass.
