// node --test tests/api-album.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.LEDGER_SECRET = 'test-secret-0123456789-0123456789-abcdef';
process.env.POLLINATIONS_KEY = 'sk_test';
const { createLedger, CATALOG, START_BALANCE } = require('../api/_lib/ledger.js');
const { createMemoryStore, _setLedger } = require('../api/_lib/stores.js');
const session = require('../api/_lib/session.js');
const albums = require('../api/_lib/albums.js');
const wallet = require('../api/wallet.js');
const album = require('../api/album.js');

const ALBUM = albums.ALBUMS[0];
const ITEM = albums.itemId(ALBUM.id);
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function mockRes() {
  const res = { headers: {}, statusCode: 0, body: null };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  return res;
}
let ipN = 0;
function request(handler, method, { body, query = {}, token, headers = {} } = {}) {
  const all = { referer: 'https://yukiho-sanctuary.vercel.app/', 'x-forwarded-for': `10.1.0.${++ipN % 250}`, ...headers };
  if (token) all.authorization = `Bearer ${token}`;
  const res = mockRes();
  return handler({ method, body, headers: all, query }, res).then(() => res);
}
function freshPlayer(uid = 'g_album') {
  _setLedger(createLedger(createMemoryStore()));
  return session.signSession({ uid, email: `${uid}@mail.com` });
}
const photo = (token, a, f, headers) => request(album, 'GET', { token, query: { a, f }, headers });
const buyAlbum = (token) => request(wallet, 'POST', { token, body: { op: 'buy', item: ITEM } });

test('every album is a one-time bazaar item at its catalog price', () => {
  for (const a of albums.ALBUMS) {
    assert.deepEqual(CATALOG[albums.itemId(a.id)], { price: a.precio, once: true });
  }
});

test('every catalog photo has its full file and its public thumbnail on disk', () => {
  for (const a of albums.ALBUMS) {
    for (const f of a.fotos) {
      assert.ok(fs.existsSync(albums.photoFile(a, f.n)), `falta private-albums/${a.id}/${f.n}.jpg`);
      assert.ok(fs.existsSync(`${__dirname}/../assets/albums/${a.id}/${f.n}.jpg`), `falta la miniatura ${a.id}/${f.n}`);
    }
  }
});

test('public album list exposes titles and thumbnails but never the private path', async () => {
  const token = freshPlayer();
  const res = await request(wallet, 'GET', { token });
  assert.equal(res.statusCode, 200);
  const listed = res.body.albumes.find((a) => a.id === ALBUM.id);
  assert.equal(listed.precio, ALBUM.precio);
  assert.equal(listed.fotos.length, ALBUM.fotos.length);
  assert.ok(!JSON.stringify(res.body.albumes).includes('private-albums'));
});

test('a photo needs a session', async () => {
  freshPlayer();
  assert.equal((await photo(null, ALBUM.id, '1')).statusCode, 401);
});

test('a photo is refused until the album is unlocked', async () => {
  const token = freshPlayer();
  const res = await photo(token, ALBUM.id, '1');
  assert.equal(res.statusCode, 403);
  assert.ok(!Buffer.isBuffer(res.body));
});

test('unlocking charges once and then every photo of the album is served as JPEG', async () => {
  const token = freshPlayer();
  const bought = await buyAlbum(token);
  assert.equal(bought.body.wallet.balance, START_BALANCE - ALBUM.precio);
  assert.equal((await buyAlbum(token)).body.wallet.balance, START_BALANCE - ALBUM.precio, 'comprar dos veces no cobra dos veces');

  for (const f of ALBUM.fotos) {
    const res = await photo(token, ALBUM.id, String(f.n));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.match(res.headers['cache-control'], /private/);
    assert.deepEqual([...res.body.subarray(0, 3)], JPEG_MAGIC);
  }
});

test('one player unlocking does not unlock it for another', async () => {
  const store = createMemoryStore();
  _setLedger(createLedger(store));
  const owner = session.signSession({ uid: 'g_owner', email: 'owner@mail.com' });
  const other = session.signSession({ uid: 'g_other', email: 'other@mail.com' });
  await buyAlbum(owner);
  assert.equal((await photo(owner, ALBUM.id, '1')).statusCode, 200);
  assert.equal((await photo(other, ALBUM.id, '1')).statusCode, 403);
});

test('unknown albums, unknown photos and path tricks are 404', async () => {
  const token = freshPlayer();
  await buyAlbum(token);
  for (const [a, f] of [['nope', '1'], [ALBUM.id, '99'], [ALBUM.id, '../1'], [`../${ALBUM.id}`, '1'], [ALBUM.id, '1.jpg'], [ALBUM.id, '']]) {
    assert.equal((await photo(token, a, f)).statusCode, 404, `a=${a} f=${f}`);
  }
});

test('cross-site callers are refused', async () => {
  const token = freshPlayer();
  await buyAlbum(token);
  const res = await photo(token, ALBUM.id, '1', { 'sec-fetch-site': 'cross-site' });
  assert.equal(res.statusCode, 403);
});
