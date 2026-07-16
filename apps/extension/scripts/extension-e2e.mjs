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
const accessKey = "extension-e2e-key";
const projectId = "project_extension_e2e";
const note = "Make the save button taller.";
const taskId = "task-extension-e2e";
const userIntent = note;
const acceptanceCriterion = "The Save button is taller without changing its label.";
const extensionPath = resolve("apps/extension/dist");

function listenError(error, label, host, port) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const reason = error instanceof Error ? error.message : String(error);
  const guidance =
    code === "EADDRINUSE"
      ? ` Another process is already using ${host}:${port}; stop it before running the extension E2E test.`
      : code === "EPERM"
        ? ` Binding ${host}:${port} was denied; check local networking permissions and sandbox policy.`
        : "";
  return new Error(`${label} failed to listen on ${host}:${port}${code ? ` (${code})` : ""}: ${reason}.${guidance}`, {
    cause: error instanceof Error ? error : undefined
  });
}

function listen(server, port, host, label) {
  return new Promise((resolveListen, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(listenError(error, label, host, port));
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen(server.address());
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
  let temporaryRoot;
  let bridgeServer;
  let sampleServer;
  let context;
  const bridgeRequests = [];
  const browserDiagnostics = [];
  try {
    temporaryRoot = await mkdtemp(join(tmpdir(), "webpin-extension-e2e-"));
    const projectDirectory = join(temporaryRoot, "project");
    const profileDirectory = join(temporaryRoot, "chromium-profile");
    await Promise.all([mkdir(projectDirectory), mkdir(profileDirectory)]);
    const projectPath = await realpath(projectDirectory);
    const profilePath = await realpath(profileDirectory);

    bridgeServer = createBridgeServer({
      accessKey,
      projectName: "extension-e2e-project",
      projectId,
      projectPath,
      allowedOrigins: ["chrome-extension://*"]
    });
    bridgeServer.on("request", (request, response) => {
      response.on("finish", () => {
        bridgeRequests.push({ method: request.method, url: request.url, status: response.statusCode });
      });
    });

    sampleServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>Extension E2E sample</title></head><body>
        <button data-testid="save-button" style="margin:80px;width:180px;height:44px">Save changes</button>
      </body></html>`);
    });

    await listen(bridgeServer, bridgePort, bridgeHost, "Local File Bridge");
    const sampleAddress = await listen(sampleServer, 0, sampleHost, "Sample server");
    assert.ok(sampleAddress && typeof sampleAddress === "object", "Sample server should expose its assigned TCP port.");
    const sampleUrl = `http://${sampleHost}:${sampleAddress.port}/`;

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
    const verifiedSessionResponse = await sessionResponse;
    assert.deepEqual(await verifiedSessionResponse.json(), {
      ready: true,
      projectName: "extension-e2e-project",
      projectId
    });
    await panelPage.getByRole("status").filter({ hasText: /Bridge: Ready|桥接服务：已就绪/ }).waitFor();

    const samplePage = await context.newPage();
    await samplePage.goto(sampleUrl, { waitUntil: "networkidle" });
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
    assert.equal(createdAnnotation.projectId, projectId, "The annotation should use the bridge-owned project identity.");
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

    await panelPage.getByRole("checkbox", { name: new RegExp(annotationId) }).check();
    await panelPage.getByRole("button", { name: /Draft from selection|根据所选生成草稿/ }).click();
    await panelPage.getByLabel(/Task ID|任务 ID/).fill(taskId);
    await panelPage.getByLabel(/User intent|用户意图/).fill(userIntent);
    await panelPage.getByLabel(/Acceptance criteria|验收标准/).fill(acceptanceCriterion);
    const taskPost = panelPage.waitForResponse((response) => isBridgeResponse(response, "POST", "/tasks", 201));
    await panelPage.getByRole("button", { name: /Generate task files|生成任务文件/ }).click();
    const taskResponse = await taskPost;
    assert.equal(
      taskResponse.request().postDataJSON().annotations[0].projectId,
      projectId,
      "The task source annotation should retain the bridge-owned project identity."
    );

    const taskFiles = await readdir(join(projectPath, ".ui-annotations", "tasks"));
    assert.deepEqual(
      [...taskFiles].sort(),
      [`${taskId}.json`, `${taskId}.md`, `${taskId}.prompt.md`].sort(),
      "Task generation should emit JSON, Markdown, and Codex prompt files."
    );

    const taskRoot = join(projectPath, ".ui-annotations", "tasks");
    const [taskJsonContents, taskMarkdown, taskPrompt] = await Promise.all([
      readFile(join(taskRoot, `${taskId}.json`), "utf8"),
      readFile(join(taskRoot, `${taskId}.md`), "utf8"),
      readFile(join(taskRoot, `${taskId}.prompt.md`), "utf8")
    ]);
    const taskJson = JSON.parse(taskJsonContents);
    assert.equal(taskJson.taskId, taskId, "Task JSON should preserve the submitted task ID.");
    assert.deepEqual(taskJson.sourceAnnotations, [annotationId], "Task JSON should reference the selected annotation.");
    assert.equal(taskJson.userIntent, userIntent, "Task JSON should preserve the annotation note as user intent.");
    assert.deepEqual(
      taskJson.acceptanceCriteria,
      [acceptanceCriterion],
      "Task JSON should preserve the submitted acceptance criterion."
    );
    for (const expected of [taskId, annotationId, note, acceptanceCriterion]) {
      assert.ok(taskMarkdown.includes(expected), `Task Markdown should include ${JSON.stringify(expected)}.`);
    }
    for (const expectedPath of [
      `.ui-annotations/tasks/${taskId}.md`,
      `.ui-annotations/tasks/${taskId}.json`
    ]) {
      assert.ok(taskPrompt.includes(expectedPath), `Task prompt should reference ${expectedPath}.`);
    }
    assert.match(taskPrompt, /source of truth/, "Task prompt should direct the agent to use generated task content.");

    const annotationDelete = panelPage.waitForResponse((response) =>
      isBridgeResponse(response, "DELETE", `/annotations/${annotationId}`, 200)
    );
    await statusSelect.locator("..").getByRole("button", { name: /^(Delete|删除)$/ }).click();
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
    assert.equal(
      await panelPage.getByRole("checkbox", { name: new RegExp(annotationId) }).count(),
      0,
      "Deleted annotation card should remain absent after refresh."
    );

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

    assert.deepEqual(browserDiagnostics, [], "Browser console and page errors must remain empty.");
    console.log(`PASS packaged MV3 workflow: annotation ${annotationId}, task ${taskId}, GET/auth regression covered.`);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (browserDiagnostics.length > 0) {
      failure.message += `\nBrowser diagnostics:\n${browserDiagnostics.join("\n")}`;
    }
    throw failure;
  } finally {
    await context?.close().catch(() => {});
    await Promise.allSettled([close(bridgeServer), close(sampleServer)]);
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await run();
