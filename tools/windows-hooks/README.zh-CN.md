# 可选 Windows Hooks

最终交付是独立远程 MCP Worker，并非 Windows 安装包。使用远程 `/mcp` 的 11 个工具无需安装本目录。完整配置、隐私、事件边界、重试与测试说明见 [collectors](../../docs/collectors.md)。

仅在 Windows 上自愿启用本地 Hooks 时运行 `python install_windows.py`；先检查已有配置并在 Codex 中逐项审查信任。安装器不会自动信任，不修改 config.toml，保留原有处理器并创建备份。

在私有环境变量设置 `SPIDER_WINDOWS_TOKEN` 与 `SPIDER_ENDPOINT=https://新Worker域名/api/events`。不得使用原旧服务的默认地址，本版无默认 endpoint。`python prompt_spider_sender.py --check-token` 仅输出 present/missing。不要在聊天、Git、配置或命令历史中填写 token 值。

`python -m unittest discover -v` 为本地模拟测试；Linux 通过不代表 Windows shell、注册表、交互信任或真实服务端持久化已验证。回滚示例：`python install_windows.py --rollback "备份目录"`；后续被修改的配置会拒绝覆盖。
