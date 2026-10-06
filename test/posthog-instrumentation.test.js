import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('order, card checkout, and dashboard login send their PostHog events', () => {
  const posthogMock = `export class PostHog {
    capture(event) { globalThis.posthogEvents.push(event); }
    async flush() {}
  }`;
  const stripeMock = `export default class Stripe {
    constructor(secret, options) {
      globalThis.stripeOptions = options;
      this.prices = { retrieve: async () => ({ active: true, currency: 'usd', recurring: null, unit_amount: 499 }) };
      this.checkout = { sessions: { create: async () => ({ client_secret: 'cs_test_mock' }) } };
    }
  }`;
  const logsMock = `export const logOrderCreated = (entry) => globalThis.orderLogs.push(entry);
    export const flushPosthogLogs = async () => {};`;
  const securityMock = `export const checkoutToken = () => 'test-checkout-token';
    export const validCheckoutToken = () => true;
    export const consumeRateLimit = async () => true;`;
  const script = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    const moduleUrl = source => 'data:text/javascript,' + encodeURIComponent(source);
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier === 'posthog-node') return { url: moduleUrl(${JSON.stringify(posthogMock)}), shortCircuit: true };
      if (specifier === 'stripe') return { url: moduleUrl(${JSON.stringify(stripeMock)}), shortCircuit: true };
      if (specifier === '../lib/posthog-logs.js') return { url: moduleUrl(${JSON.stringify(logsMock)}), shortCircuit: true };
      if (specifier === '../lib/api-security.js') return { url: moduleUrl(${JSON.stringify(securityMock)}), shortCircuit: true };
      return nextResolve(specifier, context);
    }});
    globalThis.posthogEvents = [];
    globalThis.orderLogs = [];
    function response() { return { headers: {}, setHeader(k,v){this.headers[k]=v}, status(n){this.code=n;return this}, json(x){this.body=x;return this} }; }
    const orderId = '123e4567-e89b-42d3-a456-426614174000';
    const order = { service:'express', quantity:1, dorm:'PostHog test', room:'TEST-20261001', phone:'9195550187', payMethod:'card' };
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/rest/v1/rpc/consume_api_rate_limit') return { ok:true, json:async()=>true };
      if (options.method === 'POST') return { ok:true, json:async()=>[{id:orderId}] };
      return { ok:true, json:async()=>[{ id:orderId, service:'express', quantity:1, promo_code:null, amount_due:4.99, payment_method:'card', payment_status:'unconfirmed' }] };
    };
    process.env.ORDER_STORAGE_ENABLED='true';
    process.env.SUPABASE_URL='https://storage.example';
    process.env.SUPABASE_SERVICE_ROLE_KEY='test-storage';
    const { default: createOrder } = await import('./api/orders.js');
    const saved = response();
    await createOrder({method:'POST',body:order}, saved);
    assert.equal(saved.code,201);
    assert.equal(globalThis.posthogEvents[0].event,'order_created');
    assert.equal(globalThis.orderLogs[0].service,'express');

    process.env.STRIPE_SECRET_KEY='sk_test_mock';
    process.env.STRIPE_PUBLISHABLE_KEY='pk_test_mock';
    process.env.STRIPE_WEBHOOK_SECRET='whsec_test_mock';
    const { default: createCheckout } = await import('./api/create-checkout-session.js');
    const checkout = response();
    await createCheckout({method:'POST',body:{orderId,checkoutToken:'test-checkout-token'}}, checkout);
    assert.equal(checkout.code,200);
    assert.deepEqual(checkout.body,{client_secret:'cs_test_mock'});
    assert.equal(globalThis.posthogEvents[1].event,'card_checkout_started');

    process.env.DASHBOARD_PASSWORD='test-password';
    const { default: login } = await import('./api/dashboard/login.js');
    const signedIn = response();
    await login({method:'POST',headers:{},body:{password:'test-password'}}, signedIn);
    assert.equal(signedIn.code,200);
    assert.equal(globalThis.posthogEvents[2].event,'dashboard_signed_in');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, POSTHOG_PROJECT_TOKEN: 'phc_test_project', POSTHOG_HOST: 'https://analytics.example' },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
