<p align="right">
   <a href="./README.md">EN</a> | <strong>简</strong>
</p>

# Token Monitor Web

<p align="center">
   <em>给你自己的 Token Monitor Hub 用的只读网页客户端。</em>
</p>

<p align="center">
   <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-A855F7?style=flat-square" alt="许可证：MIT" /></a>
   <a href="https://github.com/Javis603/token-monitor"><img src="https://img.shields.io/badge/companion_to-Token%20Monitor-22c55e?style=flat-square" alt="配合 Token Monitor 使用" /></a>
</p>

在手机或电脑浏览器里，查看 [Token Monitor](https://github.com/Javis603/token-monitor) 桌面应用已经打到**你自己的** Hub 上的用量。这**不是**官方应用，也不是官方网页版。

## 这是什么？

Token Monitor 跑在你的电脑上：读本机工具日志，同步模式下把汇总发到 Hub（常见是 Cloudflare Worker）。本仓库是那个 Hub HTTP API 的一份小 HTML 客户端——主页、工具、额度、模型、趋势——方便在手机上看同一套数字，而不必安装桌面小部件。

它不采集日志、不访问模型厂商、也不会向本页作者发送遥测。网络请求只有：你的浏览器 → 你填入的 Hub 地址。

## 前置条件

1. 至少一台机器安装了 [Token Monitor](https://github.com/Javis603/token-monitor)，并在**多设备同步**里指向一个 Hub。
2. 该 Hub 可经 HTTPS 访问（通常是上游仓库 `worker/` 目录部署的 Cloudflare Worker）。
3. 与 Hub 上 `TOKEN_MONITOR_SECRET`、桌面小部件相同的共享密钥。

## 快速开始

不要用 `file://` 打开 `index.html`，多数浏览器会拦截对 Hub 的请求。

```bash
git clone https://github.com/AgathonLi/token-monitor-web.git
cd token-monitor-web
python -m http.server 8765
```

打开 [http://127.0.0.1:8765/](http://127.0.0.1:8765/)，填写：

- **Hub URL** — `https://token-monitor-hub.<你的子域>.workers.dev`（不要加 `/api/...`）
- **密钥** — 与桌面小部件同一串

密钥只存在这台浏览器的 `localStorage`。请求使用 `Authorization: Bearer`。页面看起来像缓存时请 Ctrl+F5。

手机上：把 `index.html` 放到任意静态 HTTPS 托管（例如 Cloudflare Pages），再用「添加到主屏幕」。

## 界面

布局跟随桌面小部件（浅色；大屏上居中一列）：

| 控件 | 内容 |
|---|---|
| **DAY / MONTH / TOTAL** | 标题 tokens、成本、工具与模型所用的时间范围 |
| **主页** | 额度摘要、主要模型、活动热力图 |
| **工具** | 按客户端的 tokens、成本与占比 |
| **额度** | 各提供方配额窗口（session / weekly / …） |
| **模型** | 按模型的 tokens、成本与占比 |
| **趋势** | 每日柱状图，以及活跃天数、连续、活跃时间、峰值日 |

Hub JSON 未提供的字段（如 Plus/Pro 计划名、OAuth 与 Web 等）会留空。逐条 session 的原文不会离开桌面应用。

## 隐私

- 本项目没有账号。不会向 GitHub 或页面作者上传用量。
- 共享 Hub 密钥不要出现在本仓库。只放在浏览器、小部件和 Cloudflare Secrets。
- 用量数据在你的 Hub 上。知道 URL 的人仍需要密钥才能读 `/api/stats`。

## 致谢

- [Token Monitor](https://github.com/Javis603/token-monitor)（[@Javis](https://github.com/Javis603)）— 桌面小部件、Hub 协议，以及本客户端所对照的界面。
- 使用的 Hub 端点：`GET /api/stats`、`GET /api/history`（见上游 `docs/API.md` 与 `worker/README.md`）。

## 许可证

[MIT](LICENSE)。本仓库版权 © 2026 Agathon。Token Monitor 版权 © 2026 Javis。再分发时请保留两份版权声明与许可全文。

给编码助手的约定见 [AGENTS.md](AGENTS.md)。
