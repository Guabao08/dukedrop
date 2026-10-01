import test from 'node:test';
import assert from 'node:assert/strict';
import { findPaymentMatches, paymentSheetHeaders } from '../lib/payment-verification.js';
import { parseCsv } from '../lib/public-payment-sheet.js';
import verifyPayments from '../api/dashboard/payments.js';
import { setDashboardSession } from '../lib/dashboard-session.js';

const headers = ['Payment Time', 'Customer', 'Amount', 'Service', 'Package Count', 'Dorm', 'Room', 'Carrier', 'Tracking', 'Pickup Type', 'Pickup Location', 'Pickup Code/Box', 'Package Name', 'Payment Method', 'Status', 'Email ID'];
const row = ['2026-10-01', 'Test Customer', '$4.99', 'EXPRESS', '1', 'Few Quad', 'Room 210', 'UPS', 'TRACK123', 'Locker', 'Campus', '123456', 'Test Package', 'Venmo', 'Paid', 'receipt-1'];
const order = { id: 'order-1', amount_due: 4.99, service: 'express', quantity: 1, dorm: 'few quad', room: '210', carrier: 'UPS', tracking: 'TRACK123', payment_method: 'venmo', payment_status: 'unconfirmed' };
const match = (rows, orders = [order]) => findPaymentMatches(orders, [headers, ...rows]);

test('paid sheet rows update payment status and supplied order details', () => {
  const result = match([row]);
  assert.equal(result.updates.length, 1);
  assert.deepEqual(result.updates[0], { id: order.id, updates: {
    amount_due: 4.99, service: 'express', quantity: 1, dorm: 'Few Quad', room: 'Room 210',
    payment_method: 'venmo', payment_status: 'paid', payment_time: '2026-10-01', email_id: 'receipt-1', package_name: 'Test Package',
    recipient_name: 'Test Customer', carrier: 'UPS', tracking: 'TRACK123', source: 'locker', locker_location: 'Campus', locker_code: '123456',
  } });
});

test('reordered columns and extra columns preserve field mapping', () => {
  const values = [['Extra', ...headers.toReversed()], ['ignored', ...row.toReversed()]];
  assert.equal(paymentSheetHeaders(values), true);
  assert.deepEqual(findPaymentMatches([order], values).updates, match([row]).updates);
  assert.equal(paymentSheetHeaders([['Amount', 'Amount']]), false);
});

test('an unpaid copy cannot block a paid match; exact duplicates count once', () => {
  const unpaid = [...row]; unpaid[14] = '';
  const result = match([row, [...row], unpaid]);
  assert.equal(result.updates.length, 1);
  assert.equal(result.unpaidRows, 1);
  assert.equal(match([unpaid]).updates.length, 0);
});

test('conflicting location or order details and missing amounts never auto-confirm', () => {
  for (const [index, value] of [[6, '211'], [3, 'PICKUP'], [4, '2'], [2, '']]) {
    const conflict = [...row]; conflict[index] = value;
    assert.equal(match([conflict]).updates.length, 0, `column ${index}`);
  }
});

test('strong identity matches copy the paid ledger amount and payment method', () => {
  const corrected = [...row]; corrected[2] = '$3.99'; corrected[13] = 'Zelle';
  const result = match([corrected]);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].updates.amount_due, 3.99);
  assert.equal(result.updates[0].updates.payment_method, 'zelle');
  assert.equal(match([corrected], [{ ...order, tracking: '' }]).updates.length, 0);
  assert.equal(match([corrected], [{ ...order, tracking: '', recipient_name: 'Test Customer' }]).updates.length, 1);
});

test('a one-cent round-up matches, but arbitrary amount differences need identity', () => {
  const rounded = [...row]; rounded[2] = '$5.00'; rounded[8] = '';
  assert.equal(match([rounded], [{ ...order, tracking: '' }]).updates.length, 1);
  rounded[2] = '$5.01';
  assert.equal(match([rounded], [{ ...order, tracking: '' }]).updates.length, 0);
  rounded[2] = '$4.98';
  assert.equal(match([rounded], [{ ...order, tracking: '' }]).updates.length, 0);
});

test('a receipt already linked to an order cannot confirm another order', () => {
  const owner = { ...order, id: 'existing-order', email_id: 'receipt-1', payment_status: 'paid' };
  const result = match([row], [order, owner]);
  assert.deepEqual(result.updates.map(update => update.id), ['existing-order']);
});

test('competing orders or distinct receipts stay ambiguous', () => {
  assert.equal(match([row], [order, { ...order, id: 'order-2' }]).updates.length, 0);
  const second = [...row]; second[15] = 'receipt-2';
  assert.equal(match([row, second]).ambiguous, 1);
  assert.equal(match([row], [{ ...order, payment_status: 'refunded' }]).updates.length, 0);
});

test('a missing room requires exact tracking and does not erase saved fields', () => {
  const partial = [...row]; partial[6] = ''; partial[0] = ''; partial[12] = ''; partial[15] = '';
  const updates = match([partial]).updates[0].updates;
  for (const key of ['room', 'payment_time', 'package_name', 'email_id']) assert.equal(key in updates, false);
  partial[8] = '';
  assert.equal(match([partial]).updates.length, 0);
});

test('explicit paid zero-dollar rows can reconcile free orders', () => {
  const free = [...row]; free[2] = '$0.00';
  assert.equal(match([free], [{ ...order, amount_due: 0 }]).updates.length, 1);
});

test('CSV handles BOM, commas, multiline notes, escaped quotes and CRLF', () => {
  assert.deepEqual(parseCsv('\uFEFFA,B\r\n"one,two","a\n""quote"""\r\n'), [['A', 'B'], ['one,two', 'a\n"quote"']]);
});

test('verification endpoint reads the sheet and persists matched details', async t => {
  const envKeys = ['DASHBOARD_PASSWORD', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'POSTHOG_PROJECT_TOKEN', 'POSTHOG_HOST'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  Object.assign(process.env, { DASHBOARD_PASSWORD: 'test-password', SUPABASE_URL: 'https://storage.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key' });
  delete process.env.POSTHOG_PROJECT_TOKEN;
  delete process.env.POSTHOG_HOST;
  let cookie;
  setDashboardSession({ headers: {} }, { setHeader: (_, value) => { cookie = value.split(';')[0]; } }, process.env.DASHBOARD_PASSWORD);
  const writes = [];
  const csv = [headers, row].map(cells => cells.map(value => JSON.stringify(value)).join(',')).join('\r\n');
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'docs.google.com') return new Response(csv);
    assert.equal(url.origin, 'https://storage.example');
    if (options.method === 'PATCH') {
      writes.push(JSON.parse(options.body));
      assert.equal(url.searchParams.get('payment_status'), 'neq.refunded');
      return Response.json([{ ...order, ...writes.at(-1) }]);
    }
    return Response.json([order]);
  };
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await verifyPayments({ method: 'POST', headers: { cookie }, body: { action: 'verify' } }, response);
  assert.equal(response.code, 200);
  assert.equal(response.body.updated, 1);
  assert.equal(response.body.failed, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].payment_status, 'paid');
  assert.equal(writes[0].locker_code, '123456');
  assert.equal(writes[0].email_id, 'receipt-1');
});
