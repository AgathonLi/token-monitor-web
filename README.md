# Token Monitor Web

独立、只读的网页客户端：在浏览器里看自建 [Token Monitor](https://github.com/Javis603/token-monitor) Hub 的用量。

**不是**官方应用或官方网页版，也**不修改** `AgathonLi/token-monitor` fork。界面与 Hub HTTP API 来自上游项目；本仓库代码按 **MIT** 发布，并保留上游版权声明（见 `LICENSE`）。

## 阅读顺序

1. 本文件（事实源）
2. `logs/` 最新一篇（进度与决定）
3. `index.html`（当前界面）
4. `versions/`（已冻结的历史快照，不要直接改）

## 运行

不要用 `file://`（跨域 `fetch` 可能被拦）。

```bash
cd "C:/Users/Agathon/OneDrive/AI_Workspace/Agathon/Token Monitor Web"
python -m http.server 8765
```

打开 `http://127.0.0.1:8765/`，Ctrl+F5 避免缓存。

首次填写：

- Hub URL：`https://token-monitor-hub.<子域>.workers.dev`（不要加 `/api/...`）
- 密钥：与 Worker `TOKEN_MONITOR_SECRET`、桌面小部件同一串

密钥只存在该浏览器 `localStorage`（键 `tm-dash-v1`），请求走 `Authorization: Bearer`。

手机：把 `index.html` 放到任意 HTTPS 静态托管（如 Cloudflare Pages），再「添加到主屏幕」。

## 界面

浅色小组件风格（对齐桌面 Token Monitor 截图）：

- 顶栏：Σ、DAY / MONTH / TOTAL
- 底栏：主页 / 工具 / 额度 / 模型 / 趋势 + 设置
- 电脑上居中约 430px，与手机同一套布局

数据：`GET /api/stats`、`GET /api/history`。Hub JSON 没有的字段（计划名 Plus/Pro、OAuth/Web 等）对应位置为空。

## 版本与日志

| 路径 | 用途 |
|---|---|
| `index.html` | 当前开发稿 |
| `versions/YYYY-MM-DD-简述.html` | 冻结快照，只增不改 |
| `logs/YYYY-MM-DD.md` | 开发日志：做了什么、为什么、未决 |

发版或大改界面后：先把当时的 `index.html` 复制进 `versions/`，再在 `logs/` 记一笔。

## 许可证

[MIT](LICENSE)。本仓库版权 © 2026 Agathon；Token Monitor 原项目版权 © 2026 Javis。再分发时须原样保留 `LICENSE` 中的版权与许可声明。

上游：https://github.com/Javis603/token-monitor

## 公开仓库

本项目按 **public** 维护。可以进 git 的只有源码与脱敏文档。密钥、真实 `*.workers.dev` 子域、Cloudflare token 只留在浏览器 / 控制台。

## 红线

- 不要把密钥、真实 Hub 地址写进仓库或 HTML
- 不要为了看板去改 `token-monitor` fork 的 `main`（跟上游快进会冲突）
- 不要把本项目表述成官方 Token Monitor
- 改 Hub / Cloudflare / 桌面应用配置须先确认
