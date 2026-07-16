import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createBridgeServer } from "../../bridge/dist/server.js";

const bridgeHost = "127.0.0.1";
const bridgePort = 48731;
const sampleHost = "127.0.0.1";
const samplePort = 49123;
const accessKey = "extension-e2e-key";
const note = "Make the save button taller.";
const taskId = "task-extension-e2e";
const extensionPath = resolve("apps/extension/dist");

function listen(server, port, host) {
  return new Promise((resolveListen, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function close(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

function isBridgeResponse(response, method, pathname, status) {
  const url = new URL(response.url());
  return (
    url.hostname === bridgeHost &&
    Number(url.port) === bridgePort &&
    url.pathname === pathname &&
    response.request().method() === method &&
    response.status() === status
  );
}

async function readAnnotationHistory(projectPath) {
  const contents = await readFile(join(projectPath, ".ui-annotations", "annotations.jsonl"), "utf8");
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function run() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "webpin-extension-e2e-"));
  const projectDirectory = join(temporaryRoot, "project");
  const profileDirectory = join(temporaryRoot, "chromium-profile");
  await Promise.all([mkdir(projectDirectory), mkdir(profileDirectory)]);
  const projectPath = await realpath(projectDirectory);
  const profilePath = await realpath(profileDirectory);

  const bridgeServer = createBridgeServer({
    accessKey,
    projectName: "extension-e2e-project",
    projectPath,
    allowedOrigins: ["chrome-extension://*"]
  });
  const bridgeRequests = [];
  bridgeServer.on("request", (request, response) => {
    response.on("finish", () => {
      bridgeRequests.push({ method: request.method, url: request.url, status: response.statusCode });
    });
  });

  const sampleServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>Extension E2E sample</title></head><body>
      <button data-testid="save-button" style="margin:80px;width:180px;height:44px">Save changes</button>
    </body></html>`);
  });

  let context;
  const browserDiagnostics = [];
  try {
    await Promise.all([
      listen(bridgeServer, bridgePort, bridgeHost),
      listen(sampleServer, samplePort, sampleHost)
    ]);

    context = await chromium.launchPersistentContext(profilePath, {
      channel: "chromium",
      headless: true,
      locale: "en-US",
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    const wirePageDiagnostics = (page) => {
      page.on("console", (message) => {
        if (message.type() === "error") browserDiagnostics.push(`console ${page.url()}: ${message.text()}`);
      });
      page.on("pageerror", (error) => browserDiagnostics.push(`pageerror ${page.url()}: ${error.stack ?? error.message}`));
    };
    context.pages().forEach(wirePageDiagnostics);
    context.on("page", wirePageDiagnostics);

    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    serviceWorker.on("console", (message) => {
      if (message.type() === "error") browserDiagnostics.push(`service worker console: ${message.text()}`);
    });
    const extensionId = new URL(serviceWorker.url()).hostname;
    assert.match(extensionId, /^[a-p]{32}$/, "A real MV3 extension ID should be discovered from its service worker.");

    console.log(`Playwright ${chromium.executablePath()}`);
    console.log(`Chromium ${context.browser()?.version() ?? "persistent context"}; extension ${extensionId}`);

    const panelPage = await context.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/panel.html`, { waitUntil: "networkidle" });
    await panelPage.evaluate(async () => chrome.storage.local.clear());
    await panelPage.reload({ waitUntil: "networkidle" });

    await panelPage.getByLabel(/Access key|访问密钥/).fill(accessKey);
    const sessionResponse = panelPage.waitForResponse((response) =>
      isBridgeResponse(response, "GET", "/session", 200)
    );
    await panelPage.getByRole("button", { name: /^(Connect|连接)$/ }).click();
    await sessionResponse;
    await panelPage.getByRole("status").filter({ hasText: /Bridge: Ready|桥接服务：已就绪/ }).waitFor();

    const samplePage = await context.newPage();
    await samplePage.goto(`http://${sampleHost}:${samplePort}/`, { waitUntil: "networkidle" });
    await samplePage.evaluate(() => {
      window.postMessage({ type: "ui-annotations.startSelecting", commandId: "extension-e2e-select" }, "*");
    });
    await samplePage.getByText("Annotation mode on", { exact: true }).waitFor();

    const saveButton = samplePage.getByTestId("save-button");
    const box = await saveButton.boundingBox();
    assert.ok(box, "The sample Save button should have a visible bounding box.");
    await samplePage.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const inlineEditor = samplePage.locator("[data-ui-annotations-root='true']");
    await inlineEditor.locator("textarea[name='note']").fill(note);
    await inlineEditor.getByRole("button", { name: "Save", exact: true }).click();
    await inlineEditor.getByText(/Added ann_.+ to pending list/).waitFor();

    await panelPage.bringToFront();
    await panelPage.getByText(note, { exact: true }).waitFor();
    const annotationPost = panelPage.waitForResponse((response) =>
      isBridgeResponse(response, "POST", "/annotations", 201)
    );
    await panelPage.getByRole("button", { name: /Save all to files|全部保存到文件/ }).click();
    await annotationPost;

    const annotationsGet = panelPage.waitForResponse((response) =>
      isBridgeResponse(response, "GET", "/annotations", 200)
    );
    await panelPage.getByRole("button", { name: /^(Refresh|刷新)$/ }).click();
    const getResponse = await annotationsGet;
    assert.equal(new URL(getResponse.url()).search, "", "GET /annotations must not send the removed projectPath query parameter.");
    const refreshedAnnotations = (await getResponse.json()).annotations;
    assert.ok(
      refreshedAnnotations.some((annotation) => annotation.note === note),
      "The authenticated GET /annotations response should return the saved note."
    );
    await panelPage.getByText(note, { exact: true }).waitFor();

    let annotationHistory = await readAnnotationHistory(projectPath);
    const createdAnnotation = annotationHistory.find((annotation) => annotation.note === note);
    assert.ok(createdAnnotation, "annotations.jsonl should contain the note saved through the packaged extension.");
    const annotationId = createdAnnotation.id;

    const statusSelect = panelPage.getByRole("combobox", {
      name: new RegExp(`(?:Filter by status|按状态筛选) ${annotationId}$`)
    });
    const annotationPatch = panelPage.waitForResponse((response) =>
      isBridgeResponse(response, "PATCH", `/annotations/${annotationId}`, 200)
    );
    await statusSelect.selectOption("drafted");
    await annotationPatch;

    const draftedRefresh = panelPage.waitForResponse((response) =>
      isBridgeResponse(response, "GET", "/annotations", 200)
    );
    await panelPage.getByRole("button", { name: /^(Refresh|刷新)$/ }).click();
    const draftedResponse = await draftedRefresh;
    const draftedAnnotations = (await draftedResponse.json()).annotations;
    assert.equal(
      draftedAnnotations.find((annotation) => annotation.id === annotationId)?.status,
      "drafted",
      "The refreshed GET response should persist drafted status."
    );
    await statusSelect.waitFor();
    assert.equal(await statusSelect.inputValue(), "drafted", "Drafted status should survive a fresh GET /annotations.");
    annotationHistory = await readAnnotationHistory(projectPath);
    assert.equal(
      annotationHistory.filter((annotation) => annotation.id === annotationId).at(-1)?.status,
      "drafted",
      "The append-only annotation history should persist drafted status."
    );

    const annotationIdText = panelPage.getByText(annotationId, { exact: true });
    const annotationCard = annotationIdText.locator("xpath=../../..");
    await annotationCard.getByRole("checkbox").check();
    await panelPage.getByRole("button", { name: /Draft from selection|根据所选生成草稿/ }).click();
    await panelPage.getByLabel(/Task ID|任务 ID/).fill(taskId);
    await panelPage.getByLabel(/User intent|用户意图/).fill("Make the sample Save button taller.");
    await panelPage.getByLabel(/Acceptance criteria|验收标准/).fill("The Save button is taller without changing its label.");
    const taskPost = panelPage.waitForResponse((response) => isBridgeResponse(response, "POST", "/tasks", 201));
    await panelPage.getByRole("button", { name: /Generate task files|生成任务文件/ }).click();
    await taskPost;

    const taskFiles = await readdir(join(projectPath, ".ui-annotations", "tasks"));
    assert.deepEqual(
      [...taskFiles].sort(),
      [`${taskId}.json`, `${taskId}.md`, `${taskId}.prompt.md`].sort(),
      "Task generation should emit JSON, Markdown, and Codex prompt files."
    );

    const annotationDelete = panelPage.waitForResponse((response) =>
      isBridgeResponse(response, "DELETE", `/annotations/${annotationId}`, 200)
    );
    await annotationCard.getByRole("button", { name: /^(Delete|删除)$/ }).click();
    await annotationDelete;
    const deletedRefresh = panelPage.waitForResponse((response) =>
      isBridgeResponse(response, "GET", "/annotations", 200)
    );
    await panelPage.getByRole("button", { name: /^(Refresh|刷新)$/ }).click();
    const deletedResponse = await deletedRefresh;
    const activeAfterDelete = (await deletedResponse.json()).annotations;
    assert.ok(
      activeAfterDelete.every((annotation) => annotation.id !== annotationId),
      "The refreshed GET response should omit the deleted annotation."
    );
    assert.equal(await panelPage.getByText(note, { exact: true }).count(), 0, "Deleted annotation should remain absent after refresh.");

    for (const expected of [
      ["POST", "/annotations", 201],
      ["GET", "/annotations", 200],
      ["PATCH", `/annotations/${annotationId}`, 200],
      ["POST", "/tasks", 201],
      ["DELETE", `/annotations/${annotationId}`, 200]
    ]) {
      assert.ok(
        bridgeRequests.some((request) => request.method === expected[0] && request.url === expected[1] && request.status === expected[2]),
        `Bridge should observe ${expected.join(" ")}.`
      );
    }

    console.log(`PASS packaged MV3 workflow: annotation ${annotationId}, task ${taskId}, GET/auth regression covered.`);
    if (browserDiagnostics.length > 0) console.warn(browserDiagnostics.join("\n"));
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (browserDiagnostics.length > 0) {
      failure.message += `\nBrowser diagnostics:\n${browserDiagnostics.join("\n")}`;
    }
    throw failure;
  } finally {
    await context?.close().catch(() => {});
    await Promise.allSettled([close(bridgeServer), close(sampleServer)]);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await run();
