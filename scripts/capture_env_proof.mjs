#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";

const PORT = 9222;
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
  const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
  if (!msg.id) return;
  const item = pending.get(msg.id);
  if (!item) return;
  pending.delete(msg.id);
  clearTimeout(item.timer);
  if (msg.error) item.reject(new Error(msg.error.message));
  else item.resolve(msg.result);
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
  return result.result.value;
}
await call("Page.enable");
await call("Runtime.enable");
const url = "file:///" + path.resolve(process.cwd(), "docs/env-proof.html").replaceAll("\\", "/");
await call("Emulation.setDeviceMetricsOverride", {
  width: 1400, height: 900, deviceScaleFactor: 2, mobile: false, screenWidth: 1400, screenHeight: 900
});
await call("Page.navigate", { url });
await new Promise((r) => setTimeout(r, 700));
const height = Math.ceil(await evaluate("document.documentElement.scrollHeight"));
await call("Emulation.setDeviceMetricsOverride", {
  width: 1400, height, deviceScaleFactor: 2, mobile: false, screenWidth: 1400, screenHeight: height
});
await new Promise((r) => setTimeout(r, 300));
const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true }, 30000);
await writeFile(path.resolve(process.cwd(), "docs/screenshots/env-proof.png"), Buffer.from(shot.data, "base64"));
console.log("saved", height);
ws.close();
