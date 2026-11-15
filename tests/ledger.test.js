// node --test tests/ledger.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../api/_lib/ledger.js');
const { createMemoryStore } = require('../api/_lib/stores.js');

const at = (iso) => () => new Date(iso);
function setup(initial = {}, iso = '2026-11-11T18:00:00Z') {
  const store = createMemoryStore(initial);
  let now = iso;
  const ledger = L.createLedger(store, { clock: () => new Date(now) });
  return { store, ledger, setNow: (v) => { now = v; } };
}
const txs = (store, uid) => [...store.docs.entries()].filter(([k]) => k.startsWith(`wallets/${uid}/tx/`)).map(([, v]) => v);

test('new player gets 25 AMR; legacy balance is imported once without cap and claimed', async () => {
  const legacyId = L.legacyDocId('Ana@Mail.com ');
  assert.equal(legacyId, 'usr_' + Buffer.from('ana@mail.com').toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24));
  const { store, ledger } = setup({ [`legacy/${legacyId}`]: { balance: 340 } });

  assert.equal((await ledger.getWallet('u_new', 'otro@mail.com')).balance, L.START_BALANCE);
  assert.equal((await ledger.getWallet('u_ana', 'ana@mail.com')).balance, 340);
  assert.equal(store.docs.get(`legacy/${legacyId}`).claimedBy, 'u_ana');
  assert.equal(txs(store, 'u_ana')[0].amount, 340);

  // Otra cuenta con el mismo correo no puede volver a importar.
  assert.equal((await ledger.getWallet('u_ana2', 'ana@mail.com')).balance, L.START_BALANCE);
  // Reabrir no vuelve a sumar.
  assert.equal((await ledger.getWallet('u_ana', 'ana@mail.com')).balance, 340);
});

test('rejects malformed uids', async () => {
  const { ledger } = setup();
  await assert.rejects(ledger.getWallet('../x', ''), (e) => e.status === 401);
  await assert.rejects(ledger.getWallet('', ''), (e) => e.status === 401);
});

test('daily bonus once per Cancun day, streak +25 every 7th day, streak resets after a gap', async () => {
  const { ledger, setNow } = setup();
  const first = await ledger.claimDaily('u1', '');
  assert.deepEqual([first.granted, first.amount, first.balance, first.streak], [true, 5, 30, 1]);
  const again = await ledger.claimDaily('u1', '');
  assert.deepEqual([again.granted, again.balance], [false, 30]);

  // 23:30 hora de Cancún del mismo día (04:30Z del día siguiente) sigue siendo el mismo día.
  setNow('2026-11-12T04:30:00Z');
  assert.equal((await ledger.claimDaily('u1', '')).granted, false);

  let bal = 30;
  for (let d = 12; d <= 17; d++) {
    setNow(`2026-11-${d}T18:00:00Z`);
    const r = await ledger.claimDaily('u1', '');
    bal += r.amount;
    assert.equal(r.streak, d - 10);
  }
  assert.equal(bal, 30 + 5 * 6 + 25, 'el séptimo día da +25 extra');

  setNow('2026-11-20T18:00:00Z');
  assert.equal((await ledger.claimDaily('u1', '')).streak, 1);
});

test('buy charges server prices, blocks overdraft, and once-items are never charged twice', async () => {
  const { ledger, store } = setup({ 'wallets/u1': { balance: 60, owned: {} } });
  let r = await ledger.buy('u1', '', 'tombola_1');
  assert.deepEqual([r.charged, r.balance], [5, 55]);
  r = await ledger.buy('u1', '', 'ruta_pasion');
  assert.deepEqual([r.charged, r.balance, r.owned], [50, 5, ['ruta_pasion']]);
  r = await ledger.buy('u1', '', 'ruta_pasion');
  assert.deepEqual([r.charged, r.already, r.balance], [0, true, 5]);
  await assert.rejects(ledger.buy('u1', '', 'outfit:vestido_noche'), (e) => e.status === 402);
  await assert.rejects(ledger.buy('u1', '', 'outfit:gratis_hack'), (e) => e.status === 422);
  await assert.rejects(ledger.buy('u1', '', 'tombola_10'), (e) => e.status === 402);
  assert.equal(store.docs.get('wallets/u1').balance, 5);
});

test('concurrent spends cannot overdraw', async () => {
  const { ledger, store } = setup({ 'wallets/u1': { balance: 10, owned: {} } });
  const results = await Promise.allSettled([1, 2, 3].map(() => ledger.buy('u1', '', 'tombola_1')));
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 2);
  assert.equal(store.docs.get('wallets/u1').balance, 0);
});

