#!/usr/bin/env node
/**
 * Capture the task page in a real browser.
 *
 * Usage:
 *   node scripts/capture_task_states.mjs <output.png> [waitMs] [latencyMs]
 *
 * latencyMs is applied after the page has loaded and then the refresh button is
 * clicked, so the loading state can be captured without slowing the page itself.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PORT = 9222;
const PAGE = "http://127.0.0.1:8000/tasks.html";
const [output = "docs/screenshots/task-state.png", waitArg = "2200", latencyArg = "0"] =
  process.argv.slice(2);
const waitMs = Number(waitArg);
const latency = Number(latencyArg);

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
const consoleErrors = [];
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
    failedRequests.push({
      errorText: params.errorText,
      corsErrorStatus: params.corsErrorStatus || null,
      blockedReason: params.blockedReason || null
    });
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

await call("Page.enable");
await call("Runtime.enable");
await call("Log.enable");
await call("Network.enable");
await call("Emulation.setDeviceMetricsOverride", {
  width: 1440, height: 1000, deviceScaleFactor: 1.5, mobile: false, screenWidth: 1440, screenHeight: 1000
});

await call("Log.clear");
consoleErrors.length = 0;
failedRequests.length = 0;

await call("Page.navigate", { url: PAGE });
await delay(waitMs);

if (latency > 0) {
  await call("Network.emulateNetworkConditions", {
    offline: false,
    latency,
    downloadThroughput: 10 * 1024 * 1024,
    uploadThroughput: 10 * 1024 * 1024,
    connectionType: "wifi"
  });
  await evaluate("document.querySelector('[data-refresh]').click(); true");
  await delay(450);
}

const state = JSON.parse(await evaluate(`JSON.stringify({
  title: document.title,
  status: document.querySelector("[data-task-status]")?.textContent || null,
  error: document.querySelector(".task-error-msg")?.textContent || null,
  items: document.querySelectorAll(".task-item").length,
  empty: Boolean(document.querySelector(".task-empty")),
  loading: Boolean(document.querySelector(".task-skeleton")),
  count: document.querySelector("[data-task-count]")?.textContent || null,
  api: document.querySelector("[data-api-url]")?.textContent || null,
  width: innerWidth,
  scrollWidth: document.documentElement.scrollWidth
})`));

const height = Math.ceil(await evaluate("document.documentElement.scrollHeight"));
await call("Emulation.setDeviceMetricsOverride", {
  width: 1440, height, deviceScaleFactor: 1.5, mobile: false, screenWidth: 1440, screenHeight: height
});
await delay(250);
const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true }, 60000);
const buffer = Buffer.from(shot.data, "base64");
await writeFile(path.resolve(process.cwd(), output), buffer);

if (latency > 0) {
  await call("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: "none"
  });
}

console.log(JSON.stringify({
  output,
  size: { width: 1440, height },
  state,
  consoleErrors,
  failedRequests
}, null, 2));

ws.close();
