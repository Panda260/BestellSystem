// Evidence probe for the vulnerable baseline, NOT a passing security regression suite.
// Starts its own server with a temporary database; never accepts a remote target.
// Run from the repository with installed dependencies: node docs/security-review-probe.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const vm = require('node:vm');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bestellsystem-review-'));
const base = 'http://127.0.0.1:31337';
const marker = '<img src=x onerror="document.documentElement.dataset.review=1">';
const children = new Set();
const sockets = new Set();
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const pass = (name) => console.log(`CONFIRMED: ${name}`);

async function start(name) {
  const folder = path.join(temporary, name);
  fs.mkdirSync(folder);
  for (const file of ['server.js', 'database.js']) fs.copyFileSync(path.join(root, file), path.join(folder, file));
  // Use the application's limit window deterministically, without changing its source.
  fs.writeFileSync(path.join(folder, 'clock.cjs'), `const OriginalDate = Date;
global.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : [2026, 8, 10, 12, 45, 0])); }
};`);
  const child = spawn(process.execPath, ['--require', path.join(folder, 'clock.cjs'), path.join(folder, 'server.js')], {
    env: { ...process.env, PORT: '31337', BESTELL_PASSWORD: '', SESSION_SECRET: '',
      NODE_PATH: [path.join(root, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.add(child);
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  for (let i = 0; i < 100; i++) {
    if (output.includes('BestellSystem läuft')) return child;
    if (child.exitCode !== null) throw new Error(`Server startup failed: ${output}`);
    await pause(50);
  }
  throw new Error(`Server startup timed out: ${output}`);
}

async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit');
    child.kill();
    await ended;
  }
  children.delete(child);
}

async function request(route, options = {}) {
  return fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(3000), ...options });
}

function json(body, cookie) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) };
}

async function connectSocket(event, payload) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket');
    sockets.add(ws);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Socket timeout')); }, 3000);
    ws.on('error', error => { clearTimeout(timer); reject(error); });
    ws.on('message', raw => {
      const message = raw.toString();
      if (message.startsWith('0')) ws.send('40');
      else if (message.startsWith('40')) {
        clearTimeout(timer);
        ws.send('42' + JSON.stringify(payload === undefined ? [event] : [event, payload]));
        resolve(ws);
      } else if (message === '2') ws.send('3');
    });
  });
}

