# 抓包记录 / Network Log

- 采集时间：2026/11/13 10:19:51（Asia/Shanghai）
- 采集环境：Microsoft Edge 157（headless），本地 `http://127.0.0.1:8000`
- 采集方式：Chrome DevTools Protocol 的 Network 域（等价于 DevTools → Network 面板，F12）
- 页面：首页 `index.html`，1440 × 1000

## 3 条核心请求

| 请求 | 路径 | 方法 | 状态码 | 耗时 | 传输大小 |
| --- | --- | --- | --- | --- | --- |
| 页面主文档 | `/` | GET | 200 | 8 ms | 13.4 KB |
| 样式表 | `/css/style.css` | GET | 200 | 22 ms | 39.7 KB |
| 脚本 | `/js/main.js` | GET | 200 | 27 ms | 5.3 KB |
| 自己写的 fetch | `/data/now.json` | GET | 200 | 5 ms | 0.4 KB |

> 作业要求记录 3 条：主文档、一个 CSS 或 JS、一次自己写的 `fetch`。这里把 CSS 和 JS 都列出来，所以核心记录实际是 4 条。`fetch` 读取 `data/now.json`，用于更新「现在」卡片。

## 故意 404

| 请求 | 路径 | 方法 | 状态码 | 耗时 | 传输大小 |
| --- | --- | --- | --- | --- | --- |
| 不存在的路径 | `/this-page-does-not-exist.html` | GET | 404 | 7 ms | 3.6 KB |

- 请求 `/this-page-does-not-exist.html` 返回 **404**。
- 页面仍然是自定义的 404 页，而不是服务器默认的错误页；截图见 [404.png](screenshots/404.png)。
- 控制台会出现一条资源 404 的红色提示，这是这次故意请求的预期结果，正常页面没有红色报错。

## 怎么复现

1. 在项目目录运行 `python serve.py`。
2. 打开 <http://127.0.0.1:8000/>，按 F12 进入 **Network** 面板，刷新页面。
3. 找到 `index.html`、`css/style.css`、`js/main.js`、`data/now.json`，对照上面的方法 / 状态码 / 耗时。
4. 地址栏访问 <http://127.0.0.1:8000/this-page-does-not-exist.html>，看 404 响应和自定义错误页。

原始事件数据在 [network-capture.json](network-capture.json)。
