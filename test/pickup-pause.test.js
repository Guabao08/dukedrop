import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidOrder } from '../api/orders.js';

test('server accepts only the two Amazon pickup types for Pickup and Big Drop pickup', () => {
  const base = { quantity: 1, dorm: 'A', room: '1', phone: '9195550123' };
  for (const serviceOrder of [
    { service: 'pickup' },
    { service: 'bigdrop', mode: 'pickup' },
  ]) {
    assert.equal(isValidOrder({ ...base, ...serviceOrder, source: 'whole-foods', lockerLocation: 'Durham', locker: 'AB12CD' }), true);
    assert.equal(isValidOrder({ ...base, ...serviceOrder, source: 'campus-locker', lockerLocation: 'Bryan Center', locker: '447128' }), true);
    assert.equal(isValidOrder({ ...base, ...serviceOrder, source: 'mailbox', mailroom: 'Few', box: '9' }), false);
    assert.equal(isValidOrder({ ...base, ...serviceOrder, source: 'whole-foods', lockerLocation: 'Durham' }), false);
  }
});
