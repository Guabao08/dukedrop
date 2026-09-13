export const VENMO_USERNAME = 'Timothymei71';
export const PRICES = { express: { S: 5.99, M: 4.99, L: 3.99 }, pickup: { S: 3.99, M: 2.99, L: 1.99 }, returns: { S: 4.99, M: 3.99, L: 2.99 } };
export function calculateAmount(service, size, quantity) {
  if (!PRICES[service]?.[size] || !Number.isInteger(quantity) || quantity < 1) throw new Error('Invalid order');
  return Math.round(PRICES[service][size] * quantity * 100) / 100;
}
export function buildNote({ dorm, room, size, tracking, carrier }) {
  return `DukeDrop | Dorm: ${dorm.trim()} | Room: ${room.trim()} | Size: ${size} | Tracking: ${tracking.trim()} | Carrier: ${carrier.trim()}`;
}
export function validateOrder(order) {
  const missing = ['dorm','room','tracking','carrier'].filter(k => !String(order[k] ?? '').trim());
  if (!['S','M','L'].includes(order.size)) missing.push('package size');
  if (!PRICES[order.service]) missing.push('service');
  if (!Number.isInteger(order.quantity) || order.quantity < 1) missing.push('quantity');
  return { valid: missing.length === 0, missing };
}
export function venmoLinks(order) {
  const check = validateOrder(order); if (!check.valid) throw new Error(`Missing: ${check.missing.join(', ')}`);
  const amount = calculateAmount(order.service, order.size, order.quantity).toFixed(2);
  const params = new URLSearchParams({ txn:'pay', recipients:VENMO_USERNAME, amount, note:buildNote(order) });
  return { amount, note: buildNote(order), deepLink: `venmo://paycharge?${params}`, webLink: `https://venmo.com/?${params}` };
}

if (typeof document !== 'undefined') {
  const form = document.querySelector('#order-form'), status = document.querySelector('#status'), amount = document.querySelector('#amount'), note = document.querySelector('#note');
  const fields = () => Object.fromEntries(new FormData(form));
  function refresh() { const o=fields(), v=validateOrder({...o,quantity:Number(o.quantity)}); amount.textContent=v.valid ? `$${calculateAmount(o.service,o.size,Number(o.quantity)).toFixed(2)}` : '—'; note.textContent=v.valid ? buildNote(o) : 'Complete every field to generate your payment note.'; form.querySelector('button[type=submit]').disabled=!v.valid; }
  form.addEventListener('input',refresh); form.addEventListener('change',refresh);
  form.addEventListener('submit', e => { e.preventDefault(); const o=fields(); const links=venmoLinks({...o,quantity:Number(o.quantity)}); status.hidden=false; status.innerHTML=`Review and submit payment in Venmo for <strong>$${links.amount}</strong>. If the app does not open, <a href="${links.webLink}" target="_blank" rel="noopener">open Venmo in your browser</a> or use Venmo for <strong>@${VENMO_USERNAME}</strong> and copy the note below.`; window.location.href=links.deepLink; }); refresh();
}
