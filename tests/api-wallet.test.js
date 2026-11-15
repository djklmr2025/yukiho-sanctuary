// node --test tests/api-wallet.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LEDGER_SECRET = 'test-secret-0123456789-0123456789-abcdef';
process.env.POLLINATIONS_KEY = 'sk_test';
const { createLedger } = require('../api/_lib/ledger.js');
const { createMemoryStore, _setLedger } = require('../api/_lib/stores.js');
const session = require('../api/_lib/session.js');
const wallet = require('../api/wallet.js');
const escena = require('../api/escena.js');

function mockRes() {
  const res = { headers: {}, statusCode: 0, body: null };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  return res;
}
let ipN = 0;
async function call(method, body, token, extra = {}) {
  const headers = { referer: 'https://yukiho-sanctuary.vercel.app/', 'x-forwarded-for': `10.0.0.${++ipN % 250}`, ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = mockRes();
  await wallet({ method, body, headers, query: {} }, res);
  return res;
}
function fresh(initial) {
  const store = createMemoryStore(initial);
  _setLedger(createLedger(store));
  return store;
}

test('session tokens: signed, expiring, tamper-proof', () => {
  const t = session.signSession({ uid: 'g_1', email: 'a@b.c' });
  assert.deepEqual(session.readSession(t), { uid: 'g_1', email: 'a@b.c' });
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 'g_2', email: '', exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal(session.readSession(`${forged}.${sig}`), null);
  assert.equal(session.readSession(`${body}.${sig.slice(0, -2)}xx`), null);
  assert.equal(session.readSession(t, Date.now() + 31 * 86400000), null);
  assert.equal(session.readSession('garbage'), null);
});

test('Google credential is checked for audience, issuer, expiry and verified email', async () => {
  const good = { aud: '756809656093-tfe1n5jhsmkob7jev43m3u6rg5kou8c1.apps.googleusercontent.com', iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 600), sub: '123', email: 'Ana@Mail.com', email_verified: 'true' };
  const fake = (payload, ok = true) => async () => ({ ok, json: async () => payload });
  const jwt = 'aaa.bbb.ccc';
  assert.deepEqual(await session.verifyGoogleCredential(jwt, fake(good)), { uid: 'g_123', email: 'ana@mail.com' });
  assert.equal(await session.verifyGoogleCredential(jwt, fake({ ...good, aud: 'otra-app' })), null);
  assert.equal(await session.verifyGoogleCredential(jwt, fake({ ...good, iss: 'evil' })), null);
  assert.equal(await session.verifyGoogleCredential(jwt, fake({ ...good, exp: '1' })), null);
  assert.equal(await session.verifyGoogleCredential(jwt, fake({ ...good, email_verified: 'false' })), null);
  assert.equal(await session.verifyGoogleCredential(jwt, fake(good, false)), null);
  assert.equal(await session.verifyGoogleCredential('dev:ana', fake(good)), null, 'tokens de desarrollo no valen sin LEDGER_DEV');
});

test('wallet API: needs a session, never accepts a balance from the client', async () => {
  const store = fresh();
  assert.equal((await call('GET', {}, null)).statusCode, 401);
  assert.equal((await call('POST', { op: 'daily' }, 'x.y')).statusCode, 401);
  assert.equal((await call('GET', {}, null, { referer: 'https://evil.example/' })).statusCode, 403);

  const tok = session.signSession({ uid: 'g_9', email: 'nueve@mail.com' });
  let r = await call('GET', {}, tok);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.wallet.balance, 25);
  assert.equal(r.headers['cache-control'], 'no-store');

  r = await call('POST', { op: 'buy', item: 'tombola_1', price: 0, balance: 9999 }, tok);
  assert.equal(r.body.wallet.balance, 20);
  r = await call('POST', { op: 'daily' }, tok);
  assert.equal(r.body.wallet.granted, true);
  r = await call('POST', { op: 'daily' }, tok);
  assert.equal(r.body.wallet.granted, false);
  r = await call('POST', { op: 'redeem', code: 'WELCOME-2025' }, tok);
  assert.equal(r.statusCode, 404);
  r = await call('POST', { op: 'mint', amount: 100 }, tok);
  assert.equal(r.statusCode, 422);
  assert.equal(store.docs.get('wallets/g_9').balance, 25);
});

