'use strict';
// Scope and accessibility fixes: period labels, chart scope, stale rows,
// focus visibility, text contrast and Chinese lifecycle wording. All checks
// run against the real inline application code with a fixed clock; no Hub.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
const { installFixedClock } = require('./helpers/fixed-clock.cjs');

process.env.TZ = 'UTC';
const NOW = Date.parse('2026-11-10T00:00:00Z');
const FILE = join(__dirname, '..', 'index.html');
const html = readFileSync(FILE, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const css = html.slice(html.indexOf('<style>') + '<style>'.length, html.indexOf('</style>'));

function app(lang = 'zh') {
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, URL, setTimeout, clearTimeout,
    window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
    document: { getElementById: () => null, addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  const start = script.indexOf('$("gate-form").addEventListener');
  assert.ok(start > 0, 'Missing inline app bootstrap boundary');
  installFixedClock(context, NOW);
  vm.runInContext(script.slice(0, start), context);
  vm.runInContext(`state.lang = ${JSON.stringify(lang)};`, context);
  return {
    run: (expression) => vm.runInContext(expression, context),
    json: (expression) => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context)),
    context,
  };
}

function node() {
  return {
    textContent: '', title: '', hidden: false, open: false, attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
  };
}
// applyStaticLang is the paint path that writes the static hero label.
function staticLang(lang, period = 'today') {
  const a = app(lang);
  const nodes = new Map();
  a.context.document = {
    documentElement: {},
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, node());
      return nodes.get(id);
    },
    addEventListener() {},
  };
  a.run(`state.period = ${JSON.stringify(period)};`);
  a.run('applyStaticLang()');
  return { nodes, run: a.run };
}

// --- 1. Headline period label ---------------------------------------------
test('period tokens label names today, this month and all-time in both languages', () => {
  const expected = {
    zh: { today: '今日 TOKENS', month: '本月 TOKENS', allTime: '累计 TOKENS' },
    en: { today: 'TOKENS TODAY', month: 'TOKENS THIS MONTH', allTime: 'ALL-TIME TOKENS' },
  };
  for (const lang of ['zh', 'en']) {
    const { run } = app(lang);
    for (const period of ['today', 'month', 'allTime']) {
      run(`state.period = ${JSON.stringify(period)};`);
      assert.equal(run('periodTokensLabel()'), expected[lang][period], `${lang} ${period}`);
    }
  }
});

test('home totals and the static hero label follow the selected period', () => {
  const a = app('zh');
  a.run(`state.stats = { periods: {
    today: { totalTokens: 111, costUsd: 1.11 },
    month: { totalTokens: 222, costUsd: 2.22 },
    allTime: { totalTokens: 333, costUsd: 3.33 } } };
    state.period = "month"; state.view = "home";`);
  const home = a.run('renderMain()');
  assert.ok(home.includes('<div class="k">本月 TOKENS</div>'), home.slice(0, 400));
  assert.ok(home.includes('222') && home.includes('$2.22'));

  const { nodes } = staticLang('en', 'allTime');
  assert.equal(nodes.get('hero-k').textContent, 'ALL-TIME TOKENS');
  const zh = staticLang('zh', 'today');
  assert.equal(zh.nodes.get('hero-k').textContent, '今日 TOKENS');
  assert.ok(html.includes('id="hero-k"'), 'the hero label needs a stable id for paint');
});

// --- 2. Limits scope note --------------------------------------------------
test('limits explains that the period selector only changes the headline total', () => {
  const expected = {
    zh: '顶部周期只影响顶部总数；额度显示当前配额窗口。',
    en: 'The period selector only changes the headline total; limits show the current quota windows.',
  };
  for (const lang of ['zh', 'en']) {
    const a = app(lang);
    a.run(`state.stats = { periods: {}, limits: { providers: [] } }; state.period = "month"; state.view = "limits";`);
    const rendered = a.run('renderMain()');
    assert.ok(rendered.includes(`<p class="scope-note">${expected[lang]}</p>`), rendered.slice(0, 300));
    assert.ok(rendered.includes('class="sort"'), 'the limits sort control stays usable');
  }
});

