/*
 * Servidor local para probar la billetera AMR sin Vercel ni Firestore:
 *   node scripts/dev-server.js            -> http://localhost:4411
 * Usa el libro mayor en memoria (LEDGER_DEV=1) y acepta credenciales "dev:<nombre>" en AmrWallet.login().
 * Las imágenes de escena son un PNG falso (no gasta la llave de Pollinations).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

process.env.LEDGER_DEV = '1';
delete process.env.VERCEL;
process.env.POLLINATIONS_KEY = 'dev-fake';
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4411);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const realFetch = global.fetch;
global.fetch = async (url, opts) => (String(url).startsWith('https://gen.pollinations.ai/')
  ? new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
  : realFetch(url, opts));

const routes = { '/api/wallet': require('../api/wallet.js'), '/api/escena': require('../api/escena.js'), '/api/album': require('../api/album.js') };
const PRIVATE_PREFIX = '/private-albums';   // igual que el redirect de vercel.json: nunca se sirve como archivo
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.json': 'application/json' };

function vercelRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); return res; };
  res.send = (b) => { res.end(b); return res; };
  return res;
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const api = routes[url.pathname];
  if (api) {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => {
      req.query = Object.fromEntries(url.searchParams);
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (e) { req.body = raw; }
      req.headers['x-forwarded-for'] = '127.0.0.1';
      Promise.resolve(api(req, vercelRes(res))).catch((e) => { res.statusCode = 500; res.end(String(e && e.message)); });
    });
    return;
  }
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || file.startsWith(path.join(ROOT, PRIVATE_PREFIX))) { res.statusCode = 403; return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Yukiho + billetera AMR (memoria) en http://localhost:${PORT}`));
