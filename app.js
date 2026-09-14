// Domain rules ported from the Claude Design project "App redesign requirements"
// (DukeDrop.dc.html Component + DukeDrop-print.dc.html rate sheet). Pure and
// framework-free so it can run both in the browser and under node:test.

export const VENMO_USERNAME = 'Timothymei71';
export const ZELLE_DISPLAY = '(469) 964-9545';
export const ZELLE_DIGITS = ZELLE_DISPLAY.replace(/\D/g, '');
export const CONSENT_PHONE = '2019160008';
export const EXPRESS_ADDRESS = '1610 Valley Creek Dr., Hillsborough, NC 27278';
export const CONSENT_AUTHORIZERS = 'Sean Pao, Dylan Kim, or Timothy Mei';
export const INSTAGRAM_HANDLE = 'dukedrop_';

export const SERVICE_DETAILS = {
  express: {
    eyebrow: 'Express',
    title: 'Express',
    rateHeader: 'Parcels per order',
    intro: "Ship to our DukeDrop address to skip the mailroom's 48-hour hold — we bring it straight to your door.",
    memoPrefix: 'EXPRESS',
    callout: '',
    tiers: [
      { label: '1–2 parcels · small', min: 1, max: 2, rate: 5.99 },
      { label: '3–4 parcels · medium', min: 3, max: 4, rate: 4.99 },
      { label: '5+ parcels · large', min: 5, max: Infinity, rate: 3.99 },
    ],
  },
  pickup: {
    eyebrow: 'Pickup',
    title: 'Pickup',
    rateHeader: 'Parcels per trip',
    intro: 'We grab it from your mailroom box or locker — third-party pickup, delivered straight to your dorm.',
    memoPrefix: 'PICKUP',
    callout: 'Mailroom pickups need your OK on file — text us the consent line before paying. Locker codes already work as consent, so lockers skip straight to paying.',
    tiers: [
      { label: '1–2 parcels · small', min: 1, max: 2, rate: 3.99 },
      { label: '3–4 parcels · medium', min: 3, max: 4, rate: 2.99 },
      { label: '5+ parcels · large', min: 5, max: Infinity, rate: 1.99 },
    ],
  },
  returns: {
    eyebrow: 'Returns',
    title: 'Returns',
    rateHeader: 'Parcels per trip',
    intro: 'Leave it at your door — we repack it, get it ready to ship, and drop it at the package center for you.',
    memoPrefix: 'RETURN',
    callout: "Your payment note carries your dorm + room — that's your authorization, nothing else to send.",
    tiers: [
      { label: '1–2 parcels · small', min: 1, max: 2, rate: 4.99 },
      { label: '3–4 parcels · medium', min: 3, max: 4, rate: 3.99 },
      { label: '5+ parcels · large', min: 5, max: Infinity, rate: 2.99 },
    ],
  },
};

export function money(n) { return '$' + n.toFixed(2); }

// Tracking/order numbers are entered one per line. Keep identifier characters
// intact while making whitespace and accidental duplicate entries harmless.
export function normalizeTrackingNumbers(value) {
  const seen = new Set();
  return String(value ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !seen.has(line) && seen.add(line));
}

export function tierFor(service, qty) {
  const tiers = SERVICE_DETAILS[service].tiers;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (qty >= t.min && qty <= t.max) return { tier: t, index: i };
  }
  return { tier: tiers[tiers.length - 1], index: tiers.length - 1 };
}

export function calculateAmount(service, quantity) {
  if (!SERVICE_DETAILS[service] || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    throw new Error('Invalid order');
  }
  return +(tierFor(service, quantity).tier.rate * quantity).toFixed(2);
}

export function buildMemo({ service, quantity, dorm, room, carrier, tracking, source, mailroom, box, lockerLocation, locker, name }) {
  const prefix = SERVICE_DETAILS[service].memoPrefix;
  let memo = `${prefix} ${quantity}x — ${dorm || '[Dorm]'} ${room || '[Room]'}`;
  if (service !== 'returns') {
    const lines = normalizeTrackingNumbers(tracking);
    if (carrier || lines.length) memo += ` — ${carrier || '[Carrier]'} tracking: ${lines.join(', ') || '[Tracking #]'}`;
  }
  if (service === 'pickup') {
    memo += source === 'locker'
      ? ` — ${lockerLocation || '[Locker location]'} locker: ${locker || '[Locker code]'}`
      : ` — ${mailroom || '[Mailroom]'} mailroom, Box #${box || '[Box #]'}, Name: ${name || '[Full name]'}`;
  }
  return memo;
}