async function main() {
  console.log(`Runtime: ${process.version}`);
  for (const name of ['express', 'express-session', 'socket.io', 'sqlite3']) {
    const expected = require(path.join(root, 'package-lock.json')).packages[`node_modules/${name}`].version;
    const actual = require(`${name}/package.json`).version;
    assert.equal(actual, expected, `Installed ${name} differs from reviewed lockfile`);
    console.log(`${name}: ${actual}`);
  }
  let child = await start('http');
  try {
    let response = await request('/api/orders', json({ customerName: marker, items: [{ name: marker, price: -7, qty: 1 }] }));
    assert.equal(response.status, 201);
    const { id, order } = await response.json();
    assert.equal(order.total, -7);
    pass('SR-01/SR-04: anonymous order accepts arbitrary name and negative client price');
    response = await request(`/api/orders/${id}`);
    assert.equal((await response.json()).customerName, marker);
    pass('SR-05: anonymous numeric ID lookup exposes customer name and items');
    for (const suffix of ['items/0/toggle', 'items/0/toggle-oven', 'toggle-oven']) {
      assert.equal((await request(`/api/orders/${id}/${suffix}`, { method: 'POST' })).status, 200);
    }
    pass('SR-01: all three kitchen mutation routes accept anonymous requests');
    const ws = await connectSocket('join', { role: 'staff' });
    const data = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No staff update')), 3000);
      ws.on('message', raw => {
        const message = raw.toString();
        if (!message.startsWith('42')) return;
        const [event, orders] = JSON.parse(message.slice(2));
        if (event === 'orders:update') { clearTimeout(timer); resolve(orders); }
      });
    });
    assert.equal(data[0].customerName, marker);
    ws.terminate();
    pass('SR-02: anonymous WebSocket staff join exposes full order');

    for (const route of ['/api/stats', '/api/names', '/api/admin/menu', '/api/orders/history/today']) {
      assert.equal((await request(route)).status, 401);
    }
    pass('Control: stats, names, admin menu and history HTTP routes reject anonymous requests');
    response = await request('/bestellen');
    const before = response.headers.get('set-cookie').split(';')[0];
    response = await request('/bestellen/login', { method: 'POST', headers: {
      Cookie: before, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://review.invalid'
    }, body: 'password=admin' });
    assert.equal(response.status, 302);
    const setCookie = response.headers.get('set-cookie');
    const cookie = setCookie ? setCookie.split(';')[0] : before;
    assert.equal(cookie, before);
    assert.equal((await request('/api/stats', { headers: { Cookie: before } })).status, 200);
    pass('SR-06/SR-07: default password works; existing session survives login; foreign Origin accepted (no browser CSRF claim)');
    for (let i = 0; i < 25; i++) {
      assert.equal((await request('/bestellen/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=wrong-review-value' })).status, 401);
    }
    pass('SR-07: 25 consecutive failed logins are not throttled');
    response = await request('/api/admin/menu', json({ name: 'ReviewPizza', price: 9 }, cookie));
    const product = await response.json();
    response = await request(`/api/admin/menu/${product.id}`, { ...json({ name: 'ReviewPizza', price: 9, active: true, max_limit: 1, category: null }, cookie), method: 'PUT' });
    assert.equal(response.status, 200);
    response = await request('/api/orders', json({ customerName: 'Synthetic Review', items: [{ name: 'ReviewPizza', price: 0, qty: 2 }] }));
    assert.equal(response.status, 201);
    assert.equal((await response.json()).order.items.length, 2);
    pass('SR-04: quantity 2 bypasses configured product limit 1 during limit window');

    for (const file of ['public/bestellungen.js', 'public/status.js', 'public/stats-lifetime.js']) {
      const elements = new Map();
      const handlers = {};
      const context = {
        io: () => ({ emit() {}, on(event, handler) { handlers[event] = handler; } }),
        document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { textContent: '123', innerHTML: '' }); return elements.get(id); } },
        fetch: () => new Promise(() => {}), window: {}, console
      };
      vm.createContext(context);
      vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
      const synthetic = { ...order, id: '123' };
      if (file.includes('bestellungen')) handlers['orders:update']([synthetic]);
      else if (file.includes('status')) context.renderStatus(synthetic);
      else context.renderStats('stats-lifetime', { [marker]: 1 });
      assert.ok([...elements.values()].some(element => element.innerHTML.includes(marker)));
    }
    pass('SR-03: kitchen, status and lifetime render unescaped event-handler markup (DOM sink check, no browser execution)');
  } finally { await stop(child); }

  child = await start('invalid-http');
  try {
    const ended = once(child, 'exit');
    await request('/api/orders', json({ customerName: 'Synthetic Review', items: null })).catch(() => {});
    const [code] = await Promise.race([ended, pause(3500).then(() => { throw new Error('Expected HTTP crash absent'); })]);
    assert.equal(code, 1);
    pass('SR-04: items=null during limit window terminates isolated server with exit 1');
  } finally { await stop(child); }

  child = await start('invalid-socket');
  try {
    const ended = once(child, 'exit');
    await connectSocket('join');
    const [code] = await Promise.race([ended, pause(3500).then(() => { throw new Error('Expected Socket crash absent'); })]);
    assert.equal(code, 1);
    pass('SR-04: join without payload terminates isolated server with exit 1');
  } finally { await stop(child); }
}

const watchdog = setTimeout(() => { console.error('Review timed out'); process.exit(1); }, 45000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(watchdog);
  for (const ws of sockets) ws.terminate();
  for (const child of children) await stop(child);
  fs.rmSync(temporary, { recursive: true, force: true });
});