// --- 3. Chart scope --------------------------------------------------------
function dailyRows(prefix, count, start = 1) {
  return Array.from({ length: count }, (_, i) => ({
    date: `${prefix}-${String(start + i).padStart(2, '0')}`, tokens: 100 + i,
  }));
}
function trends(lang, daily, period = 'today') {
  const a = app(lang);
  a.run(`state.stats = { periods: {} }; state.history = { daily: ${JSON.stringify(daily)} };
    state.period = ${JSON.stringify(period)}; state.view = "trends";`);
  return { a, rendered: a.run('renderMain()') };
}

test('monthBars reports the real range and whether the chart stays inside this month', () => {
  const a = app('zh');
  a.run(`state.history = { daily: ${JSON.stringify(dailyRows('2026-11', 10))} };`);
  const month = a.json('(() => { const b = monthBars(); return { firstDate: b.firstDate, lastDate: b.lastDate, fallback: b.fallback, empty: b.empty, monthOnly: b.monthOnly }; })()');
  assert.deepEqual(month, { firstDate: '2026-11-01', lastDate: '2026-11-10', fallback: false, empty: false, monthOnly: true });

  a.run(`state.history = { daily: ${JSON.stringify([...dailyRows('2026-10', 12, 20), ...dailyRows('2026-11', 3)])} };`);
  const cross = a.json('(() => { const b = monthBars(); return { firstDate: b.firstDate, lastDate: b.lastDate, fallback: b.fallback, empty: b.empty, monthOnly: b.monthOnly }; })()');
  assert.deepEqual(cross, { firstDate: '2026-10-20', lastDate: '2026-11-03', fallback: true, empty: false, monthOnly: false });

  a.run(`state.history = { daily: [{ date: "2026-11-10", tokens: 5 }] };`);
  const single = a.json('(() => { const b = monthBars(); return { firstDate: b.firstDate, lastDate: b.lastDate, fallback: b.fallback, empty: b.empty }; })()');
  assert.deepEqual(single, { firstDate: '2026-11-10', lastDate: '2026-11-10', fallback: true, empty: false });

  a.run('state.history = { daily: [] };');
  const empty = a.json('(() => { const b = monthBars(); return { firstDate: b.firstDate, lastDate: b.lastDate, empty: b.empty, bars: b.bars }; })()');
  assert.deepEqual(empty, { firstDate: null, lastDate: null, empty: true, bars: '' });
});

test('trends headings state the actual date range and drop the month claim on fallback', () => {
  const full = trends('zh', dailyRows('2026-11', 10)).rendered;
  assert.ok(full.includes('<div class="chart-h"><span>本月每日</span><span class="range">2026-11-01–2026-11-10</span></div>'), full.slice(0, 400));
  assert.match(full, /role="region" aria-label="本月每日 · 2026-11-01–2026-11-10"/);
  assert.ok(!full.includes('最近每日用量'));

  const cross = trends('zh', [...dailyRows('2026-10', 12, 20), ...dailyRows('2026-11', 3)]).rendered;
  assert.ok(cross.includes('<div class="chart-h"><span>最近每日用量</span><span class="range">2026-10-20–2026-11-03</span></div>'), cross.slice(0, 400));
  assert.match(cross, /aria-label="最近每日用量 · 2026-10-20–2026-11-03"/);
  assert.ok(!cross.includes('本月每日'), 'a cross-month fallback must not be called this month');

  const single = trends('zh', [{ date: '2026-11-10', tokens: 5 }]).rendered;
  assert.ok(single.includes('<span class="range">2026-11-10–2026-11-10</span>'));
  assert.ok(single.includes('<span>本月每日</span>'));

  const empty = trends('zh', []).rendered;
  assert.ok(empty.includes('<span>每日用量</span>'), empty.slice(0, 400));
  assert.ok(empty.includes('暂无每日数据'));
  assert.ok(!/undefined|Invalid Date|NaN/.test(empty));
  assert.ok(!empty.includes('本月每日'));

  const en = trends('en', [...dailyRows('2026-10', 12, 20), ...dailyRows('2026-11', 3)]).rendered;
  assert.ok(en.includes('<span>Recent daily usage</span><span class="range">2026-10-20–2026-11-03</span>'));
});

