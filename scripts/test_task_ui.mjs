#!/usr/bin/env node
/** Exercise create / reload / toggle / delete through the real UI. */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PORT = 9222;
const PAGE = "http://127.0.0.1:8000/tasks.html";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("No page target");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let seq = 0;
const pending = new Map();
let consoleErrors = [];
const failedRequests = [];

ws.addEventListener("message", (event) => {
  const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
  if (message.id) {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(`${message.error.message} (${message.error.code})`));
    else item.resolve(message.result);
    return;
  }
  const { method, params } = message;
  if (method === "Log.entryAdded" && params.entry.level === "error") {
    consoleErrors.push({ kind: "log", text: params.entry.text, url: params.entry.url || "" });
  } else if (method === "Runtime.consoleAPICalled" && params.type === "error") {
    consoleErrors.push({
      kind: "console.error",
      text: params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")
    });
  } else if (method === "Network.loadingFailed") {
    failedRequests.push({ errorText: params.errorText, blockedReason: params.blockedReason || null });
  }
});

function call(method, params = {}, timeout = 30000) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluate failed");
  return result.result.value;
}

const snapshot = () => evaluate(`JSON.stringify({
  status: document.querySelector("[data-task-status]")?.textContent || null,
  count: document.querySelector("[data-task-count]")?.textContent || null,
  items: [...document.querySelectorAll(".task-item")].map((item) => ({
    title: item.querySelector(".task-title")?.textContent,
    done: item.classList.contains("is-done")
  })),
  empty: Boolean(document.querySelector(".task-empty")),
  error: document.querySelector(".task-error-msg")?.textContent || null
})`).then(JSON.parse);

async function addTask(title) {
  await evaluate(`(() => {
    const input = document.querySelector("#task-title");
    input.value = ${JSON.stringify(title)};
    document.querySelector("[data-task-form]").requestSubmit();
    return true;
  })()`);
  await delay(1800);
}

await call("Page.enable");
await call("Runtime.enable");
await call("Log.enable");
await call("Network.enable");
await call("Emulation.setDeviceMetricsOverride", {
  width: 1440, height: 1000, deviceScaleFactor: 1.5, mobile: false, screenWidth: 1440, screenHeight: 1000
});
await call("Log.clear");
await call("Page.navigate", { url: PAGE });
await delay(2400);

const steps = {};
steps.initial = await snapshot();

await addTask("把任务 3 联调完成");
steps.afterFirstAdd = await snapshot();

await addTask("给接口加 CORS");
steps.afterSecondAdd = await snapshot();

await call("Page.reload", {}, 15000);
await delay(2400);
steps.afterReload = await snapshot();

await evaluate(`document.querySelector('.task-item input[type="checkbox"]').click(); true`);
await delay(1800);
steps.afterToggle = await snapshot();

await addTask("临时任务：验证删除");
steps.afterTempAdd = await snapshot();

const deleted = await evaluate(`(() => {
  const row = [...document.querySelectorAll(".task-item")].find((item) =>
    (item.querySelector(".task-title")?.textContent || "").includes("临时任务"));
  if (!row) return false;
  row.querySelector("[data-delete]").click();
  return true;
})()`);
await delay(1800);
steps.afterDelete = await snapshot();
steps.deleted = deleted;

const height = Math.ceil(await evaluate("document.documentElement.scrollHeight"));
await call("Emulation.setDeviceMetricsOverride", {
  width: 1440, height, deviceScaleFactor: 1.5, mobile: false, screenWidth: 1440, screenHeight: height
});
await delay(300);
const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true }, 60000);
await writeFile(path.resolve(process.cwd(), "docs/screenshots/task-state-list.png"), Buffer.from(shot.data, "base64"));

console.log(JSON.stringify({ steps, consoleErrors, failedRequests }, null, 2));
ws.close();
