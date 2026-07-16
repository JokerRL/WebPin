export const accessKeyStorageKey = "ui-annotations.accessKey";
export const legacyProjectPathStorageKey = "ui-annotations.projectPath";
export const projectNameStorageKey = "ui-annotations.projectName";
export const projectIdStorageKey = "ui-annotations.projectId";

export type ConnectionInput = {
  health: "online" | "offline";
  accessKey: string;
  session?: "rejected" | { projectName: string; projectId: string };
};

export type ConnectionState =
  | { status: "offline" }
  | { status: "key-required" }
  | { status: "ready"; projectName: string; projectId: string };

export function nextConnectionState(input: ConnectionInput): ConnectionState {
  if (input.health === "offline") return { status: "offline" };
  if (!input.accessKey || input.session === "rejected" || !input.session) return { status: "key-required" };
  return { status: "ready", projectName: input.session.projectName, projectId: input.session.projectId };
}

export function storageKeysToRemoveAfterAuthFailure(): string[] {
  return [accessKeyStorageKey, projectNameStorageKey, projectIdStorageKey];
}
