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

function removeFirstOccurrenceById(latest: readonly Annotation[], annotationId: string): Annotation[] {
  const index = latest.findIndex((annotation) => annotation.id === annotationId);
  if (index === -1) return [...latest];
  return [...latest.slice(0, index), ...latest.slice(index + 1)];
}

describe("savePendingSequentially", () => {
  it("saves and acknowledges each annotation in order", async () => {
    const events: string[] = [];

    await savePendingSequentially(
      annotations,
      async (annotation) => {
        events.push(`save:${annotation.id}`);
      },
      (acknowledged) => {
        events.push(`acknowledge:${acknowledged.id}`);
      }
    );

    expect(events).toEqual([
      "save:ann_1",
      "acknowledge:ann_1",
      "save:ann_2",
      "acknowledge:ann_2",
      "save:ann_3",
      "acknowledge:ann_3"
    ]);
  });

  it("acknowledges only successful saves before a partial failure", async () => {
    const error = new Error("bridge failed");
    const acknowledgements: string[] = [];
    const save = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);

    await expect(
      savePendingSequentially(annotations, save, (acknowledged) => {
        acknowledgements.push(acknowledged.id);
      })
    ).rejects.toBe(error);

    expect(save.mock.calls.map(([annotation]) => annotation.id)).toEqual(["ann_1", "ann_2"]);
    expect(acknowledgements).toEqual(["ann_1"]);
  });

  it("waits for asynchronous acknowledgement before starting the next save", async () => {
    const acknowledgementStarted = createDeferred();
    const acknowledgementGate = createDeferred();
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
          acknowledgementStarted.resolve();
          await acknowledgementGate.promise;
        }
      }
    );

    await acknowledgementStarted.promise;
    expect(saveOrder).toEqual(["ann_1"]);

    acknowledgementGate.resolve();
    await operation;
    expect(saveOrder).toEqual(["ann_1", "ann_2", "ann_3"]);
  });

  it("propagates acknowledgement rejection and prevents the next save", async () => {
    const error = new Error("acknowledgement failed");
    const save = vi.fn<(annotation: Annotation) => Promise<void>>(async () => undefined);

    await expect(
      savePendingSequentially(annotations, save, async () => {
        throw error;
      })
    ).rejects.toBe(error);

    expect(save.mock.calls.map(([annotation]) => annotation.id)).toEqual(["ann_1"]);
  });

  it("emits one acknowledgement for each saved duplicate-id occurrence", async () => {
    const first = createAnnotation("ann_duplicate", "first occurrence");
    const second = createAnnotation("ann_duplicate", "second occurrence");
    const third = createAnnotation("ann_3");
    const acknowledgements: string[] = [];

    await savePendingSequentially(
      [first, second, third],
      async () => undefined,
      (acknowledged) => {
        acknowledgements.push(acknowledged.note);
      }
    );

    expect(acknowledgements).toEqual(["first occurrence", "second occurrence", "Note for ann_3"]);
  });

  it("uses the initial batch snapshot when the caller adds an annotation during a save", async () => {
    const saveStarted = createDeferred();
    const saveGate = createDeferred();
    const mutableInput = [...annotations];
    const saveOrder: string[] = [];
    const acknowledgements: string[] = [];

    const operation = savePendingSequentially(
      mutableInput,
      async (annotation) => {
        saveOrder.push(annotation.id);
        if (annotation.id === "ann_1") {
          saveStarted.resolve();
          await saveGate.promise;
        }
      },
      (acknowledged) => {
        acknowledgements.push(acknowledged.id);
      }
    );

    await saveStarted.promise;
    mutableInput.push(createAnnotation("ann_external"));
    saveGate.resolve();
    await operation;

    expect(saveOrder).toEqual(["ann_1", "ann_2", "ann_3"]);
    expect(acknowledgements).toEqual(["ann_1", "ann_2", "ann_3"]);
  });

  it("lets the consumer remove acknowledgements from current state without losing concurrent additions", async () => {
    const firstSaveStarted = createDeferred();
    const firstSaveGate = createDeferred();
    const batch = [createAnnotation("ann_1"), createAnnotation("ann_2")];
    const concurrent = createAnnotation("ann_3");
    let latest = [...batch];

    const operation = savePendingSequentially(
      batch,
      async (annotation) => {
        if (annotation.id === "ann_1") {
          firstSaveStarted.resolve();
          await firstSaveGate.promise;
        }
      },
      (acknowledged) => {
        latest = removeFirstOccurrenceById(latest, acknowledged.id);
      }
    );

    await firstSaveStarted.promise;
    latest = [...latest, concurrent];
    firstSaveGate.resolve();
    await operation;

    expect(latest.map((annotation) => annotation.id)).toEqual(["ann_3"]);
  });
});
