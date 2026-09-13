import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { calculateAmount, buildNote, validateOrder, venmoLinks } from '../app.js';

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
test('note contains required fields', () => assert.equal(buildNote({ dorm: 'Randolph', room: '214', size: 'S', tracking: 'TBA 1', carrier: 'Amazon' }), 'DukeDrop | Dorm: Randolph | Room: 214 | Size: S | Tracking: TBA 1 | Carrier: Amazon'));
test('validation requires all fields', () => assert.equal(validateOrder({ service: 'express', size: 'S', quantity: 1, dorm: '', room: '', tracking: '', carrier: '' }).valid, false));
test('Venmo links encode note and amount', () => { const x = venmoLinks({ service: 'pickup', size: 'L', quantity: 2, dorm: 'Few Quad', room: '4 A', tracking: '1&2', carrier: 'UPS' }); assert.match(x.deepLink, /venmo:\/\/paycharge\?/); assert.match(x.deepLink, /amount=3.98/); assert.match(x.deepLink, /note=DukeDrop\+%7C/); assert.equal(new URL(x.webLink).searchParams.get('note'), x.note); });
