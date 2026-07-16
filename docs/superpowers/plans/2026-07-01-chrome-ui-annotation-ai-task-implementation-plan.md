# Chrome UI Annotation and AI Task Package Implementation Plan

> **Archived historical plan:** This plan records the original 2026-07-01/02 implementation. Do not execute its obsolete allowed-roots environment variables, `projectPath` query parameters, request bodies, or permissive CORS examples. The current completed continuation is `docs/superpowers/plans/2026-07-16-single-project-session-key-implementation-plan.md`, governed by `docs/superpowers/specs/2026-07-16-single-project-session-key-design.md`.

> **Historical execution note (inactive):** The original plan used checkbox steps and required a task-by-task agent workflow. That instruction is retained only as provenance; this archived plan must not be resumed.

**Goal:** Build the MVP Chrome extension and Local File Bridge that capture UI annotations from web prototypes, persist them into `.ui-annotations/`, and generate structured AI task packages.

**Architecture:** Use a TypeScript monorepo with three focused packages: shared schemas, a localhost bridge, and a Chrome MV3 extension. The extension captures annotations and sends them to the bridge; the bridge validates data and writes repo-local annotation/task files.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Zod, Node.js HTTP server, Chrome Manifest V3, React for the extension side panel, Vite for extension UI bundling.

## 2026-07-02 First-Step File Annotation Follow-Up

The first compliant annotation slice adds:

- `file://` content-script matching for local prototypes, gated by Chrome's extension-level file URL access permission.
- Option/Alt-click element capture in the content script.
- Background storage of the most recent selected element.
- A side panel annotation form that saves structured annotation records through the Local File Bridge.
- Documentation for using `UI_ANNOTATIONS_ALLOWED_PROJECT_ROOTS` when saving annotations to a prototype outside this repository.

Remaining MVP work after this slice: live list CRUD, visual region drawing, screenshots/crops, and task generation controls in the extension UI.

---

## 2026-07-02 v1.1 Saved Annotation and Task Controls Follow-Up

The first post-MVP slice adds:

- Local File Bridge `GET /annotations?projectPath=...` for reading active saved annotations.
- Local File Bridge `PATCH /annotations/:id` for narrow editable annotation updates.
- Local File Bridge `DELETE /annotations/:id` for active-list deletion with `annotation.deleted` event traceability.
- Store-level append-only update behavior: annotation updates append a new validated record, while reads fold to the latest non-deleted version.
- Side panel saved annotation list loaded from `.ui-annotations/`.
- Side panel search, status, priority, and target platform filters.
- Side panel controls for saved annotation status updates and deletion.
- Side panel task package generation controls for selected saved annotations.

Remaining v1.1 work after this slice: visual region drawing, source anchor extraction, and browser-level extension automation.

## 2026-07-02 Screenshot and Crop Evidence Follow-Up

This follow-up adds:

- Local File Bridge `GET /project-settings` and `PATCH /project-settings` for `.ui-annotations/project.json`.
- Project-level `screenshotCaptureEnabled` setting, defaulting to `false` for sensitive prototypes.
- Local File Bridge `POST /assets` for validated PNG/JPEG/WebP screenshot and crop writes under `.ui-annotations/assets/`.
- Side panel setting control for enabling screenshot/crop capture per project.
- Background screenshot capture via Chrome's active tab capture flow, with local crop generation from the selected element bounding box.
- Annotation visual anchors populated with local screenshot and crop paths when capture is enabled.

## 2026-07-02 Rich Task Markdown Follow-Up

This follow-up adds:

- Task Markdown evidence sections with screenshot and crop paths when present.
- Target platform and suggested file sections for human and Codex handoff.
- Anchor summaries that keep page URL, selector, text excerpt, and visual bounding box together.
- Suggested next steps in generated Markdown.
- Prompt instructions that explicitly call out evidence paths, visual anchors, DOM anchors, target platforms, and suggested files.

---

## File Structure

