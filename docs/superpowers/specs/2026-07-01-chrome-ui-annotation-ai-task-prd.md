# Chrome UI Annotation and AI Task Package PRD

## 1. Executive Summary

- **Problem Statement**: When reviewing web product prototypes, UI change requests are often captured as loose notes, screenshots, or chat messages that lose element context, source context, and implementation intent. This makes later iOS implementation slower and error-prone because developers and AI agents must reconstruct what UI element was meant and what acceptance criteria apply.
- **Proposed Solution**: Build a Chrome extension plus local file bridge that lets a solo product builder select UI elements on a web prototype, add structured annotations, persist them into the project repository, and generate AI-readable task packages for Codex or future MCP-assisted iOS implementation.
- **Success Criteria**:
  - A user can create, edit, delete, filter, and mark status for annotations without leaving the prototype page.
  - >= 95% of saved annotations include at least one DOM anchor and one visual anchor.
  - A structured task package can be generated from one or more annotations in under 3 seconds for a local project.
  - Codex can read a generated task package and identify the requested UI change, evidence, and acceptance criteria without additional manual explanation in >= 90% of evaluation cases.
  - Annotation data is persisted into project files under `.ui-annotations/` with no required cloud account.

## 2. User Experience & Functionality

### User Personas

- **Primary MVP persona**: Solo product builder who reviews a local or hosted web prototype, records UI change requests, and later asks Codex or an iOS developer workflow to implement them.
- **Future collaborator persona**: Product, design, and development teammates who need shared annotation lists, ownership, comments, and status workflows. The MVP stores fields that can support this later, but does not implement multi-user collaboration.

### User Stories

- **Story**: As a solo product builder, I want to turn on annotation mode from Chrome so that I can review a prototype without switching tools.
  - **Acceptance Criteria**:
    - The extension provides a visible control to enter and exit annotation mode.
    - Annotation mode highlights hovered UI elements without permanently modifying the page.
    - The user can select a DOM element or manually draw a visual region.

- **Story**: As a solo product builder, I want to attach a structured note to a selected UI element so that the requested change keeps its visual and technical context.
  - **Acceptance Criteria**:
    - The annotation editor captures note text, change type, priority, status, target platform, and optional expected result.
    - Each saved annotation includes page URL, route if detectable, viewport size, bounding box, screenshot reference, and DOM selector or XPath where available.
    - If source metadata is available, the annotation stores component name, source file, line number, and git commit.

- **Story**: As a solo product builder, I want a live annotation list so that I can review, edit, remove, and triage changes quickly.
  - **Acceptance Criteria**:
    - The side panel lists annotations for the current page and project.
  - The list supports search, status filter, priority filter, and target platform filter.
  - Selecting a list item scrolls or focuses the relevant page element when the anchor is still valid.
  - Deleted annotations are removed from active views and recorded in `events.jsonl` to preserve traceability.

- **Story**: As a solo product builder, I want annotations saved into the project repository so that Codex and future engineering workflows can consume them.
  - **Acceptance Criteria**:
    - The Local File Bridge writes project files under `.ui-annotations/`.
    - The extension can bind a browser origin or URL pattern to a local project path.
    - Writes are limited to the selected project annotation directory unless explicitly configured otherwise.
    - Local writes fail visibly with actionable errors when the bridge is unavailable.

- **Story**: As a solo product builder, I want to generate AI task packages from annotations so that Codex can turn product feedback into implementation work.
  - **Acceptance Criteria**:
    - A task package can be generated from one annotation or a selected group of annotations.
    - The package includes source annotations, user intent, evidence, target platforms, acceptance criteria, suggested files if known, and status.
    - The package is emitted as both machine-readable JSON and human-readable Markdown.
    - MVP task packages do not directly modify source code.

### Non-Goals

- No cloud SaaS backend in MVP.
- No multi-user accounts, live collaboration, comments, assignment, or permissions in MVP.
- No direct web-to-iOS automatic code modification in MVP.
- No guaranteed one-to-one mapping between web DOM components and iOS SwiftUI components in MVP.
- No full Figma integration in MVP; the data model only reserves visual anchors for future static design sources.
- No Chrome Web Store publishing requirement for MVP; local development installation is sufficient.

