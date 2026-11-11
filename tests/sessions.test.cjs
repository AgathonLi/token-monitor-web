'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
const { installFixedClock } = require('./helpers/fixed-clock.cjs');

// Fixed clock and UTC keep civil-time expectations independent of the host.
process.env.TZ = 'UTC';
const NOW = Date.parse('2026-11-10T00:00:00Z');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Same boot boundary as tests/upstream-compat.test.cjs: no DOM, no network.
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
  };
}

const SESSION = (over = {}) => ({
  client: 'claude',
  sessionId: 'sess-1',
  totalTokens: 1200,
  costUsd: 0.25,
  messageCount: 3,
  inputTokens: 100,
  cacheReadTokens: 900,
  cacheWriteTokens: 0,
  outputTokens: 200,
  cacheReported: true,
  startedAt: '2026-11-09T20:00:00.000Z',
  lastUsedAt: '2026-11-09T23:30:00.000Z',
  models: { 'claude-sonnet-4-5': 1200 },
  ...over,
});

function sessions({ period = {}, month = null, allTime = null, devices = [], lang = 'zh' } = {}) {
  const a = app(lang);
  const periods = { today: period };
  if (month) periods.month = month;
  if (allTime) periods.allTime = allTime;
  a.run(`state.stats = { periods: ${JSON.stringify(periods)}, devices: ${JSON.stringify(devices)} };
    state.period = "today"; state.view = "sessions";`);
  return a;
}

// --- Slice 1: navigation and truthful row projection ----------------------

test('sessions: both navigation render paths list home, limits, models, tools, devices, sessions, trends', () => {
  const { run, json } = app();
  assert.deepEqual(json('views().map((v) => v.id)'),
    ['home', 'limits', 'models', 'tools', 'devices', 'sessions', 'trends']);
  assert.equal(run('views().find((v) => v.id === "sessions").label'), '会话');
  assert.equal(app('en').run('views().find((v) => v.id === "sessions").label'), 'Sessions');
  const icons = json('views().map((v) => v.icon)');
  assert.equal(new Set(icons).size, icons.length, 'Each tab keeps a distinct icon');
  // The tabs strip and the in-page menu are both built from this single array.
  const source = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(source.includes('$("tabs").innerHTML = vlist.map'), 'Tabs strip still rendered from views()');
  assert.ok(source.includes('$("menu").innerHTML = vlist.map'), 'Menu still rendered from views()');
  assert.equal(run('state.view'), 'home', 'Home stays the default view');
});

test('sessions: accounts come only from the selected period aggregate map', () => {
  const { run, json } = sessions({ period: { sessions: { 'claude:sess-1': SESSION() } } });
  assert.deepEqual(json('sessionRows(periodOf(state.stats, state.period), state.period).map((r) => [r.client, r.sessionId, r.tokens])'),
    [['claude', 'sess-1', 1200]]);
  // Keys are client:sessionId; a colon inside the session id must survive.
  const a = sessions({ period: { sessions: { 'codex:rollout:2026-05-30:abc': SESSION({ client: 'codex', sessionId: 'rollout:2026-05-30:abc' }) } } });
  const row = a.json('sessionRows(periodOf(state.stats, state.period), state.period)[0]');
  assert.equal(row.client, 'codex');
  assert.equal(row.sessionId, 'rollout:2026-05-30:abc');
  // A missing sessionId field falls back to the key remainder, keeping colons.
  const b = sessions({ period: { sessions: { 'codex:rollout:2026-05-30:abc': SESSION({ client: 'codex', sessionId: undefined }) } } });
  assert.equal(b.json('sessionRows(periodOf(state.stats, state.period), state.period)[0].sessionId'), 'rollout:2026-05-30:abc');
  // Neither field: the key prefix stays the tool id.
  const c = sessions({ period: { sessions: { 'gemini:abc': SESSION({ client: undefined, sessionId: undefined }) } } });
  assert.equal(c.json('sessionRows(periodOf(state.stats, state.period), state.period)[0].client'), 'gemini');
  assert.equal(run('state.stats.periods.month'), undefined, 'Month stays untouched');
});

test('sessions: malformed rows are skipped instead of becoming phantom usage', () => {
  const { json } = sessions({
    period: {
      sessions: {
        'claude:ok': SESSION({ sessionId: 'ok' }),
        'claude:arr': [],
        'claude:null': null,
        'claude:str': 'nope',
        'claude:zero': SESSION({ sessionId: 'zero', totalTokens: 0 }),
        'claude:neg': SESSION({ sessionId: 'neg', totalTokens: -5 }),
        'claude:bad': SESSION({ sessionId: 'bad', totalTokens: 'many' }),
        'claude:inf': SESSION({ sessionId: 'inf', totalTokens: Infinity }),
        'claude:blank': SESSION({ sessionId: 'blank', totalTokens: '   ' }),
        'claude:numstr': SESSION({ sessionId: 'numstr', totalTokens: '42' }),
      },
    },
  });
  assert.deepEqual(json('sessionRows(periodOf(state.stats, state.period), state.period).map((r) => r.sessionId)'),
    ['ok', 'numstr']);
  assert.deepEqual(json('sessionRows({}, "today")'), [], 'A period without a session map yields nothing');
  assert.deepEqual(json('sessionRows({ sessions: [] }, "today")'), [], 'An array is not a session map');
  assert.deepEqual(json('sessionRows({ sessions: "x" }, "today")'), []);
});

