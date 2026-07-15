# Agent Instructions

## Project Purpose

Build a Chrome extension and local file bridge that lets a user annotate web product prototypes and generate structured AI task packages for Codex and future MCP-assisted iOS implementation.

Before making implementation changes, read:

1. `README.md`
2. `docs/PROJECT_STATUS.md`
3. `docs/superpowers/specs/2026-07-01-chrome-ui-annotation-ai-task-prd.md`
4. `docs/superpowers/plans/2026-07-01-chrome-ui-annotation-ai-task-implementation-plan.md`

## Approved Product Decisions

- MVP persona: solo product builder.
- MVP architecture: Chrome Extension + Local File Bridge.
- Storage source of truth: project files under `.ui-annotations/`.
- AI output: structured task packages, not automatic code edits.
- iOS automation is phased after MVP.
- Future collaboration is allowed by schema design, but not implemented in MVP.

## Do Not Drift

- Do not add a cloud backend in MVP.
- Do not implement multi-user accounts, assignments, comments, or live sync in MVP.
- Do not directly modify iOS code from the Chrome extension in MVP.
- Do not make the Local File Bridge execute arbitrary shell commands in MVP.
- Do not assume web DOM elements map one-to-one to SwiftUI components.
- Do not store screenshots remotely unless a future spec explicitly adds cloud sync.

## Required Documentation Hygiene

When changing architecture, scope, storage layout, task package schema, or security behavior:

1. Update `README.md`.
2. Update `docs/PROJECT_STATUS.md`.
3. Update or add a spec under `docs/superpowers/specs/`.
4. If implementation work is planned, update or add a plan under `docs/superpowers/plans/`.

Keep docs precise and current. Future agents should be able to understand the project without reading prior chat history.

## Technical Guardrails

- The Local File Bridge must bind to `127.0.0.1`.
- Project writes should be restricted to `.ui-annotations/` by default.
- Browser origins must be explicitly bound to local project paths.
- Screenshot capture must be configurable because screenshots may contain sensitive information.
- Data schemas should preserve DOM, source, and visual anchors together.
- Prefer small, focused files with clear responsibilities.

## Expected Project File Layout

```text
.ui-annotations/
  project.json
  annotations.jsonl
  events.jsonl
  tasks/
    task-001.json
    task-001.md
  assets/
    screenshots/
    crops/
    dom-snapshots/
```
