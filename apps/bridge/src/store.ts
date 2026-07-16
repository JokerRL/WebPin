import { constants } from "node:fs";
import { lstat, mkdir, open, type FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { annotationSchema, createTaskPackage, type Annotation } from "@ui-annotations/shared";

function annotationRoot(projectPath: string): string {
  return join(projectPath, ".ui-annotations");
}

type EditableAnnotationFields = Pick<Annotation, "note" | "changeType" | "priority" | "status" | "targetPlatforms">;
type AnnotationPatch = {
  [Key in keyof EditableAnnotationFields]?: EditableAnnotationFields[Key] | undefined;
};

const projectIdSchema = z.string().regex(/^project_[a-zA-Z0-9_-]+$/);

const projectFileSchema = z
  .object({
    projectId: projectIdSchema.optional(),
    screenshotCaptureEnabled: z.boolean().default(false)
  })
  .passthrough()
  .default({ screenshotCaptureEnabled: false });

const annotationAssetSchema = z.object({
  annotationId: z.string().regex(/^ann_[a-zA-Z0-9_-]{1,80}$/, "annotationId must be a filename-safe annotation id"),
  kind: z.enum(["screenshot", "crop"]),
  dataUrl: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/)
});

export type ProjectSettings = Pick<z.infer<typeof projectFileSchema>, "screenshotCaptureEnabled">;
export type ProjectSettingsPatch = {
  [Key in keyof ProjectSettings]?: ProjectSettings[Key] | undefined;
};
export type AnnotationAssetInput = z.infer<typeof annotationAssetSchema>;

export type AgentRun = {
  runId: string;
  taskId: string;
  agent: "codex";
  status: "completed" | "failed";
  command: string[];
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  promptPath: string;
};

const noFollowFlag = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
const nonBlockFlag = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
const managedFileMode = 0o600;

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function managedFileTargetError(): Error {
  return new Error("managed annotation file must be a regular file");
}

async function rejectUnsupportedFinalTarget(filePath: string): Promise<void> {
  if (noFollowFlag !== 0) {
    return;
  }

  // Compatibility defense for platforms without O_NOFOLLOW. This rejects a
  // final-component link observed here, but cannot protect against a hostile
  // process swapping that component between lstat and open.
  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw managedFileTargetError();
    }
  } catch (error) {
    if (!isFileSystemError(error, "ENOENT")) {
      throw error;
    }
  }
}

async function withManagedRegularFile<T>(
  filePath: string,
  flags: number,
  operation: (handle: FileHandle) => Promise<T>
): Promise<T> {
  await rejectUnsupportedFinalTarget(filePath);

  let handle: FileHandle;
  try {
    handle = await open(filePath, flags | noFollowFlag | nonBlockFlag, managedFileMode);
  } catch (error) {
    if (isFileSystemError(error, "ELOOP")) {
      throw managedFileTargetError();
    }
    throw error;
  }

  try {
    if (!(await handle.stat()).isFile()) {
      throw managedFileTargetError();
    }
    return await operation(handle);
  } finally {
    await handle.close();
  }
}

async function readManagedFile(filePath: string): Promise<string> {
  return withManagedRegularFile(filePath, constants.O_RDONLY, (handle) => handle.readFile("utf8"));
}

async function writeManagedFile(filePath: string, contents: string | Uint8Array): Promise<void> {
  await withManagedRegularFile(
    filePath,
    constants.O_WRONLY | constants.O_CREAT,
    async (handle) => {
      await handle.truncate(0);
      await handle.writeFile(contents);
    }
  );
}

async function appendManagedFile(filePath: string, contents: string): Promise<void> {
  await withManagedRegularFile(
    filePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
    async (handle) => {
      await handle.appendFile(contents, "utf8");
    }
  );
}

async function readJsonLines(filePath: string): Promise<unknown[]> {
  try {
    const contents = await readManagedFile(filePath);
    return contents
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

export function safeTaskSlug(taskId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(taskId)) {
    throw new Error("taskId must be a filename-safe slug");
  }

  return taskId;
}

function assertInside(parent: string, child: string): string {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  const rel = relative(resolvedParent, resolvedChild);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("resolved path escapes annotation directory");
  }

  return resolvedChild;
}

