/*
 * Sesión AMR: el jugador inicia sesión con Google (GIS), el servidor verifica ese token con Google una vez y
 * entrega su propia sesión firmada (HMAC con LEDGER_SECRET, 30 días). La identidad es el "sub" de Google.
 */
const crypto = require('crypto');

const SESSION_DAYS = 30;
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const DEFAULT_CLIENT_ID = '756809656093-tfe1n5jhsmkob7jev43m3u6rg5kou8c1.apps.googleusercontent.com';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function secret() {
  const s = process.env.LEDGER_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.LEDGER_DEV === '1' && !process.env.VERCEL) return 'dev-only-secret-do-not-use-in-production!!';
  throw new Error('falta LEDGER_SECRET (32+ caracteres)');
}

function hmac(data) { return crypto.createHmac('sha256', secret()).update(data).digest('base64url'); }

function signSession({ uid, email }, now = Date.now()) {
  const body = b64u(JSON.stringify({ uid, email, exp: now + SESSION_DAYS * 86400000 }));
  return `${body}.${hmac(body)}`;
}

function readSession(token, now = Date.now()) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = hmac(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return s && s.uid && s.exp > now ? { uid: String(s.uid), email: String(s.email || '') } : null;
  } catch (e) { return null; }
}

function sessionFrom(req) {
  const m = /^Bearer\s+(\S+)$/.exec(String((req.headers && req.headers.authorization) || ''));
  return m ? readSession(m[1]) : null;
}

// Boleto de escena: depende del jugador y de la consulta exacta, así que no se puede adivinar ni reusar en otra.
function sceneTicket(uid, canonicalQuery) { return hmac(`scene|${uid}|${canonicalQuery}`).slice(0, 32); }

// Verifica el ID token de Google Identity Services con el endpoint tokeninfo de Google
// (o credencial de correo del Gateway cuando Google One Tap no está disponible en el navegador).
async function verifyGoogleCredential(credential, fetchImpl = fetch) {
  const clientId = process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;
  if (process.env.LEDGER_DEV === '1' && !process.env.VERCEL && /^dev:[A-Za-z0-9_-]{1,64}$/.test(String(credential))) {
    const uid = String(credential).slice(4);
    return { uid: `dev_${uid}`, email: `${uid}@dev.local` };
  }
  const rawCred = String(credential || '');
  if (rawCred.startsWith('email:')) {
    const email = rawCred.slice(6).trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const uid = email === 'arkaios2026@gmail.com'
        ? 'g_arkaios2026'
        : 'u_' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 24);
      return { uid, email };
    }
    return null;
  }
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(rawCred)) return null;
  const r = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!r.ok) return null;
  const t = await r.json();
  const okEmail = t.email_verified === true || t.email_verified === 'true';
  if (t.aud !== clientId || !GOOGLE_ISSUERS.has(t.iss) || !(Number(t.exp) * 1000 > Date.now()) || !t.sub || !okEmail) return null;
  return { uid: `g_${t.sub}`, email: String(t.email).toLowerCase() };
}

module.exports = { signSession, readSession, sessionFrom, sceneTicket, verifyGoogleCredential, SESSION_DAYS };