test('chart scope keeps full dates across years and recognises a current-month-only fallback', () => {
  const { a, rendered } = trends('en', [
    { date: '2025-12-31', tokens: 10 },
    { date: '2026-01-01', tokens: 20 },
  ]);
  assert.ok(rendered.includes('2025-12-31–2026-01-01'), rendered.slice(0, 500));
  assert.match(rendered, /aria-label="Recent daily usage · 2025-12-31–2026-01-01"/);
  a.run('state.history = { daily: [{ date: "2026-11-10", tokens: 5 }] };');
  assert.equal(a.json('monthBars()').monthOnly, true, 'fallback selection can still contain only this month');
  assert.ok(a.run('renderMain()').includes('<span>This month</span>'));
});

test('the chart range and key stay fixed when the headline period changes', () => {
  const daily = [...dailyRows('2026-10', 12, 20), ...dailyRows('2026-11', 3)];
  const snapshots = ['today', 'month', 'allTime'].map((period) => {
    const { rendered } = trends('zh', daily, period);
    return {
      heading: rendered.match(/<div class="chart-h">[\s\S]*?<\/div>/)[0],
      key: rendered.match(/data-chart-key="([^"]*)"/)[1],
      bars: rendered.match(/<div class="chart">([\s\S]*?)<\/div>/)[1],
    };
  });
  assert.equal(snapshots[0].heading, snapshots[1].heading);
  assert.equal(snapshots[1].heading, snapshots[2].heading);
  assert.equal(snapshots[0].key, '2026-11');
  assert.equal(snapshots[0].bars, snapshots[2].bars);
});

// --- 4. Historical activity tiles -----------------------------------------
test('trend tiles are labelled as historical activity, independent of the period selector', () => {
  const expected = {
    zh: {
      title: '历史活动统计',
      note: '优先采用 Hub 历史汇总，不受顶部周期影响；缺少汇总时回退现有每日数据，可能并非完整历史。',
    },
    en: {
      title: 'Historical activity',
      note: 'Uses the Hub history summary when available, independent of the period selector; otherwise falls back to the daily data on hand and may not cover the full history.',
    },
  };
  for (const lang of ['zh', 'en']) {
    const a = app(lang);
    a.run(`state.stats = { periods: {} };
      state.history = { daily: [{ date: "2026-11-10", tokens: 900000, activeTimeMs: 60000 }],
        summary: { activeDays: 0, currentStreak: 0, peakDayTokens: 0, activeTimeMs: 0 } };
      state.view = "trends";`);
    const blocks = ['today', 'month', 'allTime'].map((period) => {
      a.run(`state.period = ${JSON.stringify(period)};`);
      const rendered = a.run('renderMain()');
      return {
        label: rendered.match(/<div class="tiles-h">[\s\S]*?<\/div>/)[0],
        tiles: rendered.slice(rendered.indexOf('<div class="tiles">')),
      };
    });
    for (const block of blocks) {
      assert.ok(block.label.includes(`<span class="title">${expected[lang].title}</span>`), block.label);
      assert.ok(block.label.includes(`<span class="note">${expected[lang].note}</span>`), block.label);
      assert.match(block.tiles, /<div class="tiles">\s*<div class="tile"><div class="v">0<\/div>/);
      assert.ok(block.tiles.includes('<div class="v">0m</div>'), 'zero summary value is a real reading');
    }
    assert.equal(blocks[0].label, blocks[2].label);
    assert.equal(blocks[0].tiles, blocks[2].tiles);
  }
});

// --- 5. Focus visibility and text contrast ---------------------------------
test('text inputs keep a visible keyboard focus ring on the gate and in settings', () => {
  const rule = css.match(/input\[type="text"\]:focus-visible\s*,\s*input\[type="password"\]:focus-visible\s*\{([^}]*)\}/);
  assert.ok(rule, 'missing focus-visible rule for text and password inputs');
  assert.match(rule[1], /outline:\s*2px solid #1a4fbf/);
  assert.match(rule[1], /outline-offset:\s*2px/);
});