export async function ensureAnnotationDirs(projectPath: string): Promise<void> {
  const root = annotationRoot(projectPath);
  const assets = join(root, "assets");
  const directories = [
    root,
    join(root, "tasks"),
    join(root, "runs"),
    assets,
    join(assets, "screenshots"),
    join(assets, "crops"),
    join(assets, "dom-snapshots")
  ];

  for (const directory of directories) {
    await ensureManagedDirectory(directory);
  }
}

async function ensureManagedDirectory(path: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
    try {
      await mkdir(path);
    } catch (mkdirError) {
      if (!(mkdirError instanceof Error && "code" in mkdirError && mkdirError.code === "EEXIST")) {
        throw mkdirError;
      }
    }
    stats = await lstat(path);
  }

  if (stats.isSymbolicLink()) {
    throw new Error("managed annotation directory must not be a symbolic link");
  }
  if (!stats.isDirectory()) {
    throw new Error("managed annotation path must be a directory");
  }
}

export async function readProjectSettings(projectPath: string): Promise<ProjectSettings> {
  await ensureAnnotationDirs(projectPath);
  try {
    const projectFile = projectFileSchema.parse(
      JSON.parse(await readManagedFile(join(annotationRoot(projectPath), "project.json")))
    );
    return { screenshotCaptureEnabled: projectFile.screenshotCaptureEnabled };
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) {
      return { screenshotCaptureEnabled: false };
    }
    throw error;
  }
}

function deterministicProjectId(projectPath: string): string {
  const digest = createHash("sha256").update(resolve(projectPath)).digest("base64url");
  return `project_${digest.slice(0, 22)}`;
}

export async function ensureProjectIdentity(projectPath: string): Promise<string> {
  await ensureAnnotationDirs(projectPath);
  const projectFilePath = join(annotationRoot(projectPath), "project.json");
  let projectFile: z.infer<typeof projectFileSchema>;
  try {
    projectFile = projectFileSchema.parse(JSON.parse(await readManagedFile(projectFilePath)));
  } catch (error) {
    if (!isFileSystemError(error, "ENOENT")) throw error;
    projectFile = projectFileSchema.parse({});
  }
  if (projectFile.projectId) return projectFile.projectId;

  const projectId = projectIdSchema.parse(deterministicProjectId(projectPath));
  await writeManagedFile(projectFilePath, `${JSON.stringify({ ...projectFile, projectId }, null, 2)}\n`);
  return projectId;
}

export async function updateProjectSettings(
  projectPath: string,
  patch: ProjectSettingsPatch
): Promise<ProjectSettings> {
  await ensureAnnotationDirs(projectPath);
  const projectFilePath = join(annotationRoot(projectPath), "project.json");
  let current: z.infer<typeof projectFileSchema>;
  try {
    current = projectFileSchema.parse(JSON.parse(await readManagedFile(projectFilePath)));
  } catch (error) {
    if (!isFileSystemError(error, "ENOENT")) throw error;
    current = projectFileSchema.parse({});
  }
  const projectFile = projectFileSchema.parse({ ...current, ...patch });
  await writeManagedFile(projectFilePath, `${JSON.stringify(projectFile, null, 2)}\n`);
  await appendManagedFile(
    join(annotationRoot(projectPath), "events.jsonl"),
    `${JSON.stringify({ type: "project-settings.updated", at: new Date().toISOString(), patch })}\n`
  );
  return { screenshotCaptureEnabled: projectFile.screenshotCaptureEnabled };
}

export async function writeAnnotationAsset(projectPath: string, rawInput: AnnotationAssetInput): Promise<string> {
  const input = annotationAssetSchema.parse(rawInput);
  await ensureAnnotationDirs(projectPath);

  const extension = input.dataUrl.startsWith("data:image/jpeg;") ? "jpg" : input.dataUrl.startsWith("data:image/webp;") ? "webp" : "png";
  const assetDirectory = input.kind === "screenshot" ? "screenshots" : "crops";
  const relativePath = join("assets", assetDirectory, `${input.annotationId}.${extension}`);
  const assetPath = assertInside(annotationRoot(projectPath), join(annotationRoot(projectPath), relativePath));
  const base64 = input.dataUrl.slice(input.dataUrl.indexOf(",") + 1);

  await writeManagedFile(assetPath, Buffer.from(base64, "base64"));
  await appendManagedFile(
    join(annotationRoot(projectPath), "events.jsonl"),
    `${JSON.stringify({
      type: "annotation-asset.written",
      annotationId: input.annotationId,
      kind: input.kind,
      path: relativePath,
      at: new Date().toISOString()
    })}\n`
  );
  return relativePath;
}

