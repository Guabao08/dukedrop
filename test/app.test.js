import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {
  SERVICE_DETAILS, VENMO_USERNAME, ZELLE_DISPLAY, EXPRESS_ADDRESS,
  calculateAmount, tierFor, normalizeTrackingNumbers, buildMemo, buildConsent, validateOrder, venmoLink, zelleLine,
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
  assert.deepEqual(files.sort(), ['app.js', 'index.html', 'styles.css']);
  for (const file of files) assert.doesNotMatch(file, /server|package|test|json/);
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
  } finally { server.kill(); }
});

test('tiered pricing matches the design rate sheet for every service', () => {
  assert.equal(calculateAmount('express', 1), 5.99);
  assert.equal(calculateAmount('express', 3), 14.97);
  assert.equal(calculateAmount('express', 5), 19.95);
  assert.equal(calculateAmount('pickup', 3), 8.97);
  assert.equal(calculateAmount('returns', 3), 11.97);
  assert.throws(() => calculateAmount('express', 0));
  assert.throws(() => calculateAmount('express', 51));
  assert.throws(() => calculateAmount('bogus', 1));
});

test('tierFor reports the active tier index used for rate-row highlighting', () => {
  assert.equal(tierFor('pickup', 1).index, 0);
  assert.equal(tierFor('pickup', 4).index, 1);
  assert.equal(tierFor('pickup', 20).index, 2);
});

test('Pickup and Returns have distinct copy, rate header, and prices', () => {
  assert.notEqual(SERVICE_DETAILS.pickup.intro, SERVICE_DETAILS.returns.intro);
  assert.equal(SERVICE_DETAILS.pickup.rateHeader, 'Parcels per trip');
  assert.equal(SERVICE_DETAILS.express.rateHeader, 'Parcels per order');
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

test('Venmo link preserves ordered fields and mobile-safe note encoding', () => {
  const o = { service: 'pickup', quantity: 2, dorm: 'Few Quad', room: '4 A', carrier: 'Royal Mail', tracking: '1&2 % special\nTBA2', source: 'mailbox', mailroom: 'Few', box: '9', name: 'Jane' };
  const link = venmoLink(o);
  assert.equal(link.amount, calculateAmount('pickup', 2).toFixed(2));
  assert.match(link.deepLink, /^venmo:\/\/paycharge\?txn=pay&recipients=Timothymei71&amount=[\d.]+&note=/);
  assert.equal(new URL(link.deepLink.replace('venmo://', 'https://x/')).searchParams.get('note'), link.note);
  assert.doesNotMatch(link.deepLink, /note=[^&]*\+/);
  assert.equal(link.profileUrl, `https://venmo.com/u/${VENMO_USERNAME}`);
});

test('Venmo link throws with the missing fields when the order is incomplete', () => {
  assert.throws(() => venmoLink({ service: 'express', quantity: 1, dorm: '', room: '', tracking: '' }), /Missing: dorm, room #, carrier, tracking\/order #/);
});

test('Zelle line carries the amount, recipient, and full memo for a manual send/request — never a payment claim', () => {
  const line = zelleLine({ service: 'returns', quantity: 1, dorm: 'Few', room: '4', tracking: 'T' });
  const amount = calculateAmount('returns', 1).toFixed(2);
  assert.equal(line, `$${amount} to ${ZELLE_DISPLAY} — RETURN 1x — Few 4`);
  assert.doesNotMatch(line, /paid|confirmed|complete/i);
});

test('Returns memo never contains tracking details', () => {
  const memo = buildMemo({ service: 'returns', quantity: 1, dorm: 'Few', room: '4', tracking: 'SECRET-TRACKING' });
  assert.equal(memo, 'RETURN 1x — Few 4');
  assert.doesNotMatch(zelleLine({ service: 'returns', quantity: 1, dorm: 'Few', room: '4', tracking: 'SECRET-TRACKING' }), /tracking|SECRET/i);
});

test('Express drop-off address matches the imported design', () => {
  assert.equal(EXPRESS_ADDRESS, '1610 Valley Creek Dr., Hillsborough, NC 27278');
});
