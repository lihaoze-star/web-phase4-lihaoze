/* Project archive: live focus timer + section highlight. */
(function () {
  "use strict";

  /* ---------- sticky section navigation ---------- */

  const caseLinks = Array.from(document.querySelectorAll("[data-case-link]"));
  const caseSections = caseLinks
    .map(function (link) {
      const id = link.getAttribute("href");
      return id ? document.querySelector(id) : null;
    })
    .filter(Boolean);

  function setActiveCase(id) {
    caseLinks.forEach(function (link) {
      if (link.getAttribute("href") === "#" + id) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  if (caseSections.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      function (entries) {
        const visible = entries
          .filter(function (entry) { return entry.isIntersecting; })
          .sort(function (a, b) { return b.intersectionRatio - a.intersectionRatio; });
        if (visible.length) setActiveCase(visible[0].target.id);
      },
      { rootMargin: "-28% 0px -58% 0px", threshold: [0, 0.1, 0.4, 0.8] }
    );
    caseSections.forEach(function (section) { observer.observe(section); });
  }

  /* ---------- focus timer ---------- */

  const root = document.querySelector("[data-timer]");
  if (!root) return;

  const display = root.querySelector("#timer-display");
  const progress = root.querySelector("#timer-progress");
  const toggle = root.querySelector("#timer-toggle");
  const reset = root.querySelector("#timer-reset");
  const status = root.querySelector("#timer-status");
  const modeButtons = Array.from(root.querySelectorAll("[data-minutes]"));

  if (!display || !progress || !toggle || !reset || !status) return;

  const RADIUS = 104;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const DEFAULT_MINUTES = 25;

  let totalSeconds = DEFAULT_MINUTES * 60;
  let remaining = totalSeconds;
  let running = false;
  let endAt = 0;
  let intervalId = null;

  progress.style.strokeDasharray = String(CIRCUMFERENCE);
  progress.style.strokeDashoffset = "0";

  function format(seconds) {
    const safe = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    return String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
  }

  function render() {
    display.textContent = format(remaining);
    display.setAttribute("datetime", "PT" + remaining + "S");
    const fraction = totalSeconds ? remaining / totalSeconds : 0;
    progress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - fraction));
  }

  function stopInterval() {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  function updateButton() {
    if (running) {
      toggle.textContent = "暂停";
    } else if (remaining <= 0) {
      toggle.textContent = "再来一轮";
    } else if (remaining < totalSeconds) {
      toggle.textContent = "继续";
    } else {
      toggle.textContent = "开始";
    }
  }

  function setRunning(next) {
    if (next && remaining <= 0) {
      remaining = totalSeconds;
      render();
    }

    running = next;
    root.classList.toggle("is-running", running);

    if (running) {
      endAt = Date.now() + remaining * 1000;
      stopInterval();
      intervalId = window.setInterval(tick, 200);
      status.textContent = "专注中，先别切屏。";
    } else {
      stopInterval();
      if (remaining <= 0) {
        status.textContent = "完成一轮。起来走两步。";
      } else if (remaining < totalSeconds) {
        status.textContent = "已暂停，时间停在原地。";
      } else {
        status.textContent = "准备开始";
      }
    }

    updateButton();
  }

  function tick() {
    const next = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    if (next !== remaining) {
      remaining = next;
      render();
    }

    if (next <= 0) {
      stopInterval();
      running = false;
      root.classList.remove("is-running");
      status.textContent = "完成一轮。起来走两步。";
      updateButton();
    }
  }

  toggle.addEventListener("click", function () {
    setRunning(!running);
  });

  reset.addEventListener("click", function () {
    stopInterval();
    running = false;
    remaining = totalSeconds;
    root.classList.remove("is-running");
    render();
    updateButton();
    status.textContent = "准备开始";
  });

  modeButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      const minutes = Number(button.dataset.minutes);
      if (!Number.isFinite(minutes) || minutes <= 0) return;

      stopInterval();
      running = false;
      totalSeconds = minutes * 60;
      remaining = totalSeconds;
      root.classList.remove("is-running");
      modeButtons.forEach(function (item) {
        item.setAttribute("aria-pressed", String(item === button));
      });
      render();
      updateButton();
      status.textContent = minutes + " 分钟，准备好了。";
    });
  });

  render();
  updateButton();
})();
