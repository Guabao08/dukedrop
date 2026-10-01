import { pickupReadiness, pickupLocation, READINESS_LABELS } from './readiness.js';
import { ORDER_LABELS, PAYMENT_LABELS, FOLLOWUP_LABELS, SERVICE_LABELS, needsFollowup, filterOrders, summarizeOrders } from './order-model.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const date = (value, full = false) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString('en-US', full ? { dateStyle: 'medium', timeStyle: 'short' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not provided';
const queues = { tracking: ['Pickup readiness', 'Track all orders through collection.'], all: ['All orders', 'Your orders, newest first.'], active: ['Active deliveries', 'Orders still moving through your team’s workflow.'], unpaid: ['Payment review', 'Active orders with a balance awaiting payment confirmation.'], followup: ['Tracking follow-ups', 'Active orders whose tracking follow-up is due now.'], completed: ['Completed deliveries', 'The drops your team has finished.'] };
let trackingConfigured = false, syncingCarriers = false, paymentSheetConfigured = false, verifyingPayments = false;
let allOrders = [], queue = 'all', selectedId = null, loading = false, saving = false, deleteConfirming = false, toastTimer, lastSync = null, detailOpener = null;
$('#today').textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' });
function notice(message = '') { $('#message').textContent = message; $('#message').hidden = !message; }
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function showLogin(message = '') {
  allOrders = []; selectedId = null; lastSync = null; paymentSheetConfigured = false; deleteConfirming = false;
  $('#order-dialog').close(); $('#order-details').replaceChildren(); $('#orders').replaceChildren(); $('#stats').replaceChildren(); $('#pickup-orders').replaceChildren(); $('#pickup-summary').replaceChildren(); trackingConfigured = false;
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
    allOrders = orders;
    try { const configResponse = await fetch('/api/dashboard/tracking', { cache: 'no-store' }); if (configResponse.ok) { trackingConfigured = Boolean((await configResponse.json()).configured); } } catch { trackingConfigured = false; }
    paymentSheetConfigured = false;
    try {
      const paymentResponse = await fetch('/api/dashboard/payments', { cache: 'no-store' });
      if (paymentResponse.ok) paymentSheetConfigured = Boolean((await paymentResponse.json()).configured);
    } catch { paymentSheetConfigured = false; }
    $('#payment-sheet-state').textContent = paymentSheetConfigured ? 'Sheet connected' : 'Sheet access needs setup';
    $('#verify-payments').disabled = !paymentSheetConfigured || verifyingPayments;
    $('#tracking-connection').textContent = trackingConfigured ? 'Carrier integration configured' : 'Carrier connection needed';
    $('#sync-carriers').disabled = !trackingConfigured || syncingCarriers;
    if (!trackingConfigured) $('#tracking-message').textContent = 'Live updates need an EasyPost connection. Tracking details can be saved now.';
    lastSync = new Date(); showDashboard(); notice(); render();
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
  const sort = $('#sort-orders').value;
  const time = order => new Date(order.created_at || 0).getTime() || 0;
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  rows.sort((a, b) => sort === 'oldest' ? time(a) - time(b)
    : sort === 'customer' ? collator.compare(a.recipient_name || a.phone || '', b.recipient_name || b.phone || '')
      : sort === 'room' ? collator.compare(`${a.dorm || ''} ${a.room || ''}`, `${b.dorm || ''} ${b.room || ''}`)
        : sort === 'unpaid' ? Number(b.payment_status === 'unconfirmed' && Number(b.amount_due) > 0) - Number(a.payment_status === 'unconfirmed' && Number(a.amount_due) > 0) || Number(b.amount_due || 0) - Number(a.amount_due || 0) || time(b) - time(a)
          : time(b) - time(a));
  $('#orders').innerHTML = rows.map(order => `<tr><td data-label="Order / customer"><div class="order-cell"><span class="order-mark" aria-hidden="true">◇</span><div class="order-primary"><button class="order-link" data-open="${esc(order.id)}">${esc(order.recipient_name || 'Customer')}</button><a class="order-phone" href="tel:${esc(order.phone || '')}">${esc(order.phone || 'No phone')}</a><small>#${esc(order.id.slice(0, 8))} · ${esc(date(order.created_at))}</small></div></div></td><td data-label="Destination"><strong>${esc(order.dorm || 'Not provided')}</strong><small>Room ${esc(order.room || '—')}</small></td><td data-label="Service"><strong>${esc(SERVICE_LABELS[order.service] || order.service)}</strong><small>${esc(order.quantity)} ${Number(order.quantity) === 1 ? 'item' : 'items'}${order.service === 'bigdrop' ? ` · ${esc(SERVICE_LABELS[order.base_service] || '')}` : ''}</small></td><td data-label="Payment"><strong>${money(order.amount_due)}</strong><small>${badge(order.payment_status, PAYMENT_LABELS)}</small></td><td data-label="Status">${badge(order.order_status)}${needsFollowup(order) ? '<small class="due-label">Tracking follow-up due</small>' : ''}</td><td data-label="Details"><button class="open-order" data-open="${esc(order.id)}" aria-label="Open order ${esc(order.id.slice(0,8))}">Open <span aria-hidden="true">↗</span></button></td></tr>`).join('');
  $('#empty').hidden = rows.length > 0;
  $('#empty').innerHTML = `<span class="empty-symbol" aria-hidden="true">◇</span><h3>${allOrders.length ? 'Nothing in this view.' : 'Ready for the first drop.'}</h3><p>${allOrders.length ? 'Try another queue or clear your filters to see more orders.' : 'New orders will appear here when customers start checkout.'}</p>`;
  $('#result-count').textContent = `Showing ${rows.length} of ${allOrders.length} orders`;
  $('#reset-filters').hidden = !($('#search').value || $('#service-filter').value || $('#status-filter').value || $('#payment-filter').value || sort !== 'newest');
}
function field(label, value, wide = false) { return `<dl${wide ? ' class="wide"' : ''}><dt>${esc(label)}</dt><dd>${esc(value || 'Not provided')}</dd></dl>`; }
function options(labels, selected) { return Object.entries(labels).map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join(''); }
function renderDetails() {
  const order = allOrders.find(item => item.id === selectedId);
  if (!order) { $('#order-dialog').close(); selectedId = null; return; }
  $('#detail-title').textContent = `Order #${order.id.slice(0, 8)}`;
  const phone = String(order.phone || '').replace(/[^+\d]/g, '');
  const sms = `sms:${phone}?body=${encodeURIComponent(`Hi${order.recipient_name ? ` ${order.recipient_name}` : ''}, this is DukeDrop following up on your order. Could you send us the tracking number when available?`)}`;
  $('#order-details').innerHTML = `<section class="detail-section"><div class="detail-grid">${field('Customer', order.recipient_name)}${field('Phone', order.phone)}${field('Dorm', order.dorm)}${field('Room', order.room)}${field('Placed', date(order.created_at, true))}${field('Service', `${SERVICE_LABELS[order.service] || order.service} · ${order.quantity} ${Number(order.quantity) === 1 ? 'item' : 'items'}`)}${order.service === 'bigdrop' ? field('Base service', SERVICE_LABELS[order.base_service]) : ''}</div>${phone ? `<div class="detail-actions"><a class="button" href="tel:${esc(phone)}">Call customer ↗</a><a class="button" href="${esc(sms)}">Open text message ↗</a></div>` : ''}</section><section class="detail-section"><h3>Fulfillment details</h3><div class="detail-grid">${field('Carrier', order.carrier)}${field('Tracking', order.tracking, true)}${order.source ? field('Pickup source', order.source === 'locker' ? 'Locker' : 'Mailroom') : ''}${order.fulfillment_mode ? field('Fulfillment', order.fulfillment_mode === 'ship' ? 'Ship to DukeDrop' : 'Pickup') : ''}${order.mailroom ? field('Mailroom', order.mailroom) : ''}${order.box_number ? field('Box number', order.box_number) : ''}${order.locker_location ? field('Locker location', order.locker_location) : ''}${order.locker_code ? field('Locker code', order.locker_code) : ''}</div></section>${trackingDetails(order)}<section class="detail-section"><h3>Pickup readiness</h3><p>${esc(pickupReadiness(order).label)} · ${esc(pickupReadiness(order).source)}</p><p class="detail-note">${esc(pickupReadiness(order).reason)}</p><div class="detail-grid">${field('Collection location', pickupLocation(order))}${field('Last staff update', order.pickup_updated_at ? date(order.pickup_updated_at, true) : 'No staff update')}</div><form id="readiness-form"><label>Readiness for all ${esc(order.quantity)} ${Number(order.quantity) === 1 ? 'item' : 'items'}<select name="pickup_readiness">${options(READINESS_LABELS, order.pickup_readiness || 'auto')}</select></label><label>Collection note<textarea name="pickup_note" maxlength="1000" rows="3" placeholder="Confirmation source, collection instructions, or reason for a hold">${esc(order.pickup_note || '')}</textarea></label><p class="detail-note">Choose Ready to collect only after all items are available. Collected removes the order from the ready list; it does not complete the delivery.</p><button class="button primary" type="submit">Save readiness</button></form></section><section class="detail-section"><h3>Payment & progress</h3><div class="detail-grid">${field('Amount due', money(order.amount_due))}${field('Payment method', order.payment_method)}${order.promo_code ? field('Promotion', `${order.promo_code} · ${order.discount_percent}% off`) : ''}</div><form id="update-form"><div class="edit-grid" style="margin-top:20px"><label>Order status<select name="order_status">${options(ORDER_LABELS, order.order_status)}</select></label><label>Payment status<select name="payment_status">${options(PAYMENT_LABELS, order.payment_status)}</select></label></div><p class="detail-note">Confirm payment in the payment app before marking an order paid.</p><button class="button primary" type="submit">Save changes</button></form></section><section class="detail-section"><h3>Tracking follow-up</h3><div class="detail-grid">${field('Follow-up status', FOLLOWUP_LABELS[order.tracking_followup_status] || order.tracking_followup_status)}${field('Due', order.tracking_followup_due_at ? date(order.tracking_followup_due_at, true) : 'No follow-up scheduled')}${order.tracking_followup_sent_at ? field('Last marked sent', date(order.tracking_followup_sent_at, true)) : ''}</div>${['pending','sent'].includes(order.tracking_followup_status) ? `<p class="detail-note">Open a text message above, send it, then mark the follow-up as sent here.</p><div class="detail-actions">${order.tracking_followup_status === 'pending' ? '<button class="button" data-followup="sent">Mark as sent</button>' : ''}<button class="button" data-followup="skipped">Skip follow-up</button></div>` : ''}</section>`;
  const reference = order.id.slice(0, 8).toUpperCase();
  $('#order-details').insertAdjacentHTML('beforeend', `<section class="detail-section"><h3>Payment sheet details</h3><div class="detail-grid">${field('Payment Time', order.payment_time)}${field('Package Name', order.package_name)}${field('Email ID', order.email_id)}</div></section>`);
  $('#order-details').insertAdjacentHTML('beforeend', deleteConfirming
    ? `<section class="detail-section danger-zone"><h3>Confirm deletion</h3><p>This permanently deletes ${esc(order.recipient_name || 'this order')} #${reference} and its tracking entries.</p><form id="delete-order-form"><label>Type <strong>DELETE #${reference}</strong> to confirm<input name="confirmation" autocomplete="off" autocapitalize="characters" spellcheck="false" required aria-label="Type DELETE and the order reference to confirm"></label><div class="detail-actions"><button type="button" class="button" data-cancel-delete>Cancel</button><button type="submit" class="button danger">Permanently delete order</button></div></form></section>`
    : '<section class="detail-section danger-zone"><h3>Remove entry</h3><p>Delete this order and its linked tracking entries.</p><button type="button" class="button danger" data-delete-order>Delete order…</button></section>');
}
async function updateOrder(updates) {
  if (saving || !selectedId) return;
  const id = selectedId;
  saving = true;
  $('#order-details').querySelectorAll('button, select, textarea, input').forEach(element => { element.disabled = true; });
  try {
    const response = await fetch('/api/dashboard/orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, updates }) });
    if (response.status === 401) { showLogin('Your session expired. Please sign in again.'); return; }
    if (!response.ok) throw new Error('Changes could not be saved. Please try again.');
    const order = allOrders.find(item => item.id === id);
    if (order) Object.assign(order, updates, ('pickup_readiness' in updates || 'pickup_note' in updates) ? { pickup_updated_at: new Date().toISOString() } : {});
    render(); if (selectedId === id) renderDetails(); toast('Order updated.');
  } catch (error) { toast(error.message); }
  finally { saving = false; $('#order-details').querySelectorAll('button, select, textarea, input').forEach(element => { element.disabled = false; }); }
}
async function deleteOrder(confirmation) {
  if (saving || !selectedId) return;
  const id = selectedId;
  const expected = `DELETE #${id.slice(0, 8).toUpperCase()}`;
  if (confirmation !== expected) { toast(`Type ${expected} exactly to confirm deletion.`); return; }
  saving = true;
  $('#order-details').querySelectorAll('button, select, textarea, input').forEach(element => { element.disabled = true; });
  try {
    const response = await fetch('/api/dashboard/orders', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, confirmation }),
    });
    if (response.status === 401) { showLogin('Your session expired. Please sign in again.'); return; }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete the order.');
    allOrders = allOrders.filter(order => order.id !== id);
    selectedId = null; deleteConfirming = false;
    $('#order-dialog').close();
    render();
    toast('Order and linked tracking entries deleted.');
  } catch (error) {
    toast(error.message);
  } finally {
    saving = false;
    if ($('#order-dialog').open) $('#order-details').querySelectorAll('button, select, textarea, input').forEach(element => { element.disabled = false; });
  }
}
$('#sign-in-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#sign-in').disabled = true; $('#login-message').textContent = 'Signing in…';
  try {
    const response = await fetch('/api/dashboard/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#password').value }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Sign in failed.');
    $('#password').value = ''; await load(); if (!$('#dashboard').hidden) syncCarriers(true);
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
$('#verify-payments').onclick = verifyPayments;
$('#pickup-search').oninput = renderPickup;
$('#pickup-filter').onchange = renderPickup;
$('#pickup-service').onchange = renderPickup;
setInterval(async () => { if (!document.hidden && !$('#dashboard').hidden && !selectedId && !saving) { await syncCarriers(false); await load(); } }, 60000);
$('#sync-carriers').onclick = () => syncCarriers(true);
$('#queue-nav').onclick = event => { const button = event.target.closest('[data-queue]'); if (button) { queue = button.dataset.queue; render(); } };
$('#search').oninput = render;
for (const id of ['service-filter', 'status-filter', 'payment-filter', 'sort-orders']) $(`#${id}`).onchange = render;
$('#reset-filters').onclick = () => { for (const id of ['search', 'service-filter', 'status-filter', 'payment-filter']) $(`#${id}`).value = ''; $('#sort-orders').value = 'newest'; render(); };
function openOrder(event) { const button = event.target.closest('[data-open]'); if (!button) return; detailOpener = button; selectedId = button.dataset.open; deleteConfirming = false; renderDetails(); $('#order-dialog').showModal(); }
$('#orders').onclick = openOrder; $('#pickup-orders').onclick = openOrder;
$('#close-details').onclick = () => $('#order-dialog').close();
$('#order-dialog').addEventListener('close', () => { selectedId = null; deleteConfirming = false; detailOpener?.isConnected && detailOpener.focus(); });
$('#order-details').addEventListener('submit', event => { if (event.target.id === 'tracking-form') { event.preventDefault(); const values = new FormData(event.target); changeTracking('POST', { order_id: selectedId, tracking_code: values.get('tracking_code'), carrier: values.get('carrier'), items_count: Number(values.get('items_count')) }); return; } if (event.target.id === 'readiness-form') { event.preventDefault(); const values = new FormData(event.target); updateOrder({ pickup_readiness: values.get('pickup_readiness'), pickup_note: values.get('pickup_note').trim() }); return; } if (event.target.id !== 'update-form') return; event.preventDefault(); const values = new FormData(event.target); updateOrder({ order_status: values.get('order_status'), payment_status: values.get('payment_status') }); });
$('#order-details').addEventListener('submit', event => {
  if (event.target.id !== 'delete-order-form') return;
  event.preventDefault();
  deleteOrder(new FormData(event.target).get('confirmation'));
});
$('#order-details').addEventListener('click', event => {
  if (event.target.closest('[data-delete-order]')) { deleteConfirming = true; renderDetails(); return; }
  if (event.target.closest('[data-cancel-delete]')) { deleteConfirming = false; renderDetails(); }
});
$('#order-details').onclick = event => { const remove = event.target.closest('[data-remove-tracking]'); if (remove) { changeTracking('DELETE', { id: remove.dataset.removeTracking }); return; } const button = event.target.closest('[data-followup]'); if (!button) return; const updates = { tracking_followup_status: button.dataset.followup }; if (updates.tracking_followup_status === 'sent') updates.tracking_followup_sent_at = new Date().toISOString(); updateOrder(updates); };
load().then(() => { if (!$('#dashboard').hidden) syncCarriers(true); });

