# Single-Project Session Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-supplied project paths and Origin-based authorization with one canonical bridge project plus a per-process access key, then prove the repaired annotation workflow in packaged Chromium.

**Architecture:** The bridge resolves one project at startup and injects that trusted configuration into every route. A small authenticated extension client owns all HTTP calls and drives explicit `offline`, `key-required`, and `ready` connection states. Store operations reject symbolic-link managed directories, and a Playwright test loads the built MV3 extension to verify the real GET/save/task flow.

**Tech Stack:** TypeScript, Node.js HTTP and filesystem APIs, React 18, Chrome Manifest V3, Zod, Vitest, pnpm workspaces, Playwright Chromium.

---

## File Map

### New files

- `apps/bridge/src/config.ts`: load and validate the single active project and generate the startup key.
- `apps/bridge/src/config.test.ts`: startup configuration tests with injected filesystem dependencies.
- `apps/bridge/src/auth.ts`: extract and timing-safely validate `X-WebPin-Key`.
- `apps/bridge/src/auth.test.ts`: authentication unit tests.
- `apps/extension/src/bridge-client.ts`: typed authenticated HTTP client used by the panel and background worker.
- `apps/extension/src/bridge-client.test.ts`: request-header and normalized-error tests.
- `apps/extension/src/panel/connection.ts`: pure connection-state reducer and storage-key constants.
- `apps/extension/src/panel/connection.test.ts`: offline, key-required, ready, and stale-key tests.
- `apps/extension/src/panel/pending-save.ts`: sequential pending-save helper that removes only acknowledged annotations.
- `apps/extension/src/panel/pending-save.test.ts`: partial-save and retry regression tests.
- `apps/extension/src/annotation-factory.ts`: create annotations from a trusted project name rather than a local path.
- `apps/extension/src/annotation-factory.test.ts`: annotation construction tests.
- `apps/extension/scripts/extension-e2e.mjs`: packaged-extension Chromium workflow.

### Modified files

- `apps/bridge/src/store.ts`: validate managed directories against symbolic links.
- `apps/bridge/src/store.test.ts`: symbolic-link escape regressions.
- `apps/bridge/src/server.ts`: inject bridge config, require the key, remove request `projectPath`, and add `/session`.
- `apps/bridge/src/server.test.ts`: authenticated route and obsolete-field tests.
- `apps/extension/src/background.ts`: stop reading project paths and use the authenticated client contract.
- `apps/extension/src/panel/App.tsx`: replace raw fetch/project-path UI with connection controls and typed client calls.
- `apps/extension/src/panel/i18n.ts`: add connection/key copy and remove path-specific instructions.
- `apps/extension/src/panel/i18n.test.ts`: cover new English and Chinese connection copy.
- `apps/extension/package.json`: add the extension E2E script if kept package-local.
- `package.json`: add Playwright and root E2E/verification commands.
- `README.md`: document the single-project startup and access-key workflow.
- `docs/PROJECT_STATUS.md`: replace the inaccurate MVP-complete statement with verified status.
- `docs/superpowers/specs/2026-07-16-single-project-session-key-design.md`: mark the implemented verification state after completion.

## Task 1: Canonical Bridge Startup Configuration

**Files:**
- Create: `apps/bridge/src/config.ts`
- Create: `apps/bridge/src/config.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Create `apps/bridge/src/config.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { loadBridgeConfig } from "./config.js";

const dependencies = {
  realpath: vi.fn(async (path: string) => `/canonical${path}`),
  access: vi.fn(async () => undefined),
  stat: vi.fn(async () => ({ isDirectory: () => true })),
  randomKey: vi.fn(() => "test-startup-key")
};

