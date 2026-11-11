# 实际验证结果与交付边界

更新：2026-11-11 的真实生产恢复检查见 [生产报告](production-resume-2026-11-11.md)。以下2026-11-07的凭据缺失状态是当时快照，不代表当前仍缺少变量。

最终验证日期：2026-11-07（Asia/Shanghai）。使用隔离分支 `feature/prompt-spider-cloud-v1`。这里只记录实际执行过的内容；Miniflare/D1、HTTP及浏览器中的 Windows/Cloud 来源记录均为**明确标注的模拟生产者**，不是在用户 Windows 或 ChatGPT 账号中真实自动触发。

| 检查 | 实际结果 |
|---|---|
| Node 后端、鉴权、迁移、MCP、OAuth、状态与 UI 逻辑 | 16 项测试通过 |
| Windows 可选采集器/安装配置保护 | 18 项通过；只在 Linux 执行，未安装 Windows |
| Cloud 可选上报脚本 | 2 项通过 |
| 私有备份、schema碰撞、恢复完整性、部署/回滚保护 | 14 项 Python 测试通过 |
| 原版 STDIO MCP 协议测试 | 3 项通过，包括 5,000 事件及干净独立导出安装 |
| 实际 Chromium +本地 Worker/D1看板 | 21 个检查通过：混合来源、过滤、回放、移动端、断线、鉴权过期、模拟标识；无观测到 JS/CSP 错误 |
| Worker 构建与 Wrangler deploy --dry-run | 通过；仅使用专用本地配置，没有生产上传 |

Node `--test` 子进程在本执行环境曾只报告文件通过，未执行其中断言。因此本项目 runner 使用直接 import 测试模块，并核对实际子测试数量。原版 STDIO 测试直接运行曾因非标准 Node 安装位置无法找到 npm-cli.js；用 `npm run test:stdio` 提供官方测试支持的 npm_execpath 后，未修改原版断言，3项全部通过。

## 真实本地端到端链路

使用官方 MCP SDK客户端通过本地HTTP连接实际workerd：initialize → tools/list（11）→ resources/read → 为windows/cloud分别创建模拟会话 → 相同任务ID重复上报不增计数 → 读取/配置 → 显式完成 → seek → 鉴权下载/导出 → 导入只读回放。D1中原有两条本地fixture历史保持不变。未授权下载、写Token读取、OAuth批准口令冒充访问Token均被拒绝。

OAuth实际本地Worker验证：注册精确回调 → PKCE → 同源一次性批准 → code换短期访问令牌 → 访问/mcp；错误凭据、错误Origin和撤销后的令牌被拒绝。这里只能证明本地实现，没有验证你的真实ChatGPT连接器的回调、登录或刷新。

## 当前外部阻塞

当前云环境没有 Cloudflare API凭据、账号标识、真实D1 UUID、独立MCP和读取凭据。环境配置没有任何Secret绑定或云账号身份。生产原/新Worker域名及Cloudflare API不在当前出站配置内；此前对原Worker /health 的实际请求收到代理CONNECT403、HTTP000，不能据此确认其应用状态。

因此没有完成：生产源码与表结构读取、生产备份、生产迁移/部署、生产D1最终冒烟、实际ChatGPT/Codex远程连接、用户Windows Hooks执行。原生产Worker/D1未被更改。没有现成可访问的生产新看板URL，也不把本地回环地址当作上线链接。

## 解除阻塞的最少操作

1. 通过安全的环境设置/Cloudflare连接提供最小权限管理访问及账号/D1标识；开放 `api.cloudflare.com`、原Worker和新Worker的实际域名，以及导出API返回的私有备份下载目标。不要把凭据贴在聊天中。
2. 安全配置新的独立MCP和看板读取凭据；如需ChatGPT OAuth，提供连接器实际精确HTTPS回调地址及独立批准凭据。无需逐阶段截图或逐项人工验收。

之后自动化脚本会执行schema预检查、仓库外私有备份、SQL隔离恢复与完整性检查、构建测试、非破坏迁移、新Worker部署和最终SDK冒烟。任何备份/schema/权限失败仅阻止对应生产操作。
