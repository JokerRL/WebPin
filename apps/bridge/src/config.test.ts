import { constants } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadBridgeConfig, type ConfigDependencies } from "./config.js";

function createDependencies(): ConfigDependencies {
  return {
    realpath: vi.fn(async (path: string) => `/canonical${path}`),
    access: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({ isDirectory: () => true })),
    randomKey: vi.fn(() => "test-startup-key")
  };
}

describe("loadBridgeConfig", () => {
  it("requires UI_ANNOTATIONS_PROJECT_PATH", async () => {
    await expect(loadBridgeConfig({}, createDependencies())).rejects.toThrow(
      "UI_ANNOTATIONS_PROJECT_PATH is required"
    );
  });

  it("rejects a relative project path", async () => {
    await expect(
      loadBridgeConfig({ UI_ANNOTATIONS_PROJECT_PATH: "workspace/WebPin" }, createDependencies())
    ).rejects.toThrow("must be absolute");
  });

  it("returns the canonical project and a generated startup key", async () => {
    const dependencies = createDependencies();

    await expect(
      loadBridgeConfig({ UI_ANNOTATIONS_PROJECT_PATH: "/workspace/WebPin" }, dependencies)
    ).resolves.toEqual({
      projectPath: "/canonical/workspace/WebPin",
      projectName: "WebPin",
      accessKey: "test-startup-key"
    });
    expect(dependencies.access).toHaveBeenCalledWith(
      "/canonical/workspace/WebPin",
      constants.R_OK | constants.W_OK
    );
  });

  it("rejects a project path that is not a directory", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.stat).mockResolvedValue({ isDirectory: () => false });

    await expect(
      loadBridgeConfig({ UI_ANNOTATIONS_PROJECT_PATH: "/workspace/WebPin" }, dependencies)
    ).rejects.toThrow("must be a directory");
  });

  it("propagates project access failures", async () => {
    const dependencies = createDependencies();
    const accessError = Object.assign(new Error("permission denied"), { code: "EACCES" });
    vi.mocked(dependencies.access).mockRejectedValue(accessError);

    await expect(
      loadBridgeConfig({ UI_ANNOTATIONS_PROJECT_PATH: "/workspace/WebPin" }, dependencies)
    ).rejects.toBe(accessError);
  });
});
