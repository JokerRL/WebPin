import { describe, expect, it, vi } from "vitest";
import { createBridgeClient } from "./bridge-client";

describe("createBridgeClient", () => {
  it("adds the access key to protected requests", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ready: true, projectName: "WebPin" }), {
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

    await expect(createBridgeClient({ accessKey: "old", fetcher }).getSession()).rejects.toMatchObject({
      kind: "auth"
    });
  });

  it("normalizes a fetch failure as an offline error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(createBridgeClient({ accessKey: "secret", fetcher }).getHealth()).rejects.toMatchObject({
      kind: "offline"
    });
  });
});
