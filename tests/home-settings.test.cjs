const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
function app(storage = new Map()) {
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, URL, setTimeout, clearTimeout,
    window: { matchMedia: () => ({ matches: false }) },
    document: { getElementById: () => null },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
  });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script.slice(0, script.indexOf('$("gate-form").addEventListener')), context);
  const run = code => vm.runInContext(code, context);
  const setProviders = providers => run(`state.stats={periods:{},limits:{providers:${JSON.stringify(providers)}}}`);
  return { context, run, setProviders, storage };
}

test('email masking is idempotent, handles embedded and short/unicode emails, and precedes escaping', () => {
  const { context: c } = app();
  for (const email of ['alice27@example.com', 'a@b.co', 'ab@example.test', '用戶甲@例子.公司']) {
    const masked = c.maskEmails(email);
    assert.notEqual(masked, email);
    assert.ok(masked.includes('***'));
    assert.equal(c.maskEmails(masked), masked);
    assert.ok(!c.esc(`Pro <${email}>`).includes(email));
  }
  assert.equal(c.maskEmails('no account'), 'no account');
});

test('all quota account fields and window labels are masked without changing source data', () => {
  const { context: c, setProviders } = app();
  const mail = 'private27@example.test';
  const p = { provider: 'claude', accountName: `Work ${mail}`, accountEmail: mail, accountLabel: mail,
    planLabel: `Pro ${mail}`, source: mail, windows: [{ kind: 'weekly', label: mail, remainingPercent: 80 }] };
  const original = JSON.stringify(p);
  setProviders([p]);
  const rendered = c.renderLimits(true);
  assert.ok(!rendered.includes(mail));
  assert.ok(rendered.includes('***'));
  assert.ok(!c.providerAccountLabel(p).includes(mail));
  assert.equal(JSON.stringify(p), original);
});

test('opaque account identities survive reorder and distinguish same-provider accounts and Muse devices', async () => {
  const { context: c, run, setProviders } = app();
  const providers = [
    { provider: 'claude', accountKey: 'one@example.test', planLabel: 'Pro' },
    { provider: 'claude', accountKey: 'two@example.test', planLabel: 'Pro' },
    { provider: 'muse', sourceDeviceId: 'nas' }, { provider: 'muse', sourceDeviceId: 'pc' },
  ];
  setProviders(providers); run('state.cfg={hub:"https://one.example.test"}');
  await c.prepareSubscriptions();
  const ids = JSON.parse(run('JSON.stringify(state.catalog.map(x=>x.id))'));
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.every(id => /^[a-f0-9]{64}$/.test(id)));
  setProviders(providers.slice().reverse()); await c.prepareSubscriptions();
  assert.deepEqual(JSON.parse(run('JSON.stringify(state.catalog.map(x=>x.id))')), ids.slice().reverse());
});

test('home choices persist by hub, allow none, and keep missing selections rather than substituting', async () => {
  const storage = new Map();
  const { context: c, run, setProviders } = app(storage);
  const providers = [{ provider: 'claude', accountKey: 'one' }, { provider: 'codex', accountKey: 'two' }];
  setProviders(providers); run('state.cfg={hub:"https://one.example.test"}'); await c.prepareSubscriptions();
  const ids = JSON.parse(run('JSON.stringify(state.catalog.map(x=>x.id))'));
  c.saveDisplayPrefs({ mode: 'manual', ids: ids.slice().reverse() });
  assert.deepEqual(JSON.parse(run('JSON.stringify(homeEntries().map(x=>x.id))')), ids.slice().reverse());
  setProviders(providers.slice(0, 1)); await c.prepareSubscriptions();
  assert.equal(run('homeEntries()[0].p'), null);
  assert.equal(run('homeEntries().length'), 2);
  run('state.cfg={hub:"https://two.example.test"}'); await c.prepareSubscriptions();
  assert.equal(run('state.displayPrefs.mode'), 'auto');
  c.saveDisplayPrefs({ mode: 'manual', ids: [] });
  assert.equal(run('homeEntries().length'), 0);
  run('state.cfg={hub:"https://one.example.test"}'); await c.prepareSubscriptions();
  assert.equal(run('homeEntries().length'), 2);
  c.saveDisplayPrefs({ mode: 'auto', ids: [] });
  assert.equal(run('homeEntries().length'), 1);
  assert.ok(![...storage.values()].join('').includes('example.test'));
  const fresh = app(storage); fresh.setProviders(providers); fresh.run('state.cfg={hub:"https://two.example.test"}');
  await fresh.context.prepareSubscriptions(); assert.equal(fresh.run('homeEntries().length'), 0);
});

test('summary cards retain model-pool identity and expose complete masked details separately', () => {
  const { context: c, run, setProviders } = app();
  const p = { provider: 'antigravity', accountEmail: 'private27@example.test', windows: [
    { kind: 'session', label: 'Gemini 5-hour', remainingPercent: 90 },
    { kind: 'weekly', label: 'Gemini weekly', remainingPercent: 20 },
    { kind: 'session', label: 'Claude/GPT 5-hour', remainingPercent: 70 },
    { kind: 'weekly', label: 'Gemini 4 Argon weekly', remainingPercent: 0 },
  ] };
  setProviders([p]);
  const card = c.renderLimits(true);
  assert.ok(card.includes('quota-card'));
  assert.ok(card.includes('data-quota-detail="0"'));
  const summaries = c.quotaSummary(p);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].window.remainingPercent, 0);
  assert.ok(summaries[0].label.includes('Argon'));
  assert.ok(summaries[1].label.includes('Gemini'));
  const details = c.renderProviderDetails(p);
  for (const label of ['Gemini', 'Claude/GPT', 'Gemini 4 Argon', '5-hour', 'Weekly']) assert.ok(details.includes(label));
  assert.ok(details.includes('0%'));
  assert.ok(!details.includes('private27@example.test'));
  run('state.view="limits"');
  const main = c.renderMain();
  assert.ok(main.indexOf('data-k="name"') < main.indexOf('data-k="left"'));
});

