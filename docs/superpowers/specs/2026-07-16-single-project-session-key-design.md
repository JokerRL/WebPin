# Single-Project Session Key Design

## Status

- Date: 2026-07-16
- State: Implemented and verified
- Scope: Local File Bridge authentication, canonical project selection, path safety, extension connection state, pending-write integrity, and packaged-browser verification

## Context

The earlier bridge accepted a browser-supplied `projectPath` and treated an origin allowlist as authorization. Real Chromium exposed the central reliability flaw: extension GET requests could omit `Origin`, so annotation writes appeared to work while saved annotations and project settings failed to load. The browser also held unnecessary authority over local filesystem selection, and lexical path checks did not stop a configured in-root symbolic link from redirecting managed writes.

WebPin's MVP is a personal, same-machine tool. It does not need multi-project switching within one bridge process, accounts, cloud identity, or a pairing protocol. The implemented repair reduces browser authority and gives the panel a truthful authenticated session state.

## Goals and Boundaries

The design:

1. Makes extension GET and write requests independent of the presence of an `Origin` header.
2. Restricts each bridge process to one explicitly configured canonical project.
3. Removes project paths from browser API inputs.
4. Authenticates protected requests with a per-process key.
5. Distinguishes offline, key-required, and authenticated-ready states.
6. Rejects static symbolic links in the managed annotation directory tree.
7. Preserves pending annotations through partial writes and authentication failures.
8. Verifies the real built MV3 extension in Chromium.

This slice does not add persistent accounts, remote access, multi-project switching, cloud storage, collaboration, visual-region drawing, source anchors, DOM snapshot capture, screenshot `activeTab` browser coverage, or an asynchronous Codex queue.

## Implemented Decisions

### One canonical project per bridge process

The bridge requires this startup form:

```bash
UI_ANNOTATIONS_PROJECT_PATH=/absolute/project/path pnpm dev:bridge
```

Before listening, startup requires an absolute existing directory, resolves it with `realpath`, confirms it is a readable and writable directory, validates the managed annotation directories, and generates a random access key. The resolved path is injected into every store operation. The browser cannot provide, override, or switch it.

To work on another project, the user stops the bridge and starts a bridge process configured for that project.

### Per-process startup access key

The bridge generates a cryptographically random key and prints it with the local listening URL and project basename. The user pastes the full key into the extension panel.

The key exists in bridge memory and Chrome local storage. It is not intentionally written to annotation, event, task, or run records. A restart generates a new key. When the current key is rejected, the extension clears the stale key and project-name credential only if they still match the failed attempt, preserving pending annotations and avoiding an older request clearing a newer successful session.

### Header authentication; Origin only for CORS

Every protected request carries:

```http
X-WebPin-Key: <startup access key>
```

`GET /health` and CORS `OPTIONS` are public. All other routes require the key. Comparison uses equal-length buffers and `timingSafeEqual`. Missing or incorrect keys receive `401 invalid_access_key` without echoing submitted credentials.

`Origin` is used only to decide whether to return an `Access-Control-Allow-Origin` header. It is not authorization. Preflight permits `content-type` and `x-webpin-key`.

## HTTP Contract

### Public health

`GET /health` reports only service availability and the authentication scheme:

```json
{
  "ok": true,
  "authentication": "access-key"
}
```

It does not establish an authenticated client session.

### Authenticated session

`GET /session` returns non-sensitive project metadata after key validation:

```json
{
  "ready": true,
  "projectName": "WebPin"
}
```

### Protected routes

The canonical server-owned project is used by:

- `GET /annotations`
- `POST /annotations`
- `PATCH /annotations/:id`
- `DELETE /annotations/:id`
- `GET /project-settings`
- `PATCH /project-settings`
- `POST /assets`
- `POST /tasks`
- `POST /agent-runs`

Request schemas are strict. A `projectPath` request field or query parameter is rejected instead of ignored.

The controlled agent request accepts only:

```json
{
  "taskId": "task_001",
  "agent": "codex"
}
```

The browser receives only `{ "run": { "runId": "...", "status": "completed" } }` (or `failed`). Command arguments, output, prompt path, task ID, timestamps, and exit details remain in the local `.ui-annotations/runs/<run-id>.json` record.

## Extension Connection Model