## 3. AI System Requirements

### Tool Requirements

- **Chrome Extension Runtime**: Content script, side panel or popup UI, background service worker, tab messaging, screenshot capture where allowed.
- **Local Prototype Runtime**: For `file://` prototypes, the unpacked Chrome extension requires the user to enable Chrome's file URL access permission. Local file writes still go through the Local File Bridge and its explicit project-root allowlist.
- **Local File Bridge**: Local service bound to `127.0.0.1`, responsible for project binding, file writes, screenshot and DOM snapshot persistence, and task package generation.
- **Project Files**: `.ui-annotations/` directory as the durable interface between annotation capture and AI or engineering workflows.
- **Future Codex/MCP Integration**:
  - Codex reads task package JSON/Markdown.
  - Optional later MCP bridge can invoke code-editing workflows.
  - Optional later XcodeBuildMCP integration can build, run, screenshot, and verify iOS simulator output.

### Evaluation Strategy

- Create a benchmark set of 30 prototype review cases covering copy, spacing, color, layout, state, navigation, and platform parity changes.
- For each case, verify that the generated task package includes:
  - Correct user intent.
  - At least one valid visual evidence reference.
  - At least one DOM anchor when the source is a live web page.
  - Concrete acceptance criteria.
  - Correct target platform labels.
- AI-readiness passes when Codex can summarize the requested change and propose next engineering steps without asking for missing UI context in >= 90% of cases.
- Anchor quality passes when >= 95% of annotations include sufficient evidence to relocate the target element after minor DOM changes.

## 4. Technical Specifications

### Architecture Overview

The MVP uses a three-layer architecture:

1. **Chrome Extension**
   - Content script inspects DOM, renders hover highlights, supports element selection and region selection, captures DOM metadata, and requests screenshots.
   - Side panel or popup manages the live annotation list, annotation editor, filters, status changes, and task generation controls.
   - Background service worker coordinates tab state, extension storage cache, and communication with the Local File Bridge.

2. **Local File Bridge**
   - Runs on localhost and exposes a narrow HTTP or WebSocket API.
   - Binds browser URLs or origins to local project paths.
   - Writes annotations, assets, DOM snapshots, and task packages into `.ui-annotations/`.
   - Performs schema validation before file writes.
   - Does not execute arbitrary shell commands in MVP.

3. **Project Annotation Store**
   - Durable repo-local source of truth for annotations and tasks.
   - Designed for direct consumption by Codex, scripts, MCP servers, and future collaboration layers.

### Data Flow

1. User opens a prototype page and activates annotation mode.
2. Content script captures selected target metadata:
   - DOM selector, XPath, text excerpt, attributes, bounding box, URL, route, viewport.
   - Screenshot and optional cropped screenshot.
   - Source metadata if provided by development tooling or embedded data attributes.
3. Extension panel creates or updates an annotation record.
4. Background service worker sends the record to the Local File Bridge.
5. Local File Bridge validates and writes the record to `.ui-annotations/annotations.jsonl`.
6. When requested, Local File Bridge groups selected annotations into `.ui-annotations/tasks/<task-id>.json` and `.ui-annotations/tasks/<task-id>.md`.
7. Codex or a future MCP workflow reads the task package and performs implementation planning or patch generation.

### File Layout

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

### Annotation Record Schema

```json
{
  "id": "ann_001",
  "projectId": "project_slug",
  "page": {
    "url": "http://localhost:3000/settings",
    "route": "/settings",
    "title": "Settings",
    "viewport": { "width": 1440, "height": 900, "deviceScaleFactor": 1 }
  },
  "anchor": {
    "dom": {
      "selector": "[data-testid='save-button']",
      "xpath": "//*[@data-testid='save-button']",
      "textExcerpt": "Save changes",
      "boundingBox": { "x": 920, "y": 740, "width": 140, "height": 44 }
    },
    "source": {
      "component": "SettingsSaveButton",
      "file": "src/settings/SettingsForm.tsx",
      "line": 128,
      "gitCommit": "abc123"
    },
    "visual": {
      "screenshot": "assets/screenshots/ann_001.png",
      "crop": "assets/crops/ann_001.png",
      "boundingBox": { "x": 920, "y": 740, "width": 140, "height": 44 }
    }
  },
  "note": "Button should be taller and aligned with the input baseline.",
  "changeType": "layout",
  "priority": "medium",
  "status": "open",
  "targetPlatforms": ["web", "ios-swiftui"],
  "createdAt": "2026-07-01T00:00:00.000Z",
  "updatedAt": "2026-07-01T00:00:00.000Z"
}
```