export function buildConsent(name, mailroom) {
  return `PICKUP CONSENT — I, ${name || '[Full name]'}, authorize ${CONSENT_AUTHORIZERS} to retrieve my package from the ${mailroom || '[Mailroom]'} mailroom.`;
}

export function validateOrder(o) {
  const missing = [];
  if (!SERVICE_DETAILS[o.service]) missing.push('service');
  if (!Number.isInteger(o.quantity) || o.quantity < 1 || o.quantity > 50) missing.push('quantity');
  if (!String(o.dorm ?? '').trim()) missing.push('dorm');
  if (!String(o.room ?? '').trim()) missing.push('room #');
  if (o.service !== 'returns') {
    if (!String(o.carrier ?? '').trim()) missing.push('carrier');
    if (normalizeTrackingNumbers(o.tracking).length === 0) missing.push('tracking/order # (at least one)');
  }
  if (o.service === 'pickup') {
    if (o.source === 'locker') {
      if (!String(o.lockerLocation ?? '').trim()) missing.push('which locker (building)');
      if (!/^\d{6}$/.test(String(o.locker ?? '').trim())) missing.push('6-digit locker code');
    } else {
      if (!String(o.mailroom ?? '').trim()) missing.push('which mailroom (building)');
      if (!String(o.box ?? '').trim()) missing.push('Duke box #');
      if (!String(o.name ?? '').trim()) missing.push('your name');
    }
  }
  return { valid: missing.length === 0, missing };
}

export function venmoLink(o) {
  const v = validateOrder(o);
  if (!v.valid) throw new Error(`Missing: ${v.missing.join(', ')}`);
  const amount = calculateAmount(o.service, o.quantity).toFixed(2);
  const note = buildMemo(o);
  const params = [['txn', 'pay'], ['recipients', VENMO_USERNAME], ['amount', amount], ['note', note]]
    .map(([k, x]) => `${k}=${encodeURIComponent(x)}`).join('&');
  return {
    amount,
    note,
    deepLink: `venmo://paycharge?${params}`,
    profileUrl: `https://venmo.com/u/${VENMO_USERNAME}`,
  };
}

export function zelleLine(o) {
  return `${money(calculateAmount(o.service, o.quantity))} to ${ZELLE_DISPLAY} — ${buildMemo(o)}`;
}