async function verifyPayments() {
  if (verifyingPayments || !paymentSheetConfigured) return;
  verifyingPayments = true;
  $('#verify-payments').disabled = true;
  $('#payment-sheet-state').textContent = 'Checking sheet for unique paid matches…';
  try {
    const response = await fetch('/api/dashboard/payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify' }),
    });
    if (response.status === 401) { showLogin('Your session expired. Please sign in again.'); return; }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not verify payments.');
    if (result.updated) await load();
    $('#payment-sheet-state').textContent = `${result.updated} updated · ${result.ambiguous} ambiguous · ${result.unmatched} unmatched · ${result.unpaidRows} not paid`;
    toast(result.failed
      ? `${result.updated} entries updated; ${result.failed} could not be saved. Refresh and retry.`
      : `${result.updated} dashboard entr${result.updated === 1 ? 'y' : 'ies'} updated from the sheet. ${result.ambiguous} ambiguous, ${result.unmatched} unmatched, ${result.unpaidRows} not marked Paid.`);
    if (selectedId) renderDetails();
  } catch (error) {
    $('#payment-sheet-state').textContent = error.message;
    toast(error.message);
  } finally {
    verifyingPayments = false;
    $('#verify-payments').disabled = !paymentSheetConfigured;
  }
}

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

