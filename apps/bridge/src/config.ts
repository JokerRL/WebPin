import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";

export interface BridgeConfig {
  projectPath: string;
  projectName: string;
  accessKey: string;
}

export interface ConfigDependencies {
  realpath(path: string): Promise<string>;
  access(path: string, mode: number): Promise<void>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  randomKey(): string;
}

const defaultDependencies: ConfigDependencies = {
  realpath,
  access,
  stat,
  randomKey: () => randomBytes(24).toString("base64url")
};

export async function loadBridgeConfig(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: ConfigDependencies = defaultDependencies
): Promise<BridgeConfig> {
  const configuredPath = env.UI_ANNOTATIONS_PROJECT_PATH?.trim();
  if (!configuredPath) {
    throw new Error("UI_ANNOTATIONS_PROJECT_PATH is required");
  }
  if (!isAbsolute(configuredPath)) {
    throw new Error("UI_ANNOTATIONS_PROJECT_PATH must be absolute");
  }

  const projectPath = await dependencies.realpath(configuredPath);
  const projectStats = await dependencies.stat(projectPath);
  if (!projectStats.isDirectory()) {
    throw new Error("UI_ANNOTATIONS_PROJECT_PATH must be a directory");
  }

  await dependencies.access(projectPath, constants.R_OK | constants.W_OK);

  return {
    projectPath,
    projectName: basename(projectPath),
    accessKey: dependencies.randomKey()
  };
}