- Create `package.json`: workspace scripts and dev dependencies.
- Create `pnpm-workspace.yaml`: workspace package list.
- Create `tsconfig.base.json`: shared strict TypeScript config.
- Create `packages/shared/`: annotation schemas, task schemas, and typed helpers.
- Create `apps/bridge/`: local HTTP bridge for project binding, annotation writes, and task generation.
- Create `apps/extension/`: Chrome MV3 extension, content script, background service worker, and side panel UI.
- Create `examples/sample-project/`: local fixture project for end-to-end verification.
- Modify `README.md`: add setup, development, and verification commands after implementation exists.
- Modify `docs/PROJECT_STATUS.md`: update phase and plan reference as tasks complete.

## Task 1: Workspace Scaffolding

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: Create root package manifest**

Create `package.json`:

```json
{
  "name": "chrome-ui-annotation-ai-task",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "dev:bridge": "pnpm --filter @ui-annotations/bridge dev",
    "dev:extension": "pnpm --filter @ui-annotations/extension dev",
    "verify": "pnpm typecheck && pnpm test && pnpm build"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

- [ ] **Step 2: Create workspace config**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
allowBuilds:
  esbuild: true
```

- [ ] **Step 3: Create shared TypeScript config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 4: Create ignore rules**

Create `.gitignore`:

```gitignore
node_modules/
dist/
.DS_Store
.ui-annotations/
.superpowers/
coverage/
```

- [ ] **Step 5: Install dependencies**

Run: `CI=true pnpm install`

Expected: lockfile is created and workspace install succeeds.

- [ ] **Step 6: Run baseline verification**

Run: `CI=true pnpm typecheck`

Expected: command runs without workspace package errors after packages are added in later tasks.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold annotation workspace"
```

## Task 2: Shared Schemas

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/task-package.ts`
- Create: `packages/shared/src/schemas.test.ts`

- [ ] **Step 1: Create shared package manifest**

Create `packages/shared/package.json`:

```json
{
  "name": "@ui-annotations/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create shared tsconfig**

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write failing schema tests**

Create `packages/shared/src/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { annotationSchema, createTaskPackage, taskPackageSchema } from "./index";

const validAnnotation = {
  id: "ann_001",
  projectId: "sample",
  page: {
    url: "http://localhost:3000/settings",
    route: "/settings",
    title: "Settings",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 }
  },
  anchor: {
    dom: {
      selector: "[data-testid='save-button']",
      xpath: "//*[@data-testid='save-button']",
      textExcerpt: "Save changes",
      boundingBox: { x: 920, y: 740, width: 140, height: 44 }
    },
    visual: {
      screenshot: "assets/screenshots/ann_001.png",
      crop: "assets/crops/ann_001.png",
      boundingBox: { x: 920, y: 740, width: 140, height: 44 }
    }
  },
  note: "Button should be taller.",
  changeType: "layout",
  priority: "medium",
  status: "open",
  targetPlatforms: ["web", "ios-swiftui"],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

describe("annotationSchema", () => {
  it("accepts a valid annotation with DOM and visual anchors", () => {
    expect(annotationSchema.parse(validAnnotation).id).toBe("ann_001");
  });

  it("rejects an annotation without a note", () => {
    expect(() => annotationSchema.parse({ ...validAnnotation, note: "" })).toThrow();
  });
});

describe("createTaskPackage", () => {
  it("creates a valid task package from annotations", () => {
    const taskPackage = createTaskPackage({
      taskId: "task_001",
      annotations: [annotationSchema.parse(validAnnotation)],
      userIntent: "Align save button with form controls.",
      acceptanceCriteria: ["Save button height matches form controls."],
      suggestedFiles: ["src/settings/SettingsForm.tsx"]
    });

    expect(taskPackageSchema.parse(taskPackage).sourceAnnotations).toEqual(["ann_001"]);
  });
});
```

- [ ] **Step 4: Run tests to verify failure**

Run: `CI=true pnpm --filter @ui-annotations/shared test`

Expected: FAIL because `./index` does not exist.

- [ ] **Step 5: Implement schemas**

Create `packages/shared/src/schemas.ts`:

```ts
import { z } from "zod";

export const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive()
});

