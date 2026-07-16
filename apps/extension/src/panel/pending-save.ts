import type { Annotation } from "@ui-annotations/shared";

export async function savePendingSequentially(
  annotations: readonly Annotation[],
  save: (annotation: Annotation) => Promise<void>,
  onRemainingChanged: (remaining: readonly Annotation[]) => void | Promise<void>
): Promise<void> {
  const snapshot = [...annotations];

  for (const [index, annotation] of snapshot.entries()) {
    await save(annotation);
    await onRemainingChanged(snapshot.slice(index + 1));
  }
}
