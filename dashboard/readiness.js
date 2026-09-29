// Pickup readiness is separate from payment and delivery completion.
export const READINESS_LABELS = { auto: 'Use order details', waiting: 'Waiting for confirmation', ready: 'Ready to collect', collected: 'Collected', hold: 'On hold' };
export function pickupReadiness(order) {
  const result = (state, reason, source = 'Order details') => ({ state, label: READINESS_LABELS[state] || state, reason, source });
  if (['completed', 'cancelled'].includes(order.order_status)) return result('closed', order.order_status === 'completed' ? 'Order completed.' : 'Order cancelled.');
  if (order.pickup_readiness && order.pickup_readiness !== 'auto' && READINESS_LABELS[order.pickup_readiness]) {
    return result(order.pickup_readiness, order.pickup_note || 'Updated by your team.', 'Staff confirmation');
  }
  const service = order.service === 'bigdrop' ? order.base_service : order.service;
  if (service === 'returns') return result('waiting', 'Confirm with the customer that all return items are packed and ready.');
  const trackers = order.order_trackers || [];
  const covered = trackers.reduce((sum, row) => sum + Number(row.items_count || 1), 0);
  if (covered > Number(order.quantity)) return result('hold', 'Tracking covers more items than this order contains. Review the tracking entries or confirm readiness manually.', 'Carrier tracking');
  const delivered = trackers.filter(row => row.status === 'delivered').reduce((sum, row) => sum + Number(row.items_count || 1), 0);
  if (delivered >= Number(order.quantity) && Number(order.quantity) > 0) return result('ready', `Carrier delivery confirmed for all ${order.quantity} ${Number(order.quantity) === 1 ? 'item' : 'items'}.`, 'Carrier tracking');
  if (trackers.some(row => ['failure','return_to_sender','error','cancelled'].includes(row.status) || row.sync_error)) return result('hold', 'A shipment needs attention. Open the order to review the carrier status or tracking error.', 'Carrier tracking');
  if (delivered) return result('waiting', `${delivered} of ${order.quantity} items delivered. Waiting for the remaining items.`, 'Carrier tracking');
  const pickup = order.service === 'pickup' || (order.service === 'bigdrop' && order.fulfillment_mode === 'pickup');
  if (pickup && order.source === 'locker' && /^\d{6}$/.test(String(order.locker_code || '').trim()) && String(order.locker_location || '').trim()) {
    if (Number(order.quantity) === 1) return result('ready', 'Customer supplied a locker location and pickup code. Confirm the code is still valid.', 'Customer locker details');
    return result('waiting', 'Locker details supplied. Confirm that all items are available before collecting.');
  }
  if (pickup) return result('waiting', 'Confirm the mailroom pickup notice or obtain valid locker details.');
  if (trackers.length) return result('waiting', `${trackers.reduce((sum, row) => sum + Number(row.items_count || 1), 0)} of ${order.quantity} items have tracking. Waiting for carrier delivery.`, 'Carrier tracking');
  if (!String(order.tracking || '').trim()) return result('waiting', 'Tracking number needed. Confirm arrival before collecting.');
  return result('waiting', 'Tracking details recorded. Add valid carrier tracking numbers below to enable delivery updates.');
}
export function pickupLocation(order) {
  const service = order.service === 'bigdrop' ? order.base_service : order.service;
  if (service === 'returns') return `${order.dorm || 'Dorm not provided'} · Room ${order.room || '—'}`;
  if (order.service === 'pickup' || (order.service === 'bigdrop' && order.fulfillment_mode === 'pickup')) {
    return order.source === 'locker' ? order.locker_location || 'Locker location needed' : [order.mailroom || 'Mailroom not provided', order.box_number ? `Box ${order.box_number}` : ''].filter(Boolean).join(' · ');
  }
  return 'Confirm arrival location';
}