test('settings choices show masked accounts with opaque checkbox ids and retain unavailable selections', async () => {
  const { context: c, run, setProviders } = app();
  const mail = 'private27@example.test';
  setProviders([{ provider: 'claude', accountEmail: mail, accountKey: mail, planLabel: 'Pro' }]);
  await c.prepareSubscriptions();
  run('state.displayDraft={mode:"manual",ids:[state.catalog[0].id,"f".repeat(64)]}');
  const rendered = c.renderDisplayChoices();
  assert.ok(!rendered.includes(mail));
  assert.equal((rendered.match(/type="checkbox"/g) || []).length, 2);
  assert.ok(rendered.includes('data-subscription="' + 'f'.repeat(64) + '"'));
  assert.ok(rendered.includes('暂不可用'));
  assert.ok(rendered.includes('data-move="-1"'));
});

test('only model-page shares strictly below one percent collapse per period without losing cost or tokens', () => {
  const { context: c, run } = app();
  run(`state.view="models";state.stats={periods:{
    today:{models:{large:9801,boundary:100,tiny:99},modelCosts:{large:1,boundary:2,tiny:3}},
    month:{models:{large:9801,boundary:99,tiny:100},modelCosts:{large:1,boundary:2,tiny:3}},
    allTime:{models:{large:9800,boundary:100,tiny:100},modelCosts:{large:1,boundary:2,tiny:3}}
  }}`);
  for (const [period, smallName, smallCost] of [['today', 'tiny', '$3.0000'], ['month', 'boundary', '$2.0000']]) {
    run(`state.period=${JSON.stringify(period)}`);
    const rendered = c.renderMain();
    assert.ok(rendered.includes('other models'));
    assert.ok(rendered.includes('<details class="other-models">'));
    assert.ok(!rendered.includes('<details class="other-models" open'));
    const children = rendered.slice(rendered.indexOf('class="other-model-list"'));
    assert.ok(children.includes('class="model-chip-name">' + smallName + '</span>'));
    assert.ok(children.includes(smallCost));
    assert.ok(children.includes('99'));
    const main = rendered.slice(0, rendered.indexOf('<details class="other-models">'));
    assert.ok(!main.includes('class="model-chip-name">' + smallName + '</span>'));
  }
  run('state.period="allTime"');
  assert.ok(!c.renderMain().includes('other models'));
  const list = [{ id: 'a', tokens: 1, cost: 2, pct: 0.0001 }, { id: 'b', tokens: 2, cost: 3, pct: 0.0002 }];
  const original = JSON.stringify(list);
  const rendered = c.renderModelList(list);
  assert.ok(rendered.includes('$5.0000'));
  assert.ok(rendered.includes('class="other-ai"'));
  assert.equal(JSON.stringify(list), original);
});

test('unidentifiable and duplicate subscription identities cannot silently select a different account', async () => {
  const { run, context: c, setProviders } = app();
  setProviders([{ provider: 'ollama' }, { provider: 'claude', accountKey: 'same' }, { provider: 'claude', accountKey: 'same' }]);
  await c.prepareSubscriptions();
  assert.equal(run('state.catalog.filter(x=>x.id).length'), 0);
  run('state.displayDraft={mode:"auto",ids:[]}');
  const rendered = c.renderDisplayChoices();
  assert.equal((rendered.match(/type="checkbox"[^>]*disabled/g) || []).length, 3);
  assert.ok(rendered.includes('稳定账号标识'));
  assert.equal(run('homeEntries().length'), 3);
});

test('a response from the previous hub cannot populate the current hub catalog or preferences', { timeout: 2000 }, async () => {
  const { context: c, run } = app();
  let respond;
  c.fetch = () => new Promise(resolve => { respond = resolve; });
  c.paint = () => {};
  run('state.cfg={hub:"https://old.example.test",secret:"synthetic"}');
  const pending = c.pull();
  run('state.cfg={hub:"https://new.example.test",secret:"synthetic"}');
  respond({ status: 200, ok: true, text: async () => JSON.stringify({ periods: {}, limits: { providers: [{ provider: 'claude', accountKey: 'old' }] } }) });
  assert.equal(await pending, false);
  assert.equal(run('state.stats'), null);
  assert.equal(run('state.prefScope'), undefined);
});

test('modal details suppress hover previews while focus returns to their trigger', () => {
  const { context: c, run, setProviders } = app();
  setProviders([{ provider: 'claude', windows: [{ kind: 'weekly', remainingPercent: 42 }] }]);
  const nodes = { 'quota-preview': { hidden: false, innerHTML: 'unchanged' }, 'quota-dialog-body': {},
    'quota-dialog': { open: false, showModal() { this.open = true; } } };
  c.document.getElementById = id => nodes[id];
  const button = { dataset: { quotaDetail: '0' } };
  c.showQuotaDetails(button, true);
  assert.equal(nodes['quota-dialog'].open, true);
  assert.equal(nodes['quota-preview'].hidden, true);
  assert.equal(run('state.quotaModalActive'), true);
  c.showQuotaDetails(button, false);
  assert.equal(nodes['quota-preview'].hidden, true);
  assert.equal(nodes['quota-preview'].innerHTML, 'unchanged');
});
