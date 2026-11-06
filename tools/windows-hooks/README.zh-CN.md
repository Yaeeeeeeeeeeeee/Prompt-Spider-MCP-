# Prompt Spider：Windows 用户级 Codex Hooks

当前交付是安装包，不是已在你的 Windows 上完成安装。制作/测试环境为 Linux，Codex CLI 0.166.0-alpha.1，`codex features list` 显示 hooks stable / true。未访问 Windows 用户文件，未设置 Token，未向 Worker 发送真实事件。本目录提供可下载分发文件，不包含 Windows 用户配置或 Token。

## 安装

1. 把整个安装包下载并解压到 Windows 本地目录，例如 `C:\Tools\prompt-spider-windows`。需要现有 Python 3 和支持 Lifecycle Hooks、commandWindows、异步及 Hooks 信任审查的 Codex CLI。无需第三方 Python 包；不支持旧版 notify 的静默替代。
2. 先关闭所有本地 Codex 会话。在 PowerShell 中切换到解压目录，执行：

```powershell
python --version
codex --version
codex features list
python -m unittest discover -v
python .\install_windows.py
```

若 `python` 不存在但有 Python Launcher，可将安装命令中的 `python` 替换为 `py -3`。安装器会把该解释器的绝对路径写入 commandWindows。后续更换解释器路径时须人工审查现有配置。

安装器在 Windows 上检查 Codex CLI 是否提供 Hooks 信任能力；这不等同于证明你的特定版本支持所有事件。务必检查 `codex features list`、启动警告和 Hooks 审查列表。若 hooks 被关闭或组织策略 `allow_managed_hooks_only` 禁止用户 Hooks，应先由你/管理员审查配置；本安装器不会更改权限、策略或功能开关。

默认目标是 `%USERPROFILE%\.codex`；若进程已设置 CODEX_HOME，则使用该目录。可显式指定 `python .\install_windows.py --codex-home 'C:\实际路径\.codex'`。同一 Windows 用户下，共享该 Codex home 的所有本地项目均会使用此配置，无需逐项目安装。WSL、SSH/远端 Codex、不同 CODEX_HOME 和 Codex 网页云任务不因此自动安装。

安装前：读取并解析已有 hooks.json；已有文件无效则停止；不同的同名 sender 不会覆盖；相关路径是符号链接时停止。已有 config.toml 和 hooks 目录会检查存在性，原 config.toml 原样备份且从不修改；原 hooks.json 和原 sender（若有）按原字节保存。其他脚本完全不动，不打印配置内容。

新增 Hooks 追加在原事件组末尾，保持已有组/处理器索引及内容；完全相同的安装不会重复追加。若存在不同版本的 Prompt Spider 处理器则停止，避免重复发送。备份目录：`.codex\prompt-spider-backups\时间戳\`。备份可能包含你的原有敏感配置，保留在本机，不上传或提交 Git。

## 配置 Token（只在 Windows 上做）

打开 Windows「编辑账户的环境变量」，在当前用户变量中新增 `SPIDER_INGEST_TOKEN`，值填入与你的 Worker Secret 一致的已有凭据。不要将值粘贴到聊天、脚本、hooks.json、终端命令历史或 Git。安装器不创建或索取 Token。

重启终端和 Codex。发送程序优先读进程环境变量，若缺失则只在 Windows 读取当前用户 `HKCU\Environment` 中的同名用户变量；不写注册表、不打印值。检查：

```powershell
python "$env:USERPROFILE\.codex\hooks\prompt_spider_sender.py" --check-token
```

若你使用自定义 CODEX_HOME，替换脚本路径。输出只会显示 present / missing。

## 审查并信任

正常运行 `codex`，不要使用任何跳过 Hook 信任的参数。支持的版本会出现 `Hooks need review`，选择 `Review hooks`，逐项核实来源为你的用户 hooks.json，Windows 命令只调用已安装 Python 和 sender。确认内容后在界面中显式信任新增处理器；保留原有处理器状态。也可在支持该命令的交互版本中使用 `/hooks` 查看状态。

不要盲目选 Trust all：列表可能还有你原来的其他未审查 Hooks。首次审查前的 SessionStart 可能尚未发送；信任后退出再启动一次进行真实验证。若没有上述界面或出现未知字段/事件警告，先检查本机版本；本包不预写 trusted_hash、不跳过信任审查，也不修改 config.toml 的权限规则。

## 事件与隐私

请求固定发到 `https://prompt-spider-api.tohsakarin2018.workers.dev/api/events`，TLS 证书验证保持开启，遵循标准库默认代理设置；禁止自动跟随重定向，以免 Bearer Token 被转发到其他地址。

Body 严格只有 event / project。project 取 Hook cwd 所在 Git 根目录的名称，Git 不可用则取 cwd 目录名称。路径、Git 远程、Prompt、transcript、源码、工具入参/输出、Token 均不进入请求体。项目目录名称本身按需求会外发。

| Hook | event |
|---|---|
| SessionStart / startup、clear | session_started |
| SessionStart / resume、compact | session_resumed |
| UserPromptSubmit | prompt_submitted |
| PermissionRequest | waiting_confirmation |
| PreToolUse / apply_patch | code_edit_started |
| PostToolUse / apply_patch | code_edit_completed |
| PreToolUse / Bash、shell、shell_command、exec_command | command_started 或 test_started |
| PostToolUse / 上述命令工具 | command_completed 或 test_command_finished |
| PostModelRequest / completed、failed、cancelled | model_request_completed、model_request_failed、model_request_cancelled |
| Stop | turn_stopped |
| Interrupt | turn_interrupted |
| SessionEnd | session_ended |

