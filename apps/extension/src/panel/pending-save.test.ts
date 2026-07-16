import type { Annotation } from "@ui-annotations/shared";
import { describe, expect, it, vi } from "vitest";
import { savePendingSequentially } from "./pending-save";

const annotations = [{ id: "ann_1" }, { id: "ann_2" }, { id: "ann_3" }] as Annotation[];

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
});