export const annotationSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  page: z.object({
    url: z.string().url(),
    route: z.string().optional(),
    title: z.string().optional(),
    viewport: z.object({
      width: z.number().positive(),
      height: z.number().positive(),
      deviceScaleFactor: z.number().positive()
    })
  }),
  anchor: z.object({
    dom: z
      .object({
        selector: z.string().min(1).optional(),
        xpath: z.string().min(1).optional(),
        textExcerpt: z.string().optional(),
        boundingBox: boundingBoxSchema
      })
      .optional(),
    source: z
      .object({
        component: z.string().optional(),
        file: z.string().optional(),
        line: z.number().int().positive().optional(),
        gitCommit: z.string().optional()
      })
      .optional(),
    visual: z.object({
      screenshot: z.string().min(1).optional(),
      crop: z.string().min(1).optional(),
      boundingBox: boundingBoxSchema
    })
  }),
  note: z.string().min(1),
  changeType: z.enum(["copy", "layout", "color", "state", "navigation", "platform-parity", "other"]),
  priority: z.enum(["low", "medium", "high"]),
  status: z.enum(["open", "drafted", "sent-to-codex", "resolved", "deleted"]),
  targetPlatforms: z.array(z.enum(["web", "ios-swiftui"])).min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const taskPackageSchema = z.object({
  taskId: z.string().min(1),
  sourceAnnotations: z.array(z.string().min(1)).min(1),
  userIntent: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  evidence: z.object({
    screenshots: z.array(z.string()).default([]),
    crops: z.array(z.string()).default([]),
    domSnapshots: z.array(z.string()).default([])
  }),
  targetPlatforms: z.array(z.enum(["web", "ios-swiftui"])).min(1),
  suggestedFiles: z.array(z.string()).default([]),
  status: z.enum(["draft", "ready", "sent", "resolved"])
});

export type Annotation = z.infer<typeof annotationSchema>;
export type TaskPackage = z.infer<typeof taskPackageSchema>;
```

- [ ] **Step 6: Implement task package helper**

Create `packages/shared/src/task-package.ts`:

```ts
import type { Annotation, TaskPackage } from "./schemas";
import { taskPackageSchema } from "./schemas";

export function createTaskPackage(input: {
  taskId: string;
  annotations: Annotation[];
  userIntent: string;
  acceptanceCriteria: string[];
  suggestedFiles?: string[];
}): TaskPackage {
  const screenshots = input.annotations.flatMap((annotation) =>
    annotation.anchor.visual.screenshot ? [annotation.anchor.visual.screenshot] : []
  );
  const crops = input.annotations.flatMap((annotation) =>
    annotation.anchor.visual.crop ? [annotation.anchor.visual.crop] : []
  );
  const targetPlatforms = Array.from(new Set(input.annotations.flatMap((annotation) => annotation.targetPlatforms)));

  return taskPackageSchema.parse({
    taskId: input.taskId,
    sourceAnnotations: input.annotations.map((annotation) => annotation.id),
    userIntent: input.userIntent,
    acceptanceCriteria: input.acceptanceCriteria,
    evidence: {
      screenshots,
      crops,
      domSnapshots: []
    },
    targetPlatforms,
    suggestedFiles: input.suggestedFiles ?? [],
    status: "draft"
  });
}
```

- [ ] **Step 7: Export public API**

Create `packages/shared/src/index.ts`:

```ts
export { annotationSchema, boundingBoxSchema, taskPackageSchema } from "./schemas";
export type { Annotation, TaskPackage } from "./schemas";
export { createTaskPackage } from "./task-package";
```

- [ ] **Step 8: Run shared tests**

Run: `CI=true pnpm --filter @ui-annotations/shared test`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/shared
git commit -m "feat: add annotation schemas"
```

## Task 3: Local File Bridge MVP

**Files:**
- Create: `apps/bridge/package.json`
- Create: `apps/bridge/tsconfig.json`
- Create: `apps/bridge/src/server.ts`
- Create: `apps/bridge/src/store.ts`
- Create: `apps/bridge/src/store.test.ts`

