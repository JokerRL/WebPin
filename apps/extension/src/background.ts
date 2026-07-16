import type { Annotation } from "@ui-annotations/shared";
import type { SelectedElement } from "./content";
import { createAnnotationFromSelection } from "./annotation-factory";
import { BridgeClientError, createBridgeClient } from "./bridge-client";
import { clearCredentialsIfCurrent } from "./credential-cleanup";
import { createPendingMutationQueue } from "./pending-mutations";
import { mergeVisualAssetPaths, type VisualAssetPaths } from "./panel/model";
import {
  accessKeyStorageKey,
  projectNameStorageKey
} from "./panel/connection";

const pendingAnnotationsKey = "ui-annotations.pendingAnnotations";
const modeKey = "ui-annotations.mode";
const screenshotCaptureEnabledKey = "ui-annotations.screenshotCaptureEnabled";

const pendingMutations = createPendingMutationQueue({
  get: async () => {
    const result = await chrome.storage.local.get(pendingAnnotationsKey);
    return (result[pendingAnnotationsKey] as Annotation[] | undefined) ?? [];
  },
  set: async (annotations) => {
    await chrome.storage.local.set({ [pendingAnnotationsKey]: annotations });
  }
});

async function sendFailure(
  sendResponse: (response: unknown) => void,
  error: unknown,
  rejectedAccessKey = ""
): Promise<void> {
  try {
    if (error instanceof BridgeClientError && error.kind === "auth") {
      await clearCredentialsIfCurrent(chrome.storage.local, rejectedAccessKey);
    }
  } catch {
    // The original bridge failure is returned from finally even if cleanup fails.
  } finally {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof BridgeClientError ? { kind: error.kind } : {})
    });
  }
}

function newCommandId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `cmd_${globalThis.crypto.randomUUID()}`;
  }

  return `cmd_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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
  accessKey: string;
  annotationId: string;
  kind: "screenshot" | "crop";
  dataUrl: string;
}): Promise<string> {
  const { path } = await createBridgeClient({ accessKey: input.accessKey }).writeAsset({
    annotationId: input.annotationId,
    kind: input.kind,
    dataUrl: input.dataUrl
  });
  return path;
}

async function captureVisualAssets(input: {
  accessKey: string;
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
    accessKey: input.accessKey,
    annotationId: input.annotationId,
    kind: "screenshot",
    dataUrl: screenshotDataUrl
  });
  const cropPath = await uploadAsset({
    accessKey: input.accessKey,
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
    createBridgeClient({ accessKey: "" })
      .getHealth()
      .then((body) => sendResponse({ ok: true, bridge: body }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "ui-annotations.captureVisualAssets") {
    let requestAccessKey = "";
    chrome.storage.local.get(accessKeyStorageKey).then((result) => {
      const accessKey = String(result[accessKeyStorageKey] ?? "").trim();
      requestAccessKey = accessKey;
      if (!accessKey) {
        throw new Error("Connect the bridge in the side panel before capturing screenshots.");
      }
      return captureVisualAssets({
        accessKey,
        annotationId: String(message.annotationId ?? ""),
        selection: message.selection as SelectedElement
      });
    })
      .then((paths) => sendResponse({ ok: true, paths }))
      .catch((error) => sendFailure(sendResponse, error, requestAccessKey));
    return true;
  }

  if (message?.type === "ui-annotations.getPendingAnnotations") {
    chrome.storage.local.get(pendingAnnotationsKey)
      .then((result) => sendResponse({
        ok: true,
        pendingAnnotations: (result[pendingAnnotationsKey] as Annotation[] | undefined) ?? []
      }))
      .catch((error) => sendFailure(sendResponse, error));
    return true;
  }

  if (message?.type === "ui-annotations.appendPendingAnnotation") {
    pendingMutations.append(message.annotation as Annotation)
      .then((pendingAnnotations) => sendResponse({ ok: true, pendingAnnotations }))
      .catch((error) => sendFailure(sendResponse, error));
    return true;
  }

  if (
    message?.type === "ui-annotations.acknowledgePendingAnnotation" ||
    message?.type === "ui-annotations.removePendingAnnotation"
  ) {
    pendingMutations.removeFirst(String(message.annotationId ?? ""))
      .then((pendingAnnotations) => sendResponse({ ok: true, pendingAnnotations }))
      .catch((error) => sendFailure(sendResponse, error));
    return true;
  }

  if (message?.type === "ui-annotations.saveInlineAnnotation") {
    let requestAccessKey = "";
    chrome.storage.local
      .get([accessKeyStorageKey, projectNameStorageKey])
      .then(async (result) => {
        const selection = message.selection as SelectedElement;
        const accessKey = String(result[accessKeyStorageKey] ?? "").trim();
        requestAccessKey = accessKey;
        const projectName = String(result[projectNameStorageKey] ?? "").trim();
        if (!accessKey || !projectName) {
          sendResponse({ ok: false, error: "Connect the bridge in the side panel before saving." });
          return;
        }

        const note = String(message.note ?? "").trim();
        if (!note) {
          sendResponse({ ok: false, error: "Write a note before saving." });
          return;
        }

        let annotation = createAnnotationFromSelection({
          projectName,
          selection,
          note,
          changeType: message.changeType as Annotation["changeType"],
          priority: message.priority as Annotation["priority"],
          targetPlatforms: message.targetPlatforms as Annotation["targetPlatforms"]
        });

        const settingsResult = await chrome.storage.local.get(screenshotCaptureEnabledKey);
        if (settingsResult[screenshotCaptureEnabledKey] === true) {
          const paths = await captureVisualAssets({ accessKey, annotationId: annotation.id, selection });
          annotation = mergeVisualAssetPaths(annotation, paths);
        }

        await pendingMutations.append(annotation);
        sendResponse({ ok: true, annotationId: annotation.id });
      })
      .catch((error) => sendFailure(sendResponse, error, requestAccessKey));
    return true;
  }

  return false;
});
