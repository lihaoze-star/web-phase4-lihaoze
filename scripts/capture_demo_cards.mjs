#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";

const PORT = 9222;
const cards = ["intro", "tech", "pitfalls"];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = targets.find((t) => t.type === "page");
if (!target) throw new Error("no page target");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(typeof e.data === "string" ? e.data : String(e.data));
  if (!m.id) return;
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  clearTimeout(p.timer);
  if (m.error) p.reject(new Error(m.error.message));
  else p.resolve(m.result);
});
function call(method, params = {}, timeout = 30000) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), timeout);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
await call("Page.enable");
await call("Emulation.setDeviceMetricsOverride", {
  width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 800
});
for (const card of cards) {
  const file = path.resolve("docs/demo-card.html").replaceAll("\\", "/");
  await call("Page.navigate", { url: `file:///${file}?card=${card}` });
  await delay(600);
  const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true }, 30000);
  await writeFile(`docs/screenshots/demo-${card}.png`, Buffer.from(shot.data, "base64"));
  console.log("saved", card);
}
ws.close();
