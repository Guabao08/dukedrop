const login = document.querySelector('#login');
const dashboard = document.querySelector('#dashboard');
const loginMessage = document.querySelector('#login-message');
let allOrders = [];

function msg(value) { document.querySelector('#message').textContent = value; }
function showLogin(message = '') {
  login.classList.remove('hidden');
  dashboard.classList.add('hidden');
  loginMessage.textContent = message;
}
function showDashboard() {
  login.classList.add('hidden');
  dashboard.classList.remove('hidden');
}

async function load() {
  const response = await fetch('/api/dashboard/orders', { cache: 'no-store' });
  if (response.status === 401) { showLogin(); return; }
  if (response.status === 503) { showLogin('Dashboard access is not configured yet.'); return; }
  if (!response.ok) { showDashboard(); msg('Could not load orders. Please refresh and try again.'); return; }
  allOrders = await response.json();
  showDashboard();
  render();
}

function render() {
  const query = document.querySelector('#search').value.toLowerCase();
  const status = document.querySelector('#status-filter').value;
  const rows = allOrders.filter(order => (!status || order.order_status === status) && JSON.stringify(order).toLowerCase().includes(query));
  const pending = allOrders.filter(order => order.tracking_followup_status === 'pending' && new Date(order.tracking_followup_due_at) <= new Date()).length;
  document.querySelector('#stats').innerHTML = `<div class="stat"><strong>${allOrders.length}</strong>Total orders</div><div class="stat"><strong>${allOrders.filter(order => order.payment_status === 'paid').length}</strong>Paid</div><div class="stat"><strong>${pending}</strong>Tracking follow-ups</div>`;
  document.querySelector('#orders').innerHTML = rows.map(order => `<tr><td>${new Date(order.created_at).toLocaleString()}</td><td>${esc(order.recipient_name || '')}<br>${esc(order.phone)}<br>${esc(order.dorm)} ${esc(order.room)}</td><td>${esc(order.service)} · ${order.quantity}${order.promo_code ? `<br>${esc(order.promo_code)}` : ''}<br><small>${esc(order.carrier || 'Awaiting tracking')} ${esc(order.tracking || '')}</small></td><td>$${Number(order.amount_due).toFixed(2)}</td><td><select data-id="${order.id}" data-field="payment_status">${['unconfirmed', 'paid', 'refunded'].map(value => `<option ${order.payment_status === value ? 'selected' : ''}>${value}</option>`)}</select></td><td><select data-id="${order.id}" data-field="order_status">${['payment_started', 'received', 'in_progress', 'completed', 'cancelled'].map(value => `<option ${order.order_status === value ? 'selected' : ''}>${value}</option>`)}</select></td><td>${order.tracking_followup_status === 'pending' && new Date(order.tracking_followup_due_at) <= new Date() ? `<a data-followup="${order.id}" href="sms:${encodeURIComponent(order.phone)}?body=${encodeURIComponent(`Hi${order.recipient_name ? ` ${order.recipient_name}` : ''}, this is DukeDrop following up on your ${order.service} order. Could you send us the tracking number when available? We are following up 24 hours after your order.`)}">Text follow-up</a>` : esc(order.tracking_followup_status === 'pending' ? `Due ${new Date(order.tracking_followup_due_at).toLocaleDateString()}` : order.tracking_followup_status || 'Not needed')}</td></tr>`).join('');
  msg(rows.length ? `${rows.length} orders shown.` : 'No matching orders.');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function updateOrder(id, updates) {
  const response = await fetch('/api/dashboard/orders', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, updates }),
  });
  if (response.status === 401) { await load(); return false; }
  return response.ok;
}

document.querySelector('#sign-in-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.querySelector('#sign-in');
  button.disabled = true;
  loginMessage.textContent = '';
  try {
    const response = await fetch('/api/dashboard/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.querySelector('#password').value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Sign in failed.');
    document.querySelector('#password').value = '';
    await load();
  } catch (error) {
    loginMessage.textContent = error.message || 'Sign in failed.';
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#sign-out').onclick = async () => {
  await fetch('/api/dashboard/logout', { method: 'POST' });
  allOrders = [];
  showLogin('You have signed out.');
};
document.querySelector('#refresh').onclick = () => load();
document.querySelector('#search').oninput = render;
document.querySelector('#status-filter').onchange = render;
document.querySelector('#orders').onchange = async event => {
  const element = event.target;
  if (!element.dataset.id) return;
  const order = allOrders.find(item => item.id === element.dataset.id);
  if (!order || !await updateOrder(order.id, { [element.dataset.field]: element.value })) { msg('Status update failed. Please refresh and try again.'); return; }
  order[element.dataset.field] = element.value;
  render();
};
document.querySelector('#orders').onclick = async event => {
  const link = event.target.closest('[data-followup]');
  if (!link) return;
  event.preventDefault();
  const order = allOrders.find(item => item.id === link.dataset.followup);
  if (!order) return;
  if (!await updateOrder(order.id, { tracking_followup_status: 'sent', tracking_followup_sent_at: new Date().toISOString() })) { msg('Could not mark follow-up as sent.'); return; }
  order.tracking_followup_status = 'sent';
  window.location.href = link.href;
  render();
};

load().catch(() => showLogin('Could not connect to the dashboard. Please refresh and try again.'));
