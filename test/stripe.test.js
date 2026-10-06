import test from 'node:test';
import assert from 'node:assert/strict';
import createCheckoutSession from '../api/create-checkout-session.js';
import orders from '../api/orders.js';

const envKeys = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET', 'ORDER_STORAGE_ENABLED', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test('Stripe Checkout endpoint requires configuration and validates orders before calling Stripe', async t => {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  for (const key of envKeys) delete process.env[key];
  let res = response();
  await createCheckoutSession({ method: 'POST', body: {} }, res);
  assert.equal(res.code, 503);
  assert.equal(res.headers['Cache-Control'], 'no-store');

  Object.assign(process.env, { STRIPE_SECRET_KEY: 'test-secret', STRIPE_PUBLISHABLE_KEY: 'pk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test', ORDER_STORAGE_ENABLED: 'true', SUPABASE_URL: 'https://storage.example', SUPABASE_SERVICE_ROLE_KEY: 'test-storage' });
  res = response();
  await createCheckoutSession({ method: 'POST', body: { order: {} } }, res);
  assert.equal(res.code, 400);
});

test('public config route reports Stripe readiness without exposing a secret key', async t => {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  for (const key of envKeys) delete process.env[key];
  const res = response();
  await orders({ method: 'GET' }, res);
  assert.equal(res.body.stripeReady, false);
  assert.equal('stripeSecretKey' in res.body, false);
});
