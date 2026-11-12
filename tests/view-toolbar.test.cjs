'use strict';
// Third-batch toolbar slice: every list page carries one quiet header with its
// page name, a count derived from the same projection the list renders, and the
// existing sort controls; Home gains real entry buttons into those pages.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
const { installFixedClock } = require('./helpers/fixed-clock.cjs');

process.env.TZ = 'UTC';
const NOW = Date.parse('2026-11-12T00:00:00Z');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const css = html.split('<style>')[1].split('</style>')[0];

function app(lang = 'zh', view = 'models', stats = null) {
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
  vm.runInContext(`state.lang = ${JSON.stringify(lang)}; state.view = ${JSON.stringify(view)}; state.period = "today";`, context);
  if (stats) vm.runInContext(`state.stats = ${JSON.stringify(stats)};`, context);
  return {
    run: (expression) => vm.runInContext(expression, context),
    json: (expression) => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context)),
  };
}

function fixture() {
  return {
    periods: {
      today: {
        totalTokens: 980,
        costUsd: 1,
        clients: { claude: 500, codex: 480, ghost: 0 },
        clientCosts: { claude: 0.5, codex: 0.4, ghost: 0 },
        models: {
          'openai/gpt-5': 900,
          'gemini-3.8-flash-high': 60,
          'gemini-3.8-flash-n': 20,
          'deepseek-v4.1-flash-free': 0,
          tiny: 0,
        },
        modelCosts: { 'openai/gpt-5': 0.9, 'gemini-3.8-flash-high': 0.05, tiny: 0 },
      },
    },
    devices: [
      { deviceId: 'dev-a', hostname: 'Desk', receivedAt: '2026-11-11T23:00:00Z', periods: { today: { totalTokens: 900, costUsd: 0.9 } } },
      { deviceId: 'dev-b', hostname: 'NAS', stale: true, receivedAt: '2026-11-10T23:00:00Z', periods: { today: { totalTokens: 80, costUsd: 0.1 } } },
    ],
    limits: {
      providers: [
        { provider: 'claude', accountKey: 'one', windows: [] },
        { provider: 'claude', accountKey: 'two', windows: [] },
        { provider: 'codex', accountKey: 'three', windows: [] },
        { provider: 'antigravity', accountKey: 'four', windows: [] },
      ],
    },
  };
}

function emptyFixture() {
  return {
    periods: { today: { totalTokens: 0, costUsd: 0, clients: {}, clientCosts: {}, models: {}, modelCosts: {} } },
    devices: [],
    limits: { providers: [] },
  };
}

const SESSION = (over = {}) => ({
  client: 'claude',
  sessionId: 'sess-1',
  totalTokens: 1200,
  costUsd: 0.25,
  messageCount: 3,
  startedAt: '2026-11-09T20:00:00.000Z',
  lastUsedAt: '2026-11-09T23:30:00.000Z',
  models: { 'claude-sonnet-4-5': 1200 },
  ...over,
});

function sessionsApp(stats, view = 'sessions') {
  const a = app('zh', view, stats);
  return a;
}

// --- Slice 1: list-page header, truthful count and unchanged sort ----------

test('models, tools, devices and limits each expose one page header with a truthful count', () => {
  const a = app('zh', 'models', fixture());
  const before = a.run('JSON.stringify(state.stats)');
  const cases = [
    ['models', '4 个模型', 'class="list-wrap usage-grid"'],
    ['tools', '3 个工具', 'class="list-wrap usage-grid"'],
    ['devices', '2 台设备', 'class="list-wrap usage-grid"'],
    ['limits', '4 个账号', 'class="limits-grid"'],
  ];
  for (const [view, label, body] of cases) {
    a.run(`state.view = ${JSON.stringify(view)};`);
    const out = a.run('renderMain()');
    assert.ok(out.includes('class="page-toolbar"'), `${view} has the shared toolbar wrapper`);
    assert.ok(out.includes('class="page-heading"'), `${view} has the heading group`);
    assert.match(out, new RegExp(`<span class="page-title">[^<]+</span><span class="page-count">${label.replace(/\s/g, '\\s')}</span>`),
      `${view} shows its name and count together`);
    assert.ok(out.indexOf('class="page-toolbar"') < out.indexOf('class="sort"'),
      `${view} keeps the original sort bar to the right of the heading`);
    assert.ok(out.indexOf('class="sort"') < out.indexOf(body), `${view} places the sort controls before its list`);
    assert.ok(out.includes(`data-sort="${view}"`), `${view} sort container is unchanged`);
  }
  assert.equal(a.run('JSON.stringify(state.stats)'), before, 'list rendering never mutates Hub data');
});

