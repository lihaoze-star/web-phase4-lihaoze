#!/usr/bin/env node
/** Record the integrated app demo frames for the 2-minute video. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const PORT = 9222;
const PAGE = "http://127.0.0.1:8000/app.html";
const FRAMES = path.resolve(process.cwd(), ".tmp/demo-frames");
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
let frameIndex = 0;
const pending = new Map();
const manifest = [];

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
    frameIndex += 1;
    const file = "frame-" + String(frameIndex).padStart(5, "0") + ".jpg";
    writeFileSync(path.join(FRAMES, file), Buffer.from(message.params.data, "base64"));
    manifest.push({ file, time: Date.now() });
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
async function evaluate(expression, awaitPromise = false) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluate failed");
  return result.result.value;
}

const caption = (text) => evaluate(`window.__demoCaption(${JSON.stringify(text)}); true`);
const state = () => evaluate(`JSON.stringify({
  count: document.querySelector("[data-task-count]")?.textContent,
  status: document.querySelector("[data-chat-status]")?.textContent,
  streaming: Boolean(document.querySelector(".is-streaming")),
  toolCount: document.querySelector("[data-tool-count]")?.textContent
})`).then(JSON.parse);

await call("Page.enable");
await call("Runtime.enable");
await call("Network.enable");
await call("Network.setCacheDisabled", { cacheDisabled: true });
await call("Emulation.setDeviceMetricsOverride", {
  width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 800
});
await call("Page.navigate", { url: PAGE + "?demo=" + Date.now() });
await delay(2200);

await evaluate(`(() => {
  document.querySelector(".app-hero").style.display = "none";
  document.querySelector(".site-footer").style.display = "none";
  document.querySelector(".app-section").style.paddingTop = "16px";
  document.querySelector(".app-col--chat .chat-log").style.height = "300px";
  document.querySelector(".app-col--chat .chat-log").style.minHeight = "260px";
  document.querySelector(".app-col--tasks .task-view").style.maxHeight = "330px";
  document.querySelector(".app-tool-panel").style.marginTop = "10px";
  window.scrollTo(0, 0);

  const style = document.createElement("style");
  style.textContent = "#demo-caption{position:fixed;top:76px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:10px;max-width:860px;padding:9px 16px;background:#141414;color:#f8f5ee;font:600 13px/1.5 'Microsoft YaHei',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.22);border-left:4px solid #d8ff47;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#demo-caption b{color:#d8ff47;font-size:11px;letter-spacing:.12em}";
  document.head.appendChild(style);
  const bar = document.createElement("div");
  bar.id = "demo-caption";
  bar.innerHTML = '<b>DEMO</b><span></span>';
  document.body.appendChild(bar);
  window.__demoCaption = (text) => { bar.querySelector("span").textContent = text; };
  window.__demoCaption("一个页面：左边清单，右边 AI，共用一套 API 与 SQLite");
  return true;
})()`);
await delay(1200);

await call("Page.startScreencast", {
  format: "jpeg", quality: 82, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1
});
await delay(2600);

/* 1. manual create */
await caption("① 手动新增：整理答辩提纲 → POST /api/tasks");
await evaluate(`(() => {
  const input = document.querySelector("#task-title");
  input.value = "整理答辩提纲";
  document.querySelector("[data-task-form]").requestSubmit();
  return true;
})()`);
await delay(2200);

/* 2. toggle + delete the temp task */
await caption("② 勾选完成 → PUT /api/tasks/:id");
await evaluate(`document.querySelector("[data-task-view] [data-toggle]").click(); true`);
await delay(1800);
await caption("③ 删除临时任务 → DELETE，列表回到 04");
await evaluate(`document.querySelector("[data-task-view] [data-delete]").click(); true`);
await delay(2200);

/* 3. AI natural-language add */
await caption("④ 对小岸说：帮我加一条准备 2 分钟演示");
await evaluate(`(() => {
  const input = document.querySelector("#chat-input");
  input.value = "帮我加一条准备 2 分钟演示";
  document.querySelector("[data-chat-form]").requestSubmit();
  return true;
})()`);
await delay(1500);
await caption("⑤ DeepSeek 流式返回，模型决定调用 add_item…");

let current = {};
const started = Date.now();
let toolSeen = false;
while (Date.now() - started < 70000) {
  await delay(350);
  current = await state();
  if (!toolSeen && Number(current.toolCount) > 0) {
    toolSeen = true;
    await caption("⑥ add_item 已执行：左侧列表自动从 04 变成 05");
  }
  if (!current.streaming && ((current.status || "").includes("完成") || (current.status || "").includes("失败"))) break;
}
await delay(2500);

/* 4. show the tool log */
await caption("⑦ 工具日志：工具名 add_item、参数 title、结果新增一条");
await evaluate(`(() => {
  document.querySelector(".app-col--chat .chat-log").style.height = "260px";
  const log = document.querySelector(".app-tool-panel .chat-tool-log");
  log.style.maxHeight = "240px";
  document.querySelector(".app-tool-panel").scrollIntoView({ block: "center" });
  return true;
})()`);
await delay(4800);

/* 5. query tool */
await caption("⑧ 再问：查一下有哪些未完成的任务 → query_items");
await evaluate(`(() => {
  window.scrollTo(0, 0);
  const input = document.querySelector("#chat-input");
  input.value = "查一下有哪些未完成的任务";
  document.querySelector("[data-chat-form]").requestSubmit();
  return true;
})()`);
const queryStart = Date.now();
while (Date.now() - queryStart < 70000) {
  await delay(350);
  current = await state();
  if (!current.streaming && ((current.status || "").includes("完成") || (current.status || "").includes("失败"))) break;
}
await delay(1200);
await evaluate(`document.querySelector(".app-tool-panel").scrollIntoView({ block: "center" }); true`);
await caption("⑨ query_items 的结果也进了同一份工具日志");
await delay(4600);

/* 6. refresh from SQLite */
await caption("⑩ 点刷新 → GET /api/tasks，数据来自 SQLite，不是前端数组");
await evaluate(`(() => {
  window.scrollTo(0, 0);
  document.querySelector("[data-refresh]").click();
  return true;
})()`);
await delay(3000);
await caption("手动 CRUD 和 AI 工具调用，写的是同一张 tasks 表");

await delay(3200);
const endTime = Date.now();
await call("Page.stopScreencast");
writeFileSync(
  path.join(FRAMES, "manifest.json"),
  JSON.stringify({ frames: manifest, endTime, final: current }, null, 2)
);
console.log(JSON.stringify({ frames: manifest.length, duration: (endTime - manifest[0].time) / 1000, final: current }, null, 2));
ws.close();
