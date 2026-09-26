import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {
  SERVICE_DETAILS, VENMO_USERNAME, ZELLE_DISPLAY, EXPRESS_ADDRESS, CONSENT_PHONE,
  calculateAmount, calculateOrderTotal, promoDiscountPercent, tierFor, normalizeTrackingNumbers, buildMemo, buildConsent, smsLink, validateOrder, venmoLink, zelleLine, splitPaymentRequests, PAYMENT_MEMO_MAX_LENGTH, discountPercent, isPickupStyle,
} from '../app.js';

const root = new URL('../', import.meta.url);

test('Vercel publishes only the built frontend artifact', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url)));
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.functions, undefined);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['build.js'], { cwd: root, stdio: 'ignore' });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`build exited ${code}`)));
  });
  const files = await readdir(new URL('../dist/', import.meta.url));
  assert.deepEqual(files.sort(), ['app.js', 'faq.html', 'index.html', 'styles.css', 'videos']);
  for (const file of files) assert.doesNotMatch(file, /server|package|test|json/);
  assert.deepEqual((await readdir(new URL('../dist/videos/', import.meta.url))).sort(), ['duke-drop-1.mp4', 'duke-drop-2.mp4', 'duke-drop-3.mp4', 'duke-drop-4.mp4']);
});

test('built artifact works when served as static files', async () => {
  const server = spawn('python3', ['-m', 'http.server', '4174'], { cwd: new URL('../dist/', import.meta.url), stdio: 'ignore' });
  try {
    let response;
    for (let attempt = 0; attempt < 20; attempt++) {
      try { response = await fetch('http://127.0.0.1:4174/'); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(response, 'static server did not start');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /DukeDrop/);
    for (const path of ['faq.html', 'videos/duke-drop-1.mp4', 'videos/duke-drop-2.mp4', 'videos/duke-drop-3.mp4', 'videos/duke-drop-4.mp4']) {
      const asset = await fetch(`http://127.0.0.1:4174/${path}`);
      assert.equal(asset.status, 200, `${path} should be published`);
    }
  } finally { server.kill(); }
});

test('tiered pricing matches the design rate sheet for every service', () => {
  assert.equal(calculateAmount('express', 1), 4.99);
  assert.equal(calculateAmount('express', 3), 11.97);
  assert.equal(calculateAmount('express', 5), 14.95);
  assert.deepEqual(SERVICE_DETAILS.express.tiers.map(t => [t.was, t.rate]), [[5.99, 4.99], [4.99, 3.99], [3.99, 2.99]]);
  assert.deepEqual(SERVICE_DETAILS.express.tiers.map(t => discountPercent(t.was, t.rate)), [17, 20, 25]);
  assert.equal(calculateAmount('pickup', 3), 8.97);
  assert.equal(calculateAmount('returns', 3), 11.97);
  assert.throws(() => calculateAmount('express', 0));
  assert.throws(() => calculateAmount('express', 51));
  assert.throws(() => calculateAmount('bogus', 1));
});

test('Austin20 takes 20% off every service total and payment request, case-insensitively', () => {
  assert.equal(promoDiscountPercent(' aUsTiN20 '), 20);
  assert.equal(promoDiscountPercent('unknown'), 0);
  assert.equal(calculateOrderTotal('express', 1, 'austin20'), 3.99);
  assert.equal(calculateOrderTotal('bigdrop', 1, 'AUSTIN20'), 9.60);
  assert.equal(calculateOrderTotal('express', 1, 'invalid'), 4.99);
  const requests = splitPaymentRequests({ service: 'express', quantity: 1, dorm: 'A', room: '1', carrier: 'USPS', tracking: 'T', promoCode: 'austin20' });
  assert.equal(requests[0].amount, '3.99');
  assert.equal(requests.reduce((sum, r) => sum + r.amountCents, 0), 399);
});

test('tierFor reports the active tier index used for rate-row highlighting', () => {
  assert.equal(tierFor('pickup', 1).index, 0);
  assert.equal(tierFor('pickup', 4).index, 1);
  assert.equal(tierFor('pickup', 20).index, 2);
});

test('Express discount metadata renders as actual whole-number savings', () => {
  const markup = SERVICE_DETAILS.express.tiers.map(t => `<del>$${t.was.toFixed(2)}</del> <b>$${t.rate.toFixed(2)}</b> <span>${discountPercent(t.was, t.rate)}% off</span>`).join('');
  assert.match(markup, /<del>\$5\.99<\/del> <b>\$4\.99<\/b> <span>17% off<\/span>/);
  assert.match(markup, /<del>\$4\.99<\/del> <b>\$3\.99<\/b> <span>20% off<\/span>/);
  assert.match(markup, /<del>\$3\.99<\/del> <b>\$2\.99<\/b> <span>25% off<\/span>/);
});

test('Pickup and Returns have distinct copy, rate header, and prices', () => {
  assert.notEqual(SERVICE_DETAILS.pickup.intro, SERVICE_DETAILS.returns.intro);
  assert.equal(SERVICE_DETAILS.pickup.rateHeader, 'Packages per trip');
  assert.equal(SERVICE_DETAILS.express.rateHeader, 'Packages per order');
  assert.notEqual(SERVICE_DETAILS.pickup.callout, SERVICE_DETAILS.returns.callout);
  assert.equal(SERVICE_DETAILS.express.callout, '');
});

test('tracking numbers normalize lines, whitespace, blanks, and duplicates', () => {
  assert.deepEqual(normalizeTrackingNumbers(' A-1  \n\nB&2\r\n A-1 '), ['A-1', 'B&2']);
  assert.deepEqual(normalizeTrackingNumbers('   \n'), []);
});

test('tracked services require a carrier and tracking; Returns does not', () => {
  assert.equal(validateOrder({ service: 'express', quantity: 1, dorm: 'A', room: '1', carrier: 'USPS', tracking: 'T' }).valid, true);
  assert.equal(validateOrder({ service: 'express', quantity: 1, dorm: 'A', room: '1', tracking: 'T' }).valid, false);
  assert.equal(validateOrder({ service: 'returns', quantity: 1, dorm: 'A', room: '1' }).valid, true);
});

test('Pickup mailroom requires mailroom, box, and name; locker requires building and a 6-digit code', () => {
  assert.equal(validateOrder({ service: 'pickup', quantity: 1, dorm: 'A', room: '1', tracking: 'T', source: 'mailbox' }).valid, false);
  const mailboxMissing = validateOrder({ service: 'pickup', quantity: 1, dorm: 'A', room: '1', tracking: 'T', source: 'mailbox' }).missing;
  assert.deepEqual(mailboxMissing, ['carrier', 'which mailroom (building)', 'Duke box #', 'your name']);
  assert.equal(validateOrder({ service: 'pickup', quantity: 1, dorm: 'A', room: '1', carrier: 'FedEx', tracking: 'T', source: 'mailbox', mailroom: 'Few', box: '9', name: 'Jane' }).valid, true);
  assert.equal(validateOrder({ service: 'pickup', quantity: 1, dorm: 'A', room: '1', tracking: 'T', source: 'locker', lockerLocation: 'Bell', locker: '12345' }).valid, false);
  assert.equal(validateOrder({ service: 'pickup', quantity: 1, dorm: 'A', room: '1', carrier: 'DHL eCommerce', tracking: 'T', source: 'locker', lockerLocation: 'Bell', locker: '123456' }).valid, true);
});

test('memo is service-specific: EXPRESS/RETURN/PICKUP prefixes and pickup source details', () => {
  assert.match(buildMemo({ service: 'express', quantity: 2, dorm: 'Randolph', room: '214', carrier: 'USPS', tracking: 'TBA1\nTBA2\nTBA1' }), /^EXPRESS 2x — Randolph 214 — USPS tracking: TBA1, TBA2$/);
  assert.match(buildMemo({ service: 'returns', quantity: 1, dorm: 'Few', room: '4', tracking: 'T' }), /^RETURN /);
  assert.match(
    buildMemo({ service: 'pickup', quantity: 1, dorm: 'Few', room: '4', tracking: 'T', source: 'mailbox', mailroom: 'Few', box: '9', name: 'Jane' }),
    /Few mailroom, Box #9, Name: Jane$/
  );
  assert.match(
    buildMemo({ service: 'pickup', quantity: 1, dorm: 'Few', room: '4', tracking: 'T', source: 'locker', lockerLocation: 'Bell', locker: '447128' }),
    /Bell locker: 447128$/
  );
  assert.doesNotMatch(buildMemo({ service: 'express', quantity: 1, dorm: 'A', room: '1', tracking: 'T' }), /[|+]/);
});

test('memo shows bracket placeholders for missing fields instead of disappearing', () => {
  assert.equal(buildMemo({ service: 'express', quantity: 1, dorm: '', room: '', tracking: '' }), 'EXPRESS 1x — [Dorm] [Room]');
});

test('pickup consent text authorizes the named runners for the given mailroom', () => {
  assert.match(buildConsent('Jane Doe', 'Few Quad'), /^PICKUP CONSENT — I, Jane Doe, authorize Sean Pao, Dylan Kim, or Timothy Mei to retrieve my package from the Few Quad mailroom\.$/);
  assert.match(buildConsent('', ''), /\[Full name\].*\[Mailroom\]/);
});

test('consent SMS links address Messages and preserve the complete consent text', () => {
  const consent = buildConsent('Jane Doe', 'Few Quad');
  for (const isIOS of [false, true]) {
    const link = smsLink(CONSENT_PHONE, consent, isIOS);
    assert.ok(link.startsWith(`sms:${CONSENT_PHONE}${isIOS ? '&' : '?'}body=`));
    assert.equal(decodeURIComponent(link.split('body=')[1]), consent);
  }
});

test('Venmo link preserves ordered fields and mobile-safe note encoding', () => {
  const o = { service: 'pickup', quantity: 2, dorm: 'Few Quad', room: '4 A', carrier: 'Royal Mail', tracking: '1&2 % special\nTBA2', source: 'mailbox', mailroom: 'Few', box: '9', name: 'Jane' };
  const link = venmoLink(o);
  assert.equal(link.amount, calculateAmount('pickup', 2).toFixed(2));
  assert.match(link.deepLink, new RegExp(`^venmo://paycharge\\?txn=pay&recipients=${VENMO_USERNAME}&amount=[\\d.]+&note=`));
  assert.equal(new URL(link.deepLink.replace('venmo://', 'https://x/')).searchParams.get('note'), link.note);
  assert.doesNotMatch(link.deepLink, /note=[^&]*\+/);
  assert.equal(link.profileUrl, `https://venmo.com/u/${VENMO_USERNAME}`);
});

test('Venmo link throws with the missing fields when the order is incomplete', () => {
  assert.throws(() => venmoLink({ service: 'express', quantity: 1, dorm: '', room: '', tracking: '' }), /Missing: dorm, room #, carrier, tracking\/order #/);
});

test('Zelle line is just the bare memo — no amount or recipient — so pasting it never claims a payment', () => {
  const line = zelleLine({ service: 'returns', quantity: 1, dorm: 'Few', room: '4', tracking: 'T' });
  assert.equal(line, 'RETURN 1x — Few 4');
  assert.doesNotMatch(line, /paid|confirmed|complete|\$|to \(/i);
});

test('Returns memo never contains tracking details', () => {
  const memo = buildMemo({ service: 'returns', quantity: 1, dorm: 'Few', room: '4', tracking: 'SECRET-TRACKING' });
  assert.equal(memo, 'RETURN 1x — Few 4');
  assert.doesNotMatch(zelleLine({ service: 'returns', quantity: 1, dorm: 'Few', room: '4', tracking: 'SECRET-TRACKING' }), /tracking|SECRET/i);
});

test('payment memos split at whole identifiers with deterministic cent allocation', () => {
  const o = { service: 'express', quantity: 5, dorm: 'A', room: '1', carrier: 'USPS', tracking: `${'x'.repeat(225)}\n${'B'.repeat(40)}\nC` };
  const requests = splitPaymentRequests(o);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(r => r.identifiers), [[`${'x'.repeat(225)}`], [`${'B'.repeat(40)}`, 'C']]);
  assert.equal(requests.reduce((sum, r) => sum + r.amountCents, 0), 1495);
  assert.deepEqual(requests.map(r => r.amountCents), [748, 747]);
  assert.ok(requests.every(r => r.memo.length <= PAYMENT_MEMO_MAX_LENGTH));
});

test('an identifier that cannot fit is a clear validation error', () => {
  const o = { service: 'express', quantity: 1, dorm: 'A', room: '1', carrier: 'USPS', tracking: 'x'.repeat(280) };
  assert.equal(validateOrder(o).valid, false);
  assert.match(validateOrder(o).missing.at(-1), /too long.*shorten\/check/i);
});

test('Returns always remains one request and does not expose tracking', () => {
  const requests = splitPaymentRequests({ service: 'returns', quantity: 3, dorm: 'Few', room: '4', tracking: 'secret' });
  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0].memo, /secret|tracking/i);
});

