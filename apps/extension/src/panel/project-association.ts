import type { Annotation } from "@ui-annotations/shared";
export function findProjectMismatch(
  annotations: readonly Annotation[],
  projectId: string
): Annotation | null {
  return annotations.find((annotation) => annotation.projectId !== projectId) ?? null;
}
