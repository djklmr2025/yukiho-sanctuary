// Utilidades HTTP compartidas por /api/escena y /api/wallet.
const ALLOWED_HOSTS = new Set(['yukiho-sanctuary.vercel.app', 'localhost', '127.0.0.1']);

function fail(res, status, message) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error: message });
}

function allowedCaller(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const from = req.headers.referer || req.headers.origin || '';
  try { return ALLOWED_HOSTS.has(new URL(from).hostname); } catch (e) { return false; }
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';

// Límite simple por llave en memoria (por instancia): max golpes por ventana.
function createLimiter(max, windowMs) {
  const hits = new Map();
  return function limited(key, now = Date.now()) {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.delete(hits.keys().next().value);
    return recent.length > max;
  };
}

module.exports = { fail, allowedCaller, clientIp, createLimiter, ALLOWED_HOSTS };
