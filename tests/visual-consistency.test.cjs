'use strict';
// Third-batch presentation contract: the six subpage summaries share one
// readable type scale, keep the home hero unchanged, and expose the token unit
// as real text while the value node stays numeric for paint().
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
const headline = html.slice(html.indexOf('<div class="headline">'), html.indexOf('<div class="banner"'));

function app(lang = 'zh', view = 'limits', period = 'today') {
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
  vm.runInContext(`state.lang = ${JSON.stringify(lang)}; state.view = ${JSON.stringify(view)}; state.period = ${JSON.stringify(period)};`, context);
  return {
    run: (expression) => vm.runInContext(expression, context),
    context,
  };
}

function node() {
  return {
    textContent: '', title: '', hidden: false,
    setAttribute() {},
  };
}

test('summary markup keeps period, numeric value, real token unit, cost and timestamp in order', () => {
  const order = ['id="hero-k"', 'class="sep"', 'class="hero-amount"', 'id="hero-n"',
    'class="hero-unit">tokens<', 'id="hero-c"', 'id="asof"'];
  let cursor = -1;
  for (const marker of order) {
    const at = headline.indexOf(marker);
    assert.ok(at > cursor, `${marker} should follow the previous summary part`);
    cursor = at;
  }
  assert.equal((headline.match(/<span class="sep" aria-hidden="true">·<\/span>/g) || []).length, 2,
    'both separators are decorative and hidden from assistive technology');
  assert.match(headline, /<span class="hero-unit">tokens<\/span>/, 'the token unit is real text, not a CSS pseudo-element');
  const valueStart = headline.indexOf('<div class="big" id="hero-n">');
  const valueEnd = headline.indexOf('</div>', valueStart);
  const unitAt = headline.indexOf('<span class="hero-unit">tokens</span>');
  assert.ok(unitAt > valueEnd, 'the unit follows the closed numeric value node');
  assert.ok(unitAt < headline.indexOf('</div>', valueEnd + 6), 'the unit shares the amount wrapper with the value');
});

test('the numeric value node stays pure so paint() continues to write a bare number', () => {
  const valueNode = headline.match(/<div class="big" id="hero-n">([^<]*)<\/div>/);
  assert.ok(valueNode, 'hero-n markup is present');
  assert.equal(valueNode[1].trim(), '—');
  assert.ok(!/tokens/i.test(valueNode[1]), 'the unit is never written into hero-n textContent');
  assert.match(script, /\$\("hero-n"\)\.textContent = fmtFull\(p\.totalTokens\);/);
  assert.match(script, /state\.view !== "home" && el\.id === "hero-n"/);
});

test('the token unit is plain text DOM and the separators are aria-hidden without CSS content', () => {
  assert.match(headline, /<span class="hero-unit">tokens<\/span>/);
  assert.doesNotMatch(css, /\.hero-unit::?(?:before|after)/, 'no pseudo-element supplies the unit');
  assert.doesNotMatch(css, /\.hero-unit\s*\{[^}]*content:/, 'no content property supplies the unit');
  assert.match(headline, /<span class="sep" aria-hidden="true">·<\/span>/);
});

test('summary labels use the approved short period names in both languages', () => {
  const expected = {
    zh: { today: '今日', month: '本月', allTime: '累计' },
    en: { today: 'Today', month: 'This month', allTime: 'All-time' },
  };
  for (const lang of Object.keys(expected)) {
    for (const period of Object.keys(expected[lang])) {
      const a = app(lang, 'limits', period);
      assert.equal(a.run('summaryTokensLabel()'), expected[lang][period], `${lang} ${period}`);
      assert.equal(a.run('periodTokensLabel()'), lang === 'zh'
        ? { today: '今日 TOKENS', month: '本月 TOKENS', allTime: '累计 TOKENS' }[period]
        : { today: 'TOKENS TODAY', month: 'TOKENS THIS MONTH', allTime: 'ALL-TIME TOKENS' }[period]);
    }
  }
});

test('applyStaticLang writes short labels on subpages and the full tokens label on home', () => {
  const a = app('zh', 'models', 'month');
  const nodes = new Map();
  a.context.document = {
    documentElement: {},
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, node());
      return nodes.get(id);
    },
    addEventListener() {},
  };
  a.run('applyStaticLang()');
  assert.equal(nodes.get('hero-k').textContent, '本月');
  a.run('state.view = "home"; applyStaticLang()');
  assert.equal(nodes.get('hero-k').textContent, '本月 TOKENS');
  a.run('state.lang = "en"; state.view = "sessions"; state.period = "allTime"; applyStaticLang()');
  assert.equal(nodes.get('hero-k').textContent, 'All-time');
  a.run('state.view = "home"; applyStaticLang()');
  assert.equal(nodes.get('hero-k').textContent, 'ALL-TIME TOKENS');
});

