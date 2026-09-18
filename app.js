// Domain rules ported from the Claude Design project "App redesign requirements"
// (DukeDrop.dc.html Component + DukeDrop-print.dc.html rate sheet). Pure and
// framework-free so it can run both in the browser and under node:test.

export const VENMO_USERNAME = 'dukedrop';
export const ZELLE_DISPLAY = '(469) 964-9545';
export const ZELLE_DIGITS = ZELLE_DISPLAY.replace(/\D/g, '');
export const CONSENT_PHONE = '2019160008';
export const EXPRESS_ADDRESS = '1610 Valley Creek Dr., Hillsborough, NC 27278';
export const CONSENT_AUTHORIZERS = 'Sean Pao, Dylan Kim, or Timothy Mei';
export const INSTAGRAM_HANDLE = 'dukedrop_';
// Venmo's current help documentation describes a 280-character payment note.
// Zelle has no single network-wide memo limit (banks vary), so we use this
// documented Venmo limit for both paths to guarantee copy/paste parity.
export const PAYMENT_MEMO_MAX_LENGTH = 280;

export const SIZE_LIMIT_NOTE = "Size limit: nothing bigger than a mini microwave. Bigger than that — furniture, TVs, chairs, and the like — goes through Big Drop instead.";

export const SERVICE_DETAILS = {
  express: {
    eyebrow: 'Express',
    title: 'Express',
    rateHeader: 'Packages per order',
    intro: "Ship to our DukeDrop address to skip the mailroom's 48-hour hold — we bring it straight to your door.",
    memoPrefix: 'EXPRESS',
    callout: '',
    unit: 'package',
    sizeLimitNote: SIZE_LIMIT_NOTE,
    tiers: [
      { label: '1–2 packages · small', min: 1, max: 2, rate: 4.99, was: 5.99 },
      { label: '3–4 packages · medium', min: 3, max: 4, rate: 3.99, was: 4.99 },
      { label: '5+ packages · large', min: 5, max: Infinity, rate: 2.99, was: 3.99 },
    ],
  },
  pickup: {
    eyebrow: 'Pickup',
    title: 'Pickup',
    rateHeader: 'Packages per trip',
    intro: 'We grab it from your mailroom box or locker — third-party pickup, delivered straight to your dorm.',
    memoPrefix: 'PICKUP',
    callout: 'Mailroom pickups need your OK on file — text us the consent line before paying. Locker codes already work as consent, so lockers skip straight to paying.',
    unit: 'package',
    sizeLimitNote: SIZE_LIMIT_NOTE,
    tiers: [
      { label: '1–2 packages · small', min: 1, max: 2, rate: 3.99 },
      { label: '3–4 packages · medium', min: 3, max: 4, rate: 2.99 },
      { label: '5+ packages · large', min: 5, max: Infinity, rate: 1.99 },
    ],
  },
  returns: {
    eyebrow: 'Returns',
    title: 'Returns',
    rateHeader: 'Packages per trip',
    intro: 'Leave it at your door — we repack it, get it ready to ship, and drop it at the package center for you.',
    memoPrefix: 'RETURN',
    callout: "Stick your return label on the package before we pick it up — we can't ship it out without one. Your payment note carries your dorm + room — that's your authorization, nothing else to send.",
    unit: 'package',
    sizeLimitNote: `${SIZE_LIMIT_NOTE} Big Drop applies to returns too.`,
    tiers: [
      { label: '1–2 packages · small', min: 1, max: 2, rate: 4.99 },
      { label: '3–4 packages · medium', min: 3, max: 4, rate: 3.99 },
      { label: '5+ packages · large', min: 5, max: Infinity, rate: 2.99 },
    ],
  },
  bigdrop: {
    eyebrow: 'Big Drop',
    title: 'Big Drop',
    rateHeader: 'Items per order',
    intro: 'Furniture, TVs, microwaves, chairs — anything too big for Express, Pickup, or Returns. Ship it to us and we bring it to your dorm, or we grab it from your mailroom or locker.',
    memoPrefix: 'BIGDROP',
    callout: 'For big/bulky items only — furniture, TVs, microwaves, chairs, and similar. Mailroom pickups still need consent on file.',
    unit: 'item',
    highlight: true,
    tiers: [
      { label: 'Any item · furniture, TV, microwave, chair, etc.', min: 1, max: 50, rate: 12, was: 15 },
    ],
  },
};

export function money(n) { return '$' + n.toFixed(2); }

export function discountPercent(was, now) {
  return Math.round((1 - now / was) * 100);
}

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

