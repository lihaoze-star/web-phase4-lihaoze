/* Task list: real fetch() calls against the Flask + SQLite API. */
(function () {
  "use strict";

  const config = window.TASK_API_CONFIG || {};
  const apiBase = String(config.baseUrl || "").replace(/\/+$/, "");
  const timeoutMs = Number(config.timeoutMs) || 8000;

  const form = document.querySelector("[data-task-form]");
  const input = document.querySelector("#task-title");
  const submitButton = form ? form.querySelector('button[type="submit"]') : null;
  const submitLabel = form ? form.querySelector("[data-submit-label]") : null;
  const formError = document.querySelector("[data-form-error]");
  const view = document.querySelector("[data-task-view]");
  const status = document.querySelector("[data-task-status]");
  const count = document.querySelector("[data-task-count]");
  const refreshButton = document.querySelector("[data-refresh]");

  if (!form || !input || !view || !status || !count) return;

  let loadToken = 0;

  document.querySelectorAll("[data-api-url]").forEach(function (element) {
    element.textContent = apiBase || "未配置";
  });

  /* ---------- tiny helpers ---------- */

  function setStatus(text, tone) {
    status.textContent = text;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  function clearFormError() {
    formError.textContent = "";
    formError.hidden = true;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || "";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  async function request(path, options) {
    if (!apiBase) {
      throw new Error("没有配置 API 地址，请检查 js/config.js");
    }

    const controller = new AbortController();
    const timer = window.setTimeout(function () {
      controller.abort();
    }, timeoutMs);

    const settings = Object.assign({}, options);
    settings.headers = Object.assign({}, settings.headers || {});
    if (settings.body) settings.headers["Content-Type"] = "application/json";
    settings.signal = controller.signal;

    try {
      const response = await fetch(apiBase + path, settings);
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }

      if (!response.ok) {
        const message =
          payload && typeof payload.msg === "string" && payload.msg
            ? payload.msg
            : "请求失败（HTTP " + response.status + "）";
        throw new Error(message);
      }

      return payload;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("请求超时：接口没有在 " + timeoutMs / 1000 + " 秒内返回。");
      }
      if (error instanceof TypeError) {
        throw new Error("请求失败：接口没有启动，或者服务端没有放行 CORS。");
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  /* ---------- states ---------- */

  function renderLoading() {
    view.setAttribute("aria-busy", "true");
    view.innerHTML =
      '<div class="task-skeleton" aria-hidden="true">' +
      '<span class="task-skeleton-row"></span>'.repeat(3) +
      "</div>" +
      '<p class="task-loading-copy">正在从接口读取任务…</p>';
  }

  function renderEmpty() {
    view.setAttribute("aria-busy", "false");
    view.innerHTML =
      '<div class="task-empty">' +
      '<p class="task-empty-mark" aria-hidden="true">0</p>' +
      "<h3>还没有任务。</h3>" +
      "<p>在上面的输入框写第一条，保存后它会从 SQLite 里读出来。</p>" +
      "</div>";
  }

  function renderError(message) {
    view.setAttribute("aria-busy", "false");
    view.innerHTML =
      '<div class="task-error" role="alert">' +
      '<p class="eyebrow"><span class="dot" aria-hidden="true"></span>REQUEST FAILED</p>' +
      "<h3>接口没有返回数据。</h3>" +
      '<p class="task-error-msg"></p>' +
      '<button class="button button--primary" type="button" data-retry>重试 <span aria-hidden="true">↻</span></button>' +
      '<p class="task-error-hint">检查 API 是否启动、js/config.js 的地址是否正确、服务端是否加了 CORS 响应头。</p>' +
      "</div>";
    view.querySelector(".task-error-msg").textContent = message;
  }

  function renderTasks(tasks) {
    const list = document.createElement("ul");
    list.className = "task-list";

    tasks.forEach(function (task) {
      const item = document.createElement("li");
      item.className = "task-item" + (task.done ? " is-done" : "");
      item.dataset.id = String(task.id);

      const label = document.createElement("label");
      label.className = "task-check";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(task.done);
      checkbox.dataset.toggle = String(task.id);
      checkbox.setAttribute(
        "aria-label",
        (task.done ? "标记「" : "标记「") + task.title + "」为" + (task.done ? "未完成" : "已完成")
      );

      const box = document.createElement("span");
      box.className = "task-check-box";
      box.setAttribute("aria-hidden", "true");

      label.append(checkbox, box);

      const body = document.createElement("div");
      body.className = "task-body";

      const title = document.createElement("p");
      title.className = "task-title";
      title.textContent = task.title;

      const meta = document.createElement("p");
      meta.className = "task-meta";
      meta.textContent = "创建于 " + formatDate(task.created_at) + (task.done ? " · 已完成" : "");

      body.append(title, meta);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "task-delete";
      remove.dataset.delete = String(task.id);
      remove.setAttribute("aria-label", "删除任务：" + task.title);
      remove.textContent = "删除";

      item.append(label, body, remove);
      list.append(item);
    });

    view.replaceChildren(list);
    view.setAttribute("aria-busy", "false");
  }

  /* ---------- data ---------- */

  async function loadTasks(options) {
    const quiet = Boolean(options && options.quiet);
    const token = ++loadToken;

    if (!quiet) {
      renderLoading();
      setStatus("正在读取任务…");
    } else {
      setStatus("正在刷新…");
    }

    try {
      const payload = await request("/api/tasks");
      if (token !== loadToken) return;

      const tasks = Array.isArray(payload && payload.data) ? payload.data : [];
      count.textContent = String(tasks.length).padStart(2, "0");

      if (tasks.length === 0) {
        renderEmpty();
        setStatus("接口返回了空列表，写一条试试。");
      } else {
        renderTasks(tasks);
        setStatus(quiet ? "列表已刷新。" : "已读取 " + tasks.length + " 条任务。");
      }
    } catch (error) {
      if (token !== loadToken) return;
      count.textContent = "—";
      renderError(error.message);
      setStatus("加载失败，可以点重试。", "error");
    }
  }

  /* ---------- events ---------- */

  if (refreshButton) {
    refreshButton.addEventListener("click", function () {
      loadTasks();
    });
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const title = input.value.trim();

    if (!title) {
      showFormError("先写一个标题，再添加。");
      input.focus();
      return;
    }
    if (title.length > 80) {
      showFormError("标题不能超过 80 个字符。");
      input.focus();
      return;
    }

    clearFormError();
    submitButton.disabled = true;
    submitLabel.textContent = "保存中";

    try {
      await request("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: title })
      });
      form.reset();
      setStatus("已添加，正在刷新列表…");
      await loadTasks({ quiet: true });
      input.focus();
    } catch (error) {
      showFormError(error.message);
      setStatus("添加失败。", "error");
    } finally {
      submitButton.disabled = false;
      submitLabel.textContent = "添加任务";
    }
  });

  view.addEventListener("click", async function (event) {
    const retry = event.target.closest("[data-retry]");
    if (retry) {
      loadTasks();
      return;
    }

    const remove = event.target.closest("[data-delete]");
    if (!remove) return;

    remove.disabled = true;
    remove.textContent = "删除中";
    try {
      await request("/api/tasks/" + remove.dataset.delete, { method: "DELETE" });
      setStatus("已删除，正在刷新列表…");
      await loadTasks({ quiet: true });
    } catch (error) {
      remove.disabled = false;
      remove.textContent = "删除";
      setStatus("删除失败：" + error.message, "error");
    }
  });

  view.addEventListener("change", async function (event) {
    const checkbox = event.target.closest("[data-toggle]");
    if (!checkbox) return;

    checkbox.disabled = true;
    try {
      await request("/api/tasks/" + checkbox.dataset.toggle, {
        method: "PUT",
        body: JSON.stringify({ done: checkbox.checked })
      });
      setStatus("状态已更新，正在刷新…");
      await loadTasks({ quiet: true });
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      checkbox.disabled = false;
      setStatus("更新失败：" + error.message, "error");
    }
  });

  loadTasks();
})();
