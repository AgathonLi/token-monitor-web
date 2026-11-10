const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');

// Fixed clock and UTC keep civil-date expectations independent of the host.
process.env.TZ = 'UTC';
const NOW = Date.parse('2026-11-10T00:00:00Z');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function app(lang = 'zh') {
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, URL, setTimeout, clearTimeout,
    window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
    document: { getElementById: () => null, addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  const start = script.indexOf('$("gate-form").addEventListener');
  assert.ok(start > 0, 'Missing inline app bootstrap boundary');
  vm.runInContext(script.slice(0, start), context);
  vm.runInContext(`state.lang = ${JSON.stringify(lang)}; Date.now = () => ${NOW};`, context);
  return {
    run: (expression) => vm.runInContext(expression, context),
    json: (expression) => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context)),
  };
}

const DAILY = [
  { date: '2026-11-09', tokens: 0, cost: 0, activeTimeMs: 120000 },
  { date: '2026-11-10', tokens: 50, cost: 1, activeTimeMs: 60000 },
];
// Daily-derived values for DAILY at the fixed clock: one active day, streak 1,
// peak 50 tokens, 180000 ms of active time.
const DERIVED = { activeDays: 1, streak: 1, peak: 50, ms: 180000 };

test('history summary: canonical wire fields win over partial daily data', () => {
  const { run, json } = app();
  run(`state.history = { daily: ${JSON.stringify(DAILY)}, summary: {
    activeDays: 9, currentStreak: 4, peakDayTokens: 1000000, activeTimeMs: 5400000 } };`);
  assert.deepEqual(json('streakAndTime()'), { activeDays: 9, streak: 4, peak: 1000000, ms: 5400000 });
});

test('history summary: real zeroes stay authoritative instead of daily fallback', () => {
  const { run, json } = app();
  run(`state.history = { daily: ${JSON.stringify(DAILY)}, summary: {
    activeDays: 0, currentStreak: 0, peakDayTokens: 0, activeTimeMs: 0 } };`);
  assert.deepEqual(json('streakAndTime()'), { activeDays: 0, streak: 0, peak: 0, ms: 0 });
});

test('history summary: missing, invalid and legacy fields fall back to daily data', () => {
  const { run, json } = app();
  run(`state.history = { daily: ${JSON.stringify(DAILY)}, summary: {
    activeDays: null, currentStreak: 'many', peakDayTokens: -5, activeTimeMs: true,
    peakTokens: 777, totalActiveTimeMs: 888 } };`);
  assert.deepEqual(json('streakAndTime()'), DERIVED);
  for (const bad of ['null', 'undefined', '""', '"   "', 'false', '"12x"', '"-3"', 'Number.POSITIVE_INFINITY', 'NaN']) {
    run(`state.history.summary = { activeDays: ${bad}, currentStreak: ${bad}, peakDayTokens: ${bad}, activeTimeMs: ${bad} };`);
    assert.deepEqual(json('streakAndTime()'), DERIVED, `Invalid summary value ${bad} must fall back`);
  }
});

test('history summary: nonblank numeric strings are accepted', () => {
  const { run, json } = app();
  run(`state.history = { daily: ${JSON.stringify(DAILY)}, summary: {
    activeDays: '7', currentStreak: '3', peakDayTokens: ' 1234 ', activeTimeMs: '90000' } };`);
  assert.deepEqual(json('streakAndTime()'), { activeDays: 7, streak: 3, peak: 1234, ms: 90000 });
});

test('history summary: historyPreview summary is used when durable history is absent', () => {
  const { run, json } = app();
  run(`state.history = null; state.stats = { historyPreview: {
    daily: ${JSON.stringify(DAILY)},
    summary: { activeDays: 5, currentStreak: 2, peakDayTokens: 4242, activeTimeMs: 60000 } } };`);
  assert.deepEqual(json('streakAndTime()'), { activeDays: 5, streak: 2, peak: 4242, ms: 60000 });
  run('state.stats = null; state.history = null;');
  assert.deepEqual(json('streakAndTime()'), { activeDays: 0, streak: 0, peak: 0, ms: 0 });
  run(`state.history = { daily: ${JSON.stringify(DAILY)} };`);
  assert.deepEqual(json('streakAndTime()'), DERIVED);
});

