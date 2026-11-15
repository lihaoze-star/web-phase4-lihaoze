#!/usr/bin/env node
/** Real DeepSeek chat: 3 rounds, streaming, stop button, screenshot. */
import { writeFile } from "node:fs/promises";
import path from "node:path";

const PORT = 9222;
const PAGE = "http://127.0.0.1:8000/chat.html";
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
const state = () => evaluate(`JSON.stringify({
  status: document.querySelector("[data-chat-status]")?.textContent || null,
  streaming: Boolean(document.querySelector(".is-streaming")),
  stopped: Boolean(document.querySelector(".is-stopped")),
  messages: document.querySelectorAll(".chat-message").length,
  assistants: document.querySelectorAll(".chat-message--assistant").length,
  error: document.querySelector(".chat-error:not([hidden]) [data-error-text]")?.textContent || null,
  last: [...document.querySelectorAll(".chat-bubble")].at(-1)?.textContent?.slice(-80) || ""
})`).then(JSON.parse);

async function send(text) {
  await evaluate(`(() => {
    const input = document.querySelector("#chat-input");
    input.value = ${JSON.stringify(text)};
    document.querySelector("[data-chat-form]").requestSubmit();
    return true;
  })()`);
}

async function waitForDone(maxMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await delay(300);
    const now = await state();
    if (!now.streaming && (
      (now.status || "").includes("完成") ||
      (now.status || "").includes("失败") ||
      (now.status || "").includes("超时") ||
      now.error
    )) return now;
  }
  return state();
}

await call("Page.enable");
await call("Runtime.enable");
await call("Log.enable");
await call("Network.enable");
await call("Network.setCacheDisabled", { cacheDisabled: true });
await call("Emulation.setDeviceMetricsOverride", {
  width: 1440, height: 1000, deviceScaleFactor: 1.5, mobile: false, screenWidth: 1440, screenHeight: 1000
});
await call("Log.clear");
await call("Page.navigate", { url: PAGE + "?v=" + Date.now() });
await delay(1800);

const steps = {};
steps.initial = await state();

await send("用一句话解释 fetch 和 CORS 的区别。");
steps.round1 = await waitForDone();

await send("再用一个生活里的类比说明一下。");
steps.round2 = await waitForDone();

await send("最后给我三个复习要点，每条不超过 20 个字。");
steps.round3 = await waitForDone();

await send("请分十点详细解释 HTTP 缓存，每点至少两句话。");
let stopState = await state();
const stopStart = Date.now();
while (Date.now() - stopStart < 30000) {
  await delay(250);
  stopState = await state();
  if (stopState.streaming && stopState.last.length > 10) break;
}
await evaluate(`document.querySelector("[data-stop]").click(); true`);
await delay(700);
steps.afterStop = await state();

const height = Math.ceil(await evaluate("document.documentElement.scrollHeight"));
await call("Emulation.setDeviceMetricsOverride", {
  width: 1440, height, deviceScaleFactor: 1.5, mobile: false, screenWidth: 1440, screenHeight: height
});
await delay(300);
const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true }, 60000);
await writeFile(path.resolve(process.cwd(), "docs/screenshots/chat-real.png"), Buffer.from(shot.data, "base64"));

console.log(JSON.stringify({ steps, errors }, null, 2));
ws.close();
