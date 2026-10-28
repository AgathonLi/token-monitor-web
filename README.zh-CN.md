<p align="right">
   <a href="./README.md">EN</a> | <strong>简</strong>
</p>

<p align="center">
   <img src="./assets/logo.svg" width="96" height="96" alt="Token Monitor Web 图标" />
</p>

<h1 align="center">Token Monitor Web</h1>

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

密钥只存在这台浏览器的 `localStorage`。请求使用 `Authorization: Bearer <密钥>`。改完页面后若看到旧稿，请 Ctrl+F5。

线上副本：[https://agathonli.github.io/token-monitor-web/](https://agathonli.github.io/token-monitor-web/)（GitHub Pages，`main` 仓库根目录）。在页面里填 Hub 地址和密钥，只存在该浏览器的 `localStorage`，不会进仓库。手机打开该 HTTPS 页后可「添加到主屏幕」。也可以把 `index.html` 放到其他静态 HTTPS 托管。

## 界面

手机和电脑同一套浅色页面，没有悬浮圆角手机框。860px 以下顶栏折行、选项卡可横滑；以上主页两列。顶栏可切换 EN/中。列表可按用量、成本、名称排序。标题下显示各设备最近一次提交到 Hub 的时间（设备 `receivedAt`），不是网页拉取时间。

| 控件 | 内容 |
|---|---|
| **DAY / MONTH / TOTAL** | 标题 tokens、成本、工具、模型与设备所用的时间范围；默认 DAY |
| **主页** | 额度摘要、主要模型、活动热力图 |
| **工具** | 按客户端的 tokens、成本与占比 |
| **额度** | 各提供方配额窗口（session / weekly / …），默认按名称升序 |
| **模型** | 按模型的 tokens、成本与占比 |
| **设备** | 各设备 tokens、占比、成本与同步是否过期 |
| **趋势** | 标注百万 tokens（M）约数的每日柱状图，以及活跃天数、连续、活跃时间、峰值日 |

工具、模型和设备列表的占比，以当前所选周期内同类 token 总量为分母，保留一位小数（非零但不足 `0.1%` 显示 `<0.1%`）。趋势柱顶按整数百万显示约数（非零但不足百万显示 `<1M`，零用量显示 `0M`）；悬停可查看完整日期和精确 token 数。窄屏下可横向滚动图表，查看每一天。

额度卡片分别显示 Hub 提供的账号标识、套餐与认证来源。860px 以下每行一张卡片，860px 起两张，1280px 起四张；宽屏四列时，卡片内的额度窗口纵向排列以保持可读。New API 账号适配器显示已上报的今日／本月支出，其余已提供周期可展开查看。包含点数、购买余额与支出分别显示；缺失值留空，不从另一项余额推算。

当相关数据已到达 Hub 时，网页可识别 Muse Code 与 OmO Native 的名称和图标；启用采集、更新 Hub 聚合是独立于本只读网页的工作。Hub JSON 未提供的字段会留空，本客户端不展示逐条 session 原文。

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