describe("loadBridgeConfig", () => {
  it("requires an explicitly configured project path", async () => {
    await expect(loadBridgeConfig({}, dependencies)).rejects.toThrow("UI_ANNOTATIONS_PROJECT_PATH is required");
  });

  it("rejects relative project paths", async () => {
    await expect(
      loadBridgeConfig({ UI_ANNOTATIONS_PROJECT_PATH: "relative/project" }, dependencies)
    ).rejects.toThrow("must be absolute");
  });

  it("returns a canonical project and generated startup key", async () => {
    await expect(
      loadBridgeConfig({ UI_ANNOTATIONS_PROJECT_PATH: "/workspace/WebPin" }, dependencies)
    ).resolves.toEqual({
      projectPath: "/canonical/workspace/WebPin",
      projectName: "WebPin",
      accessKey: "test-startup-key"
    });
    expect(dependencies.access).toHaveBeenCalledWith("/canonical/workspace/WebPin", expect.any(Number));
  });

  it("rejects a configured path that is not a directory", async () => {
    const notDirectory = { ...dependencies, stat: vi.fn(async () => ({ isDirectory: () => false })) };
    await expect(
      loadBridgeConfig({ UI_ANNOTATIONS_PROJECT_PATH: "/workspace/file" }, notDirectory)
    ).rejects.toThrow("must be a directory");
  });

  it("rejects a project that cannot be read and written", async () => {
    const inaccessible = { ...dependencies, access: vi.fn(async () => { throw new Error("EACCES"); }) };
    await expect(
      loadBridgeConfig({ UI_ANNOTATIONS_PROJECT_PATH: "/workspace/private" }, inaccessible)
    ).rejects.toThrow("EACCES");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
CI=true pnpm --filter @ui-annotations/bridge test -- src/config.test.ts
```

Expected: FAIL because `config.ts` does not exist.

- [ ] **Step 3: Implement startup configuration**

Create `apps/bridge/src/config.ts`:

```ts
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { basename, isAbsolute } from "node:path";

export type BridgeConfig = {
  projectPath: string;
  projectName: string;
  accessKey: string;
};

type ConfigDependencies = {
  realpath: (path: string) => Promise<string>;
  access: (path: string, mode: number) => Promise<void>;
  stat: (path: string) => Promise<{ isDirectory(): boolean }>;
  randomKey: () => string;
};

const defaultDependencies: ConfigDependencies = {
  realpath,
  access,
  stat,
  randomKey: () => randomBytes(24).toString("base64url")
};

export async function loadBridgeConfig(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: ConfigDependencies = defaultDependencies
): Promise<BridgeConfig> {
  const configuredPath = env.UI_ANNOTATIONS_PROJECT_PATH?.trim();
  if (!configuredPath) throw new Error("UI_ANNOTATIONS_PROJECT_PATH is required");
  if (!isAbsolute(configuredPath)) throw new Error("UI_ANNOTATIONS_PROJECT_PATH must be absolute");

  const projectPath = await dependencies.realpath(configuredPath);
  const projectStat = await dependencies.stat(projectPath);
  if (!projectStat.isDirectory()) throw new Error("UI_ANNOTATIONS_PROJECT_PATH must be a directory");
  await dependencies.access(projectPath, constants.R_OK | constants.W_OK);

  return {
    projectPath,
    projectName: basename(projectPath),
    accessKey: dependencies.randomKey()
  };
}
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
CI=true pnpm --filter @ui-annotations/bridge test -- src/config.test.ts
CI=true pnpm --filter @ui-annotations/bridge typecheck
```

Expected: configuration tests PASS and bridge typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/config.ts apps/bridge/src/config.test.ts
git commit -m "feat: add single-project bridge config"
```

## Task 2: Access-Key Authentication

**Files:**
- Create: `apps/bridge/src/auth.ts`
- Create: `apps/bridge/src/auth.test.ts`

- [ ] **Step 1: Write failing authentication tests**

Create `apps/bridge/src/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AccessKeyError, assertAccessKey } from "./auth.js";

describe("assertAccessKey", () => {
  it("accepts the current key", () => {
    expect(() => assertAccessKey("current-key", "current-key")).not.toThrow();
  });

  it.each([undefined, "", "wrong-key"])("rejects invalid key %s", (submitted) => {
    expect(() => assertAccessKey(submitted, "current-key")).toThrow(AccessKeyError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
CI=true pnpm --filter @ui-annotations/bridge test -- src/auth.test.ts
```

Expected: FAIL because `auth.ts` does not exist.

- [ ] **Step 3: Implement timing-safe key validation**

Create `apps/bridge/src/auth.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

export class AccessKeyError extends Error {
  readonly code = "invalid_access_key";
  readonly status = 401;

  constructor() {
    super("Enter the current bridge access key in the extension.");
  }
}

export function assertAccessKey(submittedKey: string | undefined, expectedKey: string): void {
  if (!submittedKey) throw new AccessKeyError();
  const submitted = Buffer.from(submittedKey);
  const expected = Buffer.from(expectedKey);
  if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) {
    throw new AccessKeyError();
  }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
CI=true pnpm --filter @ui-annotations/bridge test -- src/auth.test.ts
```

Expected: 3 authentication cases PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/auth.ts apps/bridge/src/auth.test.ts
git commit -m "feat: add bridge access-key validation"
```

## Task 3: Reject Symbolic-Link Managed Directories

**Files:**
- Modify: `apps/bridge/src/store.ts`
- Modify: `apps/bridge/src/store.test.ts`

- [ ] **Step 1: Add a failing symbolic-link regression test**

Append to `apps/bridge/src/store.test.ts`:

```ts
import { mkdir, mkdtemp, symlink } from "node:fs/promises";

it("rejects a symbolic-link annotation root", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-project-"));
  const outsidePath = await mkdtemp(join(tmpdir(), "ui-annotations-outside-"));
  await symlink(outsidePath, join(projectPath, ".ui-annotations"));

  await expect(ensureAnnotationDirs(projectPath)).rejects.toThrow("managed annotation directory must not be a symbolic link");
});

it("rejects a symbolic-link managed child directory", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-project-"));
  const outsidePath = await mkdtemp(join(tmpdir(), "ui-annotations-outside-"));
  await mkdir(join(projectPath, ".ui-annotations"));
  await symlink(outsidePath, join(projectPath, ".ui-annotations", "tasks"));

  await expect(ensureAnnotationDirs(projectPath)).rejects.toThrow("managed annotation directory must not be a symbolic link");
});
```

Also add `ensureAnnotationDirs` to the existing store imports and merge the new filesystem imports with the current import statement.

- [ ] **Step 2: Run the focused store tests to verify failure**

Run:

```bash
CI=true pnpm --filter @ui-annotations/bridge test -- src/store.test.ts
```

Expected: both new tests FAIL because `mkdir(..., { recursive: true })` follows the links.

- [ ] **Step 3: Implement safe directory creation**

In `apps/bridge/src/store.ts`, add `lstat` to the filesystem imports and replace `ensureAnnotationDirs` with:

```ts
async function ensureManagedDirectory(path: string): Promise<void> {
  try {
    const existing = await lstat(path);
    if (existing.isSymbolicLink()) {
      throw new Error("managed annotation directory must not be a symbolic link");
    }
    if (!existing.isDirectory()) {
      throw new Error("managed annotation path must be a directory");
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    await mkdir(path);
    const created = await lstat(path);
    if (created.isSymbolicLink() || !created.isDirectory()) {
      throw new Error("managed annotation directory is unsafe");
    }
  }
}

export async function ensureAnnotationDirs(projectPath: string): Promise<void> {
  const root = annotationRoot(projectPath);
  const directories = [
    root,
    join(root, "tasks"),
    join(root, "runs"),
    join(root, "assets"),
    join(root, "assets", "screenshots"),
    join(root, "assets", "crops"),
    join(root, "assets", "dom-snapshots")
  ];
  for (const directory of directories) await ensureManagedDirectory(directory);
}
```

Delete the obsolete `assertSafeProjectPath` export from `store.ts` and its allowlist-specific tests from `store.test.ts`. The canonical startup project replaces the old browser-path allowlist model.

- [ ] **Step 4: Run store and bridge tests**

Run:

```bash
CI=true pnpm --filter @ui-annotations/bridge test -- src/store.test.ts
CI=true pnpm --filter @ui-annotations/bridge test
```

Expected: all store and bridge tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/store.ts apps/bridge/src/store.test.ts
git commit -m "fix: reject symlinked annotation directories"
```

## Task 4: Convert the Bridge API to Single-Project Authenticated Routes

**Files:**
- Modify: `apps/bridge/src/server.ts`
- Modify: `apps/bridge/src/server.test.ts`

- [ ] **Step 1: Update the server test harness and add failing auth tests**

In `apps/bridge/src/server.test.ts`, make every test server use fixed options:

```ts
const accessKey = "server-test-key";
const authorizedHeaders = {
  origin: "chrome-extension://test-extension",
  "x-webpin-key": accessKey
};

function createTestHandler(projectPath: string, overrides = {}) {
  return createBridgeRequestHandler({
    projectPath,
    projectName: "test-project",
    accessKey,
    allowedOrigins: ["chrome-extension://*"],
    ...overrides
  });
}
```

Add these tests before migrating the existing route cases:

```ts
it("keeps health public but describes access-key authentication", async () => {
  const response = await request(createTestHandler(projectPath), { method: "GET", path: "/health" });
  expect(response).toMatchObject({ status: 200, body: { ok: true, authentication: "access-key" } });
});

it("rejects a protected route without a key", async () => {
  const response = await request(createTestHandler(projectPath), { method: "GET", path: "/session" });
  expect(response).toMatchObject({ status: 401, body: { error: "invalid_access_key" } });
});

it("returns non-sensitive session metadata for a valid key", async () => {
  const response = await request(createTestHandler(projectPath), {
    method: "GET",
    path: "/session",
    headers: authorizedHeaders
  });
  expect(response).toMatchObject({ status: 200, body: { ready: true, projectName: "test-project" } });
  expect(JSON.stringify(response.body)).not.toContain(projectPath);
  expect(JSON.stringify(response.body)).not.toContain(accessKey);
});

it("rejects obsolete projectPath input", async () => {
  const response = await request(createTestHandler(projectPath), {
    method: "POST",
    path: "/annotations",
    headers: authorizedHeaders,
    body: { projectPath, annotation }
  });
  expect(response).toMatchObject({ status: 400, body: { error: "invalid_schema" } });
});

it("never writes the access key to project records", async () => {
  await request(createTestHandler(projectPath), {
    method: "POST",
    path: "/annotations",
    headers: authorizedHeaders,
    body: { annotation }
  });
  const annotations = await readFile(join(projectPath, ".ui-annotations", "annotations.jsonl"), "utf8");
  const events = await readFile(join(projectPath, ".ui-annotations", "events.jsonl"), "utf8");
  expect(`${annotations}\n${events}`).not.toContain(accessKey);
});

it("returns project-relative task paths", async () => {
  const response = await request(createTestHandler(projectPath), {
    method: "POST",
    path: "/tasks",
    headers: authorizedHeaders,
    body: {
      taskId: "task_001",
      annotations: [annotation],
      userIntent: "Update the save button.",
      acceptanceCriteria: ["The button is taller."]
    }
  });
  expect(response.status).toBe(201);
  expect(JSON.stringify(response.body)).not.toContain(projectPath);
  expect(response.body).toMatchObject({
    jsonPath: ".ui-annotations/tasks/task_001.json",
    markdownPath: ".ui-annotations/tasks/task_001.md",
    promptPath: ".ui-annotations/tasks/task_001.prompt.md"
  });
});
```

Add `readFile` and `join` imports for the persistence assertion. Migrate the existing route cases with this exact request mapping:

| Route | Request body after migration |
|---|---|
| `GET /annotations` | none |
| `GET /project-settings` | none |
| `PATCH /project-settings` | `{ patch: { screenshotCaptureEnabled } }` |
| `POST /assets` | `{ annotationId, kind, dataUrl }` |
| `POST /annotations` | `{ annotation }` |
| `PATCH /annotations/:id` | `{ patch }` |
| `DELETE /annotations/:id` | `{}` |
| `POST /tasks` | `{ taskId, annotations, userIntent, acceptanceCriteria, suggestedFiles }` |
| `POST /agent-runs` | `{ taskId, agent: "codex" }` |

Pass `authorizedHeaders` to each case in this table and use a path without a `projectPath` query string.

- [ ] **Step 2: Run server tests to verify failure**

Run:

```bash
CI=true pnpm --filter @ui-annotations/bridge test -- src/server.test.ts
```

Expected: FAIL because the handler does not accept active-project options, `/session` does not exist, and schemas still require `projectPath`.

- [ ] **Step 3: Replace request schemas with strict path-free schemas**

In `apps/bridge/src/server.ts`, define:

```ts
const annotationsRequestSchema = z.object({ annotation: z.unknown() }).strict();
const annotationUpdateRequestSchema = z.object({ patch: annotationPatchSchema }).strict();
const annotationDeleteRequestSchema = z.object({}).strict();
const projectSettingsUpdateRequestSchema = z.object({ patch: projectSettingsPatchSchema }).strict();
const assetRequestSchema = z.object({
  annotationId: z.string().min(1),
  kind: z.enum(["screenshot", "crop"]),
  dataUrl: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/)
}).strict();
const tasksRequestSchema = z.object({
  taskId: z.string().min(1),
  annotations: z.array(annotationSchema).min(1),
  userIntent: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  suggestedFiles: z.array(z.string()).optional()
}).strict();
const agentRunsRequestSchema = z.object({ taskId: z.string().min(1), agent: z.literal("codex") }).strict();
```

- [ ] **Step 4: Inject trusted config and protect routes**

Import `AccessKeyError`, `assertAccessKey`, `loadBridgeConfig`, and `BridgeConfig`. Change server options and route setup to:

```ts
type BridgeOptions = BridgeConfig & {
  allowedOrigins?: string[];
  runCodexTask?: typeof defaultRunCodexTask;
};

export function createBridgeRequestHandler(options: BridgeOptions) {
  const { projectPath, projectName, accessKey } = options;
  const allowedOrigins = options.allowedOrigins ?? defaultAllowedOrigins();
  const runCodexTask = options.runCodexTask ?? defaultRunCodexTask;

  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("Access-Control-Allow-Origin", allowedOriginsHeader(request, allowedOrigins));
      response.setHeader("Access-Control-Allow-Headers", "content-type,x-webpin-key");
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/health") {
        sendJson(response, 200, { ok: true, authentication: "access-key" });
        return;
      }

      assertAccessKey(request.headers["x-webpin-key"] as string | undefined, accessKey);

      if (requestUrl.searchParams.has("projectPath")) {
        throw new HttpError(400, "invalid_schema", "projectPath is no longer accepted.");
      }

      if (request.method === "GET" && requestUrl.pathname === "/session") {
        sendJson(response, 200, { ready: true, projectName });
        return;
      }
    } catch (error) {
      handleError(response, error);
    }
  };
}
```

Change the server factory to require the same options:

```ts
export function createBridgeServer(options: BridgeOptions) {
  return createServer(createBridgeRequestHandler(options));
}
```

Change `allowedOriginsHeader` to accept `allowedOrigins` as its second argument and call `isAllowedOrigin(origin, allowedOrigins)`. Pass the handler's injected `allowedOrigins` when setting the response header so tests and production use the same CORS configuration.

Add this branch at the top of `handleError`:

```ts
if (error instanceof AccessKeyError) {
  sendJson(response, error.status, { error: error.code, message: error.message });
  return;
}
```

Remove `assertAllowedOrigin` from protected routes. Keep origin reflection only for allowed CORS origins.

- [ ] **Step 5: Remove request paths from every route and load config before listen**

Each route should call its store operation with the closed-over `projectPath`. For example:

```ts
if (request.method === "GET" && requestUrl.pathname === "/annotations") {
  sendJson(response, 200, { annotations: await listAnnotations(projectPath) });
  return;
}

if (request.method === "POST" && requestUrl.pathname === "/annotations") {
  const body = annotationsRequestSchema.parse(await readJson(request));
  sendJson(response, 201, { annotation: await appendAnnotation(projectPath, body.annotation) });
  return;
}
```

For `POST /tasks`, keep store paths internal and return relative paths:

```ts
const created = await createTaskFiles(projectPath, {
  taskId: body.taskId,
  annotations: body.annotations,
  userIntent: body.userIntent,
  acceptanceCriteria: body.acceptanceCriteria,
  ...(body.suggestedFiles ? { suggestedFiles: body.suggestedFiles } : {})
});
sendJson(response, 201, {
  jsonPath: relative(projectPath, created.jsonPath),
  markdownPath: relative(projectPath, created.markdownPath),
  promptPath: relative(projectPath, created.promptPath)
});
```

Add `relative` to the `node:path` imports.

Replace the main block with:

```ts
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = await loadBridgeConfig();
  await ensureAnnotationDirs(config.projectPath);
  createBridgeServer(config).listen(port, host, () => {
    console.log(`ui-annotations bridge listening at http://${host}:${port}`);
    console.log(`project: ${config.projectName}`);
    console.log(`access key: ${config.accessKey}`);
  });
}
```

Add `ensureAnnotationDirs` to the store imports. Delete `defaultAllowedProjectRoots` and remove the `assertSafeProjectPath` import and all route calls. No browser or server code should retain a second path-authorization model.

- [ ] **Step 6: Run server and full bridge tests**

Run:

```bash
CI=true pnpm --filter @ui-annotations/bridge test -- src/server.test.ts
CI=true pnpm --filter @ui-annotations/bridge test
CI=true pnpm --filter @ui-annotations/bridge typecheck
```

Expected: all protected endpoints pass with the key, fail without it, and no request accepts `projectPath`.

- [ ] **Step 7: Commit**

```bash
git add apps/bridge/src/server.ts apps/bridge/src/server.test.ts
git commit -m "feat: authenticate a single bridge project"
```

## Task 5: Add the Authenticated Extension Bridge Client

**Files:**
- Create: `apps/extension/src/bridge-client.ts`
- Create: `apps/extension/src/bridge-client.test.ts`

- [ ] **Step 1: Write failing client tests**

Create `apps/extension/src/bridge-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { BridgeClientError, createBridgeClient } from "./bridge-client";

