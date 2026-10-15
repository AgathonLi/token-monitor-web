const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const html = readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const context = vm.createContext({});
// Exercise the real presentation helpers without booting the Hub-connected app.
for (const [start, end] of [
  ['const META =', 'const WIN_LAB ='],
  ['function esc(', 'function sortSpec('],
  ['function renderBars(', 'function dailyList('],
]) {
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing helper block: ${start}`);
  vm.runInContext(html.slice(startIndex, endIndex), context);
}
const modelEntries = (period) => JSON.parse(JSON.stringify(context.modelEntries(period)));

test('MiniMax Code k3 usage joins kimi-k3 with tokens and cost conserved', () => {
  const period = {
    models: { k3: 46794935, 'kimi-k3': 16755887 },
    modelCosts: { k3: 24.52, 'kimi-k3': 10.06 },
  };
  const original = JSON.stringify(period);
  const rows = modelEntries(period);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'kimi-k3');
  assert.equal(rows[0].tokens, 46794935 + 16755887);
  assert.ok(Math.abs(rows[0].cost - (24.52 + 10.06)) < 1e-10);
  assert.equal(rows[0].pct, 1);
  assert.equal(context.modelVendorFor(rows[0].id), 'kimi');
  assert.equal(JSON.stringify(period), original, 'Raw Hub payload must remain unchanged');
});

test('k3 alone uses the canonical display name', () => {
  assert.deepEqual(modelEntries({ models: { k3: 10 } }), [
    { id: 'kimi-k3', tokens: 10, cost: 0, pct: 1 },
  ]);
});

test('tokens and costs are aliased independently before calculating share', () => {
  const rows = modelEntries({
    models: { 'kimi-k3': 20, k3: 10, other: 30 },
    modelCosts: { k3: 2, 'kimi-k3': 3, other: 7 },
  });
  assert.deepEqual(rows, [
    { id: 'kimi-k3', tokens: 30, cost: 5, pct: 0.5 },
    { id: 'other', tokens: 30, cost: 7, pct: 0.5 },
  ]);
});

test('unconfirmed variants stay separate and the existing Gemini alias is preserved', () => {
  const rows = modelEntries({
    models: {
      'gemini-3.8-flash': 10,
      'gemini-3.8-flash-high': 20,
      'gemini-3.8-flash-n': 5,
      'k3-agent': 7,
      'kimi-k3-high': 8,
    },
  });
  assert.deepEqual(rows.map(({ id, tokens }) => ({ id, tokens })), [
    { id: 'gemini-3.8-flash', tokens: 30 },
    { id: 'gemini-3.8-flash-n', tokens: 5 },
    { id: 'k3-agent', tokens: 7 },
    { id: 'kimi-k3-high', tokens: 8 },
  ]);
});

test('already canonical usage and empty periods remain valid', () => {
  assert.deepEqual(modelEntries({ models: { 'kimi-k3': 12 }, modelCosts: { 'kimi-k3': 1 } }), [
    { id: 'kimi-k3', tokens: 12, cost: 1, pct: 1 },
  ]);
  assert.deepEqual(modelEntries({}), []);
});

test('full and compact model lists render one canonical row with the Kimi SVG', () => {
  const rows = modelEntries({
    models: { k3: 46794935, 'kimi-k3': 16755887 },
    modelCosts: { k3: 24.52, 'kimi-k3': 10.06 },
  });
  for (const compact of [false, true]) {
    const rendered = context.renderBars(rows, compact);
    assert.equal((rendered.match(/class="row"/g) || []).length, 1);
    assert.ok(rendered.includes('>kimi-k3</div>'));
    assert.ok(!rendered.includes('>k3</div>'));
    assert.ok(rendered.includes(vm.runInContext('ICO_SVG.kimi', context)));
    assert.ok(rendered.includes('$34.58'));
    assert.ok(rendered.includes(compact ? '63.6M' : '63,550,822'));
  }
});
