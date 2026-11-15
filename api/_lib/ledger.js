/*
 * ARKAIOS · Libro mayor de AMR del juego de Yukiho (1 AMR = 1 MXN dentro del juego).
 * Lógica pura sobre un "store" transaccional (memoria en pruebas, Firestore en Vercel). El navegador nunca
 * escribe saldos: solo pide operaciones y el servidor decide.
 *
 * Documentos:
 *   wallets/{uid}            { balance, email, streak, lastDaily, owned: {itemId: true}, createdAt, updatedAt }
 *   wallets/{uid}/tx/{id}    movimiento (amount +/-, reason, at)
 *   legacy/{legacyDocId}     saldo importado una sola vez del sistema viejo (lo llena scripts/import-legacy.js)
 *   codes/{CODE}             { amount, usesLeft, redeemedBy: {uid: at} }
 *   scenes/{ticket}          { uid, query, status: paid|refunded, failures }
 */
const crypto = require('crypto');
const { albumItems } = require('./albums.js');

const START_BALANCE = 25;
const DAILY_BONUS = 5;
const STREAK_BONUS = 25;
const STREAK_EVERY = 7;
const SCENE_COST = 2;
const SCENE_MAX_FAILURES = 3;
const GAME_TZ = 'America/Cancun';

// Precios del bazar (deben coincidir con index.html; el servidor manda).
const CATALOG = Object.freeze({
  tombola_1: { price: 5 },
  tombola_10: { price: 45 },
  ruta_pasion: { price: 50, once: true },
  'outfit:bata_seda': { price: 15, once: true },
  'outfit:vestido_noche': { price: 25, once: true },
  'outfit:yukata_verano': { price: 30, once: true },
  'outfit:conjunto_caribeno': { price: 35, once: true },
  ...albumItems(),
});

const CODE_RE = /^[A-Z0-9-]{6,40}$/;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