test('history summary: reading the summary never mutates the received payload', () => {
  const { run } = app();
  run(`state.history = { daily: ${JSON.stringify(DAILY)}, summary: {
    activeDays: '7', currentStreak: 3, peakDayTokens: 1234, activeTimeMs: 90000 } };`);
  const before = run('JSON.stringify(state.history)');
  run('streakAndTime()');
  assert.equal(run('JSON.stringify(state.history)'), before);
});

// --- Slice 2: lifecycle wording -------------------------------------------
const FUTURE = '2026-11-10T04:00:00Z';
const LATER = '2026-11-12T03:00:00Z';
const PAST = '2026-11-09T20:00:00Z';

function resetText({ lang = 'zh', w, summary = false } = {}) {
  const { run } = app(lang);
  const rendered = run(`renderWin(${JSON.stringify(w)}, "Weekly", "", meta("codex"), {}, ${summary})`);
  const match = rendered.match(/<div class="reset"[^>]*>([^<]*)<\/div>/);
  return { rendered, text: match ? match[1] : '' };
}

test('lifecycle: reset and unknown boundary kinds keep the existing reset wording', () => {
  for (const lang of ['zh', 'en']) {
    assert.equal(resetText({ lang, w: { resetsAt: FUTURE, remainingPercent: 50 } }).text, 'Reset 4h 0m');
    assert.equal(resetText({ lang, w: { resetsAt: LATER, remainingPercent: 50 } }).text, 'Reset 2d 3h');
    assert.equal(resetText({ lang, w: { resetsAt: FUTURE, boundaryKind: 'reset', remainingPercent: 50 } }).text, 'Reset 4h 0m');
    assert.equal(resetText({ lang, w: { resetsAt: FUTURE, boundaryKind: 'legacy', remainingPercent: 50 } }).text, 'Reset 4h 0m');
  }
  assert.equal(resetText({ w: { resetsAt: PAST } }).text, '已到重置时间');
  assert.equal(resetText({ lang: 'en', w: { resetsAt: PAST } }).text, 'Reset due');
});

test('lifecycle: expiry boundary says expiry, not reset, in both languages', () => {
  assert.equal(resetText({ w: { resetsAt: FUTURE, boundaryKind: 'expiry', remainingPercent: 50 } }).text, '到期 4h 0m');
  assert.equal(resetText({ w: { resetsAt: LATER, boundaryKind: 'expiry', remainingPercent: 50 } }).text, '到期 2d 3h');
  assert.equal(resetText({ lang: 'en', w: { resetsAt: FUTURE, boundaryKind: 'expiry', remainingPercent: 50 } }).text, 'Expires 4h 0m');
  assert.equal(resetText({ w: { resetsAt: PAST, boundaryKind: 'expiry' } }).text, '已到期');
  assert.equal(resetText({ lang: 'en', w: { resetsAt: PAST, boundaryKind: 'expiry' } }).text, 'Expired');
});

test('lifecycle: mixed boundary reflects both reset and expiry', () => {
  assert.equal(resetText({ w: { resetsAt: FUTURE, boundaryKind: 'mixed', remainingPercent: 50 } }).text, '重置/到期 4h 0m');
  assert.equal(resetText({ lang: 'en', w: { resetsAt: FUTURE, boundaryKind: 'mixed', remainingPercent: 50 } }).text, 'Changes in 4h 0m');
  assert.equal(resetText({ w: { resetsAt: PAST, boundaryKind: 'mixed' } }).text, '已到重置/到期时间');
  assert.equal(resetText({ lang: 'en', w: { resetsAt: PAST, boundaryKind: 'mixed' } }).text, 'Changes now');
  const future = resetText({ w: { resetsAt: FUTURE, boundaryKind: 'mixed', remainingPercent: 50 } }).text;
  assert.ok(!/^Reset/.test(future) && future !== 'Reset 4h 0m', 'Mixed must not be labelled only Reset');
});

test('lifecycle: summary and complete details agree for every boundary kind', () => {
  for (const boundaryKind of [undefined, 'reset', 'expiry', 'mixed']) {
    for (const resetsAt of [FUTURE, LATER, PAST]) {
      const w = { resetsAt, boundaryKind, remainingPercent: 40 };
      const summary = resetText({ w, summary: true }).text;
      const details = resetText({ w }).text;
      assert.ok(summary, 'Summary must show a boundary line');
      assert.equal(summary, details, `${boundaryKind} ${resetsAt} summary must match details`);
    }
  }
});

