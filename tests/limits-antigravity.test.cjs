const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const html = readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const context = vm.createContext({
  document: {
    getElementById: () => null,
  },
  window: {
    matchMedia: () => ({ matches: false }),
  },
});

// Load the presentation and limits helpers into context
for (const [start, end] of [
  ['const I18N =', 'function views('],
  ['const META =', 'const WIN_LAB ='],
  ['const WIN_LAB =', 'const $ ='],
  ['const state =', 'function loadCfg('],
  ['function esc(', 'function dailyList('],
]) {
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing helper block: ${start}`);
  vm.runInContext(html.slice(startIndex, endIndex), context);
}

function setLimitsStats(providers) {
  vm.runInContext(`state.stats = { limits: { providers: ${JSON.stringify(providers)} } }; state.lang = 'zh';`, context);
}

const toHost = (val) => (val === undefined || val === null ? val : JSON.parse(JSON.stringify(val)));

const antigravityQuotaWindow = (w) => toHost(vm.runInContext(`antigravityQuotaWindow(${JSON.stringify(w)})`, context));
const antigravityQuotaGroups = (p) => toHost(vm.runInContext(`antigravityQuotaGroups(${JSON.stringify(p)})`, context));
const antigravityQuotaWindowVisible = (w) => vm.runInContext(`antigravityQuotaWindowVisible(${JSON.stringify(w)})`, context);
const limitLeft = (p) => vm.runInContext(`limitLeft(${JSON.stringify(p)})`, context);
const windowWide = (w, wins, pid) => vm.runInContext(`windowWide(${JSON.stringify(w)}, ${JSON.stringify(wins)}, ${JSON.stringify(pid)})`, context);
const limitProviderCompactWindows = (pid, wins) => toHost(vm.runInContext(`limitProviderCompactWindows(${JSON.stringify(pid)}, ${JSON.stringify(wins)})`, context));
const renderLimits = (full) => vm.runInContext(`renderLimits(${Boolean(full)})`, context);
const meta = (id) => toHost(vm.runInContext(`meta(${JSON.stringify(id)})`, context));
const ico = (id) => vm.runInContext(`ico(${JSON.stringify(id)})`, context);

test('Antigravity grouped quota window parsing handles session, weekly, and non-matching labels', () => {
  const gSession = antigravityQuotaWindow({ kind: 'session', label: 'Gemini 5-hour' });
  assert.deepEqual(gSession, { groupLabel: 'Gemini', windowLabel: '5-hour' });

  const cWeekly = antigravityQuotaWindow({ kind: 'weekly', label: 'Claude/GPT weekly' });
  assert.deepEqual(cWeekly, { groupLabel: 'Claude/GPT', windowLabel: 'Weekly' });

  const aWeekly = antigravityQuotaWindow({ kind: 'weekly', label: 'Gemini 4 Argon weekly' });
  assert.deepEqual(aWeekly, { groupLabel: 'Gemini 4 Argon', windowLabel: 'Weekly' });

  // Case-insensitivity check
  const mixedCase = antigravityQuotaWindow({ kind: 'session', label: 'Custom Model 5-Hour' });
  assert.deepEqual(mixedCase, { groupLabel: 'Custom Model', windowLabel: '5-hour' });

  // Legacy pool or non-matching labels return null
  assert.equal(antigravityQuotaWindow({ kind: 'weekly', label: 'Gemini Pro' }), null);
  assert.equal(antigravityQuotaWindow({ kind: 'weekly', label: 'Claude' }), null);
  assert.equal(antigravityQuotaWindow({ kind: 'session', label: 'Session' }), null);
  assert.equal(antigravityQuotaWindow(null), null);
});

test('Antigravity quota groups orders Gemini -> Claude/GPT -> Gemini 4 Argon -> others', () => {
  const provider = {
    provider: 'antigravity',
    windows: [
      { kind: 'weekly', label: 'Gemini weekly', remainingPercent: 90 },
      { kind: 'weekly', label: 'Gemini 4 Argon weekly', remainingPercent: 100 },
      { kind: 'session', label: 'Claude/GPT 5-hour', remainingPercent: 50 },
      { kind: 'session', label: 'Gemini 5-hour', remainingPercent: 80 },
      { kind: 'weekly', label: 'Claude/GPT weekly', remainingPercent: 70 },
      { kind: 'session', label: 'Experimental 5-hour', remainingPercent: 60 },
    ],
  };

  const groups = antigravityQuotaGroups(provider);
  assert.equal(groups.length, 4);
  assert.deepEqual(groups.map((g) => g.label), ['Gemini', 'Claude/GPT', 'Gemini 4 Argon', 'Experimental']);

  // Within each group, session comes before weekly
  assert.equal(groups[0].windows[0].windowLabel, '5-hour');
  assert.equal(groups[0].windows[1].windowLabel, 'Weekly');
  assert.equal(groups[1].windows[0].windowLabel, '5-hour');
  assert.equal(groups[1].windows[1].windowLabel, 'Weekly');
  assert.equal(groups[2].windows[0].windowLabel, 'Weekly');

  // Legacy pools return empty groups array (falls back to flat layout)
  const legacyProvider = {
    provider: 'antigravity',
    windows: [
      { kind: 'weekly', label: 'Gemini Pro', remainingPercent: 50 },
      { kind: 'weekly', label: 'Claude', remainingPercent: 50 },
    ],
  };
  assert.deepEqual(antigravityQuotaGroups(legacyProvider), []);
});

test('Full Limits view renders Antigravity groups in canonical order with side-by-side pairs', () => {
  setLimitsStats([
    {
      provider: 'antigravity',
      planName: 'Google One AI Premium',
      windows: [
        { kind: 'weekly', label: 'Gemini 4 Argon weekly', remainingPercent: 95 },
        { kind: 'weekly', label: 'Claude/GPT weekly', remainingPercent: 75 },
        { kind: 'session', label: 'Gemini 5-hour', remainingPercent: 85 },
        { kind: 'weekly', label: 'Gemini weekly', remainingPercent: 88 },
        { kind: 'session', label: 'Claude/GPT 5-hour', remainingPercent: 60 },
      ],
    },
  ]);

  const rendered = renderLimits(true);
  assert.ok(rendered.includes('class="win-group"'));
  assert.ok(rendered.includes('aria-label="Gemini"'));
  assert.ok(rendered.includes('aria-label="Claude/GPT"'));
  assert.ok(rendered.includes('aria-label="Gemini 4 Argon"'));

  const geminiIdx = rendered.indexOf('aria-label="Gemini"');
  const claudeIdx = rendered.indexOf('aria-label="Claude/GPT"');
  const argonIdx = rendered.indexOf('aria-label="Gemini 4 Argon"');
  assert.ok(geminiIdx < claudeIdx && claudeIdx < argonIdx, 'Group order must be Gemini -> Claude/GPT -> Gemini 4 Argon');

  // Grouped window cells show period labels
  assert.ok(rendered.includes('>5-hour</span>'));
  assert.ok(rendered.includes('>Weekly</span>'));
});

test('Argon weekly-only group spans full width in grouped layout', () => {
  const windows = [
    { kind: 'session', label: 'Gemini 5-hour', remainingPercent: 80 },
    { kind: 'weekly', label: 'Gemini weekly', remainingPercent: 90 },
    { kind: 'weekly', label: 'Gemini 4 Argon weekly', remainingPercent: 100 },
  ];
  const argonWindow = windows[2];
  const geminiSession = windows[0];
  const geminiWeekly = windows[1];

  assert.equal(windowWide(argonWindow, windows, 'antigravity'), true, 'Argon weekly-only should be wide');
  assert.equal(windowWide(geminiSession, windows, 'antigravity'), false, 'Gemini 5-hour is half-width');
  assert.equal(windowWide(geminiWeekly, windows, 'antigravity'), false, 'Gemini weekly is half-width');

  // Verify in full Limits rendering: Argon has wide class
  setLimitsStats([
    {
      provider: 'antigravity',
      windows,
    },
  ]);
  const rendered = renderLimits(true);
  const argonGroupHtml = rendered.slice(rendered.indexOf('aria-label="Gemini 4 Argon"'));
  assert.ok(argonGroupHtml.includes('class="win wide"'), 'Argon weekly cell must have class "win wide"');
});

test('Unknown readings do not render a percent or bar, while real 0% remains an exhausted meter', () => {
  setLimitsStats([
    {
      provider: 'antigravity',
      windows: [
        { kind: 'session', label: 'Gemini 5-hour', remainingPercent: null, usedPercent: null, resetsAt: '2026-10-20T20:00:00Z' },
        { kind: 'weekly', label: 'Gemini weekly', remainingPercent: 0, usedPercent: 100 },
      ],
    },
  ]);

  const rendered = renderLimits(true);
  // Unknown lane must not fabricate 100% left or NaN% left
  assert.ok(!rendered.includes('100% left'), 'Unknown window must not show 100% left');
  assert.ok(!rendered.includes('NaN% left'), 'Unknown window must not show NaN% left');

  // Unknown lane has label and reset time, but no progress bar
  const geminiGroup = rendered.slice(rendered.indexOf('aria-label="Gemini"'));
  assert.ok(geminiGroup.includes('>5-hour</span>'));

  // Weekly lane at real 0% shows 0% left and exhausted bar
  assert.ok(geminiGroup.includes('0% left'), 'Real 0% must show "0% left"');
  assert.ok(geminiGroup.includes('width:0%'), 'Real 0% must show exhausted meter width:0%');
});

test('Legacy pool windows are hidden when unknown and visible at real 0%', () => {
  const legacyWindows = [
    { kind: 'weekly', label: 'Gemini Pro', remainingPercent: null, usedPercent: null },
    { kind: 'weekly', label: 'Gemini Flash', remainingPercent: 0, usedPercent: 100 },
    { kind: 'weekly', label: 'Claude', remainingPercent: 45, usedPercent: 55 },
  ];

  assert.equal(antigravityQuotaWindowVisible(legacyWindows[0]), false, 'Unknown legacy pool is hidden');
  assert.equal(antigravityQuotaWindowVisible(legacyWindows[1]), true, '0% legacy pool is visible');
  assert.equal(antigravityQuotaWindowVisible(legacyWindows[2]), true, 'Measured legacy pool is visible');

  setLimitsStats([
    {
      provider: 'antigravity',
      windows: legacyWindows,
    },
  ]);

  const rendered = renderLimits(true);
  assert.ok(!rendered.includes('Gemini Pro'), 'Unknown legacy pool row must be omitted entirely');
  assert.ok(rendered.includes('Gemini Flash'), 'Real 0% legacy pool must remain visible');
  assert.ok(rendered.includes('0% left'), 'Real 0% legacy pool shows 0% left');
  assert.ok(rendered.includes('Claude'), 'Measured legacy pool must be visible');
  assert.ok(rendered.includes('45% left'), 'Measured legacy pool shows 45% left');
});

test('limitLeft ignores unknown readings for min-remaining calculation', () => {
  // Provider with only unknown windows returns 999
  assert.equal(limitLeft({ windows: [{ remainingPercent: null, usedPercent: null }] }), 999);

  // Provider with a measured window and an unknown window: unknown is ignored
  const pMixed = {
    windows: [
      { remainingPercent: null, usedPercent: null },
      { remainingPercent: 35, usedPercent: 65 },
    ],
  };
  assert.equal(limitLeft(pMixed), 35);

  // Provider with a real 0% remaining
  const pZero = {
    windows: [
      { remainingPercent: null, usedPercent: null },
      { remainingPercent: 0, usedPercent: 100 },
    ],
  };
  assert.equal(limitLeft(pZero), 0);
});

test('Home compact picks <= 2 tightest windows per group, preferring session unless weekly is critical', () => {
  const windows = [
    { kind: 'session', label: 'Gemini 5-hour', remainingPercent: 80 },
    { kind: 'weekly', label: 'Gemini weekly', remainingPercent: 90 },
    { kind: 'session', label: 'Claude/GPT 5-hour', remainingPercent: 50 },
    { kind: 'weekly', label: 'Claude/GPT weekly', remainingPercent: 70 },
    { kind: 'weekly', label: 'Gemini 4 Argon weekly', remainingPercent: 100 },
  ];

  // 1. Session preferred when weekly is not critical: picks Claude/GPT 5-hour (50%) and Gemini 5-hour (80%)
  const compact1 = limitProviderCompactWindows('antigravity', windows);
  assert.equal(compact1.length, 2);
  assert.deepEqual(compact1.map((w) => w.label), ['Gemini 5-hour', 'Claude/GPT 5-hour']);

  // 2. Weekly critical (< 20%): Claude/GPT weekly at 10% overrides its session
  const criticalWindows = [
    { kind: 'session', label: 'Gemini 5-hour', remainingPercent: 80 },
    { kind: 'weekly', label: 'Gemini weekly', remainingPercent: 90 },
    { kind: 'session', label: 'Claude/GPT 5-hour', remainingPercent: 50 },
    { kind: 'weekly', label: 'Claude/GPT weekly', remainingPercent: 10 },
    { kind: 'weekly', label: 'Gemini 4 Argon weekly', remainingPercent: 100 },
  ];
  const compact2 = limitProviderCompactWindows('antigravity', criticalWindows);
  assert.equal(compact2.length, 2);
  assert.deepEqual(compact2.map((w) => w.label), ['Gemini 5-hour', 'Claude/GPT weekly']);

  // 3. Single visible group picks up to two windows (session + weekly)
  const singleGroup = [
    { kind: 'session', label: 'Gemini 5-hour', remainingPercent: 40 },
    { kind: 'weekly', label: 'Gemini weekly', remainingPercent: 60 },
  ];
  const compactSingle = limitProviderCompactWindows('antigravity', singleGroup);
  assert.equal(compactSingle.length, 2);
  assert.deepEqual(compactSingle.map((w) => w.label), ['Gemini 5-hour', 'Gemini weekly']);

  // 4. Compact rendering labels reflect group and period
  setLimitsStats([
    {
      provider: 'antigravity',
      windows: criticalWindows,
    },
  ]);
  const compactHtml = renderLimits(false);
  assert.ok(compactHtml.includes('Gemini · 5-hour'));
  assert.ok(compactHtml.includes('Claude/GPT · Weekly'));
});

test('Non-antigravity providers render unchanged on full and compact', () => {
  const codexWindows = [
    { kind: 'session', label: 'Session', remainingPercent: 70 },
    { kind: 'weekly', label: 'Weekly', remainingPercent: 80 },
    { kind: 'weekly', label: 'Luna Reserve', additional: true, remainingPercent: 100 },
  ];

  // Compact drops additional for codex
  const codexCompact = limitProviderCompactWindows('codex', codexWindows);
  assert.equal(codexCompact.length, 2);
  assert.equal(codexCompact.some((w) => w.additional), false);

  setLimitsStats([
    {
      provider: 'codex',
      windows: codexWindows,
    },
    {
      provider: 'claude',
      windows: [
        { kind: 'session', remainingPercent: 85 },
        { kind: 'weekly', remainingPercent: 95 },
      ],
    },
  ]);

  const fullHtml = renderLimits(true);
  assert.ok(fullHtml.includes('Codex'));
  assert.ok(fullHtml.includes('Luna Reserve'), 'Full limits view includes Codex additional');
  assert.ok(fullHtml.includes('Claude'));

  const compactHtml = renderLimits(false);
  assert.ok(!compactHtml.includes('Luna Reserve'), 'Home compact view drops Codex additional');
});

test('P1 and P2 providers and icons are covered in META and ICO_SVG', () => {
  const requiredProviders = [
    'notion', 'goose', 'alibaba', 'devin', 'droid', 'factory',
    'stepfun', 'typesafe', 'zaiteam', 'amp', 'omp', 'catpaw',
    'unsloth', 'nvidia', 'fx', 'sub2api',
  ];

  for (const id of requiredProviders) {
    const m = meta(id);
    assert.ok(m, `META entry missing for ${id}`);
    assert.ok(m.name, `META name missing for ${id}`);
    assert.ok(m.color, `META color missing for ${id}`);
    assert.notEqual(m.color, '#FFFFFF', `Color for ${id} must not be invisible #FFFFFF on light page`);

    const iconHtml = ico(id);
    assert.ok(iconHtml.includes('<svg'), `ICO_SVG missing for ${id}`);
    assert.ok(iconHtml.includes('width="16"'), `Icon for ${id} must be 16px wide`);
    assert.ok(iconHtml.includes('height="16"'), `Icon for ${id} must be 16px high`);
  }

  // Notion AI and Goose specific labels and dark neutrals
  assert.equal(meta('notion').name, 'Notion AI');
  assert.equal(meta('alibaba').name, 'Alibaba Cloud');
  assert.equal(meta('zaiteam').name, 'GLM Team');
});
