# Project Status

## Snapshot

- Date: 2026-07-16
- Phase: MVP stabilization
- Base product requirements: `docs/superpowers/specs/2026-07-01-chrome-ui-annotation-ai-task-prd.md` (its legacy bridge binding/authentication clauses are superseded)
- Active stabilization spec: `docs/superpowers/specs/2026-07-16-single-project-session-key-design.md`
- Completed stabilization record: `docs/superpowers/plans/2026-07-16-single-project-session-key-implementation-plan.md`
- Verification baseline: `CI=true pnpm verify` and `CI=true pnpm test:e2e:extension` passed on 2026-07-16.

## Current Architecture

- One Local File Bridge process owns one canonical project configured at startup with `UI_ANNOTATIONS_PROJECT_PATH`.
- The bridge binds to `127.0.0.1`; startup resolves and validates the project before listening.
- Browser requests never supply or switch the project path.
- `GET /health` and CORS preflight are public. Protected routes require the per-process key in `X-WebPin-Key`.
- `Origin` controls CORS response metadata only and is not an authentication credential.
- Durable project state remains under `.ui-annotations/`.
- The controlled agent route accepts only a task ID and `agent: "codex"`; it does not accept a command or project path.

## Verified on 2026-07-16

Fresh local verification established the following:

- Type checks, production builds, and 103 unit/API tests across 20 test files passed.
- The packaged MV3 extension loaded in Chromium and authenticated with the startup key.
- The panel reached `Ready` only after a successful authenticated session.
- Inline element selection created an annotation in the pending list.
- Saving wrote `annotations.jsonl`; an authenticated `GET /annotations` reloaded it without a project-path query.
- Status update and delete operations persisted and were reflected after refresh.
- Task generation emitted matching JSON, Markdown, and Codex prompt files.
- The packaged test completed without browser console or page errors.

The implementation also has automated unit/API coverage for:

- Required absolute, readable, writable canonical project configuration.
- Timing-safe startup-key validation and non-sensitive session metadata.
- Strict request schemas that reject obsolete browser `projectPath` input.
- Static symbolic links in the managed annotation directory tree.
- Sequential save acknowledgement, partial failure, retry behavior, duplicate IDs, and refresh failure after acknowledgement.
- Serialized concurrent pending-list mutations in the background owner and recovery after a failed Chrome storage write.
- Browser-safe agent responses containing only `runId` and `status`, while full run records remain local.

## Implemented Product Capabilities

- MV3 extension shell, side panel, content overlay, keyboard command, and `file://` support when Chrome permission is enabled.
- DOM element capture with selector, XPath, text excerpt, bounding box, page URL/route/title, and viewport metadata.
- Inline annotation editing and pending annotation persistence.
- Saved annotation search and filters, status updates, deletion, and append-only event traceability.
- Task package generation as `.json`, `.md`, and `.prompt.md`.
- Prompt templates for web, SwiftUI, cross-platform parity, UI QA, and planning work.
- Configurable screenshot and crop capture with narrow local asset writes. This path remains default-off because captures may be sensitive.
- Controlled synchronous Codex execution with complete local run records.
- GitHub Actions jobs for fast verification and isolated packaged-extension Chromium verification.

## Remaining Product Work

1. Harden packaged-browser coverage for screenshot capture, Chrome `activeTab` grants, and crop output.
2. Add visual-region drawing for feedback that is not tied to one DOM element.
3. Add source-anchor extraction.
4. Implement DOM snapshot capture; only its storage directory is currently reserved.
5. Replace synchronous Codex HTTP execution with an asynchronous queue and polling model.
6. Decompose the large panel `App` into narrower components and hooks.

## Residual Risks and Follow-ups

- Static managed-directory symbolic links are rejected, including links introduced before a write. A hostile local process that swaps a parent directory between validation and file I/O remains a time-of-check/time-of-use limitation of the current portable high-level Node filesystem approach. This is proportionate to the personal-use, same-machine MVP threat model, but it is not a claim of safety under adversarial concurrent filesystem mutation.
- Pending mutations are serialized through the extension background owner. Chrome storage still offers no atomic compare-and-remove primitive, leaving a narrow window if another independent actor mutates the same key outside that owner.
- Task response paths use Node's platform-native separator; Windows browser responses may contain backslashes. This is a minor portability cleanup.
- Bridge tests cover representative authentication, schema, response-sanitization, and error cases. A table-driven every-route auth matrix, empty-patch policy assertions, and richer error-metadata assertions would improve coverage but are not current workflow blockers.
- Screenshot assets and full Codex run records are local but may contain sensitive data. They should remain excluded from remote storage unless a future design explicitly adds it.

## Scope Boundaries

- No cloud backend, accounts, multi-user collaboration, assignments, comments, or live sync.
- No browser-selected project path.
- No arbitrary shell commands through the bridge.
- No direct iOS code modification from the extension.
- No assumption that DOM elements map one-to-one to SwiftUI components.