describe("createBridgeClient", () => {
  it("adds the access key to protected requests", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ready: true, projectName: "WebPin" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const client = createBridgeClient({ accessKey: "secret", fetcher });
    await client.getSession();
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:48731/session", expect.objectContaining({
      headers: expect.objectContaining({ "x-webpin-key": "secret" })
    }));
  });

  it("does not attach the key to public health", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, authentication: "access-key" })));
    await createBridgeClient({ accessKey: "secret", fetcher }).getHealth();
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("x-webpin-key")).toBe(false);
  });

  it("normalizes a rejected key", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_access_key" }), { status: 401 }));
    await expect(createBridgeClient({ accessKey: "old", fetcher }).getSession()).rejects.toMatchObject({ kind: "auth" });
  });

  it("normalizes a network failure", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(createBridgeClient({ accessKey: "key", fetcher }).getHealth()).rejects.toMatchObject({ kind: "offline" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
CI=true pnpm --filter @ui-annotations/extension test -- src/bridge-client.test.ts
```

Expected: FAIL because `bridge-client.ts` does not exist.

- [ ] **Step 3: Implement the shared client**

Create `apps/extension/src/bridge-client.ts` with this public contract:

```ts
import type { Annotation } from "@ui-annotations/shared";

const defaultBridgeUrl = "http://127.0.0.1:48731";

export type EditableAnnotationPatch = Partial<{
  note: Annotation["note"];
  changeType: Annotation["changeType"];
  priority: Annotation["priority"];
  status: Exclude<Annotation["status"], "deleted">;
  targetPlatforms: Annotation["targetPlatforms"];
}>;

export class BridgeClientError extends Error {
  constructor(public readonly kind: "offline" | "auth" | "http", message: string) {
    super(message);
  }
}

type ClientOptions = {
  accessKey: string;
  fetcher?: typeof fetch;
  bridgeUrl?: string;
};

export function createBridgeClient({
  accessKey,
  fetcher = fetch,
  bridgeUrl = defaultBridgeUrl
}: ClientOptions) {
  async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("content-type", "application/json");
    if (authenticated) headers.set("x-webpin-key", accessKey);
    let response: Response;
    try {
      response = await fetcher(`${bridgeUrl}${path}`, { ...init, headers });
    } catch (error) {
      throw new BridgeClientError("offline", error instanceof Error ? error.message : String(error));
    }
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
    if (response.status === 401 || body.error === "invalid_access_key") {
      throw new BridgeClientError("auth", body.message ?? "Access key rejected.");
    }
    if (!response.ok) {
      throw new BridgeClientError("http", body.message ?? body.error ?? `Bridge request failed (${response.status}).`);
    }
    return body as T;
  }

  return {
    getHealth: () => request<{ ok: true; authentication: "access-key" }>("/health", {}, false),
    getSession: () => request<{ ready: true; projectName: string }>("/session"),
    listAnnotations: () => request<{ annotations: Annotation[] }>("/annotations"),
    createAnnotation: (annotation: Annotation) => request<{ annotation: Annotation }>("/annotations", {
      method: "POST",
      body: JSON.stringify({ annotation })
    }),
    updateAnnotation: (id: string, patch: EditableAnnotationPatch) =>
      request<{ annotation: Annotation }>(`/annotations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ patch })
      }),
    deleteAnnotation: (id: string) => request<{ ok: true }>(`/annotations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({})
    }),
    getProjectSettings: () => request<{ settings: { screenshotCaptureEnabled: boolean } }>("/project-settings"),
    updateProjectSettings: (screenshotCaptureEnabled: boolean) => request<{ settings: { screenshotCaptureEnabled: boolean } }>("/project-settings", {
      method: "PATCH",
      body: JSON.stringify({ patch: { screenshotCaptureEnabled } })
    }),
    writeAsset: (input: { annotationId: string; kind: "screenshot" | "crop"; dataUrl: string }) =>
      request<{ path: string }>("/assets", { method: "POST", body: JSON.stringify(input) }),
    createTask: (input: { taskId: string; annotations: Annotation[]; userIntent: string; acceptanceCriteria: string[]; suggestedFiles?: string[] }) =>
      request<{ jsonPath: string; markdownPath: string; promptPath: string }>("/tasks", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    runAgent: (taskId: string) => request<{ run: { runId: string; status: "completed" | "failed"; stderr?: string } }>("/agent-runs", {
      method: "POST",
      body: JSON.stringify({ taskId, agent: "codex" })
    })
  };
}

export type BridgeClient = ReturnType<typeof createBridgeClient>;
```

- [ ] **Step 4: Run client tests and typecheck**

Run:

```bash
CI=true pnpm --filter @ui-annotations/extension test -- src/bridge-client.test.ts
CI=true pnpm --filter @ui-annotations/extension typecheck
```

Expected: client tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/bridge-client.ts apps/extension/src/bridge-client.test.ts
git commit -m "feat: add authenticated extension bridge client"
```

## Task 6: Add Connection State and Reliable Pending Saves

**Files:**
- Create: `apps/extension/src/panel/connection.ts`
- Create: `apps/extension/src/panel/connection.test.ts`
- Create: `apps/extension/src/panel/pending-save.ts`
- Create: `apps/extension/src/panel/pending-save.test.ts`

- [ ] **Step 1: Write failing connection tests**

Create `apps/extension/src/panel/connection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextConnectionState, storageKeysToRemoveAfterAuthFailure } from "./connection";

describe("nextConnectionState", () => {
  it("reports offline when health cannot be reached", () => {
    expect(nextConnectionState({ health: "offline", accessKey: "key" })).toEqual({ status: "offline" });
  });
  it("requires a key when the bridge is online", () => {
    expect(nextConnectionState({ health: "online", accessKey: "" })).toEqual({ status: "key-required" });
  });
  it("requires a new key after rejection", () => {
    expect(nextConnectionState({ health: "online", accessKey: "old", session: "rejected" })).toEqual({ status: "key-required" });
  });
  it("reports ready only after session verification", () => {
    expect(nextConnectionState({ health: "online", accessKey: "key", session: { projectName: "WebPin" } }))
      .toEqual({ status: "ready", projectName: "WebPin" });
  });
  it("clears connection credentials without touching pending annotations", () => {
    expect(storageKeysToRemoveAfterAuthFailure()).toEqual([
      "ui-annotations.accessKey",
      "ui-annotations.projectName"
    ]);
    expect(storageKeysToRemoveAfterAuthFailure()).not.toContain("ui-annotations.pendingAnnotations");
  });
});
```

Create `apps/extension/src/panel/pending-save.test.ts`:

```ts
import type { Annotation } from "@ui-annotations/shared";
import { describe, expect, it, vi } from "vitest";
import { savePendingSequentially } from "./pending-save";

describe("savePendingSequentially", () => {
  it("removes each confirmed annotation and preserves the failed remainder", async () => {
    const annotations = [{ id: "ann_1" }, { id: "ann_2" }, { id: "ann_3" }] as Annotation[];
    const snapshots: string[][] = [];
    const save = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("bridge failed"));

    await expect(savePendingSequentially(annotations, save, (remaining) => {
      snapshots.push(remaining.map((annotation) => annotation.id));
    })).rejects.toThrow("bridge failed");

    expect(snapshots).toEqual([["ann_2", "ann_3"]]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
CI=true pnpm --filter @ui-annotations/extension test -- src/panel/connection.test.ts src/panel/pending-save.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement the pure helpers**

Create `apps/extension/src/panel/connection.ts`:

```ts
export const accessKeyStorageKey = "ui-annotations.accessKey";
export const legacyProjectPathStorageKey = "ui-annotations.projectPath";
export const projectNameStorageKey = "ui-annotations.projectName";

type ConnectionInput = {
  health: "online" | "offline";
  accessKey: string;
  session?: "rejected" | { projectName: string };
};

export type ConnectionState =
  | { status: "offline" }
  | { status: "key-required" }
  | { status: "ready"; projectName: string };

export function nextConnectionState(input: ConnectionInput): ConnectionState {
  if (input.health === "offline") return { status: "offline" };
  if (!input.accessKey || input.session === "rejected" || !input.session) return { status: "key-required" };
  return { status: "ready", projectName: input.session.projectName };
}

export function storageKeysToRemoveAfterAuthFailure(): string[] {
  return [accessKeyStorageKey, projectNameStorageKey];
}
```

Create `apps/extension/src/panel/pending-save.ts`:

```ts
import type { Annotation } from "@ui-annotations/shared";

export async function savePendingSequentially(
  annotations: Annotation[],
  save: (annotation: Annotation) => Promise<void>,
  onRemainingChanged: (remaining: Annotation[]) => void
): Promise<void> {
  let remaining = [...annotations];
  for (const annotation of annotations) {
    await save(annotation);
    remaining = remaining.filter((candidate) => candidate.id !== annotation.id);
    onRemainingChanged(remaining);
  }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
CI=true pnpm --filter @ui-annotations/extension test -- src/panel/connection.test.ts src/panel/pending-save.test.ts
```

Expected: all connection and partial-save cases PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/panel/connection.ts apps/extension/src/panel/connection.test.ts apps/extension/src/panel/pending-save.ts apps/extension/src/panel/pending-save.test.ts
git commit -m "feat: add bridge connection and pending-save state"
```

## Task 7: Migrate Annotation Construction, Background, and Panel

**Files:**
- Create: `apps/extension/src/annotation-factory.ts`
- Create: `apps/extension/src/annotation-factory.test.ts`
- Modify: `apps/extension/src/background.ts`
- Modify: `apps/extension/src/panel/App.tsx`
- Modify: `apps/extension/src/panel/i18n.ts`
- Modify: `apps/extension/src/panel/i18n.test.ts`

- [ ] **Step 1: Write a failing annotation-factory test**

Create `apps/extension/src/annotation-factory.test.ts` with a representative `SelectedElement` and assert:

```ts
import { describe, expect, it } from "vitest";
import { createAnnotationFromSelection } from "./annotation-factory";

describe("createAnnotationFromSelection", () => {
  it("uses the authenticated project name instead of a local path", () => {
    const annotation = createAnnotationFromSelection({
      projectName: "WebPin",
      selection: {
        url: "http://localhost/settings",
        route: "/settings",
        title: "Settings",
        selector: "[data-testid=save]",
        xpath: "/html/body/button",
        textExcerpt: "Save",
        boundingBox: { x: 10, y: 20, width: 100, height: 40 },
        viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }
      },
      note: "Make it taller",
      changeType: "layout",
      priority: "high",
      targetPlatforms: ["web"]
    });
    expect(annotation.projectId).toBe("webpin");
    expect(annotation.anchor.dom?.selector).toBe("[data-testid=save]");
  });
});
```

- [ ] **Step 2: Run the focused test to verify failure**

Run:

```bash
CI=true pnpm --filter @ui-annotations/extension test -- src/annotation-factory.test.ts
```

Expected: FAIL because the factory does not exist.

- [ ] **Step 3: Extract annotation creation**

Create `apps/extension/src/annotation-factory.ts` by moving the current annotation object construction from `background.ts`/`App.tsx` into:

```ts
import type { Annotation } from "@ui-annotations/shared";
import type { SelectedElement } from "./content";

export function projectIdFromName(projectName: string): string {
  return projectName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

export function createAnnotationFromSelection(input: {
  projectName: string;
  selection: SelectedElement;
  note: string;
  changeType: Annotation["changeType"];
  priority: Annotation["priority"];
  targetPlatforms: Annotation["targetPlatforms"];
}): Annotation {
  const now = new Date().toISOString();
  const id = globalThis.crypto?.randomUUID ? `ann_${globalThis.crypto.randomUUID().slice(0, 8)}` : `ann_${Date.now()}`;
  return {
    id,
    projectId: projectIdFromName(input.projectName),
    page: {
      url: input.selection.url,
      ...(input.selection.route ? { route: input.selection.route } : {}),
      ...(input.selection.title ? { title: input.selection.title } : {}),
      viewport: input.selection.viewport
    },
    anchor: {
      dom: {
        selector: input.selection.selector,
        xpath: input.selection.xpath,
        textExcerpt: input.selection.textExcerpt,
        boundingBox: input.selection.boundingBox
      },
      visual: { boundingBox: input.selection.boundingBox }
    },
    note: input.note,
    changeType: input.changeType,
    priority: input.priority,
    status: "open",
    targetPlatforms: input.targetPlatforms,
    createdAt: now,
    updatedAt: now
  };
}
```

- [ ] **Step 4: Replace background project-path behavior**

In `apps/extension/src/background.ts`:

- Remove `projectPathKey`, `inferProjectPathFromPageUrl`, `projectIdFromPath`, and the local `createAnnotation`.
- Import `createAnnotationFromSelection`, `createBridgeClient`, `accessKeyStorageKey`, and `projectNameStorageKey`.
- Change `uploadAsset` to receive `accessKey` and call `createBridgeClient({ accessKey }).writeAsset(...)`.
- Change `captureVisualAssets` to accept `accessKey`, not `projectPath`. Each runtime listener reads the key from Chrome storage before calling it.
- In `saveInlineAnnotation`, load `[accessKeyStorageKey, projectNameStorageKey]`; reject with `Connect the bridge in the side panel before saving.` if either is missing.
- Construct the annotation with `createAnnotationFromSelection({ projectName, ... })`.
- Store only `pendingAnnotationsKey`; never restore or infer `projectPath`.

The message contract remains free of credentials and project paths:

```ts
{
  type: "ui-annotations.captureVisualAssets",
  annotationId: string,
  selection: SelectedElement
}
```

- [ ] **Step 5: Replace panel connection and raw fetch behavior**

In `apps/extension/src/panel/App.tsx`:

- Remove imports and state related to `inferProjectPathFromPageUrl` and `projectPath`.
- Add `accessKeyInput`, `connection`, and `projectName` state.
- On mount, call public health through `createBridgeClient({ accessKey: storedKey })`. If online and a stored key exists, call `getSession`; on auth failure call `chrome.storage.local.remove(storageKeysToRemoveAfterAuthFailure())`.
- Add a `connectBridge` handler that stores the entered key only after `getSession` succeeds, stores `projectNameStorageKey`, removes `legacyProjectPathStorageKey`, then loads annotations and settings.
- Replace every raw `fetch` with the corresponding bridge-client method.
- Replace `saveAllAnnotations` with `savePendingSequentially`; after every acknowledged save, update React state and `pendingAnnotationsKey` with the returned remainder.
- Disable protected controls unless `connection.status === "ready"`.
- Replace the project-path input with a password input and connect button:

```tsx
<label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
  {t.accessKey}
  <input
    type="password"
    value={accessKeyInput}
    onChange={(event) => setAccessKeyInput(event.target.value)}
    placeholder={t.accessKeyPlaceholder}
    autoComplete="off"
  />
</label>
<button type="button" onClick={connectBridge}>{t.connectBridge}</button>
```

The status badge must render `t.connectionStatuses[connection.status]` and use the ready color only for `ready`.

- [ ] **Step 6: Update English and Chinese connection copy**

Add these keys to the existing `PanelCopy` type and both languages in `apps/extension/src/panel/i18n.ts`, then assert them in `i18n.test.ts`:

```ts
accessKey: string;
accessKeyPlaceholder: string;
connectBridge: string;
connectionStatuses: Record<"offline" | "key-required" | "ready", string>;
```

Add these fields inside the existing `messages` object type:

```ts
accessKeyRejected: string;
bridgeOffline: string;
bridgeReady: (projectName: string) => string;
```

English values: `Access key`, `Paste the key printed by the bridge`, `Connect`, `Bridge offline`, `Key required`, `Ready`.

Chinese values: `访问密钥`, `粘贴 bridge 启动时显示的密钥`, `连接`, `Bridge 离线`, `需要密钥`, `已就绪`.

Remove project-path-specific validation copy that is no longer referenced.

- [ ] **Step 7: Run extension tests and typecheck**

Run:

```bash
CI=true pnpm --filter @ui-annotations/extension test
CI=true pnpm --filter @ui-annotations/extension typecheck
```

Expected: all existing and new extension tests PASS with no remaining `projectPath` request or storage usage outside the legacy-key removal constant.

Confirm with:

```bash
rg -n "projectPath|ui-annotations\.projectPath|fetch\(" apps/extension/src
```

Expected: `projectPath` appears only in the explicitly named legacy storage constant/test; bridge HTTP calls appear only in `bridge-client.ts`.

- [ ] **Step 8: Commit**

```bash
git add apps/extension/src
git commit -m "feat: connect extension with bridge access key"
```

## Task 8: Add Packaged-Extension Chromium Verification

**Files:**
- Create: `apps/extension/scripts/extension-e2e.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add Playwright and the E2E command**

Run:

```bash
CI=true pnpm add -D -w @playwright/test@^1.60.0
```

Add to the root `package.json` scripts:

```json
"test:e2e:extension": "pnpm --filter @ui-annotations/shared build && pnpm --filter @ui-annotations/extension build && pnpm --filter @ui-annotations/bridge build && node apps/extension/scripts/extension-e2e.mjs"
```

Expected: `package.json` and `pnpm-lock.yaml` include Playwright.

- [ ] **Step 2: Write the failing packaged-extension script**

Create `apps/extension/scripts/extension-e2e.mjs`. The script must:

```js
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBridgeServer } from "../../bridge/dist/server.js";

const accessKey = "extension-e2e-key";
const projectPath = await mkdtemp(join(tmpdir(), "webpin-extension-e2e-"));
const profilePath = await mkdtemp(join(tmpdir(), "webpin-extension-profile-"));
const server = createBridgeServer({ projectPath, projectName: "e2e-project", accessKey });
await new Promise((resolveListen) => server.listen(48731, "127.0.0.1", resolveListen));
const sampleServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end('<!doctype html><button data-testid="save-button">Save changes</button>');
});
await new Promise((resolveListen) => sampleServer.listen(49123, "127.0.0.1", resolveListen));

