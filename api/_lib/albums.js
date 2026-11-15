/*
 * Álbumes de fotos: ilustraciones fijas que se desbloquean una vez con AMR (no se generan al vuelo, no gastan
 * llave de imágenes). Las fotos completas viven en /private-albums y solo las entrega /api/album a quien tiene
 * el álbum; el navegador solo ve miniaturas diminutas en assets/albums. Mismo acuerdo del juego: siempre con ropa.
 */
const path = require('path');

const PRIVATE_DIR = path.join(__dirname, '..', '..', 'private-albums');
const PHOTO_NUMBER_RE = /^\d{1,2}$/;

const ALBUMS = Object.freeze([
  {
    "id": "memorias_santuario",
    "titulo": "Memorias del Santuario y Tokio",
    "precio": 25,
    "fotos": [
      {
        "n": 1,
        "titulo": "Escaleras bajo la tormenta"
      },
      {
        "n": 2,
        "titulo": "Umbral y luz ámbar"
      },
      {
        "n": 3,
        "titulo": "Genkan y descanso"
      },
      {
        "n": 4,
        "titulo": "Té caliente en la cocina"
      },
      {
        "n": 5,
        "titulo": "Ventana empañada de lluvia"
      },
      {
        "n": 6,
        "titulo": "Rincón de poesía y caligrafía"
      },
      {
        "n": 7,
        "titulo": "Pasillo en penumbra"
      },
      {
        "n": 8,
        "titulo": "Balcón tras la tormenta"
      },
      {
        "n": 9,
        "titulo": "Amanecer dorado sobre Tokio"
      },
      {
        "n": 10,
        "titulo": "La Bóveda del Santuario"
      }
    ]
  },
  {
    id: 'tardes_cancun',
    titulo: 'Tardes en Cancún',
    precio: 20,
    fotos: [
      { n: 1, titulo: 'Terraza al atardecer' },
      { n: 2, titulo: 'Paseo por el malecón' },
      { n: 3, titulo: 'Versos en el café' },
      { n: 4, titulo: 'Mañana de mercado' },
      { n: 5, titulo: 'Playa dorada' },
      { n: 6, titulo: 'Lluvia y té' },
    ],
  },
]);

const byId = new Map(ALBUMS.map((a) => [a.id, a]));

const itemId = (albumId) => `album:${albumId}`;

function albumById(id) { return byId.get(String(id || '')) || null; }

// Artículos del bazar que representan cada álbum (los suma ledger.js a su CATALOG).
function albumItems() {
  return Object.fromEntries(ALBUMS.map((a) => [itemId(a.id), { price: a.precio, once: true }]));
}

// Ruta en disco de una foto completa, o null si el número no pertenece al álbum.
function photoFile(album, rawNumber) {
  if (!PHOTO_NUMBER_RE.test(String(rawNumber || ''))) return null;
  const foto = album.fotos.find((f) => f.n === Number(rawNumber));
  return foto ? path.join(PRIVATE_DIR, album.id, `${foto.n}.jpg`) : null;
}

// Lista pública para el navegador: títulos, precio y miniaturas (nunca la ruta de la foto completa).
function publicAlbums() {
  return ALBUMS.map((a) => ({
    id: a.id,
    titulo: a.titulo,
    precio: a.precio,
    item: itemId(a.id),
    fotos: a.fotos.map((f) => ({ n: f.n, titulo: f.titulo, mini: `assets/albums/${a.id}/${f.n}.jpg` })),
  }));
}

module.exports = { ALBUMS, albumById, albumItems, itemId, photoFile, publicAlbums };