test('sessions: optional readings accept real zero and honest strings, reject junk', () => {
  const { json } = sessions({
    period: {
      sessions: {
        'claude:a': SESSION({ sessionId: 'a', costUsd: 0, messageCount: 0, inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, cacheReported: true }),
        'claude:b': SESSION({ sessionId: 'b', costUsd: '0.5', messageCount: ' 7 ', inputTokens: '10', cacheReadTokens: '90', cacheWriteTokens: '0' }),
        'claude:c': SESSION({ sessionId: 'c', costUsd: null, messageCount: true, inputTokens: '', cacheReadTokens: 'soon', cacheWriteTokens: -3, cacheReported: false }),
      },
    },
  });
  const rows = json('sessionRows(periodOf(state.stats, state.period), state.period)');
  const by = Object.fromEntries(rows.map((r) => [r.sessionId, r]));
  assert.equal(by.a.cost, 0);
  assert.equal(by.a.calls, 0);
  assert.equal(by.a.cacheHit, 0, 'A reported zero with traffic is a real 0%, not unknown');
  assert.equal(by.b.cost, 0.5);
  assert.equal(by.b.calls, 7);
  assert.equal(Math.round(by.b.cacheHit * 100), 90);
  assert.equal(by.c.cost, null);
  assert.equal(by.c.calls, null);
  assert.equal(by.c.cacheHit, null);
  // No cache telemetry at all: no reading rather than a fabricated 0%.
  const plain = sessions({ period: { sessions: { 'claude:p': SESSION({ sessionId: 'p', cacheReadTokens: undefined, cacheWriteTokens: undefined, inputTokens: 100, cacheReported: undefined }) } } });
  assert.equal(plain.json('sessionRows(periodOf(state.stats, state.period), state.period)[0].cacheHit'), null);
});

test('sessions: only the canonical title is read, never a transcript preview', () => {
  const { json } = sessions({
    period: {
      sessions: {
        'claude:titled': SESSION({ sessionId: 'titled', title: '  Fix the parser  ', firstUserMessage: 'my private prompt', preview: 'private preview' }),
        'claude:blank': SESSION({ sessionId: 'blank', title: '   ', firstUserMessage: 'my private prompt' }),
        'gemini:untitled': SESSION({ client: 'gemini', sessionId: 'untitled', firstUserMessage: 'private' }),
      },
    },
  });
  const rows = json('sessionRows(periodOf(state.stats, state.period), state.period)');
  const by = Object.fromEntries(rows.map((r) => [r.sessionId, r]));
  assert.equal(by.titled.title, 'Fix the parser');
  assert.equal(by.titled.name, 'Fix the parser');
  assert.equal(by.blank.title, '');
  assert.equal(by.blank.name, 'Claude Code', 'Untitled rows fall back to the client display name');
  assert.equal(by.untitled.name, 'Gemini CLI', 'Client display names are client-specific, not model vendors');
  const serialized = JSON.stringify(rows);
  assert.ok(!serialized.includes('private prompt'), 'No transcript text is projected');
  assert.ok(!serialized.includes('private preview'));
});

test('sessions: activity time prefers lastUsedAt, falls back to startedAt, and never prints Invalid Date', () => {
  const { run, json } = sessions({
    period: {
      sessions: {
        'claude:last': SESSION({ sessionId: 'last', lastUsedAt: '2026-11-09T23:30:00.000Z', startedAt: '2026-11-01T00:00:00.000Z' }),
        'claude:start': SESSION({ sessionId: 'start', lastUsedAt: null, startedAt: '2026-11-08T10:00:00.000Z' }),
        'claude:bad': SESSION({ sessionId: 'bad', lastUsedAt: 'not-a-date', startedAt: '2026-11-07T10:00:00.000Z' }),
        'claude:none': SESSION({ sessionId: 'none', lastUsedAt: undefined, startedAt: undefined }),
      },
    },
  });
  const rows = json('sessionRows(periodOf(state.stats, state.period), state.period)');
  const by = Object.fromEntries(rows.map((r) => [r.sessionId, r]));
  assert.equal(by.last.timeMs, Date.parse('2026-11-09T23:30:00.000Z'));
  assert.equal(by.start.timeMs, Date.parse('2026-11-08T10:00:00.000Z'));
  assert.equal(by.bad.timeMs, Date.parse('2026-11-07T10:00:00.000Z'), 'A bad lastUsedAt falls back to startedAt');
  assert.equal(by.none.timeMs, null);
  run('state.view = "sessions"');
  const rendered = run('renderSessions()');
  assert.ok(!rendered.includes('Invalid Date'), 'Unusable timestamps print nothing');
  assert.ok(rendered.includes(run('esc(fmtStamp(Date.parse("2026-11-09T23:30:00.000Z")))')),
    'Activity uses the Hub civil timezone helper');
});

