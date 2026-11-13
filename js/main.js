/* 李昊泽 / 2026 — small, dependency-free enhancements. */
(function () {
  "use strict";

  /* ---------- mobile menu ---------- */

  const toggle = document.querySelector(".nav-toggle");
  const menu = document.querySelector("#site-menu");
  const menuLabel = toggle ? toggle.querySelector(".sr-only") : null;
  const mobileQuery = window.matchMedia("(min-width: 901px)");

  function setMenu(open, restoreFocus) {
    if (!toggle || !menu) return;
    toggle.setAttribute("aria-expanded", String(open));
    menu.hidden = !open;
    document.body.classList.toggle("menu-open", open);
    if (menuLabel) menuLabel.textContent = open ? "关闭菜单" : "打开菜单";

    if (open) {
      window.requestAnimationFrame(function () {
        const firstLink = menu.querySelector("a");
        if (firstLink) firstLink.focus();
      });
    } else if (restoreFocus) {
      toggle.focus();
    }
  }

  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      setMenu(menu.hidden, false);
    });

    menu.addEventListener("click", function (event) {
      if (event.target.closest("a")) setMenu(false, false);
    });

    document.addEventListener("keydown", function (event) {
      if (menu.hidden) return;

      if (event.key === "Escape") {
        setMenu(false, true);
        return;
      }

      if (event.key === "Tab") {
        const focusable = Array.from(
          menu.querySelectorAll("a[href], button:not([disabled])")
        ).filter(function (el) { return el.offsetParent !== null; });
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    if (typeof mobileQuery.addEventListener === "function") {
      mobileQuery.addEventListener("change", function (event) {
        if (event.matches) setMenu(false, false);
      });
    }
  }

  /* ---------- project filter ---------- */

  const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));
  const projectCards = Array.from(document.querySelectorAll("[data-category]"));
  const workGrid = document.querySelector("#work-grid");
  const visibleCount = document.querySelector("[data-visible-count]");

  function applyFilter(value) {
    if (!filterButtons.length || !projectCards.length) return;

    let shown = 0;
    projectCards.forEach(function (card) {
      const matches = value === "all" || card.dataset.category === value;
      card.hidden = !matches;
      if (matches) shown += 1;
    });

    filterButtons.forEach(function (button) {
      const active = button.dataset.filter === value;
      button.setAttribute("aria-pressed", String(active));
    });

    if (workGrid) workGrid.classList.toggle("is-filtered", value !== "all");
    if (visibleCount) visibleCount.textContent = String(shown).padStart(2, "0");
  }

  filterButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      applyFilter(button.dataset.filter || "all");
    });
  });

  /* ---------- "now" card: one real fetch ---------- */

  const nowCard = document.querySelector(".now-card");
  if (nowCard) {
    const controller = new AbortController();
    const timeout = window.setTimeout(function () { controller.abort(); }, 5000);

    fetch("data/now.json", { signal: controller.signal, cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || typeof data !== "object") return;
        Object.keys(data).forEach(function (key) {
          if (typeof data[key] !== "string") return;
          const target = document.querySelector('[data-now="' + key + '"]');
          if (target) target.textContent = data[key];
        });
        const updated = document.querySelector("[data-now-updated]");
        if (updated && typeof data.updated === "string") {
          updated.textContent = data.updated;
        }
        nowCard.classList.add("is-loaded");
      })
      .catch(function () {
        /* Keep the readable static fallback; no console noise. */
        nowCard.classList.add("is-fallback");
      })
      .finally(function () {
        window.clearTimeout(timeout);
      });
  }

  /* ---------- clock + 404 path ---------- */

  const clocks = document.querySelectorAll("[data-clock]");
  if (clocks.length) {
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai"
    });

    const tick = function () {
      const value = formatter.format(new Date());
      clocks.forEach(function (clock) { clock.textContent = value; });
    };

    tick();
    window.setInterval(tick, 30000);
  }

  const missingPath = document.querySelector("[data-missing-path]");
  if (missingPath) missingPath.textContent = window.location.pathname;
})();
