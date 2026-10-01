const clean = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const compact = value => clean(value).replace(/[\s._-]+/g, '');
const MATCH_THRESHOLD = 80;
const MINIMUM_LEAD = 8;
const SHEET_COLUMNS = ['payment time', 'customer', 'amount', 'service', 'package count', 'dorm', 'room', 'carrier', 'tracking', 'pickup type', 'pickup location', 'pickup code/box', 'package name', 'payment method', 'status', 'email id'];
const REQUIRED_COLUMNS = ['amount', 'service', 'package count', 'dorm', 'room', 'payment method', 'status'];
const headerKey = value => clean(value).replace(/[^a-z0-9]/g, '');
const roomKey = value => compact(clean(value).replace(/^(?:room\s*|rm\.?\s*|#\s*)/i, ''));

function sheetLayout(values) {
  const headers = (values?.[0] || []).map(headerKey);
  if (!REQUIRED_COLUMNS.every(name => headers.includes(headerKey(name)))) return null;
  const indices = SHEET_COLUMNS.map(name => headers.indexOf(headerKey(name)));
  if (indices.some(index => index >= 0 && headers.indexOf(headers[index], index + 1) !== -1)) return null;
  return indices;
}

function canonicalService(value) {
  const key = compact(value);
  return ({ express: 'express', pickup: 'pickup', return: 'returns', returns: 'returns', bigdrop: 'bigdrop' })[key] || '';
}

function canonicalMethod(value) {
  const key = compact(value);
  return key === 'venmo' || key === 'zelle' ? key : '';
}

function amountCents(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const accountingNegative = /^\(.*\)$/.test(text);
  const amount = Number(text.replace(/[,$\s]/g, '').replace(/^\((.*)\)$/, '$1'));
  return Number.isFinite(amount) ? Math.round(amount * 100) * (accountingNegative ? -1 : 1) : null;
}

function paymentRecord(row, index) {
  return {
    index,
    raw: row,
    amountCents: amountCents(row[2]),
    service: canonicalService(row[3]),
    quantity: Number(row[4]),
    dorm: clean(row[5]),
    room: roomKey(row[6]),
    carrier: clean(row[7]),
    tracking: compact(row[8]),
    method: canonicalMethod(row[13]),
    status: clean(row[14]),
    customer: clean(row[1]),
    packageName: clean(row[12]),
  };
}

function orderRecord(order) {
  return {
    amountCents: amountCents(order.amount_due),
    service: canonicalService(order.service),
    quantity: Number(order.quantity),
    dorm: clean(order.dorm),
    room: roomKey(order.room),
    carrier: clean(order.carrier),
    tracking: compact(order.tracking),
    method: canonicalMethod(order.payment_method),
    customer: clean(order.recipient_name),
  };
}

function similarity(order, payment) {
  if (!payment.method || payment.amountCents === null || payment.amountCents < 0) return 0;
  const trackingMatches = Boolean(payment.tracking && payment.tracking === order.tracking);
  const customerMatches = Boolean(order.customer && (payment.customer === order.customer || payment.packageName === order.customer));
  // The paid ledger supplies the final amount and channel. A one-cent round-up
  // is acceptable with a location match; other corrections need an identifier.
  const amountMatches = payment.amountCents === order.amountCents || (order.amountCents > 0 && payment.amountCents === order.amountCents + 1);
  if ((!amountMatches || payment.method !== order.method) && !trackingMatches && !customerMatches) return 0;
  if (!payment.service || !order.service || !Number.isInteger(payment.quantity) || payment.quantity < 1 ||
      payment.quantity > 50 || !payment.dorm || !order.dorm) return 0;
  // Similar totals in the same dorm must not confirm another customer's order.
  if (payment.dorm !== order.dorm || payment.service !== order.service || payment.quantity !== order.quantity) return 0;
  if (payment.room && order.room && payment.room !== order.room) return 0;
  if ((!payment.room || !order.room) && !(payment.tracking && payment.tracking === order.tracking)) return 0;
  let score = 55;
  const compare = (left, right, weight) => left && right ? (left === right ? weight : -weight) : 0;
  score += compare(payment.service, order.service, 10);
  score += Number.isInteger(payment.quantity) && payment.quantity > 0 ? compare(payment.quantity, order.quantity, 8) : 0;
  score += compare(payment.dorm, order.dorm, 10);
  score += compare(payment.room, order.room, 10);
  score += compare(payment.tracking, order.tracking, 12);
  score += compare(payment.carrier, order.carrier, 1);
  if ((payment.customer || payment.packageName) && order.customer) score += customerMatches ? 8 : -8;
  return score;
}

function sheetUpdates(payment) {
  const row = payment.raw;
  const nonempty = index => String(row[index] ?? '').trim();
  const updates = {
    amount_due: payment.amountCents / 100,
    service: payment.service,
    quantity: payment.quantity,
    dorm: String(row[5] ?? '').trim(),
    payment_method: payment.method,
    payment_status: 'paid',
  };
  if (nonempty(6)) updates.room = nonempty(6);
  if (nonempty(0)) updates.payment_time = nonempty(0);
  if (nonempty(15)) updates.email_id = nonempty(15);
  if (nonempty(12)) updates.package_name = nonempty(12);
  if (nonempty(1) || nonempty(12)) updates.recipient_name = nonempty(1) || nonempty(12);
  if (nonempty(7)) updates.carrier = nonempty(7);
  if (nonempty(8)) updates.tracking = nonempty(8);

  const pickupType = compact(row[9]);
  const source = pickupType.includes('locker') ? 'locker'
    : pickupType.includes('mail') || pickupType.includes('box') ? 'mailbox' : '';
  if (source) updates.source = source;
  if (source === 'locker') {
    if (nonempty(10)) updates.locker_location = nonempty(10);
    if (nonempty(11)) updates.locker_code = nonempty(11);
  } else if (source === 'mailbox') {
    if (nonempty(10)) updates.mailroom = nonempty(10);
    if (nonempty(11)) updates.box_number = nonempty(11);
  }
  return updates;
}

function uniqueBest(scores) {
  const sorted = scores.filter(item => item.score >= MATCH_THRESHOLD).sort((a, b) => b.score - a.score);
  if (!sorted.length || (sorted[1] && sorted[0].score - sorted[1].score < MINIMUM_LEAD)) return null;
  return sorted[0];
}

/** Require a strong, unique match in both directions before syncing a sheet row. */
export function findPaymentMatches(orders, values) {
  const layout = sheetLayout(values);
  if (!layout) throw new Error('The payment sheet columns do not match the expected Orders tab.');
  const records = values.slice(1).map(row => layout.map(index => index < 0 ? '' : row[index] ?? ''));
  // Identical imported rows are one payment; distinct payments still compete
  // for a unique match. Unpaid rows never block a confirmed payment.
  const unique = [...new Map(records.map(row => [JSON.stringify(row.map(clean)), row])).values()];
  const allRows = unique.map(paymentRecord);
  const rows = allRows.filter(row => row.status === 'paid');
  const eligible = orders.filter(order => amountCents(order.amount_due) !== null && Number(order.amount_due) >= 0 && ['venmo', 'zelle'].includes(canonicalMethod(order.payment_method)));
  const receiptOwners = new Map();
  for (const order of orders) {
    if (!order.email_id) continue;
    const key = clean(order.email_id);
    if (!receiptOwners.has(key)) receiptOwners.set(key, new Set());
    receiptOwners.get(key).add(order.id);
  }
  const scores = [];
  for (let orderIndex = 0; orderIndex < eligible.length; orderIndex++) {
    const order = orderRecord(eligible[orderIndex]);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const owners = receiptOwners.get(clean(rows[rowIndex].raw[15]));
      if (owners && (owners.size !== 1 || !owners.has(eligible[orderIndex].id))) continue;
      const score = similarity(order, rows[rowIndex]);
      if (score >= MATCH_THRESHOLD) scores.push({ orderIndex, rowIndex, score });
    }
  }

  const bestRowByOrder = eligible.map((_, orderIndex) => uniqueBest(scores.filter(item => item.orderIndex === orderIndex))?.rowIndex ?? null);
  const bestOrderByRow = rows.map((_, rowIndex) => uniqueBest(scores.filter(item => item.rowIndex === rowIndex))?.orderIndex ?? null);
  const updates = [];
  const matchedOrders = new Map();
  let ambiguous = 0;
  const unpaidRows = allRows.filter(row => row.status !== 'paid').length;
  let unmatched = 0;
  for (let orderIndex = 0; orderIndex < eligible.length; orderIndex++) {
    const rowIndex = bestRowByOrder[orderIndex];
    if (rowIndex === null || bestOrderByRow[rowIndex] !== orderIndex) {
      if (scores.some(item => item.orderIndex === orderIndex)) ambiguous++;
      else unmatched++;
      continue;
    }
    const payment = rows[rowIndex];
    matchedOrders.set(rowIndex, eligible[orderIndex]);
    if (eligible[orderIndex].payment_status !== 'refunded') {
      const changes = Object.fromEntries(Object.entries(sheetUpdates(payment)).filter(([field, value]) => String(eligible[orderIndex][field] ?? '') !== String(value)));
      if (Object.keys(changes).length) updates.push({ id: eligible[orderIndex].id, updates: changes });
    }
  }
  const sheetPayments = rows.map((payment, rowIndex) => {
    const order = matchedOrders.get(rowIndex);
    return {
      customer: payment.raw[1] || payment.raw[12] || 'Name not provided',
      packageName: payment.raw[12], amount: payment.amountCents === null ? null : payment.amountCents / 100,
      method: payment.raw[13], paymentTime: payment.raw[0], service: payment.raw[3],
      quantity: payment.raw[4], dorm: payment.raw[5], room: payment.raw[6], tracking: payment.raw[8],
      orderId: order?.id || null,
      matchStatus: order ? (order.payment_status === 'refunded' ? 'refunded' : 'matched')
        : scores.some(score => score.rowIndex === rowIndex) ? 'ambiguous' : 'unmatched',
    };
  });
  return { updates, ambiguous, unpaidRows, unmatched, sheetPayments };
}

export function paymentSheetHeaders(values) {
  return Boolean(sheetLayout(values));
}
