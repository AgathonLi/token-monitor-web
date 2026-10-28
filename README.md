<p align="right">
   <strong>EN</strong> | <a href="./README.zh-CN.md">简</a>
</p>

<p align="center">
   <img src="./assets/logo.svg" width="96" height="96" alt="Token Monitor Web logo" />
</p>

<h1 align="center">Token Monitor Web</h1>

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
| **DAY / MONTH / TOTAL** | Which period the headline tokens, cost, tools, models, and devices use; starts on DAY |
| **Home** | Selected quota summaries across the page, top models, activity heatmap |
| **Tools** | Per-client tokens, cost, and share |
| **Limits** | Provider quota windows (session / weekly / …), alphabetically sorted by default |
| **Models** | Per-model tokens, cost, and share; models below 1% fold into other models |
| **Devices** | Per-machine tokens, share, cost, and live/stale sync |
| **Trends** | Daily bars labeled in millions of tokens (M), plus active days, streak, active time, peak day |

Tools, models, and devices show each row's share of its category's token total for the selected period, to one decimal place (`<0.1%` for smaller nonzero shares). Trend labels use rounded whole millions (`<1M` for smaller nonzero usage, `0M` for zero); hover for the full date and exact token count. On narrow screens, the chart initially opens at the latest day; scroll horizontally for history. Refreshes and resizing preserve a historical position, while a view already at the latest edge follows new days. A new calendar month starts at its latest day.

Limits uses equal-height compact cards: one per row below 860px, two from 860px, and four from 1280px. Update age sits beside the provider name; plan and masked account follow below, while authentication source stays in the details. Summaries show at most two readings, taking available periods in 5-hour / weekly / monthly order, with reset information visible. For example, monthly fills the second slot when weekly is absent. Antigravity prioritizes an available Argon reading first, with its true period label, then Gemini's own 5-hour / weekly / monthly windows; it never substitutes Claude/GPT. Only the first two available readings appear in the summary; complete details retain the rest. Missing periods are skipped; unknown readings are not zero. A session or billing window is not relabeled without period evidence. Balance-only subscriptions retain their actual balance/credits summary, also capped at two, instead of fabricated periods.

Hover or focus the top-right information icon for complete readings, or click/tap to keep a details dialog open. Moving within the icon or between its button and the hover preview does not dismiss the preview; leaving both closes it after a short delay. Moving a finger away or scrolling inside the pinned dialog does not close it; press outside, use the close button, or press Escape to dismiss. Touch input does not trigger temporary hover previews. New API account adapters expose supplied period spending in the details. Included credits, purchased balances, and spending remain separate readings; missing values stay blank rather than being inferred from another balance.

Use the top-right gear → **Display** to choose and reorder home subscriptions, select none, or restore the automatic selection. Home places the summary/heatmap above a full-width **Limits** section using the same compact cards and a separate model list. Preferences stay in the current browser, separately for each hub, using opaque account references. Accounts without a unique stable identity remain visible in Limits but cannot be manually followed; missing selections are retained, not replaced by another account. Hub credentials are in the separate **Connection** tab.

On Models, each selected period is grouped independently: after display aliases are combined, models with a token share strictly below 1% appear under **other models**, collapsed by default. The group keeps the exact combined tokens, cost, and share, with the same progress-bar style and comparison scale as the main list. Expand it to see smaller wrapping model chips, without individual bars; hover/focus or tap a chip for exact tokens, period share and cost. Exactly 1% remains in the main list. This is presentation only and does not alter hub data or the home model summary.

Muse Code and OmO Native names and marks are supported when their data reaches the hub; enabling collection or updating hub aggregation is separate from this read-only page. Fields absent from the hub JSON stay blank. Session-by-session transcripts are not displayed by this client.

## Privacy

- No account on this project. Nothing is uploaded to GitHub or to the page author.
- The shared hub secret never belongs in this repository. Keep it in the browser, the widget, and Cloudflare Secrets.
- Usage data lives on your hub. Anyone with the URL still needs the secret to read `/api/stats`.
- Account emails are partially masked in cards, settings, details, and display attributes; hovering does not reveal the original. This is display masking, not redaction of the hub response or browser memory.

## Acknowledgments

- [Token Monitor](https://github.com/Javis603/token-monitor) by [@Javis](https://github.com/Javis603) — desktop widget, hub protocol, and the UI this client follows.
- Hub endpoints used here: `GET /api/stats`, `GET /api/history` (see upstream `docs/API.md` and `worker/README.md`).

## License

[MIT](LICENSE). Copyright © 2026 Agathon. Token Monitor copyright © 2026 Javis. Keep both copyright notices and the permission text when you redistribute.

Conventions for coding agents are in [AGENTS.md](AGENTS.md).
