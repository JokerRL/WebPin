import { describe, expect, it, vi } from "vitest";
import type { Annotation } from "@ui-annotations/shared";
import { BridgeClientError, createBridgeClient } from "./bridge-client";

const representativeAnnotation = {
  id: "ann_001",
  projectId: "webpin",
  page: {
    url: "http://localhost:3000/settings",
    route: "/settings",
    title: "Settings",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 }
  },
  anchor: {
    visual: {
      boundingBox: { x: 100, y: 200, width: 240, height: 48 }
    }
  },
  note: "Align the control with the form fields.",
  changeType: "layout",
  priority: "medium",
  status: "open",
  targetPlatforms: ["web"],
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z"
} satisfies Annotation;

async function captureBridgeClientError(request: Promise<unknown>): Promise<BridgeClientError> {
  try {
    await request;
    throw new Error("Expected bridge request to reject.");
  } catch (error) {
    expect(error).toBeInstanceOf(BridgeClientError);
    return error as BridgeClientError;
  }
}

describe("createBridgeClient", () => {
  it("adds the access key to protected requests", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ready: true, projectName: "WebPin", projectId: "project_webpin_test" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await createBridgeClient({ accessKey: "secret", fetcher }).getSession();

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/session",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-webpin-key": "secret" })
      })
    );
  });

  it("does not attach the access key to public health requests", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true, authentication: "access-key" }))
    );

    await createBridgeClient({ accessKey: "secret", fetcher }).getHealth();

    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("x-webpin-key")).toBe(false);
  });

  it("normalizes a rejected access key as an auth error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: "invalid_access_key" }), { status: 401 })
    );

    const error = await captureBridgeClientError(
      createBridgeClient({ accessKey: "old", fetcher }).getSession()
    );

    expect(error).toMatchObject({ kind: "auth", message: "Access key rejected." });
  });

  it("accepts a valid verified session response", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ready: true,
      projectName: "WebPin",
      projectId: "project_AbCdEf0123_-opaque"
    })));

    await expect(createBridgeClient({ accessKey: "secret", fetcher }).getSession()).resolves.toEqual({
      ready: true,
      projectName: "WebPin",
      projectId: "project_AbCdEf0123_-opaque"
    });
  });

  it.each([
    ["missing projectId", { ready: true, projectName: "WebPin" }],
    ["malformed projectId", { ready: true, projectName: "WebPin", projectId: "../WebPin" }],
    ["false ready state", { ready: false, projectName: "WebPin", projectId: "project_valid" }],
    ["empty project name", { ready: true, projectName: "", projectId: "project_valid" }]
  ])("rejects a session with %s as an HTTP protocol error", async (_label, body) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
    const error = await captureBridgeClientError(
      createBridgeClient({ accessKey: "secret", fetcher }).getSession()
    );
    expect(error.kind).toBe("http");
  });

  it("normalizes a fetch failure as an offline error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });

    const error = await captureBridgeClientError(
      createBridgeClient({ accessKey: "secret", fetcher }).getHealth()
    );

    expect(error).toMatchObject({ kind: "offline", message: "fetch failed" });
  });

  it("preserves target platforms in annotation update patches", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ annotation: representativeAnnotation }), { status: 200 })
    );

    await createBridgeClient({ accessKey: "secret", fetcher }).updateAnnotation("ann_001", {
      targetPlatforms: ["web"]
    });

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/annotations/ann_001",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ patch: { targetPlatforms: ["web"] } })
      })
    );
  });

  it.each([
    ["malformed JSON", () => new Response("{")],
    ["JSON null", () => new Response("null")],
    ["an empty body", () => new Response()]
  ])("normalizes a successful response with %s as an HTTP protocol error", async (_label, response) => {
    const fetcher = vi.fn<typeof fetch>(async () => response());

    const error = await captureBridgeClientError(
      createBridgeClient({ accessKey: "secret", fetcher }).getSession()
    );

    expect(error.kind).toBe("http");
    expect(error.message).toMatch(/invalid JSON response/i);
  });

  it("normalizes a malformed error response as an HTTP protocol error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("{", { status: 500 }));

    const error = await captureBridgeClientError(
      createBridgeClient({ accessKey: "secret", fetcher }).getSession()
    );

    expect(error.kind).toBe("http");
    expect(error.message).toMatch(/invalid JSON response/i);
  });

  it("keeps a malformed 401 response classified as auth", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("{", { status: 401 }));

    const error = await captureBridgeClientError(
      createBridgeClient({ accessKey: "old", fetcher }).getSession()
    );

    expect(error).toMatchObject({ kind: "auth", message: "Access key rejected." });
  });
});
