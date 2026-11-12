'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
const { installFixedClock } = require('./helpers/fixed-clock.cjs');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const css = html.split('<style>')[1].split('</style>')[0];
function app() {
  const document = { getElementById: () => null, addEventListener() {} };
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, URL, setTimeout, clearTimeout,
    window: { matchMedia: () => ({ matches: false }), addEventListener() {} }, document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  installFixedClock(context, Date.parse('2026-11-12T00:00:00Z'));
  vm.runInContext(script.slice(0, script.indexOf('$("gate-form").addEventListener')), context);
  return { context, run: s => vm.runInContext(s, context) };
}

test('subpages have a wrapping compact headline without changing home totals', () => {
  assert.match(html, /class="headline">\s*<div class="hero">/);
  assert.match(css, /#app:not\(\.view-home\) \.headline\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /#app:not\(\.view-home\) \.hero \.big\s*\{[^}]*font-size:\s*18px/);
  assert.match(css, /#app:not\(\.view-home\) \.asof-hero\s*\{[^}]*padding:\s*0/);
  assert.match(css, /\.hero \.big\s*\{[^}]*font-size:\s*clamp/);
  assert.match(script, /fitTotals\(\)[\s\S]*?el.id === "hero-n"[\s\S]*?continue/);
});

test('cost formatting keeps small amounts distinct and uses the approved thresholds', () => {
  const a = app();
  const cases = [[0, '$0.00'], [0.00000001, '<$0.0001'], [0.00009999, '<$0.0001'],
    [0.0001, '$0.0001'], [0.0081, '$0.0081'], [0.4298, '$0.4298'], [0.9999, '$0.9999'],
    [1, '$1.00'], [8, '$8.00'], [9.42, '$9.42'], [10, '$10.00'], [100, '$100.00'],
    [1000000, '$1000000.00'], ['8', '$8.00'], [null, '$0.00'], [-0.5, '$-0.5000']];
  for (const [value, expected] of cases) {
    assert.equal(a.run(`fmtCost(${JSON.stringify(value)})`), expected, `cost ${value}`);
  }
  assert.equal(a.run('fmtCost(NaN)'), '$0.00');
  assert.equal(a.run('fmtMoney(0.00001, "USD")'), '<$0.0001');
});

test('session disclosure keeps grouped values in its summary and expanded content full width', () => {
  const a = app();
  const out = a.run('sessionRowHtml({ client: "claude", name: "Long title", modelLabel: "model", tokens: 123456, cost: .0081, sessionId: "session-1", device: "NAS", calls: null, cacheHit: null, timeMs: null }, 123456)');
  assert.ok(out.indexOf('class="vals"') < out.indexOf('</summary>'), 'values participate in the two-column summary');
  assert.ok(out.indexOf('session-expanded') > out.indexOf('</summary>'));
  assert.ok(out.includes('session-1') && out.includes('$0.0081'));
  assert.match(css, /@media \(min-width: 600px\)[\s\S]*?\.session-summary\s*\{[^}]*grid-template-columns:/);
  assert.match(css, /\.session-summary > \.vals\s*\{[^}]*padding-left:\s*26px/);
});

test('quota cards size to content rather than clipping into a fixed-height shell', () => {
  const card = css.match(/\.prov\.quota-card\s*\{([^}]*)\}/)[1];
  const summary = css.match(/\.quota-summary\s*\{([^}]*)\}/)[1];
  assert.ok(!/\bheight\s*:|overflow:\s*hidden/.test(card), 'card has no fixed/minimum height or clipping');
  assert.ok(!/overflow:\s*hidden/.test(summary), 'summary retains all selected content vertically');
  assert.match(css, /\.limits-grid\s*\{\s*display:\s*grid;[^}]*align-items:\s*stretch/);
  assert.match(css.match(/\.quota-summary \.reset\s*\{([^}]*)\}/)[1], /white-space:\s*normal/);
  assert.match(css.match(/\.quota-summary \.reset\s*\{([^}]*)\}/)[1], /line-height:\s*1\.3\s*;/, 'reset line height scales with larger text');
});

test('selected navigation is fully revealed after its new selected width is measured', () => {
  const a = app();
  let bounds = { left: 240, right: 306.33 };
  const tabs = { clientWidth: 288, scrollLeft: 100,
    getBoundingClientRect: () => ({ left: 16, right: 304 }),
    querySelector: () => ({ getBoundingClientRect: () => bounds }) };
  a.context.document.getElementById = id => id === 'tabs' ? tabs : null;
  a.run('revealSelectedTab()');
  assert.ok(Math.abs(tabs.scrollLeft - 102.33) < 0.01);
  bounds = { left: 12, right: 60 };
  a.run('revealSelectedTab()');
  assert.ok(Math.abs(tabs.scrollLeft - 98.33) < 0.01);
  bounds = { left: 30, right: 60 };
  a.run('revealSelectedTab()');
  assert.ok(Math.abs(tabs.scrollLeft - 98.33) < 0.01, 'no scrolling when already visible');
  tabs.clientWidth = 0;
  a.run('revealSelectedTab()');
  assert.ok(Math.abs(tabs.scrollLeft - 98.33) < 0.01, 'hidden strip is not scrolled');
  assert.match(script, /function paint\(\)[\s\S]*?revealSelectedTab\(\);/);
  assert.match(script, /addEventListener\("resize"[^\n]*revealSelectedTab\(\)/);
});
