import type { Annotation } from "@ui-annotations/shared";

export type PendingStorageAdapter = {
  get: () => Promise<Annotation[]>;
  set: (annotations: Annotation[]) => Promise<void>;
};

export function createPendingMutationQueue(storage: PendingStorageAdapter) {
  let chain = Promise.resolve();

  function mutate(transform: (latest: Annotation[]) => Annotation[]): Promise<Annotation[]> {
    const operation = chain.then(async () => {
      const latest = await storage.get();
      const updated = transform(latest);
      await storage.set(updated);
      return updated;
    });
    chain = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return {
    append: (annotation: Annotation) => mutate((latest) => [...latest, annotation]),
    removeFirst: (annotationId: string) => mutate((latest) => {
      const index = latest.findIndex((annotation) => annotation.id === annotationId);
      return index < 0 ? latest : [...latest.slice(0, index), ...latest.slice(index + 1)];
    })
  };
}