test('scene purchase returns a ticket URL that /api/escena accepts exactly once-charged', async () => {
  const store = fresh({ 'wallets/g_5': { balance: 2, owned: {} } });
  const tok = session.signSession({ uid: 'g_5', email: '' });
  const scene = { lugar: 'cocina', slot: 'yukiho:19', h: 19.5, t: true, s: 777, n: 'Cocina <b>' };
  let r = await call('POST', { op: 'scene', scene }, tok);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.wallet.balance, 0);
  const url = new URL(r.body.url, 'https://yukiho-sanctuary.vercel.app');
  assert.equal(url.pathname, '/api/escena');
  assert.match(url.searchParams.get('tk'), /^[A-Za-z0-9_-]{32}$/);
  assert.equal(url.searchParams.get('n'), 'Cocina b');

  r = await call('POST', { op: 'scene', scene }, tok);
  assert.equal(r.body.wallet.balance, 0, 'la misma escena no se cobra dos veces');
  r = await call('POST', { op: 'scene', scene: { ...scene, s: 778 } }, tok);
  assert.equal(r.statusCode, 402);
  r = await call('POST', { op: 'scene', scene: { lugar: 'recamara', h: 1 } }, tok);
  assert.equal(r.statusCode, 422, 'lugares privados no se cobran ni se pintan');

  global.fetch = async () => new Response(Buffer.from([1]), { status: 200, headers: { 'content-type': 'image/png' } });
  const res = mockRes();
  await escena({ method: 'GET', query: Object.fromEntries(url.searchParams), headers: { referer: 'https://yukiho-sanctuary.vercel.app/', 'x-forwarded-for': '4.4.4.4' } }, res);
  assert.equal(res.statusCode, 200);

  // Otro jugador no puede usar ese boleto para su propia consulta pero sí ver la misma imagen ya pagada.
  assert.equal(store.docs.get(`scenes/${url.searchParams.get('tk')}`).uid, 'g_5');
});

test('special scenes: server price, outfit requirement, reference face and clothed prompt', async () => {
  const store = fresh({ 'wallets/g_7': { balance: 12, owned: {} } });
  const tok = session.signSession({ uid: 'g_7', email: '' });

  let r = await call('GET', {}, tok);
  assert.ok(r.body.especiales.some((e) => e.id === 'cenote' && e.precio === 5));
  assert.ok(r.body.especiales.every((e) => !('escena' in e)), 'los prompts no salen al navegador');

  r = await call('POST', { op: 'special', id: 'cenote', s: 11, precio: 0 }, tok);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.wallet.balance, 7);
  assert.equal(r.body.titulo, 'Mañana en un cenote');
  r = await call('POST', { op: 'special', id: 'cenote', s: 11 }, tok);
  assert.equal(r.body.wallet.balance, 7, 'misma escena especial no se cobra otra vez');

  r = await call('POST', { op: 'special', id: 'yukata_fuegos', s: 1 }, tok);
  assert.equal(r.statusCode, 403, 'sin el yukata del vestidor no se puede');
  r = await call('POST', { op: 'special', id: 'desnudo', s: 1 }, tok);
  assert.equal(r.statusCode, 422);

  store.docs.set('wallets/g_7', { ...store.docs.get('wallets/g_7'), owned: { 'outfit:yukata_verano': true } });
  r = await call('POST', { op: 'special', id: 'yukata_fuegos', s: 2 }, tok);
  assert.equal(r.body.wallet.balance, 2);
  r = await call('POST', { op: 'special', id: 'retrato_sonrisa', s: 3 }, tok);
  assert.equal(r.statusCode, 402);

  const calls = [];
  global.fetch = async (url) => { calls.push(url); return new Response(Buffer.from([1]), { status: 200, headers: { 'content-type': 'image/png' } }); };
  const url = new URL(`https://yukiho-sanctuary.vercel.app${(await call('POST', { op: 'special', id: 'yukata_fuegos', s: 2 }, tok)).body.url}`);
  const res = mockRes();
  await escena({ method: 'GET', query: Object.fromEntries(url.searchParams), headers: { referer: 'https://yukiho-sanctuary.vercel.app/', 'x-forwarded-for': '3.3.3.3' } }, res);
  assert.equal(res.statusCode, 200);
  const gen = new URL(calls[0]);
  assert.equal(gen.searchParams.get('image'), 'https://yukiho-sanctuary.vercel.app/assets/images/yukiho_ref_face.jpg');
  assert.equal(gen.searchParams.get('safe'), 'sexual');
  assert.match(decodeURIComponent(gen.pathname), /yukata/);
});

test('every special prompt keeps her clothed and never names school', () => {
  const { SPECIALS, specialPrompt } = require('../api/_lib/specials.js');
  for (const s of SPECIALS) {
    const p = specialPrompt(s);
    assert.match(p, /wearing/, s.id);
    assert.doesNotMatch(p, /school|uniform|nude|naked|lingerie|bikini|swimsuit|sexy/i, s.id);
  }
});