function trackingDetails(order) {
  const isReturn = order.service === 'returns' || (order.service === 'bigdrop' && order.base_service === 'returns');
  if (isReturn) return '';
  const labels = { pending: 'Awaiting connection', unknown: 'Awaiting carrier scan', pre_transit: 'Label created', in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered', available_for_pickup: 'Available at carrier location', return_to_sender: 'Returning to sender', failure: 'Delivery exception', cancelled: 'Cancelled', error: 'Carrier error' };
  const trackers = order.order_trackers || [];
  return `<section class="detail-section"><h3>Carrier tracking</h3><p class="detail-note">Delivered shipments count toward pickup readiness. Add every shipment; set the number of order items covered by each tracking number.</p><div class="shipment-list">${trackers.map(row => `<article class="shipment"><div><strong>${esc(row.carrier || 'Carrier needed')} · ${esc(row.tracking_code)}</strong><p>${esc(labels[row.status] || row.status)} · Covers ${esc(row.items_count)} ${row.items_count === 1 ? 'item' : 'items'}</p>${row.estimated_delivery_at ? `<p>Estimated delivery: ${esc(date(row.estimated_delivery_at, true))}</p>` : ''}<small>Last checked: ${esc(date(row.checked_at, true))}</small>${row.sync_error ? `<p class="tracking-error">${esc(row.sync_error)}</p>` : ''}</div><button type="button" class="text-button" data-remove-tracking="${esc(row.id)}" aria-label="Remove tracking ${esc(row.tracking_code)}">Remove</button></article>`).join('') || '<p class="muted">No carrier tracking numbers added yet.</p>'}</div>${!['completed','cancelled'].includes(order.order_status) ? `<form id="tracking-form"><label>Carrier tracking number<input name="tracking_code" required maxlength="64" placeholder="One tracking number per shipment"></label><div class="edit-grid"><label>Carrier<input name="carrier" required maxlength="60" value="${esc(order.carrier || '')}" placeholder="UPS, USPS, FedEx, DHL Express"></label><label>Items covered<input type="number" name="items_count" min="1" max="${esc(order.quantity)}" value="1" required></label></div><button class="button" type="submit">Add tracking number</button></form>` : ''}</section>`;
}
async function changeTracking(method, body) {
  if (saving || !selectedId) return;
  saving = true;
  $('#order-details').querySelectorAll('button, select, textarea, input').forEach(element => { element.disabled = true; });
  try {
    const response = await fetch('/api/dashboard/tracking', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.status === 401) { showLogin('Your session expired. Please sign in again.'); return; }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save tracking.');
    await load(); toast(method === 'DELETE' ? 'Tracking removed.' : 'Tracking saved.');
    if (selectedId) renderDetails();
  } catch (error) { toast(error.message); }
  finally { saving = false; $('#order-details').querySelectorAll('button, select, textarea, input').forEach(element => { element.disabled = false; }); }
}
async function syncCarriers(reload) {
  if (syncingCarriers || !trackingConfigured || $('#dashboard').hidden) return;
  syncingCarriers = true; $('#sync-carriers').disabled = true;
  $('#tracking-message').textContent = 'Syncing carrier tracking…';
  try {
    const response = await fetch('/api/dashboard/tracking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }) });
    if (response.status === 401) { showLogin('Your session expired. Please sign in again.'); return; }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Carrier sync failed.');
    $('#tracking-message').textContent = result.configured ? `${result.updated} of ${result.attempted} due shipments updated. Carrier scans also arrive automatically.` : 'Carrier connection needed.';
    if (reload && !saving && !selectedId) await load();
  } catch (error) { $('#tracking-message').textContent = error.message; }
  finally { syncingCarriers = false; $('#sync-carriers').disabled = !trackingConfigured; }
}