test('sessions: calls count usage-bearing replies, cache hit is its own ratio', () => {
  const { run, json } = sessions({
    period: {
      sessions: {
        'claude:one': SESSION({ sessionId: 'one', messageCount: 1, inputTokens: 25, cacheReadTokens: 75, cacheWriteTokens: 0, outputTokens: 50 }),
        'claude:many': SESSION({ sessionId: 'many', messageCount: 12, inputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 100 }),
        'claude:none': SESSION({ sessionId: 'none', messageCount: undefined, inputTokens: 50, cacheReadTokens: 50, cacheWriteTokens: 0, cacheReported: false }),
      },
    },
  });
  const rows = json('sessionRows(periodOf(state.stats, state.period), state.period)');
  const by = Object.fromEntries(rows.map((r) => [r.sessionId, r]));
  assert.equal(by.one.cacheHit, 0.75);
  assert.equal(by.many.cacheHit, 0.6);
  assert.equal(by.none.cacheHit, 0.5, 'Read traffic is its own cache evidence');
  const rendered = run('renderSessions()');
  assert.ok(rendered.includes('1 call') && !rendered.includes('1 calls'));
  assert.ok(rendered.includes('12 calls'), 'Message counts read as calls, not turns');
  assert.ok(!/turn/i.test(rendered), 'No transcript wording');
  assert.ok(rendered.includes('缓存命中率 75%'), 'Cache hit is labelled, not shown as a token share');
  assert.ok(!rendered.includes('usage-share'), 'Cache hit must never reuse the category-share class');
  assert.ok(rendered.includes('>75%<'), 'The percentage itself stays visible');
  // 1..99% boundaries: sub-1% keeps the honest "<1%" marker.
  const tiny = sessions({ period: { sessions: { 'claude:tiny': SESSION({ sessionId: 'tiny', inputTokens: 1000, cacheReadTokens: 1, cacheWriteTokens: 0 }) } } });
  assert.ok(tiny.run('renderSessions()').includes('&lt;1%'), 'A sub-1% hit stays honest, HTML-escaped');
});

test('sessions: a device is named only when one device owns the accounting key', () => {
  const devices = [
    { deviceId: 'dev-a', hostname: 'studio-mac', periods: { today: { sessions: { 'claude:shared': {}, 'claude:solo': {} } } } },
    { deviceId: 'dev-b', hostname: 'laptop-pc', periods: { today: { sessions: { 'claude:shared': {} } } } },
  ];
  const { run, json } = sessions({
    period: { sessions: { 'claude:shared': SESSION({ sessionId: 'shared' }), 'claude:solo': SESSION({ sessionId: 'solo' }), 'claude:orphan': SESSION({ sessionId: 'orphan' }) } },
    devices,
  });
  const rows = json('sessionRows(periodOf(state.stats, state.period), state.period)');
  const by = Object.fromEntries(rows.map((r) => [r.sessionId, r]));
  assert.equal(by.solo.device, 'studio-mac');
  assert.equal(by.shared.device, '', 'Two owners must not be reported as the first one');
  assert.equal(by.orphan.device, '', 'A device with no matching key does not adopt the row');
  assert.equal(rows.length, 3, 'Device maps never add or remove rows');
  const rendered = run('renderSessions()');
  assert.ok(rendered.includes('studio-mac'));
  assert.ok(!rendered.includes('laptop-pc'), 'An ambiguous owner is never rendered');
});

test('sessions: prototype keys and hostile text stay inert', () => {
  const { run } = sessions({
    period: {
      sessions: {
        'constructor:proto': SESSION({ client: 'constructor', sessionId: 'proto', title: '<img src=x onerror="alert(1)">', models: { __proto__: 5 } }),
        'toString:x': SESSION({ client: 'toString', sessionId: 'x', models: { constructor: 7 }, title: 'ok' }),
      },
    },
  });
  const rendered = run('renderSessions()');
  assert.ok(!rendered.includes('<img'), 'Titles are escaped');
  assert.ok(rendered.includes('&lt;img'), 'The hostile title is still shown, escaped');
  assert.ok(!/function Object|native code/.test(rendered), 'Inherited Object members never leak into markup');
  assert.ok(rendered.includes('#6b7280'), 'Unknown tool ids keep the neutral fallback colour');
  assert.ok(rendered.includes('constructor') && rendered.includes('toString'),
    'Unknown tool ids keep their own label');
  assert.equal(run('JSON.stringify(state.stats).includes("<img")'), true, 'The raw payload is untouched');
});

// --- Slice 2: rendering, sorting and batching -----------------------------
function names(rendered) {
  return rendered.split('class="session-name"').slice(1).map((part) => part.match(/>([^<]*)</)[1]);
}

function listApp(sessionsMap, { lang = 'zh', period = 'today', devices = [] } = {}) {
  const a = app(lang);
  a.run(`state.stats = { periods: { ${period}: { sessions: ${JSON.stringify(sessionsMap)} } }, devices: ${JSON.stringify(devices)} };
    state.period = ${JSON.stringify(period)}; state.view = "sessions";`);
  return a;
}

test('sessions: recent activity is the default order with stable, deterministic ties', () => {
  const { run } = listApp({
    'claude:old': SESSION({ sessionId: 'old', title: 'Old', lastUsedAt: '2026-11-01T00:00:00.000Z' }),
    'claude:new': SESSION({ sessionId: 'new', title: 'New', lastUsedAt: '2026-11-09T00:00:00.000Z' }),
    'claude:mid': SESSION({ sessionId: 'mid', title: 'Mid', lastUsedAt: '2026-11-05T00:00:00.000Z' }),
  });
  assert.deepEqual(names(run('renderSessions()')), ['New', 'Mid', 'Old']);
  assert.deepEqual(JSON.parse(run('JSON.stringify(sortSpec("sessions"))')), { key: 'recent', dir: 'desc' });

  // Same instant: more tokens first, then higher cost, then name, then key.
  const tie = listApp({
    'claude:b': SESSION({ sessionId: 'b', title: 'Bee', totalTokens: 500, costUsd: 1, lastUsedAt: '2026-11-09T00:00:00.000Z' }),
    'claude:a': SESSION({ sessionId: 'a', title: 'Ay', totalTokens: 500, costUsd: 1, lastUsedAt: '2026-11-09T00:00:00.000Z' }),
    'claude:big': SESSION({ sessionId: 'big', title: 'Big', totalTokens: 900, costUsd: 1, lastUsedAt: '2026-11-09T00:00:00.000Z' }),
    'claude:costly': SESSION({ sessionId: 'costly', title: 'Costly', totalTokens: 500, costUsd: 9, lastUsedAt: '2026-11-09T00:00:00.000Z' }),
    'claude:undated': SESSION({ sessionId: 'undated', title: 'Undated', totalTokens: 9999, lastUsedAt: undefined, startedAt: undefined }),
  });
  assert.deepEqual(names(tie.run('renderSessions()')), ['Big', 'Costly', 'Ay', 'Bee', 'Undated'],
    'Undated rows sort last without inventing a time');
  // Repeated renders are byte-identical: no accidental insertion-order flip.
  assert.equal(tie.run('renderSessions()'), tie.run('renderSessions()'));
});