- [ ] **Step 1: Create bridge package manifest**

Create `apps/bridge/package.json`:

```json
{
  "name": "@ui-annotations/bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@ui-annotations/shared": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.16.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create bridge tsconfig**

Create `apps/bridge/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Write failing store tests**

Create `apps/bridge/src/store.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendAnnotation, createTaskFiles } from "./store.js";

const annotation = {
  id: "ann_001",
  projectId: "sample",
  page: {
    url: "http://localhost:3000/settings",
    route: "/settings",
    title: "Settings",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 }
  },
  anchor: {
    dom: {
      selector: "[data-testid='save-button']",
      boundingBox: { x: 920, y: 740, width: 140, height: 44 }
    },
    visual: {
      screenshot: "assets/screenshots/ann_001.png",
      boundingBox: { x: 920, y: 740, width: 140, height: 44 }
    }
  },
  note: "Button should be taller.",
  changeType: "layout",
  priority: "medium",
  status: "open",
  targetPlatforms: ["web", "ios-swiftui"],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
} as const;

describe("store", () => {
  it("appends validated annotations as jsonl", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    await appendAnnotation(projectPath, annotation);

    const contents = await readFile(join(projectPath, ".ui-annotations", "annotations.jsonl"), "utf8");
    expect(contents).toContain("\"id\":\"ann_001\"");
  });

  it("creates JSON and Markdown task files", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const result = await createTaskFiles(projectPath, {
      taskId: "task_001",
      annotations: [annotation],
      userIntent: "Align save button.",
      acceptanceCriteria: ["Button height matches controls."],
      suggestedFiles: ["src/settings/SettingsForm.tsx"]
    });

    expect(result.jsonPath).toMatch(/task_001\.json$/);
    expect(result.markdownPath).toMatch(/task_001\.md$/);
    const markdown = await readFile(result.markdownPath, "utf8");
    expect(markdown).toContain("Align save button.");
  });
});
```

- [ ] **Step 4: Run tests to verify failure**

Run: `CI=true pnpm --filter @ui-annotations/bridge test`

Expected: FAIL because `./store` does not exist.

- [ ] **Step 5: Implement bridge store**

Create `apps/bridge/src/store.ts`:

```ts
import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { annotationSchema, createTaskPackage, type Annotation } from "@ui-annotations/shared";

function annotationRoot(projectPath: string): string {
  return join(projectPath, ".ui-annotations");
}

export async function ensureAnnotationDirs(projectPath: string): Promise<void> {
  const root = annotationRoot(projectPath);
  await mkdir(join(root, "tasks"), { recursive: true });
  await mkdir(join(root, "assets", "screenshots"), { recursive: true });
  await mkdir(join(root, "assets", "crops"), { recursive: true });
  await mkdir(join(root, "assets", "dom-snapshots"), { recursive: true });
}

export async function appendAnnotation(projectPath: string, rawAnnotation: unknown): Promise<Annotation> {
  const annotation = annotationSchema.parse(rawAnnotation);
  await ensureAnnotationDirs(projectPath);
  await appendFile(
    join(annotationRoot(projectPath), "annotations.jsonl"),
    `${JSON.stringify(annotation)}\n`,
    "utf8"
  );
  await appendFile(
    join(annotationRoot(projectPath), "events.jsonl"),
    `${JSON.stringify({ type: "annotation.created", annotationId: annotation.id, at: annotation.createdAt })}\n`,
    "utf8"
  );
  return annotation;
}

export async function createTaskFiles(
  projectPath: string,
  input: {
    taskId: string;
    annotations: Annotation[];
    userIntent: string;
    acceptanceCriteria: string[];
    suggestedFiles?: string[];
  }
): Promise<{ jsonPath: string; markdownPath: string }> {
  await ensureAnnotationDirs(projectPath);
  const taskPackage = createTaskPackage(input);
  const jsonPath = join(annotationRoot(projectPath), "tasks", `${input.taskId}.json`);
  const markdownPath = join(annotationRoot(projectPath), "tasks", `${input.taskId}.md`);

  await writeFile(jsonPath, `${JSON.stringify(taskPackage, null, 2)}\n`, "utf8");
  await writeFile(
    markdownPath,
    [
      `# ${input.taskId}`,
      "",
      `## Intent`,
      "",
      input.userIntent,
      "",
      `## Acceptance Criteria`,
      "",
      ...input.acceptanceCriteria.map((criterion) => `- ${criterion}`),
      "",
      `## Source Annotations`,
      "",
      ...taskPackage.sourceAnnotations.map((id) => `- ${id}`),
      ""
    ].join("\n"),
    "utf8"
  );

  return { jsonPath, markdownPath };
}
```

- [ ] **Step 6: Implement minimal HTTP server**

Create `apps/bridge/src/server.ts`:

```ts
import { createServer } from "node:http";
import { appendAnnotation, createTaskFiles } from "./store.js";

