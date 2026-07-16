import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";
import { annotationSchema } from "@ui-annotations/shared";
import { z, ZodError } from "zod";
import { runCodexTask as defaultRunCodexTask } from "./agent-runner.js";
import { AccessKeyError, assertAccessKey } from "./auth.js";
import { loadBridgeConfig, type BridgeConfig } from "./config.js";
import {
  appendAnnotation,
  createTaskFiles,
  deleteAnnotation,
  ensureAnnotationDirs,
  listAnnotations,
  readProjectSettings,
  updateAnnotation,
  updateProjectSettings,
  writeAnnotationAsset
} from "./store.js";

const host = "127.0.0.1";
const port = Number(process.env.UI_ANNOTATIONS_BRIDGE_PORT ?? 48731);

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const annotationsRequestSchema = z
  .object({
    annotation: z.unknown()
  })
  .strict();

const annotationPatchSchema = z
  .object({
    note: z.string().min(1).optional(),
    changeType: z.enum(["copy", "layout", "color", "state", "navigation", "platform-parity", "other"]).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    status: z.enum(["open", "drafted", "sent-to-codex", "resolved"]).optional(),
    targetPlatforms: z.array(z.enum(["web", "ios-swiftui"])).min(1).optional()
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Patch must include at least one editable field.");

const annotationUpdateRequestSchema = z
  .object({
    patch: annotationPatchSchema
  })
  .strict();

const annotationDeleteRequestSchema = z.object({}).strict();

const projectSettingsPatchSchema = z
  .object({
    screenshotCaptureEnabled: z.boolean().optional()
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Patch must include at least one project setting.");

const projectSettingsUpdateRequestSchema = z
  .object({
    patch: projectSettingsPatchSchema
  })
  .strict();

const supportedImageDataUrl = /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/;

const assetRequestSchema = z
  .object({
    annotationId: z.string().min(1),
    kind: z.enum(["screenshot", "crop"]),
    dataUrl: z.string().regex(supportedImageDataUrl)
  })
  .strict();

const tasksRequestSchema = z
  .object({
    taskId: z.string().min(1),
    annotations: z.array(annotationSchema).min(1),
    userIntent: z.string().min(1),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    suggestedFiles: z.array(z.string()).optional()
  })
  .strict();

const agentRunsRequestSchema = z
  .object({
    taskId: z.string().min(1),
    agent: z.literal("codex")
  })
  .strict();

async function readJson(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function handleError(response: ServerResponse, error: unknown): void {
  if (error instanceof AccessKeyError) {
    sendJson(response, error.status, { error: error.code, message: error.message });
    return;
  }

  if (error instanceof HttpError) {
    sendJson(response, error.status, { error: error.code, message: error.message });
    return;
  }

  if (error instanceof ZodError) {
    sendJson(response, 400, { error: "invalid_schema", issues: error.issues });
    return;
  }

  if (error instanceof Error && (error.message.includes("not allowed") || error.message.includes("must be"))) {
    sendJson(response, 400, { error: "invalid_request", message: error.message });
    return;
  }

  sendJson(response, 500, { error: "internal_error" });
}

function defaultAllowedOrigins(): string[] {
  return (process.env.UI_ANNOTATIONS_ALLOWED_ORIGINS ?? "http://localhost,chrome-extension://*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin === "chrome-extension://*") {
      return origin.startsWith("chrome-extension://");
    }

    return origin === allowedOrigin;
  });
}

function allowedOriginsHeader(request: IncomingMessage, allowedOrigins: string[]): string | undefined {
  const origin = request.headers.origin;
  return origin && isAllowedOrigin(origin, allowedOrigins) ? origin : undefined;
}

function browserSafeAgentRun(run: Awaited<ReturnType<typeof defaultRunCodexTask>>) {
  return {
    runId: run.runId,
    status: run.status
  };
}

export type BridgeOptions = BridgeConfig & {
  allowedOrigins?: string[];
  runCodexTask?: typeof defaultRunCodexTask;
};

export function createBridgeServer(options: BridgeOptions) {
  return createServer(createBridgeRequestHandler(options));
}

export function createBridgeRequestHandler(options: BridgeOptions) {
  const { accessKey, projectName, projectPath } = options;
  const allowedOrigins = options.allowedOrigins ?? defaultAllowedOrigins();
  const runCodexTask = options.runCodexTask ?? defaultRunCodexTask;

  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const allowedOrigin = allowedOriginsHeader(request, allowedOrigins);
      if (allowedOrigin) {
        response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      }
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

      const submittedKey = request.headers["x-webpin-key"];
      assertAccessKey(typeof submittedKey === "string" ? submittedKey : undefined, accessKey);

      if (requestUrl.searchParams.has("projectPath")) {
        throw new HttpError(400, "invalid_schema", "projectPath query parameters are not supported.");
      }

      if (request.method === "GET" && requestUrl.pathname === "/session") {
        sendJson(response, 200, { ready: true, projectName });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/annotations") {
        const annotations = await listAnnotations(projectPath);
        sendJson(response, 200, { annotations });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/project-settings") {
        const settings = await readProjectSettings(projectPath);
        sendJson(response, 200, { settings });
        return;
      }

      if (request.method === "PATCH" && requestUrl.pathname === "/project-settings") {
        const body = projectSettingsUpdateRequestSchema.parse(await readJson(request));
        const settings = await updateProjectSettings(projectPath, body.patch);
        sendJson(response, 200, { settings });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/assets") {
        const body = assetRequestSchema.parse(await readJson(request));
        const path = await writeAnnotationAsset(projectPath, body);
        sendJson(response, 201, { path });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/annotations") {
        const body = annotationsRequestSchema.parse(await readJson(request));
        const annotation = await appendAnnotation(projectPath, body.annotation);
        sendJson(response, 201, { annotation });
        return;
      }

      const annotationIdMatch = requestUrl.pathname.match(/^\/annotations\/([^/]+)$/);
      if (request.method === "PATCH" && annotationIdMatch) {
        const body = annotationUpdateRequestSchema.parse(await readJson(request));
        const annotation = await updateAnnotation(projectPath, decodeURIComponent(annotationIdMatch[1] ?? ""), body.patch);
        sendJson(response, 200, { annotation });
        return;
      }

      if (request.method === "DELETE" && annotationIdMatch) {
        annotationDeleteRequestSchema.parse(await readJson(request));
        await deleteAnnotation(projectPath, decodeURIComponent(annotationIdMatch[1] ?? ""));
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/tasks") {
        const body = tasksRequestSchema.parse(await readJson(request));
        const result = await createTaskFiles(projectPath, {
          taskId: body.taskId,
          annotations: body.annotations,
          userIntent: body.userIntent,
          acceptanceCriteria: body.acceptanceCriteria,
          ...(body.suggestedFiles ? { suggestedFiles: body.suggestedFiles } : {})
        });
        sendJson(response, 201, {
          jsonPath: relative(projectPath, result.jsonPath),
          markdownPath: relative(projectPath, result.markdownPath),
          promptPath: relative(projectPath, result.promptPath)
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/agent-runs") {
        const body = agentRunsRequestSchema.parse(await readJson(request));
        const run = await runCodexTask(projectPath, { taskId: body.taskId });
        sendJson(response, 201, { run: browserSafeAgentRun(run) });
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      handleError(response, error);
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = await loadBridgeConfig();
  await ensureAnnotationDirs(config.projectPath);
  createBridgeServer(config).listen(port, host, () => {
    console.log(`ui-annotations bridge listening at http://${host}:${port}`);
    console.log(`project: ${config.projectName}`);
    console.log(`access key: ${config.accessKey}`);
  });
}
