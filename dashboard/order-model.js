export const ORDER_LABELS = { payment_started: 'Payment started', received: 'Received', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
export const PAYMENT_LABELS = { unconfirmed: 'Unconfirmed', paid: 'Paid', refunded: 'Refunded' };
export const FOLLOWUP_LABELS = { not_needed: 'Not needed', pending: 'Awaiting tracking', sent: 'Follow-up sent', received: 'Tracking received', skipped: 'Skipped' };
export const SERVICE_LABELS = { express: 'Express', pickup: 'Pickup', returns: 'Returns', bigdrop: 'Big Drop' };
export const isActive = order => !['completed', 'cancelled'].includes(order.order_status);
export const needsPayment = order => isActive(order) && order.payment_status === 'unconfirmed' && Number(order.amount_due) > 0;
export const needsFollowup = (order, now = Date.now()) => isActive(order) && order.tracking_followup_status === 'pending' && Boolean(order.tracking_followup_due_at) && new Date(order.tracking_followup_due_at).getTime() <= now;
export function inQueue(order, queue, now = Date.now()) {
  if (queue === 'active') return isActive(order);
  if (queue === 'unpaid') return needsPayment(order);
  if (queue === 'followup') return needsFollowup(order, now);
  if (queue === 'completed') return order.order_status === 'completed';
  return true;
}
export function filterOrders(orders, { queue = 'all', search = '', service = '', status = '', payment = '' } = {}, now = Date.now()) {
  const query = search.trim().toLowerCase();
  return orders.filter(order => inQueue(order, queue, now) && (!service || order.service === service || (service !== 'bigdrop' && order.base_service === service)) && (!status || order.order_status === status) && (!payment || order.payment_status === payment) && (!query || [order.id, order.recipient_name, order.phone, order.dorm, order.room, order.tracking, order.carrier, order.promo_code, ...(order.order_trackers || []).map(row => row.tracking_code)].some(value => String(value ?? '').toLowerCase().includes(query))));
}
export function summarizeOrders(orders, now = Date.now()) {
  return { active: orders.filter(isActive).length, unpaid: orders.filter(needsPayment).length, followup: orders.filter(order => needsFollowup(order, now)).length, completed: orders.filter(order => order.order_status === 'completed').length, collected: orders.filter(order => order.payment_status === 'paid').reduce((sum, order) => sum + Number(order.amount_due || 0), 0) };
}