test('lifecycle: credits windows follow the same boundary wording as ordinary windows', () => {
  const credits = { kind: 'credits', metric: 'credits', remaining: 5, remainingPercent: 50, resetsAt: FUTURE };
  assert.equal(resetText({ w: { ...credits, boundaryKind: 'expiry' } }).text, '到期 4h 0m');
  assert.equal(resetText({ lang: 'en', w: { ...credits, boundaryKind: 'expiry' } }).text, 'Expires 4h 0m');
  assert.equal(resetText({ w: { ...credits, boundaryKind: 'mixed' } }).text, '重置/到期 4h 0m');
  assert.equal(resetText({ w: credits }).text, 'Reset 4h 0m');
  assert.equal(resetText({ w: { ...credits, boundaryKind: 'expiry', resetsAt: PAST } }).text, '已到期');
});

test('lifecycle: missing or invalid timestamps keep their boundary-appropriate unknown wording', () => {
  for (const w of [{ remainingPercent: 50 }, { resetsAt: 'not-a-date', remainingPercent: 50 }, { resetsAt: '', remainingPercent: 50 }]) {
    const unknown = { reset: '重置时间未知', expiry: '到期时间未知', mixed: '重置/到期时间未知' };
    for (const [boundaryKind, text] of Object.entries(unknown)) {
      const summary = resetText({ w: { ...w, boundaryKind }, summary: true });
      assert.equal(summary.text, text, `${boundaryKind} summary unknown wording`);
      assert.equal(resetText({ w: { ...w, boundaryKind } }).text, '', 'Complete details stay hidden when the summary states the unknown');
      assert.equal(resetText({ lang: 'en', w: { ...w, boundaryKind }, summary: true }).text,
        { reset: 'Reset unavailable', expiry: 'Expiry unavailable', mixed: 'Change time unavailable' }[boundaryKind]);
    }
  }
  const supplied = resetText({ w: { boundaryKind: 'expiry', remainingPercent: 5, resetDescription: '<b>No expiry</b>' }, summary: true });
  assert.equal(supplied.text, '&lt;b&gt;No expiry&lt;/b&gt;', 'A supplied resetDescription is escaped and shown');
});

test('lifecycle: rendering a boundary never mutates the window payload', () => {
  const { run } = app();
  run(`state.windows = [{ kind: 'weekly', boundaryKind: 'mixed', resetsAt: '${FUTURE}', remainingPercent: 50 }];`);
  const before = run('JSON.stringify(state.windows)');
  run('renderWin(state.windows[0], "Weekly", "", meta("codex"), {}, true)');
  assert.equal(run('JSON.stringify(state.windows)'), before);
});

// --- Slice 3: tool/model display context ----------------------------------
const TOOLS_PERIOD = {
  totalTokens: 1000, costUsd: 1,
  clients: { claude: 100, gemini: 90, droid: 80, grok: 70, copilot: 60, omp: 50, mimo: 40, zcode: 30, dsh: 20, fx: 10, mistral: 5, kilo: 4, custom: 3 },
  clientCosts: { claude: 1, gemini: 2, droid: 3, grok: 4, copilot: 5, omp: 6, mimo: 7, zcode: 8, dsh: 9, fx: 10, mistral: 11, kilo: 12, custom: 13 },
  models: { 'gemini-3.8-flash': 600, claude: 400 },
  modelCosts: { 'gemini-3.8-flash': 1, claude: 2 },
};

function toolsHtml() {
  const { run } = app();
  run(`state.stats = { periods: { today: ${JSON.stringify(TOOLS_PERIOD)} } }; state.period = "today"; state.view = "tools";`);
  return run('renderMain()');
}

test('tools: the real Tools view shows stable client labels for every colliding id', () => {
  const rendered = toolsHtml();
  for (const label of ['Claude Code', 'Gemini CLI', 'Factory Droid', 'Grok Build', 'GitHub Copilot',
    'Oh My Pi', 'Xiaomi MiMo', 'ZCode', 'DeepSeek Harness', 'fx', 'Mistral Vibe']) {
    assert.ok(rendered.includes(`>${label}</div>`), `Tools row must display ${label}`);
  }
  for (const stale of ['>Claude<', '>Gemini<', '>Droid<', '>Grok<', '>Copilot<', '>OMP<', '>MiMo Code<', '>GLM<', '>DeepSeek<', '>FX<', '>Mistral<']) {
    assert.ok(!rendered.includes(stale), `Tools row must not keep the colliding label ${stale}`);
  }
  assert.ok(rendered.includes('>custom</div>'), 'Unknown tool ids still render as their id');
});

