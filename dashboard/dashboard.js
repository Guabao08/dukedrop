import { pickupReadiness, pickupLocation, READINESS_LABELS } from './readiness.js';
import { ORDER_LABELS, PAYMENT_LABELS, FOLLOWUP_LABELS, SERVICE_LABELS, needsFollowup, filterOrders, summarizeOrders } from './order-model.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const date = (value, full = false) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString('en-US', full ? { dateStyle: 'medium', timeStyle: 'short' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not provided';
const queues = { tracking: ['Pickup readiness', 'Track all orders through collection.'], all: ['All orders', 'Your orders, newest first.'], active: ['Active deliveries', 'Orders still moving through your team’s workflow.'], unpaid: ['Payment review', 'Active orders with a balance awaiting payment confirmation.'], followup: ['Tracking follow-ups', 'Active orders whose tracking follow-up is due now.'], completed: ['Completed deliveries', 'The drops your team has finished.'] };
let allOrders = [], queue = 'all', selectedId = null, loading = false, saving = false, toastTimer, lastSync = null, detailOpener = null;
$('#today').textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' });
function notice(message = '') { $('#message').textContent = message; $('#message').hidden = !message; }
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function showLogin(message = '') {
  allOrders = []; selectedId = null; lastSync = null;
  $('#order-dialog').close(); $('#order-details').replaceChildren(); $('#orders').replaceChildren(); $('#stats').replaceChildren(); $('#pickup-orders').replaceChildren(); $('#pickup-summary').replaceChildren();
  $('#dashboard').hidden = true; $('#login').hidden = false; $('#login-message').textContent = message; $('#toast').hidden = true;
}
function showDashboard() { $('#login').hidden = true; $('#dashboard').hidden = false; }
async function load() {
  if (loading) return;
  loading = true; $('#refresh').disabled = true;
  try {
    const response = await fetch('/api/dashboard/orders', { cache: 'no-store' });
    if (response.status === 401) { showLogin(); return; }
    if (response.status === 503) { showLogin('Dashboard access is not configured yet.'); return; }
    if (!response.ok) throw new Error('Could not refresh orders. Please try again.');
    const orders = await response.json();
    if (!Array.isArray(orders)) throw new Error('Could not read the order list.');
    allOrders = orders; lastSync = new Date(); showDashboard(); notice(); render();
    if (selectedId && !saving) renderDetails();
  } catch (error) {
    if ($('#dashboard').hidden) $('#login-message').textContent = error.message;
    else { notice(error.message + ' The last loaded orders are still shown.'); $('#sync-state').textContent = 'Refresh needed'; $('#pickup-sync').textContent = 'Refresh needed'; }
  } finally { loading = false; $('#refresh').disabled = false; }
}
function badge(value, labels = ORDER_LABELS) {
  const color = ({ completed: 'green', paid: 'green', received: 'blue', in_progress: 'blue', payment_started: 'gold', unconfirmed: 'gold', cancelled: 'neutral', refunded: 'neutral' })[value] || 'neutral';
  return `<span class="badge ${color}">${esc(labels[value] || value || 'Unknown')}</span>`;
}
function render() {
  const summary = summarizeOrders(allOrders);
  $('#pickup-panel').hidden = queue !== 'tracking'; $('#order-panel').hidden = queue === 'tracking';
  renderPickup();
  for (const key of Object.keys(queues)) $(`#count-${key}`).textContent = key === 'all' ? allOrders.length : key === 'tracking' ? allOrders.filter(order => pickupReadiness(order).state === 'ready').length : summary[key];
  $('#stats').innerHTML = [ ['Active orders', summary.active, 'Awaiting completion', '↗'], ['Payment review', summary.unpaid, 'Active orders with an unpaid balance', '◷'], ['Tracking due', summary.followup, 'Ready for a follow-up', '↗'], ['Confirmed payments', money(summary.collected), 'All loaded orders marked paid', '✓'] ].map(([label, value, hint, icon]) => `<div class="stat-card"><div class="stat-label">${label}<span class="stat-icon" aria-hidden="true">${icon}</span></div><strong>${value}</strong><small>${hint}</small></div>`).join('');
  $('#queue-title').textContent = queues[queue][0]; $('#queue-description').textContent = queues[queue][1];
  document.querySelectorAll('[data-queue]').forEach(button => { const active = button.dataset.queue === queue; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#sync-state').textContent = lastSync ? `Updated ${lastSync.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Loading orders';
  const rows = filterOrders(allOrders, { queue, search: $('#search').value, service: $('#service-filter').value, status: $('#status-filter').value, payment: $('#payment-filter').value });
  $('#orders').innerHTML = rows.map(order => `<tr><td><div class="order-cell"><span class="order-mark" aria-hidden="true">◇</span><div><button class="order-link" data-open="${esc(order.id)}">${esc(order.recipient_name || order.phone || 'View order')}</button><small>#${esc(order.id.slice(0, 8))} · ${esc(date(order.created_at))}</small></div></div></td><td data-label="Destination"><strong>${esc(order.dorm || 'Not provided')}</strong><small>Room ${esc(order.room || '—')}</small></td><td data-label="Service"><strong>${esc(SERVICE_LABELS[order.service] || order.service)}</strong><small>${esc(order.quantity)} ${Number(order.quantity) === 1 ? 'item' : 'items'}${order.service === 'bigdrop' ? ` · ${esc(SERVICE_LABELS[order.base_service] || '')}` : ''}</small></td><td data-label="Payment"><strong>${money(order.amount_due)}</strong><small>${badge(order.payment_status, PAYMENT_LABELS)}</small></td><td data-label="Status">${badge(order.order_status)}${needsFollowup(order) ? '<small class="due-label">Tracking follow-up due</small>' : ''}</td><td><button class="icon-button" data-open="${esc(order.id)}" aria-label="View order ${esc(order.id.slice(0,8))}">↗</button></td></tr>`).join('');
  $('#empty').hidden = rows.length > 0;
  $('#empty').innerHTML = `<span class="empty-symbol" aria-hidden="true">◇</span><h3>${allOrders.length ? 'Nothing in this view.' : 'Ready for the first drop.'}</h3><p>${allOrders.length ? 'Try another queue or clear your filters to see more orders.' : 'New orders will appear here when customers start checkout.'}</p>`;
  $('#result-count').textContent = `${rows.length} of ${allOrders.length} orders`;
}
function field(label, value, wide = false) { return `<dl${wide ? ' class="wide"' : ''}><dt>${esc(label)}</dt><dd>${esc(value || 'Not provided')}</dd></dl>`; }
function options(labels, selected) { return Object.entries(labels).map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join(''); }
function renderDetails() {
  const order = allOrders.find(item => item.id === selectedId);
  if (!order) { $('#order-dialog').close(); selectedId = null; return; }
  $('#detail-title').textContent = `Order #${order.id.slice(0, 8)}`;
  const phone = String(order.phone || '').replace(/[^+\d]/g, '');
  const sms = `sms:${phone}?body=${encodeURIComponent(`Hi${order.recipient_name ? ` ${order.recipient_name}` : ''}, this is DukeDrop following up on your order. Could you send us the tracking number when available?`)}`;
  $('#order-details').innerHTML = `<section class="detail-section"><div class="detail-grid">${field('Customer', order.recipient_name)}${field('Phone', order.phone)}${field('Dorm', order.dorm)}${field('Room', order.room)}${field('Placed', date(order.created_at, true))}${field('Service', `${SERVICE_LABELS[order.service] || order.service} · ${order.quantity} ${Number(order.quantity) === 1 ? 'item' : 'items'}`)}${order.service === 'bigdrop' ? field('Base service', SERVICE_LABELS[order.base_service]) : ''}</div>${phone ? `<div class="detail-actions"><a class="button" href="tel:${esc(phone)}">Call customer ↗</a><a class="button" href="${esc(sms)}">Open text message ↗</a></div>` : ''}</section><section class="detail-section"><h3>Fulfillment details</h3><div class="detail-grid">${field('Carrier', order.carrier)}${field('Tracking', order.tracking, true)}${order.source ? field('Pickup source', order.source === 'locker' ? 'Locker' : 'Mailroom') : ''}${order.fulfillment_mode ? field('Fulfillment', order.fulfillment_mode === 'ship' ? 'Ship to DukeDrop' : 'Pickup') : ''}${order.mailroom ? field('Mailroom', order.mailroom) : ''}${order.box_number ? field('Box number', order.box_number) : ''}${order.locker_location ? field('Locker location', order.locker_location) : ''}${order.locker_code ? field('Locker code', order.locker_code) : ''}</div></section><section class="detail-section"><h3>Pickup readiness</h3><p>${esc(pickupReadiness(order).label)} · ${esc(pickupReadiness(order).source)}</p><p class="detail-note">${esc(pickupReadiness(order).reason)}</p><div class="detail-grid">${field('Collection location', pickupLocation(order))}${field('Last staff update', order.pickup_updated_at ? date(order.pickup_updated_at, true) : 'No staff update')}</div><form id="readiness-form"><label>Readiness for all ${esc(order.quantity)} ${Number(order.quantity) === 1 ? 'item' : 'items'}<select name="pickup_readiness">${options(READINESS_LABELS, order.pickup_readiness || 'auto')}</select></label><label>Collection note<textarea name="pickup_note" maxlength="1000" rows="3" placeholder="Confirmation source, collection instructions, or reason for a hold">${esc(order.pickup_note || '')}</textarea></label><p class="detail-note">Choose Ready to collect only after all items are available. Collected removes the order from the ready list; it does not complete the delivery.</p><button class="button primary" type="submit">Save readiness</button></form></section><section class="detail-section"><h3>Payment & progress</h3><div class="detail-grid">${field('Amount due', money(order.amount_due))}${field('Payment method', order.payment_method)}${order.promo_code ? field('Promotion', `${order.promo_code} · ${order.discount_percent}% off`) : ''}</div><form id="update-form"><div class="edit-grid" style="margin-top:20px"><label>Order status<select name="order_status">${options(ORDER_LABELS, order.order_status)}</select></label><label>Payment status<select name="payment_status">${options(PAYMENT_LABELS, order.payment_status)}</select></label></div><p class="detail-note">Confirm payment in the payment app before marking an order paid.</p><button class="button primary" type="submit">Save changes</button></form></section><section class="detail-section"><h3>Tracking follow-up</h3><div class="detail-grid">${field('Follow-up status', FOLLOWUP_LABELS[order.tracking_followup_status] || order.tracking_followup_status)}${field('Due', order.tracking_followup_due_at ? date(order.tracking_followup_due_at, true) : 'No follow-up scheduled')}${order.tracking_followup_sent_at ? field('Last marked sent', date(order.tracking_followup_sent_at, true)) : ''}</div>${['pending','sent'].includes(order.tracking_followup_status) ? `<p class="detail-note">Open a text message above, send it, then mark the follow-up as sent here.</p><div class="detail-actions">${order.tracking_followup_status === 'pending' ? '<button class="button" data-followup="sent">Mark as sent</button>' : ''}<button class="button" data-followup="skipped">Skip follow-up</button></div>` : ''}</section>`;
}
async function updateOrder(updates) {
  if (saving || !selectedId) return;
  const id = selectedId;
  saving = true;
  $('#order-details').querySelectorAll('button, select, textarea').forEach(element => { element.disabled = true; });
  try {
    const response = await fetch('/api/dashboard/orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, updates }) });
    if (response.status === 401) { showLogin('Your session expired. Please sign in again.'); return; }
    if (!response.ok) throw new Error('Changes could not be saved. Please try again.');
    const order = allOrders.find(item => item.id === id);
    if (order) Object.assign(order, updates, ('pickup_readiness' in updates || 'pickup_note' in updates) ? { pickup_updated_at: new Date().toISOString() } : {});
    render(); if (selectedId === id) renderDetails(); toast('Order updated.');
  } catch (error) { toast(error.message); }
  finally { saving = false; $('#order-details').querySelectorAll('button, select, textarea').forEach(element => { element.disabled = false; }); }
}
$('#sign-in-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#sign-in').disabled = true; $('#login-message').textContent = 'Signing in…';
  try {
    const response = await fetch('/api/dashboard/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#password').value }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Sign in failed.');
    $('#password').value = ''; await load();
  } catch (error) { $('#login-message').textContent = error.message; }
  finally { $('#sign-in').disabled = false; }
});
$('#sign-out').onclick = async () => {
  $('#sign-out').disabled = true;
  try { const response = await fetch('/api/dashboard/logout', { method: 'POST' }); if (!response.ok) throw new Error(); showLogin('You have signed out.'); }
  catch { toast('Could not sign out. Please try again.'); }
  finally { $('#sign-out').disabled = false; }
};
$('#refresh').onclick = load;
$('#pickup-search').oninput = renderPickup;
$('#pickup-filter').onchange = renderPickup;
$('#pickup-service').onchange = renderPickup;
setInterval(() => { if (!document.hidden && !$('#dashboard').hidden && !selectedId && !saving) load(); }, 60000);
$('#queue-nav').onclick = event => { const button = event.target.closest('[data-queue]'); if (button) { queue = button.dataset.queue; render(); } };
$('#search').oninput = render;
for (const id of ['service-filter', 'status-filter', 'payment-filter']) $(`#${id}`).onchange = render;
$('#reset-filters').onclick = () => { for (const id of ['search', 'service-filter', 'status-filter', 'payment-filter']) $(`#${id}`).value = ''; render(); };
function openOrder(event) { const button = event.target.closest('[data-open]'); if (!button) return; detailOpener = button; selectedId = button.dataset.open; renderDetails(); $('#order-dialog').showModal(); }
$('#orders').onclick = openOrder; $('#pickup-orders').onclick = openOrder;
$('#close-details').onclick = () => $('#order-dialog').close();
$('#order-dialog').addEventListener('close', () => { selectedId = null; detailOpener?.isConnected && detailOpener.focus(); });
$('#order-details').addEventListener('submit', event => { if (event.target.id === 'readiness-form') { event.preventDefault(); const values = new FormData(event.target); updateOrder({ pickup_readiness: values.get('pickup_readiness'), pickup_note: values.get('pickup_note').trim() }); return; } if (event.target.id !== 'update-form') return; event.preventDefault(); const values = new FormData(event.target); updateOrder({ order_status: values.get('order_status'), payment_status: values.get('payment_status') }); });
$('#order-details').onclick = event => { const button = event.target.closest('[data-followup]'); if (!button) return; const updates = { tracking_followup_status: button.dataset.followup }; if (updates.tracking_followup_status === 'sent') updates.tracking_followup_sent_at = new Date().toISOString(); updateOrder(updates); };
load();

