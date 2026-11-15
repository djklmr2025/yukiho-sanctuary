/*
 * Escenas especiales de pago: momentos con Yukiho fuera de la rutina (lugares de Cancún, festividades, atuendos del
 * vestidor). El servidor arma el prompt; el navegador solo elige el id. Siempre con ropa y sin contenido sexual
 * (acuerdo del juego: lo íntimo es cortina y fundido a negro). Las de atuendo piden haberlo comprado en el vestidor.
 * Todas usan la cara de referencia (assets/images/yukiho_ref_face.jpg) para que sea la misma Yukiho del arte original.
 */
const FACE = 'the same young woman as in the reference image, in her early twenties, long straight black hair and green eyes';
const STYLE = 'Detailed 2D anime illustration, cel shading, cinematic composition, warm lighting, city pop color palette, high quality';

const SPECIALS = Object.freeze([
  { id: 'retrato_sonrisa', titulo: 'Retrato: sonrisa tranquila', precio: 5,
    escena: 'close-up portrait, she smiles softly by a sunny window, wearing a cream knit cardigan, steam from a cup of tea' },
  { id: 'malecon_atardecer', titulo: 'Atardecer en el Malecón Tajamar', precio: 5,
    escena: 'walking along the Malecon Tajamar boardwalk in Cancun at golden sunset, wearing a light blue summer dress and sandals, mangroves and lagoon behind her' },
  { id: 'mercado_28', titulo: 'Paseo por el Mercado 28', precio: 5,
    escena: 'browsing colorful Mexican handicrafts and papel picado at Mercado 28 in Cancun, wearing a white blouse and jeans, holding a small clay souvenir' },
  { id: 'cenote', titulo: 'Mañana en un cenote', precio: 5,
    escena: 'standing on a wooden deck inside a cenote near Cancun, sun rays through the cave opening into turquoise water, wearing a white linen shirt and a long green skirt' },
  { id: 'biblioteca', titulo: 'Estudiando en la biblioteca de la universidad', precio: 5,
    escena: 'studying at a university library table with notebooks and a laptop, wearing a grey hoodie, focused expression, late afternoon light' },
  { id: 'dia_muertos', titulo: 'Día de Muertos', precio: 6,
    escena: 'beside a Day of the Dead altar with marigold flowers, candles and pan de muerto, delicate catrina face paint, wearing an embroidered Mexican blouse' },
  { id: 'yukata_fuegos', titulo: 'Fuegos artificiales en yukata', precio: 5, requiere: 'outfit:yukata_verano',
    escena: 'at a summer night festival by the sea, wearing a navy summer yukata with flower print, fireworks over the water, paper lanterns' },
  { id: 'cena_terraza', titulo: 'Cena en la terraza con vestido de noche', precio: 5, requiere: 'outfit:vestido_noche',
    escena: 'at an elegant rooftop restaurant at night overlooking the Cancun hotel zone lights, wearing a long dark evening gown, candlelit table' },
  { id: 'playa_caribe', titulo: 'Paseo por la playa con conjunto caribeño', precio: 5, requiere: 'outfit:conjunto_caribeno',
    escena: 'walking barefoot along a white sand Caribbean beach in the morning, wearing a colorful Caribbean blouse and a flowing long skirt, turquoise sea and palm trees' },
]);

const byId = new Map(SPECIALS.map((s) => [s.id, s]));

function specialById(id) { return byId.get(String(id || '')) || null; }

function specialPrompt(s) {
  return `${STYLE}. ${s.escena.charAt(0).toUpperCase() + s.escena.slice(1)}. She is ${FACE}.`;
}

// Lista pública para el navegador (sin prompts).
function publicCatalog() {
  return SPECIALS.map(({ id, titulo, precio, requiere }) => ({ id, titulo, precio, requiere: requiere || null }));
}

module.exports = { SPECIALS, specialById, specialPrompt, publicCatalog };
