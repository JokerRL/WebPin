export const accessKeyStorageKey = "ui-annotations.accessKey";
export const legacyProjectPathStorageKey = "ui-annotations.projectPath";
export const projectNameStorageKey = "ui-annotations.projectName";

export type ConnectionInput = {
  health: "online" | "offline";
  accessKey: string;
  session?: "rejected" | { projectName: string };
};

export type ConnectionState =
  | { status: "offline" }
  | { status: "key-required" }
  | { status: "ready"; projectName: string };

export function nextConnectionState(input: ConnectionInput): ConnectionState {
  if (input.health === "offline") return { status: "offline" };
  if (!input.accessKey || input.session === "rejected" || !input.session) return { status: "key-required" };
  return { status: "ready", projectName: input.session.projectName };
}

export function storageKeysToRemoveAfterAuthFailure(): string[] {
  return [accessKeyStorageKey, projectNameStorageKey];
}