test('sessions: sort chips reuse the existing sort machinery and are bilingual', () => {
  const { run, json } = listApp({ 'claude:a': SESSION({ sessionId: 'a', title: 'A' }) });
  const chip = run('sortBar("sessions", ["recent", "tokens", "cost"])');
  assert.deepEqual([...chip.matchAll(/data-k="([a-z]+)"/g)].map((m) => m[1]), ['recent', 'tokens', 'cost']);
  assert.ok(chip.includes('data-sort="sessions"'), 'Chips keep the shared sort container');
  assert.ok(chip.includes('>最近 ↓</button>'), 'Recent is active by default');
  assert.ok(chip.includes('>用量</button>') && chip.includes('>成本</button>'));
  const en = app('en');
  en.run(`state.stats = { periods: { today: { sessions: {} } } };`);
  const enChip = en.run('sortBar("sessions", ["recent", "tokens", "cost"])');
  assert.ok(enChip.includes('>Recent ↓</button>') && enChip.includes('>Tokens</button>') && enChip.includes('>Cost</button>'));
  const rendered = run('renderSessions()');
  assert.ok(rendered.includes('data-sort="sessions"'), 'The panel carries the chips');
  assert.deepEqual(json('state.sort.tools'), { key: 'tokens', dir: 'desc' }, 'Other views keep their own defaults');
  assert.deepEqual(json('state.sort.sessions'), { key: 'recent', dir: 'desc' });
});

test('sessions: tokens and cost sorting reorder only this list, unknown costs last', () => {
  const map = {
    'claude:small': SESSION({ sessionId: 'small', title: 'Small', totalTokens: 10, costUsd: 5, lastUsedAt: '2026-11-01T00:00:00.000Z' }),
    'claude:large': SESSION({ sessionId: 'large', title: 'Large', totalTokens: 1000, costUsd: 1, lastUsedAt: '2026-11-09T00:00:00.000Z' }),
    'claude:nocost': SESSION({ sessionId: 'nocost', title: 'NoCost', totalTokens: 500, costUsd: null, lastUsedAt: '2026-11-05T00:00:00.000Z' }),
  };
  const { run } = listApp(map);
  run('state.sort.sessions = { key: "tokens", dir: "desc" };');
  assert.deepEqual(names(run('renderSessions()')), ['Large', 'NoCost', 'Small']);
  run('state.sort.sessions = { key: "tokens", dir: "asc" };');
  assert.deepEqual(names(run('renderSessions()')), ['Small', 'NoCost', 'Large']);
  run('state.sort.sessions = { key: "cost", dir: "desc" };');
  assert.deepEqual(names(run('renderSessions()')), ['Small', 'Large', 'NoCost'], 'A missing cost is not a cheap row');
  run('state.sort.sessions = { key: "cost", dir: "asc" };');
  assert.deepEqual(names(run('renderSessions()')), ['Large', 'Small', 'NoCost']);
  run('state.sort.sessions = { key: "recent", dir: "asc" };');
  assert.deepEqual(names(run('renderSessions()')), ['Small', 'NoCost', 'Large'], 'Recent can be reversed by the chip toggle');
  // The tools view still sorts by its own spec, untouched by session sorting.
  const tools = run(`renderMain ? (state.view = "tools", renderMain()) : ""`);
  assert.ok(tools.includes('data-sort="tools"'));
});

