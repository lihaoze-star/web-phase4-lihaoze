#!/usr/bin/env node
/** Acceptance: natural language -> add_item -> DB -> natural summary. */
import { writeFile } from "node:fs/promises";
import path from "node:path";

const PORT = 9222;
const TASKS = "http://127.0.0.1:8000/tasks.html";
const CHAT = "http://127.0.0.1:8000/chat.html";
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
const errors = [];
ws.addEventListener("message", (event) => {
  const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
  if (message.id) {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
    return;
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    errors.push(message.params.entry.text);
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    errors.push(message.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
});
function call(method, params = {}, timeout = 30000) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), timeout);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluate failed");
  return result.result.value;
}

async function screenshot(name) {
  const height = Math.ceil(await evaluate("document.documentElement.scrollHeight"));
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440, height, deviceScaleFactor: 1.5, mobile: false, screenWidth: 1440, screenHeight: height
  });
  await delay(300);
  const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true }, 60000);
  await writeFile(path.resolve(process.cwd(), "docs/screenshots/" + name), Buffer.from(shot.data, "base64"));
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 1000, deviceScaleFactor: 1.5, mobile: false, screenWidth: 1440, screenHeight: 1000
  });
}

const taskState = () => evaluate(`JSON.stringify({
  count: document.querySelector("[data-task-count]")?.textContent,
  items: [...document.querySelectorAll(".task-title")].map((el) => el.textContent)
})`).then(JSON.parse);

await call("Page.enable");
await call("Runtime.enable");
await call("Log.enable");
await call("Network.enable");
await call("Network.setCacheDisabled", { cacheDisabled: true });
await call("Emulation.setDeviceMetricsOverride", {
  width: 1440, height: 1000, deviceScaleFactor: 1.5, mobile: false, screenWidth: 1440, screenHeight: 1000
});

await call("Page.navigate", { url: TASKS + "?v=" + Date.now() });
await delay(2000);
const before = await taskState();
await screenshot("tool-before.png");

await call("Page.navigate", { url: CHAT + "?v=" + Date.now() });
await delay(1800);
await call("Log.clear");
await evaluate(`(() => {
  const input = document.querySelector("#chat-input");
  input.value = "帮我加一条明天交实验报告";
  document.querySelector("[data-chat-form]").requestSubmit();
  return true;
})()`);

const started = Date.now();
let chatState = {};
while (Date.now() - started < 70000) {
  await delay(350);
  chatState = JSON.parse(await evaluate(`JSON.stringify({
    status: document.querySelector("[data-chat-status]")?.textContent,
    streaming: Boolean(document.querySelector(".is-streaming")),
    toolCount: document.querySelector("[data-tool-count]")?.textContent,
    tools: [...document.querySelectorAll(".chat-tool")].map((el) => el.textContent),
    last: [...document.querySelectorAll(".chat-bubble")].at(-1)?.textContent?.slice(-180) || "",
    error: document.querySelector(".chat-error:not([hidden]) [data-error-text]")?.textContent || null
  })`));
  if (!chatState.streaming && (chatState.status || "").includes("完成")) break;
  if (chatState.error) break;
}
await screenshot("tool-chain.png");

await call("Page.navigate", { url: TASKS + "?v=" + Date.now() });
await delay(2000);
const after = await taskState();
await screenshot("tool-after.png");

console.log(JSON.stringify({ before, after, chatState, errors }, null, 2));
ws.close();
