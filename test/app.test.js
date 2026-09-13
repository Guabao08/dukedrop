import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { calculateAmount, buildNote, buildMemo, buildConsent, validateOrder, venmoLinks, zelleMemo, SERVICE_DETAILS } from '../app.js';

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

test('tier amount', () => assert.equal(calculateAmount('express', 'M', 3), 14.97));
test('note contains required fields with ordinary spaces', () => {
  const note = buildNote({ dorm: 'Randolph', room: '214', size: 'S', tracking: 'TBA 1', carrier: 'Amazon' });
  assert.equal(note, 'DukeDrop Dorm: Randolph Room: 214 Size: S Tracking: TBA 1 Carrier: Amazon');
  assert.doesNotMatch(note, /[|+]/);
});
test('validation requires all fields', () => assert.equal(validateOrder({ service: 'express', size: 'S', quantity: 1, dorm: '', room: '', tracking: '', carrier: '' }).valid, false));
test('Pickup and Returns have distinct artifact requirements and prices', () => {
  assert.notEqual(SERVICE_DETAILS.pickup.intro, SERVICE_DETAILS.returns.intro);
  assert.equal(SERVICE_DETAILS.pickup.header, 'Parcels per trip');
  assert.equal(calculateAmount('pickup', 3), 8.97);
  assert.equal(calculateAmount('returns', 3), 11.97);
  assert.equal(validateOrder({service:'returns', quantity:1, dorm:'A', room:'1', tracking:'T'}).valid, true);
  assert.equal(validateOrder({service:'pickup', quantity:1, dorm:'A', room:'1', tracking:'T', source:'mailbox'}).valid, false);
  assert.equal(validateOrder({service:'pickup', quantity:1, dorm:'A', room:'1', tracking:'T', source:'locker', lockerLocation:'Bell', locker:'123456'}).valid, true);
});
test('Pickup consent and service payment data are distinct', () => {
  assert.match(buildConsent('Jane Doe', 'Few Quad'), /authorize Sean Pao/);
  assert.match(buildMemo({service:'pickup', quantity:1, dorm:'Few', room:'4', tracking:'T', source:'mailbox', mailroom:'Few', box:'9', name:'Jane'}), /mailroom, Box #9, Name: Jane/);
  assert.match(buildMemo({service:'returns', quantity:1, dorm:'Few', room:'4', tracking:'T'}), /^RETURN/);
  assert.match(zelleMemo({service:'returns', quantity:1, dorm:'Few', room:'4', tracking:'T'}), /469-964-9545/);
});
test('Venmo links preserve ordered fields and mobile-safe note encoding', () => {
  const x = venmoLinks({ service: 'pickup', size: 'L', quantity: 2, dorm: 'Few Quad', room: '4 A', tracking: '1&2 % special', carrier: 'UPS/Amazon' });
  assert.match(x.deepLink, /venmo:\/\/paycharge\?/);
  assert.match(x.deepLink, /txn=pay&recipients=Timothymei71&amount=3.98&note=/);
  assert.match(x.deepLink, /note=DukeDrop%20Dorm%3A%20Few%20Quad%20Room%3A%204%20A/);
  assert.doesNotMatch(x.deepLink, /note=[^&]*\+/);
  assert.equal(new URL(x.webLink).searchParams.get('note'), x.note);
  assert.equal(new URL(x.deepLink).searchParams.get('note'), x.note);
  assert.doesNotMatch(new URL(x.deepLink).searchParams.get('note'), /[|+]/);
});
