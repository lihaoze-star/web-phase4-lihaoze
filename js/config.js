/*
 * API 地址只在这里配置。
 * 业务代码 js/tasks.js 不写死任何后端地址；
 * 换服务器时只改这个文件，或部署时注入 window.TASK_API_BASE_URL。
 */
(function () {
  "use strict";

  var isLocal =
    location.protocol === "file:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  window.TASK_API_CONFIG = {
    // 本地开发直接指向 Flask；线上换成公网 API 地址。
    // 当前公网 API 由 localhost.run 隧道暴露，换地址时只改这一行。
    baseUrl: isLocal
      ? "http://127.0.0.1:5000"
      : "https://listen-land-instantly-plugins.trycloudflare.com",
    timeoutMs: 8000
  };

  // 允许部署平台在页面里注入地址，优先级最高。
  if (window.TASK_API_BASE_URL) {
    window.TASK_API_CONFIG.baseUrl = window.TASK_API_BASE_URL;
  }
})();
