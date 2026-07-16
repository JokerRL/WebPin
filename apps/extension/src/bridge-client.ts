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
  constructor(
    public readonly kind: "offline" | "auth" | "http",
    message: string
  ) {
    super(message);
    this.name = "BridgeClientError";
  }
}

type ClientOptions = {
  accessKey: string;
  fetcher?: typeof fetch;
  bridgeUrl?: string;
};

type BridgeErrorBody = {
  error?: string;
  message?: string;
};

export type BridgeSession = {
  ready: true;
  projectName: string;
  projectId: string;
};

function parseSession(value: unknown): BridgeSession {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { ready?: unknown }).ready !== true ||
    typeof (value as { projectName?: unknown }).projectName !== "string" ||
    !(value as { projectName: string }).projectName.trim() ||
    typeof (value as { projectId?: unknown }).projectId !== "string" ||
    !/^project_[a-zA-Z0-9_-]+$/.test((value as { projectId: string }).projectId)
  ) {
    throw new BridgeClientError("http", "Invalid session response from bridge.");
  }
  return value as BridgeSession;
}

function invalidJsonResponse(response: Response): BridgeClientError {
  return new BridgeClientError(
    "http",
    `Invalid JSON response from bridge (status ${response.status}).`
  );
}

export function createBridgeClient({
  accessKey,
  fetcher = fetch,
  bridgeUrl = defaultBridgeUrl
}: ClientOptions) {
  async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body) {
      headers.set("content-type", "application/json");
    }
    if (authenticated) {
      headers.set("x-webpin-key", accessKey);
    }

    let response: Response;
    try {
      response = await fetcher(`${bridgeUrl}${path}`, {
        ...init,
        headers: Object.fromEntries(headers.entries())
      });
    } catch (error) {
      throw new BridgeClientError("offline", error instanceof Error ? error.message : String(error));
    }

    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
    } catch {
      if (response.status === 401) {
        throw new BridgeClientError("auth", "Access key rejected.");
      }
      throw invalidJsonResponse(response);
    }

    if (parsedBody === null || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      if (response.status === 401) {
        throw new BridgeClientError("auth", "Access key rejected.");
      }
      throw invalidJsonResponse(response);
    }

    const body = parsedBody as BridgeErrorBody;
    if (response.status === 401 || body.error === "invalid_access_key") {
      throw new BridgeClientError("auth", body.message ?? "Access key rejected.");
    }
    if (!response.ok) {
      throw new BridgeClientError(
        "http",
        body.message ?? body.error ?? `Bridge request failed (${response.status}).`
      );
    }

    return body as T;
  }

  return {
    getHealth: () => request<{ ok: true; authentication: "access-key" }>("/health", {}, false),
    getSession: async () => parseSession(await request<unknown>("/session")),
    listAnnotations: () => request<{ annotations: Annotation[] }>("/annotations"),
    createAnnotation: (annotation: Annotation) =>
      request<{ annotation: Annotation }>("/annotations", {
        method: "POST",
        body: JSON.stringify({ annotation })
      }),
    updateAnnotation: (id: string, patch: EditableAnnotationPatch) =>
      request<{ annotation: Annotation }>(`/annotations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ patch })
      }),
    deleteAnnotation: (id: string) =>
      request<{ ok: true }>(`/annotations/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: JSON.stringify({})
      }),
    getProjectSettings: () =>
      request<{ settings: { screenshotCaptureEnabled: boolean } }>("/project-settings"),
    updateProjectSettings: (screenshotCaptureEnabled: boolean) =>
      request<{ settings: { screenshotCaptureEnabled: boolean } }>("/project-settings", {
        method: "PATCH",
        body: JSON.stringify({ patch: { screenshotCaptureEnabled } })
      }),
    writeAsset: (input: {
      annotationId: string;
      kind: "screenshot" | "crop";
      dataUrl: string;
    }) =>
      request<{ path: string }>("/assets", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    createTask: (input: {
      taskId: string;
      annotations: Annotation[];
      userIntent: string;
      acceptanceCriteria: string[];
      suggestedFiles?: string[];
    }) =>
      request<{ jsonPath: string; markdownPath: string; promptPath: string }>("/tasks", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    runAgent: (taskId: string) =>
      request<{ run: { runId: string; status: "completed" | "failed" } }>("/agent-runs", {
        method: "POST",
        body: JSON.stringify({ taskId, agent: "codex" })
      })
  };
}

export type BridgeClient = ReturnType<typeof createBridgeClient>;
