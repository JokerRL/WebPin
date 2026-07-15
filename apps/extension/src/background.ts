import type { Annotation } from "@ui-annotations/shared";
import type { SelectedElement } from "./content";
import { mergeVisualAssetPaths, type VisualAssetPaths } from "./panel/model";
import { inferProjectPathFromPageUrl } from "./project-path";

const projectPathKey = "ui-annotations.projectPath";
const pendingAnnotationsKey = "ui-annotations.pendingAnnotations";
const modeKey = "ui-annotations.mode";
const screenshotCaptureEnabledKey = "ui-annotations.screenshotCaptureEnabled";
const bridgeUrl = "http://127.0.0.1:48731";

function newCommandId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `cmd_${globalThis.crypto.randomUUID()}`;
  }

  return `cmd_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function newAnnotationId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `ann_${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }

  return `ann_${Date.now()}`;
}

function projectIdFromPath(projectPath: string): string {
  const normalized = projectPath.replace(/\/+$/, "");
  const name = normalized.split("/").filter(Boolean).at(-1) ?? "project";
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "project";
}

function createAnnotation(input: {
  projectPath: string;
  selection: SelectedElement;
  note: string;
  changeType: Annotation["changeType"];
  priority: Annotation["priority"];
  targetPlatforms: Annotation["targetPlatforms"];
}): Annotation {
  const now = new Date().toISOString();
  return {
    id: newAnnotationId(),
    projectId: projectIdFromPath(input.projectPath),
    page: {
      url: input.selection.url,
      ...(input.selection.route ? { route: input.selection.route } : {}),
      ...(input.selection.title ? { title: input.selection.title } : {}),
      viewport: input.selection.viewport
    },
    anchor: {
      dom: {
        selector: input.selection.selector,
        xpath: input.selection.xpath,
        textExcerpt: input.selection.textExcerpt,
        boundingBox: input.selection.boundingBox
      },
      visual: {
        boundingBox: input.selection.boundingBox
      }
    },
    note: input.note,
    changeType: input.changeType,
    priority: input.priority,
    status: "open",
    targetPlatforms: input.targetPlatforms,
    createdAt: now,
    updatedAt: now
  };
}

async function cropDataUrl(
  dataUrl: string,
  boundingBox: SelectedElement["boundingBox"],
  deviceScaleFactor: number
): Promise<string> {
  const image = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = deviceScaleFactor || 1;
  const sx = Math.max(0, Math.round(boundingBox.x * scale));
  const sy = Math.max(0, Math.round(boundingBox.y * scale));
  const sw = Math.max(1, Math.min(Math.round(boundingBox.width * scale), image.width - sx));
  const sh = Math.max(1, Math.min(Math.round(boundingBox.height * scale), image.height - sy));
  const canvas = new OffscreenCanvas(sw, sh);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create crop canvas.");
  }
  context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

async function uploadAsset(input: {
  projectPath: string;
  annotationId: string;
  kind: "screenshot" | "crop";
  dataUrl: string;
}): Promise<string> {
  const response = await fetch(`${bridgeUrl}/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  const body = (await response.json()) as { path?: string; message?: string; error?: string };
  if (!response.ok || !body.path) {
    throw new Error(body.message ?? body.error ?? `Could not write ${input.kind} asset.`);
  }
  return body.path;
}

async function captureVisualAssets(input: {
  projectPath: string;
  annotationId: string;
  selection: SelectedElement;
}): Promise<VisualAssetPaths> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = tab?.windowId;
  if (windowId === undefined) {
    throw new Error("No active tab for screenshot capture.");
  }

  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const crop = await cropDataUrl(screenshotDataUrl, input.selection.boundingBox, input.selection.viewport.deviceScaleFactor);
  const screenshot = await uploadAsset({
    projectPath: input.projectPath,
    annotationId: input.annotationId,
    kind: "screenshot",
    dataUrl: screenshotDataUrl
  });
  const cropPath = await uploadAsset({
    projectPath: input.projectPath,
    annotationId: input.annotationId,
    kind: "crop",
    dataUrl: crop
  });
  return { screenshot, crop: cropPath };
}

async function sendModeMessageToActiveTab(type: "ui-annotations.startSelecting" | "ui-annotations.toggleSelecting"): Promise<{ ok: boolean; error?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { ok: false, error: "No active tab." };
  }

  const message = { type, commandId: newCommandId() };
  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    args: [message],
    func: (modeMessage) => {
      window.postMessage(modeMessage, "*");
    }
  });
  return { ok: true };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-select-mode") {
    sendModeMessageToActiveTab("ui-annotations.toggleSelecting").catch(() => {
      // The side panel will surface errors for button-triggered selection.
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ui-annotations.startSelecting") {
    sendModeMessageToActiveTab("ui-annotations.startSelecting")
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "ui-annotations.toggleSelecting") {
    sendModeMessageToActiveTab("ui-annotations.toggleSelecting")
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "ui-annotations.elementSelected") {
    chrome.storage.local.set({ "ui-annotations.lastSelection": message.selection }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "ui-annotations.modeChanged") {
    chrome.storage.local.set({ [modeKey]: message.mode }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "ui-annotations.getLastSelection") {
    chrome.storage.local.get("ui-annotations.lastSelection").then((result) => {
      sendResponse({ selection: result["ui-annotations.lastSelection"] ?? null });
    });
    return true;
  }

  if (message?.type === "ui-annotations.health") {
    fetch(`${bridgeUrl}/health`)
      .then((response) => response.json())
      .then((body) => sendResponse({ ok: true, bridge: body }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "ui-annotations.captureVisualAssets") {
    captureVisualAssets({
      projectPath: String(message.projectPath ?? ""),
      annotationId: String(message.annotationId ?? ""),
      selection: message.selection as SelectedElement
    })
      .then((paths) => sendResponse({ ok: true, paths }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "ui-annotations.saveInlineAnnotation") {
    chrome.storage.local
      .get(projectPathKey)
      .then(async (result) => {
        const selection = message.selection as SelectedElement;
        const projectPath =
          String(result[projectPathKey] ?? "").trim() || inferProjectPathFromPageUrl(selection.url) || "";
        if (!projectPath) {
          sendResponse({ ok: false, error: "Set Project path in the side panel before saving hosted pages." });
          return;
        }

        const note = String(message.note ?? "").trim();
        if (!note) {
          sendResponse({ ok: false, error: "Write a note before saving." });
          return;
        }

        let annotation = createAnnotation({
          projectPath,
          selection,
          note,
          changeType: message.changeType as Annotation["changeType"],
          priority: message.priority as Annotation["priority"],
          targetPlatforms: message.targetPlatforms as Annotation["targetPlatforms"]
        });

        const settingsResult = await chrome.storage.local.get(screenshotCaptureEnabledKey);
        if (settingsResult[screenshotCaptureEnabledKey] === true) {
          const paths = await captureVisualAssets({ projectPath, annotationId: annotation.id, selection });
          annotation = mergeVisualAssetPaths(annotation, paths);
        }

        const pendingResult = await chrome.storage.local.get(pendingAnnotationsKey);
        const pendingAnnotations = (pendingResult[pendingAnnotationsKey] as Annotation[] | undefined) ?? [];
        await chrome.storage.local.set({ [projectPathKey]: projectPath, [pendingAnnotationsKey]: [...pendingAnnotations, annotation] });
        sendResponse({ ok: true, annotationId: annotation.id });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});
