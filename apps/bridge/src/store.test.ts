import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendAnnotation,
  createTaskFiles,
  deleteAnnotation,
  ensureAnnotationDirs,
  listAnnotations,
  readAgentRun,
  readProjectSettings,
  readTaskPrompt,
  updateProjectSettings,
  updateAnnotation,
  writeAnnotationAsset,
  writeAgentRun
} from "./store.js";

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

const agentRun = {
  runId: "run_task_001_20260702T120000000Z",
  taskId: "task_001",
  agent: "codex",
  status: "completed",
  command: ["codex", "exec", "--sandbox", "workspace-write", "Read task."],
  startedAt: "2026-07-02T12:00:00.000Z",
  finishedAt: "2026-07-02T12:01:00.000Z",
  exitCode: 0,
  stdout: "Done",
  stderr: "",
  promptPath: ".ui-annotations/tasks/task_001.prompt.md"
} as const;

const taskInput = {
  taskId: "task_001",
  annotations: [annotation],
  userIntent: "Align save button.",
  acceptanceCriteria: ["Button height matches controls."]
};

async function createOutsideFile(contents = "outside-content"): Promise<{ path: string; contents: string }> {
  const outsideDirectory = await mkdtemp(join(tmpdir(), "ui-annotations-outside-"));
  const path = join(outsideDirectory, "outside.txt");
  await writeFile(path, contents, "utf8");
  return { path, contents };
}

