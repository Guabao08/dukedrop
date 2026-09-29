export const PROMO_CODES = Object.freeze({ AUSTIN20: 20, FREEDROP: 100, COMPEDROP: 100 });

const RESTRICTED_PROMOS = Object.freeze({
  FREEDROP: { dorm: 'craven house d', room: '214' },
  COMPEDROP: { dorm: 'pegram', room: '210' },
});

function normalize(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizePromoCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

export function promoDiscountPercent(code) {
  return PROMO_CODES[normalizePromoCode(code)] || 0;
}

export function isPromoEligible(code, order = {}) {
  const key = normalizePromoCode(code);
  if (!key) return true;
  const restriction = RESTRICTED_PROMOS[key];
  if (!restriction) return Boolean(PROMO_CODES[key]);
  return normalize(order.dorm) === restriction.dorm && normalize(order.room) === restriction.room;
}

export function promoMessage(code, order = {}) {
  const key = normalizePromoCode(code);
  if (!key) return '';
  const percent = promoDiscountPercent(key);
  if (!percent) return 'Invalid code';
  const restriction = RESTRICTED_PROMOS[key];
  if (restriction && !isPromoEligible(key, order)) return 'Invalid code';
  return `${key} applied: ${percent}% off your order.`;
}