if (typeof document !== 'undefined') {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const makeServiceState = (service) => ({
    qty: 1, dorm: '', room: '', carrier: '', tracking: '', payMethod: 'venmo',
    ...(service === 'pickup' ? { source: 'mailbox', mailroom: '', box: '', lockerLocation: '', locker: '', name: '', consentFallback: false } : {}),
  });

  const state = {
    active: 'express',
    express: makeServiceState('express'),
    pickup: makeServiceState('pickup'),
    returns: makeServiceState('returns'),
    venmoFallback: { express: false, pickup: false, returns: false },
    zelleFallback: { express: false, pickup: false, returns: false },
  };

  const app = document.getElementById('app');

  function order(key) {
    const s = state[key];
    return { service: key, quantity: s.qty, dorm: s.dorm, room: s.room, carrier: s.carrier, tracking: s.tracking, source: s.source, mailroom: s.mailroom, box: s.box, lockerLocation: s.lockerLocation, locker: s.locker, name: s.name };
  }

  function buildVM(key) {
    const s = state[key];
    const detail = SERVICE_DETAILS[key];
    const o = order(key);
    const { tier, index: tierIndex } = tierFor(key, s.qty);
    const total = tier.rate * s.qty;
    const v = validateOrder(o);
    const isLocker = key === 'pickup' && s.source === 'locker';
    const showConsent = key === 'pickup' && !isLocker;
    const consentText = showConsent ? buildConsent(s.name, s.mailroom) : '';
    return {
      key, detail, tierIndex, total, subText: `${s.qty} × ${money(tier.rate)}`,
      memo: buildMemo(o), ready: v.valid, missing: v.missing,
      isLocker, showConsent, consentText,
      zelleLine: zelleLine(o),
    };
  }

  function tabsHtml() {
    return ['express', 'pickup', 'returns'].map((k) =>
      `<button type="button" class="tab${state.active === k ? ' active' : ''}" data-action="tab" data-service="${k}">${SERVICE_DETAILS[k].title}</button>`
    ).join('');
  }

  function bannerHtml(key) {
    if (key !== 'express') return '';
    return `
      <div class="banner-dark">
        <div class="banner-eyebrow">Before anything else</div>
        <div>Ship your package to <strong>${esc(EXPRESS_ADDRESS)}</strong> — then fill out the form below. Use your own name as the recipient (not "DukeDrop") so we can match it to your order.</div>
      </div>
      <div class="copy-row">
        <div class="copy-row-text">${esc(EXPRESS_ADDRESS)}</div>
        <button type="button" class="copy-btn" data-action="copy" data-value="${esc(EXPRESS_ADDRESS)}">Copy</button>
      </div>`;
  }

  function calloutHtml(detail) {
    if (!detail.callout) return '';
    return `<div class="callout"><span class="callout-label">Consent</span>${esc(detail.callout)}</div>`;
  }

  function ratesHtml(key) {
    const detail = SERVICE_DETAILS[key];
    const { index: activeIndex } = tierFor(key, state[key].qty);
    return `
      <div class="rates" data-role="rates">
        <div class="rate-header"><span>${esc(detail.rateHeader)}</span><span>Rate</span></div>
        ${detail.tiers.map((t, i) => `<div class="rate-row${i === activeIndex ? ' is-active' : ''}" data-tier-index="${i}"><span>${esc(t.label)}</span><strong>${money(t.rate)}/parcel</strong></div>`).join('')}
      </div>`;
  }

  function sourceToggleHtml(key) {
    if (key !== 'pickup') return '';
    const s = state[key];
    const isLocker = s.source === 'locker';
    return `
      <div class="toggle-row">
        <button type="button" class="tab${!isLocker ? ' active' : ''}" data-action="source" data-source="mailbox">Mailroom box</button>
        <button type="button" class="tab${isLocker ? ' active' : ''}" data-action="source" data-source="locker">Locker</button>
      </div>
      ${isLocker ? `
      <div class="field-grid">
        <label>Which locker (building)<input type="text" placeholder="e.g. Bell Tower" value="${esc(s.lockerLocation)}" data-field="lockerLocation"></label>
        <label>Locker code (6 digits)<input type="text" inputmode="numeric" maxlength="6" placeholder="e.g. 447128" value="${esc(s.locker)}" data-field="locker"></label>
      </div>` : `
      <div class="field-grid">
        <label>Which mailroom (building)<input type="text" placeholder="e.g. Few Quad" value="${esc(s.mailroom)}" data-field="mailroom"></label>
        <label>Duke box #<input type="text" placeholder="e.g. 90123" value="${esc(s.box)}" data-field="box"></label>
      </div>`}`;
  }

  function consentHtml(key, vm) {
    if (!vm.showConsent) return '';
    const s = state[key];
    return `
      <div class="step-label">Step 1 · Send pickup consent</div>
      <p class="hint">Type your name below — it fills into the consent line, ready to text us so we have your OK on file before we grab your package.</p>
      <label>Your full name (as it appears on the package)<input type="text" placeholder="e.g. Jane Doe" value="${esc(s.name)}" data-field="name"></label>
      <div class="copy-row">
        <div class="copy-row-text" data-role="consent-text">${esc(vm.consentText)}</div>
        <button type="button" class="copy-btn" data-action="copy" data-value-role="consent-text">Copy</button>
      </div>
      <button type="button" class="btn-primary" data-action="send-consent">Text consent to ${esc(CONSENT_PHONE)}</button>
      ${s.consentFallback ? `<div class="fallback">Messages didn't open? Copy the line above and text it to <strong>${esc(CONSENT_PHONE)}</strong>.</div>` : ''}
      <div class="ig-line">or <a href="https://instagram.com/${INSTAGRAM_HANDLE}" target="_blank" rel="noopener">DM @${INSTAGRAM_HANDLE} on Instagram</a> instead — paste the copied line into the chat</div>
      <div class="step-label">Step 2 · Pay</div>`;
  }

  function paymentPanelHtml(key, vm) {
    const s = state[key];
    const method = s.payMethod;
    if (method === 'venmo') {
      const label = vm.ready ? `Pay ${money(vm.total)} with Venmo` : 'Enter details to pay';
      return `
        <button type="button" class="btn-pay" data-action="pay-venmo" ${vm.ready ? '' : 'disabled'}>${label}</button>
        ${state.venmoFallback[key] ? `<div class="fallback">Venmo app didn't open? Send <strong>${money(vm.total)}</strong> to <a href="https://venmo.com/u/${VENMO_USERNAME}" target="_blank" rel="noopener">@${VENMO_USERNAME}</a> with the memo above.</div>` : ''}`;
    }
    if (method === 'zelle') {
      const label = vm.ready ? `Pay ${money(vm.total)} with Zelle` : 'Enter details to pay with Zelle';
      return `
        <button type="button" class="btn-pay" data-action="pay-zelle" ${vm.ready ? '' : 'disabled'}>${label}</button>
        ${state.zelleFallback[key] ? `<div class="fallback">Note copied. Open your bank's app and send to <strong>${esc(ZELLE_DISPLAY)}</strong> — paste the note below if your bank allows one:<div class="fallback-mono" data-role="zelle-line">${esc(vm.zelleLine)}</div></div>` : ''}`;
    }
    return `<div class="card-note">Card payments are launching soon — please use Venmo or Zelle for now.</div>`;
  }

  function cardHtml(key) {
    const detail = SERVICE_DETAILS[key];
    const s = state[key];
    const vm = buildVM(key);
    return `
      <div class="card">
        ${bannerHtml(key)}
        <div class="eyebrow">${esc(detail.eyebrow)}</div>
        <h2>${esc(detail.title)}</h2>
        <p class="desc">${esc(detail.intro)}</p>
        ${calloutHtml(detail)}
        ${ratesHtml(key)}
        <div class="field">
          <label>Parcels</label>
          <div class="stepper">
            <button type="button" data-action="qty-dec">−</button>
            <input type="text" inputmode="numeric" value="${s.qty}" data-field="qty" data-role="qty-input">
            <button type="button" data-action="qty-inc">+</button>
          </div>
        </div>
        <div class="field-grid">
          <label>Dorm<input type="text" placeholder="e.g. Randolph" value="${esc(s.dorm)}" data-field="dorm"></label>
          <label>Room #<input type="text" placeholder="e.g. 214" value="${esc(s.room)}" data-field="room"></label>
        </div>
        ${sourceToggleHtml(key)}
        ${key !== 'returns' ? `<div class="field-grid"><label>Carrier (required)<input type="text" placeholder="e.g. UPS, USPS, FedEx, DHL" value="${esc(s.carrier)}" data-field="carrier"></label><label>Tracking/order numbers (required)<span class="field-hint">One number per line — add several if needed.</span><textarea rows="3" placeholder="Enter one number per line" data-field="tracking">${esc(s.tracking)}</textarea></label></div>` : ''}
        ${consentHtml(key, vm)}
        <div class="total-row">
          <div>
            <div class="total-label">Total due</div>
            <div class="total-sub" data-role="subtext">${esc(vm.subText)}</div>
          </div>
          <div class="total-amount" data-role="total">${money(vm.total)}</div>
        </div>
        <div class="copy-row">
          <div class="copy-row-text" data-role="memo">${esc(vm.memo)}</div>
          <button type="button" class="copy-btn" data-action="copy" data-value-role="memo">Copy</button>
        </div>
        <div class="pay-tabs">
          <button type="button" class="tab${s.payMethod === 'venmo' ? ' active' : ''}" data-action="paymethod" data-method="venmo">Venmo</button>
          <button type="button" class="tab${s.payMethod === 'zelle' ? ' active' : ''}" data-action="paymethod" data-method="zelle">Zelle</button>
          <button type="button" class="tab${s.payMethod === 'card' ? ' active' : ''}" data-action="paymethod" data-method="card">Card</button>
        </div>
        <div data-role="payment-panel">${paymentPanelHtml(key, vm)}</div>
        ${!vm.ready ? `<div class="missing" data-role="missing">Still need: ${esc(vm.missing.join(', '))}.</div>` : ''}
      </div>`;
  }

  function render() {
    const key = state.active;
    app.innerHTML = `<div class="tabs">${tabsHtml()}</div>${cardHtml(key)}`;
  }

  // Cheap refresh of computed text/attributes without touching input elements,
  // so typing in a field never resets its cursor position.
  function updateDerived() {
    const key = state.active;
    const vm = buildVM(key);
    const card = app.querySelector('.card');
    if (!card) return;

    card.querySelectorAll('[data-tier-index]').forEach((row) => {
      row.classList.toggle('is-active', Number(row.dataset.tierIndex) === vm.tierIndex);
    });
    const total = card.querySelector('[data-role="total"]'); if (total) total.textContent = money(vm.total);
    const sub = card.querySelector('[data-role="subtext"]'); if (sub) sub.textContent = vm.subText;
    const memo = card.querySelector('[data-role="memo"]'); if (memo) memo.textContent = vm.memo;
    const consentText = card.querySelector('[data-role="consent-text"]'); if (consentText) consentText.textContent = vm.consentText;
    const zelleLineEl = card.querySelector('[data-role="zelle-line"]'); if (zelleLineEl) zelleLineEl.textContent = vm.zelleLine;

    const missing = card.querySelector('[data-role="missing"]');
    if (vm.ready && missing) missing.remove();
    if (!vm.ready && !missing) {
      const div = document.createElement('div');
      div.className = 'missing'; div.dataset.role = 'missing';
      div.textContent = `Still need: ${vm.missing.join(', ')}.`;
      card.appendChild(div);
    } else if (!vm.ready && missing) {
      missing.textContent = `Still need: ${vm.missing.join(', ')}.`;
    }

    // Mirrors the design's controlled input: out-of-range typing snaps back to
    // the clamped value immediately, same as a React re-render would.
    const qtyInput = card.querySelector('[data-role="qty-input"]');
    if (qtyInput) qtyInput.value = String(state[key].qty);

    const payBtn = card.querySelector('[data-action="pay-venmo"], [data-action="pay-zelle"]');
    if (payBtn) {
      payBtn.disabled = !vm.ready;
      const method = state[key].payMethod;
      payBtn.textContent = method === 'venmo'
        ? (vm.ready ? `Pay ${money(vm.total)} with Venmo` : 'Enter details to pay')
        : (vm.ready ? `Pay ${money(vm.total)} with Zelle` : 'Enter details to pay with Zelle');
    }
  }

  function setField(key, field, value) {
    state[key][field] = value;
  }

  function setQty(key, raw) {
    let n = parseInt(raw, 10);
    if (Number.isNaN(n)) n = 1;
    n = Math.max(1, Math.min(50, n));
    state[key].qty = n;
  }

  function copy(value, done) {
    const finish = () => done();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(finish, () => fallbackCopy(value, finish));
    } else {
      fallbackCopy(value, finish);
    }
  }
  function fallbackCopy(value, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = value; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      done();
    } catch { /* clipboard unavailable; button simply won't flip to Copied */ }
  }

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const key = state.active;
    const action = el.dataset.action;

    if (action === 'tab') { state.active = el.dataset.service; render(); return; }
    if (action === 'source') { state.pickup.source = el.dataset.source; render(); return; }
    if (action === 'paymethod') { state[key].payMethod = el.dataset.method; render(); return; }
    if (action === 'qty-dec') { setQty(key, state[key].qty - 1); render(); return; }
    if (action === 'qty-inc') { setQty(key, state[key].qty + 1); render(); return; }

    if (action === 'copy') {
      const roleTarget = el.dataset.valueRole;
      const value = roleTarget ? app.querySelector(`[data-role="${roleTarget}"]`).textContent : el.dataset.value;
      const original = el.textContent;
      copy(value, () => {
        el.textContent = 'Copied';
        setTimeout(() => { el.textContent = original; }, 1500);
      });
      return;
    }
    if (action === 'send-consent') {
      const vm = buildVM(key);
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const sep = isIOS ? '&' : '?';
      try { window.location.href = `sms:${CONSENT_PHONE}${sep}body=${encodeURIComponent(vm.consentText)}`; } catch { /* sms handoff unsupported here */ }
      setTimeout(() => { state.pickup.consentFallback = true; render(); }, 1200);
      return;
    }
    if (action === 'pay-venmo') {
      const vm = buildVM(key);
      if (!vm.ready) return;
      const link = venmoLink(order(key));
      try { window.location.href = link.deepLink; } catch { /* Venmo app handoff unsupported here */ }
      setTimeout(() => { state.venmoFallback[key] = true; render(); }, 1200);
      return;
    }
    if (action === 'pay-zelle') {
      const vm = buildVM(key);
      if (!vm.ready) return;
      copy(vm.zelleLine, () => {
        state.zelleFallback[key] = true;
        render();
      });
      return;
    }
  });

  app.addEventListener('input', (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    const key = state.active;
    if (field === 'qty') { setQty(key, e.target.value); updateDerived(); return; }
    setField(key, field, e.target.value);
    updateDerived();
  });

  render();
}