describe("store", () => {
  it("supports concurrent annotation directory initialization", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-project-"));

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => ensureAnnotationDirs(projectPath))
    );

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
  });

  it("rejects a symbolic-link annotation root", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-project-"));
    const outsidePath = await mkdtemp(join(tmpdir(), "ui-annotations-outside-"));
    await symlink(outsidePath, join(projectPath, ".ui-annotations"));

    await expect(ensureAnnotationDirs(projectPath)).rejects.toThrow(
      "managed annotation directory must not be a symbolic link"
    );
  });

  it("rejects a symbolic-link managed subdirectory", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-project-"));
    const outsidePath = await mkdtemp(join(tmpdir(), "ui-annotations-outside-"));
    const annotationPath = join(projectPath, ".ui-annotations");
    await mkdir(annotationPath);
    await symlink(outsidePath, join(annotationPath, "tasks"));

    await expect(ensureAnnotationDirs(projectPath)).rejects.toThrow(
      "managed annotation directory must not be a symbolic link"
    );
  });

  it.each([
    {
      name: "annotations.jsonl",
      filename: "annotations.jsonl",
      operation: (projectPath: string) => appendAnnotation(projectPath, annotation)
    },
    {
      name: "events.jsonl",
      filename: "events.jsonl",
      operation: (projectPath: string) => appendAnnotation(projectPath, annotation)
    },
    {
      name: "project.json",
      filename: "project.json",
      operation: (projectPath: string) => updateProjectSettings(projectPath, { screenshotCaptureEnabled: true })
    }
  ])("rejects a symbolic-link root managed file: $name", async ({ filename, operation }) => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-project-"));
    const outside = await createOutsideFile(filename === "project.json" ? "{}" : "outside-content");
    await ensureAnnotationDirs(projectPath);
    await symlink(outside.path, join(projectPath, ".ui-annotations", filename));

    await expect(operation(projectPath)).rejects.toThrow();
    await expect(readFile(outside.path, "utf8")).resolves.toBe(outside.contents);
  });

  it.each(["json", "md", "prompt.md"])(
    "rejects a symbolic-link task %s output",
    async (extension) => {
      const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-project-"));
      const outside = await createOutsideFile();
      await ensureAnnotationDirs(projectPath);
      await symlink(outside.path, join(projectPath, ".ui-annotations", "tasks", `task_001.${extension}`));

      await expect(createTaskFiles(projectPath, taskInput)).rejects.toThrow();
      await expect(readFile(outside.path, "utf8")).resolves.toBe(outside.contents);
    }
  );

  it("rejects a symbolic-link asset output filename", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-project-"));
    const outside = await createOutsideFile();
    await ensureAnnotationDirs(projectPath);
    await symlink(outside.path, join(projectPath, ".ui-annotations", "assets", "screenshots", "ann_001.png"));

    await expect(
      writeAnnotationAsset(projectPath, {
        annotationId: "ann_001",
        kind: "screenshot",
        dataUrl: "data:image/png;base64,aGVsbG8="
      })
    ).rejects.toThrow();
    await expect(readFile(outside.path, "utf8")).resolves.toBe(outside.contents);
  });

  it("rejects a symbolic-link run record filename", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-project-"));
    const outside = await createOutsideFile();
    await ensureAnnotationDirs(projectPath);
    await symlink(
      outside.path,
      join(projectPath, ".ui-annotations", "runs", "run_task_001_20260702T120000000Z.json")
    );

    await expect(writeAgentRun(projectPath, agentRun)).rejects.toThrow();
    await expect(readFile(outside.path, "utf8")).resolves.toBe(outside.contents);
  });

  it("rejects a symbolic-link task prompt read without returning outside content", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-project-"));
    const outside = await createOutsideFile("outside prompt");
    await ensureAnnotationDirs(projectPath);
    await symlink(outside.path, join(projectPath, ".ui-annotations", "tasks", "task_001.prompt.md"));

    await expect(readTaskPrompt(projectPath, "task_001")).rejects.toThrow();
  });

  it("rejects a non-regular final managed file target", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-project-"));
    await ensureAnnotationDirs(projectPath);
    await mkdir(join(projectPath, ".ui-annotations", "project.json"));

    await expect(readProjectSettings(projectPath)).rejects.toThrow();
  });

  it("appends validated annotations as jsonl", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    await appendAnnotation(projectPath, annotation);

    const contents = await readFile(join(projectPath, ".ui-annotations", "annotations.jsonl"), "utf8");
    expect(contents).toContain("\"id\":\"ann_001\"");
  });

  it("lists the latest non-deleted annotation versions", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    await appendAnnotation(projectPath, annotation);
    await updateAnnotation(projectPath, "ann_001", {
      status: "resolved",
      note: "Button height now matches controls."
    });

    const annotations = await listAnnotations(projectPath);

    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      id: "ann_001",
      note: "Button height now matches controls.",
      status: "resolved"
    });
  });

  it("records deleted annotations in events and excludes them from active lists", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    await appendAnnotation(projectPath, annotation);
    await deleteAnnotation(projectPath, "ann_001");

    expect(await listAnnotations(projectPath)).toEqual([]);
    const events = await readFile(join(projectPath, ".ui-annotations", "events.jsonl"), "utf8");
    expect(events).toContain("\"type\":\"annotation.deleted\"");
    expect(events).toContain("\"annotationId\":\"ann_001\"");
  });

  it("creates JSON and Markdown task files", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const result = await createTaskFiles(projectPath, {
      taskId: "task_001",
      annotations: [annotation],
      userIntent: "Align save button.",
      acceptanceCriteria: ["Button height matches controls."],
      suggestedFiles: ["src/settings/SettingsForm.tsx"]
    });

    expect(result.jsonPath).toMatch(/task_001\.json$/);
    expect(result.markdownPath).toMatch(/task_001\.md$/);
    expect(result.promptPath).toMatch(/task_001\.prompt\.md$/);
    const markdown = await readFile(result.markdownPath, "utf8");
    const prompt = await readFile(result.promptPath, "utf8");
    expect(markdown).toContain("Align save button.");
    expect(markdown).toContain("## Evidence");
    expect(markdown).toContain("- Screenshot: assets/screenshots/ann_001.png");
    expect(markdown).toContain("## Target Platforms");
    expect(markdown).toContain("- ios-swiftui");
    expect(markdown).toContain("## Suggested Files");
    expect(markdown).toContain("- src/settings/SettingsForm.tsx");
    expect(markdown).toContain("## Suggested Next Steps");
    expect(prompt).toContain("Read .ui-annotations/tasks/task_001.md");
    expect(prompt).toContain("Use evidence paths, visual anchors, DOM anchors, target platforms, and suggested files");
    expect(prompt).toContain("Keep the change narrowly scoped.");
  });

  it("writes and reads agent run records", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    await writeAgentRun(projectPath, agentRun);

    const run = await readAgentRun(projectPath, "run_task_001_20260702T120000000Z");

    expect(run).toMatchObject({
      runId: "run_task_001_20260702T120000000Z",
      status: "completed",
      stdout: "Done"
    });
  });

  it("rejects task ids that could escape the tasks directory", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));

    await expect(
      createTaskFiles(projectPath, {
        taskId: "../../escape",
        annotations: [annotation],
        userIntent: "Align save button.",
        acceptanceCriteria: ["Button height matches controls."]
      })
    ).rejects.toThrow("taskId must be a filename-safe slug");
  });

  it("reads and updates project screenshot settings", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));

    await expect(readProjectSettings(projectPath)).resolves.toMatchObject({ screenshotCaptureEnabled: false });
    const settings = await updateProjectSettings(projectPath, { screenshotCaptureEnabled: true });

    expect(settings).toMatchObject({ screenshotCaptureEnabled: true });
    const projectJson = await readFile(join(projectPath, ".ui-annotations", "project.json"), "utf8");
    expect(JSON.parse(projectJson)).toMatchObject({ screenshotCaptureEnabled: true });
  });

  it("writes annotation screenshot and crop assets inside annotation storage", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));
    const dataUrl = "data:image/png;base64,aGVsbG8=";

    const screenshot = await writeAnnotationAsset(projectPath, {
      annotationId: "ann_001",
      kind: "screenshot",
      dataUrl
    });
    const crop = await writeAnnotationAsset(projectPath, {
      annotationId: "ann_001",
      kind: "crop",
      dataUrl
    });

    expect(screenshot).toBe("assets/screenshots/ann_001.png");
    expect(crop).toBe("assets/crops/ann_001.png");
    await expect(readFile(join(projectPath, ".ui-annotations", screenshot), "utf8")).resolves.toBe("hello");
    await expect(readFile(join(projectPath, ".ui-annotations", crop), "utf8")).resolves.toBe("hello");
  });

  it("rejects unsafe annotation asset names", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "ui-annotations-"));

    await expect(
      writeAnnotationAsset(projectPath, {
        annotationId: "../ann_001",
        kind: "screenshot",
        dataUrl: "data:image/png;base64,aGVsbG8="
      })
    ).rejects.toThrow("annotationId must be a filename-safe annotation id");
  });
});