### AI Task Package Schema

```json
{
  "taskId": "task_001",
  "sourceAnnotations": ["ann_001"],
  "userIntent": "Make the save button visually match the form controls and preserve parity in iOS.",
  "acceptanceCriteria": [
    "Web save button height matches adjacent form controls.",
    "iOS SwiftUI save button uses the equivalent height and alignment.",
    "No other settings page controls shift unexpectedly."
  ],
  "evidence": {
    "screenshots": ["assets/screenshots/ann_001.png"],
    "crops": ["assets/crops/ann_001.png"],
    "domSnapshots": ["assets/dom-snapshots/ann_001.html"]
  },
  "targetPlatforms": ["web", "ios-swiftui"],
  "suggestedFiles": [
    "src/settings/SettingsForm.tsx",
    "ios/App/SettingsView.swift"
  ],
  "status": "draft"
}
```

### Integration Points

- **Browser to Bridge**: Local HTTP or WebSocket API with an explicit project binding handshake.
- **File Prototype to Extension**: Content scripts may run on `file://` prototypes only when the user enables file URL access for the unpacked extension.
- **Bridge to Project Files**: Schema-validated file writes under `.ui-annotations/`.
- **Project Files to Codex**: Codex reads JSON/Markdown task packages as implementation context.
- **Future MCP Linkage**: A later MCP workflow can pick up a task package, create a patch proposal, run build/tests, and update task status.
- **Future iOS Verification**: XcodeBuildMCP can run simulator builds and capture screenshots for visual comparison after code changes.

### Security & Privacy

- Local File Bridge binds to `127.0.0.1` only.
- The extension must require an explicit user action before connecting a website to a local project path.
- Bridge writes are restricted to `.ui-annotations/` by default.
- Screenshots and DOM snapshots may include sensitive content; the MVP must provide a visible setting to disable screenshot capture per project.
- No cloud upload occurs in MVP.
- The bridge must reject requests from unbound origins.

## 5. Risks & Roadmap

### Phased Rollout

- **MVP**
  - Chrome extension annotation mode.
  - Element and region selection.
  - Live annotation list with edit, delete, filter, and status.
  - Local File Bridge.
  - Project-file annotation storage.
  - Structured AI task package generation.

- **v1.1**
  - Codex prompt generation from task packages.
  - Suggested affected files based on project indexing or source anchors.
  - Patch proposal drafting, still requiring manual approval.
  - Better source anchor extraction for React, Vue, and Next.js projects.

- **v1.5**
  - MCP-assisted code editing with explicit human approval.
  - Build/test command integration.
  - Task status updates based on successful validation.

- **v2.0**
  - Web-to-iOS component mapping dictionary.
  - XcodeBuildMCP simulator runs.
  - iOS screenshot capture and visual diff feedback.
  - Optional collaboration layer with user identity, assignments, comments, and sync.

### Technical Risks

- **Anchor drift**: DOM selectors may break after page changes. Mitigation: store DOM, source, visual, text, and screenshot evidence together.
- **File access complexity**: Chrome extensions cannot freely write repo files. Mitigation: use a narrow Local File Bridge with project binding.
- **Security risk from localhost bridge**: A malicious page could attempt local requests. Mitigation: origin binding, local-only host, request tokens, and path restrictions.
- **AI overreach**: Direct code edits can be wrong or unsafe. Mitigation: MVP outputs task packages only; code execution is a later gated capability.
- **Web-to-iOS parity ambiguity**: Web DOM structure may not map cleanly to SwiftUI code. Mitigation: introduce source anchors now and a component mapping dictionary later.
- **Sensitive capture**: Screenshots and DOM snapshots may contain private data. Mitigation: per-project screenshot controls and clear local-only storage defaults.
