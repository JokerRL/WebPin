# Chrome UI Annotation and AI Task Package

This project defines and will implement a Chrome-based annotation workflow for reviewing web product prototypes and turning UI feedback into structured AI task packages.

## Current Status

- Product direction is approved.
- PRD is written at `docs/superpowers/specs/2026-07-01-chrome-ui-annotation-ai-task-prd.md`.
- MVP has been implemented and verified for local prototype annotation, repo-local storage, and structured AI task package generation.
- v1.1 is underway: the side panel can load saved annotations from `.ui-annotations/`, filter them, update status, delete active annotations with event traceability, generate richer task package files from selected annotations, send generated tasks to Codex through a controlled local runner, and optionally capture local screenshot/crop evidence per project.

## MVP Scope

The MVP is a personal workflow tool for a solo product builder:

1. Open a local or hosted web prototype.
2. Enable Chrome annotation mode.
3. Select a DOM element or draw a visual region.
4. Add a structured annotation.
5. Review annotations in a live list.
6. Persist annotation data into the project repository under `.ui-annotations/`.
7. Generate structured AI task packages for Codex or future MCP workflows.

## Architecture

The approved MVP architecture is **Chrome Extension + Local File Bridge**.

- **Chrome Extension**
  - Injects annotation UI into prototype pages.
  - Highlights hovered elements.
  - Captures DOM, visual, page, and optional source anchors.
  - Provides a side panel or popup for annotation management.

- **Local File Bridge**
  - Runs locally on `127.0.0.1`.
  - Binds browser origins or URL patterns to local project paths.
  - Writes validated annotation files under `.ui-annotations/`.
  - Writes screenshot and crop assets only through a narrow image asset endpoint.
  - Generates JSON, Markdown, and Codex prompt task files.
  - Does not execute arbitrary shell commands.
  - Can run only a whitelisted Codex task command for generated task packages.

- **Project Annotation Store**
  - `.ui-annotations/project.json`
  - `.ui-annotations/annotations.jsonl`
  - `.ui-annotations/events.jsonl`
  - `.ui-annotations/tasks/*.json`
  - `.ui-annotations/tasks/*.md`
  - `.ui-annotations/tasks/*.prompt.md`
  - `.ui-annotations/runs/*.json`
  - `.ui-annotations/assets/screenshots/*`
  - `.ui-annotations/assets/crops/*`
  - `.ui-annotations/assets/dom-snapshots/*`

## Non-Goals For MVP

- No cloud backend.
- No multi-user collaboration.
- No direct iOS code modification.
- No guaranteed web-to-iOS component mapping.
- No full Figma integration.
- No Chrome Web Store publishing requirement.

## Roadmap

- **MVP**: Annotation capture, project-file storage, structured AI task packages.
- **v1.1**: Saved annotation management, task package generation controls, Codex prompt generation, suggested files, patch proposal drafts.
- **v1.5**: MCP-assisted edits with human approval and build/test hooks.
- **v2.0**: Web-to-iOS mapping, XcodeBuildMCP simulator verification, visual diff feedback.

## Development Commands

- Install dependencies: `CI=true pnpm install`
- Run bridge: `pnpm dev:bridge`
- Run bridge for a prototype outside this repository: `UI_ANNOTATIONS_ALLOWED_PROJECT_ROOTS=/absolute/project/path pnpm dev:bridge`
- Build extension: `CI=true pnpm --filter @ui-annotations/extension build`
- Verify all packages: `CI=true pnpm verify`
- Check Codex CLI: `codex --version`

## File Prototype Annotation Workflow

1. Build the extension with `CI=true pnpm --filter @ui-annotations/extension build`.
2. Load `apps/extension/dist` as an unpacked Chrome extension.
3. In Chrome extension details for **UI Annotations**, enable **Allow access to file URLs**.
4. Start the bridge from this repository if annotations should be written here:
   `pnpm dev:bridge`
5. If annotations should be written next to another prototype, start the bridge with that project root explicitly allowed:
   `UI_ANNOTATIONS_ALLOWED_PROJECT_ROOTS=/Users/joker/Desktop/familyLocator/prototype pnpm dev:bridge`
6. Open the local prototype, for example `file:///Users/joker/Desktop/familyLocator/prototype/app.html#welcome`.
7. Open the extension side panel and confirm `Bridge: connected`.
8. Leave **Capture screenshot and crop** off for sensitive pages, or enable it to write local evidence under `.ui-annotations/assets/`.
9. Click **Select element** in the side panel, or press `Ctrl+Shift+Y` (`MacCtrl+Shift+Y` on macOS).
10. Click the UI element to annotate. The extension enters edit mode and blocks page click/navigation handlers while selecting and editing.
11. Use the inline popup beside the selected element to enter the note, type, priority, and target platforms, then click **Save**. This adds the annotation to the side panel's pending list.
12. Review the side panel's **Pending annotations** list, then click **Save all to files** to append the list to `.ui-annotations/annotations.jsonl`.
13. Use **Saved annotations** to refresh from project files, filter saved annotations, update status, delete active annotations, and select annotations for task generation.
14. Use **Task package** to draft a task from selected annotations, apply a prompt template, edit the intent and acceptance criteria, and generate `.ui-annotations/tasks/<task-id>.json`, `.md`, and `.prompt.md`.
15. Click **Send to Codex** to run the generated prompt through the controlled local Codex runner.

Saved annotations are appended to `.ui-annotations/annotations.jsonl` under the chosen project path, with an event in `.ui-annotations/events.jsonl`.

When screenshot capture is enabled, the bridge stores `assets/screenshots/<annotation-id>.png` and `assets/crops/<annotation-id>.png` locally and records their paths in the annotation's visual anchor. Generated task Markdown includes evidence paths, target platforms, suggested files, anchor summaries, and suggested next steps.

## Controlled Codex Runner

The bridge exposes `POST /agent-runs` for one narrow automation path:

```json
{
  "projectPath": "/absolute/project/path",
  "taskId": "task_001",
  "agent": "codex"
}
```

The bridge validates the project path and task id, reads `.ui-annotations/tasks/<task-id>.prompt.md`, and runs Codex with a fixed argument shape:

```bash
codex exec --sandbox workspace-write "<prompt file contents>"
```

Run results are written to `.ui-annotations/runs/<run-id>.json`. The browser cannot submit arbitrary commands.

## Prompt Templates

The side panel includes execution prompt templates. Annotation notes describe what should change; templates describe who the agent should act as, how to parse task JSON/Markdown, how to use anchors, how to implement, and how to report verification.

- Web frontend implementer
- iOS SwiftUI implementer
- Web + iOS parity implementer
- UI QA fixer
- Implementation planner

Select saved annotations, choose a template, then click **Apply** to fill the task intent and acceptance criteria before generating task files. The generated intent includes parsing instructions for task package fields, DOM anchors, visual anchors, source anchors, target platforms, and suggested files.

## Manual Extension Check

1. Run `CI=true pnpm verify`.
2. Run the bridge with `pnpm dev:bridge`.
3. Serve `examples/sample-project/` with a local static server.
4. Load `apps/extension/dist` as an unpacked Chrome extension.
5. Open the sample page and confirm hovered elements receive a green overlay.

## Key Documents

- PRD: `docs/superpowers/specs/2026-07-01-chrome-ui-annotation-ai-task-prd.md`
- Implementation plan: `docs/superpowers/plans/2026-07-01-chrome-ui-annotation-ai-task-implementation-plan.md`
- Project status: `docs/PROJECT_STATUS.md`
- Agent instructions: `AGENTS.md`
