# Prompt Spider Cloud V1

独立的 Cloudflare Workers **远程 MCP Server**，使用官方 SDK 的 HTTPS / MCP Streamable HTTP，与原版蜘蛛可视化和 D1 持久会话集成。

**当前交付状态：独立远程 MCP 已生产部署。** [仪表盘](https://prompt-spider-mcp.tohsakarin2018.workers.dev/) · [MCP入口](https://prompt-spider-mcp.tohsakarin2018.workers.dev/mcp) · [完整部署/备份/回滚报告](docs/production-deployment-2026-11-11.md)。2026-11-11 的全新官方 D1 备份和隔离恢复、全部部署前检查、41项真实生产SDK验收及17项可控版本回滚检查均通过。原生产Worker及原2条事件记录保留。当前已启用独立Bearer鉴权；ChatGPT OAuth仍待准确回调和独立批准凭据，不能把SDK通过等同于真实ChatGPT登录通过。

## 架构与已有资源

- 新 Worker 固定命名 `prompt-spider-mcp`，远程入口 `/mcp`，同源看板 `/`。
- 复用已有 `prompt-spider-db`，binding `DB`；只新增表/索引。
- 已有 `prompt-spider-api` 的代码、配置、接口、Secret 和 `events(request_id,event,project,received_at)` 不做修改。历史数据保留。
- ChatGPT 通过可发现的 OAuth + PKCE 连接；Codex 可用独立 MCP Bearer 或 OAuth。二者访问同一 D1 会话。MCP 凭据不得复用原事件上报 Token。
- 本地原版 STDIO MCP 完整保留为回退；Windows Hooks 和项目 Cloud 上报脚本是额外的可选采集方式，不是最终安装前提，也不假称存在覆盖所有 Codex Web 项目的全局 Hooks。

## 原版功能复用

上游为 [Kirito14IT/prompt-spider-ui](https://github.com/Kirito14IT/prompt-spider-ui)，固定 revision `24a5db96fff2579baaa6fefce7d7051a929a8d57`，MIT，Copyright (c) 2026 Kirito14IT。使用原版蜘蛛 Canvas 绘制、SessionStore、配置、回放校验/聚合逻辑，保留许可证与署名；未分发参考视频。参见 [出处](vendor/prompt-spider-ui/UPSTREAM.md)、[MIT 原文](vendor/prompt-spider-ui/LICENSE)、[审计说明](docs/research.md)。

迁移的 11 个工具：

| 会话 | 事件/视图 | 导入导出 |
|---|---|---|
| spider_create_session | spider_update_events | spider_export_session |
| spider_get_session | spider_configure_session | spider_import_session |
| spider_list_sessions | spider_control_playback | spider_export_project |
| spider_close_session | spider_complete_session | |

保留 `spider://guide`、`spider://config`、`spider://replay-format` 及 `spider_report_task` prompt。

云端差异：会话跨请求/重启持久化；关闭为保留数据的 soft close；文件导出变为须鉴权下载的回放 JSON/完整项目文件映射 JSON。不会声称 Worker 可以写入你的 Windows 磁盘。完整限制见 [MCP 文档](docs/mcp.md)。

## 安全与状态语义

- 独立的 MCP、看板只读、Windows/Cloud 写入凭据；碰撞配置拒绝服务。写入凭据不能读看板，OAuth 批准口令也不能直接作为访问令牌。
- 看板凭据只在密码框输入并保存在内存，不进 URL、浏览器存储、HTML 或日志。所有动态内容用安全 DOM；同源访问与 CSP；模拟事件显著标为 SIMULATED。
- 默认哈希项目/运行/节点/任务标识，去掉自定义标签。拒绝 Prompt、命令、源码、工具详情、完整路径等任意内容。显式 public-label 配置只适用于公开安全标签，不解除 Prompt/detail 禁令。
- 请求体限制、严格字段枚举、D1 去重、共享限流、会话更新 CAS、短期 OAuth code/访问凭据、PKCE、防重放和精确回调名单。
- 模型请求、工具结束、测试命令返回或一轮停止不等于任务成功。MCP 仅显式 complete_session 终结会话；可选 V1 事件仅 task_* 终结任务。失联/超时不会自动显示成功。服务端接收时间用于活动判断。

## 开发与自动化验证

需要 Node >=22.16、npm、Python3（可选采集器/部署保护测试），不需要真实生产凭据运行自动化测试。

```sh
npm ci
npm test
npm run test:python
npm run test:cloud
npm run test:ops
npm run test:stdio
npm run test:browser
npm run check:deploy
```

浏览器测试需要 Chromium：默认 `/usr/bin/chromium`，或设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 为你的 Chromium 可执行文件。也可 `npx playwright install chromium` 后设置该路径。浏览器依赖只用于测试。`npm run test:stdio` 经 npm 设置正确的 npm_execpath，避免原版干净导出测试误判非标准 Node 安装路径。

Worker 构建产物 `.build/` 和生成的资源映射均不提交。Wrangler dry-run 使用 `wrangler.local.jsonc` 中的专用本地占位数据库，**不能用于生产部署**。部署保护脚本会根据安全提供的真实 D1 UUID生成临时生产配置。

本机交互开发时，在忽略的 `.dev.vars` 中安全配置本地测试凭据（名字见部署文档；不要使用生产令牌）。先对专用本地数据库运行：

```sh
npx wrangler d1 execute DB --local --config wrangler.local.jsonc --file tests/fixtures/local-base.sql
npx wrangler d1 migrations apply DB --local --config wrangler.local.jsonc
npm run dev
```

`tests/fixtures/local-base.sql` 仅建立空的本地旧表，绝不能用于替换或初始化已有生产数据库。没有测试数据伪装成接入；首次看板显示空状态。

## 部署、接入、回滚

按 [部署文档](docs/deployment.md) 使用自动化工具完成 preflight → 私有备份及 SQLite 完整性验证 → 源码构建/自动测试 → 兼容性检查 → additive migration → 新 Worker 发布 → SDK 冒烟。

- [Codex / ChatGPT MCP 接入](docs/mcp.md)
- [ChatGPT OAuth 配置与撤销](docs/oauth.md)
- [看板行为](docs/dashboard.md)
- [可选两端采集器](docs/collectors.md)
- [实际测试及未完成事项](docs/validation.md)

已配置并验证 Cloudflare 管理权限、账号/D1 标识、四个必要域名及独立 MCP/看板凭据。当前剩余客户端事项：在客户端安全配置同一个 MCP_AUTH_TOKEN；看板使用 SPIDER_READ_TOKEN。若要 ChatGPT OAuth，再配置实际连接器的精确回调地址和独立批准凭据。不要在聊天中提供 Secret 明文。

回滚只回滚新 MCP Worker 版本，保留原 Worker、旧事件和新增数据；首次发布若无旧版本，只在显式参数、部署收据与目标检查通过时停用新 Worker。数据库恢复是另行计划的灾难恢复操作，不能覆盖发布后新数据。私有备份在仓库外保存，不进入 Git。
