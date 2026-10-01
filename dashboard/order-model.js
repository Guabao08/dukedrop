const promoCode = order => String(order.promo_code || '').trim().toUpperCase();
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
export function filterOrders(orders, { queue = 'all', search = '', service = '', status = '', payment = '', promo = '' } = {}, now = Date.now()) {
  const query = search.trim().toLowerCase();
  return orders.filter(order => inQueue(order, queue, now) && (!promo || promoCode(order) === promo.trim().toUpperCase()) && (!service || order.service === service || (service !== 'bigdrop' && order.base_service === service)) && (!status || order.order_status === status) && (!payment || order.payment_status === payment) && (!query || [order.id, order.recipient_name, order.phone, order.dorm, order.room, order.tracking, order.carrier, order.promo_code, ...(order.order_trackers || []).map(row => row.tracking_code)].some(value => String(value ?? '').toLowerCase().includes(query))));
}
export function summarizeOrders(orders, now = Date.now()) {
  return { active: orders.filter(isActive).length, unpaid: orders.filter(needsPayment).length, followup: orders.filter(order => needsFollowup(order, now)).length, completed: orders.filter(order => order.order_status === 'completed').length, collected: orders.filter(order => order.payment_status === 'paid').reduce((sum, order) => sum + Number(order.amount_due || 0), 0) };
}

// Each order belongs to one outcome; free orders do not count as cash payments.
export function summarizePromoUsage(orders) {
  const groups = new Map();
  for (const order of orders) {
    const code = promoCode(order);
    if (!code) continue;
    if (!groups.has(code)) groups.set(code, { code, total: 0, paid: 0, free: 0, awaiting: 0, cancelled: 0, refunded: 0 });
    const group = groups.get(code);
    group.total++;
    const outcome = order.order_status === 'cancelled' ? 'cancelled'
      : order.payment_status === 'refunded' ? 'refunded'
      : order.amount_due != null && Number(order.amount_due) === 0 ? 'free'
      : order.payment_status === 'paid' ? 'paid' : 'awaiting';
    group[outcome]++;
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
}

const phoneKey = value => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length >= 10 ? digits : '';
};
const normalized = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Flags later submissions only when the customer and core order details match.
export function findRepeatOrders(orders, windowMs = 10 * 60 * 1000) {
  const candidates = orders.map(order => ({ order, time: Date.parse(order.created_at) }))
    .filter(({ order, time }) => phoneKey(order.phone) && Number.isFinite(time))
    .sort((a, b) => a.time - b.time);
  const previousByKey = new Map();
  const repeats = [];
  for (const { order, time } of candidates) {
    const key = [phoneKey(order.phone), normalized(order.service), normalized(order.base_service || order.service), Number(order.quantity), normalized(order.dorm), normalized(order.room)].join('|');
    const previous = previousByKey.get(key);
    if (previous && time - previous.time <= windowMs) repeats.push({ repeatId: order.id, originalId: previous.order.id });
    else previousByKey.set(key, { order, time });
  }
  return repeats;
}
