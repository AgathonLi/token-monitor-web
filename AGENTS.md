# Token Monitor Web — Agent 工作指针

本文件供会自动加载 `AGENTS.md` 的助手使用。它不是项目事实源。

## 接手时必读（按顺序）

1. `README.md`
2. `LICENSE`
3. `logs/` 里日期最新的一篇
4. 重新核对目录内实际文件，不要只信交接文本

## 刚性红线

- 本仓库**按公开 GitHub 来写**：不要把密钥、真实 Hub 子域、`.env`、带口令的截图写进任何将提交的文件（含 `logs/`、`versions/`、`index.html`）
- 遵守 MIT：保留 `LICENSE` 里 **Agathon** 与 **Javis (Token Monitor)** 两行版权；不要改成专有协议，不要删上游版权
- 对外表述必须是「独立网页客户端」，禁止写成官方 Token Monitor / 官方网页版
- 不要修改 `AgathonLi/token-monitor` fork 的 `main` 来迁就本看板
- 改 Cloudflare / Hub / 桌面 Token Monitor 配置须先确认
- 大改 `index.html` 前先复制到 `versions/`（或打 git tag），并在 `logs/` 记一笔
- 可以、也预期会使用 git；推送默认 **public**。未确认不要 `git init` / `push`（由用户在对话里点头后再做）

## 冲突处理

本文件只做自动注入指针。与 `README.md` / `LICENSE` / `logs/` 冲突时，以后者为准，并先停下询问用户。不要把本文件扩写成第二套规范。
