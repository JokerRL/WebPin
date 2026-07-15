import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  it("injects the content script into file prototypes", async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "public", "manifest.json"), "utf8")) as {
      content_scripts?: Array<{ all_frames?: boolean; match_about_blank?: boolean; matches?: string[] }>;
      commands?: Record<string, { suggested_key?: { default?: string; mac?: string } }>;
    };

    expect(manifest.content_scripts?.[0]?.matches).toContain("file:///*");
    expect(manifest.content_scripts?.[0]?.all_frames).toBe(true);
    expect(manifest.content_scripts?.[0]?.match_about_blank).toBe(true);
    expect(manifest.commands?.["toggle-select-mode"]?.suggested_key?.default).toBe("Ctrl+Shift+Y");
    expect(manifest.commands?.["toggle-select-mode"]?.suggested_key?.mac).toBe("MacCtrl+Shift+Y");
  });
});