class LedgerError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function dayIn(date, tz = GAME_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function previousDay(day) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Mismo id que usaba el navegador para users/{docId} (index.html getCloudDocId).
function legacyDocId(email) {
  const clean = String(email || 'guest').toLowerCase().trim();
  return 'usr_' + Buffer.from(clean, 'utf8').toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
}

function normalizeCode(code) {
  const c = String(code || '').trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

function txId(now) { return `${now.getTime().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }

function createLedger(store, opts = {}) {
  const clock = opts.clock || (() => new Date());

  function checkUid(uid) { if (!UID_RE.test(String(uid || ''))) throw new LedgerError(401, 'sesión inválida'); }

  // Lee la cartera; si no existe la arma (importando el saldo viejo una sola vez). Todo dentro de la transacción.
  async function readWallet(tx, uid, email) {
    const w = await tx.get(`wallets/${uid}`);
    if (w) return { wallet: w, fresh: false };
    const legacyPath = email ? `legacy/${legacyDocId(email)}` : null;
    let legacy = legacyPath ? await tx.get(legacyPath) : null;
    // Sin foto previa: se consulta el saldo viejo una sola vez (queda marcado como reclamado al crear la cartera).
    if (!legacy && legacyPath && opts.legacyBalance) {
      const b = await opts.legacyBalance(email);
      if (Number.isFinite(b)) legacy = { balance: b, email, source: 'arkaios-world' };
    }
    const imported = legacy && !legacy.claimedBy && Number.isFinite(legacy.balance) && legacy.balance >= 0 ? Math.floor(legacy.balance) : null;
    const now = clock().toISOString();
    return {
      fresh: true,
      legacyPath: imported !== null ? legacyPath : null,
      legacyDoc: legacy,
      wallet: { balance: imported !== null ? imported : START_BALANCE, email: email || '', streak: 0, lastDaily: '', owned: {}, createdAt: now, updatedAt: now },
      opening: imported !== null ? 'importado del sistema anterior' : 'saldo de bienvenida',
    };
  }

  function writeWallet(tx, uid, state, entries) {
    const now = clock();
    if (state.fresh) {
      tx.set(`wallets/${uid}/tx/${txId(now)}`, { amount: state.wallet.balance, reason: state.opening, at: now.toISOString() });
      if (state.legacyPath) tx.set(state.legacyPath, { ...state.legacyDoc, claimedBy: uid, claimedAt: now.toISOString() });
    }
    for (const e of entries) tx.set(`wallets/${uid}/tx/${txId(now)}`, { ...e, at: now.toISOString() });
    tx.set(`wallets/${uid}`, { ...state.wallet, updatedAt: now.toISOString() });
  }

  const openWallet = readWallet;

  const view = (w) => ({ balance: w.balance, streak: w.streak || 0, lastDaily: w.lastDaily || '', owned: Object.keys(w.owned || {}) });

  async function getWallet(uid, email) {
    checkUid(uid);
    return store.runTransaction(async (tx) => {
      const st = await openWallet(tx, uid, email);
      if (st.fresh) writeWallet(tx, uid, st, []);
      return view(st.wallet);
    });
  }

  async function claimDaily(uid, email) {
    checkUid(uid);
    const today = dayIn(clock());
    return store.runTransaction(async (tx) => {
      const st = await openWallet(tx, uid, email);
      const w = st.wallet;
      if (w.lastDaily === today) {
        if (st.fresh) writeWallet(tx, uid, st, []);
        return { granted: false, amount: 0, ...view(w) };
      }
      const streak = w.lastDaily === previousDay(today) ? (w.streak || 0) + 1 : 1;
      const amount = DAILY_BONUS + (streak % STREAK_EVERY === 0 ? STREAK_BONUS : 0);
      st.wallet = { ...w, balance: w.balance + amount, streak, lastDaily: today };
      writeWallet(tx, uid, st, [{ amount, reason: `bono diario (racha ${streak})` }]);
      return { granted: true, amount, ...view(st.wallet) };
    });
  }

  async function buy(uid, email, itemId) {
    checkUid(uid);
    const item = CATALOG[itemId];
    if (!item) throw new LedgerError(422, 'artículo desconocido');
    return store.runTransaction(async (tx) => {
      const st = await openWallet(tx, uid, email);
      const w = st.wallet;
      if (item.once && w.owned && w.owned[itemId]) {
        if (st.fresh) writeWallet(tx, uid, st, []);
        return { charged: 0, already: true, ...view(w) };
      }
      if (w.balance < item.price) throw new LedgerError(402, `Saldo insuficiente: tienes ${w.balance} AMR y cuesta ${item.price} AMR.`);
      const owned = item.once ? { ...(w.owned || {}), [itemId]: true } : (w.owned || {});
      st.wallet = { ...w, balance: w.balance - item.price, owned };
      writeWallet(tx, uid, st, [{ amount: -item.price, reason: `compra ${itemId}` }]);
      return { charged: item.price, already: false, ...view(st.wallet) };
    });
  }

  async function redeem(uid, email, rawCode) {
    checkUid(uid);
    const code = normalizeCode(rawCode);
    if (!code) throw new LedgerError(422, 'Código no reconocido.');
    return store.runTransaction(async (tx) => {
      const c = await tx.get(`codes/${code}`);
      const st = await openWallet(tx, uid, email);
      if (!c || !(c.usesLeft > 0) || !(c.amount > 0)) throw new LedgerError(404, 'Código no reconocido o agotado.');
      if (c.redeemedBy && c.redeemedBy[uid]) throw new LedgerError(409, 'Ya canjeaste este código.');
      const now = clock().toISOString();
      tx.set(`codes/${code}`, { ...c, usesLeft: c.usesLeft - 1, redeemedBy: { ...(c.redeemedBy || {}), [uid]: now } });
      st.wallet = { ...st.wallet, balance: st.wallet.balance + c.amount };
      writeWallet(tx, uid, st, [{ amount: c.amount, reason: `código ${code}` }]);
      return { amount: c.amount, ...view(st.wallet) };
    });
  }

  // Cobra una escena (una sola vez por uid + consulta) y devuelve el boleto que /api/escena acepta.
  // opts: { cost, requires (artículo que debe tener), reason }
  async function payScene(uid, email, ticket, query, opts = {}) {
    checkUid(uid);
    const cost = Number.isInteger(opts.cost) && opts.cost > 0 ? opts.cost : SCENE_COST;
    return store.runTransaction(async (tx) => {
      const sc = await tx.get(`scenes/${ticket}`);
      const st = await openWallet(tx, uid, email);
      if (sc && sc.status === 'paid') {
        if (st.fresh) writeWallet(tx, uid, st, []);
        return { ticket, charged: 0, ...view(st.wallet) };
      }
      if (opts.requires && !(st.wallet.owned || {})[opts.requires]) throw new LedgerError(403, 'Primero consigue ese atuendo en el vestidor.');
      if (st.wallet.balance < cost) throw new LedgerError(402, `Te faltan AMR: esta escena cuesta ${cost} AMR y tienes ${st.wallet.balance}.`);
      st.wallet = { ...st.wallet, balance: st.wallet.balance - cost };
      tx.set(`scenes/${ticket}`, { uid, query, cost, status: 'paid', failures: 0, at: clock().toISOString() });
      writeWallet(tx, uid, st, [{ amount: -cost, reason: opts.reason || 'escena pintada', ticket }]);
      return { ticket, charged: cost, ...view(st.wallet) };
    });
  }

  async function sceneTicket(ticket) {
    return store.runTransaction(async (tx) => tx.get(`scenes/${ticket}`));
  }

  // El servicio de imágenes falló: a la tercera falla se regresan los AMR y el boleto deja de valer.
  async function sceneFailed(ticket) {
    return store.runTransaction(async (tx) => {
      const sc = await tx.get(`scenes/${ticket}`);
      if (!sc || sc.status !== 'paid') return { refunded: false };
      const failures = (sc.failures || 0) + 1;
      if (failures < SCENE_MAX_FAILURES) {
        tx.set(`scenes/${ticket}`, { ...sc, failures });
        return { refunded: false, failures };
      }
      const st = await openWallet(tx, sc.uid, '');
      tx.set(`scenes/${ticket}`, { ...sc, failures, status: 'refunded' });
      const back = Number.isInteger(sc.cost) && sc.cost > 0 ? sc.cost : SCENE_COST;
      st.wallet = { ...st.wallet, balance: st.wallet.balance + back };
      writeWallet(tx, sc.uid, st, [{ amount: back, reason: 'reembolso de escena', ticket }]);
      return { refunded: true, failures };
    });
  }

  return { getWallet, claimDaily, buy, redeem, payScene, sceneTicket, sceneFailed };
}

module.exports = {
  createLedger, LedgerError, CATALOG, legacyDocId, normalizeCode, dayIn, previousDay,
  START_BALANCE, DAILY_BONUS, STREAK_BONUS, STREAK_EVERY, SCENE_COST, SCENE_MAX_FAILURES,
};
