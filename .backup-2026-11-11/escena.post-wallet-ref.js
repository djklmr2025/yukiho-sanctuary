/*
 * ARKAIOS · /api/escena — pinta una escena de la vida de Yukiho con un modelo de pago de Pollinations.
 * La llave vive solo aquí (variable de entorno POLLINATIONS_KEY en Vercel); nunca llega al navegador.
 * El navegador NO manda texto libre: manda el lugar, la franja de la rutina, la hora y una semilla, y el
 * prompt se arma aquí con la ficha adulta de life-routine.js (recámaras y baños no se ilustran).
 *
 * GET /api/escena?lugar=cocina&slot=yukiho:19&h=19.50&t=1&s=12345[&n=Nombre del cuarto]&tk=<boleto>
 * El boleto lo entrega /api/wallet (op 'scene') después de cobrar 2 AMR en el servidor; sin boleto pagado no se pinta.
 * Variables opcionales: SCENE_MODEL (modelo), YUKIHO_REF_URL (imagen de referencia de la cara).
 */
const LR = require('../assets/apartment/life-routine.js');

const { fail, allowedCaller, clientIp } = require('./_lib/http.js');
const { getLedger } = require('./_lib/stores.js');

const MODEL = process.env.SCENE_MODEL || 'black-forest-labs/flux.2-klein-4b';
const MIN_GAP_MS = 20000;          // una escena nueva cada 20 s por IP (las ya pintadas salen de la caché)
const SIZE = { w: 576, h: 768 };
const PLACE_RE = /^[a-z0-9_]{1,24}(\.[a-z0-9_]{1,24})?$/;
const SLOT_RE = /^(yukiho:\d{1,2})?$/;
const TICKET_RE = /^[A-Za-z0-9_-]{32}$/;
const lastByIp = new Map();

// Actividad de la rutina para ese lugar (en inglés, para el modelo).
function activityFor(slot, lugar) {
  const m = /^yukiho:(\d{1,2})$/.exec(String(slot || ''));
  const day = LR.ROUTINES.yukiho.find((s) => m && s.de === Number(m[1]));
  if (!day) return 'sharing a quiet moment';
  const room = lugar.split('.').pop();
  const hit = day.opciones.find((o) => o.donde === lugar || o.donde.split('.').pop() === room);
  return (hit || day.opciones[0]).en;
}

const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} .,()-]/gu, '').slice(0, 60);

function buildPrompt(q) {
  const lugar = String(q.lugar || '');
  if (!PLACE_RE.test(lugar)) return { error: 'lugar inválido' };
  const hour = Number(q.h);
  if (!Number.isFinite(hour) || hour < 0 || hour >= 24) return { error: 'hora inválida' };
  const prompt = LR.scenePrompt({ key: lugar, placeName: cleanName(q.n), en: activityFor(q.slot, lugar), hour, together: q.t === '1' });
  return prompt ? { prompt } : { error: 'este lugar no se ilustra' };
}

// Forma única de una escena: lo que se cobra es exactamente lo que se pinta.
function normalizeSceneQuery(q) {
  const lugar = String(q.lugar || '');
  const slot = String(q.slot || '');
  if (!SLOT_RE.test(slot)) return { error: 'franja inválida' };
  const h = Number(q.h);
  const t = q.t === true || q.t === '1' ? '1' : '0';
  const s = Math.abs(Number.parseInt(q.s, 10) || 0) % 2147483647;
  const n = cleanName(q.n);
  const built = buildPrompt({ lugar, slot, h, t, n });
  if (built.error) return built;
  const p = new URLSearchParams({ lugar, slot, h: h.toFixed(2), t, s: String(s) });
  if (n) p.set('n', n);
  return { canonical: p.toString(), params: p.toString(), prompt: built.prompt, seed: s };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'solo GET');
  const key = process.env.POLLINATIONS_KEY;
  if (!key) return fail(res, 503, 'el servidor no tiene llave de imágenes');
  if (!allowedCaller(req)) return fail(res, 403, 'origen no permitido');

  const query = req.query || {};
  const q = normalizeSceneQuery(query);
  if (q.error) return fail(res, 422, q.error);
  const ticket = String(query.tk || '');
  if (!TICKET_RE.test(ticket)) return fail(res, 402, 'esta escena no está pagada');

  const ledger = getLedger();
  let paid;
  try { paid = await ledger.sceneTicket(ticket); } catch (err) {
    console.error('ledger', err && err.message);
    return fail(res, 503, 'la billetera no está disponible');
  }
  if (!paid || paid.status !== 'paid' || paid.query !== q.canonical) return fail(res, 402, 'esta escena no está pagada');

  const ip = clientIp(req);
  const now = Date.now();
  if (now - (lastByIp.get(ip) || 0) < MIN_GAP_MS) return fail(res, 429, 'espera unos segundos entre escenas');
  lastByIp.set(ip, now);

  const failed = async () => {
    lastByIp.delete(ip);   // un fallo no consume el turno del jugador
    try { await ledger.sceneFailed(ticket); } catch (err) { console.error('ledger refund', err && err.message); }
    return fail(res, 502, 'el servicio de imágenes no respondió');
  };

  const params = new URLSearchParams({ model: MODEL, width: String(SIZE.w), height: String(SIZE.h), seed: String(q.seed), safe: 'sexual' });
  if (process.env.YUKIHO_REF_URL) params.set('image', process.env.YUKIHO_REF_URL);
  const url = `https://gen.pollinations.ai/image/${encodeURIComponent(q.prompt)}?${params}`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) {
      console.error('pollinations', r.status, (await r.text()).slice(0, 300));
      return failed();
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('pollinations fetch', err && err.message);
    return failed();
  }
};

module.exports.buildPrompt = buildPrompt;
module.exports.normalizeSceneQuery = normalizeSceneQuery;
module.exports.allowedCaller = allowedCaller;
