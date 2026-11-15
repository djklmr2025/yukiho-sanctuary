/*
 * ARKAIOS · /api/wallet — la única puerta para mover AMR del juego de Yukiho.
 *   POST {op:'login', credential}        token de Google (GIS) -> {session, wallet}
 *   GET                                  saldo (Authorization: Bearer <session>)
 *   POST {op:'daily'}                    bono diario (+5, +25 cada 7 días de racha), una vez por día (hora de Cancún)
 *   POST {op:'buy', item}                tómbola / vestidor / ruta (precios en ledger.js CATALOG)
 *   POST {op:'redeem', code}             código de recarga de un uso por jugador (scripts/amr-codes.js)
 *   POST {op:'scene', scene:{lugar,slot,h,t,s,n}}  cobra 2 AMR y devuelve la URL de /api/escena con su boleto
 * Variables: FIREBASE_SERVICE_ACCOUNT (proyecto yukiho-ledger), LEDGER_SECRET, LEDGER_DATABASE (opcional), GOOGLE_CLIENT_ID (opcional).
 */
const { LedgerError } = require('./_lib/ledger.js');
const { getLedger } = require('./_lib/stores.js');
const { signSession, sessionFrom, sceneTicket, verifyGoogleCredential } = require('./_lib/session.js');
const { fail, allowedCaller, clientIp, createLimiter } = require('./_lib/http.js');
const escena = require('./escena.js');
const { publicCatalog } = require('./_lib/specials.js');
const { publicAlbums } = require('./_lib/albums.js');

const perIp = createLimiter(60, 60000);
const redeemPerUser = createLimiter(5, 600000);

const ledger = getLedger;

async function route(req, body) {
  if (req.method === 'POST' && body.op === 'login') {
    const who = await verifyGoogleCredential(body.credential);
    if (!who) throw new LedgerError(401, 'No se pudo verificar tu cuenta de Google.');
    const wallet = await ledger().getWallet(who.uid, who.email);
    return { session: signSession(who), wallet };
  }
  const s = sessionFrom(req);
  if (!s) throw new LedgerError(401, 'Inicia sesión con Google para usar AMR.');
  if (req.method === 'GET') return { wallet: await ledger().getWallet(s.uid, s.email), especiales: publicCatalog(), albumes: publicAlbums() };
  switch (body.op) {
    case 'daily': return { wallet: await ledger().claimDaily(s.uid, s.email) };
    case 'buy': return { wallet: await ledger().buy(s.uid, s.email, String(body.item || '')) };
    case 'redeem':
      if (redeemPerUser(s.uid)) throw new LedgerError(429, 'Demasiados intentos; espera unos minutos.');
      return { wallet: await ledger().redeem(s.uid, s.email, body.code) };
    case 'scene': {
      const q = escena.normalizeSceneQuery(body.scene || {});
      if (q.error) throw new LedgerError(422, q.error);
      const ticket = sceneTicket(s.uid, q.canonical);
      const wallet = await ledger().payScene(s.uid, s.email, ticket, q.canonical);
      return { wallet, url: `/api/escena?${q.params}&tk=${ticket}` };
    }
    case 'special': {
      const q = escena.normalizeSceneQuery({ esp: String(body.id || ''), s: body.s });
      if (q.error) throw new LedgerError(422, q.error);
      const ticket = sceneTicket(s.uid, q.canonical);
      const wallet = await ledger().payScene(s.uid, s.email, ticket, q.canonical, {
        cost: q.special.precio, requires: q.special.requiere, reason: `escena especial ${q.special.id}`,
      });
      return { wallet, url: `/api/escena?${q.params}&tk=${ticket}`, titulo: q.special.titulo };
    }
    default: throw new LedgerError(422, 'operación desconocida');
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'método no permitido');
  if (!allowedCaller(req)) return fail(res, 403, 'origen no permitido');
  if (perIp(clientIp(req))) return fail(res, 429, 'demasiadas solicitudes');
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return fail(res, 400, 'JSON inválido'); } }
  try {
    const out = await route(req, body);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(out);
  } catch (err) {
    if (err instanceof LedgerError) return fail(res, err.status, err.message);
    console.error('wallet', err && err.message);
    return fail(res, 503, 'La billetera no está disponible ahora; intenta más tarde.');
  }
};