test('redeem codes: only real codes, one use per player, uses run out', async () => {
  const { ledger, store } = setup({ 'codes/AMR-ABCD-1234': { amount: 100, usesLeft: 2, redeemedBy: {} } });
  await assert.rejects(ledger.redeem('u1', '', 'WELCOME-2025-3910'), (e) => e.status === 404);
  await assert.rejects(ledger.redeem('u1', '', 'x'), (e) => e.status === 422);
  await assert.rejects(ledger.redeem('u1', '', 'codes/../wallets'), (e) => e.status === 422);
  const r = await ledger.redeem('u1', '', ' amr-abcd-1234 ');
  assert.deepEqual([r.amount, r.balance], [100, 125]);
  await assert.rejects(ledger.redeem('u1', '', 'AMR-ABCD-1234'), (e) => e.status === 409);
  await ledger.redeem('u2', '', 'AMR-ABCD-1234');
  await assert.rejects(ledger.redeem('u3', '', 'AMR-ABCD-1234'), (e) => e.status === 404);
  assert.equal(store.docs.get('codes/AMR-ABCD-1234').usesLeft, 0);
});

test('payScene charges once per ticket and refunds only after 3 failures', async () => {
  const { ledger, store } = setup({ 'wallets/u1': { balance: 3, owned: {} } });
  const a = await ledger.payScene('u1', '', 'tkA', 'lugar=cocina');
  assert.deepEqual([a.charged, a.balance], [2, 1]);
  const again = await ledger.payScene('u1', '', 'tkA', 'lugar=cocina');
  assert.deepEqual([again.charged, again.balance], [0, 1], 'repetir la misma escena no cobra otra vez');
  await assert.rejects(ledger.payScene('u1', '', 'tkB', 'lugar=sala'), (e) => e.status === 402);
  assert.equal((await ledger.sceneFailed('tkA')).refunded, false);
  assert.equal((await ledger.sceneFailed('tkA')).refunded, false);
  assert.equal((await ledger.sceneFailed('tkA')).refunded, true);
  assert.equal((await ledger.sceneFailed('tkA')).refunded, false, 'no se reembolsa dos veces');
  assert.equal(store.docs.get('wallets/u1').balance, 3);
  assert.equal((await ledger.sceneFailed('nope')).refunded, false);
});

test('dayIn uses Cancun time', () => {
  assert.equal(L.dayIn(at('2026-11-12T04:59:00Z')()), '2026-11-11');
  assert.equal(L.dayIn(at('2026-11-12T05:00:00Z')()), '2026-11-12');
  assert.equal(L.previousDay('2026-03-01'), '2026-02-28');
});

test('lazy legacy import: reads the old balance once per email, never twice', async () => {
  const store = createMemoryStore();
  const asked = [];
  const ledger = L.createLedger(store, { legacyBalance: async (email) => { asked.push(email); return email === 'old@mail.com' ? 180 : null; } });
  assert.equal((await ledger.getWallet('u_old', 'old@mail.com')).balance, 180);
  assert.equal(store.docs.get(`legacy/${L.legacyDocId('old@mail.com')}`).claimedBy, 'u_old');
  assert.equal((await ledger.getWallet('u_other', 'old@mail.com')).balance, L.START_BALANCE, 'otra cuenta no reimporta');
  assert.equal((await ledger.getWallet('u_new', 'new@mail.com')).balance, L.START_BALANCE);
  await ledger.getWallet('u_old', 'old@mail.com');
  assert.deepEqual(asked, ['old@mail.com', 'new@mail.com'], 'solo se consulta al crear la cartera');
});

test('lazy legacy import: a network error fails instead of losing the import', async () => {
  const store = createMemoryStore();
  const ledger = L.createLedger(store, { legacyBalance: async () => { throw new Error('caído'); } });
  await assert.rejects(ledger.getWallet('u1', 'a@b.c'));
  assert.equal(store.docs.size, 0);
});

test('legacyBalance parses the old Firestore REST document', async () => {
  const { legacyBalance } = require('../api/_lib/stores.js');
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ fields: { amrBlue: { integerValue: '120' }, amrDorado: { doubleValue: 4.7 } } }) });
  assert.equal(await legacyBalance('x@y.z', ok), 124);
  assert.equal(await legacyBalance('x@y.z', async () => ({ ok: false, status: 404 })), null);
  await assert.rejects(legacyBalance('x@y.z', async () => ({ ok: false, status: 500 })));
  assert.equal(await legacyBalance('', ok), null);
});