const extensionPath = resolve("apps/extension/dist");
const context = await chromium.launchPersistentContext(profilePath, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});

try {
  let workers = context.serviceWorkers();
  if (workers.length === 0) await context.waitForEvent("serviceworker");
  workers = context.serviceWorkers();
  const worker = workers.find((candidate) => candidate.url().startsWith("chrome-extension://"));
  if (!worker) throw new Error("Extension service worker did not load");
  const extensionId = new URL(worker.url()).host;

  await worker.evaluate(async () => chrome.storage.local.clear());

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByLabel(/Access key|访问密钥/).fill(accessKey);
  await panel.getByRole("button", { name: /Connect|连接/ }).click();
  await panel.getByText(/Ready|已就绪/).waitFor();

  const sample = await context.newPage();
  await sample.goto("http://127.0.0.1:49123/");
  await sample.evaluate(() => window.postMessage({ type: "ui-annotations.startSelecting", commandId: "e2e" }, "*"));
  await sample.getByTestId("save-button").dispatchEvent("mousedown", { button: 0 });
  const editor = sample.locator("form[data-ui-annotations-root='true']");
  await editor.locator("textarea[name='note']").fill("Make the save button taller.");
  await editor.locator("button[type='submit']").click();
  await sample.waitForTimeout(600);

  await panel.bringToFront();
  await Promise.all([
    panel.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/annotations") && response.status() === 201),
    panel.getByRole("button", { name: /Save all to files|全部保存到文件/ }).click()
  ]);
  await panel.getByRole("button", { name: /Refresh|刷新/ }).click();
  await panel.getByText("Make the save button taller.").waitFor();

  const annotationFile = await readFile(join(projectPath, ".ui-annotations", "annotations.jsonl"), "utf8");
  if (!annotationFile.includes("Make the save button taller.")) throw new Error("Annotation file was not written");

  const savedCard = panel.getByText("Make the save button taller.").locator("xpath=ancestor::div[.//input[@type='checkbox']][1]");
  await Promise.all([
    panel.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/annotations/") && response.status() === 200),
    savedCard.locator("select").selectOption("drafted")
  ]);
  await panel.getByRole("button", { name: /Refresh|刷新/ }).click();
  await savedCard.locator("select").waitFor();
  if (await savedCard.locator("select").inputValue() !== "drafted") throw new Error("Annotation status did not persist");
  await savedCard.locator("input[type='checkbox']").check();
  await panel.getByRole("button", { name: /Draft from selection|从选择生成草稿/ }).click();
  await Promise.all([
    panel.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/tasks") && response.status() === 201),
    panel.getByRole("button", { name: /Generate task files|生成任务文件/ }).click()
  ]);
  const taskFiles = await readdir(join(projectPath, ".ui-annotations", "tasks"));
  for (const suffix of [".json", ".md", ".prompt.md"]) {
    if (!taskFiles.some((file) => file.endsWith(suffix))) throw new Error(`Missing generated ${suffix} task file`);
  }
  await Promise.all([
    panel.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes("/annotations/") && response.status() === 200),
    savedCard.getByRole("button", { name: /Delete|删除/ }).click()
  ]);
  await panel.getByRole("button", { name: /Refresh|刷新/ }).click();
  if (await panel.getByText("Make the save button taller.").count() !== 0) throw new Error("Deleted annotation remains visible");
} finally {
  await context.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  await new Promise((resolveClose) => sampleServer.close(resolveClose));
}
```

If this command fails, record the first failing observable and use the systematic-debugging workflow before changing production behavior.

- [ ] **Step 3: Install the matching Chromium runtime**

Run once on the development machine:

```bash
pnpm exec playwright install chromium
```

Expected: Playwright reports the Chromium revision installed successfully.

- [ ] **Step 4: Run the E2E command**

Run:

```bash
CI=true pnpm test:e2e:extension
```

Expected: exit 0 after proving extension load, key authentication, annotation write/read, and task file generation. No screenshot/crop assertion is included in this slice.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml apps/extension/scripts/extension-e2e.mjs
git commit -m "test: verify packaged extension bridge workflow"
```

