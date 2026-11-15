/*
 * ARKAIOS · Vida propia de los personajes: horario del día (hora de Cancún) y cómo se ilustra cada momento.
 * Funciones puras (navegador: window.LifeRoutine · Node: module.exports) para que se puedan probar.
 * Cada franja tiene lugares en orden de preferencia: se usa el primero que ya exista en el mapa
 * (la universidad o el hotel solo cuentan cuando la historia ya los creó).
 */
(function (root) {
  const MA = (typeof module !== 'undefined' && module.exports) ? require('./map-actions.js') : root.MapActions;
  const TIME_ZONE = 'America/Cancun';

  // Ficha visual fija de Yukiho: adulta, universitaria, ropa casual. Es la base de todas las escenas.
  // Ojo: "Japanese", "student" o "80s TV anime" hacen que el modelo gratis pinte uniforme escolar. No usarlos aquí.
  // Sin nombre ni edad exacta: el filtro de Pollinations marca nombres propios (privacy) y "adult"/"clothed" (sexual).
  const YUKIHO_LOOK = 'a young woman in her early twenties with long straight black hair and green eyes, wearing a cream knit cardigan and long blue jeans';
  const COMPANION = 'Her roommate is with her, seen from behind.';
  const STYLE = 'Slice of life, cozy everyday moment, warm cinematic lighting, detailed background, city pop color palette';

  const S = (de, a, opciones) => ({ de, a, opciones });
  const O = (donde, actividad, en) => ({ donde, actividad, en });
  const ROUTINES = {
    yukiho: [
      S(0, 7, [O('recamara', 'duerme tranquila', 'sleeping peacefully under a soft blanket')]),
      S(7, 8, [O('cocina', 'desayuna pan dulce con café', 'having breakfast with Mexican sweet bread and coffee')]),
      S(8, 9, [O('recamara', 'se arregla para ir a la universidad', 'packing her tote bag and notebooks for university')]),
      S(9, 14, [O('universidad.salon', 'toma clases en la universidad', 'taking notes during a university lecture'), O('sala', 'estudia en la sala', 'studying with books on the living room table')]),
      S(14, 15, [O('universidad.biblioteca', 'estudia en la biblioteca', 'reading quietly in the university library'), O('sala', 'lee en el sofá', 'reading a book on the sofa')]),
      S(15, 16, [O('cocina', 'come algo ligero', 'eating a light lunch')]),
      S(16, 17, [O('planta_baja.tiendita', 'compra pan dulce y botanas en la tiendita', 'buying sweet bread and chips at a tiny corner shop'), O('planta_baja.maquinas', 'saca una bebida de la máquina expendedora', 'getting a warm drink from a vending machine'), O('cocina', 'prepara un té', 'making tea')]),
      S(17, 19, [O('terraza', 'riega las plantas y mira el cielo', 'watering potted plants on the balcony at sunset')]),
      S(19, 21, [O('cocina', 'prepara ramen para cenar', 'cooking a warm bowl of ramen for dinner')]),
      S(21, 23, [O('sala', 'escribe en su cuaderno de poemas', 'writing poems in her notebook by lamplight')]),
      S(23, 24, [O('recamara', 'se prepara para dormir', 'getting ready for bed, reading under a warm lamp')]),
    ],
    jugador: [
      S(0, 7, [O('sala', 'duerme en el sofá', 'sleeping on the sofa')]),
      S(7, 8, [O('cocina', 'desayuna', 'having breakfast')]),
      S(8, 17, [O('hotel.oficina', 'trabaja en el hotel', 'working at the hotel office'), O('sala', 'trabaja desde casa', 'working on a laptop at home')]),
      S(17, 19, [O('sala', 'descansa al volver del trabajo', 'resting after work')]),
      S(19, 21, [O('cocina', 'cocina para los dos', 'cooking dinner')]),
      S(21, 24, [O('sala', 've la lluvia desde la sala', 'watching the rain')]),
    ],
  };

  // Lugares en inglés para el generador de imágenes. Los baños y la azotehuela no se ilustran.
  const PLACE_EN = {
    sala: 'a cozy apartment living room with a teal sofa and warm lamps', cocina: 'a small warm apartment kitchen with a red kettle',
    recamara: 'a cozy bedroom with purple sheets and a bedside lamp', terraza: 'an apartment balcony terrace full of potted plants overlooking Cancun',
    'planta_baja.maquinas': 'a building lobby corner with glowing Japanese-style vending machines', 'planta_baja.tiendita': 'a tiny corner shop with Mexican sweet bread and colorful chip bags',
    'planta_baja.vestibulo': 'a marble apartment building lobby with mailboxes', 'planta_baja.entrada': 'the entrance of an apartment building with flower pots',
    'hotel.lobby': 'a bright beachfront hotel lobby in the Cancun hotel zone', 'hotel.oficina': 'a hotel staff office with desks and computers',
    'hotel.alberca': 'a hotel pool by the Caribbean beach with palm trees', 'hotel.pasillo': 'a hotel hallway', 'hotel.habitacion': 'a tidy hotel guest room',
    'universidad.salon': 'a university lecture classroom', 'universidad.biblioteca': 'a quiet university library with tall bookshelves',
    'universidad.patio': 'a green university campus garden with trees', 'universidad.pasillo': 'a university hallway with lockers',
  };
  // Recámaras y baños nunca se ilustran: el modelo gratis tiende a poses sugerentes ahí, aunque el prompt sea inocente.
  const NO_SCENE = new Set(['bano_recamara', 'bano_tina', 'azotehuela', 'recamara', 'habitacion']);

  function hourIn(date = new Date(), timeZone = TIME_ZONE) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    return get('hour') + get('minute') / 60;
  }

  // Lugar de la rutina que ya existe en el mapa (nunca crea áreas: eso le toca a la historia).
  function routineFor(world, who, hour) {
    const day = ROUTINES[who] || [];
    const h = ((hour % 24) + 24) % 24;
    const slot = day.find((s) => h >= s.de && h < s.a) || day[0];
    for (const o of slot.opciones) {
      const p = MA.resolvePlace(world, o.donde);
      if (p && !p.falta) return { slot: `${who}:${slot.de}`, key: p.key, actividad: o.actividad, en: o.en };
    }
    return null;
  }

  function lightFor(hour) {
    if (hour < 6 || hour >= 19) return 'at night, with warm lamps and gentle tropical rain on the windows';
    if (hour < 9) return 'in soft early morning light';
    if (hour < 17) return 'in bright tropical daylight';
    return 'at golden hour sunset';
  }

  function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h) % 1000000; }

  // Prompt de una escena. null si el lugar no se ilustra o es un momento privado.
  function scenePrompt({ key, placeName, en, hour, together, private: isPrivate }) {
    if (!key || isPrivate) return null;
    const room = String(key).split('.').pop();
    if (NO_SCENE.has(key) || NO_SCENE.has(room)) return null;
    const place = PLACE_EN[key] || `${placeName || room}, a place in Cancun`;
    // La escena va primero: si el personaje va primero, el modelo pinta un retrato e ignora el lugar.
    return `2D anime illustration, cel shading, wide shot of ${place} ${lightFor(hour)}, Cancun Mexico. In the scene, ${YUKIHO_LOOK}, is ${en || 'sharing a quiet moment'}. ${together ? COMPANION + ' ' : ''}${STYLE}`;
  }

  function sceneUrl(prompt, seedText, size = { w: 576, h: 768 }) {
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${size.w}&height=${size.h}&model=flux&nologo=true&seed=${hash(seedText || prompt)}`;
  }

  const api = { TIME_ZONE, ROUTINES, YUKIHO_LOOK, hourIn, routineFor, scenePrompt, sceneUrl, lightFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LifeRoutine = api;
})(typeof window !== 'undefined' ? window : globalThis);