test('Express drop-off address matches the imported design', () => {
  assert.equal(EXPRESS_ADDRESS, '1610 Valley Creek Dr., Hillsborough, NC 27278');
});

test('Big Drop is a flat $12 (discounted from $15) per item and keeps its rate-card highlight', () => {
  assert.equal(calculateAmount('bigdrop', 1), 12);
  assert.equal(calculateAmount('bigdrop', 3), 36);
  assert.deepEqual(SERVICE_DETAILS.bigdrop.tiers.map(t => [t.was, t.rate]), [[15, 12]]);
  assert.equal(discountPercent(15, 12), 20);
  assert.equal(SERVICE_DETAILS.bigdrop.highlight, true);
  assert.ok(!SERVICE_DETAILS.express.highlight && !SERVICE_DETAILS.pickup.highlight && !SERVICE_DETAILS.returns.highlight);
});

test('Express, Pickup, and Returns all carry a size-limit note pointing oversized items to Big Drop', () => {
  for (const key of ['express', 'pickup', 'returns']) {
    assert.match(SERVICE_DETAILS[key].sizeLimitNote, /mini microwave/i);
    assert.match(SERVICE_DETAILS[key].sizeLimitNote, /Big Drop/);
  }
  assert.match(SERVICE_DETAILS.returns.sizeLimitNote, /returns too/i);
});

