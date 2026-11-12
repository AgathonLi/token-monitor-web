<p align="right">
   <strong>EN</strong> | <a href="./README.zh-CN.md">简</a>
</p>

<p align="center">
   <img src="./assets/logo.svg?v=bplus-20261102" width="96" height="96" alt="Token Monitor Web logo" />
</p>

<h1 align="center">Token Monitor Web</h1>

<p align="center">
   <em>A read-only web client for your self-hosted Token Monitor hub.</em>
</p>

<p align="center">
   <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-A855F7?style=flat-square" alt="License: MIT" /></a>
   <a href="https://github.com/Javis603/token-monitor"><img src="https://img.shields.io/badge/companion_to-Token%20Monitor-22c55e?style=flat-square" alt="Companion to Token Monitor" /></a>
</p>

An independent, read-only browser client for your [Token Monitor](https://github.com/Javis603/token-monitor) Hub. Check usage, costs and quotas on a phone or desktop. This is **not** the official app or an official web edition; it does not collect local logs or connect to model providers.

## Get started

You need a Token Monitor Hub that already receives usage data, its base URL, and its shared secret. Set up collection and the Hub separately; this page only displays the data. If the page and Hub use different origins, the Hub must allow cross-origin requests (CORS).

### Use the hosted page

1. Open **[Token Monitor Web](https://t-monitor.uuui.uk/)**.
2. Enter your **Hub URL** (without an `/api/...` suffix) and **shared secret**.
3. On a phone, you can use the browser's **Add to Home Screen** option.

The hosted page needs an HTTPS Hub.

### Run locally or self-host

With Git and Python 3 installed (use `python3` below if that is your system's command):

```bash
git clone https://github.com/AgathonLi/token-monitor-web.git
cd token-monitor-web
python -m http.server 8765 --bind 127.0.0.1
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/) and enter the same Hub details. Do not open `index.html` directly as `file://`. You can also serve the repository from a static HTTPS host; no build step is needed.

## Views

Use **DAY / MONTH / TOTAL** to select the usage period, and **EN/中** to change language.

| View | What it shows |
|---|---|
| **Home** | Usage totals, selected quota summaries, top models and activity |
| **Limits** | Current provider quota windows and balances |
| **Models** | Per-model tokens, costs and usage shares; smaller entries expand under other models |
| **Tools** | Usage and costs by client |
| **Devices** | Usage and sync status by device |
| **Sessions** | Supplied session summaries with tool filtering |
| **Trends** | Daily usage in millions of tokens (M) and activity statistics |

## Common controls

- **Gear → Display**: choose and reorder the quota accounts shown on Home. Preferences stay in the current browser, separately for each Hub. **Connection** manages the Hub URL and secret.
- **Quota information icon**: hover or focus for a preview; click or tap to keep details open. Close with the close button, Escape, or an outside press.
- **Sessions**: use the tool buttons to filter, **Load more** for additional records, and expand a row to see its full details. A focused row also opens with Enter or Space. Filtering does not change the headline total.

## Data and privacy

- The period selector changes usage totals and lists, not the current quota windows. Trends follows its own labeled date range; available history may be incomplete.
- The update time reflects the latest device submission to the Hub, not the page fetch.
- Fields and session details depend on what the Hub supplies. Session titles require permission on both the Hub and sending device; this page does not enable title synchronization or display conversation messages. Unavailable TOTAL session details are not replaced with monthly records.
- The percentage beside session calls is **cache hit**, not token share.
- The Hub URL and secret are saved in this browser's `localStorage`. Usage requests go directly to your Hub; no usage data is uploaded to GitHub or the page authors.
- Account emails are partially masked in the interface. This is display masking, not removal of the raw data from Hub responses or browser memory.

## Acknowledgments and license

[Token Monitor](https://github.com/Javis603/token-monitor) by [@Javis](https://github.com/Javis603) provides the desktop app, Hub protocol and the UI this client follows.

[MIT](LICENSE). Copyright © 2026 Agathon. Token Monitor copyright © 2026 Javis. Keep both copyright notices and the permission text when redistributing.
