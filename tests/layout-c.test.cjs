'use strict';
// Layout C: the three standalone Models/Tools/Devices lists become light cards
// on a capped two-column grid; Sessions stays one full-width list. These tests
// exercise the real renderMain()/render* output from synthetic Hub fixtures and
// pin the scoped CSS contract. They never touch credentials or a live Hub.
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

// Same boot boundary as tests/sessions.test.cjs: no DOM, no network.
function app(lang = 'en') {
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

// Synthetic period: 700 + 290 major models, three sub-1% models, four clients.
const PERIOD = {
  totalTokens: 1000,
  costUsd: 1,
  clients: { claude: 400, codex: 300, gemini: 200, cursor: 100 },
  clientCosts: { claude: 0.4, codex: 0.3, gemini: 0.2, cursor: 0.1 },
  models: { 'claude-sonnet-4-5': 700, 'kimi-k3': 290, 'tiny-a': 4, 'tiny-b': 3, 'tiny-c': 3 },
  modelCosts: { 'claude-sonnet-4-5': 0.7, 'kimi-k3': 0.29, 'tiny-a': 0.004, 'tiny-b': 0.003, 'tiny-c': 0.003 },
};
const FOLD_PERIOD = {
  totalTokens: 100007,
  costUsd: 2,
  clients: { claude: 100007 },
  clientCosts: { claude: 2 },
  models: { big: 100000, 'tiny-a': 4, 'tiny-b': 2, 'tiny-c': 1 },
  modelCosts: { big: 1.99, 'tiny-a': 0.004, 'tiny-b': 0.002, 'tiny-c': 0.001 },
};
const ONE_PERIOD = {
  totalTokens: 500, costUsd: 0.5,
  clients: { claude: 500 }, clientCosts: { claude: 0.5 },
  models: { 'claude-sonnet-4-5': 500 }, modelCosts: { 'claude-sonnet-4-5': 0.5 },
};
const DEVICES = [
  { deviceId: 'dev-1', hostname: 'Studio', osName: 'macOS', receivedAt: '2026-11-09T23:00:00.000Z',
    periods: { today: { totalTokens: 600, costUsd: 0.6 } } },
  { deviceId: 'dev-2', hostname: 'Laptop', osName: 'Linux', receivedAt: '2026-11-09T22:00:00.000Z',
    periods: { today: { totalTokens: 400, costUsd: 0.4 } } },
];
const SESSION = (n, over = {}) => ({
  title: `Session ${n} — a very long session title that must wrap instead of pushing the values away`,
  client: 'claude',
  sessionId: `sess-${n}`,
  totalTokens: 1000 + n,
  costUsd: 0.25,
  messageCount: 3,
  inputTokens: 100,
  cacheReadTokens: 900,
  cacheWriteTokens: 0,
  outputTokens: 200,
  cacheReported: true,
  startedAt: '2026-11-09T20:00:00.000Z',
  lastUsedAt: '2026-11-09T23:30:00.000Z',
  models: { 'claude-sonnet-4-5': 1000 + n },
  ...over,
});

function viewApp(name, { period = PERIOD, devices = [], sessions = null, lang = 'en' } = {}) {
  const a = app(lang);
  const payload = { periods: { today: sessions ? { ...period, sessions } : period }, devices };
  a.run(`state.stats = ${JSON.stringify(payload)};
    state.period = "today"; state.view = ${JSON.stringify(name)};`);
  return a;
}
function sessionsFixture(n = 60) {
  const map = {};
  for (let i = 1; i <= n; i += 1) map[`claude:sess-${i}`] = SESSION(i);
  return map;
}

// --- CSS helpers -----------------------------------------------------------
function blockRules(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) found.push([m[1].trim().replace(/\s+/g, ' '), m[2]]);
  return found;
}
function rule(selector, text = css) {
  const want = selector.trim().replace(/\s+/g, ' ');
  const hits = blockRules(text).filter(([sel]) => sel === want);
  assert.ok(hits.length, `Missing CSS rule: ${selector}`);
  // The first hit is the unconditional rule; later hits live inside media blocks.
  return hits[0][1];
}
function maybeRule(selector, text = css) {
  const want = selector.trim().replace(/\s+/g, ' ');
  const hits = blockRules(text).filter(([sel]) => sel === want);
  return hits.length ? hits[hits.length - 1][1] : '';
}
function media(query) {
  const needle = `@media (${query})`;
  const start = css.lastIndexOf(needle);
  if (start < 0) return null;
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}
function fnSource(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing function ${name}`);
  const end = script.indexOf('\nfunction ', start + 1);
  return script.slice(start, end < 0 ? script.length : end);
}

// --- Slice 1: standalone pages share one full-width grid --------------------

test('layout-c: tools, models and devices render inside the usage-grid wrapper', () => {
  const expectedRows = { tools: 4, models: 2, devices: 2 };
  for (const name of ['tools', 'models', 'devices']) {
    const out = viewApp(name, { devices: name === 'devices' ? DEVICES : [] }).run('renderMain()');
    assert.ok(out.includes('<div class="list-wrap usage-grid">'), `${name} uses list-wrap usage-grid`);
    assert.ok(!out.includes('<div class="list-wrap">'), `${name} no longer uses the capped bare wrapper`);
    assert.ok(!out.includes('session-list'), `${name} is not the sessions wrapper`);
    assert.equal((out.match(/class="row" style=/g) || []).length, expectedRows[name], `${name} keeps one row per entry`);
  }
});

test('layout-c: sessions keeps a full-width one-column list and home/limits/trends are unaffected', () => {
  const sessions = viewApp('sessions', { sessions: sessionsFixture() }).run('renderMain()');
  assert.ok(sessions.includes('<div class="list-wrap session-list">'), 'sessions uses list-wrap session-list');
  assert.ok(!sessions.includes('usage-grid'), 'sessions never becomes a card grid');
  for (const name of ['home', 'limits', 'trends']) {
    const out = viewApp(name).run('renderMain()');
    assert.ok(!out.includes('usage-grid'), `${name} does not receive the standalone grid`);
    assert.ok(!out.includes('session-list'), `${name} does not receive the sessions wrapper`);
  }
});

test('layout-c CSS contract: usage grid lifts the 760px cap and caps at two columns from 1100px', () => {
  const base = rule('.list-wrap.usage-grid');
  assert.match(base, /max-width:\s*none/);
  assert.match(base, /display:\s*grid/);
  assert.match(base, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(base, /gap:\s*8px 16px/);
  assert.ok(!/repeat\(/.test(base), 'the default is exactly one column');
  const wide = media('min-width: 1100px');
  assert.ok(wide, 'Missing the 1100px breakpoint');
  assert.match(rule('.list-wrap.usage-grid', wide), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  const wider = media('min-width: 1280px') || '';
  assert.ok(!wider.includes('usage-grid'), 'no third column is added at 1280px or above');
  // The shared reading measure survives for non-target contexts (Home).
  assert.ok(html.includes('.list-wrap { max-width: 760px; }'), 'Home keeps its 760px measure');
});

test('layout-c CSS contract: only direct standalone rows become light cards', () => {
  const card = rule('.list-wrap.usage-grid > .row');
  assert.match(card, /border:\s*1px solid var\(--line\)/);
  assert.match(card, /border-radius:\s*10px/);
  assert.match(card, /background:\s*var\(--card\)/);
  assert.match(card, /padding:\s*10px 12px/);
  assert.match(rule('.list-wrap.usage-grid > .row:last-child'), /border-bottom:\s*1px solid var\(--line\)/);
  // The shared .row idiom itself stays borderless so Home/other callers are unchanged.
  const shared = maybeRule('.row');
  assert.match(shared, /border-bottom:\s*1px solid var\(--line\)/);
  assert.ok(!/border-radius/.test(shared), 'the shared row is not globally carded');
  assert.ok(!/--card/.test(shared), 'the shared row keeps its transparent background');
});

test('compact cards: bar spacing is not counted twice and the home bar stays unchanged', () => {
  assert.match(rule('.list-wrap.usage-grid > .row'), /gap:\s*6px/);
  const bar = rule('.list-wrap.usage-grid .row-bar');
  assert.match(bar, /height:\s*3px/);
  assert.match(bar, /margin-top:\s*0/);
  assert.match(rule('.row-bar'), /height:\s*6px/);
  assert.match(rule('.row-bar'), /margin-top:\s*8px/);
});

// --- Slice 2: models folding, single item, empty states ---------------------

test('layout-c: other models spans both columns and keeps its folding, control and data behaviour', () => {
  const a = viewApp('models', { period: FOLD_PERIOD });
  const out = a.run('renderMain()');
  assert.equal((out.match(/<details class="other-models">/g) || []).length, 1);
  assert.equal((out.match(/data-model-detail="/g) || []).length, 3, 'one chip per folded model');
  assert.ok(out.includes('other models'));
  assert.ok(out.includes('3 models · each below 1%'));
  // Real values survive folding: 4 + 2 + 1 tokens, 0.004 + 0.002 + 0.001 cost.
  assert.ok(out.includes('<span class="usage-value">7</span>'), 'folded token total is conserved');
  assert.ok(out.includes('$0.0070'), 'folded cost total is conserved');
  assert.ok(out.includes('data-model-detail="0"') && out.includes('aria-haspopup="dialog"'));
  assert.ok(out.includes('aria-controls="quota-dialog"'));
  // The chips live inside the details block, after the one major row, and are not rows/cards.
  const listStart = out.lastIndexOf('<div class="other-model-list">');
  const listEnd = out.indexOf('</div></details>', listStart);
  assert.ok(listStart > 0 && listEnd > listStart, 'chips stay inside the details body');
  assert.equal((out.slice(listStart, listEnd).match(/class="row"/g) || []).length, 0, 'chips never become rows');
  assert.ok(out.endsWith('</details></div>'), 'details is the last grid child');

  const shell = rule('.list-wrap.usage-grid > .other-models');
  assert.match(shell, /grid-column:\s*1 \/ -1/);
  assert.match(shell, /border-radius:\s*10px/);
  assert.match(shell, /background:\s*var\(--card\)/);
  const summary = rule('.list-wrap.usage-grid > .other-models > summary');
  assert.match(summary, /border:\s*0/, 'the nested summary is not an independent card');
  assert.ok(!/border-radius/.test(summary), 'the nested summary has no card radius');
  assert.ok(!/background/.test(summary), 'the nested summary has no card fill');
});

test('layout-c: a lone top-level item spans the full grid instead of a half-empty page', () => {
  for (const [name, period, devices] of [
    ['models', ONE_PERIOD, []],
    ['tools', ONE_PERIOD, []],
    ['devices', PERIOD, DEVICES.slice(0, 1)],
  ]) {
    const out = viewApp(name, { period, devices }).run('renderMain()');
    assert.equal((out.match(/class="row" style=/g) || []).length, 1, `${name} renders exactly one row`);
    assert.ok(!out.includes('other-models'), `${name} has no folding group`);
  }
  // Cap 1 already ordered a lone row across the grid.
  assert.match(rule('.list-wrap.usage-grid > :only-child'), /grid-column:\s*1 \/ -1/);
});

test('layout-c: empty standalone states span the full grid', () => {
  const empty = { totalTokens: 0, costUsd: 0, clients: {}, clientCosts: {}, models: {}, modelCosts: {} };
  for (const name of ['tools', 'models', 'devices']) {
    const out = viewApp(name, { period: empty, devices: [] }).run('renderMain()');
    assert.match(out, /<div class="list-wrap usage-grid"><p class="empty">/, `${name} keeps one full-width empty state`);
    assert.ok(!out.includes('other-models'), `${name} does not invent a folding group`);
  }
  assert.match(rule('.list-wrap.usage-grid > .empty'), /grid-column:\s*1 \/ -1/);
});

// --- Slice 2: sessions invariants ------------------------------------------

test('layout-c: sessions keeps one full-width column with its filters, sort, 50-more and exact values', () => {
  const a = viewApp('sessions', { sessions: sessionsFixture(60) });
  const out = a.run('renderMain()');
  assert.ok(out.includes('<div class="list-wrap session-list">'));
  assert.equal((out.match(/class="row session-row"/g) || []).length, 50, 'the first batch stays 50 rows');
  assert.ok(out.includes('id="session-tool-filter"'), 'client filter toolbar is kept');
  const toolbar = out.slice(out.indexOf('id="session-tool-filter"'), out.indexOf('</div>', out.indexOf('id="session-tool-filter"')));
  assert.equal((toolbar.match(/data-session-client="/g) || []).length, 2, 'one filter control per client plus All');
  assert.ok(out.includes('class="sort"'), 'sort bar is kept');
  assert.ok(out.includes('data-session-more'), 'the remaining 10 rows stay behind the more button');
  assert.ok(out.includes('Load more (10 remaining)'), 'the more label counts the hidden rows');
  assert.ok(out.includes('title="Session 60 — a very long session title that must wrap instead of pushing the values away"'),
    'the full session title is preserved for disclosure and the title tooltip');
  assert.ok(out.includes('<span class="usage-value">1,060</span>'), 'exact token totals are unchanged');
  assert.ok(out.includes('$0.2500'), 'exact cost is unchanged');
  const list = rule('.list-wrap.session-list');
  assert.match(list, /max-width:\s*none/);
  assert.ok(!/grid-template-columns/.test(list), 'sessions never gains desktop columns');
  assert.ok(!(media('min-width: 1100px') || '').includes('session-list'), 'sessions is not touched by the 1100px grid switch');
});

test('layout-c: the sessions wrapper is scoped, so the shared list cap still applies elsewhere', () => {
  const wide = media('min-width: 860px');
  assert.ok(wide && wide.includes('.list-wrap { max-width: 760px; }'), 'the 860px cap is retained verbatim');
  assert.ok(!/\.list-wrap\s*\{[^}]*max-width:\s*none/.test(css), 'the global wrapper is not uncapped');
});

// --- Slice 3: narrow-screen guards ----------------------------------------

test('compact cards: mobile separates names from a full-width exact-value line', () => {
  assert.match(rule('.list-wrap.usage-grid > .row .nm'), /overflow-wrap:\s*anywhere/);
  assert.match(rule('.list-wrap.usage-grid > .row .nm small'), /overflow-wrap:\s*anywhere/);
  const narrow = media('max-width: 599px');
  assert.ok(narrow, 'Mobile layout must include both 320px and 430px phones');
  assert.match(rule('.list-wrap.usage-grid > .row .nm', narrow), /flex:\s*1 1 calc\(100% - 34px\)/);
  const values = rule('.list-wrap.usage-grid > .row .vals', narrow);
  assert.match(values, /width:\s*100%/);
  assert.match(values, /display:\s*flex/);
  assert.match(values, /justify-content:\s*space-between/);
  assert.match(values, /flex-wrap:\s*wrap/, 'extreme costs can wrap without clipping exact tokens');
  assert.ok(!/font-size/.test(values), 'density must not come from shrinking the values');
  assert.match(rule('.list-wrap.usage-grid .usage-value', narrow), /min-width:\s*10ch/, 'reserve a token column so mobile percentages line up');
  assert.ok(!/white-space:\s*normal/.test(rule('.row .tok')), 'shared typography is unchanged');
});

// --- Slice 4: 375px-class readable card names (no three-character columns) --

test('layout-c CSS contract: card names keep a readable measure at every width and values drop to their own line', () => {
  // The squeeze happened only above the <=359 guard: .nm { flex: 1 } has a zero
  // basis, so at 375px the value block kept its intrinsic width and the name was
  // crushed to ~33px (one three-character column per line). The basis must be
  // unconditional so a wrapped line gives the name a real measure.
  const nm = rule('.list-wrap.usage-grid > .row .nm');
  assert.match(nm, /flex:\s*1 1 180px/, 'the name asks for a 180px basis instead of 0');
  assert.match(nm, /min-width:\s*0/, 'the name may still shrink inside one line');
  assert.match(nm, /overflow-wrap:\s*anywhere/, 'long single tokens still break');
  const vals = rule('.list-wrap.usage-grid > .row .vals');
  assert.match(vals, /margin-left:\s*auto/, 'wrapped values stay right-aligned');
  assert.match(rule('.list-wrap.usage-grid > .row > div'), /flex-wrap:\s*wrap/, 'wrapping is not limited to 359px');
  // Phones use an explicit name line instead of content-dependent wrapping.
  const narrow = media('max-width: 599px');
  assert.match(rule('.list-wrap.usage-grid > .row .nm', narrow), /flex: 1 1 calc\(100% - 34px\)/);
  // Mechanism check in real output: card rows wrap, so the basis above can take effect.
  for (const [name, rows] of [['models', 2], ['tools', 4], ['devices', 2]]) {
    const out = viewApp(name, { devices: name === 'devices' ? DEVICES : [] }).run('renderMain()');
    assert.equal((out.match(/class="row" style="flex-wrap:wrap/g) || []).length, rows,
      `${name} rows still wrap their value block onto a second line`);
  }
});

test('layout-c: the readable-name fix stays scoped to the standalone cards', () => {
  assert.match(rule('.row .nm'), /flex:\s*1;/, 'the shared name column keeps its original flex');
  assert.ok(!/flex:\s*1 1 180px/.test(rule('.row .nm')), 'Home rows never gain the card basis');
  assert.ok(!/margin-left:\s*auto/.test(rule('.row .vals')), 'Home values never gain the card auto margin');
  for (const name of ['home', 'limits', 'trends']) {
    const out = viewApp(name).run('renderMain()');
    assert.ok(!out.includes('usage-grid'), `${name} still bypasses the card rules`);
  }
  const sessions = viewApp('sessions', { sessions: sessionsFixture() }).run('renderMain()');
  assert.ok(!sessions.includes('usage-grid'), 'sessions keeps its own title disclosure rules');
});

// --- Baseline guards (already green before layout C) -----------------------

test('layout-c: render helpers stay presentation-only and never infer the active view', () => {
  for (const name of ['renderBars', 'renderModelList', 'renderDevices', 'sessionRowHtml']) {
    assert.ok(!/state\.view/.test(fnSource(name)), `${name} must not branch on state.view`);
  }
  const main = fnSource('renderMain');
  assert.equal((main.match(/list-wrap usage-grid/g) || []).length, 3, 'exactly models, tools and devices opt in');
  assert.equal((fnSource('renderSessions').match(/list-wrap session-list/g) || []).length, 1, 'sessions opts into its own wrapper');
  assert.equal((script.match(/list-wrap usage-grid/g) || []).length, 3, 'no other view silently joins the grid');
});

test('layout-c: existing data maths are untouched (tokens, cost and share)', () => {
  const tools = viewApp('tools').run('renderMain()');
  assert.ok(tools.includes('<span class="usage-value">400</span>'), 'tool tokens unchanged');
  assert.ok(tools.includes('<span class="usage-share">40.0%</span>'), 'tool share unchanged');
  assert.ok(tools.includes('$0.4000'), 'tool cost unchanged');
  const devices = viewApp('devices', { devices: DEVICES }).run('renderMain()');
  assert.ok(devices.includes('<span class="usage-value">600</span>'));
  assert.ok(devices.includes('<span class="usage-share">60.0%</span>'));
  assert.ok(devices.includes('$0.6000'));
  const models = viewApp('models').run('renderMain()');
  assert.ok(models.includes('<span class="usage-value">700</span>'));
  assert.ok(models.includes('<span class="usage-share">70.0%</span>'));
});

test('layout-c: index.html keeps CRLF endings', () => {
  const raw = readFileSync(FILE);
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === 0x0a) { lf += 1; if (raw[i - 1] === 0x0d) crlf += 1; }
  }
  assert.ok(lf > 0 && lf === crlf, `bare LF found: ${lf - crlf}`);
});
