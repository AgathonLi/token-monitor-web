<p align="right">
   <a href="./README.md">EN</a> | <strong>简</strong>
</p>

<p align="center">
   <img src="./assets/logo.svg?v=bplus-20261102" width="96" height="96" alt="Token Monitor Web 图标" />
</p>

<h1 align="center">Token Monitor Web</h1>

<p align="center">
   <em>给你自己的 Token Monitor Hub 用的只读网页客户端。</em>
</p>

<p align="center">
   <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-A855F7?style=flat-square" alt="许可证：MIT" /></a>
   <a href="https://github.com/Javis603/token-monitor"><img src="https://img.shields.io/badge/companion_to-Token%20Monitor-22c55e?style=flat-square" alt="配合 Token Monitor 使用" /></a>
</p>

为你自己的 [Token Monitor](https://github.com/Javis603/token-monitor) Hub 提供的独立、只读网页客户端，可在手机或电脑上查看用量、费用和额度。这**不是**官方应用或官方网页版，不采集本机日志，也不连接模型厂商。

## 开始使用

你需要一个已经接收用量数据的 Token Monitor Hub、它的基础地址及共享密钥。采集端与 Hub 需另行配置；本页只负责展示。若网页与 Hub 不同源，Hub 需允许跨域请求（CORS）。

### 使用在线页面

1. 打开 **[Token Monitor Web](https://t-monitor.uuui.uk/)**。
2. 填入 **Hub URL**（不要带 `/api/...` 后缀）和**共享密钥**。
3. 手机上可使用浏览器的「**添加到主屏幕**」。

在线页面需要连接 HTTPS Hub。

### 本地运行或自行托管

安装 Git 和 Python 3 后运行（若本机命令为 `python3`，相应替换下方的 `python`）：

```bash
git clone https://github.com/AgathonLi/token-monitor-web.git
cd token-monitor-web
python -m http.server 8765 --bind 127.0.0.1
```

打开 [http://127.0.0.1:8765/](http://127.0.0.1:8765/)，填写相同的 Hub 信息。不要以 `file://` 直接打开 `index.html`。也可将仓库部署到静态 HTTPS 托管，无须构建。

## 主要功能

通过 **DAY / MONTH / TOTAL** 选择用量周期，**EN/中** 切换语言。

| 页面 | 内容 |
|---|---|
| **主页** | 用量总览、所选额度摘要、主要模型与活动 |
| **额度** | 当前提供方的配额窗口与余额 |
| **模型** | 各模型的 tokens、费用与占比；较小条目可在 other models 中展开 |
| **工具** | 按客户端查看用量与费用 |
| **设备** | 各设备用量与同步状态 |
| **会话** | 已提供的会话汇总，支持按工具筛选 |
| **趋势** | 每日用量与活动统计（M 表示百万 tokens） |

## 常用操作

- **齿轮 → 显示**：选择并调整主页额度账号的顺序。偏好仅保存在当前浏览器，按 Hub 分开；「**连接**」管理 Hub 地址与密钥。
- **额度信息图标**：悬停或聚焦可预览，点击可固定打开详情；通过关闭按钮、Escape 或点击外部关闭。
- **会话**：用工具按钮筛选，「**加载更多**」查看后续记录，展开条目查看完整详情；聚焦条目后也可按 Enter 或空格展开。筛选不改变顶部总额。

## 数据与隐私说明

- 周期选择影响用量总数与列表，不改变当前额度窗口。趋势按自身标明的日期范围显示，可用历史不一定完整。
- 更新时间是设备最近提交到 Hub 的时间，不是网页拉取时间。
- 字段和会话明细取决于 Hub 已提供的数据。会话标题需要 Hub 与发送设备分别许可；网页不启用标题同步，也不展示对话正文。TOTAL 会话明细不可用时，不会用本月记录代替。
- 会话 calls 旁的百分比是**缓存命中率**，不是 token 占比。
- Hub 地址与密钥保存在当前浏览器的 `localStorage`。用量请求直接发送到你的 Hub，不向 GitHub 或页面作者上传用量。
- 账号邮箱在界面上部分遮蔽；这只是展示脱敏，不代表 Hub 响应或浏览器内存中的原始数据已被删除。

## 致谢与许可证

[Token Monitor](https://github.com/Javis603/token-monitor)（[@Javis](https://github.com/Javis603)）提供桌面应用、Hub 协议及本客户端所对照的界面。

[MIT](LICENSE)。本仓库版权 © 2026 Agathon；Token Monitor 版权 © 2026 Javis。再分发时请保留两份版权声明与许可全文。
