const promoCode = order => String(order.promo_code || '').trim().toUpperCase();
export const ORDER_LABELS = { payment_started: 'Payment started', received: 'Received', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
export const PAYMENT_LABELS = { unconfirmed: 'Unconfirmed', paid: 'Paid', refunded: 'Refunded' };
export const FOLLOWUP_LABELS = { not_needed: 'Not scheduled', pending: 'Scheduled', sent: 'Text sent', received: 'Customer replied', skipped: 'Skipped' };
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
  return orders.filter(order => inQueue(order, queue, now) && (!promo || promoCode(order) === promo.trim().toUpperCase()) && (!service || order.service === service || (service !== 'bigdrop' && order.base_service === service)) && (!status || order.order_status === status) && (!payment || order.payment_status === payment) && (!query || [order.id, order.recipient_name, order.package_name, order.phone, order.dorm, order.room, order.tracking, order.carrier, order.promo_code, ...(order.order_trackers || []).map(row => row.tracking_code)].some(value => String(value ?? '').toLowerCase().includes(query))));
}
export function summarizeOrders(orders, now = Date.now()) {
  return { active: orders.filter(isActive).length, unpaid: orders.filter(needsPayment).length, followup: orders.filter(order => needsFollowup(order, now)).length, completed: orders.filter(order => order.order_status === 'completed').length, collected: orders.filter(order => order.payment_status === 'paid').reduce((sum, order) => sum + Number(order.amount_due || 0), 0) };
}

// Cash metrics use confirmed payments only. Cancelled and refunded orders never
// contribute to revenue, even when an old payment flag remains on the record.
export function revenueMetrics(orders) {
  const valid = orders.filter(order => order.order_status !== 'cancelled' && order.payment_status !== 'refunded');
  const paid = valid.filter(order => order.payment_status === 'paid' && Number(order.amount_due) > 0);
  const revenue = paid.reduce((sum, order) => sum + Number(order.amount_due), 0);
  const outstanding = valid.filter(order => isActive(order) && order.payment_status === 'unconfirmed').reduce((sum, order) => sum + Math.max(0, Number(order.amount_due) || 0), 0);
  return { revenue, outstanding, paidOrders: paid.length, averageOrder: paid.length ? revenue / paid.length : 0,
    freeOrders: valid.filter(order => Number(order.amount_due) === 0).length,
    refundedOrders: orders.filter(order => order.payment_status === 'refunded').length };
}

export function arrivalMetrics(orders, now = Date.now()) {
  const active = orders.filter(isActive);
  const shipments = active.flatMap(order => order.order_trackers || []);
  const upcoming = shipments.filter(row => Number.isFinite(Date.parse(row.estimated_delivery_at)) &&
    Date.parse(row.estimated_delivery_at) >= now && !['delivered', 'cancelled', 'return_to_sender'].includes(row.status));
  return { inTransit: shipments.filter(row => ['in_transit', 'out_for_delivery'].includes(row.status)).length,
    arrivingSoon: upcoming.filter(row => Date.parse(row.estimated_delivery_at) < now + 48 * 3600000).length,
    exceptions: shipments.filter(row => row.sync_error || ['failure', 'error', 'return_to_sender'].includes(row.status)).length,
    missingTracking: active.filter(order => order.service !== 'returns' && !(order.service === 'bigdrop' && order.base_service === 'returns') && !(order.order_trackers || []).length).length };
}

export function arrivalSchedule(orders, now = new Date(), days = 14) {
  const tz = 'America/New_York';
  const key = value => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  const start = key(now);
  const end = key(new Date(now.getTime() + days * 86400000));
  const rows = [];
  for (const order of orders) {
    if (!isActive(order) || order.service === 'returns' || (order.service === 'bigdrop' && order.base_service === 'returns')) continue;
    const trackers = (order.order_trackers || []).filter(row => Number.isFinite(Date.parse(row.estimated_delivery_at)) && !['delivered', 'cancelled', 'return_to_sender'].includes(row.status));
    if (trackers.length) {
      for (const tracker of trackers) {
        const day = key(new Date(tracker.estimated_delivery_at));
        if (day >= start && day < end) rows.push({ day, order, source: 'Carrier estimate', tracker });
      }
    } else if (order.estimated_delivery_date && order.estimated_delivery_date >= start && order.estimated_delivery_date < end) {
      rows.push({ day: order.estimated_delivery_date, order, source: 'Customer estimate', tracker: null });
    }
  }
  return rows.sort((a, b) => a.day.localeCompare(b.day) || a.order.id.localeCompare(b.order.id));
}

export function creatorMetrics(orders) {
  return summarizePromoUsage(orders).map(group => {
    const attributed = orders.filter(order => promoCode(order) === group.code && order.order_status !== 'cancelled' && order.payment_status !== 'refunded');
    const paid = attributed.filter(order => order.payment_status === 'paid' && Number(order.amount_due) > 0);
    return { ...group, revenue: paid.reduce((sum, order) => sum + Number(order.amount_due), 0),
      paidOrders: paid.length, customers: new Set(attributed.map(order => String(order.phone || '').replace(/\D/g, '')).filter(Boolean)).size };
  });
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
