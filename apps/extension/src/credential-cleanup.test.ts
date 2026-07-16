import { describe, expect, it } from "vitest";
import { clearCredentialsIfCurrent } from "./credential-cleanup";

function storageWith(initial: Record<string, unknown>) {
  const values = { ...initial };
  return {
    values,
    adapter: {
      get: async (key: string) => ({ [key]: values[key] }),
      remove: async (keys: string[]) => {
        for (const key of keys) delete values[key];
      }
    }
  };
}

describe("clearCredentialsIfCurrent", () => {
  it("clears the matching active credential and project name", async () => {
    const storage = storageWith({
      "ui-annotations.accessKey": "active-a",
      "ui-annotations.projectName": "WebPin",
      "ui-annotations.projectId": "project_webpin",
      "ui-annotations.pendingAnnotations": [{ id: "ann_legacy", projectId: "webpin" }]
    });

    await expect(clearCredentialsIfCurrent(storage.adapter, "active-a")).resolves.toBe(true);
    expect(storage.values).toEqual({
      "ui-annotations.pendingAnnotations": [{ id: "ann_legacy", projectId: "webpin" }]
    });
  });

  it("preserves active A when rejected replacement candidate B fails", async () => {
    const storage = storageWith({
      "ui-annotations.accessKey": "active-a",
      "ui-annotations.projectName": "WebPin",
      "ui-annotations.projectId": "project_active_a"
    });

    await expect(clearCredentialsIfCurrent(storage.adapter, "candidate-b")).resolves.toBe(false);
    expect(storage.values).toEqual({
      "ui-annotations.accessKey": "active-a",
      "ui-annotations.projectName": "WebPin",
      "ui-annotations.projectId": "project_active_a"
    });
  });

  it("preserves current B when a delayed failure arrives for old A", async () => {
    const storage = storageWith({
      "ui-annotations.accessKey": "active-b",
      "ui-annotations.projectName": "Other",
      "ui-annotations.projectId": "project_active_b"
    });

    await expect(clearCredentialsIfCurrent(storage.adapter, "active-a")).resolves.toBe(false);
    expect(storage.values).toEqual({
      "ui-annotations.accessKey": "active-b",
      "ui-annotations.projectName": "Other",
      "ui-annotations.projectId": "project_active_b"
    });
  });

  it("does not clear when no credential is stored", async () => {
    const storage = storageWith({ "ui-annotations.projectName": "WebPin" });
    await expect(clearCredentialsIfCurrent(storage.adapter, "active-a")).resolves.toBe(false);
    expect(storage.values).toEqual({ "ui-annotations.projectName": "WebPin" });
  });
});
