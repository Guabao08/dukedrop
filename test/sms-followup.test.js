import test from 'node:test';
import assert from 'node:assert/strict';
import twilio from 'twilio';
import { e164, followupText, replyDetails, validTwilioRequest } from '../lib/sms-followup.js';
import { arrivalSchedule } from '../dashboard/order-model.js';
import reconcile from '../api/sms/reconcile.js';

test('follow-up copy asks for the right identifier and delivery date', () => {
  const order = { id: 'abcdef12-1234-4123-8123-123456789abc', recipient_name: 'Sam Lee', retailer: 'other' };
  assert.match(followupText(order), /tracking number/);
  assert.match(followupText(order), /estimated delivery date \(YYYY-MM-DD\)/);
  assert.match(followupText(order), /#ABCDEF12/);
  assert.match(followupText({ ...order, retailer: 'amazon' }), /Amazon shipping\/tracking link/);
  assert.doesNotMatch(followupText({ ...order, retailer: 'amazon' }), /tracking number/);
  assert.equal(e164('(919) 555-0123'), '+19195550123');
  assert.equal(e164('123'), '');
});

test('reply details keep a valid ETA and shipping link', () => {
  assert.deepEqual(replyDetails('Arrives 2026-10-07 https://www.amazon.com/track/ABC.'), {
    eta: '2026-10-07', link: 'https://www.amazon.com/track/ABC',
  });
  assert.deepEqual(replyDetails('2026-02-30'), { eta: null, link: null });
});

test('incoming webhook signatures depend on the exact URL and form fields', () => {
  const previous = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = 'test-token';
  try {
    const url = 'https://example.test/api/sms/inbound';
    const fields = { From: '+19195550123', Body: '2026-10-07' };
    const signature = twilio.getExpectedTwilioSignature('test-token', url, fields);
    assert.equal(validTwilioRequest(signature, url, fields), true);
    assert.equal(validTwilioRequest(signature, url + '?x=1', fields), false);
    assert.equal(validTwilioRequest(signature, url, { ...fields, Body: 'changed' }), false);
  } finally {
    if (previous === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = previous;
  }
});

test('arrival schedule groups customer ETAs and carrier estimates without closed orders', () => {
  const orders = [
    { id: 'a', service: 'pickup', order_status: 'received', estimated_delivery_date: '2026-10-06', order_trackers: [] },
    { id: 'b', service: 'express', order_status: 'received', estimated_delivery_date: '2026-10-09', order_trackers: [{ estimated_delivery_at: '2026-10-07T15:00:00Z', status: 'in_transit' }] },
    { id: 'c', service: 'pickup', order_status: 'completed', estimated_delivery_date: '2026-10-06', order_trackers: [] },
  ];
  assert.deepEqual(arrivalSchedule(orders, new Date('2026-10-05T15:00:00Z')).map(row => [row.day, row.order.id, row.source]), [
    ['2026-10-06', 'a', 'Customer estimate'], ['2026-10-07', 'b', 'Carrier estimate'],
  ]);
});

test('cron route requires its bearer secret', async () => {
  const response = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, setHeader() {} };
  await reconcile({ method: 'GET', headers: {} }, response);
  assert.equal(response.code, 401);
});
