import type { Annotation } from "@ui-annotations/shared";
import { projectIdFromName } from "../annotation-factory";

export function findProjectMismatch(
  annotations: readonly Annotation[],
  projectName: string
): Annotation | null {
  const projectId = projectIdFromName(projectName);
  return annotations.find((annotation) => annotation.projectId !== projectId) ?? null;
}
