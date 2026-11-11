'use strict';
const vm = require('node:vm');

// Freeze only this VM's wall clock, before evaluating the application. Explicit
// date arguments, parsing, UTC arithmetic and Date subclasses retain semantics.
function installFixedClock(context, now) {
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new TypeError('Expected a finite timestamp');
  vm.runInContext(`(() => {
    const NativeDate = Date;
    const now = ${JSON.stringify(now)};
    globalThis.Date = new Proxy(NativeDate, {
      apply() { return new NativeDate(now).toString(); },
      construct(target, args, newTarget) {
        return Reflect.construct(target, args.length ? args : [now], newTarget);
      },
      get(target, key, receiver) {
        return key === 'now' ? () => now : Reflect.get(target, key, receiver);
      }
    });
  })();`, context);
}

module.exports = { installFixedClock };
