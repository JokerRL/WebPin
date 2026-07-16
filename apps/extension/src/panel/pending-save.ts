import type { Annotation } from "@ui-annotations/shared";

export async function savePendingSequentially(
  annotations: Annotation[],
  save: (annotation: Annotation) => Promise<void>,
  onRemainingChanged: (remaining: Annotation[]) => void
): Promise<void> {
  let remaining = [...annotations];

  for (const annotation of annotations) {
    await save(annotation);
    remaining = remaining.filter((candidate) => candidate.id !== annotation.id);
    onRemainingChanged(remaining);
  }
}
