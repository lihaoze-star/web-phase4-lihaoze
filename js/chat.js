/* Streaming chat: fetch + SSE, three states handled, stop button. */
(function () {
  "use strict";

  const config = window.TASK_API_CONFIG || {};
  const apiBase = String(config.baseUrl || "").replace(/\/+$/, "");
  const timeoutMs = 75000;

  const log = document.querySelector("[data-chat-log]");
  const form = document.querySelector("[data-chat-form]");
  const input = document.querySelector("#chat-input");
  const sendButton = document.querySelector("[data-send]");
  const stopButton = document.querySelector("[data-stop]");
  const clearButton = document.querySelector("[data-clear]");
  const status = document.querySelector("[data-chat-status]");
  const errorBox = document.querySelector("[data-chat-error]");
  const errorText = document.querySelector("[data-error-text]");
  const retryButton = document.querySelector("[data-retry]");
  const count = document.querySelector("[data-chat-count]");
  const toolLog = document.querySelector("[data-tool-log]");
  const toolCount = document.querySelector("[data-tool-count]");

  if (!log || !form || !input) return;

  const welcomeHTML = log.innerHTML;
  const toolLogHTML = toolLog ? toolLog.innerHTML : "";
  const history = [];
  let toolCalls = 0;
  let controller = null;
  let streaming = false;
  let timedOut = false;
  let timeoutId = null;

  document.querySelectorAll("[data-api-url]").forEach(function (element) {
    element.textContent = apiBase || "未配置";
  });

  function setStatus(text, tone) {
    status.textContent = text;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  function scrollLog() {
    log.scrollTop = log.scrollHeight;
  }

  function nowLabel() {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date());
  }

  function createMessage(role, options) {
    const settings = options || {};
    const article = document.createElement("article");
    article.className = "chat-message chat-message--" + role;
    if (settings.error) article.classList.add("is-error");
    if (settings.streaming) article.classList.add("is-streaming");

    const head = document.createElement("div");
    head.className = "chat-message-head";

    if (role === "assistant") {
      const avatar = document.createElement("span");
      avatar.className = "chat-avatar chat-avatar--small";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = "岸";
      head.appendChild(avatar);
    }

    const name = document.createElement("span");
    name.textContent = role === "assistant" ? "小岸" : "你";
    head.appendChild(name);

    const time = document.createElement("time");
    time.textContent = nowLabel();
    head.appendChild(time);

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = settings.text || "";

    article.append(head, bubble);
    log.appendChild(article);
    scrollLog();
    return { article: article, bubble: bubble };
  }

  function showError(message) {
    errorText.textContent = message;
    errorBox.hidden = false;
    scrollLog();
  }

  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderRichText(element, text) {
    const blocks = [];
    let html = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, function (_, code) {
      blocks.push(code.replace(/\n$/, ""));
      return "\u0000CODE" + (blocks.length - 1) + "\u0000";
    });

    html = escapeHTML(html);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/^#{1,3}\s+(.+)$/gm, "<strong>$1</strong>");
    // A stopped stream can end in the middle of ** or ```; drop the dangling marker.
    html = html.replace(/\*\*/g, "").replace(/```[^\n]*/g, "");
    html = html.replace(/\u0000CODE(\d+)\u0000/g, function (_, index) {
      return "<pre><code>" + escapeHTML(blocks[Number(index)]) + "</code></pre>";
    });
    html = html.replace(/\n/g, "<br>");
    element.innerHTML = html;
  }

  function hideError() {
    errorBox.hidden = true;
    errorText.textContent = "";
  }

  function toolSummary(call) {
    const result = call.result || {};
    if (!result.ok) return result.error || "工具执行失败";
    if (call.name === "add_item" && result.item) {
      return "新增 #" + result.item.id + " · " + result.item.title;
    }
    if (call.name === "query_items") {
      return "返回 " + result.count + " 条任务";
    }
    return "执行成功";
  }

  function appendToolLog(call) {
    if (!toolLog) return;
    const empty = toolLog.querySelector("[data-tool-empty]");
    if (empty) empty.remove();

    const ok = Boolean(call.result && call.result.ok);
    const entry = document.createElement("article");
    entry.className = "chat-tool" + (ok ? "" : " is-error");

    const head = document.createElement("div");
    head.className = "chat-tool-head";
    const name = document.createElement("span");
    name.className = "chat-tool-name";
    name.textContent = call.name || "unknown_tool";
    const status = document.createElement("span");
    status.className = "chat-tool-status";
    status.textContent = ok ? "成功" : "失败";
    head.append(name, status);

    const args = document.createElement("pre");
    args.className = "chat-tool-args";
    args.textContent = JSON.stringify(call.arguments || {}, null, 2);

    const result = document.createElement("p");
    result.className = "chat-tool-result";
    result.textContent = toolSummary(call);

    entry.append(head, args, result);
    toolLog.appendChild(entry);
    toolLog.scrollTop = toolLog.scrollHeight;

    toolCalls += 1;
    if (toolCount) toolCount.textContent = String(toolCalls);
    setStatus("工具 " + call.name + " 已执行，正在整理回答…");
  }

  function setStreaming(next) {
    streaming = next;
    log.setAttribute("aria-busy", String(next));
    sendButton.disabled = next;
    stopButton.disabled = !next;
    if (!next) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function updateCount() {
    count.textContent = input.value.length + " / 2000";
  }

  function parseBlock(block, bubble) {
    const lines = block.split(/\r?\n/);
    const dataLines = lines
      .filter(function (line) { return line.indexOf("data:") === 0; })
      .map(function (line) { return line.slice(5).trim(); });

    if (!dataLines.length) return false;
    const data = dataLines.join("\n");
    if (!data || data === "[DONE]") return true;

    let event;
    try {
      event = JSON.parse(data);
    } catch (error) {
      return false;
    }

    if (event.error) {
      throw new Error(event.error);
    }
    if (event.tool_call) {
      appendToolLog(event.tool_call);
    }
    if (typeof event.delta === "string" && event.delta) {
      bubble.textContent += event.delta;
      scrollLog();
    }
    return Boolean(event.done);
  }

  async function readStream(response, bubble) {
    if (!response.body) {
      throw new Error("浏览器没有拿到可读的响应流，请换一个浏览器再试。");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      const pieces = buffer.split(/\r?\n\r?\n/);
      buffer = pieces.pop() || "";
      for (const piece of pieces) {
        if (!piece.trim()) continue;
        if (parseBlock(piece, bubble)) {
          await reader.cancel().catch(function () {});
          return;
        }
      }
    }

    if (buffer.trim()) {
      parseBlock(buffer, bubble);
    }
  }

  async function startRequest() {
    if (streaming) return;
    if (!apiBase) {
      showError("没有配置 API 地址，请检查 js/config.js。");
      setStatus("没有 API 地址。", "error");
      return;
    }
    if (!history.length || history[history.length - 1].role !== "user") {
      return;
    }

    hideError();
    timedOut = false;
    setStreaming(true);
    setStatus("正在连接模型…");
    const node = createMessage("assistant", { streaming: true });
    controller = new AbortController();
    timeoutId = window.setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(apiBase + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-12) }),
        signal: controller.signal
      });

      if (!response.ok) {
        let message = "请求失败（HTTP " + response.status + "）";
        try {
          const payload = await response.json();
          if (payload && payload.msg) message = payload.msg;
        } catch (error) {
          /* keep the status line */
        }
        throw new Error(message);
      }

      setStatus("正在生成…");
      await readStream(response, node.bubble);

      const text = node.bubble.textContent.trim();
      node.article.classList.remove("is-streaming");
      if (!text) {
        node.bubble.textContent = "（模型没有返回内容）";
      } else {
        renderRichText(node.bubble, text);
        history.push({ role: "assistant", content: text });
      }
      setStatus("生成完成，可以继续追问。", "ok");

    } catch (error) {
      if (error.name === "AbortError" && !timedOut) {
        const partial = node.bubble.textContent.trim();
        node.article.classList.remove("is-streaming");
        if (partial) {
          renderRichText(node.bubble, partial);
          node.article.classList.add("is-stopped");
          history.push({ role: "assistant", content: partial });
        } else {
          node.article.remove();
        }
        setStatus("已停止生成。", "ok");
      } else {
        node.article.remove();
        if (error.name === "AbortError") {
          showError("等待超过 75 秒，已经停止这一轮。可以重试或缩短问题。");
          setStatus("生成超时。", "error");
        } else {
          showError(error.message);
          setStatus("这一轮失败了。", "error");
        }
      }
    } finally {
      controller = null;
      setStreaming(false);
    }
  }

  function sendMessage(text) {
    if (streaming) return;
    const value = String(text || "").trim();
    if (!value) {
      setStatus("先写一个问题。", "error");
      input.focus();
      return;
    }
    if (value.length > 2000) {
      setStatus("问题不能超过 2000 个字符。", "error");
      return;
    }

    hideError();
    createMessage("user", { text: value });
    history.push({ role: "user", content: value });
    input.value = "";
    updateCount();
    startRequest();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    sendMessage(input.value);
  });

  input.addEventListener("input", updateCount);

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  stopButton.addEventListener("click", function () {
    if (!controller) return;
    setStatus("正在停止…");
    stopButton.disabled = true;
    controller.abort();
  });

  retryButton.addEventListener("click", function () {
    if (streaming) return;
    hideError();
    startRequest();
  });

  clearButton.addEventListener("click", function () {
    if (controller) controller.abort();
    history.length = 0;
    log.innerHTML = welcomeHTML;
    toolCalls = 0;
    if (toolLog) toolLog.innerHTML = toolLogHTML;
    if (toolCount) toolCount.textContent = "0";
    hideError();
    input.value = "";
    updateCount();
    setStatus("对话已清空，可以重新开始。");
    input.focus();
  });

  updateCount();

  if (!apiBase) {
    showError("没有配置 API 地址，请检查 js/config.js。");
    setStatus("没有 API 地址。", "error");
  }
})();