test('tools: only Tools rows use the Gemini CLI artwork and presentation colour', () => {
  const cli = app().run('ICO_SVG["gemini-cli"]');
  const geminiSvg = app().run('ICO_SVG.gemini');
  assert.ok(cli && geminiSvg && cli !== geminiSvg);
  const tools = toolsHtml();
  const geminiRow = tools.split('<div class="row"').find((row) => row.includes('Gemini CLI'));
  assert.ok(geminiRow, 'Tools view renders a Gemini CLI row');
  assert.ok(geminiRow.includes(cli), 'Tools Gemini row uses the Gemini CLI mark');
  assert.ok(geminiRow.includes('#1E1E2E'), 'Tools Gemini row uses the client presentation colour');

  const { run } = app();
  const full = run(`renderBars(${JSON.stringify([{ id: 'gemini-3.8-flash', tokens: 10, cost: 1, pct: 1 }])}, false)`);
  const compact = run(`renderBars(${JSON.stringify([{ id: 'gemini-3.8-flash', tokens: 10, cost: 1, pct: 1 }])}, true)`);
  const folded = run(`renderModelList(${JSON.stringify([
    { id: 'big', tokens: 990, cost: 1, pct: .99 },
    { id: 'gemini-3.8-flash', tokens: 10, cost: 1, pct: .01 }])}, false)`);
  for (const [name, rendered] of [['full', full], ['compact', compact], ['folded', folded]]) {
    assert.ok(rendered.includes(geminiSvg), `${name} model row keeps the vendor Gemini mark`);
    assert.ok(rendered.includes('#4285f4'), `${name} model row keeps the vendor colour`);
    assert.ok(!rendered.includes(cli), `${name} model row must not borrow the CLI mark`);
  }
  const quota = run(`renderProviderDetails(${JSON.stringify({
    provider: 'gemini', windows: [{ kind: 'weekly', remainingPercent: 50, resetsAt: FUTURE }] })}, true)`);
  assert.ok(quota.includes(geminiSvg) && quota.includes('#4285f4') && !quota.includes(cli),
    'Gemini quota presentation stays on the vendor mark');
});

test('tools: name sorting uses the displayed client labels, model sorting keeps META names', () => {
  const { run } = app();
  const list = JSON.stringify(['copilot', 'fx', 'gemini', 'claude'].map((id, index) => ({ id, tokens: 100 - index, cost: 1, pct: .25 })));
  run(`state.sort.tools = { key: "name", dir: "asc" }; state.sort.models = { key: "name", dir: "asc" };`);
  assert.deepEqual(JSON.parse(run(`JSON.stringify(sortEntries(${list}, "tools").map((x) => x.id))`)),
    ['claude', 'fx', 'gemini', 'copilot']);
  assert.deepEqual(JSON.parse(run(`JSON.stringify(sortEntries(${list}, "models").map((x) => x.id))`)),
    ['claude', 'copilot', 'fx', 'gemini']);
  run('state.sort.tools = { key: "tokens", dir: "desc" };');
  assert.deepEqual(JSON.parse(run(`JSON.stringify(sortEntries(${list}, "tools").map((x) => x.tokens))`)), [100, 99, 98, 97],
    'Token sorting is unchanged');
});

test('tools: unknown clients fall back safely and values stay intact', () => {
  const { run } = app();
  const list = JSON.stringify([
    { id: '<img src=x onerror="alert(1)">', tokens: 10, cost: 1, pct: .5 },
    { id: 'gemini', tokens: 10, cost: 2, pct: .5 },
  ]);
  const before = run('JSON.stringify(state.history)');
  const rendered = run(`renderBars(${list}, false, 0, "tools")`);
  assert.ok(!rendered.includes('<img'), 'Unknown ids are escaped');
  assert.ok(rendered.includes('&lt;img'));
  assert.ok(rendered.includes('#6b7280'), 'Unknown clients keep the neutral fallback colour');
  assert.ok(rendered.includes('$1.0000') && rendered.includes('$2.0000'));
  assert.equal(run('JSON.stringify(state.history)'), before);
});