export function isPickupStyle(service, mode) {
  return service === 'pickup' || (service === 'bigdrop' && mode === 'pickup');
}

export function buildMemo({ service, quantity, dorm, room, carrier, tracking, source, mailroom, box, lockerLocation, locker, name, mode }) {
  const prefix = SERVICE_DETAILS[service].memoPrefix;
  let memo = `${prefix} ${quantity}x — ${dorm || '[Dorm]'} ${room || '[Room]'}`;
  if (service !== 'returns') {
    const lines = normalizeTrackingNumbers(tracking);
    if (carrier || lines.length) memo += ` — ${carrier || '[Carrier]'} tracking: ${lines.join(', ') || '[Tracking #]'}`;
  }
  if (isPickupStyle(service, mode)) {
    memo += source === 'locker'
      ? ` — ${lockerLocation || '[Locker location]'} locker: ${locker || '[Locker code]'}`
      : ` — ${mailroom || '[Mailroom]'} mailroom, Box #${box || '[Box #]'}, Name: ${name || '[Full name]'}`;
  }
  return memo;
}

export function splitPaymentRequests(o) {
  const totalCents = Math.round(calculateAmount(o.service, o.quantity) * 100);
  const identifiers = o.service === 'returns' ? [] : normalizeTrackingNumbers(o.tracking);
  const chunks = [];
  for (const identifier of identifiers) {
    const candidate = [...(chunks.at(-1) || []), identifier];
    const memo = buildMemo({ ...o, tracking: candidate.join('\\n') });
    if (memo.length > PAYMENT_MEMO_MAX_LENGTH) {
      if (!chunks.length) throw new Error(`Tracking/order number is too long to fit in a payment memo; please shorten/check it: ${identifier}`);
      chunks.push([identifier]);
      const solo = buildMemo({ ...o, tracking: identifier });
      if (solo.length > PAYMENT_MEMO_MAX_LENGTH) throw new Error(`Tracking/order number is too long to fit in a payment memo; please shorten/check it: ${identifier}`);
    } else if (chunks.length) chunks[chunks.length - 1].push(identifier);
    else chunks.push([identifier]);
  }
  if (!chunks.length) chunks.push([]);
  const base = Math.floor(totalCents / chunks.length);
  const remainder = totalCents % chunks.length;
  return chunks.map((ids, i) => {
    const amountCents = base + (i < remainder ? 1 : 0);
    const memo = buildMemo({ ...o, tracking: ids.join('\\n') });
    return { index: i + 1, total: chunks.length, identifiers: ids, amountCents, amount: (amountCents / 100).toFixed(2), memo };
  });
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
  if (missing.length === 0) {
    try { splitPaymentRequests(o); } catch (error) { missing.push(error.message); }
  }
  if (isPickupStyle(o.service, o.mode)) {
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

export function venmoLink(o, request) {
  const v = validateOrder(o);
  if (!v.valid) throw new Error(`Missing: ${v.missing.join(', ')}`);
  const payment = request || splitPaymentRequests(o)[0];
  const amount = payment.amount;
  const note = payment.memo;
  const params = [['txn', 'pay'], ['recipients', VENMO_USERNAME], ['amount', amount], ['note', note]]
    .map(([k, x]) => `${k}=${encodeURIComponent(x)}`).join('&');
  return {
    amount,
    note,
    deepLink: `venmo://paycharge?${params}`,
    profileUrl: `https://venmo.com/u/${VENMO_USERNAME}`,
  };
}

export function zelleLine(o, request) {
  const payment = request || splitPaymentRequests(o)[0];
  return `$${payment.amount} to ${ZELLE_DISPLAY} — ${payment.memo}`;
}

if (typeof document !== 'undefined') {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const makeServiceState = (service) => ({
    qty: 1, dorm: '', room: '', carrier: '', tracking: '', payMethod: 'venmo',
    ...(service === 'pickup' || service === 'bigdrop' ? { source: 'mailbox', mailroom: '', box: '', lockerLocation: '', locker: '', name: '', consentFallback: false } : {}),
    ...(service === 'bigdrop' ? { mode: 'ship' } : {}),
  });

  const state = {
    active: 'express',
    express: makeServiceState('express'),
    pickup: makeServiceState('pickup'),
    returns: makeServiceState('returns'),
    bigdrop: makeServiceState('bigdrop'),
    venmoFallback: { express: false, pickup: false, returns: false, bigdrop: false },
    zelleFallback: { express: false, pickup: false, returns: false, bigdrop: false },
  };

  const app = document.getElementById('app');

  function order(key) {
    const s = state[key];
    return { service: key, quantity: s.qty, dorm: s.dorm, room: s.room, carrier: s.carrier, tracking: s.tracking, source: s.source, mailroom: s.mailroom, box: s.box, lockerLocation: s.lockerLocation, locker: s.locker, name: s.name, mode: s.mode };
  }

  function buildVM(key) {
    const s = state[key];
    const detail = SERVICE_DETAILS[key];
    const o = order(key);
    const { tier, index: tierIndex } = tierFor(key, s.qty);
    const total = tier.rate * s.qty;
    const v = validateOrder(o);
    const pickupStyle = isPickupStyle(key, s.mode);
    const isLocker = pickupStyle && s.source === 'locker';
    const showConsent = pickupStyle && !isLocker;
    const consentText = showConsent ? buildConsent(s.name, s.mailroom) : '';
    return {
      key, detail, tierIndex, total, subText: `${s.qty} × ${money(tier.rate)}`,
      memo: buildMemo(o), ready: v.valid, missing: v.missing,
      isLocker, showConsent, consentText, pickupStyle,
      requests: (() => { try { return splitPaymentRequests(o); } catch { return []; } })(),
      zelleLine: zelleLine(o),
    };
  }

  function tabsHtml() {
    return ['express', 'pickup', 'returns', 'bigdrop'].map((k) =>
      `<button type="button" class="tab${state.active === k ? ' active' : ''}${SERVICE_DETAILS[k].highlight ? ' tab-highlight' : ''}" data-action="tab" data-service="${k}">${SERVICE_DETAILS[k].title}${SERVICE_DETAILS[k].highlight ? '<span class="tab-badge">New</span>' : ''}</button>`
    ).join('');
  }

  function bannerHtml(key) {
    const s = state[key];
    if (key !== 'express' && !(key === 'bigdrop' && s.mode === 'ship')) return '';
    return `
      <div class="address-box">
        <div><strong>Ship here under your own name</strong><span>${esc(EXPRESS_ADDRESS)}</span></div>
        <button type="button" class="copy-btn" data-action="copy" data-value="${esc(EXPRESS_ADDRESS)}">Copy</button>
      </div>`;
  }

  function calloutHtml(detail) {
    if (!detail.callout) return '';
    return `<div class="callout"><span class="callout-label">${detail.title === 'Big Drop' ? 'Heads up' : 'Consent'}</span>${esc(detail.callout)}</div>`;
  }

  function sizeLimitHtml(detail) {
    if (!detail.sizeLimitNote) return '';
    return `<div class="callout callout-size"><span class="callout-label">Size limit</span>${esc(detail.sizeLimitNote)}</div>`;
  }

  function ratesHtml(key) {
    const detail = SERVICE_DETAILS[key];
    const { index: activeIndex } = tierFor(key, state[key].qty);
    return `
      <div class="rates" data-role="rates" aria-label="${esc(detail.rateHeader)}">
        ${detail.tiers.map((t, i) => `<div class="rate-row${i === activeIndex ? ' is-active' : ''}" data-tier-index="${i}"><span>${esc(t.label)}</span><strong>${t.was ? `<del>${money(t.was)}</del> <b>${money(t.rate)}</b>` : money(t.rate)}/${detail.unit}</strong>${t.was ? `<small>/${detail.unit}</small>` : ''}</div>`).join('')}
      </div>`;
  }

  function modeToggleHtml(key) {
    if (key !== 'bigdrop') return '';
    const s = state[key];
    const isPickup = s.mode === 'pickup';
    return `
      <div class="toggle-row">
        <button type="button" class="tab${!isPickup ? ' active' : ''}" data-action="mode" data-mode="ship">Ship it to us</button>
        <button type="button" class="tab${isPickup ? ' active' : ''}" data-action="mode" data-mode="pickup">Grab it for me</button>
      </div>`;
  }

  function sourceToggleHtml(key) {
    const s = state[key];
    if (!isPickupStyle(key, s.mode)) return '';
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
      <div class="step-label">1 · Pickup consent</div>
      <label>Full name on package<input type="text" placeholder="e.g. Jane Doe" value="${esc(s.name)}" data-field="name"></label>
      <div class="copy-row">
        <div class="copy-row-text" data-role="consent-text">${esc(vm.consentText)}</div>
        <button type="button" class="copy-btn" data-action="copy" data-value-role="consent-text">Copy</button>
      </div>
      <button type="button" class="btn-primary" data-action="send-consent">Text consent to ${esc(CONSENT_PHONE)}</button>
      ${s.consentFallback ? `<div class="fallback">Messages didn't open? Copy the line above and text it to <strong>${esc(CONSENT_PHONE)}</strong>.</div>` : ''}
      <div class="ig-line">or <a href="https://instagram.com/${INSTAGRAM_HANDLE}" target="_blank" rel="noopener">DM @${INSTAGRAM_HANDLE} on Instagram</a> instead — paste the copied line into the chat</div>
      <div class="step-label">2 · Payment</div>`;
  }

  function paymentPanelHtml(key, vm) {
    const s = state[key];
    const method = s.payMethod;
    const requests = vm.requests;
    const requestSummary = requests.length > 1 ? `<div class="payment-requests"><strong>Payment requests</strong>${requests.map((r) => `<div class="payment-request"><div>Payment ${r.index} of ${r.total}: <strong>${money(r.amountCents / 100)}</strong></div><div class="fallback-mono">${esc(r.identifiers.join(', '))}</div><div>${esc(r.memo)}</div><button type="button" class="btn-pay" data-action="${method === 'venmo' ? 'pay-venmo' : 'pay-zelle'}" data-request="${r.index}" ${vm.ready ? '' : 'disabled'}>${method === 'venmo' ? 'Open' : 'Copy'} payment ${r.index}</button></div>`).join('')}</div>` : '';
    if (method === 'venmo') {
      const label = vm.ready ? `Pay ${money(vm.total)} with Venmo` : 'Enter details to pay';
      return `${requestSummary || `<button type="button" class="btn-pay" data-action="pay-venmo" ${vm.ready ? '' : 'disabled'}>${label}</button>`}
        ${state.venmoFallback[key] ? `<div class="fallback">Venmo app didn't open? Send the requested amount to <a href="https://venmo.com/u/${VENMO_USERNAME}" target="_blank" rel="noopener">@${VENMO_USERNAME}</a>. DukeDrop does not confirm payment.</div>` : ''}`;
    }
    if (method === 'zelle') {
      const label = vm.ready ? `Pay ${money(vm.total)} with Zelle` : 'Enter details to pay with Zelle';
      return `${requestSummary || `<button type="button" class="btn-pay" data-action="pay-zelle" ${vm.ready ? '' : 'disabled'}>${label}</button>`}
        ${state.zelleFallback[key] ? `<div class="fallback">Note copied. Open your bank's app and send to <strong>${esc(ZELLE_DISPLAY)}</strong> — paste the note below if your bank allows one:<div class="fallback-mono" data-role="zelle-line">${esc(vm.zelleLine)}</div></div>` : ''}`;
    }
    return `<div class="card-note">Card payments are launching soon — please use Venmo or Zelle for now.</div>`;
  }

  function cardHtml(key) {
    const detail = SERVICE_DETAILS[key];
    const s = state[key];
    const vm = buildVM(key);
    return `
      <div class="card${detail.highlight ? ' card-highlight' : ''}">
        ${bannerHtml(key)}
        <h2>${esc(detail.title)}</h2>
        <p class="desc">${esc(detail.intro)}</p>
        ${calloutHtml(detail)}
        ${sizeLimitHtml(detail)}
        ${modeToggleHtml(key)}
        ${ratesHtml(key)}
        <div class="field">
          <label>${detail.unit === 'item' ? 'Items' : 'Packages'}</label>
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
        <details class="payment-note">
          <summary>Payment note</summary>
          <div class="copy-row">
            <div class="copy-row-text" data-role="memo">${esc(vm.memo)}</div>
            <button type="button" class="copy-btn" data-action="copy" data-value-role="memo">Copy</button>
          </div>
        </details>
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
    if (action === 'source') { state[key].source = el.dataset.source; render(); return; }
    if (action === 'mode') { state[key].mode = el.dataset.mode; render(); return; }
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
      const requests = splitPaymentRequests(order(key));
      const link = venmoLink(order(key), requests[(Number(el.dataset.request) || 1) - 1]);
      try { window.location.href = link.deepLink; } catch { /* Venmo app handoff unsupported here */ }
      setTimeout(() => { state.venmoFallback[key] = true; render(); }, 1200);
      return;
    }
    if (action === 'pay-zelle') {
      const vm = buildVM(key);
      if (!vm.ready) return;
      const request = vm.requests[(Number(el.dataset.request) || 1) - 1];
      copy(request ? zelleLine(order(key), request) : vm.zelleLine, () => {
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
