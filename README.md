<p align="right">
   <strong>EN</strong> | <a href="./README.zh-CN.md">简</a>
</p>

# Token Monitor Web

<p align="center">
   <em>A read-only web client for your self-hosted Token Monitor hub.</em>
</p>

<p align="center">
   <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-A855F7?style=flat-square" alt="License: MIT" /></a>
   <a href="https://github.com/Javis603/token-monitor"><img src="https://img.shields.io/badge/companion_to-Token%20Monitor-22c55e?style=flat-square" alt="Companion to Token Monitor" /></a>
</p>

Independent page you open in a browser (phone or desktop) to watch usage that the [Token Monitor](https://github.com/Javis603/token-monitor) desktop app already sends to **your** hub. It is **not** the official app or an official web edition.

## What is this?

Token Monitor runs on your computers: it reads local tool logs and, in sync mode, posts summaries to a hub (often a Cloudflare Worker). This repo is a small HTML client for that hub’s HTTP API — home, tools, limits, models, and trends — so you can check the same totals on a phone without installing the desktop widget.

It does not scrape logs, does not talk to model providers, and does not send telemetry to the authors of this page. The only network call is from your browser to the hub URL you type in.

## Prerequisites

1. [Token Monitor](https://github.com/Javis603/token-monitor) on at least one machine, with **Multi-device Sync** pointed at a hub.
2. That hub reachable over HTTPS (the usual choice is the Cloudflare Worker in the upstream `worker/` directory).
3. The same shared secret you set as `TOKEN_MONITOR_SECRET` on the hub and in the desktop widget.

## Quick start

Do not open `index.html` as `file://` — most browsers will block the request to the hub.

```bash
git clone https://github.com/AgathonLi/token-monitor-web.git
cd token-monitor-web
python -m http.server 8765
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/). Enter:

- **Hub URL** — `https://token-monitor-hub.<your-subdomain>.workers.dev` (no `/api/...` path)
- **Secret** — the same string as the desktop widget

The secret is stored only in this browser’s `localStorage`. Requests use `Authorization: Bearer <secret>`. After you change the page, use Ctrl+F5 if it looks stale.

A hosted copy is at [https://agathonli.github.io/token-monitor-web/](https://agathonli.github.io/token-monitor-web/) (GitHub Pages, `main` / repository root). Enter the Hub URL and secret there; they stay in that browser’s `localStorage` and are not in this repo. On a phone, open that HTTPS page and use “Add to Home Screen”. You can also host `index.html` on any other static HTTPS origin.

## Views

The layout is the same on phone and desktop (light, no floating phone card). Below 860px the header wraps and tabs scroll; from 860px it uses a two-column home. Use EN/中 in the header. List views sort by tokens, cost, or name. The time under the totals is the latest device `receivedAt` (last ingest to the hub), not the page fetch.

| Control | What it shows |
|---|---|
| **DAY / MONTH / TOTAL** | Which period the headline tokens, cost, tools, and models use |
| **Home** | Compact limits, top models, activity heatmap |
| **Tools** | Per-client tokens, cost, and share |
| **Limits** | Provider quota windows (session / weekly / …) |
| **Models** | Per-model tokens, cost, and share |
| **Devices** | Per-machine tokens, cost, and live/stale sync |
| **Trends** | Daily bars plus active days, streak, active time, peak day |

Fields the hub JSON does not send (plan labels such as Plus/Pro, OAuth vs Web, and so on) stay blank. Session-by-session transcripts never leave the desktop app.

## Privacy

- No account on this project. Nothing is uploaded to GitHub or to the page author.
- The shared hub secret never belongs in this repository. Keep it in the browser, the widget, and Cloudflare Secrets.
- Usage data lives on your hub. Anyone with the URL still needs the secret to read `/api/stats`.

## Acknowledgments

- [Token Monitor](https://github.com/Javis603/token-monitor) by [@Javis](https://github.com/Javis603) — desktop widget, hub protocol, and the UI this client follows.
- Hub endpoints used here: `GET /api/stats`, `GET /api/history` (see upstream `docs/API.md` and `worker/README.md`).

## License

[MIT](LICENSE). Copyright © 2026 Agathon. Token Monitor copyright © 2026 Javis. Keep both copyright notices and the permission text when you redistribute.

Conventions for coding agents are in [AGENTS.md](AGENTS.md).
