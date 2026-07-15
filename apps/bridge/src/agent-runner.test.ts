import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTaskFiles, readAgentRun } from "./store.js";
import { runCodexTask, type AgentExecutor } from "./agent-runner.js";

const annotation = {
  id: "ann_001",
  projectId: "sample",
  page: {
    url: "http://localhost:3000/settings",
    route: "/settings",
    title: "Settings",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 }
  },
  anchor: {
    dom: {
      selector: "[data-testid='save-button']",
      boundingBox: { x: 920, y: 740, width: 140, height: 44 }
    },
    visual: {
      screenshot: "assets/screenshots/ann_001.png",
      boundingBox: { x: 920, y: 740, width: 140, height: 44 }
    }
  },
  note: "Button should be taller.",
  changeType: "layout",
  priority: "medium",
  status: "open",
  targetPlatforms: ["web", "ios-swiftui"],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
} as const;

describe("runCodexTask", () => {
  it("runs codex exec with a fixed argument shape and stores the completed run", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    await createTaskFiles(projectPath, {
      taskId: "task_001",
      annotations: [annotation],
      userIntent: "Align save button.",
      acceptanceCriteria: ["Button height matches controls."]
    });
    const calls: Parameters<AgentExecutor>[] = [];
    const executor: AgentExecutor = async (...args) => {
      calls.push(args);
      return { exitCode: 0, stdout: "Codex completed", stderr: "progress" };
    };

    const run = await runCodexTask(projectPath, { taskId: "task_001" }, executor);

    expect(calls[0]?.[0]).toBe("codex");
    expect(calls[0]?.[1].slice(0, 3)).toEqual(["exec", "--sandbox", "workspace-write"]);
    expect(calls[0]?.[1][3]).toContain("Read .ui-annotations/tasks/task_001.md");
    expect(calls[0]?.[2]).toEqual({ cwd: projectPath });
    expect(run).toMatchObject({ taskId: "task_001", agent: "codex", status: "completed", exitCode: 0 });
    await expect(readAgentRun(projectPath, run.runId)).resolves.toMatchObject({ stdout: "Codex completed" });
  });

  it("stores failed codex runs without throwing", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    await createTaskFiles(projectPath, {
      taskId: "task_001",
      annotations: [annotation],
      userIntent: "Align save button.",
      acceptanceCriteria: ["Button height matches controls."]
    });
    const executor: AgentExecutor = async () => ({ exitCode: 1, stdout: "", stderr: "tests failed" });

    const run = await runCodexTask(projectPath, { taskId: "task_001" }, executor);

    expect(run).toMatchObject({ status: "failed", exitCode: 1, stderr: "tests failed" });
  });
});
