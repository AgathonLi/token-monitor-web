const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
const script = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

function app(kind = 'quotaDetail') {
  const timers = new Map();
  let nextTimer = 0;
  function node(owner = null) {
    const listeners = new Map();
    const e = { owner, listeners, hidden: false, hover: false, focused: false, isConnected: true,
      dataset: {}, style: {}, setAttribute() {},
      getBoundingClientRect: () => ({ left: 100, right: 128, top: 100, bottom: 128, width: 420, height: 120 }),
      contains(n) { return n === this || n?.owner === this; },
      matches(selector) { return (selector.includes(':hover') && this.hover) || (selector.includes(':focus-visible') && this.focused); },
      closest() { return this.dataset[kind] != null ? this : this.owner?.dataset[kind] != null ? this.owner : null; },
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      fire(type, event = {}) { for (const fn of listeners.get(type) || []) fn({ type, pointerType: 'mouse', target: this, relatedTarget: null, ...event }); },
    };
    return e;
  }
  const main = node(), preview = node(), button = node(), outside = node();
  const child = node(button), previewChild = node(preview);
  button.dataset[kind] = '0';
  preview.hidden = true;
  const elements = { main, 'quota-preview': preview };
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, URL, innerWidth: 1280, innerHeight: 800,
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
    document: { getElementById: id => elements[id] || null, addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  vm.runInContext(script.slice(0, script.indexOf('$("gate-form").addEventListener')), context);
  context.showItemDetails = trigger => context.renderDetailPreview(trigger, '<p>Synthetic details</p>');
  const start = script.lastIndexOf('$("main").addEventListener("click"');
  const end = script.indexOf('$("dlg-form").addEventListener', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(script.slice(start, end), context);
  return { main, preview, button, child, previewChild, outside, timers,
    run: expression => vm.runInContext(expression, context),
    flush() { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) fn(); },
  };
}

for (const kind of ['quotaDetail', 'modelDetail']) {
  test(`${kind}: moving from button padding into its child then stopping never closes details`, () => {
    const a = app(kind);
    a.button.hover = true;
    a.main.fire('pointerover', { target: a.button, relatedTarget: a.outside });
    assert.equal(a.preview.hidden, false);
    a.main.fire('pointerout', { target: a.button, relatedTarget: a.child });
    a.main.fire('pointerover', { target: a.child, relatedTarget: a.button });
    a.flush();
    assert.equal(a.preview.hidden, false);
  });

  test(`${kind}: traversing the gap and returning from the preview keeps it open`, () => {
    const a = app(kind);
    a.button.hover = true;
    a.main.fire('pointerover', { target: a.button });
    a.button.hover = false;
    a.main.fire('pointerout', { target: a.child, relatedTarget: a.outside });
    a.preview.hover = true;
    a.preview.fire('pointerenter');
    a.flush();
    assert.equal(a.preview.hidden, false);
    a.preview.hover = false; a.button.hover = true;
    a.preview.fire('pointerleave', { relatedTarget: a.child });
    a.flush();
    assert.equal(a.preview.hidden, false);
    a.button.hover = false;
    a.main.fire('pointerout', { target: a.button, relatedTarget: a.outside });
    a.flush();
    assert.equal(a.preview.hidden, true);
  });

  test(`${kind}: delayed close checks actual preview hover before hiding`, () => {
    const a = app(kind);
    a.button.hover = true;
    a.main.fire('pointerover', { target: a.button });
    a.button.hover = false;
    a.main.fire('pointerout', { target: a.child, relatedTarget: a.outside });
    a.preview.hover = true;
    a.flush();
    assert.equal(a.preview.hidden, false);
    a.preview.hover = false;
    a.preview.fire('pointerleave', { relatedTarget: a.outside });
    a.flush();
    assert.equal(a.preview.hidden, true);
  });

  test(`${kind}: overlapping leave timers cannot survive re-entry`, () => {
    const a = app(kind);
    a.button.hover = true;
    a.main.fire('pointerover', { target: a.button });
    a.button.hover = false;
    a.main.fire('pointerout', { target: a.child, relatedTarget: a.outside });
    a.main.fire('focusout', { target: a.button, relatedTarget: a.outside });
    a.button.hover = true;
    a.main.fire('pointerover', { target: a.button, relatedTarget: a.outside });
    a.flush();
    assert.equal(a.preview.hidden, false);
    assert.equal(a.timers.size, 0);
  });

  test(`${kind}: keyboard focus remains active until it really leaves`, () => {
    const a = app(kind);
    a.run('state.lastInput="keyboard"');
    a.button.focused = true;
    a.main.fire('focusin', { target: a.button });
    a.main.fire('focusout', { target: a.child, relatedTarget: a.outside });
    a.flush();
    assert.equal(a.preview.hidden, false);
    a.button.focused = false;
    a.main.fire('focusout', { target: a.button, relatedTarget: a.outside });
    a.flush();
    assert.equal(a.preview.hidden, true);
  });
}
