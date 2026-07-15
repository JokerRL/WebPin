/// <reference types="node" />

import { copyFile, rm } from "node:fs/promises";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function chromePanelHtml(): Plugin {
  return {
    name: "chrome-panel-html",
    async closeBundle() {
      await copyFile(
        new URL("./dist/src/panel/index.html", import.meta.url),
        new URL("./dist/panel.html", import.meta.url)
      );
      await rm(new URL("./dist/src", import.meta.url), { force: true, recursive: true });
    }
  };
}

export default defineConfig({
  plugins: [react(), chromePanelHtml()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: "src/panel/index.html",
        background: "src/background.ts",
        content: "src/content.ts"
      },
      output: {
        entryFileNames: "[name].js"
      }
    }
  }
});
