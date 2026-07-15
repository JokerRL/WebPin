import type { Annotation, TaskPackage } from "./schemas.js";
import { taskPackageSchema } from "./schemas.js";

export function createTaskPackage(input: {
  taskId: string;
  annotations: Annotation[];
  userIntent: string;
  acceptanceCriteria: string[];
  suggestedFiles?: string[];
}): TaskPackage {
  const screenshots = input.annotations.flatMap((annotation) =>
    annotation.anchor.visual.screenshot ? [annotation.anchor.visual.screenshot] : []
  );
  const crops = input.annotations.flatMap((annotation) =>
    annotation.anchor.visual.crop ? [annotation.anchor.visual.crop] : []
  );
  const targetPlatforms = Array.from(new Set(input.annotations.flatMap((annotation) => annotation.targetPlatforms)));

  return taskPackageSchema.parse({
    taskId: input.taskId,
    sourceAnnotations: input.annotations.map((annotation) => annotation.id),
    userIntent: input.userIntent,
    acceptanceCriteria: input.acceptanceCriteria,
    evidence: {
      screenshots,
      crops,
      domSnapshots: []
    },
    targetPlatforms,
    suggestedFiles: input.suggestedFiles ?? [],
    status: "draft"
  });
}
