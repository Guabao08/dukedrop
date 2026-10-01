import test from 'node:test';
import assert from 'node:assert/strict';
import { filterOrders, summarizeOrders, needsFollowup, summarizePromoUsage, findRepeatOrders } from '../dashboard/order-model.js';
const now = Date.parse('2026-09-29T12:00:00Z');
const base = { id: 'one', order_status: 'received', payment_status: 'unconfirmed', amount_due: 5, service: 'express', dorm: 'Pegram', room: '210', tracking_followup_status: 'pending', tracking_followup_due_at: '2026-09-28T12:00:00Z' };
test('operational queues exclude closed orders and zero-dollar payment review', () => {
  const orders = [base, { ...base, id: 'free', amount_due: 0 }, { ...base, id: 'done', order_status: 'completed', payment_status: 'paid' }, { ...base, id: 'cancel', order_status: 'cancelled' }, { ...base, id: 'future', tracking_followup_due_at: '2026-10-01T00:00:00Z' }];
  assert.deepEqual(filterOrders(orders, { queue: 'unpaid' }, now).map(o => o.id), ['one', 'future']);
  assert.deepEqual(filterOrders(orders, { queue: 'followup' }, now).map(o => o.id), ['one', 'free']);
  assert.deepEqual(summarizeOrders(orders, now), { active: 3, unpaid: 2, followup: 2, completed: 1, collected: 5 });
  assert.equal(needsFollowup({ ...base, tracking_followup_due_at: null }, now), false);
});
test('search and filters combine, including Big Drop base service', () => {
  const orders = [base, { ...base, id: 'two', service: 'bigdrop', base_service: 'pickup', dorm: 'Craven House D', payment_status: 'paid', tracking: 'TRACK123' }];
  assert.deepEqual(filterOrders(orders, { search: ' track123 ', service: 'pickup', payment: 'paid' }, now).map(o => o.id), ['two']);
  assert.equal(filterOrders(orders, { search: 'Pegram', status: 'completed' }, now).length, 0);
});

test('promo usage normalizes codes and separates payment outcomes', () => {
  const orders = [
    { ...base, promo_code: ' austin20 ', payment_status: 'paid' },
    { ...base, promo_code: 'AUSTIN20' },
    { ...base, promo_code: 'AUSTIN20', order_status: 'cancelled', payment_status: 'paid' },
    { ...base, promo_code: 'AUSTIN20', payment_status: 'refunded' },
    { ...base, promo_code: 'FREEDROP', amount_due: 0, payment_status: 'paid' },
    { ...base, promo_code: 'FREEDROP', amount_due: 0 },
    base, { ...base, promo_code: '   ' },
  ];
  assert.deepEqual(summarizePromoUsage(orders), [
    { code: 'AUSTIN20', total: 4, paid: 1, free: 0, awaiting: 1, cancelled: 1, refunded: 1 },
    { code: 'FREEDROP', total: 2, paid: 0, free: 2, awaiting: 0, cancelled: 0, refunded: 0 },
  ]);
  assert.equal(filterOrders(orders, { promo: 'austin20', payment: 'paid' }).length, 2);
  assert.equal(filterOrders(orders, { promo: 'AUSTIN' }).length, 0);
  assert.deepEqual(summarizePromoUsage([]), []);
});

test('repeat detection requires matching customer and order details within ten minutes', () => {
  const first = { ...base, id: 'first', phone: '(919) 555-0123', created_at: '2026-09-29T12:00:00Z' };
  const repeat = { ...first, id: 'repeat', phone: '+1 919-555-0123', created_at: '2026-09-29T12:09:00Z' };
  const differentRoom = { ...repeat, id: 'room', room: '211' };
  const tooLate = { ...repeat, id: 'late', created_at: '2026-09-29T12:11:00Z' };
  const noPhone = { ...repeat, id: 'no-phone', phone: '' };
  assert.deepEqual(findRepeatOrders([tooLate, noPhone, repeat, differentRoom, first]), [{ repeatId: 'repeat', originalId: 'first' }]);
});