// --- Slice 4: stable display coverage -------------------------------------
const CATALOG_LABELS = [
  ['claude', 'Claude Code'], ['codex', 'Codex'], ['opencode', 'OpenCode'], ['hermes', 'Hermes Agent'],
  ['openclaw', 'OpenClaw'], ['cursor', 'Cursor'], ['antigravity', 'Antigravity'], ['gemini', 'Gemini CLI'],
  ['cline', 'Cline'], ['amp', 'Amp'], ['droid', 'Factory Droid'], ['kimi', 'Kimi'], ['qwen', 'Qwen'],
  ['grok', 'Grok Build'], ['copilot', 'GitHub Copilot'], ['pi', 'Pi'], ['omp', 'Oh My Pi'],
  ['senpi', 'OmO Native'], ['goose', 'Goose'], ['zed', 'Zed'], ['kilo', 'Kilo'],
  ['commandcode', 'Command Code'], ['mimo', 'Xiaomi MiMo'], ['muse', 'Muse Code'], ['zcode', 'ZCode'],
  ['kiro', 'Kiro'], ['codebuddy', 'CodeBuddy'], ['workbuddy', 'WorkBuddy'], ['proma', 'Proma'],
  ['catpaw', 'CatPaw'], ['qodercn', 'Qoder CN'], ['reasonix', 'Reasonix'], ['dsh', 'DeepSeek Harness'],
  ['cherrystudio', 'Cherry Studio'], ['lmstudio', 'LM Studio'], ['unsloth', 'Unsloth'], ['devin', 'Devin'],
  ['fx', 'fx'], ['mcode', 'MiniMax Code'], ['mistral', 'Mistral Vibe'], ['prime-agent', 'Prime Agent'],
  ['jcode', 'Jcode'],
];

test('stable coverage: every catalog client label is obtainable in Tools context', () => {
  assert.equal(CATALOG_LABELS.length, 42);
  const { run } = app();
  const rows = CATALOG_LABELS.map(([id], index) => ({ id, tokens: 1000 - index, cost: 1, pct: 1 / 42 }));
  const rendered = run(`renderBars(${JSON.stringify(rows)}, false, 0, "tools")`);
  for (const [id, label] of CATALOG_LABELS) {
    assert.ok(rendered.includes(`>${label}</div>`), `Tools label missing for ${id}: ${label}`);
    const row = rendered.split('<div class="row"').find((part) => part.includes(`>${label}</div>`));
    assert.ok(row && row.includes('<svg'), `Icon missing for ${id}`);
  }
  assert.equal(run(`clientMeta("kilo").name + "|" + clientMeta("mcode").name + "|" + clientMeta("prime-agent").name + "|" + clientMeta("jcode").name`),
    'Kilo|MiniMax Code|Prime Agent|Jcode');
});

test('stable coverage: new tool ids carry real artwork while legacy ids stay independent', () => {
  const { run } = app();
  assert.equal(run('ICO_SVG.kilo'), run('ICO_SVG.kilocode'), 'kilo reuses the Kilo artwork');
  assert.equal(run('ICO_SVG.mcode'), run('ICO_SVG.minimax'), 'mcode reuses the MiniMax artwork');
  const prime = run('ICO_SVG["prime-agent"]');
  const jcode = run('ICO_SVG.jcode');
  for (const [name, svg, marker] of [
    ['prime-agent', prime, 'M338 115h5v1H338z'],
    ['jcode', jcode, 'cx="389.65" cy="45.62"'],
    ['manus', run('ICO_SVG.manus'), 'M8.047 1.163'],
    ['opendesign', run('ICO_SVG.opendesign'), 'M292.716 112.374'],
  ]) {
    assert.ok(svg.includes('<svg'), `${name} has artwork`);
    assert.ok(svg.includes('viewBox="'), `${name} has a viewBox`);
    assert.ok(svg.includes('width="16"') && svg.includes('height="16"'), `${name} renders at 16px`);
    assert.ok(svg.includes('aria-hidden="true"'), `${name} is decorative`);
    assert.ok(svg.includes(marker), `${name} keeps the stable artwork geometry`);
  }
  const rendered = run(`renderBars(${JSON.stringify([
    { id: 'kilocode', tokens: 10, cost: 1, pct: .25 },
    { id: 'kilo', tokens: 30, cost: 2, pct: .75 },
  ])}, false, 0, "tools")`);
  assert.equal(rendered.split('<div class="row"').length - 1, 2, 'Legacy kilocode and kilo stay separate rows');
  assert.ok(rendered.includes('>Kilo Code</div>') && rendered.includes('>Kilo</div>'));
  assert.ok(rendered.includes('>10</span>') && rendered.includes('>30</span>'), 'Counters are not combined');
});

