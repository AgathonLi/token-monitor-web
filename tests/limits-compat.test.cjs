const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
function app() {
  const ctx = vm.createContext({});
  for (const [start, end] of [
    ['const I18N =', 'function views('],
    ['const META =', 'const WIN_LAB ='],
    ['const WIN_LAB =', 'const $ ='],
    ['const state =', 'function loadCfg('],
    ['function esc(', 'function dailyList('],
  ]) {
    const from = html.indexOf(start), to = html.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Missing helpers: ${start}`);
    vm.runInContext(html.slice(from, to), ctx);
  }
  return {
    ctx,
    run: (expression) => vm.runInContext(expression, ctx),
    render: (providers, full = true) => {
      vm.runInContext(`state.stats = {limits:{providers:${JSON.stringify(providers)}}}`, ctx);
      return vm.runInContext(`state.stats.limits.providers.map(p => renderProviderDetails(p, ${Boolean(full)})).join("")`, ctx);
    },
  };
}

test('fresh page defaults to DAY and alphabetical Limits without changing other sorts', () => {
  const { run } = app();
  assert.equal(run('state.period'), 'today');
  assert.equal(run('state.sort.limits.key'), 'name');
  assert.equal(run('state.sort.limits.dir'), 'asc');
  assert.equal(run('state.sort.models.key'), 'tokens');
  assert.equal(run('state.sort.tools.key'), 'tokens');
  assert.match(html, /data-p="today" class="on"/);
  assert.doesNotMatch(html, /data-p="month" class="on"/);
});

test('spending uses used or amount, never remaining allowance or provider balance', () => {
  const { ctx } = app();
  for (const [window, expected] of [
    [{ used: 7.5, remaining: 30 }, '$7.5000'],
    [{ used: 0, amount: 9 }, '$0.0000'],
    [{ amount: 12 }, '$12.00'],
  ]) {
    const rendered = ctx.renderWin({ kind: 'billing', metric: 'spend', currency: 'USD', ...window }, 'Spent', '', { color: '#888' }, { balance: { amount: 60, currency: 'USD' } });
    assert.ok(rendered.includes(expected), rendered);
    assert.ok(!rendered.includes('$60.00'));
    assert.ok(!rendered.includes('class="bar"'));
  }
  const unknown = ctx.renderWin({ metric: 'spend', used: null }, 'Spent', '', {}, { balance: { amount: 60 } });
  assert.ok(!unknown.includes('$'), unknown);
});

test('credits remain independent and unavailable money is not fabricated as zero', () => {
  const { ctx, render } = app();
  for (const value of [null, undefined, '', ' ', 'bad', false]) assert.equal(ctx.fmtMoney(value, 'USD'), '');
  assert.equal(ctx.fmtMoney(0, 'USD'), '$0.0000');
  const rendered = render([{ provider: 'ollama', balance: { amount: 999, currency: 'USD' }, windows: [
    { kind: 'billing', label: 'Included credits', metric: 'credits', remaining: 30, currency: 'USD', remainingPercent: 50 },
    { kind: 'billing', label: 'Credit balance', metric: 'credits', remaining: 60, currency: 'USD', showMeter: false },
    { kind: 'billing', label: 'Monthly credits used', metric: 'spend', used: 7.5, currency: 'USD' },
    { kind: 'billing', label: 'Unavailable credits', metric: 'credits', remaining: null, used: 12, currency: 'USD' },
  ] }]);
  assert.ok(rendered.includes('$30.00'));
  assert.ok(rendered.includes('$60.00'));
  assert.ok(rendered.includes('$7.5000'));
  assert.ok(!rendered.includes('$999.00'));
  assert.equal((rendered.match(/class="bar"/g) || []).length, 1);
});

test('same-plan quota cards keep account identities separate from plans and sources', () => {
  const { ctx, render } = app();
  const providers = [
    { provider: 'claude', planLabel: 'Pro', accountName: 'Work <team>', accountEmail: 'work@example.test', source: 'web', windows: [] },
    { provider: 'claude', planLabel: 'Pro', accountEmail: 'personal@example.test', source: 'oauth', windows: [] },
    { provider: 'muse', planLabel: 'Plus', sourceDeviceId: 'test-nas', windows: [] },
  ];
  for (const full of [true, false]) {
    const rendered = render(providers, full);
    assert.ok(rendered.includes('Work &lt;team&gt;'));
    assert.ok(rendered.includes(ctx.maskEmails('work@example.test')));
    assert.ok(rendered.includes(ctx.maskEmails('personal@example.test')));
    assert.ok(!rendered.includes('work@example.test'));
    assert.ok(!rendered.includes('personal@example.test'));
    assert.ok(rendered.includes('test-nas'));
    assert.ok(rendered.includes('Web'));
    assert.ok(rendered.includes('OAuth'));
    assert.equal((rendered.match(/class="prov"/g) || []).length, 3);
  }
  assert.equal(ctx.planLabel({ accountLabel: 'Work', planLabel: 'Pro' }), 'Pro');
  assert.equal(ctx.planLabel({ accountLabel: 'Work' }), '');
});

test('New API exposes supplied period spending with real zero and expandable details', () => {
  const { run, render } = app();
  const provider = { provider: 'thirdparty', adapterId: 'newapi-account', balance: {
    amount: 60, currency: 'USD', todaySpend: 0, weekSpend: 12, monthSpend: 20, allTimeSpend: 80,
  }, windows: [] };
  const original = JSON.stringify(provider);
  for (const full of [true, false]) {
    const rendered = render([provider], full);
    assert.ok(rendered.includes('<details class="spend-details">'));
    for (const text of ['今日', '近7天', '本月', '累计', '$0.0000', '$12.00', '$20.00', '$80.00']) assert.ok(rendered.includes(text), text);
    assert.ok(!rendered.includes('$60.00'));
  }
  run('state.lang = "en"');
  assert.ok(render([provider]).includes('Today'));
  assert.equal(JSON.stringify(provider), original);
  const missing = render([{ provider: 'thirdparty', adapterId: 'newapi-account', balance: { currency: 'USD', todaySpend: null, monthSpend: '' }, windows: [] }]);
  assert.ok(!missing.includes('spend-details'));
  assert.ok(!render([{ ...provider, adapterId: 'sub2api' }]).includes('spend-details'));
});

test('Muse and OmO Native have upstream names, colors and SVG marks without merging usage ids', () => {
  const { ctx } = app();
  for (const [id, name, color] of [['muse', 'Muse Code', '#0866FF'], ['senpi', 'OmO Native', '#00D4FF']]) {
    assert.equal(ctx.meta(id).name, name);
    assert.equal(ctx.meta(id).color, color);
    assert.ok(ctx.ico(id).includes('<svg'));
    assert.ok(ctx.renderBars(ctx.entries({ [id]: 10 }), false).includes(name));
  }
  for (const id of ['muse-spark', 'muse-wonder-1.0', 'muse-glimmer', 'muse-image', 'muse-voice']) assert.equal(ctx.modelVendorFor(id), 'meta');
  assert.equal(ctx.modelVendorFor('muse-wonderful'), '');
  const rows = ctx.modelEntries({ models: { 'muse-wonder-1.0': 10, 'muse-glimmer': 20 } });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'muse-wonder-1.0');
  assert.equal(ctx.entries({ pi: 1, omp: 2, senpi: 3 }).length, 3);
});
