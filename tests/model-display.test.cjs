const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const html = readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const context = vm.createContext({ state: { lang: 'zh' } });
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

test('provider prefixes are stripped before alias resolution and aggregation', () => {
  const period = {
    models: {
      'deepseek/deepseek-v4.1-flash': 1078140,
      'deepseek-v4.1-flash': 5218798,
      'z-ai/glm-5.3-flash': 162000,
      'glm-5.3-flash': 703094,
      'accounts/fireworks/models/llama-3-70b': 1000,
    },
    modelCosts: {
      'deepseek/deepseek-v4.1-flash': 0,
      'deepseek-v4.1-flash': 0.1594,
      'z-ai/glm-5.3-flash': 0.01,
      'glm-5.3-flash': 0.0383,
      'accounts/fireworks/models/llama-3-70b': 0.5,
    },
  };
  const original = JSON.stringify(period);
  const rows = modelEntries(period);
  assert.deepEqual(rows.map(r => r.id).sort(), [
    'deepseek-v4.1-flash',
    'glm-5.3-flash',
    'llama-3-70b',
  ]);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(byId['deepseek-v4.1-flash'].tokens, 6296938);
  assert.ok(Math.abs(byId['deepseek-v4.1-flash'].cost - 0.1594) < 1e-10);
  assert.equal(byId['glm-5.3-flash'].tokens, 865094);
  assert.ok(Math.abs(byId['glm-5.3-flash'].cost - 0.0483) < 1e-10);
  assert.equal(byId['llama-3-70b'].tokens, 1000);
  assert.equal(JSON.stringify(period), original, 'Raw Hub payload must remain unchanged');
});

test('prefix normalization keeps malformed and bare ids unchanged', () => {
  for (const id of ['foo/', 'foo//bar', '/bar', '///', 'k3.1-pro', 'kimi-k3-high']) {
    assert.equal(context.displayModelId(id), id);
  }
  assert.equal(context.displayModelId('google/gemini-3.8-flash-high'), 'gemini-3.8-flash-high');
  assert.equal(
    context.displayModelId('inclusionai/ling-3.1-flash-1019:free'),
    'ling-3.1-flash-1019:free'
  );
});

test('prefix removal composes with existing display aliases', () => {
  assert.deepEqual(modelEntries({
    models: { 'google/gemini-3.8-flash-high': 10, 'gemini-3.8-flash': 20 },
  }), [
    { id: 'gemini-3.8-flash', tokens: 30, cost: 0, pct: 1 },
  ]);
});

test('inclusionai/ling displays bare with the Ling icon', () => {
  const rows = modelEntries({
    models: { 'inclusionai/ling-3.1-flash-1019:free': 382369 },
    modelCosts: { 'inclusionai/ling-3.1-flash-1019:free': 0.0752 },
  });
  assert.deepEqual(rows, [
    { id: 'ling-3.1-flash-1019:free', tokens: 382369, cost: 0.0752, pct: 1 },
  ]);
  assert.equal(context.modelVendorFor('ling-3.1-flash-1019:free'), 'ling');
  assert.equal(context.modelVendorFor('ling'), 'ling');
  assert.notEqual(context.modelVendorFor('kling-video'), 'ling');
  assert.notEqual(context.modelVendorFor('billing'), 'ling');
  for (const compact of [false, true]) {
    const rendered = context.renderBars(rows, compact);
    assert.ok(rendered.includes('>ling-3.1-flash-1019:free</div>'));
    assert.ok(!rendered.includes('inclusionai/'));
    assert.ok(rendered.includes(vm.runInContext('ICO_SVG.ling', context)));
  }
});

