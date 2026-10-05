import test from 'node:test';
import assert from 'node:assert/strict';

test('manual checkout saves before Venmo handoff, skips free payments, and prevents duplicate orders', async t => {
  const originals = Object.fromEntries(['document', 'window', 'fetch', 'sessionStorage', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  const listeners = {};
  const app = { innerHTML: '', addEventListener(type, handler) { listeners[type] = handler; }, querySelectorAll: () => [], querySelector: () => null };
  globalThis.document = { getElementById: () => app, querySelector: () => null };
  const navigations = [];
  globalThis.window = { location: { assign: url => navigations.push(url) } };
  globalThis.sessionStorage = { getItem: () => null };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async () => {} } } });
  let posts = 0; let fail = true; let release;
  globalThis.fetch = async url => {
    if (url === '/api/config') return { ok: true, json: async () => ({ orderStorageEnabled: true }) };
    posts++;
    if (fail) throw new Error('Offline');
    await new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => ({ id: 'saved-order' }) };
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const click = (action, extra = {}) => listeners.click({ target: { closest: () => ({ dataset: { action, ...extra } }) } });
  await import(`../app.js?manual-ui=${Date.now()}`);
  await settle();
  for (const [field, value] of Object.entries({ dorm: 'Pegram', room: '210', phone: '9195550187' })) listeners.input({ target: { dataset: { field }, value } });
  await click('pay-venmo');
  assert.match(app.innerHTML, /We could not save your order/);
  assert.doesNotMatch(app.innerHTML, /Open Venmo app/);
  assert.equal(navigations.length, 0, 'failed saves never open Venmo');
  fail = false;
  await click('paymethod', { method: 'zelle' });
  const first = click('pay-zelle');
  const second = click('pay-zelle');
  await settle();
  assert.equal(posts, 2, 'one failed Venmo attempt and one Zelle request');
  release();
  await Promise.all([first, second]);
  await settle();
  assert.doesNotMatch(app.innerHTML, /We could not save your order/);
  await click('pay-zelle');
  assert.equal(posts, 2, 'copying again reuses the saved order');

  for (const [userAgent, protocol] of [['Desktop', 'https:'], ['iPhone', 'venmo:']]) {
    await click('new-order');
    navigator.userAgent = userAgent;
    for (const [field, value] of Object.entries({ dorm: 'Pegram', room: '210', phone: '9195550187' })) listeners.input({ target: { dataset: { field }, value } });
    const before = navigations.length;
    const beforePosts = posts;
    const payment = click('pay-venmo');
    await click('pay-venmo');
    await settle();
    assert.equal(posts, beforePosts + 1, 'double clicks create only one order');
    assert.equal(navigations.length, before, 'wait for the order to save');
    release();
    await payment;
    assert.equal(navigations.length, before + 1, 'one click saves and opens Venmo');
    const url = new URL(navigations.at(-1));
    assert.equal(url.protocol, protocol);
    assert.equal(url.searchParams.get('amount'), '4.99');
    assert.ok(url.searchParams.get('note').includes('Pegram'));
    assert.match(app.innerHTML, /Order saved · ready to pay/);
    assert.match(app.innerHTML, /venmo-profile-link/);
    await click('pay-venmo');
    assert.equal(posts, beforePosts + 1);
  }

  await click('new-order');
  for (const [field, value] of Object.entries({ dorm: 'Pegram', room: '210', phone: '9195550187', promoCode: 'COMPEDROP' })) listeners.input({ target: { dataset: { field }, value } });
  const before = navigations.length;
  const freeOrder = click('pay-venmo');
  await settle();
  release();
  await freeOrder;
  assert.equal(navigations.length, before, 'free orders do not open Venmo');
  assert.match(app.innerHTML, /no payment due/);
});