## Task 9: Update Product Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/superpowers/specs/2026-07-16-single-project-session-key-design.md`
- Modify: `docs/superpowers/plans/2026-07-16-single-project-session-key-implementation-plan.md`

- [ ] **Step 1: Update README startup and user workflow**

Replace every bridge startup example with:

```bash
UI_ANNOTATIONS_PROJECT_PATH=/absolute/project/path pnpm dev:bridge
```

Document this exact sequence:

1. Start the bridge for one project.
2. Copy the printed startup access key.
3. Open the extension panel.
4. Paste the key and click Connect.
5. Confirm the panel displays Ready and the project name.
6. Select, save, refresh, and generate task files.

Remove claims that the browser binds arbitrary origins or selects project paths. State that restarting the bridge produces a new key.

- [ ] **Step 2: Correct project status**

In `docs/PROJECT_STATUS.md`, record:

```markdown
- Phase: MVP stabilization
- Verified: packaged extension can authenticate, save, reload, update/delete annotations, and generate task files against one active local project.
- Security boundary: browser requests cannot supply project paths; managed annotation directories reject symbolic links.
- Remaining: screenshot hardening, visual region drawing, source anchors, DOM snapshots, async Codex queue, and broader panel decomposition.
```

Do not retain the old unconditional `MVP complete` statement.

