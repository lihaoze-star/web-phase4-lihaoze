# 任务 1–6 重做验收记录

- 验收时间：2026-11-24
- 环境：Windows / Python 3.12 / Flask / SQLite / DeepSeek
- 后端测试：**33 个 unittest 全部通过**
- 本地演示：<http://127.0.0.1:8000/app.html>

## 任务 1：静态个人站

- 页面：`index.html`、`project.html`、`404.html`
- 响应式：1440 / 375 宽度均无横向溢出
- 交互：项目筛选、移动端菜单、专注计时器、`data/now.json` 的 `fetch`
- 自定义 404 生效
- 线上：<https://lihaoze-star.github.io/web-phase4-lihaoze/>
- 状态：**通过**

## 任务 2：CRUD API

- 路由：`GET /api/tasks`、`GET /api/tasks/:id`、`POST /api/tasks`、`PUT /api/tasks/:id`、`DELETE /api/tasks/:id`
- 校验：`title` 1–80 字、`done` 布尔、ID 404、坏 JSON 400
- 统一信封：`{ code, data, msg }`
- SQLite 持久化：`data/tasks.db`
- 手工验收：创建 → 查单条 → 改 `done` → 删除 → 列表恢复
- 自动测试：33 个通过
- 状态：**通过**

## 任务 3：前后端联调

- 页面：`tasks.html`
- 调用真实 API，不使用前端假数组
- 加载中 / 空列表 / 请求失败三种状态
- 失败可重试；新增、删除、勾选完成后重新拉取列表
- API 地址集中在 `js/config.js`
- CORS 在 Flask `after_request` 统一加
- 本地验收：已读取 3 条任务，无控制台报错
- 状态：**通过（本地）**

## 任务 4：流式对话

- 页面：`chat.html`
- DeepSeek SSE 逐字输出；三轮上下文；`MAX_CONTEXT_CHARS=6000` 截断
- 停止生成、重试、清空、可读错误
- Key 只在服务端 `.env`，`.gitignore` 生效
- 实测：`只回答两个字母：OK` → `OK`，`done` 正常
- 录屏：`docs/demo.mp4`
- 状态：**通过（本地）**

## 任务 5：工具调用

- 工具：`add_item`、`query_items`
- 完整链路：模型返回 `tool_calls` → Flask 执行 SQLite → `role=tool` 回填 → 模型总结
- 前端工具日志显示工具名、参数、成功/失败、结果摘要
- 工具执行后左侧列表自动刷新
- 实测：查未完成任务 → `query_items({"status":"todo"})`，返回 2 条
- 失败案例：`content` / `title` 字段不一致，工具日志红色；修复后同句话成功
- 状态：**通过（本地）**

## 任务 6：整合交付

- 整合页：`app.html`，任务清单 + AI + 工具日志同屏
- 一套 Flask API、一个 `tasks.db`、一个 DeepSeek 工具能力
- README：项目简介、技术栈、本地运行、环境变量、截图、已知问题、目录结构
- 2 分钟演示：`docs/demo.mp4`
- 本地验收：能读取 3 条任务，AI 工具调用正常
- 状态：**本地通过**

## 在线地址说明

GitHub Pages 只能托管静态前端，Flask + SQLite 必须运行在电脑或云服务器上。

当前网络阻断了 Cloudflare 隧道出站端口（TCP 7844），临时公网地址不稳定；因此验收演示优先使用本地：

```text
http://127.0.0.1:8000/app.html
```

长期在线需把 `web-phase4-api-lihaoze` 部署到 Render / Railway，并把 `js/config.js` 的线上地址改为部署后的 HTTPS 域名。

## 当前可验收入口

| 内容 | 地址 |
| --- | --- |
| 整合应用（本地） | <http://127.0.0.1:8000/app.html> |
| 任务页（本地） | <http://127.0.0.1:8000/tasks.html> |
| 对话页（本地） | <http://127.0.0.1:8000/chat.html> |
| 前端仓库 | <https://github.com/lihaoze-star/web-phase4-lihaoze> |
| 后端仓库 | <https://github.com/lihaoze-star/web-phase4-api-lihaoze> |
| 2 分钟演示 | <https://lihaoze-star.github.io/web-phase4-lihaoze/docs/demo.mp4> |
