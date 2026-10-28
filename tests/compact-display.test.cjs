const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
function app() {
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, URL, setTimeout, clearTimeout,
    window: { matchMedia: () => ({ matches: false }) }, document: { getElementById: () => null },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script.slice(0, script.indexOf('$("gate-form").addEventListener')), context);
  return { c: context, run: expression => vm.runInContext(expression, context) };
}

test('other models shares the main bar scale and expands to chips, never per-model bars', () => {
  const { c } = app();
  const list = [{ id: 'large', tokens: 9900, cost: 1, pct: .99 },
    { id: 'tiny-one', tokens: 60, cost: 2, pct: .006 }, { id: 'tiny-two', tokens: 40, cost: 3, pct: .004 }];
  const original = JSON.stringify(list);
  const rendered = c.renderModelList(list);
  assert.ok(rendered.includes('other models'));
  assert.ok(!rendered.includes('Other Models'));
  const group = rendered.slice(rendered.indexOf('<details'));
  const chips = group.slice(group.indexOf('class="other-model-list"'));
  assert.equal((rendered.match(/class="row-bar"/g) || []).length, 2);
  assert.equal((chips.match(/class="model-chip"/g) || []).length, 2);
  assert.ok(!chips.includes('row-bar'));
  assert.ok(chips.includes('data-model-detail="0"'));
  assert.ok(chips.includes('$2.0000'));
  assert.ok(group.includes('100'));
  assert.ok(group.includes('$5.0000'));
  assert.ok(group.includes('width:2%'), 'The same minimum visible bar width applies to the aggregate');
  assert.equal(JSON.stringify(list), original);
  const many = Array.from({ length: 60 }, (_, i) => ({ id: 'minor-' + i, tokens: 90, cost: 1, pct: .009 }));
  const aggregateLargest = c.renderModelList([{ id: 'major', tokens: 4600, cost: 1, pct: .46 }, ...many]);
  const majorWidth = Number(aggregateLargest.match(/row-bar[^]*?<i style="width:([\d.]+)%/)[1]);
  assert.ok(majorWidth < 100, 'A larger other group must participate in the shared scale');
});

test('quota summaries use ordered real periods and Gemini never borrows the Claude/GPT pool', () => {
  const { c } = app();
  const windows = [
    { kind: 'weekly', label: 'Claude/GPT weekly', remainingPercent: 1 },
    { kind: 'weekly', label: 'Gemini weekly', remainingPercent: 50 },
    { kind: 'session', label: 'Gemini 5-hour', remainingPercent: 90 },
    { kind: 'monthly', label: 'Gemini monthly', remainingPercent: 80 },
    { kind: 'weekly', label: 'Gemini 4 Argon weekly', remainingPercent: 0 },
  ];
  const original = JSON.stringify(windows);
  const summary = c.quotaSummary({ provider: 'antigravity', windows });
  assert.deepEqual(Array.from(summary, x => x.window.remainingPercent), [90, 50, 0]);
  assert.ok(summary[0].label.startsWith('5 hour'));
  assert.ok(summary[1].label.startsWith('weekly'));
  assert.ok(summary[2].label.includes('Argon'));
  const noGemini = c.quotaSummary({ provider: 'antigravity', windows: windows.slice(0, 1) });
  assert.equal(noGemini.length, 0);
  const ordinary = c.quotaSummary({ provider: 'codex', windows: [
    { kind: 'monthly', remainingPercent: 40 },
    { kind: 'session', windowMinutes: 300, remainingPercent: null },
    { kind: 'daily', windowMinutes: 1440, remainingPercent: 99 },
    { kind: 'weekly', remainingPercent: 20 },
    { kind: 'weekly', additional: true, label: 'Extra model pool', remainingPercent: 1 },
  ] });
  assert.deepEqual(Array.from(ordinary, x => x.label), ['5 hour', 'weekly', 'monthly']);
  assert.equal(ordinary[0].window.remainingPercent, null);
  assert.equal(c.quotaSummary({ provider: 'unknown', windows: [{ kind: 'session', windowMinutes: 60 }] }).length, 0);
  assert.equal(JSON.stringify(windows), original);
});

test('pure balances remain truthful summaries and cards retain resets but not auth or footer buttons', () => {
  const { c, run } = app();
  const balance = { provider: 'newapi', balance: { amount: 0, currency: 'USD' }, windows: [] };
  const summary = c.quotaSummary(balance);
  assert.equal(summary.length, 1);
  assert.equal(summary[0].window.remaining, 0);
  assert.ok(summary[0].label.includes('余额'));
  const p = { provider: 'claude', accountEmail: 'private27@example.test', planLabel: 'Pro', source: 'oauth',
    updatedAt: '2026-10-28T06:20:00Z', windows: [{ kind: 'session', remainingPercent: 80, resetsAt: '2099-01-01T00:00:00Z' }, { kind: 'weekly', remainingPercent: 50, resetDescription: 'Resets next Monday' }] };
  run(`state.stats={periods:{},limits:{providers:[${JSON.stringify(p)},${JSON.stringify(balance)}]}}`);
  const card = c.renderLimits(true);
  assert.ok(card.includes('class="quota-info"'));
  assert.ok(!card.includes('quota-footer'));
  assert.ok(!card.includes('OAuth'));
  assert.ok(card.includes('class="reset"'));
  assert.ok(card.includes('Resets next Monday'));
  assert.ok(!card.includes(p.accountEmail));
  assert.ok(card.includes('$0.0000') || card.includes('$0.00'));
  run('state.view="home"');
  assert.ok(!c.renderMain().includes('关注额度'));
});

test('trend starts at the latest end but retains a reader position across redraw and calendar changes', () => {
  const { c } = app();
  const chart = { scrollWidth: 1100, clientWidth: 320, scrollLeft: 0, dataset: { chartKey: '2026-10' } };
  c.restoreChartPosition(chart);
  assert.equal(chart.scrollLeft, chart.scrollWidth - chart.clientWidth);
  const latest = c.captureChartPosition(chart);
  chart.scrollWidth += 30; c.restoreChartPosition(chart, latest);
  assert.equal(chart.scrollLeft, chart.scrollWidth - chart.clientWidth);
  chart.scrollLeft = 150;
  const history = c.captureChartPosition(chart);
  chart.scrollLeft = 0; chart.scrollWidth += 30;
  c.restoreChartPosition(chart, history);
  assert.equal(chart.scrollLeft, 150);
  chart.dataset.chartKey = '2026-11'; c.restoreChartPosition(chart, history);
  assert.equal(chart.scrollLeft, chart.scrollWidth - chart.clientWidth);
  chart.clientWidth = 1400; c.restoreChartPosition(chart, history);
  assert.equal(chart.scrollLeft, 0);
});

test('a layout-induced scroll during resize does not masquerade as browsing history', () => {
  const { c, run } = app();
  const chart = { scrollWidth: 1100, clientWidth: 375, scrollLeft: 0, dataset: { chartKey: '2026-10' } };
  c.restoreChartPosition(chart);
  run(`state.chartPosition=${JSON.stringify(c.captureChartPosition(chart))}`);
  chart.clientWidth = 320;
  c.rememberChartPosition(chart);
  assert.equal(chart.scrollLeft, chart.scrollWidth - chart.clientWidth);
  assert.equal(run('state.chartPosition.atEnd'), true);
  chart.scrollLeft = 100; c.rememberChartPosition(chart);
  chart.clientWidth = 300; c.rememberChartPosition(chart);
  assert.equal(chart.scrollLeft, 100);
  assert.equal(run('state.chartPosition.atEnd'), false);
});

test('touch never opens a hover preview and only a real backdrop click closes pinned details', () => {
  const { c, run } = app();
  const button = { matches: () => true };
  assert.equal(c.canPreviewDetails({ type: 'pointerover', pointerType: 'touch' }, button), false);
  assert.equal(c.canPreviewDetails({ type: 'pointerover', pointerType: 'mouse' }, button), true);
  run('state.lastInput="touch";state.lastTouchAt=Date.now()');
  assert.equal(c.canPreviewDetails({ type: 'focusin' }, button), false);
  assert.equal(c.canPreviewDetails({ type: 'pointerover', pointerType: 'mouse' }, button), false);
  run('state.lastInput="keyboard"');
  assert.equal(c.canPreviewDetails({ type: 'focusin' }, button), true);
  const dialog = { closed: false, close() { this.closed = true; }, getBoundingClientRect: () => ({ left: 20, right: 300, top: 20, bottom: 400 }) };
  c.document.getElementById = () => dialog;
  c.dismissDetailsBackdrop({ target: {}, clientX: 5, clientY: 5 });
  assert.equal(dialog.closed, false);
  c.dismissDetailsBackdrop({ target: dialog, clientX: 100, clientY: 100 });
  assert.equal(dialog.closed, false);
  c.dismissDetailsBackdrop({ target: dialog, clientX: 5, clientY: 5 });
  assert.equal(dialog.closed, true);
});

test('model chip details expose exact tokens, original period share and cost without another bar', () => {
  const { c } = app();
  const rendered = c.modelDetailsHtml({ id: 'tiny', tokens: 123456, cost: 1.2345, pct: .0003 });
  assert.ok(rendered.includes('123,456'));
  assert.ok(rendered.includes('$1.2345'));
  assert.ok(rendered.includes('&lt;0.1%'));
  assert.ok(!rendered.includes('row-bar'));
});

test('expired or invalid resets never become a fabricated future countdown', () => {
  const { c, run } = app();
  assert.equal(c.relReset('2000-01-01T00:00:00Z'), '已到重置时间');
  run('state.lang="en"');
  assert.equal(c.relReset('2000-01-01T00:00:00Z'), 'Reset due');
  assert.equal(c.relReset('not-a-date'), '');
});