- [ ] **Step 3: Mark design and plan verification evidence**

Change the design status to `Implemented and verified` only after Task 8 passes. Append a verification section containing the exact commands and date:

```markdown
## Implementation Verification

- `CI=true pnpm verify`
- `CI=true pnpm test:e2e:extension`
- Verified on 2026-07-16.
```

Check off plan steps only after their commands have succeeded.

- [ ] **Step 4: Run complete verification**

Run:

```bash
CI=true pnpm verify
CI=true pnpm test:e2e:extension
git diff --check
```

Expected: typecheck, all unit/API tests, all builds, packaged-extension E2E, and whitespace validation exit 0.

- [ ] **Step 5: Confirm forbidden scope is absent**

Run:

```bash
rg -n "cloud backend|multi-user|live sync|exec\(|spawn\(" apps packages
rg -n "searchParams\\.get.*projectPath|parsedBody\\.projectPath|body\\.projectPath" apps/bridge/src/server.ts
rg -n "JSON\\.stringify.*projectPath|\\?projectPath" apps/extension/src
```

Expected: no cloud or collaboration implementation; `spawn` remains only in the fixed Codex runner; the two path-input scans return no matches.

- [ ] **Step 6: Commit and push**

```bash
git add README.md docs/PROJECT_STATUS.md docs/superpowers/specs/2026-07-16-single-project-session-key-design.md docs/superpowers/plans/2026-07-16-single-project-session-key-implementation-plan.md
git commit -m "docs: document authenticated single-project workflow"
git push
```

Expected: local `main` and `origin/main` point to the same final commit.

## Self-Review Checklist

- [x] Every approved goal is covered by Tasks 1-9.
- [x] No task adds multi-project, cloud, account, collaboration, visual-region, source-anchor, DOM-snapshot, or asynchronous-runner scope.
- [x] `BridgeConfig`, `BridgeClientError`, connection-state names, storage keys, and `X-WebPin-Key` are consistent across tasks.
- [x] Every protected route uses the injected canonical project and current key.
- [x] Each extracted behavior begins with a failing unit/API test; final browser wiring has packaged-extension coverage.
- [x] The E2E test proves the original GET 403 regression is fixed in a real packaged extension.
- [x] Documentation claims are updated only after fresh verification succeeds.
