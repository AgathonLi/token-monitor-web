'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { webcrypto } = require('node:crypto');
const { installFixedClock } = require('./helpers/fixed-clock.cjs');
const NOW = Date.parse('2026-11-10T00:00:00Z');

function clock(now = NOW) {
  const context = vm.createContext({});
  installFixedClock(context, now);
  return (code) => vm.runInContext(code, context);
}

test('fixed clock: zero-argument construction, callable Date and now agree', () => {
  const run = clock();
  assert.equal(run('Date.now()'), NOW);
  assert.equal(run('new Date().getTime()'), NOW);
  assert.equal(run('Date()'), run('new Date().toString()'));
  assert.equal(run('Date(0)'), run('Date()'), 'callable Date ignores arguments like the native function');
});

test('fixed clock: explicit dates, invalid values, parse, UTC and subclass semantics survive', () => {
  const run = clock();
  assert.equal(run('new Date(0).getTime()'), 0);
  assert.equal(run('new Date(null).getTime()'), 0);
  assert.ok(Number.isNaN(run('new Date(undefined).getTime()')));
  assert.ok(Number.isNaN(run('new Date("invalid").getTime()')));
  assert.equal(run('new Date("2026-11-09T00:00:00Z").getTime()'), Date.parse('2026-11-09T00:00:00Z'));
  assert.equal(run('Date.parse("2026-11-09T00:00:00Z")'), Date.parse('2026-11-09T00:00:00Z'));
  assert.equal(run('Date.UTC(2026, 10, 9)'), Date.UTC(2026, 10, 9));
  assert.equal(run('new Date(2020, 1, 29).getDate()'), 29);
  assert.equal(run('new Date() instanceof Date'), true);
  assert.equal(run('(() => { class Child extends Date {} const d = new Child(); return d instanceof Child && d instanceof Date && +d === Date.now(); })()'), true);
});

test('fixed clock: contexts and the host remain independent', () => {
  const HostDate = Date, hostNow = Date.now;
  const first = clock(NOW), second = clock(0);
  assert.equal(first('Date.now()'), NOW);
  assert.equal(second('new Date().getTime()'), 0);
  assert.equal(Date, HostDate);
  assert.equal(Date.now, hostNow);
  assert.throws(() => installFixedClock(vm.createContext({}), NaN), TypeError);
});

test('fixed clock: civil-date fallback is independent of ambient day and follows the supplied Hub timezone', () => {
  const script = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const start = script.indexOf('$("gate-form").addEventListener');
  assert.ok(start > 0);
  for (const ambient of ['2026-11-10T00:00:00Z', '2026-11-11T23:59:59Z', '2027-01-01T00:00:00Z']) {
    const context = vm.createContext({
      crypto: webcrypto, TextEncoder, URL, setTimeout, clearTimeout,
      window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
      document: { getElementById: () => null, addEventListener() {} },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    });
    const run = (code) => vm.runInContext(code, context);
    // Replace the ambient VM clock first; the app harness must override both paths.
    run(`Date = class extends Date { constructor(...args) { super(...(args.length ? args : [${Date.parse(ambient)}])); } };`);
    installFixedClock(context, NOW);
    run(script.slice(0, start));
    run('state.history = { timeZone: "UTC", daily: [{ date: "2026-11-10", tokens: 50, activeTimeMs: 180000 }] };');
    assert.equal(run('civilYmd()'), '2026-11-10', ambient);
    assert.equal(run('streakAndTime().streak'), 1, ambient);
    assert.equal(run('addCivilDays("2026-11-10", -1)'), '2026-11-09');
    run('state.stats = { periodWindows: { timeZone: "America/Los_Angeles" } };');
    assert.equal(run('civilYmd()'), '2026-11-09', 'Hub timezone, not UTC slicing, defines the civil day');
    assert.equal(run('streakAndTime().streak'), 0);
    run('state.stats.periodWindows.timeZone = "Asia/Shanghai";');
    assert.equal(run('civilYmd()'), '2026-11-10');
    assert.equal(run('streakAndTime().streak'), 1);
  }
});