export async function appendAnnotation(projectPath: string, rawAnnotation: unknown): Promise<Annotation> {
  const annotation = annotationSchema.parse(rawAnnotation);
  await ensureAnnotationDirs(projectPath);
  await appendManagedFile(join(annotationRoot(projectPath), "annotations.jsonl"), `${JSON.stringify(annotation)}\n`);
  await appendManagedFile(
    join(annotationRoot(projectPath), "events.jsonl"),
    `${JSON.stringify({ type: "annotation.created", annotationId: annotation.id, at: annotation.createdAt })}\n`
  );
  return annotation;
}

export async function listAnnotations(projectPath: string): Promise<Annotation[]> {
  await ensureAnnotationDirs(projectPath);
  const root = annotationRoot(projectPath);
  const annotationRecords = await readJsonLines(join(root, "annotations.jsonl"));
  const eventRecords = await readJsonLines(join(root, "events.jsonl"));
  const latestById = new Map<string, Annotation>();

  for (const record of annotationRecords) {
    const annotation = annotationSchema.parse(record);
    latestById.set(annotation.id, annotation);
  }

  for (const record of eventRecords) {
    if (
      typeof record === "object" &&
      record !== null &&
      "type" in record &&
      record.type === "annotation.deleted" &&
      "annotationId" in record &&
      typeof record.annotationId === "string"
    ) {
      latestById.delete(record.annotationId);
    }
  }

  return Array.from(latestById.values()).sort((first, second) => first.createdAt.localeCompare(second.createdAt));
}

export async function updateAnnotation(
  projectPath: string,
  annotationId: string,
  patch: AnnotationPatch
): Promise<Annotation> {
  const current = (await listAnnotations(projectPath)).find((annotation) => annotation.id === annotationId);
  if (!current) {
    throw new Error("annotation not found");
  }
  const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));

  const updated = annotationSchema.parse({
    ...current,
    ...definedPatch,
    updatedAt: new Date().toISOString()
  });

  await appendManagedFile(join(annotationRoot(projectPath), "annotations.jsonl"), `${JSON.stringify(updated)}\n`);
  await appendManagedFile(
    join(annotationRoot(projectPath), "events.jsonl"),
    `${JSON.stringify({ type: "annotation.updated", annotationId: updated.id, at: updated.updatedAt })}\n`
  );
  return updated;
}

export async function deleteAnnotation(projectPath: string, annotationId: string): Promise<void> {
  const current = (await listAnnotations(projectPath)).find((annotation) => annotation.id === annotationId);
  if (!current) {
    throw new Error("annotation not found");
  }

  await appendManagedFile(
    join(annotationRoot(projectPath), "events.jsonl"),
    `${JSON.stringify({ type: "annotation.deleted", annotationId, at: new Date().toISOString() })}\n`
  );
}

