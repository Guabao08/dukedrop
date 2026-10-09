import { pickupReadiness, pickupLocation, READINESS_LABELS } from './readiness.js';
import { ORDER_LABELS, PAYMENT_LABELS, FOLLOWUP_LABELS, SERVICE_LABELS, needsFollowup, filterOrders, summarizeOrders, creatorMetrics, revenueMetrics, arrivalMetrics, arrivalSchedule, findRepeatOrders } from './order-model.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const date = (value, full = false) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString('en-US', full ? { dateStyle: 'medium', timeStyle: 'short' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not provided';
const queues = { overview: ['Overview', 'Revenue and work needing attention.'], tracking: ['Tracking', 'Incoming packages and collection readiness.'], all: ['Orders', 'All orders, newest first.'], creators: ['Creators', 'Promo usage and confirmed revenue.'], payments: ['Payments', 'Matched payments and records needing review.'], repeats: ['Orders', 'Likely repeat submissions.'], active: ['Orders', 'Active deliveries.'], unpaid: ['Orders', 'Unpaid active orders.'], followup: ['Orders', 'Tracking follow-ups due.'], completed: ['Orders', 'Completed deliveries.'] };
let trackingConfigured = false, syncingCarriers = false, paymentSheetConfigured = false, verifyingPayments = false;
let sheetPayments = [];
let allOrders = [], queue = queues[location.hash.slice(1)] ? location.hash.slice(1) : 'overview', selectedId = null, loading = false, saving = false, deleteConfirming = false, toastTimer, lastSync = null, detailOpener = null;
$('#today').textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' });
function notice(message = '') { $('#message').textContent = message; $('#message').hidden = !message; }
function navigate(view) { if (!queues[view]) return; queue = view; history.pushState(null, '', `#${view}`); render(); }
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
async function responseError(response, fallback) {
  const body = await response.text();
  let payload;
  try { payload = body ? JSON.parse(body) : null; } catch {}
  const detail = payload?.error || body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
  return detail ? `${fallback} (${response.status}): ${detail}` : `${fallback} (${response.status}).`;
}
function showLogin(message = '') {
  sheetPayments = []; $('#sheet-payment-rows').replaceChildren(); $('#sheet-payment-summary').textContent = 'Sign in to sync payments.';
  allOrders = []; selectedId = null; lastSync = null; paymentSheetConfigured = false; deleteConfirming = false;
  $('#order-dialog').close(); $('#order-details').replaceChildren(); $('#orders').replaceChildren(); $('#stats').replaceChildren(); $('#pickup-orders').replaceChildren(); $('#pickup-summary').replaceChildren(); $('#arrival-schedule').replaceChildren(); trackingConfigured = false;
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
    if (!response.ok) throw new Error(await responseError(response, 'Could not refresh orders'));
    const orders = await response.json();
    if (!Array.isArray(orders)) throw new Error('Could not read the order list.');
    allOrders = orders;
    try { const configResponse = await fetch('/api/dashboard/tracking', { cache: 'no-store' }); if (configResponse.ok) { trackingConfigured = Boolean((await configResponse.json()).configured); } } catch { trackingConfigured = false; }
    paymentSheetConfigured = true;
    try {
      $('#payment-sheet-state').textContent = 'Syncing paid orders from sheet…';
      const paymentResponse = await fetch('/api/dashboard/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify' }) });
      if (paymentResponse.status === 401) { showLogin('Your session expired. Please sign in again.'); return; }
      if (!paymentResponse.ok) throw new Error(await responseError(paymentResponse, 'Payment sync failed'));
      const result = await paymentResponse.json();
      sheetPayments = result.sheetPayments || [];
      renderSheetPayments();
      if (result.updated) {
        const refreshed = await fetch('/api/dashboard/orders', { cache: 'no-store' });
        if (!refreshed.ok) throw new Error('Payments saved. Refresh to reload updated orders.');
        const updatedOrders = await refreshed.json();
        if (!Array.isArray(updatedOrders)) throw new Error('Payments saved. Could not read updated orders.');
        allOrders = updatedOrders;
      }
      $('#payment-sheet-state').textContent = `${sheetPayments.length} paid in sheet · ${result.updated} orders updated${result.failed ? ` · ${result.failed} saves failed` : ''}`;
    } catch (error) {
      $('#payment-sheet-state').textContent = error.message;
      $('#sheet-payment-summary').textContent = `Sheet sync failed. ${sheetPayments.length ? 'Showing the last successful sync.' : 'Paid records could not be loaded.'} ${error.message}`;
    }
    $('#verify-payments').disabled = !paymentSheetConfigured || verifyingPayments;
    $('#tracking-connection').textContent = trackingConfigured ? 'Carrier integration configured' : 'Carrier connection needed';
    $('#sync-carriers').disabled = !trackingConfigured || syncingCarriers;
    if (!trackingConfigured) $('#tracking-message').textContent = 'Live updates need an EasyPost connection. Tracking details can be saved now.';
    lastSync = new Date(); showDashboard(); notice(); render();
    if (selectedId && !saving) renderDetails();
  } catch (error) {
    if ($('#dashboard').hidden) $('#login-message').textContent = error.message;
    else { notice(error.message + ' The last loaded orders are still shown.'); $('#pickup-sync').textContent = 'Refresh needed'; }
  } finally { loading = false; $('#refresh').disabled = false; }
}
function badge(value, labels = ORDER_LABELS) {
  const color = ({ completed: 'green', paid: 'green', received: 'blue', in_progress: 'blue', payment_started: 'gold', unconfirmed: 'gold', cancelled: 'neutral', refunded: 'neutral' })[value] || 'neutral';
  return `<span class="badge ${color}">${esc(labels[value] || value || 'Unknown')}</span>`;
}
function render() {
  const summary = summarizeOrders(allOrders);
  const revenue = revenueMetrics(allOrders);
  const arrivals = arrivalMetrics(allOrders);
  const repeats = findRepeatOrders(allOrders);
  const repeatIds = new Set(repeats.map(row => row.repeatId));
  $('#overview-panel').hidden = queue !== 'overview';
  $('#pickup-panel').hidden = queue !== 'tracking';
  $('#creators-panel').hidden = queue !== 'creators';
  $('#payments-panel').hidden = queue !== 'payments';
  $('#order-panel').hidden = !['all', 'repeats', 'active', 'unpaid', 'followup', 'completed'].includes(queue);
  renderPickup();
  renderPromos();
  $('#stats').innerHTML = [ ['Revenue', money(revenue.revenue), `${revenue.paidOrders} paid`, 'payments'], ['Orders', allOrders.length, `${summary.completed} completed`, 'all'], ['Average paid', money(revenue.averageOrder), `${revenue.freeOrders} free`, 'payments'], ['Outstanding', money(revenue.outstanding), `${summary.unpaid} unpaid`, 'unpaid'], ['Active', summary.active, `${arrivals.inTransit} in transit`, 'tracking'], ['Arriving soon', arrivals.arrivingSoon, `${revenue.refundedOrders} refunded`, 'tracking'] ].map(([label, value, hint, view]) => `<button class="stat-card" data-go="${view}"><span class="stat-label">${label}</span><strong>${value}</strong><small>${hint}</small></button>`).join('');
  $('#attention-overview').innerHTML = [['Tracking needed', arrivals.missingTracking, 'tracking'], ['Carrier issues', arrivals.exceptions, 'tracking'], ['Follow-ups due', summary.followup, 'followup'], ['Likely repeats', repeats.length, 'repeats']].map(([label, value, view]) => `<button data-go="${view}"><strong>${value}</strong> ${label} <span aria-hidden="true">→</span></button>`).join('');
  $('#page-title').textContent = queues[queue][0]; $('#page-description').textContent = queues[queue][1];
  $('#queue-title').textContent = 'Orders'; $('#queue-description').textContent = lastSync ? `Updated ${lastSync.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Loading orders';
  $('#order-queue').value = ['all', 'repeats', 'active', 'unpaid', 'followup', 'completed'].includes(queue) ? queue : 'all';
  document.querySelectorAll('[data-queue]').forEach(button => { const active = button.dataset.queue === queue || button.dataset.queue === 'all' && ['repeats', 'active', 'unpaid', 'followup', 'completed'].includes(queue); button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  const rows = filterOrders(allOrders, { queue: queue === 'repeats' ? 'all' : queue, search: $('#search').value, service: $('#service-filter').value, status: $('#status-filter').value, payment: $('#payment-filter').value, promo: $('#promo-filter').value }).filter(order => queue !== 'repeats' || repeatIds.has(order.id));
  const sort = $('#sort-orders').value;
  const time = order => new Date(order.created_at || 0).getTime() || 0;
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  rows.sort((a, b) => sort === 'oldest' ? time(a) - time(b)
    : sort === 'customer' ? collator.compare(a.recipient_name || a.phone || '', b.recipient_name || b.phone || '')
      : sort === 'room' ? collator.compare(`${a.dorm || ''} ${a.room || ''}`, `${b.dorm || ''} ${b.room || ''}`)
        : sort === 'unpaid' ? Number(b.payment_status === 'unconfirmed' && Number(b.amount_due) > 0) - Number(a.payment_status === 'unconfirmed' && Number(a.amount_due) > 0) || Number(b.amount_due || 0) - Number(a.amount_due || 0) || time(b) - time(a)
          : time(b) - time(a));
  $('#orders').innerHTML = rows.map(order => `<tr><td data-label="Ordered"><strong>${esc(date(order.created_at))}</strong><small>#${esc(order.id.slice(0, 8))}</small></td><td data-label="Order name"><button class="order-link" data-open="${esc(order.id)}">${esc(order.package_name || order.recipient_name || 'Customer')}</button><small>${esc(order.recipient_name && order.package_name ? order.recipient_name + ' · ' : '')}${esc(order.dorm || 'Dorm unknown')} · ${esc(order.room || '—')}</small>${repeatIds.has(order.id) ? '<small class="badge gold">Likely repeat</small>' : ''}</td><td data-label="Service"><strong>${esc(SERVICE_LABELS[order.service] || order.service)}</strong><small>${esc(order.quantity)} ${Number(order.quantity) === 1 ? 'item' : 'items'}${order.service === 'bigdrop' ? ` · ${esc(SERVICE_LABELS[order.base_service] || '')}` : ''}</small></td><td data-label="Price"><strong>${money(order.amount_due)}</strong>${order.promo_code ? `<small>${esc(order.promo_code)}</small>` : ''}</td><td data-label="Status">${badge(order.payment_status, PAYMENT_LABELS)} <span class="status-separator">·</span> ${badge(order.order_status)}${needsFollowup(order) ? '<small class="due-label">Tracking due</small>' : ''}</td><td data-label="Details"><button class="open-order" data-open="${esc(order.id)}" aria-label="Open order ${esc(order.id.slice(0,8))}">Open <span aria-hidden="true">↗</span></button></td></tr>`).join('');
  $('#empty').hidden = rows.length > 0;
  $('#empty').innerHTML = `<span class="empty-symbol" aria-hidden="true">◇</span><h3>${allOrders.length ? 'Nothing in this view.' : 'Ready for the first drop.'}</h3><p>${allOrders.length ? 'Try another queue or clear your filters to see more orders.' : 'New orders will appear here when customers start checkout.'}</p>`;
  $('#result-count').textContent = `Showing ${rows.length} of ${allOrders.length} orders`;
  $('#reset-filters').hidden = !($('#search').value || $('#service-filter').value || $('#status-filter').value || $('#payment-filter').value || $('#promo-filter').value || sort !== 'newest');
}
function field(label, value, wide = false) { return `<dl${wide ? ' class="wide"' : ''}><dt>${esc(label)}</dt><dd>${esc(value || 'Not provided')}</dd></dl>`; }
function options(labels, selected) { return Object.entries(labels).map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join(''); }
function renderDetails() {
  const order = allOrders.find(item => item.id === selectedId);
  if (!order) { $('#order-dialog').close(); selectedId = null; return; }
  $('#detail-title').textContent = `Order #${order.id.slice(0, 8)}`;
  const phone = String(order.phone || '').replace(/[^+\d]/g, '');
  const request = order.retailer === 'amazon' ? 'your Amazon shipping/tracking link' : 'your tracking number';
  const sms = `sms:${phone}?body=${encodeURIComponent(`Hi${order.recipient_name ? ` ${order.recipient_name}` : ''}, DevilDrop here about order #${order.id.slice(0, 8).toUpperCase()}. Could you send us ${request} and your estimated delivery date (YYYY-MM-DD)?`)}`;
  $('#order-details').innerHTML = `<section class="detail-section"><div class="detail-grid">${field('Customer', order.recipient_name)}${field('Phone', order.phone)}${field('Dorm', order.dorm)}${field('Room', order.room)}${field('Placed', date(order.created_at, true))}${field('Service', `${SERVICE_LABELS[order.service] || order.service} · ${order.quantity} ${Number(order.quantity) === 1 ? 'item' : 'items'}`)}${order.service === 'bigdrop' ? field('Base service', SERVICE_LABELS[order.base_service]) : ''}</div>${phone ? `<div class="detail-actions"><a class="button" href="tel:${esc(phone)}">Call customer ↗</a><a class="button" href="${esc(sms)}">Open text message ↗</a></div>` : ''}</section><section class="detail-section"><h3>Fulfillment details</h3><div class="detail-grid">${field('Carrier', order.carrier)}${field('Tracking', order.tracking, true)}${field('Store', order.retailer === 'amazon' ? 'Amazon' : 'Other')}${field('Estimated delivery', order.estimated_delivery_date || 'Unknown')}${order.shipping_link ? `<dl class="wide"><dt>Shipping link</dt><dd><a href="${esc(order.shipping_link)}" target="_blank" rel="noopener noreferrer">Open link ↗</a></dd></dl>` : ''}${order.source ? field('Pickup source', order.source === 'locker' ? 'Locker' : 'Mailroom') : ''}${order.fulfillment_mode ? field('Fulfillment', order.fulfillment_mode === 'ship' ? 'Ship to DevilDrop' : 'Pickup') : ''}${order.mailroom ? field('Mailroom', order.mailroom) : ''}${order.box_number ? field('Box number', order.box_number) : ''}${order.locker_location ? field('Locker location', order.locker_location) : ''}${order.locker_code ? field('Locker code', order.locker_code) : ''}</div><form id="shipping-form"><div class="edit-grid"><label>Store<select name="retailer"><option value="other">Other</option><option value="amazon"${order.retailer === 'amazon' ? ' selected' : ''}>Amazon</option></select></label><label>Estimated delivery<input type="date" name="estimated_delivery_date" value="${esc(order.estimated_delivery_date || '')}"></label></div><label>Shipping link<input type="url" name="shipping_link" maxlength="2000" value="${esc(order.shipping_link || '')}" placeholder="https://…"></label><button class="button" type="submit">Save shipping details</button></form></section>${trackingDetails(order)}<section class="detail-section"><h3>Pickup readiness</h3><p>${esc(pickupReadiness(order).label)} · ${esc(pickupReadiness(order).source)}</p><p class="detail-note">${esc(pickupReadiness(order).reason)}</p><div class="detail-grid">${field('Collection location', pickupLocation(order))}${field('Last staff update', order.pickup_updated_at ? date(order.pickup_updated_at, true) : 'No staff update')}</div><form id="readiness-form"><label>Readiness for all ${esc(order.quantity)} ${Number(order.quantity) === 1 ? 'item' : 'items'}<select name="pickup_readiness">${options(READINESS_LABELS, order.pickup_readiness || 'auto')}</select></label><label>Collection note<textarea name="pickup_note" maxlength="1000" rows="3" placeholder="Confirmation source, collection instructions, or reason for a hold">${esc(order.pickup_note || '')}</textarea></label><p class="detail-note">Choose Ready to collect only after all items are available. Collected removes the order from the ready list; it does not complete the delivery.</p><button class="button primary" type="submit">Save readiness</button></form></section><section class="detail-section"><h3>Payment & progress</h3><div class="detail-grid">${field('Amount due', money(order.amount_due))}${field('Payment method', order.payment_method)}${order.promo_code ? field('Promotion', `${order.promo_code} · ${order.discount_percent}% off`) : ''}</div><form id="update-form"><div class="edit-grid" style="margin-top:20px"><label>Order status<select name="order_status">${options(ORDER_LABELS, order.order_status)}</select></label><label>Payment status<select name="payment_status">${options(PAYMENT_LABELS, order.payment_status)}</select></label></div><p class="detail-note">Confirm payment in the payment app before marking an order paid.</p><button class="button primary" type="submit">Save changes</button></form></section><section class="detail-section"><h3>Tracking follow-up</h3><div class="detail-grid">${field('Follow-up status', FOLLOWUP_LABELS[order.tracking_followup_status] || order.tracking_followup_status)}${field('Due', order.tracking_followup_due_at ? date(order.tracking_followup_due_at, true) : 'No follow-up scheduled')}${order.tracking_followup_sent_at ? field('Text sent', date(order.tracking_followup_sent_at, true)) : ''}</div>${order.tracking_followup_claimed_at && order.tracking_followup_status === 'pending' ? '<p class="detail-note">Send was attempted but not confirmed. Check Twilio before marking sent or skipping.</p>' : ''}${['pending','sent','received'].includes(order.tracking_followup_status) ? `<div class="detail-actions">${order.tracking_followup_status === 'pending' ? '<button class="button" data-followup="sent">Mark as sent</button>' : ''}<button class="button" data-followup="skipped">Skip follow-up</button></div>` : ''}<div class="sms-replies">${(order.order_sms_messages || []).sort((a,b) => b.received_at.localeCompare(a.received_at)).map(reply => `<p><small>${esc(date(reply.received_at, true))}</small><br>${esc(reply.body)}</p>`).join('') || '<p class="muted">No text replies yet.</p>'}</div></section>`;
  const reference = order.id.slice(0, 8).toUpperCase();
  const repeat = findRepeatOrders(allOrders).find(item => item.repeatId === order.id);
  if (repeat) {
    const original = allOrders.find(item => item.id === repeat.originalId);
    $('#order-details').insertAdjacentHTML('beforeend', `<section class="detail-section"><h3>Possible repeat submission</h3><p>This order matches the same phone, service, quantity, dorm, and room as order #${esc(repeat.originalId.slice(0, 8).toUpperCase())}, placed ${esc(date(original?.created_at, true))}. Review both entries before deleting either one.</p></section>`);
  }
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
    const body = await response.text();
    let result;
    try { result = body ? JSON.parse(body) : {}; }
    catch { result = { error: `Sign-in service returned an invalid response (${response.status}). ${body.trim().slice(0, 180) || 'Please try again.'}` }; }
    if (!response.ok) throw new Error(result.error || `Sign in failed (${response.status}).`);
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
$('#queue-nav').onclick = event => { const button = event.target.closest('[data-queue]'); if (button) navigate(button.dataset.queue); };
$('#overview-panel').onclick = event => { const button = event.target.closest('[data-go]'); if (button) navigate(button.dataset.go); };
$('#order-queue').onchange = event => navigate(event.target.value);
window.addEventListener('popstate', () => { queue = queues[location.hash.slice(1)] ? location.hash.slice(1) : 'overview'; render(); });
$('#search').oninput = render;
for (const id of ['service-filter', 'status-filter', 'payment-filter', 'promo-filter', 'sort-orders']) $(`#${id}`).onchange = render;
$('#reset-filters').onclick = () => { for (const id of ['search', 'service-filter', 'status-filter', 'payment-filter', 'promo-filter']) $(`#${id}`).value = ''; $('#sort-orders').value = 'newest'; render(); };
function openOrder(event) { const button = event.target.closest('[data-open]'); if (!button) return; detailOpener = button; selectedId = button.dataset.open; deleteConfirming = false; renderDetails(); $('#order-dialog').showModal(); }
$('#orders').onclick = openOrder; $('#pickup-orders').onclick = openOrder;
$('#arrival-list').onclick = openOrder;
$('#arrival-schedule').onclick = openOrder;
$('#close-details').onclick = () => $('#order-dialog').close();
$('#order-dialog').addEventListener('close', () => { selectedId = null; deleteConfirming = false; detailOpener?.isConnected && detailOpener.focus(); });
$('#order-details').addEventListener('submit', event => { if (event.target.id === 'tracking-form') { event.preventDefault(); const values = new FormData(event.target); changeTracking('POST', { order_id: selectedId, tracking_code: values.get('tracking_code'), carrier: values.get('carrier'), items_count: Number(values.get('items_count')) }); return; } if (event.target.id === 'shipping-form') { event.preventDefault(); const values = new FormData(event.target); updateOrder({ retailer: values.get('retailer'), estimated_delivery_date: values.get('estimated_delivery_date') || null, shipping_link: values.get('shipping_link') || null }); return; } if (event.target.id === 'readiness-form') { event.preventDefault(); const values = new FormData(event.target); updateOrder({ pickup_readiness: values.get('pickup_readiness'), pickup_note: values.get('pickup_note').trim() }); return; } if (event.target.id !== 'update-form') return; event.preventDefault(); const values = new FormData(event.target); updateOrder({ order_status: values.get('order_status'), payment_status: values.get('payment_status') }); });
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
  if (verifyingPayments || loading || !paymentSheetConfigured) return;
  verifyingPayments = true;
  $('#verify-payments').disabled = true;
  try {
    await load();
  } finally {
    verifyingPayments = false;
    $('#verify-payments').disabled = !paymentSheetConfigured;
  }
}

