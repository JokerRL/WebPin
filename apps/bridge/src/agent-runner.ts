import { spawn } from "node:child_process";
import { readTaskPrompt, safeTaskSlug, type AgentRun, writeAgentRun } from "./store.js";

export type AgentExecutor = (
  command: string,
  args: string[],
  options: { cwd: string }
) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;

export const spawnExecutor: AgentExecutor = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });

function runIdFor(taskId: string, startedAt: string): string {
  return `run_${taskId}_${startedAt.replace(/[^0-9]/g, "")}`;
}

export async function runCodexTask(
  projectPath: string,
  input: { taskId: string },
  executor: AgentExecutor = spawnExecutor
): Promise<AgentRun> {
  const taskId = safeTaskSlug(input.taskId);
  const startedAt = new Date().toISOString();
  const { prompt, promptPath } = await readTaskPrompt(projectPath, taskId);
  const command = "codex";
  const args = ["exec", "--sandbox", "workspace-write", prompt];
  const result = await executor(command, args, { cwd: projectPath });
  const finishedAt = new Date().toISOString();
  const run: AgentRun = {
    runId: runIdFor(taskId, startedAt),
    taskId,
    agent: "codex",
    status: result.exitCode === 0 ? "completed" : "failed",
    command: [command, ...args],
    startedAt,
    finishedAt,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    promptPath
  };

  return writeAgentRun(projectPath, run);
}