有意给模型请求事件加 model_request_ 前缀，避免与整项任务状态混淆。本包没有 task_completed 事件，不推断任务成败。turn_stopped 不等于任务完成，test_command_finished 不等于测试通过，code_edit_completed 表示工具返回，不保证修改正确。异步 exec_command 返回会话 ID 时也不代表子进程退出。

测试命令只在本地按首个调用识别（pytest、python -m pytest、npm test、npm run test、vitest、jest、cargo/go/dotnet test 等）。不解析任意 shell 包装、别名或复合命令；识别不出的仍只报 command_*，不上传命令。不会为了发现测试而执行命令。未监听的工具不会上报。

普通事件 async=true；SessionEnd async=false，Hook timeout=3 秒，网络 socket timeout=1.2 秒，Git 查根最多 0.4 秒。Hook 本身没有重试或持久队列，失败可丢事件，不保证送达或顺序；SessionEnd 有最长 3 秒的同步等待上限。网络异常或缺少 Token 时普通 Hook 静默返回 0，不产生任何权限/控制指令。--probe 是仅供人工检查的模式，失败会返回 1 并显示固定诊断标签，不打印 Token/响应内容。

## 模拟及真实验证

无网络模拟（不会发送）——在 Windows 项目目录运行：

```powershell
$sender = "$env:USERPROFILE\.codex\hooks\prompt_spider_sender.py"
@{hook_event_name='UserPromptSubmit'; cwd=(Get-Location).Path; prompt='本地测试，不上传'} | ConvertTo-Json -Compress | python $sender --dry-run
```

应只输出类似 `{"event":"prompt_submitted","project":"项目名"}`。

Token 配好后，先人工探测发送程序（此步骤会真实向现有 Worker 写入一条 turn_stopped 事件，并不证明 Hooks 自动触发）：

```powershell
@{hook_event_name='Stop'; cwd=(Get-Location).Path} | ConvertTo-Json -Compress | python $sender --probe
$LASTEXITCODE
```

只有 Worker 返回 HTTP 202 才显示 `{"delivery":"accepted"}` 并返回 0；缺少 Token 显示 missing_token 并返回 1。HTTP/网络错误只显示 network_or_http_error，其他状态显示 unexpected_status。该探测不读取响应 JSON，因此 accepted 只证明 HTTP 202，持久化要用 D1 验证。

然后验证自动 Hooks：

1. 审查信任后，重新在项目 A 中启动本地 Codex，提交一条无敏感信息的提示，观察启动/提示/停止事件。
2. 让 Codex 在你允许的范围内实际调用一次必要的命令工具、测试工具或 apply_patch；仅仅让它回复文本不会触发工具事件。不同客户端和工具版本可能使用不同名称，以本机 Hooks 列表及日志为准。
3. 退出会话验证 SessionEnd；恢复会话验证 session_resumed。PermissionRequest 只会在真实出现权限请求时发生，不为测试改变权限策略。
4. 在另一个现有本地项目 B 中重复启动和提交，验证无需项目级配置即可按不同 project 归类。
5. 在 Cloudflare D1 控制台先执行只读 `PRAGMA table_info(events);` 确认真实列名；若确有 event、project 列，可在测试前后分别执行：

```sql
SELECT event, project, COUNT(*) AS event_count
FROM events
WHERE project IN ('项目A目录名', '项目B目录名')
GROUP BY event, project;
```

对比计数增加，并按实际时间列查询新记录（本包不假定 timestamp/created_at 或 rowid 的结构）。只有实际 D1 新记录才能验证端到端持久化。本包未修改 Worker、D1 表结构或建设看板。

## 回滚

先退出所有 Codex 会话。用安装时输出的完整备份目录：

```powershell
python .\install_windows.py --rollback 'C:\Users\你的账户\.codex\prompt-spider-backups\实际时间戳'
```

回滚会检查目标文件仍与安装完成时一致；如之后有编辑，将停止，避免抹掉后续改动。恢复原 hooks.json 和原 sender；原来不存在的文件会删除。config.toml 不自动恢复（Codex 可能在里面记录了新的信任状态）。未使用的信任状态可保留，不会独立执行 Hook；若要清理，请在 Codex 中审查。备份保留，不自动删除。

## 已完成验证与限制

Linux 上 11 项标准库 unittest 通过；包括隐私字段白名单、工具/生命周期映射、请求构造、网络失败、缺 Token、拒绝重定向、已有 Hook 保留、备份回滚和后续编辑保护。Python 语法检查通过。生成的 hooks.example.json 格式检查通过。Windows shell 执行、注册表读取、实际用户配置合并、交互信任及 Worker/D1 持久化尚须 Windows 现场验证。

官方依据（检查于 2026-11-05）：
- https://github.com/openai/codex/blob/main/codex-rs/protocol/src/hooks.rs （commandWindows、timeout、async）
- https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/discovery.rs （全局发现、信任、SessionEnd 同步限制）
- https://github.com/openai/codex/blob/main/codex-rs/hooks/src/events/model_request.rs （单次模型请求状态）
- https://github.com/openai/codex/blob/main/codex-rs/tui/src/startup_hooks_review.rs （官方审查流程）

main 分支会变化；云端检测结果不代表你本机安装版本。安装前以本机实际能力为准。