test('stable coverage: Manus and OpenDesign providers use readable local artwork', () => {
  const { run } = app();
  for (const [id, name] of [['manus', 'Manus'], ['opendesign', 'OpenDesign']]) {
    const m = JSON.parse(run(`JSON.stringify(meta(${JSON.stringify(id)}))`));
    assert.equal(m.name, name);
    assert.notEqual(m.color, '#FFFFFF', `${id} must not keep upstream white ink on this light page`);
    const icon = run(`ico(${JSON.stringify(id)})`);
    assert.ok(icon.includes('<svg') && icon.includes(m.color));
  }
});

test('stable coverage: model vendor rules match the stable resolver and its near misses', () => {
  const { run } = app();
  const cases = {
    nvidia: ['nemotron-4', 'nvidia/llama-3.1-nemotron-70b'],
    qwen: ['qmodel-72b', 'qwen/qwen3-coder'],
    kimi: ['k2', 'k2-256k', 'k3-256k', 'moonshot/k3-256k', 'kimi-k2'],
    stepfun: ['step-3', 'stepfun/step-2'],
    devin: ['swe-1.5', 'devin-2', 'cognition/swe-1.6'],
  };
  for (const [vendor, ids] of Object.entries(cases)) {
    for (const id of ids) assert.equal(run(`modelVendorFor(${JSON.stringify(id)})`), vendor, `${id} -> ${vendor}`);
  }
  for (const id of ['k20', 'ak3', 'amuse-spark', 'kling', 'muse-wonderful']) {
    assert.equal(run(`modelVendorFor(${JSON.stringify(id)})`), '', `${id} must stay unknown`);
  }
  for (const [id, vendor] of [['k3.1-pro', 'kimi'], ['ling-2.0', 'ling'], ['muse-wonder-1.0', 'meta'], ['big-pickle', 'opencode']]) {
    assert.equal(run(`modelVendorFor(${JSON.stringify(id)})`), vendor, `${id} keeps ${vendor}`);
  }
});

test('stable coverage: new vendor marks render in full and folded model rows', () => {
  const { run } = app();
  for (const [id, vendor] of [['nemotron-4', 'nvidia'], ['k2-256k', 'kimi'], ['step-3', 'stepfun'], ['swe-1.5', 'devin']]) {
    const svg = run(`ICO_SVG[${JSON.stringify(vendor)}]`);
    const full = run(`renderBars(${JSON.stringify([{ id, tokens: 10, cost: 1, pct: 1 }])}, false)`);
    assert.ok(full.includes(svg), `${id} full row uses ${vendor} artwork`);
    const folded = run(`renderModelList(${JSON.stringify([
      { id: 'bulk', tokens: 990, cost: 1, pct: .99 }, { id, tokens: 10, cost: 1, pct: .01 }])}, false)`);
    assert.ok(folded.includes(svg), `${id} folded chip uses ${vendor} artwork`);
  }
});

test('stable coverage: aliasing keeps tokens and costs conserved and the payload untouched', () => {
  const { run } = app();
  const period = { models: { k3: 20, 'k3-256k': 5, 'k2-256k': 7 }, modelCosts: { k3: 2, 'k3-256k': 1, 'k2-256k': 3 } };
  const original = JSON.stringify(period);
  run(`state.period = ${JSON.stringify(period)};`);
  const rows = JSON.parse(run(`JSON.stringify(modelEntries(state.period))`));
  const tokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  assert.equal(tokens, 32);
  assert.ok(Math.abs(cost - 6) < 1e-10);
  assert.ok(rows.some((row) => row.id === 'kimi-k3' && row.tokens === 20), 'Bare k3 keeps its approved alias');
  assert.equal(run('JSON.stringify(state.period)'), original);
});
