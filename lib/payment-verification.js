const clean = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const compact = value => clean(value).replace(/[\s._-]+/g, '');
const MATCH_THRESHOLD = 80;
const MINIMUM_LEAD = 8;

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
  const accountingNegative = /^\(.*\)$/.test(text);
  const amount = Number(text.replace(/[,$\s]/g, '').replace(/^\((.*)\)$/, '$1'));
  return Number.isFinite(amount) ? Math.round(amount * 100) * (accountingNegative ? -1 : 1) : 0;
}

function paymentRecord(row, index) {
  return {
    index,
    raw: row,
    amountCents: amountCents(row[2]),
    service: canonicalService(row[3]),
    quantity: Number(row[4]),
    dorm: clean(row[5]),
    room: clean(row[6]),
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
    room: clean(order.room),
    carrier: clean(order.carrier),
    tracking: compact(order.tracking),
    method: canonicalMethod(order.payment_method),
    customer: clean(order.recipient_name),
  };
}

function similarity(order, payment) {
  // Amount and payment channel are the financial anchors; mismatches cannot pass.
  if (!payment.method || payment.method !== order.method || payment.amountCents <= 0 || payment.amountCents !== order.amountCents) return 0;
  if (!payment.service || !order.service || !Number.isInteger(payment.quantity) || payment.quantity < 1 ||
      !payment.dorm || !payment.room || !order.dorm || !order.room) return 0;
  let score = 55;
  const compare = (left, right, weight) => left && right ? (left === right ? weight : -weight) : 0;
  score += compare(payment.service, order.service, 10);
  score += Number.isInteger(payment.quantity) && payment.quantity > 0 ? compare(payment.quantity, order.quantity, 8) : 0;
  score += compare(payment.dorm, order.dorm, 10);
  score += compare(payment.room, order.room, 10);
  score += compare(payment.tracking, order.tracking, 4);
  score += compare(payment.carrier, order.carrier, 1);
  if (payment.customer && order.customer) score += payment.customer === order.customer || payment.packageName === order.customer ? 2 : -2;
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
    room: String(row[6] ?? '').trim(),
    payment_method: payment.method,
    payment_status: 'paid',
    payment_time: nonempty(0),
    email_id: nonempty(15),
    package_name: nonempty(12),
  };
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
  const rows = Array.isArray(values) ? values.slice(1).map(paymentRecord) : [];
  const eligible = orders.filter(order => Number(order.amount_due) > 0 && ['venmo', 'zelle'].includes(order.payment_method));
  const scores = [];
  for (let orderIndex = 0; orderIndex < eligible.length; orderIndex++) {
    const order = orderRecord(eligible[orderIndex]);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const score = similarity(order, rows[rowIndex]);
      if (score >= MATCH_THRESHOLD) scores.push({ orderIndex, rowIndex, score });
    }
  }

  const bestRowByOrder = eligible.map((_, orderIndex) => uniqueBest(scores.filter(item => item.orderIndex === orderIndex))?.rowIndex ?? null);
  const bestOrderByRow = rows.map((_, rowIndex) => uniqueBest(scores.filter(item => item.rowIndex === rowIndex))?.orderIndex ?? null);
  const updates = [];
  let ambiguous = 0;
  let unpaidRows = 0;
  let unmatched = 0;
  for (let orderIndex = 0; orderIndex < eligible.length; orderIndex++) {
    const rowIndex = bestRowByOrder[orderIndex];
    if (rowIndex === null || bestOrderByRow[rowIndex] !== orderIndex) {
      if (scores.some(item => item.orderIndex === orderIndex)) ambiguous++;
      else unmatched++;
      continue;
    }
    const payment = rows[rowIndex];
    if (payment.status !== 'paid') { unpaidRows++; continue; }
    if (eligible[orderIndex].payment_status !== 'refunded') {
      updates.push({ id: eligible[orderIndex].id, updates: sheetUpdates(payment) });
    }
  }
  return { updates, ambiguous, unpaidRows, unmatched };
}

export function paymentSheetHeaders(values) {
  const headers = (values?.[0] || []).map(clean);
  const expected = ['payment time', 'customer', 'amount', 'service', 'package count', 'dorm', 'room', 'carrier', 'tracking', 'pickup type', 'pickup location', 'pickup code/box', 'package name', 'payment method', 'status', 'email id'];
  return expected.every((name, index) => headers[index] === name);
}
