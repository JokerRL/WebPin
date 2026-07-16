import { readFile, mkdtemp } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createBridgeRequestHandler } from "./server.js";

const accessKey = "server-test-key";
const authorizedHeaders = {
  origin: "chrome-extension://abcdefghijklmnop",
  "x-webpin-key": accessKey
};

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

function makeRequest(method: string, url: string, body = "", headers: Record<string, string> = {}): IncomingMessage {
  const request = Readable.from(body) as IncomingMessage;
  request.method = method;
  request.url = url;
  request.headers = headers;
  return request;
}

function makeResponse() {
  let statusCode = 200;
  let body = "";
  const headers = new Map<string, string | number | readonly string[]>();

  const response = {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), value);
      return response;
    },
    writeHead(status: number, responseHeaders?: Record<string, string>) {
      statusCode = status;
      for (const [name, value] of Object.entries(responseHeaders ?? {})) {
        headers.set(name.toLowerCase(), value);
      }
      return response;
    },
    end(chunk?: string) {
      body += chunk ?? "";
      return response;
    }
  } as unknown as ServerResponse;

  return {
    response,
    result: () => ({
      statusCode,
      headers,
      json: body ? JSON.parse(body) : null
    })
  };
}

async function dispatch(input: {
  projectPath: string;
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
  authenticated?: boolean;
  allowedOrigins?: string[];
  runCodexTask?: Parameters<typeof createBridgeRequestHandler>[0]["runCodexTask"];
}) {
  const handler = createBridgeRequestHandler({
    projectPath: input.projectPath,
    projectName: "test-project",
    accessKey,
    allowedOrigins: input.allowedOrigins ?? ["chrome-extension://*"],
    ...(input.runCodexTask ? { runCodexTask: input.runCodexTask } : {})
  });
  const headers = input.authenticated === false
    ? { origin: authorizedHeaders.origin, ...input.headers }
    : { ...authorizedHeaders, ...input.headers };
  const { response, result } = makeResponse();
  await handler(makeRequest(input.method, input.url, input.body, headers), response);
  return result();
}

