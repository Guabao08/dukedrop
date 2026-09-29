import test from 'node:test';
import assert from 'node:assert/strict';
import { filterOrders, summarizeOrders, needsFollowup } from '../dashboard/order-model.js';
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
