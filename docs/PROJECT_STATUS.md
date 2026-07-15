# Project Status

## Snapshot

- Date: 2026-07-02
- Phase: MVP complete; v1.1 saved annotation management, task generation controls, controlled Codex runner, screenshot/crop evidence capture, and richer task Markdown implemented
- Primary spec: `docs/superpowers/specs/2026-07-01-chrome-ui-annotation-ai-task-prd.md`

## Confirmed Decisions

- Build a Chrome extension for annotating web product prototypes.
- Use a Local File Bridge for repo-local persistence because Chrome extensions cannot freely write arbitrary local project files.
- Store annotation data in `.ui-annotations/`.
- Generate structured AI task packages as JSON and Markdown.
- Design anchors as three complementary layers:
  - DOM anchor: selector, XPath, text excerpt, bounding box, URL, viewport.
  - Source anchor: component, file, line, git commit when available.
  - Visual anchor: screenshot, crop, visual bounding box.
- MVP is personal-first.
- Collaboration, MCP-assisted code editing, iOS simulator verification, and visual diff feedback are later phases.

## MVP Deliverables

- Implemented: TypeScript pnpm workspace.
- Implemented: shared annotation and task package schemas.
- Implemented: Local File Bridge store and minimal HTTP API.
- Implemented: bridge validation for malformed JSON, invalid schemas, project path allowlist, and task id traversal.
- Implemented: Chrome MV3 extension shell with background health check, content overlay, and side panel shell.
- Implemented: `file://` content-script support when Chrome's file URL access permission is enabled.
- Implemented: Option/Alt-click element capture with DOM selector, XPath, text excerpt, bounding box, page URL, route, and viewport metadata.
- Implemented: side panel annotation form that saves selected element annotations through the Local File Bridge.
- Implemented: side panel saved annotation list loaded from `.ui-annotations/`.
- Implemented: saved annotation search, status filter, priority filter, and target platform filter.
- Implemented: saved annotation status updates through the Local File Bridge.
- Implemented: saved annotation delete flow that removes annotations from active views and records `annotation.deleted` events.
- Implemented: side panel task package generation controls for selected saved annotations.
- Implemented: task prompt file generation at `.ui-annotations/tasks/<task-id>.prompt.md`.
- Implemented: controlled `POST /agent-runs` bridge endpoint for `agent: "codex"`.
- Implemented: fixed-shape Codex execution via `codex exec --sandbox workspace-write`.
- Implemented: run records under `.ui-annotations/runs/`.
- Implemented: side panel execution prompt templates for Web, iOS SwiftUI, cross-platform parity, UI QA fixes, and planning-only runs.
- Implemented: project-level screenshot capture setting stored in `.ui-annotations/project.json`.
- Implemented: screenshot and crop asset upload through a narrow Local File Bridge endpoint.
- Implemented: visual anchors can reference local screenshot and crop evidence under `.ui-annotations/assets/`.
- Implemented: task Markdown includes evidence, target platforms, suggested files, anchor summaries, and suggested next steps for Codex-oriented handoff.
- Implemented: sample prototype fixture.
- Implemented: project-file annotation storage and task package generation through bridge store/API.
- Not yet implemented: visual region drawing, source anchor extraction, async/background agent queue, and automated browser-level extension checks.

## MVP Non-Goals

- Cloud backend.
- Multi-user collaboration.
- Direct iOS code modification.
- Guaranteed web-to-iOS component mapping.
- Full Figma integration.
- Chrome Web Store publishing.

## Completed Implementation Plan

The implementation plan is available at `docs/superpowers/plans/2026-07-01-chrome-ui-annotation-ai-task-implementation-plan.md`.

It implemented these independently verifiable tasks:

1. Workspace scaffolding.
2. Shared schema package.
3. Local File Bridge.
4. Chrome extension content script.
5. Chrome extension panel UI.
6. Bridge integration.
7. Task package generation.
8. End-to-end verification flow.
9. Documentation updates.

## Open Questions For Implementation Planning

- How the first project binding UI should choose and persist local project paths.
- Which browser-level manual checks should be automated first for screenshot/crop capture.
- How much annotation state should live in Chrome storage before bridge persistence.
- How task package generation should group multiple annotations.
- Which browser-level manual checks should be automated first.

## Recommended Next Slice

1. Add visual region drawing for non-DOM-specific feedback.
2. Add source anchor extraction from common prototype metadata attributes.
3. Upgrade the controlled Codex runner from synchronous HTTP execution to a background queue with polling.
4. Add manual and automated end-to-end browser verification, including screenshot/crop capture checks.
