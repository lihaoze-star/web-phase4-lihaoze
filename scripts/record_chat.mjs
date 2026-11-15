#!/usr/bin/env node
/** Record a real streaming answer as JPEG frames (assembled to GIF separately). */
import { mkdirSync, rmSync, writeFileSync, writeFileSync as write } from "node:fs";
import path from "node:path";

const PORT = 9222;
const PAGE = "http://127.0.0.1:8000/chat.html";
const FRAMES = path.resolve(process.cwd(), ".tmp/chat-frames");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("No page target");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let seq = 0;
let frames = 0;
const pending = new Map();

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
  if (message.method === "Page.screencastFrame") {
    frames += 1;
    const file = path.join(FRAMES, "frame-" + String(frames).padStart(5, "0") + ".jpg");
    writeFileSync(file, Buffer.from(message.params.data, "base64"));
    call("Page.screencastFrameAck", { sessionId: message.params.sessionId }).catch(() => {});
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

await call("Page.enable");
await call("Runtime.enable");
await call("Network.setCacheDisabled", { cacheDisabled: true });
await call("Emulation.setDeviceMetricsOverride", {
  width: 1280, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 900
});
await call("Page.navigate", { url: PAGE + "?record=" + Date.now() });
await delay(1800);
await evaluate(`(() => {
  const shell = document.querySelector(".chat-shell");
  window.scrollTo(0, shell.getBoundingClientRect().top + window.scrollY - 80);
  return true;
})()`);
await delay(300);

await call("Page.startScreencast", {
  format: "jpeg", quality: 78, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1
});

await evaluate(`(() => {
  const input = document.querySelector("#chat-input");
  input.value = "用三点说明 fetch 和 CORS 的区别，每点不超过两句话。";
  document.querySelector("[data-chat-form]").requestSubmit();
  return true;
})()`);

const started = Date.now();
let state = {};
while (Date.now() - started < 90000) {
  await delay(250);
  state = JSON.parse(await evaluate(`JSON.stringify({
    status: document.querySelector("[data-chat-status]")?.textContent,
    streaming: Boolean(document.querySelector(".is-streaming")),
    error: document.querySelector(".chat-error:not([hidden]) [data-error-text]")?.textContent || null,
    last: [...document.querySelectorAll(".chat-bubble")].at(-1)?.textContent?.slice(-120) || ""
  })`));
  if (!state.streaming && (state.status || "").includes("完成")) break;
  if (state.error) break;
}

await delay(900);
await call("Page.stopScreencast");
writeFileSync(path.join(FRAMES, "state.json"), JSON.stringify({ frames, state }, null, 2));
console.log(JSON.stringify({ frames, state }, null, 2));
ws.close();
