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

test('unconfirmed variants stay separate while approved Gemini and Kimi aliases are preserved', () => {
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
    { id: 'gemini-3.8-flash', tokens: 35 },
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

test('Gemini 3.8 Flash variants join canonical gemini-3.8-flash with tokens and cost conserved', () => {
  const period = {
    models: {
      'gemini-3.8-flash': 1000000,
      'gemini-3.8-flash-high': 2000000,
      'gemini-3.8-flash-n': 1000000,
      other: 4000000,
    },
    modelCosts: {
      'gemini-3.8-flash': 0.50,
      'gemini-3.8-flash-high': 1.00,
      'gemini-3.8-flash-n': 0.50,
      other: 2.00,
    },
  };
  const original = JSON.stringify(period);
  const rows = modelEntries(period);
  assert.equal(rows.length, 2);
  const flashRow = rows.find(r => r.id === 'gemini-3.8-flash');
  assert.ok(flashRow);
  assert.equal(flashRow.tokens, 4000000);
  assert.ok(Math.abs(flashRow.cost - 2.00) < 1e-10);
  assert.equal(flashRow.pct, 0.5);
  assert.equal(context.modelVendorFor(flashRow.id), 'gemini');
  assert.equal(JSON.stringify(period), original, 'Raw Hub payload must remain unchanged');
});

test('Gemini 3.8 Flash alias-only and canonical-only uses canonical display name', () => {
  assert.deepEqual(modelEntries({ models: { 'gemini-3.8-flash-n': 500 }, modelCosts: { 'gemini-3.8-flash-n': 0.25 } }), [
    { id: 'gemini-3.8-flash', tokens: 500, cost: 0.25, pct: 1 },
  ]);
  assert.deepEqual(modelEntries({ models: { 'gemini-3.8-flash-high': 300 } }), [
    { id: 'gemini-3.8-flash', tokens: 300, cost: 0, pct: 1 },
  ]);
  assert.deepEqual(modelEntries({ models: { 'gemini-3.8-flash': 200 } }), [
    { id: 'gemini-3.8-flash', tokens: 200, cost: 0, pct: 1 },
  ]);
});

test('Gemini 3.8 Flash unapproved similarly named variants stay untouched', () => {
  const rows = modelEntries({
    models: {
      'gemini-3.8-flash': 100,
      'gemini-3.8-flash-preview': 50,
      'gemini-3.8-flash-experimental': 30,
      'gemini-3.8-pro': 20,
    },
  });
  assert.deepEqual(rows.map(r => ({ id: r.id, tokens: r.tokens })), [
    { id: 'gemini-3.8-flash', tokens: 100 },
    { id: 'gemini-3.8-flash-preview', tokens: 50 },
    { id: 'gemini-3.8-flash-experimental', tokens: 30 },
    { id: 'gemini-3.8-pro', tokens: 20 },
  ]);
});

test('full and compact model lists render canonical gemini-3.8-flash with Gemini SVG', () => {
  const rows = modelEntries({
    models: {
      'gemini-3.8-flash': 1000000,
      'gemini-3.8-flash-high': 2500000,
      'gemini-3.8-flash-n': 500000,
    },
    modelCosts: {
      'gemini-3.8-flash': 0.50,
      'gemini-3.8-flash-high': 1.25,
      'gemini-3.8-flash-n': 0.25,
    },
  });
  for (const compact of [false, true]) {
    const rendered = context.renderBars(rows, compact);
    assert.equal((rendered.match(/class="row"/g) || []).length, 1);
    assert.ok(rendered.includes('>gemini-3.8-flash</div>'));
    assert.ok(!rendered.includes('>gemini-3.8-flash-high</div>'));
    assert.ok(!rendered.includes('>gemini-3.8-flash-n</div>'));
    assert.ok(rendered.includes(vm.runInContext('ICO_SVG.gemini', context)));
    assert.ok(rendered.includes('$2.00'));
    assert.ok(rendered.includes(compact ? '4M' : '4,000,000'));
  }
});

test('Gemini 4 Argon variants join canonical gemini-4-argon with tokens and cost conserved', () => {
  const period = {
    models: {
      'gemini-4-argon': 10000000,
      'gemini-4-argon-trial': 5000000,
      'gemini-4-argon-contributor': 3000000,
      'gemini-4-argon-high': 2000000,
      other: 20000000,
    },
    modelCosts: {
      'gemini-4-argon': 10.00,
      'gemini-4-argon-trial': 5.00,
      'gemini-4-argon-contributor': 3.00,
      'gemini-4-argon-high': 2.00,
      other: 20.00,
    },
  };
  const original = JSON.stringify(period);
  const rows = modelEntries(period);
  assert.equal(rows.length, 2);
  const argonRow = rows.find(r => r.id === 'gemini-4-argon');
  assert.ok(argonRow);
  assert.equal(argonRow.tokens, 20000000);
  assert.ok(Math.abs(argonRow.cost - 20.00) < 1e-10);
  assert.equal(argonRow.pct, 0.5);
  assert.equal(context.modelVendorFor(argonRow.id), 'gemini');
  assert.equal(JSON.stringify(period), original, 'Raw Hub payload must remain unchanged');
});

test('Gemini 4 Argon alias-only and canonical-only uses canonical display name', () => {
  assert.deepEqual(modelEntries({ models: { 'gemini-4-argon-trial': 100 }, modelCosts: { 'gemini-4-argon-trial': 0.1 } }), [
    { id: 'gemini-4-argon', tokens: 100, cost: 0.1, pct: 1 },
  ]);
  assert.deepEqual(modelEntries({ models: { 'gemini-4-argon-contributor': 200 } }), [
    { id: 'gemini-4-argon', tokens: 200, cost: 0, pct: 1 },
  ]);
  assert.deepEqual(modelEntries({ models: { 'gemini-4-argon-high': 300 } }), [
    { id: 'gemini-4-argon', tokens: 300, cost: 0, pct: 1 },
  ]);
  assert.deepEqual(modelEntries({ models: { 'gemini-4-argon': 400 } }), [
    { id: 'gemini-4-argon', tokens: 400, cost: 0, pct: 1 },
  ]);
});

test('Gemini 4 Argon unapproved similarly named variants stay untouched', () => {
  const rows = modelEntries({
    models: {
      'gemini-4-argon': 100,
      'gemini-4-argon-preview': 40,
      'gemini-4-argon-pro': 30,
      'gemini-4-flash': 20,
    },
  });
  assert.deepEqual(rows.map(r => ({ id: r.id, tokens: r.tokens })), [
    { id: 'gemini-4-argon', tokens: 100 },
    { id: 'gemini-4-argon-preview', tokens: 40 },
    { id: 'gemini-4-argon-pro', tokens: 30 },
    { id: 'gemini-4-flash', tokens: 20 },
  ]);
});

test('full and compact model lists render canonical gemini-4-argon with Gemini SVG', () => {
  const rows = modelEntries({
    models: {
      'gemini-4-argon': 10000000,
      'gemini-4-argon-trial': 5000000,
      'gemini-4-argon-contributor': 3000000,
      'gemini-4-argon-high': 2000000,
    },
    modelCosts: {
      'gemini-4-argon': 10.00,
      'gemini-4-argon-trial': 5.00,
      'gemini-4-argon-contributor': 3.00,
      'gemini-4-argon-high': 2.00,
    },
  });
  for (const compact of [false, true]) {
    const rendered = context.renderBars(rows, compact);
    assert.equal((rendered.match(/class="row"/g) || []).length, 1);
    assert.ok(rendered.includes('>gemini-4-argon</div>'));
    assert.ok(!rendered.includes('>gemini-4-argon-trial</div>'));
    assert.ok(!rendered.includes('>gemini-4-argon-contributor</div>'));
    assert.ok(!rendered.includes('>gemini-4-argon-high</div>'));
    assert.ok(rendered.includes(vm.runInContext('ICO_SVG.gemini', context)));
    assert.ok(rendered.includes('$20.00'));
    assert.ok(rendered.includes(compact ? '20M' : '20,000,000'));
  }
});

test('DeepSeek V4.1 Flash free variant joins canonical deepseek-v4.1-flash with tokens and cost conserved', () => {
  const period = {
    models: {
      'deepseek-v4.1-flash': 3000000,
      'deepseek-v4.1-flash-free': 3000000,
      other: 6000000,
    },
    modelCosts: {
      'deepseek-v4.1-flash': 1.50,
      'deepseek-v4.1-flash-free': 0.00,
      other: 3.00,
    },
  };
  const original = JSON.stringify(period);
  const rows = modelEntries(period);
  assert.equal(rows.length, 2);
  const dsRow = rows.find(r => r.id === 'deepseek-v4.1-flash');
  assert.ok(dsRow);
  assert.equal(dsRow.tokens, 6000000);
  assert.ok(Math.abs(dsRow.cost - 1.50) < 1e-10);
  assert.equal(dsRow.pct, 0.5);
  assert.equal(context.modelVendorFor(dsRow.id), 'deepseek');
  assert.equal(JSON.stringify(period), original, 'Raw Hub payload must remain unchanged');
});

test('DeepSeek V4.1 Flash alias-only and canonical-only uses canonical display name', () => {
  assert.deepEqual(modelEntries({ models: { 'deepseek-v4.1-flash-free': 1500 } }), [
    { id: 'deepseek-v4.1-flash', tokens: 1500, cost: 0, pct: 1 },
  ]);
  assert.deepEqual(modelEntries({ models: { 'deepseek-v4.1-flash': 2500 }, modelCosts: { 'deepseek-v4.1-flash': 0.8 } }), [
    { id: 'deepseek-v4.1-flash', tokens: 2500, cost: 0.8, pct: 1 },
  ]);
});

test('DeepSeek V4.1 Flash unapproved similarly named variants stay untouched', () => {
  const rows = modelEntries({
    models: {
      'deepseek-v4.1-flash': 100,
      'deepseek-v4.1-flash-chat': 50,
      'deepseek-v4.1-coder': 40,
      'deepseek-v4-flash-free': 30,
    },
  });
  assert.deepEqual(rows.map(r => ({ id: r.id, tokens: r.tokens })), [
    { id: 'deepseek-v4.1-flash', tokens: 100 },
    { id: 'deepseek-v4.1-flash-chat', tokens: 50 },
    { id: 'deepseek-v4.1-coder', tokens: 40 },
    { id: 'deepseek-v4-flash-free', tokens: 30 },
  ]);
});

test('full and compact model lists render canonical deepseek-v4.1-flash with DeepSeek SVG', () => {
  const rows = modelEntries({
    models: {
      'deepseek-v4.1-flash': 2000000,
      'deepseek-v4.1-flash-free': 4000000,
    },
    modelCosts: {
      'deepseek-v4.1-flash': 1.20,
      'deepseek-v4.1-flash-free': 0.00,
    },
  });
  for (const compact of [false, true]) {
    const rendered = context.renderBars(rows, compact);
    assert.equal((rendered.match(/class="row"/g) || []).length, 1);
    assert.ok(rendered.includes('>deepseek-v4.1-flash</div>'));
    assert.ok(!rendered.includes('>deepseek-v4.1-flash-free</div>'));
    assert.ok(rendered.includes(vm.runInContext('ICO_SVG.deepseek', context)));
    assert.ok(rendered.includes('$1.20'));
    assert.ok(rendered.includes(compact ? '6M' : '6,000,000'));
  }
});
