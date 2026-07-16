import type { Annotation } from "@ui-annotations/shared";

export async function savePendingSequentially(
  annotations: readonly Annotation[],
  save: (annotation: Annotation) => Promise<void>,
  onAcknowledged: (annotation: Annotation) => void | Promise<void>
): Promise<void> {
  const snapshot = [...annotations];

  for (const annotation of snapshot) {
    await save(annotation);
    await onAcknowledged(annotation);
  }
}
