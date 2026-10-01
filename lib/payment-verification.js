const clean = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const compact = value => clean(value).replace(/[\s._-]+/g, '');

function canonicalService(value) {
  const key = compact(value);
  return ({
    express: 'express',
    pickup: 'pickup',
    return: 'returns',
    returns: 'returns',
    bigdrop: 'bigdrop',
  })[key] || '';
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
    amountCents: amountCents(row[2]),
    service: canonicalService(row[3]),
    quantity: Number(row[4]),
    dorm: clean(row[5]),
    room: clean(row[6]),
    carrier: clean(row[7]),
    tracking: compact(row[8]),
    method: canonicalMethod(row[13]),
    status: clean(row[14]),
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
  };
}

function hasRequiredFields(record) {
  return record.amountCents > 0 && record.method && record.service && Number.isInteger(record.quantity) &&
    record.quantity > 0 && record.dorm && record.room;
}

function sameOrder(record, candidate) {
  if (!hasRequiredFields(record) || !hasRequiredFields(candidate)) return false;
  if (record.amountCents !== candidate.amountCents || record.method !== candidate.method ||
      record.service !== candidate.service || record.quantity !== candidate.quantity ||
      record.dorm !== candidate.dorm || record.room !== candidate.room) return false;
  // Extra sheet details narrow a match when both sides contain the value.
  if (record.carrier && candidate.carrier && record.carrier !== candidate.carrier) return false;
  if (record.tracking && candidate.tracking && record.tracking !== candidate.tracking) return false;
  return true;
}

/** Match records one-to-one; a sheet row can never confirm two orders. */
export function findPaymentMatches(orders, values) {
  const rows = Array.isArray(values) ? values.slice(1).map(paymentRecord) : [];
  const eligible = orders.filter(order => Number(order.amount_due) > 0 && ['venmo', 'zelle'].includes(order.payment_method));
  const candidatesByOrder = new Map();
  const ordersByRow = new Map();

  for (const order of eligible) {
    const record = orderRecord(order);
    if (!hasRequiredFields(record)) continue;
    const candidates = rows.filter(row => sameOrder(record, row));
    candidatesByOrder.set(order.id, candidates);
    for (const row of candidates) {
      const claimants = ordersByRow.get(row.index) || [];
      claimants.push(order.id);
      ordersByRow.set(row.index, claimants);
    }
  }

  const confirmedIds = [];
  let ambiguous = 0;
  let unpaidRows = 0;
  let unmatched = 0;
  for (const order of eligible) {
    if (order.payment_status !== 'unconfirmed') continue;
    const candidates = candidatesByOrder.get(order.id) || [];
    if (candidates.length !== 1 || (ordersByRow.get(candidates[0]?.index) || []).length !== 1) {
      if (candidates.length > 1 || candidates.some(row => (ordersByRow.get(row.index) || []).length > 1)) ambiguous++;
      else unmatched++;
      continue;
    }
    if (candidates[0].status !== 'paid') { unpaidRows++; continue; }
    if (order.payment_status === 'unconfirmed') confirmedIds.push(order.id);
  }
  return { confirmedIds, ambiguous, unpaidRows, unmatched };
}

export function paymentSheetHeaders(values) {
  const headers = (values?.[0] || []).map(clean);
  const required = ['amount', 'service', 'package count', 'dorm', 'room', 'payment method', 'status'];
  return required.every(name => headers.includes(name));
}