test('muted and faint text tokens clear WCAG AA on every page surface', () => {
  function channel(hex, i) { return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255; }
  function lum(hex) {
    const [r, g, b] = [0, 1, 2].map((i) => {
      const c = channel(hex, i);
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function ratio(a, b) {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }
  const token = (name) => {
    const hit = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'));
    assert.ok(hit, `missing --${name}`);
    return hit[1];
  };
  const surfaces = ['#eef0f3', '#f4f5f7', '#e7eaee', '#ffffff'];
  for (const name of ['muted', 'faint']) {
    const value = token(name);
    for (const surface of surfaces) {
      assert.ok(ratio(value, surface) >= 4.5, `--${name} ${value} on ${surface} is ${ratio(value, surface).toFixed(2)}:1`);
    }
  }
});

// --- 6. Stale device rows --------------------------------------------------
test('stale devices keep readable text, a bad status dot and their share', () => {
  for (const lang of ['zh', 'en']) {
    const a = app(lang);
    a.run(`state.stats = { periods: {}, devices: [
      { hostname: "NAS", stale: true, receivedAt: "2026-11-09T23:00:00Z", periods: { today: { totalTokens: 750, costUsd: 1 } } },
      { hostname: "PC", receivedAt: "2026-11-09T23:00:00Z", periods: { today: { totalTokens: 250, costUsd: 9 } } } ] };
      state.period = "today"; state.view = "devices";`);
    const rendered = a.run('renderMain()');
    assert.ok(!rendered.includes('opacity'), 'stale rows must not dim the whole card and its text');
    assert.match(rendered, /<div class="row is-stale" style="flex-wrap:wrap">/);
    assert.ok(rendered.includes('<span class="dot bad"></span>'));
    assert.ok(rendered.includes(lang === 'zh' ? '已过期' : 'stale'));
    assert.ok(rendered.includes('75.0%') && rendered.includes('25.0%'), 'stale rows stay in the denominator');
    assert.ok(rendered.includes('750') && rendered.includes('250'));
  }
});

// --- 7. Chinese lifecycle and updated wording ------------------------------
test('future Chinese resets use 重置 while expiry, mixed and past wording stay honest', () => {
  const a = app('zh');
  a.run(`state.lang = "zh";`);
  const future = '2026-11-10T04:00:00Z';
  const past = '2026-11-09T20:00:00Z';
  assert.equal(a.run(`relReset(${JSON.stringify(future)})`), '重置 4h 0m');
  assert.equal(a.run(`relReset(${JSON.stringify(future)}, "reset")`), '重置 4h 0m');
  assert.equal(a.run(`relReset(${JSON.stringify(future)}, "expiry")`), '到期 4h 0m');
  assert.equal(a.run(`relReset(${JSON.stringify(future)}, "mixed")`), '重置/到期 4h 0m');
  assert.equal(a.run(`relReset(${JSON.stringify(past)})`), '已到重置时间');
  assert.equal(a.run(`relReset(${JSON.stringify(past)}, "expiry")`), '已到期');
  assert.equal(a.run('relReset("not-a-date")'), '');

  const en = app('en');
  assert.equal(en.run(`relReset(${JSON.stringify(future)})`), 'Reset 4h 0m');
  assert.equal(en.run(`relReset(${JSON.stringify(future)}, "expiry")`), 'Expires 4h 0m');
});

test('provider details translate the updated timestamp', () => {
  for (const [lang, expected] of [['zh', '更新于 1 小时前'], ['en', 'Updated 1h ago']]) {
    const a = app(lang);
    const rendered = a.run(`renderProviderDetails({ provider: "codex", updatedAt: "2026-11-09T23:00:00Z", windows: [] }, false)`);
    assert.ok(rendered.includes(expected), rendered.slice(0, 400));
  }
});

// --- 8. Phone hero inset ---------------------------------------------------
test('phone hero uses 16px side insets while desktop keeps 28px', () => {
  const base = css.match(/\.hero \{ padding: ([^;]+); \}/);
  assert.ok(base, 'missing base .hero padding rule');
  assert.equal(base[1], '10px 16px 6px');
  const desktop = css.match(/@media \(min-width: 860px\) \{[\s\S]*?\.hero \{ padding: ([^;]+); \}/);
  assert.ok(desktop, 'missing desktop .hero padding rule');
  assert.equal(desktop[1], '8px 28px 4px');
});
