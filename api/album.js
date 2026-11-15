/*
 * ARKAIOS · /api/album — entrega una foto completa de un álbum solo a quien ya lo desbloqueó con AMR.
 * GET /api/album?a=<album>&f=<número>   (Authorization: Bearer <session>)
 * El álbum se compra con POST /api/wallet {op:'buy', item:'album:<id>'}; aquí solo se comprueba la propiedad.
 */
const fs = require('fs/promises');
const { getLedger } = require('./_lib/stores.js');
const { sessionFrom } = require('./_lib/session.js');
const { fail, allowedCaller, clientIp, createLimiter } = require('./_lib/http.js');
const { albumById, itemId, photoFile } = require('./_lib/albums.js');

const perIp = createLimiter(120, 60000);
const PHOTO_CACHE = 'private, max-age=86400';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'solo GET');
  if (!allowedCaller(req)) return fail(res, 403, 'origen no permitido');
  if (perIp(clientIp(req))) return fail(res, 429, 'demasiadas solicitudes');
  const session = sessionFrom(req);
  if (!session) return fail(res, 401, 'Inicia sesión con Google para ver tus álbumes.');

  const query = req.query || {};
  const album = albumById(query.a);
  const file = album && photoFile(album, query.f);
  if (!file) return fail(res, 404, 'esa foto no existe');

  let wallet;
  try { wallet = await getLedger().getWallet(session.uid, session.email); } catch (err) {
    console.error('album ledger', err && err.message);
    return fail(res, 503, 'La billetera no está disponible ahora; intenta más tarde.');
  }
  if (!wallet.owned.includes(itemId(album.id))) return fail(res, 403, 'Desbloquea este álbum para ver sus fotos.');

  try {
    const photo = await fs.readFile(file);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', PHOTO_CACHE);
    return res.status(200).send(photo);
  } catch (err) {
    console.error('album file', err && err.message);
    return fail(res, 500, 'No se pudo abrir la foto.');
  }
};
