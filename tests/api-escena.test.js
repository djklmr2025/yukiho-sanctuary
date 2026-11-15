// node --test tests/api-escena.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

function mockRes() {
  const res = { headers: {}, statusCode: 0, body: null };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  return res;
}
const req = (query, headers = {}) => ({ method: 'GET', query, headers: { referer: 'https://yukiho-sanctuary.vercel.app/', 'x-forwarded-for': headers.ip || '1.1.1.1', ...headers } });

function load() {
  delete require.cache[require.resolve('../api/escena.js')];
  return require('../api/escena.js');
}

test('builds the prompt on the server from place + routine slot, never from free text', () => {
  const { buildPrompt } = load();
  const p = buildPrompt({ lugar: 'cocina', slot: 'yukiho:19', h: '19.5', t: '1' }).prompt;
  assert.match(p, /cooking a warm bowl of ramen/);
  assert.match(p, /young woman in her early twenties/);
  assert.match(p, /roommate is with her, seen from behind/);
  assert.equal(buildPrompt({ lugar: 'recamara', slot: 'yukiho:0', h: '1' }).error, 'este lugar no se ilustra');
  assert.ok(buildPrompt({ lugar: 'cocina; nude', h: '3' }).error);
  assert.ok(buildPrompt({ lugar: 'cocina', h: '30' }).error);
  assert.match(buildPrompt({ lugar: 'cafeteria.barra', n: 'Barra <script>', h: '9' }).prompt, /Barra script/);
});

test('migrated university ids still get the right activity', () => {
  const { buildPrompt } = load();
  assert.match(buildPrompt({ lugar: 'universidad.biblioteca', slot: 'yukiho:14', h: '14.5' }).prompt, /library/);
});

const { createLedger } = require('../api/_lib/ledger.js');
const { createMemoryStore, _setLedger } = require('../api/_lib/stores.js');

// Escena pagada por adelantado en un libro mayor en memoria.
async function paidLedger(query, ticket = 'T'.repeat(32), balance = 10) {
  const { normalizeSceneQuery } = load();
  const store = createMemoryStore({ 'wallets/u1': { balance, owned: {} } });
  const ledger = createLedger(store);
  _setLedger(ledger);
  await ledger.payScene('u1', '', ticket, normalizeSceneQuery(query).canonical);
  return { ledger, store, ticket };
}

test('rejects calls without key, from other sites, unpaid, or too fast; returns the image with long cache', async () => {
  const handler = load();
  const q = { lugar: 'cocina', slot: 'yukiho:7', h: '7.5', s: '42' };
  const { ticket } = await paidLedger(q);
  delete process.env.POLLINATIONS_KEY;
  let res = mockRes(); await handler(req({ ...q, tk: ticket }), res);
  assert.equal(res.statusCode, 503);

  process.env.POLLINATIONS_KEY = 'sk_test';
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } }); };

  res = mockRes(); await handler(req({ ...q, tk: ticket }, { referer: 'https://evil.example/' }), res);
  assert.equal(res.statusCode, 403);

  res = mockRes(); await handler(req(q, { ip: '9.9.9.9' }), res);
  assert.equal(res.statusCode, 402, 'sin boleto no se pinta');
  res = mockRes(); await handler(req({ ...q, s: '43', tk: ticket }, { ip: '9.9.9.9' }), res);
  assert.equal(res.statusCode, 402, 'el boleto no sirve para otra escena');
  res = mockRes(); await handler(req({ ...q, tk: 'X'.repeat(32) }, { ip: '9.9.9.9' }), res);
  assert.equal(res.statusCode, 402, 'boleto inventado');
  assert.equal(calls.length, 0);

  res = mockRes(); await handler(req({ ...q, tk: ticket }, { ip: '9.9.9.9' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/jpeg');
  assert.match(res.headers['cache-control'], /immutable/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/gen\.pollinations\.ai\/image\//);
  assert.match(calls[0].url, /safe=sexual/);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer sk_test');

  res = mockRes(); await handler(req({ ...q, tk: ticket }, { ip: '9.9.9.9' }), res);
  assert.equal(res.statusCode, 429);
});

test('a failed generation does not consume the turn, and the third failure refunds the AMR', async () => {
  const handler = load();
  process.env.POLLINATIONS_KEY = 'sk_test';
  const q = { lugar: 'cocina', h: '8' };
  const { store, ticket } = await paidLedger(q, 'R'.repeat(32), 10);
  assert.equal(store.docs.get('wallets/u1').balance, 8);
  global.fetch = async () => new Response('{"error":"no pollen"}', { status: 402, headers: { 'content-type': 'application/json' } });
  for (let i = 0; i < 2; i++) {
    const res = mockRes(); await handler(req({ ...q, tk: ticket }, { ip: '7.7.7.7' }), res);
    assert.equal(res.statusCode, 502);
  }
  assert.equal(store.docs.get('wallets/u1').balance, 8, 'dos fallas todavía no reembolsan');
  global.fetch = async () => new Response(Buffer.from([1]), { status: 200, headers: { 'content-type': 'image/png' } });
  let res = mockRes(); await handler(req({ ...q, tk: ticket }, { ip: '7.7.7.7' }), res);
  assert.equal(res.statusCode, 200, 'el fallo no gastó el turno de 20 s');

  const other = await paidLedger(q, 'S'.repeat(32), 10);
  global.fetch = async () => new Response('x', { status: 500 });
  for (let i = 0; i < 3; i++) { res = mockRes(); await handler(req({ ...q, tk: other.ticket }, { ip: '6.6.6.6' }), res); }
  assert.equal(other.store.docs.get('wallets/u1').balance, 10, 'tercera falla regresa los 2 AMR');
  assert.equal(other.store.docs.get(`scenes/${other.ticket}`).status, 'refunded');
  res = mockRes(); await handler(req({ ...q, tk: other.ticket }, { ip: '5.5.5.5' }), res);
  assert.equal(res.statusCode, 402, 'un boleto reembolsado ya no pinta');
});