test('every subpage summary part uses the 14px/22px, zero-tracking, shared-font scale', () => {
  const rules = {
    k: css.match(/#app:not\(\.view-home\) \.hero \.k\s*\{([^}]*)\}/)[1],
    big: css.match(/#app:not\(\.view-home\) \.hero \.big\s*\{([^}]*)\}/)[1],
    cost: css.match(/#app:not\(\.view-home\) \.hero \.cost\s*\{([^}]*)\}/)[1],
    unit: css.match(/#app:not\(\.view-home\) \.hero \.hero-unit\s*\{([^}]*)\}/)[1],
    asof: css.match(/#app:not\(\.view-home\) \.asof-hero\s*\{([^}]*)\}/)[1],
  };
  for (const [name, rule] of Object.entries(rules)) {
    assert.match(rule, /font-family:\s*var\(--font\)/, `${name} font family`);
    assert.match(rule, /font-size:\s*14px/, `${name} font size`);
    assert.match(rule, /line-height:\s*22px/, `${name} line height`);
    assert.match(rule, /letter-spacing:\s*0/, `${name} tracking`);
    assert.doesNotMatch(rule, /var\(--num\)|clamp\(|-0\.04em/, `${name} does not inherit home number styling`);
  }
  assert.match(rules.k, /font-weight:\s*400/, 'period label is regular weight');
  assert.match(rules.big, /font-weight:\s*600/, 'value is semibold');
  assert.match(rules.cost, /font-weight:\s*600/, 'cost is semibold');
  assert.match(rules.unit, /font-weight:\s*400/, 'unit is regular weight');
  assert.match(rules.asof, /font-weight:\s*400/, 'timestamp is regular weight');
  assert.doesNotMatch(rules.big, /(?:text-overflow|white-space:\s*nowrap)/, 'normal values are neither clipped nor shrunk');
});

test('the timestamp moves to the right edge on desktop and to its own left row below 600px', () => {
  const asof = css.match(/#app:not\(\.view-home\) \.asof-hero\s*\{([^}]*)\}/)[1];
  assert.match(asof, /margin-left:\s*auto/, 'desktop timestamp is pushed to the right edge');
  assert.match(asof, /overflow-wrap:\s*anywhere/, 'long timestamps may wrap instead of overflowing');
  assert.match(css, /#app:not\(\.view-home\) \.asof-hero:empty\s*\{\s*display:\s*none/,
    'an empty timestamp does not reserve a blank row');
  assert.match(css, /@media \(max-width: 599px\)[\s\S]*?#app:not\(\.view-home\) \.asof-hero\s*\{[^}]*flex:\s*0 0 100%[^}]*margin-left:\s*0/,
    'below 600px the timestamp takes its own left-aligned row');
  assert.match(css, /@media \(max-width: 599px\)[\s\S]*?\.cost-group \.sep\s*\{\s*display:\s*none/,
    'the cost separator is dropped when a narrow wrapped line would start with it');
});

test('home keeps its large clamp, its own asof block and its full period label', () => {
  assert.match(css, /\.hero \.big\s*\{[^}]*font-size:\s*clamp\(34px, 9vw, 42px\)/);
  assert.match(css, /\.home-kpis \.big\s*\{[^}]*font-size:\s*clamp\(34px, 8vw, 48px\)/);
  assert.match(css, /@media \(min-width: 860px\)[\s\S]*?\.hero \.big\s*\{[^}]*font-size:\s*clamp\(36px, 3\.2vw, 48px\)/);
  assert.match(html, /<div class="home-kpis">[\s\S]*?<div class="k">\$\{esc\(periodTokensLabel\(\)\)\}<\/div>[\s\S]*?<div class="big">\$\{fmtFull\(p\.totalTokens\)\}<\/div>/);
  assert.match(script, /<\/div>\s*<div class="asof">\$\{esc\(asofText\(\)\)\}<\/div>/);
});

// --- Slice 3: component tokens, states, sizes, role radii and icons --------
// These rules pin one coherent component contract: a small set of semantic
// tokens, one light-blue selected treatment, a separate neutral hover, deep-blue
// focus rings, three radius roles and a 15px section scale. Static hex greys are
// folded back into the audited --muted/--faint/--ink tokens instead of drifting.

function cssBlocks(text = css) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    found.push([m[1].trim().replace(/\s+/g, ' '), m[2]]);
  }
  return found;
}

function ruleDecl(selector, text = css) {
  const want = selector.trim().replace(/\s+/g, ' ');
  const blocks = cssBlocks(text);
  const exact = blocks.filter(([sels]) => sels === want);
  if (exact.length) return exact[0][1];
  const hits = blocks.filter(([sels]) => sels.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).includes(want));
  assert.ok(hits.length, `Missing CSS rule for ${selector}`);
  return hits[0][1];
}

function optionalDecl(selector, text = css) {
  const want = selector.trim().replace(/\s+/g, ' ');
  const hits = cssBlocks(text).filter(([sels]) => sels.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).includes(want));
  return hits.length ? hits[0][1] : '';
}

function cssToken(name) {
  const hit = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(hit, `missing --${name}`);
  return hit[1].trim();
}

test('component tokens are declared once with the approved values and keep the audited text greys', () => {
  assert.equal(cssToken('active-bg'), '#e8f0fe');
  assert.equal(cssToken('active-ink'), '#1a4fbf');
  assert.equal(cssToken('hover-bg'), '#e6eaf0');
  assert.equal(cssToken('r-card'), '12px');
  assert.equal(cssToken('r-control'), '8px');
  assert.equal(cssToken('r-overlay'), '16px');
  assert.equal(cssToken('inset'), '#e7eaee');
  assert.equal(cssToken('muted'), '#525a66', 'muted stays the audited value');
  assert.equal(cssToken('faint'), '#616a76', 'faint stays the audited value');
  assert.equal(cssToken('card'), '#f4f5f7', 'the card surface role is unchanged');
});

test('selected nav, sort, filters, settings tabs and the period control share one light-blue treatment', () => {
  for (const selector of ['.tabs button.on', '.sort button.on', '.session-tools button.on',
    '.menu button.on', '.seg button.on', '.settings-tabs [aria-selected="true"]']) {
    const body = ruleDecl(selector);
    assert.match(body, /background:\s*var\(--active-bg\)/, `${selector} background`);
    assert.match(body, /color:\s*var\(--active-ink\)/, `${selector} ink`);
  }
  const pressed = ruleDecl('.session-tools button[aria-pressed="true"]');
  assert.match(pressed, /background:\s*var\(--active-bg\)/, 'aria-pressed mirrors the .on treatment');
  assert.match(pressed, /color:\s*var\(--active-ink\)/, 'aria-pressed mirrors the .on ink');
});

test('hover keeps a separate neutral wash and never overpaints the selected blue', () => {
  for (const selector of ['.tabs button:not(.on):hover', '.sort button:not(.on):hover',
    '.session-tools button:not(.on):hover', '.seg button:not(.on):hover',
    '.settings-tabs button[aria-selected="false"]:hover', '.quota-info:hover', '.model-chip:hover']) {
    assert.match(ruleDecl(selector), /background:\s*var\(--hover-bg\)/, `${selector} hover wash`);
  }
  for (const [selector, body] of cssBlocks()) {
    if (!/:hover/.test(selector)) continue;
    assert.doesNotMatch(body, /var\(--active-bg\)/, `${selector} hover must not reuse the selected fill`);
  }
  assert.doesNotMatch(ruleDecl('.model-chip:hover'), /#e8f0fe|#dfe9fb/, 'chips hover neutral, not selected blue');
});

test('focus-visible rings use the deep active blue and a real outline on buttons and summaries', () => {
  const summary = ruleDecl('.session-summary:focus-visible');
  assert.match(summary, /outline:\s*2px solid var\(--active-ink\)/);
  assert.match(summary, /outline-offset:\s*3px/);
  for (const selector of ['.tabs button:focus-visible', '.sort button:focus-visible',
    '.session-tools button:focus-visible', '.seg button:focus-visible',
    '.settings-tabs button:focus-visible', '.quota-info:focus-visible', '.model-chip:focus-visible']) {
    const body = ruleDecl(selector);
    assert.match(body, /outline:\s*2px solid var\(--active-ink\)/, `${selector} outline`);
    assert.match(body, /outline-offset:\s*2px/, `${selector} offset`);
  }
  const input = ruleDecl('input[type="text"]:focus-visible');
  assert.match(input, /outline:\s*2px solid #1a4fbf/, 'the audited input ring is not deleted');
  assert.match(input, /outline-offset:\s*2px/);
});

test('every plain button and summary inherits a deep-blue focus ring by default', () => {
  // Regression: the per-group rings left plain controls (the "other models"
  // disclosure summary, the dialog close button, the choice-order toggle) on the
  // UA default outline. One generic default rule must cover them, without
  // touching the more specific session-summary offset or the literal input ring.
  const root = cssToken('active-ink');
  assert.equal(root, '#1a4fbf', 'the default ring colour is the root deep blue token');
  for (const selector of ['button:focus-visible', 'summary:focus-visible']) {
    const body = ruleDecl(selector);
    assert.match(body, /outline:\s*2px solid var\(--active-ink\)/, `${selector} outline`);
    assert.match(body, /outline-offset:\s*2px/, `${selector} offset`);
  }
  const genericMatch = css.match(/^[ \t]*button:focus-visible/m);
  assert.ok(genericMatch, 'the generic default rule starts its own selector list');
  const generic = genericMatch.index;
  assert.ok(generic > css.indexOf('.btn {'), 'the default rule follows the base button style');
  assert.ok(generic > css.indexOf('input[type="text"], input[type="password"] {'),
    'the default rule follows the base input style');
  assert.ok(generic < css.indexOf('.session-summary:focus-visible'),
    'the more specific session-summary offset stays the later override');
  assert.match(ruleDecl('.session-summary:focus-visible'), /outline-offset:\s*3px/);
  assert.match(ruleDecl('input[type="text"]:focus-visible'), /outline:\s*2px solid #1a4fbf/);
});

test('header controls keep a 36px frame: the period group as a whole, and 32px in-page controls', () => {
  assert.match(ruleDecl('.seg'), /padding:\s*3px/, 'the capsule keeps its 3px inner padding');
  assert.match(ruleDecl('.seg button'), /min-height:\s*30px/, '3 + 30 + 3 = the 36px group frame');
  assert.match(ruleDecl('.seg'), /border-radius:\s*999px/, 'the capsule shape stays');
  assert.match(ruleDecl('.lang-btn, .gear-top'), /height:\s*36px/, 'language and gear share the 36px header frame');
  assert.match(ruleDecl('.gear-top'), /width:\s*36px/);
  assert.match(ruleDecl('.sort button'), /min-height:\s*32px/);
  assert.match(ruleDecl('.session-tools button'), /min-height:\s*32px/);
  assert.match(ruleDecl('.btn'), /min-height:\s*44px/, 'primary form buttons keep their 44px target');
  assert.match(ruleDecl('.choice-order button'), /width:\s*32px/);
  assert.match(ruleDecl('.choice-order button'), /height:\s*32px/);
});

test('cards, controls and overlays use the three radius roles instead of ad-hoc values', () => {
  for (const selector of ['.list-wrap.usage-grid > .row', '.list-wrap.usage-grid > .other-models',
    '.session-list > .session-row', '.prov.quota-card', '.chart', '.tile']) {
    assert.match(ruleDecl(selector), /border-radius:\s*var\(--r-card\)/, `${selector} card radius`);
  }
  for (const selector of ['input[type="text"]', '.btn', '.model-chip', '.session-more',
    '.quota-info', '.choice-order button', '.menu button']) {
    assert.match(ruleDecl(selector), /border-radius:\s*var\(--r-control\)/, `${selector} control radius`);
  }
  assert.match(ruleDecl('dialog'), /border-radius:\s*var\(--r-overlay\)/, 'dialog radius role');
  assert.match(ruleDecl('.quota-preview'), /border-radius:\s*var\(--r-overlay\)/, 'preview radius role');
  // Roles that must not be swallowed by the new tokens.
  assert.match(ruleDecl('.ico'), /border-radius:\s*5px/, 'provider marks keep their 5px geometry');
  assert.match(ruleDecl('.bar'), /border-radius:\s*99px/, 'bars keep their pill ends');
  assert.match(ruleDecl('.heat-grid b'), /border-radius:\s*2px/, 'heat cells stay 2px');
  assert.doesNotMatch(css, /\*\s*\{[^}]*border-radius/, 'no global radius reset');
});

test('section headings share 15px while card names, the toolbar and dialogs keep their roles', () => {
  for (const selector of ['.sec-h', '.chart-h', '.tiles-h .title']) {
    assert.match(ruleDecl(selector), /font-size:\s*15px/, `${selector} section scale`);
  }
  assert.match(ruleDecl('.prov-name'), /font-size:\s*14px/);
  assert.match(ruleDecl('.row .nm'), /font-size:\s*14px/);
  const heading = ruleDecl('.page-heading');
  assert.match(heading, /font-size:\s*14px/);
  assert.match(heading, /line-height:\s*22px/);
  assert.match(ruleDecl('.dialog-head h1, .dialog-head h2'), /font-size:\s*18px/);
  assert.match(ruleDecl('.gate-card h1'), /font-size:\s*20px/);
  assert.match(ruleDecl('.tile .v'), /font-size:\s*22px/);
  assert.match(ruleDecl('.chart-label'), /font-size:\s*11px/, 'chart labels keep their 11px');
  assert.match(ruleDecl('.chart-label'), /font-family:\s*ui-monospace/, 'chart font is untouched');
});

test('numeric display roles align digits without changing the frozen summary scale', () => {
  assert.match(ruleDecl('.tile .v'), /font-variant-numeric:\s*tabular-nums/);
  assert.match(ruleDecl('.home-kpis .big'), /font-variant-numeric:\s*tabular-nums/);
  assert.match(ruleDecl('.home-kpis .cost'), /font-variant-numeric:\s*tabular-nums/);
  assert.match(ruleDecl('.hero .cost'), /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /#app:not\(\.view-home\) \.hero \.big\s*\{[^}]*font-size:\s*14px[^}]*line-height:\s*22px/, 'summary slice stays frozen');
  assert.match(css, /#app:not\(\.view-home\) \.hero \.cost\s*\{[^}]*font-size:\s*14px/, 'summary cost stays frozen');
});

test('static grey literals are folded into the audited tokens and no ad-hoc grey survives', () => {
  assert.doesNotMatch(css, /#626b78|#5b616a|#3a3f46/i, 'role greys now come from --muted/--faint/--ink');
  assert.match(ruleDecl('.sub, .account'), /color:\s*var\(--muted\)/, 'account meta inherits the audited muted token');
  assert.doesNotMatch(ruleDecl('.account'), /color:/, 'the account rule no longer re-declares a grey');
  assert.match(ruleDecl('.session-activity'), /color:\s*var\(--muted\)/);
  assert.match(ruleDecl('.quota-meta'), /color:\s*var\(--faint\)/);
  assert.match(ruleDecl('.settings-hint'), /color:\s*var\(--muted\)/);
  assert.match(ruleDecl('.model-chip-usage'), /color:\s*var\(--faint\)/);
  assert.match(ruleDecl('.sec-h'), /color:\s*var\(--ink\)/);
  assert.match(ruleDecl('.chart-h'), /color:\s*var\(--ink\)/);
  assert.match(ruleDecl('.tiles-h .title'), /color:\s*var\(--ink\)/);
});

test('visible action icons are inline SVGs with one stroke weight while chevrons keep their rotation', () => {
  const header = html.slice(html.indexOf('<header class="top">'), html.indexOf('</header>'));
  const gear = header.match(/<button class="gear-top"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(gear, 'the header gear button exists');
  assert.doesNotMatch(gear[1], /⚙/, 'the gear glyph is no longer a text character');
  assert.match(gear[1], /<svg[^>]*viewBox="0 0 24 24"[^>]*stroke-width="1\.7"[^>]*aria-hidden="true"/);
  assert.match(gear[0], /title="设置"/, 'the button keeps its title');

  assert.match(script, /<span class="session-chevron" aria-hidden="true"><svg[^>]*viewBox="0 0 24 24"[^>]*stroke-width="1\.7"[^>]*aria-hidden="true"/);
  assert.match(script, /<span class="other-chevron" aria-hidden="true"><svg[^>]*viewBox="0 0 24 24"[^>]*stroke-width="1\.7"[^>]*aria-hidden="true"/);
  assert.match(css, /\.session-detail\[open\] \.session-chevron\s*\{\s*transform:\s*rotate\(180deg\)/, 'session rotation survives');
  assert.match(css, /\.other-models\[open\] \.other-chevron\s*\{\s*transform:\s*rotate\(180deg\)/, 'other-models rotation survives');
  assert.match(script, /<svg class="sec-arrow"[^>]*stroke-width="1\.7"/, 'the home entry arrow matches the same weight');
  assert.match(script, /<button type="button" class="sec-link" data-v="\$\{view\}"/, 'the entry stays a real button');
  assert.doesNotMatch(css, /\.sec-link\s*\{[^}]*background:\s*rgb/, 'the entry keeps a transparent surface');
});