test('Returns requires a return label on the package before pickup', () => {
  assert.match(SERVICE_DETAILS.returns.callout, /return label/i);
});

test('isPickupStyle treats plain Pickup and Big Drop-in-pickup-mode alike, but not Big Drop shipped to us', () => {
  assert.equal(isPickupStyle('pickup'), true);
  assert.equal(isPickupStyle('bigdrop', 'pickup'), true);
  assert.equal(isPickupStyle('bigdrop', 'ship'), false);
  assert.equal(isPickupStyle('express'), false);
});

test('Big Drop in ship mode behaves like Express: no pickup fields required, no source suffix in the memo', () => {
  const o = { service: 'bigdrop', quantity: 1, dorm: 'A', room: '1', carrier: 'UPS', tracking: 'T', mode: 'ship' };
  assert.equal(validateOrder(o).valid, true);
  assert.equal(buildMemo(o), 'BIGDROP 1x — A 1 — UPS tracking: T');
});

test('Big Drop in pickup mode requires mailroom/locker fields just like Pickup', () => {
  const missingMailroom = validateOrder({ service: 'bigdrop', quantity: 1, dorm: 'A', room: '1', carrier: 'UPS', tracking: 'T', mode: 'pickup', source: 'mailbox' }).missing;
  assert.deepEqual(missingMailroom, ['which mailroom (building)', 'Duke box #', 'your name']);
  const ok = validateOrder({ service: 'bigdrop', quantity: 1, dorm: 'A', room: '1', carrier: 'UPS', tracking: 'T', mode: 'pickup', source: 'mailbox', mailroom: 'Few', box: '9', name: 'Jane' });
  assert.equal(ok.valid, true);
  assert.match(
    buildMemo({ service: 'bigdrop', quantity: 1, dorm: 'A', room: '1', carrier: 'UPS', tracking: 'T', mode: 'pickup', source: 'locker', lockerLocation: 'Bell', locker: '447128' }),
    /Bell locker: 447128$/
  );
});
