const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
function app() {
  const context = vm.createContext({
    state: { stats: null, history: null, period: 'today', lang: 'zh', sort: {}, view: 'tools' },
    t: (key) => key,
  });
  for (const [start, end] of [
    ['const META =', 'const WIN_LAB ='],
    ['function esc(', 'function relReset('],
    ['function relAgo(', 'function authLabel('],
    ['function sortDevices(', 'function statsStamp('],
    ['function renderBars(', 'function applyStaticLang('],
  ]) {
    const from = html.indexOf(start);
    const to = html.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Missing helper block: ${start}`);
    vm.runInContext(html.slice(from, to), context);
  }
  return context;
}

test('full tool and model rows show exact tokens and one-decimal token share above cost', () => {
  const ctx = app();
  const period = {
    clients: { deepseek: 7500000, hermes: 2500000 },
    clientCosts: { deepseek: 1, hermes: 9 },
    models: { 'gemini-3.8-flash': 2000000, 'gemini-3.8-flash-n': 3000000, other: 5000000 },
    modelCosts: { other: 5 },
  };
  for (const [rows, expected] of [
    [ctx.entries(period.clients, period.clientCosts), ['7,500,000', '75.0%', '2,500,000', '25.0%']],
    [ctx.modelEntries(period), ['5,000,000', '50.0%']],
  ]) {
    const rendered = ctx.renderBars(rows, false);
    for (const text of expected) assert.ok(rendered.includes(text), `Missing ${text}`);
    const usageLines = [...rendered.matchAll(/class="tok">([^\n]*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]*>/g, ''));
    assert.equal(usageLines.length, rows.length);
    assert.ok(usageLines.every((line) => /^[\d,]+ · [\d.]+%$/.test(line)), usageLines.join('\n'));
    assert.match(rendered, /class="cst">\$/);
  }
});

test('share formatting distinguishes tiny nonzero values from zero', () => {
  const ctx = app();
  for (const [ratio, expected] of [[0, '0.0%'], [1, '100.0%'], [0.00099, '<0.1%'], [0.001, '0.1%'], [1 / 3, '33.3%']]) {
    assert.equal(ctx.fmtShare(ratio), expected);
  }
  assert.ok(ctx.renderBars(ctx.entries({ tiny: 1, large: 99999 }), false).includes('&lt;0.1%'));
});

test('devices use same-period device totals, independent of sorting, stale status and headline totals', () => {
  const ctx = app();
  ctx.state.stats = {
    periods: { today: { totalTokens: 999999999 } },
    devices: [
      { hostname: 'NAS', stale: true, periods: { today: { totalTokens: 750, costUsd: 1 }, month: { totalTokens: 20 }, allTime: { totalTokens: 450 } } },
      { hostname: 'PC', periods: { today: { totalTokens: 250, costUsd: 9 }, month: { totalTokens: 80 }, allTime: { totalTokens: 550 } } },
      { hostname: 'empty', periods: {} },
    ],
  };
  const original = JSON.stringify(ctx.state.stats);
  for (const [period, shares] of [['today', ['75.0%', '25.0%']], ['month', ['20.0%', '80.0%']], ['allTime', ['45.0%', '55.0%']]]) {
    ctx.state.period = period;
    for (const key of ['tokens', 'cost', 'name', 'sync']) {
      ctx.state.sort.devices = { key, dir: 'asc' };
      const rendered = ctx.renderDevices();
      for (const share of [...shares, '0.0%']) assert.ok(rendered.includes(share), `Missing ${share}`);
      assert.ok(!rendered.includes('NaN'));
    }
  }
  assert.equal(JSON.stringify(ctx.state.stats), original);
  ctx.state.stats.devices = [{ periods: { allTime: { totalTokens: 0 } } }, { periods: {} }];
  ctx.state.period = 'allTime';
  assert.equal((ctx.renderDevices().match(/0\.0%/g) || []).length, 2);
});

test('daily bars show rounded million-token labels and exact accessible tooltips', () => {
  const ctx = app();
  ctx.civilYmd = () => '2026-10-28';
  ctx.state.history = { daily: Array.from({ length: 28 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    tokens: [0, 1, 999999, 1000000, 1499999, 1500000, 2500000000][i % 7],
  })) };
  const original = JSON.stringify(ctx.state.history);
  const result = ctx.monthBars();
  const labels = [...result.bars.matchAll(/class="chart-label">([^<]*(?:&lt;[^<]*)?)<\//g)].map((m) => m[1]);
  assert.equal(labels.length, 28);
  assert.deepEqual(labels.slice(0, 7), ['0M', '&lt;1M', '&lt;1M', '1M', '1M', '2M', '2500M']);
  assert.ok(result.bars.includes('title="2026-10-28 · 2,500,000,000 tokens"'));
  assert.ok(result.bars.includes('aria-label="2026-10-28 · 2,500,000,000 tokens"'));
  assert.ok(result.bars.includes('class="chart-bar on"'));
  assert.equal(result.first, '10/01');
  assert.equal(result.last, '10/28');
  assert.ok(result.minWidth > 375, 'Allow horizontal scrolling rather than overlapping labels');
  ctx.state.stats = { periods: {} };
  ctx.state.view = 'trends';
  assert.ok(ctx.renderMain().includes('class="chart-scroll"'));
  assert.equal(JSON.stringify(ctx.state.history), original);
});

test('million labels handle absent readings and early-month history fallback', () => {
  const ctx = app();
  for (const [tokens, expected] of [[0, '0M'], [undefined, '0M'], [NaN, '0M'], [1234567890, '1235M']]) {
    assert.equal(ctx.fmtMillions(tokens), expected);
  }
  ctx.civilYmd = () => '2026-11-01';
  ctx.state.stats = { historyPreview: { daily: [
    { date: '2026-10-31', tokens: 999999 },
    { date: '2026-11-01' },
  ] } };
  const result = ctx.monthBars();
  assert.equal(result.first, '10/31');
  assert.equal(result.last, '11/01');
  assert.ok(!result.bars.includes('NaN'));
  ctx.state.stats = null;
  assert.equal(ctx.monthBars().bars, '');
});

test('a full month of three-digit million labels fits desktop chart width', () => {
  const ctx = app();
  ctx.civilYmd = () => '2026-10-31';
  ctx.state.history = { daily: Array.from({ length: 31 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`, tokens: 794000000,
  })) };
  assert.ok(ctx.monthBars().minWidth <= 1060);
});
