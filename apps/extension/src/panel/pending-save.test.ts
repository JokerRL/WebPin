import type { Annotation } from "@ui-annotations/shared";
import { describe, expect, it, vi } from "vitest";
import { savePendingSequentially } from "./pending-save";

function createAnnotation(id: string, note = `Note for ${id}`): Annotation {
  return {
    id,
    projectId: "webpin",
    page: {
      url: "http://localhost:3000/settings",
      route: "/settings",
      title: "Settings",
      viewport: { width: 1440, height: 900, deviceScaleFactor: 1 }
    },
    anchor: {
      visual: {
        boundingBox: { x: 100, y: 200, width: 240, height: 48 }
      }
    },
    note,
    changeType: "layout",
    priority: "medium",
    status: "open",
    targetPlatforms: ["web"],
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z"
  };
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const annotations = [createAnnotation("ann_1"), createAnnotation("ann_2"), createAnnotation("ann_3")];

describe("savePendingSequentially", () => {
  it("saves in order and reports the remaining annotations after each acknowledgement", async () => {
    const saveOrder: string[] = [];
    const snapshots: string[][] = [];

    await savePendingSequentially(
      annotations,
      async (annotation) => {
        saveOrder.push(annotation.id);
      },
      (remaining) => {
        snapshots.push(remaining.map((annotation) => annotation.id));
      }
    );

    expect(saveOrder).toEqual(["ann_1", "ann_2", "ann_3"]);
    expect(snapshots).toEqual([
      ["ann_2", "ann_3"],
      ["ann_3"],
      []
    ]);
  });

  it("rejects the original error and preserves the failed and unattempted remainder", async () => {
    const error = new Error("bridge failed");
    const snapshots: string[][] = [];
    const save = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);

    await expect(
      savePendingSequentially(annotations, save, (remaining) => {
        snapshots.push(remaining.map((annotation) => annotation.id));
      })
    ).rejects.toBe(error);

    expect(save.mock.calls.map(([annotation]) => annotation.id)).toEqual(["ann_1", "ann_2"]);
    expect(snapshots).toEqual([["ann_2", "ann_3"]]);
  });

  it("waits for asynchronous remainder persistence before starting the next save", async () => {
    const persistenceStarted = createDeferred();
    const persistenceGate = createDeferred();
    const saveOrder: string[] = [];
    let callbackCount = 0;

    const operation = savePendingSequentially(
      annotations,
      async (annotation) => {
        saveOrder.push(annotation.id);
      },
      async () => {
        callbackCount += 1;
        if (callbackCount === 1) {
          persistenceStarted.resolve();
          await persistenceGate.promise;
        }
      }
    );

    await persistenceStarted.promise;
    expect(saveOrder).toEqual(["ann_1"]);

    persistenceGate.resolve();
    await operation;
    expect(saveOrder).toEqual(["ann_1", "ann_2", "ann_3"]);
  });

  it("propagates remainder persistence rejection and prevents the next save", async () => {
    const error = new Error("storage failed");
    const save = vi.fn<(annotation: Annotation) => Promise<void>>(async () => undefined);

    await expect(
      savePendingSequentially(annotations, save, async () => {
        throw error;
      })
    ).rejects.toBe(error);

    expect(save.mock.calls.map(([annotation]) => annotation.id)).toEqual(["ann_1"]);
  });

  it("keeps a duplicate id pending until that exact occurrence is acknowledged", async () => {
    const first = createAnnotation("ann_duplicate", "first occurrence");
    const second = createAnnotation("ann_duplicate", "second occurrence");
    const third = createAnnotation("ann_3");
    const error = new Error("second save failed");
    const snapshots: string[][] = [];
    const save = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);

    await expect(
      savePendingSequentially([first, second, third], save, (remaining) => {
        snapshots.push(remaining.map((annotation) => annotation.note));
      })
    ).rejects.toBe(error);

    expect(save.mock.calls.map(([annotation]) => annotation.note)).toEqual(["first occurrence", "second occurrence"]);
    expect(snapshots).toEqual([["second occurrence", "Note for ann_3"]]);
  });

  it("attempts the initial snapshot even when the caller mutates its input during a save", async () => {
    const saveStarted = createDeferred();
    const saveGate = createDeferred();
    const mutableInput = [...annotations];
    const saveOrder: string[] = [];

    const operation = savePendingSequentially(
      mutableInput,
      async (annotation) => {
        saveOrder.push(annotation.id);
        if (annotation.id === "ann_1") {
          saveStarted.resolve();
          await saveGate.promise;
        }
      },
      () => undefined
    );

    await saveStarted.promise;
    mutableInput.splice(1, 2, createAnnotation("ann_external"));
    saveGate.resolve();
    await operation;

    expect(saveOrder).toEqual(["ann_1", "ann_2", "ann_3"]);
  });
});