function renderSheetPayments() {
  const linked = sheetPayments.filter(payment => payment.matchStatus === 'matched').length;
  $('#sheet-payment-summary').textContent = `${sheetPayments.length} paid payments · ${linked} linked to dashboard orders · ${sheetPayments.length - linked} need order review. Synced ${new Date().toLocaleTimeString()}.`;
  const labels = { matched: 'Order linked', ambiguous: 'Multiple possible orders', unmatched: 'No matching order', refunded: 'Order refunded', save_failed: 'Order update failed' };
  $('#sheet-payment-rows').innerHTML = sheetPayments.map(payment => `<tr><td data-label="Customer"><strong>${esc(payment.customer)}</strong><small>${esc(payment.packageName || '')}</small></td><td data-label="Payment"><strong>${payment.amount === null ? 'Amount missing' : money(payment.amount)}</strong><small>${esc(payment.method)} · <span class="badge green">Paid in sheet</span></small></td><td data-label="Order details"><strong>${esc(payment.service)} · ${esc(payment.quantity)} items</strong><small>${esc(payment.dorm)} · Room ${esc(payment.room || '—')}</small><small>${esc(payment.tracking || '')}</small></td><td data-label="Payment time">${esc(payment.paymentTime || 'Not provided')}</td><td data-label="Dashboard link"><span class="badge ${payment.matchStatus === 'matched' ? 'green' : 'gold'}">${esc(labels[payment.matchStatus] || 'Needs review')}</span>${payment.orderId ? `<small>#${esc(payment.orderId.slice(0, 8))}</small>` : ''}</td></tr>`).join('');
}

function renderPickup() {
  $('#pickup-sync').textContent = lastSync ? `Orders updated ${lastSync.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Loading orders';
  const states = allOrders.map(order => pickupReadiness(order).state);
  $('#pickup-summary').innerHTML = [['ready','Ready'],['waiting','Waiting'],['hold','On hold'],['collected','Collected']].map(([key,label]) => `<span><strong>${states.filter(state => state === key).length}</strong> ${label}</span>`).join('');
  const arrivals = allOrders.filter(order => !['completed', 'cancelled'].includes(order.order_status)).flatMap(order => (order.order_trackers || []).filter(tracker => !['delivered', 'cancelled', 'return_to_sender'].includes(tracker.status)).map(tracker => ({ order, tracker })));
  arrivals.sort((a, b) => (Date.parse(a.tracker.estimated_delivery_at) || Infinity) - (Date.parse(b.tracker.estimated_delivery_at) || Infinity));
  $('#arrival-list').innerHTML = arrivals.length ? arrivals.map(({ order, tracker }) => `<div class="arrival-row"><div><button class="order-link" data-open="${esc(order.id)}">${esc(order.package_name || order.recipient_name || order.phone || 'Order')}</button><small>${esc(tracker.carrier || 'Carrier')} · ${esc(tracker.tracking_code)}</small></div><span>${esc(({ pending: 'Awaiting connection', unknown: 'Awaiting scan', pre_transit: 'Label created', in_transit: 'In transit', out_for_delivery: 'Out for delivery', available_for_pickup: 'At carrier location', failure: 'Exception', error: 'Carrier error' })[tracker.status] || tracker.status || 'Awaiting update')}</span><strong>${esc(tracker.estimated_delivery_at ? date(tracker.estimated_delivery_at, true) : 'No ETA')}</strong></div>`).join('') : '<p class="section-note">No incoming shipments with carrier tracking yet.</p>';
  const schedule = arrivalSchedule(allOrders);
  const groups = new Map();
  for (const row of schedule) {
    if (!groups.has(row.day)) groups.set(row.day, []);
    groups.get(row.day).push(row);
  }
  $('#arrival-schedule').innerHTML = groups.size ? [...groups].map(([day, entries]) => `<section class="schedule-day"><h4>${esc(new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' }))}<span>${entries.length} ${entries.length === 1 ? 'package' : 'packages'}</span></h4>${entries.map(({ order, source, tracker }) => `<div class="schedule-entry"><button class="order-link" data-open="${esc(order.id)}">${esc(order.package_name || order.recipient_name || order.phone || 'Order')}</button><small>${esc(source)}${tracker ? ` · ${esc(tracker.carrier || tracker.tracking_code)}` : ''}</small></div>`).join('')}</section>`).join('') : '<p class="section-note">No estimated arrivals in the next 14 days. Add a customer ETA or carrier tracking to place a package on the schedule.</p>';
  const rows = filterOrders(allOrders, { search: $('#pickup-search').value, service: $('#pickup-service').value }).filter(order => !$('#pickup-filter').value || ($('#pickup-filter').value === 'open' ? !['closed', 'collected'].includes(pickupReadiness(order).state) : pickupReadiness(order).state === $('#pickup-filter').value));
  const priority = { ready: 0, hold: 1, waiting: 2, collected: 3, closed: 4 };
  rows.sort((a,b) => priority[pickupReadiness(a).state] - priority[pickupReadiness(b).state]);
  $('#pickup-empty').hidden = rows.length > 0;
  $('#pickup-orders').innerHTML = rows.map(order => {
    const readiness = pickupReadiness(order);
    return `<article class="pickup-card"><div><button class="order-link" data-open="${esc(order.id)}">${esc(order.recipient_name || order.package_name || order.phone || 'Order')}</button><small>${esc(SERVICE_LABELS[order.service] || order.service)} · ${esc(order.quantity)} ${Number(order.quantity) === 1 ? 'item' : 'items'}</small></div><div><strong>${esc(pickupLocation(order))}</strong><small>${esc(order.dorm || '')} · ${esc(order.room || '—')}</small></div><span class="badge ${readiness.state === 'ready' ? 'green' : readiness.state === 'waiting' || readiness.state === 'hold' ? 'gold' : 'neutral'}">${esc(readiness.label)}</span><button class="text-button" data-open="${esc(order.id)}" aria-label="Open order ${esc(order.id.slice(0,8))}">Open →</button></article>`;
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

function renderPromos() {
  const usage = creatorMetrics(allOrders);
  const selected = $('#promo-filter').value;
  $('#promo-filter').innerHTML = '<option value="">All codes / no promo</option>' + usage.map(row => `<option value="${esc(row.code)}">${esc(row.code)}</option>`).join('');
  if (usage.some(row => row.code === selected)) $('#promo-filter').value = selected;
  const total = usage.reduce((sum, row) => sum + row.total, 0);
  $('#promo-summary').textContent = `${total} orders with a code · ${usage.length} codes used · ${money(usage.reduce((sum, row) => sum + row.revenue, 0))} confirmed revenue.`;
  $('#promo-rows').innerHTML = usage.length ? usage.map(row => `<tr><td data-label="Code"><strong>${esc(row.code)}</strong><small>${row.customers} customers</small></td><td data-label="Uses"><strong>${row.total}</strong><small>${row.free} free · ${row.cancelled + row.refunded} closed</small></td><td data-label="Paid">${row.paidOrders}</td><td data-label="Revenue"><strong>${money(row.revenue)}</strong><small>${row.awaiting} awaiting payment</small></td><td data-label="Orders"><button class="text-button" data-promo="${esc(row.code)}" aria-label="View orders using ${esc(row.code)}">View →</button></td></tr>`).join('') : '<tr><td colspan="5">No promo codes recorded yet.</td></tr>';
}
$('#promo-rows').onclick = event => {
  const button = event.target.closest('[data-promo]');
  if (!button) return;
  for (const id of ['search', 'service-filter', 'status-filter', 'payment-filter']) $(`#${id}`).value = '';
  $('#promo-filter').value = button.dataset.promo;
  $('.more-filters').open = true;
  navigate('all');
  $('#order-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
