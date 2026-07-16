import { describe, expect, it } from "vitest";
import {
  accessKeyStorageKey,
  legacyProjectPathStorageKey,
  nextConnectionState,
  projectNameStorageKey,
  projectIdStorageKey,
  storageKeysToRemoveAfterAuthFailure
} from "./connection";

describe("nextConnectionState", () => {
  it("reports offline when health cannot be reached", () => {
    expect(nextConnectionState({ health: "offline", accessKey: "key" })).toEqual({ status: "offline" });
  });

  it("requires a key when the bridge is online and no key is stored", () => {
    expect(nextConnectionState({ health: "online", accessKey: "" })).toEqual({ status: "key-required" });
  });

  it("requires a new key after session rejection", () => {
    expect(nextConnectionState({ health: "online", accessKey: "old", session: "rejected" })).toEqual({
      status: "key-required"
    });
  });

  it("reports ready only after session verification", () => {
    expect(
      nextConnectionState({
        health: "online",
        accessKey: "key",
        session: { projectName: "WebPin", projectId: "project_webpin" }
      })
    ).toEqual({ status: "ready", projectName: "WebPin", projectId: "project_webpin" });
  });
});

describe("connection storage keys", () => {
  it("uses the established connection storage key names", () => {
    expect(accessKeyStorageKey).toBe("ui-annotations.accessKey");
    expect(legacyProjectPathStorageKey).toBe("ui-annotations.projectPath");
    expect(projectNameStorageKey).toBe("ui-annotations.projectName");
    expect(projectIdStorageKey).toBe("ui-annotations.projectId");
  });

  it("clears credentials and project name without touching pending annotations", () => {
    expect(storageKeysToRemoveAfterAuthFailure()).toEqual([
      accessKeyStorageKey,
      projectNameStorageKey,
      projectIdStorageKey
    ]);
    expect(storageKeysToRemoveAfterAuthFailure()).not.toContain("ui-annotations.pendingAnnotations");
    expect(storageKeysToRemoveAfterAuthFailure()).not.toContain(legacyProjectPathStorageKey);
  });
});