function renderPickup() {
  $('#pickup-sync').textContent = lastSync ? `Orders updated ${lastSync.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Loading orders';
  const states = allOrders.map(order => pickupReadiness(order).state);
  $('#pickup-summary').innerHTML = [['ready','Ready to collect'],['waiting','Waiting'],['hold','On hold'],['collected','Collected']].map(([key,label]) => `<div><strong>${states.filter(state => state === key).length}</strong><span>${label}</span></div>`).join('');
  const rows = filterOrders(allOrders, { search: $('#pickup-search').value, service: $('#pickup-service').value }).filter(order => !$('#pickup-filter').value || pickupReadiness(order).state === $('#pickup-filter').value);
  const priority = { ready: 0, hold: 1, waiting: 2, collected: 3, closed: 4 };
  rows.sort((a,b) => priority[pickupReadiness(a).state] - priority[pickupReadiness(b).state]);
  $('#pickup-empty').hidden = rows.length > 0;
  $('#pickup-orders').innerHTML = rows.map(order => {
    const readiness = pickupReadiness(order);
    return `<article class="pickup-card"><div class="pickup-card-heading"><div><button class="order-link" data-open="${esc(order.id)}">${esc(order.recipient_name || order.phone || 'View order')} ↗</button><p class="muted">#${esc(order.id.slice(0,8))} · ${esc(SERVICE_LABELS[order.service] || order.service)}${order.service === 'bigdrop' ? ` / ${esc(SERVICE_LABELS[order.base_service] || 'Unspecified')}` : ''} · ${esc(order.quantity)} ${Number(order.quantity) === 1 ? 'item' : 'items'}</p></div><span class="badge ${readiness.state === 'ready' ? 'green' : readiness.state === 'waiting' || readiness.state === 'hold' ? 'gold' : 'neutral'}">${esc(readiness.label)}</span></div><div class="pickup-card-body"><div><small>COLLECTION LOCATION</small><strong>${esc(pickupLocation(order))}</strong><p>${esc(readiness.reason)}</p><small>${esc(readiness.source)}</small></div><div><small>ORDER DETAILS</small><strong>${esc(order.dorm)} · Room ${esc(order.room)}</strong><p class="tracking-number">${esc(order.carrier || '')} ${esc(order.tracking || 'No tracking recorded')}</p>${badge(order.payment_status, PAYMENT_LABELS)} <span>${money(order.amount_due)}</span></div></div><button class="text-button" data-open="${esc(order.id)}">Manage collection →</button></article>`;
  }).join('');
}
