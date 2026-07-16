import type { Annotation } from "@ui-annotations/shared";
import { describe, expect, it } from "vitest";
import { createPendingMutationQueue } from "./pending-mutations";

function annotation(id: string, note = id): Annotation {
  return { id, note } as Annotation;
}

describe("createPendingMutationQueue", () => {
  it("serializes concurrent appends against the latest stored array", async () => {
    let stored = [annotation("ann_1")];
    const queue = createPendingMutationQueue({
      get: async () => [...stored],
      set: async (next) => {
        await Promise.resolve();
        stored = [...next];
      }
    });

    const [afterSecond, afterThird] = await Promise.all([
      queue.append(annotation("ann_2")),
      queue.append(annotation("ann_3"))
    ]);

    expect(afterSecond.map(({ id }) => id)).toEqual(["ann_1", "ann_2"]);
    expect(afterThird.map(({ id }) => id)).toEqual(["ann_1", "ann_2", "ann_3"]);
    expect(stored.map(({ id }) => id)).toEqual(["ann_1", "ann_2", "ann_3"]);
  });

  it("removes exactly the first matching occurrence after earlier queued mutations", async () => {
    let stored = [annotation("duplicate", "first"), annotation("duplicate", "second")];
    const queue = createPendingMutationQueue({
      get: async () => [...stored],
      set: async (next) => {
        stored = [...next];
      }
    });

    const append = queue.append(annotation("ann_3"));
    const remove = queue.removeFirst("duplicate");
    await append;
    const latest = await remove;

    expect(latest.map(({ note }) => note)).toEqual(["second", "ann_3"]);
  });

  it("recovers the serialized chain after a rejected storage write", async () => {
    let stored = [annotation("ann_1")];
    let rejectNextSet = true;
    const queue = createPendingMutationQueue({
      get: async () => [...stored],
      set: async (next) => {
        if (rejectNextSet) {
          rejectNextSet = false;
          throw new Error("storage unavailable");
        }
        stored = [...next];
      }
    });

    await expect(queue.append(annotation("ann_failed"))).rejects.toThrow("storage unavailable");
    await expect(queue.append(annotation("ann_2"))).resolves.toEqual([
      annotation("ann_1"),
      annotation("ann_2")
    ]);
  });
});