test('sessions: rows expose the approved structural hooks and a tool-coloured bar', () => {
  const { run } = listApp({
    'codex:s1': SESSION({ client: 'codex', sessionId: 's1', title: 'Structured', models: { 'gpt-5': 1200 } }),
    'claude:s2': SESSION({ sessionId: 's2', title: 'Second', totalTokens: 600, models: { 'claude-sonnet-4-5': 600 } }),
  });
  const rendered = run('renderSessions()');
  for (const hook of ['class="sessions-panel"', 'class="row session-row"', 'class="session-name"',
    'class="session-model"', 'class="session-activity"', 'class="session-id"', 'class="row-bar"']) {
    assert.ok(rendered.includes(hook), `Missing hook ${hook}`);
  }
  assert.ok(rendered.includes('<span class="usage-value">1,200</span>'), 'Exact tokens use the shared usage-value hook');
  assert.ok(rendered.includes('>1,200<span') || rendered.includes('>1,200</span>'));
  assert.ok(!rendered.includes('class="usage-share"'), 'Sessions never show a category token share');
  assert.ok(rendered.includes('#49a3b0'), 'The bar is tool-coloured (Codex teal)');
  assert.ok(rendered.includes('width:100%'), 'The largest row fills the bar');
  assert.ok(/width:50%;background:#cc7c5e/.test(rendered), 'The bar is relative to the largest row');
});

test('sessions: 125 rows render 50 at a time and Load more never loses rows', () => {
  const map = {};
  for (let i = 0; i < 125; i += 1) {
    map[`claude:s${i}`] = SESSION({ sessionId: `s${i}`, title: `T${i}`, totalTokens: 100 + i, lastUsedAt: `2026-11-09T00:${String(i % 60).padStart(2, '0')}:00.000Z` });
  }
  const { run } = listApp(map);
  const count = (html) => (html.match(/class="row session-row"/g) || []).length;
  const first = run('renderSessions()');
  assert.equal(count(first), 50, 'The first batch is bounded');
  assert.ok(first.includes('data-session-more'), 'A Load more control is offered');
  assert.ok(first.includes('还剩 75 条'), 'The remaining count is truthful');
  run('showMoreSessions()');
  assert.equal(count(run('renderSessions()')), 100);
  assert.ok(run('renderSessions()').includes('还剩 25 条'));
  run('showMoreSessions()');
  const last = run('renderSessions()');
  assert.equal(count(last), 125, 'Every retained row is reachable');
  assert.ok(!last.includes('data-session-more'), 'The control retires once everything is visible');
  run('showMoreSessions()');
  assert.equal(count(run('renderSessions()')), 125, 'Over-clicking cannot invent rows');
});

test('sessions: the visible batch resets on period, sort and filter changes', () => {
  const map = {};
  for (let i = 0; i < 80; i += 1) map[`claude:s${i}`] = SESSION({ sessionId: `s${i}`, title: `T${i}`, totalTokens: 10 + i });
  const { run } = listApp(map);
  run('showMoreSessions()');
  assert.equal((run('renderSessions()').match(/class="row session-row"/g) || []).length, 80);
  run('resetSessionBatch()');
  assert.equal((run('renderSessions()').match(/class="row session-row"/g) || []).length, 50);
  // A stale batch cannot outlive its rows either.
  run('state.sessionVisible = 500;');
  assert.equal((run('renderSessions()').match(/class="row session-row"/g) || []).length, 80);
});

test('sessions: rendering never mutates the received payload', () => {
  const map = {
    'claude:a': SESSION({ sessionId: 'a', title: 'A' }),
    'codex:b': SESSION({ client: 'codex', sessionId: 'b', title: 'B' }),
  };
  const { run } = listApp(map);
  const before = run('JSON.stringify(state.stats)');
  run('renderSessions()');
  run('state.sort.sessions = { key: "tokens", dir: "asc" }; renderSessions()');
  run('state.view = "sessions"; renderMain()');
  assert.equal(run('JSON.stringify(state.stats)'), before);
});

// --- Slice 3: tool filter interactions ------------------------------------
test('sessions: the tool strip offers All plus one accessible control per tool', () => {
  const { run } = listApp({
    'claude:a': SESSION({ sessionId: 'a', title: 'A' }),
    'codex:b': SESSION({ client: 'codex', sessionId: 'b', title: 'B' }),
    'mystery:c': SESSION({ client: 'mystery', sessionId: 'c', title: 'C' }),
  });
  const rendered = run('renderSessions()');
  assert.ok(rendered.includes('id="session-tool-filter"'));
  assert.ok(rendered.includes('data-session-client=""'), 'All keeps an empty value');
  assert.ok(rendered.includes('aria-label="全部"') && rendered.includes('aria-pressed="true"'),
    'All starts selected and pressed');
  assert.ok(rendered.includes('data-session-client="claude"'), 'Every tool gets a control');
  assert.ok(rendered.includes('aria-label="Claude Code"') && rendered.includes('title="Claude Code"'),
    'Icon controls are named by their client label');
  assert.ok(rendered.includes('>mystery</button>'), 'A tool without artwork keeps a readable text label');
  assert.ok(rendered.includes(run('ICO_SVG["gemini-cli"]')) === false, 'No borrowed CLI marks appear uninvited');
  const strip = rendered.slice(rendered.indexOf('id="session-tool-filter"'), rendered.indexOf('class="sort"'));
  const controls = (strip.match(/<button[^>]*data-session-client="/g) || []).length;
  assert.equal(controls, 4, 'All plus the three tools, nothing else');
});

test('sessions: a tool glyph uses the explicit tools domain, not a model vendor', () => {
  const { run } = listApp({
    'gemini:a': SESSION({ client: 'gemini', sessionId: 'a', title: 'G' }),
    'claude:b': SESSION({ sessionId: 'b', title: 'C' }),
  });
  const rendered = run('renderSessions()');
  const strip = rendered.slice(rendered.indexOf('id="session-tool-filter"'), rendered.indexOf('class="sort"'));
  assert.ok(strip.includes(run('ICO_SVG["gemini-cli"]')), 'Gemini CLI keeps its own mark');
  assert.ok(strip.includes('#1E1E2E'), 'Gemini CLI keeps its client colour');
  assert.ok(!strip.includes(run('ICO_SVG.gemini')), 'The toolbar never borrows the Gemini model mark');
});

test('sessions: clicking a tool filters this list only and clicking it again clears', () => {
  const map = {
    'claude:a': SESSION({ sessionId: 'a', title: 'A' }),
    'claude:a2': SESSION({ sessionId: 'a2', title: 'A2' }),
    'codex:b': SESSION({ client: 'codex', sessionId: 'b', title: 'B' }),
  };
  const { run } = listApp(map);
  run('setSessionTool("codex")');
  let rendered = run('renderSessions()');
  assert.deepEqual(names(rendered), ['B'], 'Only the chosen tool stays');
  assert.ok(rendered.includes('data-session-client="claude"'), 'The rest of the option set is still offered');
  assert.ok(rendered.includes('aria-pressed="true"') && rendered.includes('aria-pressed="false"'));
  assert.equal(run('state.sessionClient'), 'codex');
  run('setSessionTool("codex")');
  rendered = run('renderSessions()');
  assert.deepEqual(names(rendered).sort(), ['A', 'A2', 'B'], 'Clicking the selected tool clears it');
  assert.equal(run('state.sessionClient'), '');
  run('setSessionTool("claude")');
  run('setSessionTool("")');
  assert.equal(run('state.sessionClient'), '', 'All clears any selection');
  assert.deepEqual(names(run('renderSessions()')).sort(), ['A', 'A2', 'B']);
});

test('sessions: a selection that the period no longer offers returns to All', () => {
  const { run } = listApp({ 'claude:a': SESSION({ sessionId: 'a', title: 'A' }), 'codex:b': SESSION({ client: 'codex', sessionId: 'b', title: 'B' }) });
  run('setSessionTool("codex"); renderSessions();');
  assert.equal(run('state.sessionClient'), 'codex');
  run(`state.stats.periods.today = { sessions: { 'claude:a': ${JSON.stringify(SESSION({ sessionId: 'a', title: 'A' }))} } };`);
  const rendered = run('renderSessions()');
  assert.equal(run('state.sessionClient'), '', 'A stale selection cannot hide the new period');
  assert.deepEqual(names(rendered), ['A']);
  assert.ok(rendered.includes('data-session-client="claude"'));
  assert.ok(!rendered.includes('data-session-client="codex"'), 'Options follow the current period');
});

test('sessions: filtering and hub changes reset the visible batch', () => {
  const map = {};
  for (let i = 0; i < 120; i += 1) {
    map[`${i % 2 ? 'claude' : 'codex'}:s${i}`] = SESSION({ client: i % 2 ? 'claude' : 'codex', sessionId: `s${i}`, title: `T${i}`, totalTokens: 100 + i });
  }
  const { run } = listApp(map);
  const count = () => (run('renderSessions()').match(/class="row session-row"/g) || []).length;
  run('showMoreSessions(); showMoreSessions();');
  assert.equal(count(), 120);
  run('setSessionTool("claude")');
  assert.equal(count(), 50, 'A new filter starts from the first batch');
  run('setSessionTool("")');
  assert.equal(count(), 50);
  run('showMoreSessions();');
  assert.equal(count(), 100);
  run('resetSessionState()');
  assert.equal(run('state.sessionClient'), '', 'A different Hub starts from All');
  assert.equal(count(), 50);
});

test('sessions: the strip scrolls horizontally inside a bounded row', () => {
  const css = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  const rule = css.match(/\.session-tools \{[^}]*\}/);
  assert.ok(rule, 'The strip has its own rule');
  assert.ok(/overflow-x:\s*auto/.test(rule[0]), 'Narrow screens scroll the strip, not the page');
  assert.ok(/max-width:\s*100%/.test(rule[0]));
  assert.ok(/\.session-row \{[^}]*flex-wrap:\s*wrap/.test(css), 'Session rows wrap instead of colliding');
  assert.ok(/\.session-name \{[^}]*text-overflow:\s*ellipsis/.test(css), 'Long titles ellipsize inside a bounded line');
  assert.ok(/\.session-name \{[^}]*white-space:\s*nowrap/.test(css), 'Collapsed titles stay on one line');
});

// --- Slice 4: availability, omissions and safety --------------------------
test('sessions: missing or empty session maps say no details, not no usage', () => {
  const none = listApp({});
  const empty = none.run('renderSessions()');
  assert.ok(empty.includes('暂无可用的会话明细'), 'An absent map is honestly reported');
  assert.ok(!empty.includes('暂无数据'), 'It is not confused with "no data"');
  assert.ok(!empty.includes('data-session-more'));

  const valid = listApp({});
  valid.run('state.stats.periods.today = { sessions: {} };');
  assert.ok(valid.run('renderSessions()').includes('暂无可用的会话明细'), 'A valid empty map is the same case');

  const invalid = listApp({});
  invalid.run('state.stats.periods.today = { sessions: [] };');
  assert.ok(invalid.run('renderSessions()').includes('暂无可用的会话明细'));
  // The selected-period usage totals still drive the header; the list never claims otherwise.
  assert.ok(valid.run('renderSessions()').includes('sessions-panel'));
});

test('sessions: TOTAL never borrows month rows and states the all-time limit', () => {
  const monthRow = SESSION({ sessionId: 'm1', title: 'MonthRow' });
  const { run } = listApp({ 'claude:m1': monthRow });
  run(`state.stats.periods.month = { sessions: { 'claude:m1': ${JSON.stringify(monthRow)} } }; state.period = "allTime";`);
  const allTime = run('renderSessions()');
  assert.ok(allTime.includes('全时段'), 'The all-time limitation is stated');
  assert.ok(allTime.includes('DAY') && allTime.includes('MONTH'), 'It points at the periods that do have details');
  assert.ok(!allTime.includes('MonthRow'), 'Month rows are never rendered under TOTAL');
  assert.equal(run('state.sessionClient'), '');
});

test('sessions: real all-time session records are rendered as supplied', () => {
  const real = SESSION({ sessionId: 'at1', title: 'AllTimeRow' });
  const { run } = listApp({ 'claude:at1': real }, { period: 'allTime' });
  run(`state.stats.periods.month = { sessions: { 'claude:m1': ${JSON.stringify(SESSION({ sessionId: 'm1', title: 'MonthRow' }))} } };`);
  const rendered = run('renderSessions()');
  assert.deepEqual(names(rendered), ['AllTimeRow'], 'Only the supplied all-time records appear');
  assert.ok(!rendered.includes('全时段'), 'No limitation notice when the Hub did supply the rows');
  assert.ok(!rendered.includes('MonthRow'));
});

test('sessions: omitted detail counts are surfaced once, without hiding retained rows', () => {
  const map = { 'claude:a': SESSION({ sessionId: 'a', title: 'A' }) };
  const { run } = listApp(map);
  run(`state.stats.sessionDetailsOmitted = { today: 3 };
    state.stats.devices = [{ deviceId: 'dev-a', hostname: 'host-a', sessionDetailsOmitted: { today: 9 },
      periods: { today: { sessions: { 'claude:a': {} } } } }];`);
  const rendered = run('renderSessions()');
  assert.ok(rendered.includes('3 条会话明细未提供'), 'The aggregate omitted count is shown');
  assert.ok(!rendered.includes('12 条会话明细未提供'), 'Aggregate and per-device counts are not summed twice');
  assert.ok(!rendered.includes('9 条会话明细未提供'));
  assert.ok(rendered.includes('role="status"'), 'The partial hint is announced');
  assert.deepEqual(names(rendered), ['A'], 'Retained rows stay visible');
  assert.ok(rendered.includes('id="session-tool-filter"'), 'Filters still work on a partial list');
  const en = listApp(map, { lang: 'en' });
  en.run('state.stats.sessionDetailsOmitted = { today: 3 };');
  assert.ok(en.run('renderSessions()').includes('3 session details were not provided'));
});

test('sessions: the omission hint survives an empty retained list and junk counts stay quiet', () => {
  const empty = listApp({});
  empty.run('state.stats.sessionDetailsOmitted = { today: "4" };');
  const rendered = empty.run('renderSessions()');
  assert.ok(rendered.includes('4 条会话明细未提供'), 'A numeric string count is read');
  assert.ok(rendered.includes('暂无可用的会话明细'), 'The honest empty message still appears');
  for (const bad of ['0', '-2', '"two"', 'true', 'null', '"   "', 'Number.POSITIVE_INFINITY']) {
    const a = listApp({ 'claude:a': SESSION({ sessionId: 'a', title: 'A' }) });
    a.run(`state.stats.sessionDetailsOmitted = { today: ${bad} };`);
    assert.ok(!a.run('renderSessions()').includes('session-note'), `Junk omission count ${bad} shows no hint`);
  }
  // Another period's count never leaks into this one.
  const other = listApp({ 'claude:a': SESSION({ sessionId: 'a', title: 'A' }) });
  other.run('state.stats.sessionDetailsOmitted = { month: 5 };');
  assert.ok(!other.run('renderSessions()').includes('session-note'));
});

test('sessions: compact cards expose complete masked text through native disclosure, not hard truncation', () => {
  const title = '合成会话标题 🧪 '.repeat(30) + '<b>alice@corp.example</b>';
  for (const lang of ['zh', 'en']) {
    const { run } = listApp({ 'claude:long': SESSION({ title, sessionId: 'long-id-'.repeat(40) }) }, { lang });
    const before = run('JSON.stringify(state.stats)');
    const out = run('renderSessions()');
    assert.match(out, /<details class="session-detail">/);
    assert.match(out, /<summary class="session-summary" aria-label="[^"]+">/);
    assert.ok(out.includes(lang === 'zh' ? '展开或收起会话详情' : 'Expand or collapse session details'));
    assert.match(out, /class="session-full-title">[^<]*合成会话标题/);
    assert.ok(out.includes(run(`esc(${JSON.stringify(title)})`)), 'Full text survives display truncation');
    assert.ok(out.includes('long-id-'.repeat(40)), 'Complete ID stays available in the expanded content');
    assert.ok(!out.includes('alice@corp.example') && !out.includes('<b>'), 'Expanded text stays masked and escaped');
    assert.equal(run('JSON.stringify(state.stats)'), before);
  }
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.match(css, /\.session-expanded \{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.session-summary:focus-visible \{[^}]*outline:/, 'Keyboard focus has a visible indicator');
});

test('sessions: identity and title text stays masked, escaped and non-actionable', () => {
  const { run } = listApp({
    'claude:mail': SESSION({
      sessionId: 'someone.private@example.com',
      title: 'Ask <b>alice@corp.example</b> about <script>x</script>',
      models: { 'claude-sonnet-4-5': 10 },
    }),
  });
  run(`state.stats.devices = [{ deviceId: 'dev-a', hostname: 'ana@host.example', periods: { today: { sessions: { 'claude:mail': {} } } } }];`);
  const rendered = run('renderSessions()');
  assert.ok(!rendered.includes('someone.private@example.com'), 'Session ids are masked');
  assert.ok(!rendered.includes('alice@corp.example'), 'Titles are masked');
  assert.ok(!rendered.includes('ana@host.example'), 'Device labels are masked');
  assert.ok(!rendered.includes('<script>') && !rendered.includes('<b>'), 'Markup is escaped');
  assert.ok(rendered.includes('&lt;b&gt;'));
  assert.ok(!/<a\s/i.test(rendered) && !rendered.includes('href='), 'No session id becomes a link');
  const attrs = [...rendered.matchAll(/(?:title|data-[a-z-]+)="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(!attrs.some((v) => v.includes('someone.private@') || v.includes('alice@corp')), 'No raw identifier hides in an attribute');
  assert.ok(attrs.some((v) => v.includes('***')), 'The masked value is what hover exposes');
});

test('sessions: only the existing read-only endpoints and views are involved', () => {
  const source = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  assert.deepEqual([...source.matchAll(/api\("([^"]+)"/g)].map((m) => m[1]).sort(), ['/api/history', '/api/stats']);
  assert.ok(!/\/api\/sync|\/api\/ingest|sessionTitles|title-consent/i.test(source),
    'No title-consent or capability negotiation is added');
  const a = listApp({ 'claude:a': SESSION({ sessionId: 'a', title: 'A' }) });
  for (const view of ['tools', 'models', 'devices', 'limits', 'trends', 'home']) {
    a.run(`state.view = ${JSON.stringify(view)};`);
    const out = a.run('renderMain()');
    assert.ok(out && !out.includes('sessions-panel'), `${view} view is unchanged by the sessions work`);
  }
  const sessions = a.run('state.view = "sessions"; renderMain()');
  assert.ok(sessions.includes('class="sessions-panel"'), 'renderMain serves the sessions view');
});

// --- Narrow-desktop header usability (seven-tab navigation) ----------------
function mediaBlock(minWidth) {
  const marker = `@media (min-width: ${minWidth}px) {`;
  const start = html.indexOf(marker);
  assert.ok(start >= 0, `Missing ${marker}`);
  let depth = 0;
  let from = -1;
  for (let i = start + marker.length - 1; i < html.length; i += 1) {
    if (html[i] === '{') {
      depth += 1;
      if (depth === 1) from = i + 1;
    } else if (html[i] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(from, i);
    }
  }
  throw new Error(`Unbalanced ${marker}`);
}

function ruleIn(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing rule for ${selector}`);
  return match[1];
}

test('sessions: the desktop header keeps its chrome fixed and scrolls only the tab strip', () => {
  const desktop = mediaBlock(860);
  // Header stays a single nowrap row at >=860px.
  assert.match(ruleIn(desktop, '.top'), /flex-wrap:\s*nowrap/, 'Desktop header is one row');
  // Brand and controls must not shrink; a shrinking brand wrapped the name and
  // let the seven-tab strip paint over the period/lang controls.
  assert.match(ruleIn(html, '.brand-group'), /flex:\s*0\s+0\s+auto/, 'Brand group holds its width');
  assert.match(ruleIn(html, '.brand-name'), /white-space:\s*nowrap/, 'Brand name stays on one line');
  assert.match(ruleIn(html, '.top-right'), /flex:\s*0\s+0\s+auto/, 'Header controls hold their width');
  // The tabs remain the flexible middle column, but they scroll internally
  // instead of overflowing visibly into the controls.
  const tabs = ruleIn(desktop, '.tabs');
  assert.match(tabs, /flex:\s*1\s+1\s+auto/, 'Tabs stay the flexible middle column');
  assert.match(tabs, /overflow-x:\s*auto/, 'Tabs scroll inside their own bounded strip');
  assert.doesNotMatch(tabs, /overflow(-x)?:\s*visible/, 'Tabs never overflow visibly');
  assert.match(ruleIn(html, '.tabs'), /min-width:\s*0/, 'The flex item can shrink below content width');
  // The approved desktop layout below the header is unchanged.
  assert.match(ruleIn(desktop, '.home-grid'), /grid-template-columns:\s*minmax\(240px, 320px\) 1fr/);
  assert.match(ruleIn(mediaBlock(1280), '.limits-grid'), /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
});

// --- Extremely narrow viewports (classic scrollbars, 320px) ----------------
function maxWidthBlock(maxWidth) {
  const marker = `@media (max-width: ${maxWidth}px) {`;
  const start = html.indexOf(marker);
  assert.ok(start >= 0, `Missing ${marker}`);
  let depth = 0;
  let from = -1;
  for (let i = start + marker.length - 1; i < html.length; i += 1) {
    if (html[i] === '{') {
      depth += 1;
      if (depth === 1) from = i + 1;
    } else if (html[i] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(from, i);
    }
  }
  throw new Error(`Unbalanced ${marker}`);
}

test('sessions: classic scrollbars never resize the header and 320px still fits the period control', () => {
  // A stable gutter reserves the vertical scrollbar whether or not the current
  // view scrolls, so switching views cannot change the header's usable width;
  // overlay scrollbars (mobile) take no extra slot.
  assert.match(ruleIn(html, 'html'), /scrollbar-gutter:\s*stable/, 'The root reserves a stable scrollbar gutter');
  // At 320px with a classic 15px scrollbar only 273px remain after the header
  // padding, so the three period chips plus EN and the gear need tighter
  // horizontal padding to stay on one row.
  const narrow = maxWidthBlock(359);
  const seg = ruleIn(narrow, '.seg button');
  assert.match(seg, /padding-left:\s*9px/, 'Narrow segments keep their left padding tight');
  assert.match(seg, /padding-right:\s*9px/, 'Narrow segments keep their right padding tight');
  assert.doesNotMatch(seg, /padding-(top|bottom)\s*:/, 'Vertical segment padding stays as authored');
  assert.ok(
    html.indexOf('@media (max-width: 359px)') > html.indexOf('.seg button {'),
    'The narrow override follows the base segment rule it refines',
  );
  assert.match(ruleIn(html, '.seg button'), /padding:\s*6px\s+11px/, 'Roomier segments stay the default above 359px');
});