function markdownList(items: string[], emptyText: string): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${emptyText}`];
}

function evidenceLines(annotations: Annotation[]): string[] {
  const lines = annotations.flatMap((annotation) => {
    const output: string[] = [];
    if (annotation.anchor.visual.screenshot) {
      output.push(`- Screenshot: ${annotation.anchor.visual.screenshot}`);
    }
    if (annotation.anchor.visual.crop) {
      output.push(`- Crop: ${annotation.anchor.visual.crop}`);
    }
    return output;
  });
  return lines.length > 0 ? lines : ["- No screenshot or crop evidence captured."];
}

function anchorSummaryLines(annotations: Annotation[]): string[] {
  return annotations.flatMap((annotation) => [
    `- ${annotation.id}`,
    `  - Page: ${annotation.page.url}`,
    `  - Selector: ${annotation.anchor.dom?.selector ?? "not captured"}`,
    `  - Text: ${annotation.anchor.dom?.textExcerpt ?? "not captured"}`,
    `  - Box: ${annotation.anchor.visual.boundingBox.width}x${annotation.anchor.visual.boundingBox.height} at ${annotation.anchor.visual.boundingBox.x},${annotation.anchor.visual.boundingBox.y}`
  ]);
}

export async function createTaskFiles(
  projectPath: string,
  input: {
    taskId: string;
    annotations: Annotation[];
    userIntent: string;
    acceptanceCriteria: string[];
    suggestedFiles?: string[];
  }
): Promise<{ jsonPath: string; markdownPath: string; promptPath: string }> {
  await ensureAnnotationDirs(projectPath);
  const taskSlug = safeTaskSlug(input.taskId);
  const taskPackage = createTaskPackage(input);
  const taskRoot = join(annotationRoot(projectPath), "tasks");
  const jsonPath = assertInside(taskRoot, join(taskRoot, `${taskSlug}.json`));
  const markdownPath = assertInside(taskRoot, join(taskRoot, `${taskSlug}.md`));
  const promptPath = assertInside(taskRoot, join(taskRoot, `${taskSlug}.prompt.md`));

  await writeManagedFile(jsonPath, `${JSON.stringify(taskPackage, null, 2)}\n`);
  await writeManagedFile(
    markdownPath,
    [
      `# ${input.taskId}`,
      "",
      "## Intent",
      "",
      input.userIntent,
      "",
      "## Acceptance Criteria",
      "",
      ...input.acceptanceCriteria.map((criterion) => `- ${criterion}`),
      "",
      "## Evidence",
      "",
      ...evidenceLines(input.annotations),
      "",
      "## Target Platforms",
      "",
      ...markdownList(taskPackage.targetPlatforms, "No target platforms captured."),
      "",
      "## Suggested Files",
      "",
      ...markdownList(taskPackage.suggestedFiles, "No suggested files provided."),
      "",
      "## Source Annotations",
      "",
      ...taskPackage.sourceAnnotations.map((id) => `- ${id}`),
      "",
      "## Anchor Summary",
      "",
      ...anchorSummaryLines(input.annotations),
      "",
      "## Suggested Next Steps",
      "",
      "- Read the task JSON for machine-readable fields before editing.",
      "- Use screenshot/crop evidence when available, then confirm against DOM and source anchors.",
      "- Keep implementation changes limited to the annotated behavior.",
      "- Run the smallest relevant verification command before reporting completion.",
      ""
    ].join("\n")
  );

  await writeManagedFile(
    promptPath,
    [
      `Read .ui-annotations/tasks/${taskSlug}.md and .ui-annotations/tasks/${taskSlug}.json.`,
      "",
      "Implement the requested UI change.",
      "Use the task package as the source of truth.",
      "Use evidence paths, visual anchors, DOM anchors, target platforms, and suggested files to understand the requested change.",
      "Keep the change narrowly scoped.",
      "Run the relevant tests, type checks, or build checks for this project.",
      "Do not modify unrelated files.",
      "After implementation, summarize changed files and verification results.",
      ""
    ].join("\n")
  );

  return { jsonPath, markdownPath, promptPath };
}

export async function writeAgentRun(projectPath: string, run: AgentRun): Promise<AgentRun> {
  await ensureAnnotationDirs(projectPath);
  safeTaskSlug(run.taskId);
  if (!/^run_[a-zA-Z0-9_-]{1,120}$/.test(run.runId)) {
    throw new Error("runId must be a filename-safe run id");
  }

  const runsRoot = join(annotationRoot(projectPath), "runs");
  const runPath = assertInside(runsRoot, join(runsRoot, `${run.runId}.json`));
  await writeManagedFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
  await appendManagedFile(
    join(annotationRoot(projectPath), "events.jsonl"),
    `${JSON.stringify({ type: "agent-run.recorded", runId: run.runId, taskId: run.taskId, at: run.finishedAt })}\n`
  );
  return run;
}

export async function readAgentRun(projectPath: string, runId: string): Promise<AgentRun> {
  await ensureAnnotationDirs(projectPath);
  if (!/^run_[a-zA-Z0-9_-]{1,120}$/.test(runId)) {
    throw new Error("runId must be a filename-safe run id");
  }
  const runsRoot = join(annotationRoot(projectPath), "runs");
  const runPath = assertInside(runsRoot, join(runsRoot, `${runId}.json`));
  return JSON.parse(await readManagedFile(runPath)) as AgentRun;
}

export async function readTaskPrompt(projectPath: string, taskId: string): Promise<{ prompt: string; promptPath: string }> {
  await ensureAnnotationDirs(projectPath);
  const taskSlug = safeTaskSlug(taskId);
  const taskRoot = join(annotationRoot(projectPath), "tasks");
  const promptPath = assertInside(taskRoot, join(taskRoot, `${taskSlug}.prompt.md`));
  return {
    prompt: await readManagedFile(promptPath),
    promptPath: relative(projectPath, promptPath)
  };
}