const host = "127.0.0.1";
const port = Number(process.env.UI_ANNOTATIONS_BRIDGE_PORT ?? 48731);

async function readJson(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "POST" && request.url === "/annotations") {
    const body = (await readJson(request)) as { projectPath: string; annotation: unknown };
    const annotation = await appendAnnotation(body.projectPath, body.annotation);
    response.writeHead(201, { "content-type": "application/json" });
    response.end(JSON.stringify({ annotation }));
    return;
  }

  if (request.method === "POST" && request.url === "/tasks") {
    const body = (await readJson(request)) as Parameters<typeof createTaskFiles>[1] & { projectPath: string };
    const result = await createTaskFiles(body.projectPath, body);
    response.writeHead(201, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, host, () => {
  console.log(`ui-annotations bridge listening at http://${host}:${port}`);
});
```

- [ ] **Step 7: Run bridge tests**

Run: `CI=true pnpm --filter @ui-annotations/bridge test`

Expected: PASS.

Run: `CI=true pnpm --filter @ui-annotations/bridge typecheck`

Expected: PASS.

Run: `CI=true pnpm --filter @ui-annotations/bridge build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/bridge
git commit -m "feat: add local annotation bridge"
```

## Task 4: Chrome Extension Shell

**Files:**
- Create: `apps/extension/package.json`
- Create: `apps/extension/tsconfig.json`
- Create: `apps/extension/vite.config.ts`
- Create: `apps/extension/public/manifest.json`
- Create: `apps/extension/src/background.ts`
- Create: `apps/extension/src/content.ts`
- Create: `apps/extension/src/panel/App.tsx`
- Create: `apps/extension/src/panel/main.tsx`
- Create: `apps/extension/src/panel/index.html`

- [ ] **Step 1: Create extension package manifest**

Create `apps/extension/package.json`:

```json
{
  "name": "@ui-annotations/extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.3.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@ui-annotations/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create extension tsconfig**

Create `apps/extension/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["chrome", "vite/client"],
    "noEmit": true
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 3: Create Vite config**

Create `apps/extension/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: "src/panel/index.html",
        background: "src/background.ts",
        content: "src/content.ts"
      },
      output: {
        entryFileNames: "[name].js"
      }
    }
  }
});
```

- [ ] **Step 4: Create MV3 manifest**

Create `apps/extension/public/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "UI Annotations",
  "version": "0.1.0",
  "description": "Annotate web prototypes and generate AI task packages.",
  "permissions": ["activeTab", "scripting", "storage", "sidePanel"],
  "host_permissions": ["http://127.0.0.1:48731/*"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content.js"]
    }
  ],
  "side_panel": {
    "default_path": "panel.html"
  },
  "action": {
    "default_title": "UI Annotations"
  }
}
```

- [ ] **Step 5: Implement background service worker**

Create `apps/extension/src/background.ts`:

```ts
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ui-annotations.health") {
    fetch("http://127.0.0.1:48731/health")
      .then((response) => response.json())
      .then((body) => sendResponse({ ok: true, bridge: body }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});