test('model count follows aliases, namespaces, zero-token rows and the folded group', () => {
  const a = app('zh', 'models', fixture());
  const count = a.run('modelEntries(periodOf(state.stats, state.period)).length');
  assert.equal(count, 4, 'gpt-5, merged gemini-3.8-flash, deepseek-v4.1-flash and tiny');
  const out = a.run('renderMain()');
  assert.ok(out.includes('4 个模型'), 'the header counts projection entries, not major DOM rows');
  assert.ok(out.includes('other models'), 'the zero-token entry is folded into other models');
  const majorRows = (out.match(/class="row" style=/g) || []).length;
  assert.ok(majorRows < 4, 'the count is not derived from the visible major rows');
});

test('limits count counts account cards, not deduplicated vendors', () => {
  const a = app('zh', 'limits', fixture());
  const out = a.run('renderMain()');
  assert.equal(a.run('state.stats.limits.providers.length'), 4);
  assert.ok(out.includes('4 个账号'), 'two same-vendor accounts stay two account cards');
  assert.equal((out.match(/class="prov quota-card/g) || []).length, 4);
});

test('devices count includes stale devices and matches the rendered rows', () => {
  const a = app('zh', 'devices', fixture());
  const out = a.run('renderMain()');
  assert.ok(out.includes('2 台设备'));
  assert.equal((out.match(/class="row/g) || []).length, 2);
  assert.ok(out.includes('is-stale'), 'the stale device remains in both count and list');
});

test('empty lists still show a zero count for their own kind and never claim zero token usage', () => {
  const a = app('zh', 'models', emptyFixture());
  for (const [view, label, emptyKey] of [
    ['models', '0 个模型', '暂无数据'],
    ['tools', '0 个工具', '暂无数据'],
    ['devices', '0 台设备', '暂无设备'],
    ['limits', '0 个账号', '暂无额度'],
  ]) {
    a.run(`state.view = ${JSON.stringify(view)};`);
    const out = a.run('renderMain()');
    assert.ok(out.includes(label), `${view} reports zero of its own kind`);
    assert.ok(out.includes(emptyKey), `${view} keeps its existing honest empty message`);
    assert.ok(!/0\s*tokens/i.test(out), `${view} does not describe an empty list as zero token usage`);
  }
});

test('English headers use compact, non-duplicated wording', () => {
  const a = app('en', 'models', fixture());
  const expected = { models: '4 models', tools: '3 tools', devices: '2 devices', limits: '4 accounts' };
  for (const [view, label] of Object.entries(expected)) {
    a.run(`state.view = ${JSON.stringify(view)};`);
    const out = a.run('renderMain()');
    assert.ok(out.includes(label), `${view} header says ${label}`);
  }
});

test('sessions counts the displayed batch and the current filtered total in one header', () => {
  const map = {};
  for (let i = 0; i < 53; i += 1) {
    map[`claude:s${i}`] = SESSION({ sessionId: `s${i}`, title: `T${i}`, totalTokens: 100 + i });
  }
  for (let i = 0; i < 10; i += 1) {
    map[`codex:c${i}`] = SESSION({ client: 'codex', sessionId: `c${i}`, title: `C${i}`, totalTokens: 200 + i });
  }
  const stats = { periods: { today: { sessions: map } }, devices: [], sessionDetailsOmitted: { today: 7 } };
  const a = sessionsApp(stats);
  const before = a.run('JSON.stringify(state.stats)');
  const out = a.run('renderMain()');
  assert.equal((out.match(/class="row session-row"/g) || []).length, 50, 'the batch stays 50 rows');
  assert.ok(out.includes('已显示 50 / 当前筛选 63'), 'M is the filtered total, omitted details are not added');
  assert.ok(out.indexOf('session-note') < out.indexOf('class="page-toolbar"'),
    'the original omission hint stays above the header');
  assert.ok(out.indexOf('class="page-toolbar"') < out.indexOf('id="session-tool-filter"'),
    'the tool filter sits on its own line after the header');
  assert.ok(out.indexOf('id="session-tool-filter"') < out.indexOf('class="list-wrap session-list"'),
    'the tool filter precedes the list');
  assert.ok(out.includes('data-sort="sessions"'), 'the original recent/tokens/cost sort is kept');
  assert.ok(out.includes('已显示 50') && !out.includes('已显示 0'), 'a loaded list never claims zero displayed rows');

  a.run('showMoreSessions()');
  assert.ok(a.run('renderMain()').includes('已显示 63 / 当前筛选 63'), 'loading more updates N only');
  a.run('setSessionTool("codex")');
  const filtered = a.run('renderMain()');
  assert.ok(filtered.includes('已显示 10 / 当前筛选 10'), 'a tool filter updates both N and M');
  assert.ok(!filtered.includes('data-session-more'), 'the filtered batch fits without a more control');
  assert.ok(filtered.includes('data-sort="sessions"'), 'filtering keeps the sort controls');
  assert.equal(a.run('JSON.stringify(state.stats)'), before, 'sessions rendering never mutates Hub data');
});

test('sessions keeps an honest empty state without a zero count, sort or filter strip', () => {
  const empty = sessionsApp({ periods: { today: {} }, devices: [], sessionDetailsOmitted: { today: 4 } });
  const out = empty.run('renderMain()');
  assert.ok(out.includes('session-note'), 'the omission hint survives the empty early return');
  assert.ok(out.includes('暂无可用的会话明细'), 'the empty list says details are absent, not usage zero');
  assert.ok(!out.includes('class="page-toolbar"'), 'no synthetic header count appears in an empty list');
  assert.ok(!out.includes('已显示'), 'no zero batch count is manufactured');
  assert.ok(!out.includes('class="sort"'), 'sort controls stay out of the empty state');
  assert.ok(!out.includes('id="session-tool-filter"'), 'the tool filter stays out of the empty state');

  const allTime = sessionsApp({
    periods: { allTime: {}, month: { sessions: { 'claude:m': SESSION({ sessionId: 'm', title: 'MonthOnly' }) } } },
  });
  allTime.run('state.period = "allTime";');
  const totalOut = allTime.run('renderMain()');
  assert.ok(totalOut.includes('Hub 不提供全时段会话明细'), 'the all-time limit is still stated');
  assert.ok(!totalOut.includes('MonthOnly'), 'month rows never stand in for TOTAL');
  assert.ok(!totalOut.includes('class="page-toolbar"'), 'TOTAL does not invent a count');
});

test('the toolbar keeps a 14px reading line, 32px sort controls and wraps instead of squeezing', () => {
  const heading = css.match(/\.page-heading\s*\{([^}]*)\}/);
  assert.ok(heading, 'missing .page-heading rule');
  assert.match(heading[1], /font-size:\s*14px/);
  assert.match(heading[1], /line-height:\s*22px/);
  const toolbar = css.match(/\.page-toolbar\s*\{([^}]*)\}/);
  assert.ok(toolbar, 'missing .page-toolbar rule');
  assert.match(toolbar[1], /flex-wrap:\s*wrap/);
  assert.match(toolbar[1], /min-height:\s*32px/);
  assert.match(css, /\.page-toolbar \.sort\s*\{\s*margin:\s*0/, 'the shared sort keeps its 32px chips and only loses its stacked margin');
  const chip = css.match(/\.sort button\s*\{([^}]*)\}/)[1];
  assert.match(chip, /min-height:\s*32px/, 'sort controls stay 32px');
});

// --- Slice 2: Home entry buttons and delegated switching -------------------

test('home model and limits section heads expose real, named entry buttons', () => {
  for (const lang of ['zh', 'en']) {
    const a = app(lang, 'home', fixture());
    const out = a.run('renderMain()');
    assert.ok(out.includes('data-v="models"'), `${lang}: models entry exists`);
    assert.ok(out.includes('data-v="limits"'), `${lang}: limits entry exists`);
    assert.equal((out.match(/data-v="/g) || []).length, 2, `${lang}: exactly two entry buttons`);
    const models = out.match(/<button type="button" class="sec-link" data-v="models" aria-label="([^"]+)">([\s\S]*?)<\/button>/);
    const limits = out.match(/<button type="button" class="sec-link" data-v="limits" aria-label="([^"]+)">([\s\S]*?)<\/button>/);
    assert.ok(models, `${lang}: models entry is a native button with a label`);
    assert.ok(limits, `${lang}: limits entry is a native button with a label`);
    if (lang === 'zh') {
      assert.equal(models[1], '查看全部模型');
      assert.equal(limits[1], '查看全部额度');
      assert.ok(models[2].includes('全部模型') && limits[2].includes('全部额度'));
    } else {
      assert.equal(models[1], 'View all models');
      assert.equal(limits[1], 'View all limits');
      assert.ok(models[2].includes('All models') && limits[2].includes('All limits'));
    }
    assert.ok(/<svg[^>]*aria-hidden="true"/.test(models[2]), 'the arrow is decorative SVG, not a text glyph');
    assert.ok(!out.includes('✣'), 'the old decorative model glyph is replaced');
    assert.ok(!out.includes('↗'), 'the activity arrow is removed');
    assert.ok(out.includes(lang === 'zh' ? '活跃 ' : 'active days'), 'active days stay in the activity head');
  }
});

test('legal entry clicks switch view once through the existing paint path', () => {
  const a = app('zh', 'home', fixture());
  const click = (id) => `chooseView({ closest: (s) => s === "[data-v]" ? { dataset: { v: ${JSON.stringify(id)} } } : null }, () => { state.__applied = (state.__applied || 0) + 1; })`;
  assert.equal(a.run(click('models')), true);
  assert.equal(a.run('state.view'), 'models');
  assert.equal(a.run('state.__applied'), 1, 'the existing paint path runs once');
  assert.equal(a.run(click('limits')), true);
  assert.equal(a.run('state.view'), 'limits');
  assert.equal(a.run('state.__applied'), 2);
});

test('illegal or unrelated clicks never change the view', () => {
  const a = app('zh', 'home', fixture());
  const click = (id) => `chooseView({ closest: (s) => s === "[data-v]" ? { dataset: { v: ${JSON.stringify(id)} } } : null }, () => { state.__applied = 1; })`;
  for (const bad of ['bogus', '', '../models', 'HOME']) {
    assert.equal(a.run(click(bad)), false, `${bad} is not a view`);
    assert.equal(a.run('state.view'), 'home');
    assert.equal(a.run('state.__applied'), undefined);
  }
  assert.equal(a.run('chooseView({ closest: () => null }, () => { state.__applied = 1; })'), false,
    'sort and other controls are not intercepted');
  assert.equal(a.run('state.view'), 'home');
  assert.equal(a.run('state.__applied'), undefined);
  assert.ok(script.indexOf('chooseView(e.target)') < script.indexOf('.sort button[data-k]', script.indexOf('chooseView(e.target)')),
    'the main click delegate checks entry buttons before the existing sort branch');
});

test('home still renders a five-row model summary from unchanged Hub data', () => {
  const models = {};
  for (let i = 1; i <= 7; i += 1) models[`m${i}`] = 1000 - i * 10;
  const stats = { periods: { today: { totalTokens: 6900, costUsd: 7, clients: {}, clientCosts: {}, models, modelCosts: {} } } };
  const a = app('zh', 'home', stats);
  const before = a.run('JSON.stringify(state.stats)');
  const home = a.run('renderMain()');
  assert.equal((home.match(/class="row"/g) || []).length, 5, 'Home stays a compact top-five summary');
  assert.ok(!home.includes('class="page-toolbar"'), 'Home does not gain a list header');
  assert.equal(a.run('JSON.stringify(state.stats)'), before, 'rendering Home never mutates Hub data');
  a.run('state.view = "models";');
  const list = a.run('renderMain()');
  assert.ok(list.includes('7 个模型'), 'the full list keeps all seven entries');
  assert.equal((list.match(/class="row" style=/g) || []).length, 7);
});
