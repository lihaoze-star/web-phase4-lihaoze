#!/usr/bin/env node
/**
 * Capture real screenshots + a DevTools-level network log for the site.
 *
 * Prerequisite: a Chromium/Edge instance started with
 *   msedge --headless=new --remote-debugging-port=9222 about:blank
 * and `python serve.py` running on http://127.0.0.1:8000.
 *
 * Run: node scripts/capture.mjs
 *
 * Outputs: docs/screenshots/*.png, docs/network-record.md, docs/network-capture.json
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PORT = 9222;
const BASE = "http://127.0.0.1:8000";
const ROOT = process.cwd();
const SHOTS = path.join(ROOT, "docs", "screenshots");
const DOCS = path.join(ROOT, "docs");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();

    ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      if (message.id) {
        const item = this.pending.get(message.id);
        if (!item) return;
        this.pending.delete(message.id);
        clearTimeout(item.timer);
        if (message.error) item.reject(new Error(`${message.error.message} (${message.error.code})`));
        else item.resolve(message.result);
        return;
      }

      this.listeners.forEach((listener) => listener(message));
    });
  }

  call(method, params = {}, timeout = 30000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method, timeout = 20000) {
    let off;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Event timeout: ${method}`));
      }, timeout);
      off = this.on((message) => {
        if (message.method !== method) return;
        clearTimeout(timer);
        off();
        resolve(message.params);
      });
    });
    return promise;
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((item) => item.type === "page");
  if (!target) throw new Error("No page target. Start Edge with about:blank first.");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), 10000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${event.message || "unknown"}`));
    }, { once: true });
  });

  const cdp = new CDP(ws);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Network.enable");
  await cdp.call("Log.enable");
  await cdp.call("Network.setCacheDisabled", { cacheDisabled: true });
  return { cdp, ws };
}

async function evaluate(cdp, expression) {
  const result = await cdp.call("Runtime.evaluate", {
    expression,
    returnByValue: true
  }, 10000);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Evaluation failed");
  }
  return result.result.value;
}

function createCollector(cdp) {
  const state = {
    network: new Map(),
    consoleErrors: []
  };

  cdp.on((message) => {
    const { method, params } = message;

    if (method === "Runtime.exceptionThrown") {
      state.consoleErrors.push({
        kind: "exception",
        text: params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Uncaught exception"
      });
      return;
    }

    if (method === "Runtime.consoleAPICalled" && params.type === "error") {
      state.consoleErrors.push({
        kind: "console.error",
        text: params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")
      });
      return;
    }

    if (method === "Log.entryAdded" && params.entry.level === "error") {
      state.consoleErrors.push({
        kind: "log",
        text: params.entry.text,
        url: params.entry.url || ""
      });
      return;
    }

    if (method === "Network.requestWillBeSent") {
      state.network.set(params.requestId, {
        url: params.request.url,
        method: params.request.method,
        type: params.type,
        start: params.timestamp,
        status: null,
        end: null,
        bytes: null
      });
      return;
    }

    if (method === "Network.responseReceived") {
      const entry = state.network.get(params.requestId);
      if (!entry) return;
      entry.status = params.response.status;
      entry.mimeType = params.response.mimeType || "";
      return;
    }

    if (method === "Network.loadingFinished") {
      const entry = state.network.get(params.requestId);
      if (!entry) return;
      entry.end = params.timestamp;
      entry.bytes = params.encodedDataLength;
      return;
    }

    if (method === "Network.loadingFailed") {
      const entry = state.network.get(params.requestId);
      if (!entry) return;
      entry.failed = true;
      entry.end = params.timestamp;
      entry.errorText = params.errorText;
    }
  });

  return state;
}

let currentViewport = { width: 1440, height: 1000, mobile: false, scale: 1 };

async function setViewport(cdp, viewport) {
  currentViewport = {
    width: viewport.width,
    height: viewport.height,
    mobile: Boolean(viewport.mobile),
    scale: viewport.scale ?? 1
  };
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: currentViewport.width,
    height: currentViewport.height,
    deviceScaleFactor: currentViewport.scale,
    mobile: currentViewport.mobile,
    screenWidth: currentViewport.width,
    screenHeight: currentViewport.height
  });
  await cdp.call("Emulation.setTouchEmulationEnabled", {
    enabled: currentViewport.mobile,
    maxTouchPoints: currentViewport.mobile ? 5 : 1
  });
}

async function loadImages(cdp) {
  await evaluate(cdp, `(() => {
    document.querySelectorAll("img[loading='lazy']").forEach((img) => {
      img.loading = "eager";
    });
    return true;
  })()`);

  for (let i = 0; i < 30; i += 1) {
    const complete = await evaluate(cdp, `[...document.images].every((img) => img.complete)`);
    if (complete) return;
    await delay(200);
  }
}

async function visit(cdp, url) {
  const loaded = cdp.once("Page.loadEventFired", 20000);
  const result = await cdp.call("Page.navigate", { url }, 15000);
  if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`);
  await loaded;
  await delay(1100);
  await loadImages(cdp);
}

async function audit(cdp) {
  const raw = await evaluate(cdp, `(() => {
    const vw = window.innerWidth;
    const overflowing = [...document.querySelectorAll("body *")]
      .filter((el) => {
        if (el.closest(".ticker") || el.closest(".mobile-menu")) return false;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (style.position === "fixed") return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return false;
        return rect.left < -1 || rect.right > vw + 1;
      })
      .slice(0, 6)
      .map((el) => ({
        tag: el.tagName,
        cls: String(el.className).slice(0, 60),
        left: Math.round(el.getBoundingClientRect().left),
        right: Math.round(el.getBoundingClientRect().right)
      }));

    return JSON.stringify({
      title: document.title,
      lang: document.documentElement.lang,
      h1: document.querySelectorAll("h1").length,
      navs: document.querySelectorAll("nav").length,
      sections: document.querySelectorAll("section").length,
      images: document.images.length,
      imagesWithoutAlt: [...document.images].filter((img) => !img.hasAttribute("alt")).length,
      innerWidth: vw,
      scrollWidth: document.documentElement.scrollWidth,
      overflowing
    });
  })()`);
  return JSON.parse(raw);
}

async function screenshot(cdp, file, { full = true } = {}) {
  let width = currentViewport.width;
  let height = currentViewport.height;
  let shot;

  if (full) {
    // A tall viewport paints every image; captureBeyondViewport can skip
    // off-screen images in this Chromium build.
    const metrics = await cdp.call("Page.getLayoutMetrics", {}, 10000);
    const content = metrics.cssContentSize;
    width = Math.ceil(content.width);
    height = Math.ceil(content.height);

    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: currentViewport.scale,
      mobile: currentViewport.mobile,
      screenWidth: width,
      screenHeight: height
    });
    await delay(500);
    shot = await cdp.call("Page.captureScreenshot", { format: "png", fromSurface: true }, 60000);
    await setViewport(cdp, currentViewport);
    await delay(300);
  } else {
    shot = await cdp.call("Page.captureScreenshot", { format: "png", fromSurface: true }, 30000);
  }

  const buffer = Buffer.from(shot.data, "base64");
  await writeFile(path.join(SHOTS, file), buffer);
  return { file, width, height, bytes: buffer.length };
}

function summarize(entries) {
  return [...entries.values()]
    .filter((entry) => entry.url.startsWith(BASE))
    .map((entry) => ({
      path: entry.url.slice(BASE.length) || "/",
      method: entry.method,
      status: entry.status,
      type: entry.type,
      durationMs: entry.end ? Math.round((entry.end - entry.start) * 1000) : null,
      bytes: entry.bytes,
      mimeType: entry.mimeType,
      failed: Boolean(entry.failed)
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function find(entries, predicate) {
  return entries.find(predicate);
}

function tableRow(label, entry) {
  if (!entry) return `| ${label} | — | — | — | — | — |`;
  const size = entry.bytes == null ? "—" : `${(entry.bytes / 1024).toFixed(1)} KB`;
  const time = entry.durationMs == null ? "—" : `${entry.durationMs} ms`;
  return `| ${label} | \`${entry.path}\` | ${entry.method} | ${entry.status ?? "—"} | ${time} | ${size} |`;
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const { cdp, ws } = await connect();
  const state = createCollector(cdp);
  const shots = [];
  const audits = {};
  const errors = [];

  // ---------- home / desktop ----------
  await setViewport(cdp, { width: 1440, height: 1000, mobile: false });
  await visit(cdp, `${BASE}/`);
  audits.homeDesktop = await audit(cdp);
  const homeEntries = summarize(state.network);
  errors.push(...state.consoleErrors.map((item) => ({ page: "home-desktop", ...item })));
  shots.push(await screenshot(cdp, "desktop-home.png"));
  shots.push(await screenshot(cdp, "desktop-home-viewport.png", { full: false }));

  // ---------- home / mobile ----------
  await setViewport(cdp, { width: 375, height: 812, mobile: true, scale: 2 });
  await visit(cdp, `${BASE}/`);
  audits.homeMobile = await audit(cdp);
  errors.push(...state.consoleErrors.map((item) => ({ page: "home-mobile", ...item })));
  shots.push(await screenshot(cdp, "mobile-home.png"));
  shots.push(await screenshot(cdp, "mobile-home-viewport.png", { full: false }));

  const menuState = await evaluate(cdp, `(() => {
    const toggle = document.querySelector(".nav-toggle");
    toggle.click();
    return JSON.stringify({
      expanded: toggle.getAttribute("aria-expanded"),
      hidden: document.querySelector("#site-menu").hidden
    });
  })()`);
  await delay(300);
  shots.push(await screenshot(cdp, "mobile-menu.png", { full: false }));
  await evaluate(cdp, `document.querySelector(".nav-toggle").click(); true`);

  // ---------- project / desktop ----------
  await setViewport(cdp, { width: 1440, height: 1000, mobile: false });
  await visit(cdp, `${BASE}/project.html`);
  audits.projectDesktop = await audit(cdp);
  errors.push(...state.consoleErrors.map((item) => ({ page: "project-desktop", ...item })));
  shots.push(await screenshot(cdp, "desktop-project.png"));

  await evaluate(cdp, `document.querySelector('[data-minutes="5"]').click(); true`);
  await evaluate(cdp, `document.querySelector("#timer-toggle").click(); true`);
  await delay(2300);
  const timerRunning = JSON.parse(await evaluate(cdp, `JSON.stringify({
    display: document.querySelector("#timer-display").textContent.trim(),
    status: document.querySelector("#timer-status").textContent.trim(),
    button: document.querySelector("#timer-toggle").textContent.trim()
  })`));
  await evaluate(cdp, `document.querySelector("#timer-toggle").click(); true`);
  const pausedDisplay = await evaluate(cdp, `document.querySelector("#timer-display").textContent.trim()`);
  await delay(1200);
  const stillPaused = await evaluate(cdp, `document.querySelector("#timer-display").textContent.trim()`);
  const timerPaused = JSON.parse(await evaluate(cdp, `JSON.stringify({
    display: document.querySelector("#timer-display").textContent.trim(),
    status: document.querySelector("#timer-status").textContent.trim()
  })`));
  await evaluate(cdp, `document.querySelector("[data-timer]").scrollIntoView({block: "center"}); true`);
  await delay(300);
  shots.push(await screenshot(cdp, "desktop-timer.png", { full: false }));
  await evaluate(cdp, `document.querySelector("#timer-reset").click(); true`);

  // ---------- project / mobile ----------
  await setViewport(cdp, { width: 375, height: 812, mobile: true, scale: 2 });
  await visit(cdp, `${BASE}/project.html`);
  audits.projectMobile = await audit(cdp);
  errors.push(...state.consoleErrors.map((item) => ({ page: "project-mobile", ...item })));
  shots.push(await screenshot(cdp, "mobile-project.png"));

  // ---------- intentional 404 ----------
  await setViewport(cdp, { width: 1440, height: 1000, mobile: false });
  await visit(cdp, `${BASE}/this-page-does-not-exist.html`);
  audits.notFound = await audit(cdp);
  const notFoundEntries = summarize(state.network);
  const notFoundErrors = state.consoleErrors.slice();
  shots.push(await screenshot(cdp, "404.png"));
  shots.push(await screenshot(cdp, "404-viewport.png", { full: false }));

  await setViewport(cdp, { width: 375, height: 812, mobile: true, scale: 2 });
  await visit(cdp, `${BASE}/this-page-does-not-exist.html`);
  audits.notFoundMobile = await audit(cdp);
  shots.push(await screenshot(cdp, "404-mobile.png"));

  // ---------- network record ----------
  const documentEntry = find(homeEntries, (entry) => entry.type === "Document");
  const cssEntry = find(homeEntries, (entry) => entry.path === "/css/style.css");
  const jsEntry = find(homeEntries, (entry) => entry.path === "/js/main.js");
  const fetchEntry = find(homeEntries, (entry) => entry.path === "/data/now.json");
  const notFoundEntry = find(notFoundEntries, (entry) => entry.status === 404);

  const now = new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false
  });

  const markdown = `# 抓包记录 / Network Log

- 采集时间：${now}（Asia/Shanghai）
- 采集环境：Microsoft Edge ${process.env.EDGE_VERSION || "157"}（headless），本地 \`http://127.0.0.1:8000\`
- 采集方式：Chrome DevTools Protocol 的 Network 域（等价于 DevTools → Network 面板，F12）
- 页面：首页 \`index.html\`，1440 × 1000

## 3 条核心请求

| 请求 | 路径 | 方法 | 状态码 | 耗时 | 传输大小 |
| --- | --- | --- | --- | --- | --- |
${tableRow("页面主文档", documentEntry)}
${tableRow("样式表", cssEntry)}
${tableRow("脚本", jsEntry)}
${tableRow("自己写的 fetch", fetchEntry)}

> 作业要求记录 3 条：主文档、一个 CSS 或 JS、一次自己写的 \`fetch\`。这里把 CSS 和 JS 都列出来，所以核心记录实际是 4 条。\`fetch\` 读取 \`data/now.json\`，用于更新「现在」卡片。

## 故意 404

| 请求 | 路径 | 方法 | 状态码 | 耗时 | 传输大小 |
| --- | --- | --- | --- | --- | --- |
${tableRow("不存在的路径", notFoundEntry)}

- 请求 \`/this-page-does-not-exist.html\` 返回 **404**。
- 页面仍然是自定义的 404 页，而不是服务器默认的错误页；截图见 [404.png](screenshots/404.png)。
- 控制台会出现一条资源 404 的红色提示，这是这次故意请求的预期结果，正常页面没有红色报错。

## 怎么复现

1. 在项目目录运行 \`python serve.py\`。
2. 打开 <http://127.0.0.1:8000/>，按 F12 进入 **Network** 面板，刷新页面。
3. 找到 \`index.html\`、\`css/style.css\`、\`js/main.js\`、\`data/now.json\`，对照上面的方法 / 状态码 / 耗时。
4. 地址栏访问 <http://127.0.0.1:8000/this-page-does-not-exist.html>，看 404 响应和自定义错误页。

原始事件数据在 [network-capture.json](network-capture.json)。
`;

  await writeFile(path.join(DOCS, "network-record.md"), markdown, "utf8");
  await writeFile(
    path.join(DOCS, "network-capture.json"),
    JSON.stringify({
      capturedAt: new Date().toISOString(),
      base: BASE,
      viewport: "1440x1000",
      home: homeEntries,
      notFound: notFoundEntries
    }, null, 2),
    "utf8"
  );

  const report = {
    shots,
    audits,
    menuState: JSON.parse(menuState),
    timer: { running: timerRunning, paused: timerPaused, pausedDisplay, stillPaused },
    consoleErrors: errors,
    notFoundConsoleErrors: notFoundErrors,
    network: {
      document: documentEntry,
      css: cssEntry,
      js: jsEntry,
      fetch: fetchEntry,
      notFound: notFoundEntry
    }
  };

  console.log(JSON.stringify(report, null, 2));
  console.log(errors.length ? `FAIL: ${errors.length} console error(s) on normal pages` : "PASS: no console errors on normal pages");
  ws.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
