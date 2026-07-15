import { Readable } from "node:stream";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createBridgeRequestHandler } from "./server.js";

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
  request.headers = { origin: "http://localhost", ...headers };
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
  allowedOrigins?: string[];
  runCodexTask?: Parameters<typeof createBridgeRequestHandler>[0]["runCodexTask"];
}) {
  const handler = createBridgeRequestHandler({
    allowedProjectRoots: [input.projectPath],
    allowedOrigins: input.allowedOrigins ?? ["http://localhost"],
    ...(input.runCodexTask ? { runCodexTask: input.runCodexTask } : {})
  });
  const { response, result } = makeResponse();
  await handler(makeRequest(input.method, input.url, input.body, input.headers), response);
  return result();
}

describe("bridge server", () => {
  it("returns 400 for malformed JSON and keeps serving requests", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const badResponse = await dispatch({ projectPath, method: "POST", url: "/annotations", body: "{" });
    expect(badResponse.statusCode).toBe(400);
    expect(badResponse.json).toMatchObject({ error: "invalid_json" });

    const healthResponse = await dispatch({ projectPath, method: "GET", url: "/health" });
    expect(healthResponse.statusCode).toBe(200);
  });

  it("returns 400 for invalid annotation schemas", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/annotations",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath, annotation: { ...annotation, note: "" } })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toMatchObject({ error: "invalid_schema" });
  });

  it("returns 400 for invalid annotation request envelopes", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/annotations",
      headers: { "content-type": "application/json" },
      body: "null"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toMatchObject({ error: "invalid_schema" });
  });

  it("rejects unallowed project paths", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/annotations",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath: "/tmp/not-bound", annotation })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toMatchObject({ error: "invalid_request" });
  });

  it("rejects write requests from unbound origins", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/annotations",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ projectPath, annotation })
    });

    expect(response.statusCode).toBe(403);
    expect(response.json).toMatchObject({ error: "origin_not_allowed" });
  });

  it("allows write requests from bound chrome extension origins", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/annotations",
      headers: { "content-type": "application/json", origin: "chrome-extension://abcdefghijklmnop" },
      allowedOrigins: ["chrome-extension://*"],
      body: JSON.stringify({ projectPath, annotation })
    });

    expect(response.statusCode).toBe(201);
    expect(response.json.annotation).toMatchObject({ id: "ann_001" });
  });

  it("lists saved annotations for a bound project", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    await dispatch({
      projectPath,
      method: "POST",
      url: "/annotations",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath, annotation })
    });

    const response = await dispatch({
      projectPath,
      method: "GET",
      url: `/annotations?projectPath=${encodeURIComponent(projectPath)}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json.annotations).toEqual([expect.objectContaining({ id: "ann_001" })]);
  });

  it("reads and updates project settings", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const readResponse = await dispatch({
      projectPath,
      method: "GET",
      url: `/project-settings?projectPath=${encodeURIComponent(projectPath)}`
    });
    const updateResponse = await dispatch({
      projectPath,
      method: "PATCH",
      url: "/project-settings",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath, patch: { screenshotCaptureEnabled: true } })
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectPath,
        annotationId: "ann_001",
        kind: "screenshot",
        dataUrl: "data:image/png;base64,aGVsbG8="
      })
    });

    expect(response.statusCode).toBe(201);
    expect(response.json).toMatchObject({ path: "assets/screenshots/ann_001.png" });
  });

  it("rejects unsupported asset payloads", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/assets",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectPath,
        annotationId: "ann_001",
        kind: "screenshot",
        dataUrl: "data:text/plain;base64,aGVsbG8="
      })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toMatchObject({ error: "invalid_schema" });
  });

  it("updates a saved annotation through a narrow patch", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    await dispatch({
      projectPath,
      method: "POST",
      url: "/annotations",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath, annotation })
    });

    const response = await dispatch({
      projectPath,
      method: "PATCH",
      url: "/annotations/ann_001",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath, patch: { status: "resolved", note: "Done." } })
    });

    expect(response.statusCode).toBe(200);
    expect(response.json.annotation).toMatchObject({ id: "ann_001", status: "resolved", note: "Done." });
  });

  it("deletes a saved annotation from active results", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    await dispatch({
      projectPath,
      method: "POST",
      url: "/annotations",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath, annotation })
    });

    const deleteResponse = await dispatch({
      projectPath,
      method: "DELETE",
      url: "/annotations/ann_001",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath })
    });
    const listResponse = await dispatch({
      projectPath,
      method: "GET",
      url: `/annotations?projectPath=${encodeURIComponent(projectPath)}`
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(listResponse.json.annotations).toEqual([]);
  });

  it("rejects task ids that could traverse outside task storage", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/tasks",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectPath,
        taskId: "../../escape",
        annotations: [annotation],
        userIntent: "Align save button.",
        acceptanceCriteria: ["Button height matches controls."]
      })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 for invalid task request envelopes", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/tasks",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toMatchObject({ error: "invalid_schema" });
  });

  it("starts a controlled codex run for a task package", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/agent-runs",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath, taskId: "task_001", agent: "codex" }),
      runCodexTask: async (runProjectPath, input) => ({
        runId: "run_task_001_20260702120000000",
        taskId: input.taskId,
        agent: "codex",
        status: "completed",
        command: ["codex", "exec", "--sandbox", "workspace-write", "Read task."],
        startedAt: "2026-07-02T12:00:00.000Z",
        finishedAt: "2026-07-02T12:01:00.000Z",
        exitCode: 0,
        stdout: runProjectPath,
        stderr: "",
        promptPath: ".ui-annotations/tasks/task_001.prompt.md"
      })
    });

    expect(response.statusCode).toBe(201);
    expect(response.json.run).toMatchObject({ taskId: "task_001", status: "completed" });
  });

  it("rejects non-codex agent run requests", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const response = await dispatch({
      projectPath,
      method: "POST",
      url: "/agent-runs",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath, taskId: "task_001", agent: "cursor" })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toMatchObject({ error: "invalid_schema" });
  });
});