test('Grok Build channel id joins grok-4.7 while the fast SKU stays separate', () => {
  const rows = modelEntries({
    models: { 'grok-4.7-build': 305000, 'grok-4.7': 244000, 'grok-4.7-build-fast': 50000 },
    modelCosts: { 'grok-4.7-build': 0, 'grok-4.7': 1.46, 'grok-4.7-build-fast': 0.6 },
  });
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual(Object.keys(byId).sort(), ['grok-4.7', 'grok-4.7-build-fast']);
  assert.equal(byId['grok-4.7'].tokens, 549000);
  assert.ok(Math.abs(byId['grok-4.7'].cost - 1.46) < 1e-10);
  assert.equal(byId['grok-4.7-build-fast'].tokens, 50000);
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

test('k3.1-pro renders Kimi SVG while preserving separate row, exact name, tokens and cost', () => {
  const period = {
    models: {
      'k3.1-pro': 2500000,
      'kimi-k3.1-pro': 7500000,
    },
    modelCosts: {
      'k3.1-pro': 1.25,
      'kimi-k3.1-pro': 3.75,
    },
  };
  const original = JSON.stringify(period);
  const rows = modelEntries(period);

  // Must remain 2 separate rows: k3.1-pro and kimi-k3.1-pro (no aliasing/aggregation)
  assert.equal(rows.length, 2);
  const k31Row = rows.find(r => r.id === 'k3.1-pro');
  const kimiRow = rows.find(r => r.id === 'kimi-k3.1-pro');
  assert.ok(k31Row, 'k3.1-pro row must exist');
  assert.ok(kimiRow, 'kimi-k3.1-pro row must exist');

  // Exact values and name preserved
  assert.equal(k31Row.id, 'k3.1-pro');
  assert.equal(k31Row.tokens, 2500000);
  assert.ok(Math.abs(k31Row.cost - 1.25) < 1e-10);
  assert.equal(k31Row.pct, 0.25);

  assert.equal(kimiRow.id, 'kimi-k3.1-pro');
  assert.equal(kimiRow.tokens, 7500000);
  assert.ok(Math.abs(kimiRow.cost - 3.75) < 1e-10);
  assert.equal(kimiRow.pct, 0.75);

  // Raw Hub payload must remain unchanged
  assert.equal(JSON.stringify(period), original, 'Raw Hub payload must remain unchanged');

  // Vendor identification
  assert.equal(context.modelVendorFor('k3.1-pro'), 'kimi');
  assert.equal(context.modelVendorFor('K3.1-Pro'), 'kimi');
  assert.equal(context.vendorId('k3.1-pro'), 'kimi');

  // Icon rendering must use Kimi SVG, not fallback gray K
  const iconHtml = context.ico('k3.1-pro');
  const kimiSvg = vm.runInContext('ICO_SVG.kimi', context);
  assert.ok(iconHtml.includes(kimiSvg), 'ico("k3.1-pro") must include Kimi SVG');
  assert.ok(!iconHtml.includes('#6b7280'), 'ico("k3.1-pro") must not use fallback gray color');

  // Full and compact list rendering
  for (const compact of [false, true]) {
    const rendered = context.renderBars(rows, compact);
    assert.equal((rendered.match(/class="row"/g) || []).length, 2);
    assert.ok(rendered.includes('>k3.1-pro</div>'), 'Must display k3.1-pro name');
    assert.ok(rendered.includes('>kimi-k3.1-pro</div>'), 'Must display kimi-k3.1-pro name');
    assert.ok(rendered.includes(compact ? '2.5M' : '2,500,000'));
    assert.ok(rendered.includes(compact ? '7.5M' : '7,500,000'));
    assert.ok(rendered.includes('$1.25'));
    assert.ok(rendered.includes('$3.75'));
    // Both rows must render with Kimi SVG, none with fallback gray K
    const svgMatches = rendered.match(new RegExp(kimiSvg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || [];
    assert.equal(svgMatches.length, 2, 'Both rows must render Kimi SVG');
    assert.ok(!rendered.includes('background:#6b7280'), 'Neither row should use fallback gray letter');
  }
});

test('folded model tags render k3.1-pro chip with Kimi SVG, exact tokens, share and cost', () => {
  const list = [
    { id: 'claude-3-5-sonnet', tokens: 9950000, cost: 9.95, pct: 0.995 },
    { id: 'k3.1-pro', tokens: 50000, cost: 0.05, pct: 0.005 },
  ];
  const original = JSON.stringify(list);
  const rendered = context.renderModelList(list);

  assert.ok(rendered.includes('class="other-models"'));
  const chip = rendered.slice(rendered.indexOf('class="model-chip"'));
  assert.ok(chip.includes('class="model-chip-name">k3.1-pro</span>'));
  assert.ok(chip.includes('50K · 0.5%'));
  assert.ok(chip.includes('k3.1-pro · 50,000 tokens · 0.5% · $0.0500'));

  const kimiSvg = vm.runInContext('ICO_SVG.kimi', context);
  assert.ok(chip.includes(kimiSvg), 'Chip must render Kimi SVG');
  assert.ok(!chip.includes('background:#6b7280'), 'Chip must not use fallback gray letter');
  assert.ok(!rendered.includes('background:#6b7280'), 'Neither major model nor chip should use fallback gray letter');
  assert.equal(JSON.stringify(list), original, 'Model list array must remain unchanged');
});

test('unapproved variants of k3.1-pro stay unassigned and do not receive Kimi SVG', () => {
  const unapproved = [
    'k3.1-pro-preview',
    'k3.1',
    'k3.2-pro',
    'xk3.1-pro',
    'k3.1-pro-extra',
    'my-k3.1-pro',
    'k3-pro',
    'k3.1pro',
    'k-3.1-pro',
  ];
  const kimiSvg = vm.runInContext('ICO_SVG.kimi', context);
  for (const id of unapproved) {
    assert.notEqual(context.modelVendorFor(id), 'kimi', `${id} must not be identified as kimi vendor`);
    const iconHtml = context.ico(id);
    assert.ok(!iconHtml.includes(kimiSvg), `${id} must not receive Kimi SVG`);
    assert.ok(iconHtml.includes('background:#6b7280'), `${id} should use fallback icon`);
  }
});

test('existing vendor recognition for Kimi family and other providers remains intact', () => {
  // Kimi family
  assert.equal(context.modelVendorFor('kimi-latest'), 'kimi');
  assert.equal(context.modelVendorFor('kimi-k3.1-pro'), 'kimi');
  assert.equal(context.modelVendorFor('moonshot-v1-8k'), 'kimi');
  assert.equal(context.modelVendorFor('k2d6-agent'), 'kimi');
  assert.equal(context.modelVendorFor('k3-agent'), 'kimi');

  // Other providers
  assert.equal(context.modelVendorFor('cursor-auto'), 'cursor');
  assert.equal(context.modelVendorFor('claude-3-5-sonnet'), 'claude');
  assert.equal(context.modelVendorFor('gpt-4o'), 'codex');
  assert.equal(context.modelVendorFor('gemini-2.5-pro'), 'gemini');
  assert.equal(context.modelVendorFor('grok-beta'), 'xai');
  assert.equal(context.modelVendorFor('deepseek-chat'), 'deepseek');
  assert.equal(context.modelVendorFor('llama-3.3-70b'), 'meta');
  assert.equal(context.modelVendorFor('codestral-latest'), 'mistral');
  assert.equal(context.modelVendorFor('qwen-2.5-72b'), 'qwen');
  assert.equal(context.modelVendorFor('glm-4-plus'), 'zai');
  assert.equal(context.modelVendorFor('command-r-plus'), 'cohere');
  assert.equal(context.modelVendorFor('mimo-v1'), 'xiaomi');
  assert.equal(context.modelVendorFor('minimax-abab6.5s'), 'minimax');
  assert.equal(context.modelVendorFor('doubao-pro-32k'), 'doubao');
  assert.equal(context.modelVendorFor('hunyuan-standard'), 'hunyuan');
  assert.equal(context.modelVendorFor('big-pickle'), 'opencode');
});