| State | Meaning | User action |
|---|---|---|
| `offline` | Public health cannot be reached | Start the bridge and retry |
| `key-required` | The bridge is online but no valid key is active | Paste the printed key and connect |
| `ready` | `/session` accepted the current key | Use protected annotation and task controls |

The panel does not report `ready` based on `/health`. Latest-attempt gating prevents a stale connection attempt from overwriting newer connection state. A successful session stores the project name and removes the obsolete project-path storage key.

Pending annotations are associated with a project-derived ID. The panel blocks saving a pending batch when it belongs to a different authenticated project rather than silently writing it into the current project.

## Pending Save and Mutation Semantics

Pending writes are sequential and acknowledgement-only:

1. The panel takes a snapshot of the current pending list.
2. It sends one annotation to the bridge.
3. Only after a `201` response does it ask the background owner to acknowledge that annotation ID.
4. The background owner removes the first matching item from the current stored list and returns the new current state.
5. The panel renders that returned current state; it does not replace storage with a stale calculated remainder.

If a later write fails, confirmed annotations stay removed and the unsaved remainder stays pending. Duplicate IDs are removed one acknowledged occurrence at a time. A saved-list refresh failure after the final acknowledgement does not resurrect confirmed pending items.

All background pending-list appends and removals share one serialized promise chain. Each operation reads the latest Chrome storage array immediately before mutation, writes the result, and leaves the chain usable after a rejected storage write. This protects concurrent panel/content operations inside the background owner.

## Filesystem Safety and Threat Model

The server passes one canonical startup path to the store. Managed locations are checked with `lstat` and must be real directories:

- `.ui-annotations/`
- `.ui-annotations/tasks/`
- `.ui-annotations/runs/`
- `.ui-annotations/assets/`
- `.ui-annotations/assets/screenshots/`
- `.ui-annotations/assets/crops/`
- `.ui-annotations/assets/dom-snapshots/`

Directory creation handles concurrent `EEXIST` races, then checks the resulting entry. Task, asset, and run filenames also use narrow validation and containment checks.

This prevents a static symbolic-link layout from redirecting a managed write. It does not make file operations race-free under hostile concurrent local filesystem mutation: another process with access could swap a parent directory after validation but before the subsequent I/O. Closing that parent-directory time-of-check/time-of-use gap requires lower-level descriptor-relative operations or a different platform-specific storage boundary. The current protection is proportionate to WebPin's personal-use, same-user threat model and must not be described as safe against an adversarial concurrent filesystem actor.

## Screenshot Boundary

Project-level screenshot/crop capture is implemented and configurable, defaulting off. Asset writes use an authenticated narrow image endpoint and local relative paths. Because screenshots may contain sensitive information, they remain local.

The packaged browser test intentionally does not assert screenshot capture. Chrome `activeTab` grant behavior and crop verification require a separate interaction/hardening design.

## Implementation Verification

Verified on 2026-07-16 with:

```bash
CI=true pnpm verify
CI=true pnpm test:e2e:extension
git diff --check
```

Evidence from the fresh run:

- Type checks passed for the shared, bridge, and extension packages.
- 20 test files passed with 103 unit/API tests: shared 3, bridge 43, extension 57.
- Shared, bridge, and extension production builds passed.
- Packaged Chromium loaded the real MV3 extension and completed key authentication, inline selection, pending save, authenticated GET reload, status update, task JSON/Markdown/prompt generation, and delete/refresh.
- The packaged run reported no browser console or page errors.

GitHub Actions enforces the same outcomes on push and pull request with a fast `pnpm verify` job and a separate isolated Chromium job that installs the browser with system dependencies before running `pnpm test:e2e:extension`.

## Acceptance Criteria Result

1. Browser requests cannot select a project path: verified by strict API tests and the packaged GET request.
2. Protected routes require the current startup key: implemented and covered by authentication/API tests.
3. The packaged extension can load saved annotations after key entry: verified in Chromium.
4. The panel reaches `ready` only after `/session`: implemented and covered by unit plus browser tests.
5. Static managed-directory symbolic links are rejected: covered by store regressions, with the concurrent-swap residual documented above.
6. Offline/auth failures and partial saves preserve unacknowledged pending work without duplicating acknowledged writes: covered by pending-save, credential, and mutation tests.
7. Type checks, unit/API tests, builds, and packaged Chromium verification pass: verified on 2026-07-16.