describe("bridge server", () => {
  it("keeps health public and advertises access-key authentication", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({ projectPath, method: "GET", url: "/health", authenticated: false });

    expect(response.statusCode).toBe(200);
    expect(response.json).toEqual({ ok: true, authentication: "access-key" });
  });

  it("keeps preflight public and advertises the access-key header", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({ projectPath, method: "OPTIONS", url: "/annotations", authenticated: false });

    expect(response.statusCode).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type,x-webpin-key");
  });

  it("requires a valid access key for the session", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({ projectPath, method: "GET", url: "/session", authenticated: false });

    expect(response.statusCode).toBe(401);
    expect(response.json).toMatchObject({ error: "invalid_access_key" });
  });

  it("returns only non-sensitive session metadata", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({ projectPath, method: "GET", url: "/session" });

    expect(response.statusCode).toBe(200);
    expect(response.json).toEqual({ ready: true, projectName: "test-project" });
    expect(JSON.stringify(response.json)).not.toContain(projectPath);
    expect(JSON.stringify(response.json)).not.toContain(accessKey);
  });

  it("returns 400 for malformed JSON and keeps serving requests", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const badResponse = await dispatch({ projectPath, method: "POST", url: "/annotations", body: "{" });
    expect(badResponse.statusCode).toBe(400);
    expect(badResponse.json).toMatchObject({ error: "invalid_json" });

    const healthResponse = await dispatch({ projectPath, method: "GET", url: "/health", authenticated: false });
    expect(healthResponse.statusCode).toBe(200);
  });

  it("rejects obsolete project paths in strict request envelopes", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/annotations",
      body: JSON.stringify({ projectPath, annotation })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toMatchObject({ error: "invalid_schema" });
  });

  it("rejects obsolete project path query parameters", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "GET",
      url: `/annotations?projectPath=${encodeURIComponent(projectPath)}`
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toMatchObject({ error: "invalid_schema" });
  });

  it("returns 400 for invalid annotation schemas and envelopes", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const invalidAnnotation = await dispatch({
      projectPath,
      method: "POST",
      url: "/annotations",
      body: JSON.stringify({ annotation: { ...annotation, note: "" } })
    });
    const invalidEnvelope = await dispatch({ projectPath, method: "POST", url: "/annotations", body: "null" });

    expect(invalidAnnotation.statusCode).toBe(400);
    expect(invalidAnnotation.json).toMatchObject({ error: "invalid_schema" });
    expect(invalidEnvelope.statusCode).toBe(400);
    expect(invalidEnvelope.json).toMatchObject({ error: "invalid_schema" });
  });

  it("uses origin only for CORS reflection", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/annotations",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({ annotation })
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });

  it("saves and lists annotations without persisting the access key", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const saveResponse = await dispatch({
      projectPath,
      method: "POST",
      url: "/annotations",
      body: JSON.stringify({ annotation })
    });
    const listResponse = await dispatch({ projectPath, method: "GET", url: "/annotations" });

    expect(saveResponse.statusCode).toBe(201);
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json.annotations).toEqual([expect.objectContaining({ id: "ann_001" })]);
    const annotations = await readFile(join(projectPath, ".ui-annotations", "annotations.jsonl"), "utf8");
    const events = await readFile(join(projectPath, ".ui-annotations", "events.jsonl"), "utf8");
    expect(annotations).not.toContain(accessKey);
    expect(events).not.toContain(accessKey);
  });

  it("reads and updates project settings", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const readResponse = await dispatch({ projectPath, method: "GET", url: "/project-settings" });
    const updateResponse = await dispatch({
      projectPath,
      method: "PATCH",
      url: "/project-settings",
      body: JSON.stringify({ patch: { screenshotCaptureEnabled: true } })
    });

    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.json.settings).toMatchObject({ screenshotCaptureEnabled: false });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json.settings).toMatchObject({ screenshotCaptureEnabled: true });
  });

  it("writes screenshot assets through a narrow asset endpoint", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/assets",
      body: JSON.stringify({
        annotationId: "ann_001",
        kind: "screenshot",
        dataUrl: "data:image/png;base64,aGVsbG8="
      })
    });

    expect(response.statusCode).toBe(201);
    expect(response.json).toMatchObject({ path: "assets/screenshots/ann_001.png" });
  });

  it("rejects unsupported or non-strict asset payloads", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const unsupported = await dispatch({
      projectPath,
      method: "POST",
      url: "/assets",
      body: JSON.stringify({ annotationId: "ann_001", kind: "screenshot", dataUrl: "data:text/plain;base64,aGVsbG8=" })
    });
    const extra = await dispatch({
      projectPath,
      method: "POST",
      url: "/assets",
      body: JSON.stringify({ annotationId: "ann_001", kind: "screenshot", dataUrl: "data:image/png;base64,aGVsbG8=", extra: true })
    });

    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json).toMatchObject({ error: "invalid_schema" });
    expect(extra.statusCode).toBe(400);
    expect(extra.json).toMatchObject({ error: "invalid_schema" });
  });

  it("updates and deletes a saved annotation through narrow envelopes", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    await dispatch({ projectPath, method: "POST", url: "/annotations", body: JSON.stringify({ annotation }) });

    const updateResponse = await dispatch({
      projectPath,
      method: "PATCH",
      url: "/annotations/ann_001",
      body: JSON.stringify({ patch: { status: "resolved", note: "Done." } })
    });
    const deleteResponse = await dispatch({
      projectPath,
      method: "DELETE",
      url: "/annotations/ann_001",
      body: JSON.stringify({})
    });
    const listResponse = await dispatch({ projectPath, method: "GET", url: "/annotations" });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json.annotation).toMatchObject({ id: "ann_001", status: "resolved", note: "Done." });
    expect(deleteResponse.statusCode).toBe(200);
    expect(listResponse.json.annotations).toEqual([]);
  });

  it("creates task files and returns only project-relative paths", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/tasks",
      body: JSON.stringify({
        taskId: "task_001",
        annotations: [annotation],
        userIntent: "Align save button.",
        acceptanceCriteria: ["Button height matches controls."]
      })
    });

    expect(response.statusCode).toBe(201);
    expect(response.json).toEqual({
      jsonPath: ".ui-annotations/tasks/task_001.json",
      markdownPath: ".ui-annotations/tasks/task_001.md",
      promptPath: ".ui-annotations/tasks/task_001.prompt.md"
    });
    expect(JSON.stringify(response.json)).not.toContain(projectPath);
  });

  it("rejects invalid and traversing task request envelopes", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const traversal = await dispatch({
      projectPath,
      method: "POST",
      url: "/tasks",
      body: JSON.stringify({
        taskId: "../../escape",
        annotations: [annotation],
        userIntent: "Align save button.",
        acceptanceCriteria: ["Button height matches controls."]
      })
    });
    const invalid = await dispatch({ projectPath, method: "POST", url: "/tasks", body: JSON.stringify({}) });

    expect(traversal.statusCode).toBe(400);
    expect(traversal.json).toMatchObject({ error: "invalid_request" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json).toMatchObject({ error: "invalid_schema" });
  });

  it("returns only sanitized browser-safe codex run metadata", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/agent-runs",
      body: JSON.stringify({ taskId: "task_001", agent: "codex" }),
      runCodexTask: async (runProjectPath, input) => ({
        runId: "run_task_001_20260702120000000",
        taskId: input.taskId,
        agent: "codex",
        status: "completed",
        command: ["codex", "exec", "--sandbox", "workspace-write", "Read task."],
        startedAt: "2026-07-02T12:00:00.000Z",
        finishedAt: "2026-07-02T12:01:00.000Z",
        exitCode: 0,
        stdout: `Codex read ${runProjectPath}`,
        stderr: `Failed in ${runProjectPath}; retry ${runProjectPath}`,
        promptPath: join(runProjectPath, ".ui-annotations", "tasks", "task_001.prompt.md")
      })
    });

    expect(response.statusCode).toBe(201);
    expect(response.json).toEqual({
      run: {
        runId: "run_task_001_20260702120000000",
        status: "completed",
        stderr: "Failed in [project]; retry [project]"
      }
    });
    expect(JSON.stringify(response.json)).not.toContain(projectPath);
    expect(response.json.run).not.toHaveProperty("stdout");
    expect(response.json.run).not.toHaveProperty("command");
    expect(response.json.run).not.toHaveProperty("promptPath");
  });

  it("rejects non-codex agent run requests", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/agent-runs",
      body: JSON.stringify({ taskId: "task_001", agent: "cursor" })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toMatchObject({ error: "invalid_schema" });
  });
});