```

- [ ] **Step 6: Implement content script shell**

Create `apps/extension/src/content.ts`:

```ts
const overlay = document.createElement("div");
overlay.style.position = "fixed";
overlay.style.pointerEvents = "none";
overlay.style.zIndex = "2147483647";
overlay.style.border = "2px solid #22c55e";
overlay.style.borderRadius = "6px";
overlay.style.display = "none";
document.documentElement.appendChild(overlay);

function updateOverlay(target: Element): void {
  const rect = target.getBoundingClientRect();
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.display = "block";
}

document.addEventListener(
  "mousemove",
  (event) => {
    const target = event.target;
    if (target instanceof Element && target !== overlay) {
      updateOverlay(target);
    }
  },
  { passive: true }
);
```

- [ ] **Step 7: Implement side panel shell**

Create `apps/extension/src/panel/App.tsx`:

```tsx
import { useEffect, useState } from "react";

export function App() {
  const [bridgeStatus, setBridgeStatus] = useState("checking");

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "ui-annotations.health" }, (response) => {
      setBridgeStatus(response?.ok ? "connected" : "unavailable");
    });
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>UI Annotations</h1>
      <p>Bridge: {bridgeStatus}</p>
      <button type="button">New annotation</button>
    </main>
  );
}
```

Create `apps/extension/src/panel/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

createRoot(root).render(<App />);
```

Create `apps/extension/src/panel/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>UI Annotations</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Build extension**

Run: `CI=true pnpm --filter @ui-annotations/extension build`

Expected: PASS and `apps/extension/dist` contains `background.js`, `content.js`, and panel assets.

- [ ] **Step 9: Commit**

```bash
git add apps/extension
git commit -m "feat: add chrome extension shell"
```

## Task 5: End-to-End Sample Project Verification

**Files:**
- Create: `examples/sample-project/index.html`
- Create: `examples/sample-project/README.md`
- Modify: `README.md`
- Modify: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Create sample prototype page**

Create `examples/sample-project/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sample Prototype</title>
    <style>
      body {
        font-family: system-ui, sans-serif;
        margin: 40px;
      }
      button {
        height: 36px;
        padding: 0 16px;
      }
    </style>
  </head>
  <body>
    <h1>Settings</h1>
    <label>
      Display name
      <input data-testid="display-name" value="Joker" />
    </label>
    <button data-testid="save-button">Save changes</button>
  </body>
</html>
```

- [ ] **Step 2: Create sample project README**

Create `examples/sample-project/README.md`:

```markdown
# Sample Project

Use this page to verify the Chrome extension content script and Local File Bridge.

Run a static server from this directory, open the page in Chrome, load the extension from `apps/extension/dist`, and confirm that hover highlights appear on UI elements.
```

- [ ] **Step 3: Run complete verification**

Run: `CI=true pnpm verify`

Expected: all packages typecheck, test, and build successfully.

- [ ] **Step 4: Update README with implemented commands**

Modify `README.md` to include:

```markdown
## Development Commands

- Install dependencies: `pnpm install`
- Run bridge: `pnpm dev:bridge`
- Build extension: `CI=true pnpm --filter @ui-annotations/extension build`
- Verify all packages: `CI=true pnpm verify`
```

- [ ] **Step 5: Update project status**

Modify `docs/PROJECT_STATUS.md` so the phase reflects implemented MVP scaffolding after the above verification passes.

- [ ] **Step 6: Commit**

```bash
git add examples README.md docs/PROJECT_STATUS.md
git commit -m "test: add sample prototype verification"
```

## Self-Review

- Spec coverage:
  - Annotation schemas are covered by Task 2.
  - Project-file storage is covered by Task 3.
  - Local File Bridge is covered by Task 3.
  - Chrome extension shell, content script, and side panel are covered by Task 4.
  - End-to-end sample verification is covered by Task 5.
  - iOS automation is intentionally excluded from MVP and remains roadmap work in the PRD.
- Placeholder scan:
  - This plan contains no `TBD`, `TODO`, or unspecified implementation steps.
- Type consistency:
  - `Annotation`, `TaskPackage`, `annotationSchema`, `taskPackageSchema`, and `createTaskPackage` are defined in Task 2 and consumed by later tasks.
