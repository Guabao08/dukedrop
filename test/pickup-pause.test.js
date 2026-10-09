import test from 'node:test';
import assert from 'node:assert/strict';
import { isPickupUnavailable, PICKUP_UNAVAILABLE_MESSAGE } from '../app.js';
import orders from '../api/orders.js';

test('pickup pause covers standard, Big Drop, and legacy pickup orders only', () => {
  for (const order of [{ service: 'pickup' }, { service: 'bigdrop', baseService: 'pickup' }, { service: 'bigdrop', mode: 'pickup' }]) {
    assert.equal(isPickupUnavailable(order), true);
  }
  for (const order of [{ service: 'express' }, { service: 'returns' }, { service: 'bigdrop', mode: 'ship' }, { service: 'bigdrop', baseService: 'returns' }]) {
    assert.equal(isPickupUnavailable(order), false);
  }
});

test('new pickup orders are rejected before storage or payment side effects', async () => {
  for (const body of [{ service: 'pickup' }, { service: 'bigdrop', baseService: 'pickup' }, { service: 'bigdrop', mode: 'pickup' }]) {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await orders({ method: 'POST', body }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.error, PICKUP_UNAVAILABLE_MESSAGE);
  }
});
