#!/usr/bin/env node
/** 375px check for the new task page. */
const PORT = 9222;
const PAGE = "http://127.0.0.1:8000/tasks.html";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = targets.find((item) => item.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
  if (!message.id) return;
  const item = pending.get(message.id);
  if (!item) return;
  pending.delete(message.id);
  clearTimeout(item.timer);
  if (message.error) item.reject(new Error(message.error.message));
  else item.resolve(message.result);
});

function call(method, params = {}, timeout = 20000) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), timeout);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true });
  return result.result.value;
}

await call("Page.enable");
await call("Runtime.enable");
await call("Emulation.setDeviceMetricsOverride", {
  width: 375, height: 812, deviceScaleFactor: 2, mobile: true, screenWidth: 375, screenHeight: 812
});
await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await call("Page.navigate", { url: PAGE });
await delay(2200);

const state = JSON.parse(await evaluate(`JSON.stringify((() => {
  const vw = innerWidth;
  const bad = [...document.querySelectorAll("body *")].filter((el) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    return rect.left < -1 || rect.right > vw + 1;
  }).slice(0, 6).map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 50), right: Math.round(el.getBoundingClientRect().right) }));
  return {
    w: vw,
    sw: document.documentElement.scrollWidth,
    items: document.querySelectorAll(".task-item").length,
    bad,
    title: document.title
  };
})())`));
console.log(JSON.stringify(state, null, 2));
ws.close();
