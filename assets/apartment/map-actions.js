/*
 * ARKAIOS · Acciones del mapa vivo: la IA de la historia devuelve "mapa": [ ... ] y aquí se validan contra
 * el catálogo (map-catalog.js) antes de tocar el mundo. Funciones puras: reciben un mundo y devuelven uno nuevo.
 *
 * Mundo persistido (userState.mapa):
 *   { v: 1, seq, areas: [{ id, plantilla, nombre, zona, cuartos? }], objetos: [{ uid, area, cuarto, objeto, x, y, w, h, nombre? }], quitados: [uid] }
 * El departamento existe siempre y no se guarda en "areas".
 *
 * Acciones aceptadas (máx. MAX_ACTIONS por turno; lo demás se ignora):
 *   { "accion": "crear_area", "plantilla": "planta_baja|hotel|universidad", "id"?, "nombre"? }
 *   { "accion": "crear_area", "plantilla": "personalizada", "id", "nombre", "zona", "cuartos": [{ "id", "nombre", "piso", "ancho", "alto", "exterior"? }] }
 *   { "accion": "colocar", "objeto": "<id del catálogo>", "donde": "<area>.<cuarto>", "x"?, "y"?, "ancho"?, "alto"?, "nombre"? }
 *   { "accion": "quitar", "objeto": "<id>", "donde": "<area>.<cuarto>" }
 */
(function (root) {
  const CAT = (typeof module !== 'undefined' && module.exports) ? require('./map-catalog.js') : root.MapCatalog;
  const { OBJ, TEMPLATES, FLOORS, ZONES } = CAT;

  const LIMITS = { MAX_ACTIONS: 8, MAX_AREAS: 10, MAX_OBJECTS: 120, MAX_ROOMS: 6, NAME: 40 };
  const HOME = 'departamento';
  const SLUG = /^[a-z][a-z0-9_]{1,23}$/;

  const emptyWorld = () => ({ v: 1, seq: 0, areas: [], objetos: [], quitados: [], privados: [] });
  const fold = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  const cleanText = (s, max = LIMITS.NAME) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>{}`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  const int = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

  // Partidas viejas: la "escuela" ahora es la universidad (mismos cuartos, mismo id de área).
  function migrateArea(a) {
    if (!a || typeof a !== 'object') return a;
    let out = a;
    if (a.plantilla === 'escuela') out = { ...out, plantilla: 'universidad', nombre: a.nombre === 'Escuela de Yukiho' ? TEMPLATES.universidad.nombre : a.nombre };
    if (out.zona === 'zona_escolar') out = { ...out, zona: 'zona_universitaria' };
    return out;
  }

  function sanitizeWorld(w) {
    if (!w || typeof w !== 'object' || w.v !== 1) return emptyWorld();
    return {
      v: 1, seq: int(w.seq, 0, 1e9, 0),
      areas: Array.isArray(w.areas) ? w.areas.map(migrateArea).filter((a) => a && SLUG.test(a.id) && (TEMPLATES[a.plantilla] || a.plantilla === 'personalizada')).slice(0, LIMITS.MAX_AREAS)
        .map((a) => (TEMPLATES[a.plantilla] ? { ...a, zona: TEMPLATES[a.plantilla].zona } : a)) : [],
      objetos: Array.isArray(w.objetos) ? w.objetos.filter((o) => o && OBJ[o.objeto]).slice(0, LIMITS.MAX_OBJECTS) : [],
      quitados: Array.isArray(w.quitados) ? w.quitados.filter((u) => typeof u === 'string').slice(0, 200) : [],
      privados: Array.isArray(w.privados) ? w.privados.filter((u) => typeof u === 'string').slice(0, 10) : [],
    };
  }

  // ---------- geometría ----------
  // Cuartos personalizados: se acomodan en filas (todas del mismo alto) con una puerta entre vecinos y otra hacia la fila de arriba.
  function layoutCustom(cuartos) {
    const rooms = {}, doors = [];
    const MAX_X = 30;
    let x = 1, y = 1, rowH = 0, row = [], prevRowFirst = null;
    const closeRow = () => {
      for (const r of row) r.h = rowH;
      for (let i = 1; i < row.length; i++) doors.push([row[i].x - 1, row[i].y + Math.floor(rowH / 2)]);
      if (prevRowFirst && row.length) doors.push([row[0].x + 1, row[0].y - 1]);
      if (row.length) prevRowFirst = row[0];
    };
    for (const c of cuartos) {
      if (x + c.ancho > MAX_X && row.length) { closeRow(); y += rowH + 1; x = 1; rowH = 0; row = []; }
      const r = { nombre: c.nombre, x, y, w: c.ancho, h: c.alto, piso: c.piso, exterior: !!c.exterior, id: c.id };
      rooms[c.id] = r; row.push(r); rowH = Math.max(rowH, c.alto); x += c.ancho + 1;
    }
    closeRow();
    let cols = 0, rowsN = 0;
    for (const r of Object.values(rooms)) {
      cols = Math.max(cols, r.x + r.w + 1); rowsN = Math.max(rowsN, r.y + r.h + 1);
      const cx = r.x + Math.max(0, Math.floor(r.w / 2) - 1), cy = r.y + Math.floor(r.h / 2);
      r.spots = { yukiho: [cx, cy], jugador: [Math.min(cx + 1, r.x + r.w - 1), cy] };
      delete r.id;
    }
    return { rooms, doors, cols: Math.max(cols, 10), rows: Math.max(rowsN, 6) };
  }

  function areaSpec(world, id) {
    if (id === HOME) return { id: HOME, plantilla: HOME, nombre: TEMPLATES[HOME].nombre, zona: 'edificio' };
    return world.areas.find((a) => a.id === id) || null;
  }

  function buildArea(spec) {
    let base;
    if (spec.plantilla === 'personalizada') {
      const lay = layoutCustom(spec.cuartos || []);
      base = { cols: lay.cols, rows: lay.rows, cuartos: lay.rooms, puertas: lay.doors, ventanas: [], muebles: [], descripcion: '' };
    } else {
      const t = TEMPLATES[spec.plantilla];
      base = { ...t, cuartos: Object.fromEntries(Object.entries(t.cuartos).map(([k, r]) => [k, { ...r, spots: { ...r.spots } }])) };
    }
    const builtins = base.muebles.map(([objeto, x, y, size], i) => {
      const o = OBJ[objeto];
      return { uid: `${spec.id}#${i}`, objeto, x, y, w: (size && size.w) || o.w, h: (size && size.h) || o.h, builtin: true };
    });
    return {
      id: spec.id, plantilla: spec.plantilla, nombre: spec.nombre, zona: spec.zona, descripcion: base.descripcion || '',
      cols: base.cols, rows: base.rows, rooms: base.cuartos, doors: base.puertas, windows: base.ventanas || [], glassWall: base.muroVidrio || null, builtins,
    };
  }

  // Área armada + objetos vivos + rejilla de paso.
  function geometry(world, areaId) {
    const spec = areaSpec(world, areaId);
    if (!spec) return null;
    const a = buildArea(spec);
    const gone = new Set(world.quitados);
    const placed = world.objetos.filter((o) => o.area === areaId).map((o) => ({ ...o, w: o.w || OBJ[o.objeto].w, h: o.h || OBJ[o.objeto].h }));
    a.items = a.builtins.filter((b) => !gone.has(b.uid)).concat(placed);
    a.grid = [];
    for (let y = 0; y < a.rows; y++) { a.grid[y] = []; for (let x = 0; x < a.cols; x++) a.grid[y][x] = 'wall'; }
    for (const [id, r] of Object.entries(a.rooms)) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (a.grid[y]) a.grid[y][x] = id;
    for (const [x, y] of a.doors) if (a.grid[y]) a.grid[y][x] = 'door';
    a.blocked = new Set();
    for (const it of a.items) if (OBJ[it.objeto].solido) for (let j = it.y; j < it.y + it.h; j++) for (let i = it.x; i < it.x + it.w; i++) a.blocked.add(`${i},${j}`);
    return a;
  }

  const walkable = (a, x, y, extra) => x >= 0 && y >= 0 && x < a.cols && y < a.rows && a.grid[y][x] !== 'wall' && !a.blocked.has(`${x},${y}`) && !(extra && extra.has(`${x},${y}`));
  function reachableFrom(a, sx, sy, extra) {
    const seen = new Set([`${sx},${sy}`]); const q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
        if (!seen.has(k) && walkable(a, nx, ny, extra)) { seen.add(k); q.push([nx, ny]); }
      }
    }
    return seen;
  }

  // ¿Cabe el objeto en (x, y) absolutos sin tapar puertas, lugares de los personajes ni dejar cuartos aislados?
  function fits(a, roomId, objeto, x, y, w, h) {
    const r = a.rooms[roomId], o = OBJ[objeto];
    if (x < r.x || y < r.y || x + w > r.x + r.w || y + h > r.y + r.h) return false;
    if (!o.solido) return true;
    const cells = new Set();
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { if (a.blocked.has(`${i},${j}`)) return false; cells.add(`${i},${j}`); }
    for (const rr of Object.values(a.rooms)) for (const s of Object.values(rr.spots)) if (cells.has(`${s[0]},${s[1]}`)) return false;
    for (const [dx, dy] of a.doors) for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (cells.has(`${dx + ox},${dy + oy}`)) return false;
    const keys = a.doors.map(([dx, dy]) => `${dx},${dy}`);
    if (!keys.length) return true;
    const before = reachableFrom(a, a.doors[0][0], a.doors[0][1]);
    const after = reachableFrom(a, a.doors[0][0], a.doors[0][1], cells);
    for (const k of before) if (!cells.has(k) && !after.has(k)) return false;
    return true;
  }

  function findSpot(a, roomId, objeto, w, h) {
    const r = a.rooms[roomId];
    if (OBJ[objeto].capa === 2) {   // "encima": de preferencia sobre un mueble del cuarto (computadora sobre el escritorio)
      for (const it of a.items.slice().reverse()) if (OBJ[it.objeto].superficie && it.x >= r.x && it.y >= r.y && it.x < r.x + r.w && it.y < r.y + r.h && fits(a, roomId, objeto, it.x, it.y, w, h)) return [it.x, it.y];
    }
    for (let y = r.y; y <= r.y + r.h - h; y++) for (let x = r.x; x <= r.x + r.w - w; x++) if (fits(a, roomId, objeto, x, y, w, h)) return [x, y];
    return null;
  }

  // ---------- lugares ----------
  const placeKey = (area, cuarto) => (area === HOME ? cuarto : `${area}.${cuarto}`);
  const ROOM_ALIASES = { maquinas_expendedoras: 'maquinas', expendedoras: 'maquinas', tienda: 'tiendita', panaderia: 'tiendita', recepcion: 'lobby', trabajo: 'oficina', salon_de_clases: 'salon', aula: 'salon', casilleros: 'pasillo', lobby: 'lobby' };
  const HOME_ALIASES = {
    terrace: 'terraza', balcon: 'terraza', balcony: 'terraza', kitchen: 'cocina', cocineta: 'cocina', bedroom: 'recamara', dormitorio: 'recamara', cuarto: 'recamara',
    living: 'sala', living_room: 'sala', comedor: 'sala', sala_comedor: 'sala', estancia: 'sala', bathroom: 'bano_tina', bano: 'bano_tina', bano_con_tina: 'bano_tina',
    bano_de_la_recamara: 'bano_recamara', lavanderia: 'azotehuela', laundry: 'azotehuela', patio_de_servicio: 'azotehuela',
  };
  const AREA_ALIASES = { planta_1: 'planta_baja', planta1: 'planta_baja', primer_piso: 'planta_baja', edificio: 'planta_baja', zona_hotelera: 'hotel', trabajo: 'hotel', zona_escolar: 'universidad', zona_universitaria: 'universidad', escuela: 'universidad', uni: 'universidad', campus: 'universidad', facultad: 'universidad', depa: HOME, departamento: HOME, casa: HOME };

  // "hotel.oficina", "hotel/oficina", "oficina", "sala" -> { area, cuarto, falta?: plantilla por crear }
  function resolvePlace(world, value) {
    if (!value) return null;
    const raw = typeof value === 'object' ? `${value.area || ''}.${value.cuarto || ''}` : String(value);
    const parts = raw.split(/[./:>|]/).map(slug).filter(Boolean);
    if (!parts.length) return null;
    const known = [HOME].concat(world.areas.map((a) => a.id));
    // "universidad" también encuentra un área creada con esa plantilla pero otro id (partidas viejas: "escuela").
    const byTemplate = (id) => (id && !known.includes(id) && (world.areas.find((a) => a.plantilla === id) || {}).id) || id;
    const roomOf = (areaId, name) => {
      const spec = areaSpec(world, areaId) || (TEMPLATES[areaId] && areaId !== HOME ? { id: areaId, plantilla: areaId } : null);
      if (!spec) return null;
      const rooms = spec.plantilla === 'personalizada' ? Object.fromEntries((spec.cuartos || []).map((c) => [c.id, c])) : TEMPLATES[spec.plantilla].cuartos;
      if (!name) return Object.keys(rooms)[0];
      if (rooms[name]) return name;
      if (ROOM_ALIASES[name] && rooms[ROOM_ALIASES[name]]) return ROOM_ALIASES[name];
      return Object.keys(rooms).find((k) => name.includes(k) || k.includes(name)) || null;
    };
    const finish = (area, cuarto) => (cuarto ? { area, cuarto, key: placeKey(area, cuarto), falta: known.includes(area) ? null : area } : null);
    let [first, second] = parts;
    if (parts.length >= 2) {
      const area = byTemplate(AREA_ALIASES[first] && !known.includes(first) ? AREA_ALIASES[first] : first);
      if (known.includes(area) || (TEMPLATES[area] && area !== HOME)) return finish(area, roomOf(area, second));
      return null;
    }
    if (roomOf(HOME, first) && (TEMPLATES[HOME].cuartos[first] || ROOM_ALIASES[first] === first)) return finish(HOME, first);
    for (const id of known) if (id !== HOME) { const c = roomOf(id, first); if (c && (c === first || c === ROOM_ALIASES[first])) return finish(id, c); }
    const asArea = known.includes(first) ? first : byTemplate(AREA_ALIASES[first] || (TEMPLATES[first] && first !== HOME ? first : null));
    if (asArea) return finish(asArea, roomOf(asArea, null));
    if (HOME_ALIASES[first]) return finish(HOME, HOME_ALIASES[first]);
    return null;
  }

  // ---------- acciones ----------
  function createArea(world, act) {
    const plantilla = slug(act.plantilla || act.tipo || '');
    if (plantilla === HOME) return { error: 'el departamento ya existe' };
    if (!TEMPLATES[plantilla] && plantilla !== 'personalizada') return { error: `plantilla desconocida "${cleanText(act.plantilla, 20)}"` };
    const id = slug(act.id || (plantilla === 'personalizada' ? act.nombre : plantilla));
    if (!SLUG.test(id) || id === HOME) return { error: 'id de área inválido' };
    if (world.areas.some((a) => a.id === id)) return { world, area: id, info: `el área "${id}" ya existía` };
    if (world.areas.length >= LIMITS.MAX_AREAS) return { error: 'ya hay demasiadas áreas' };
    const zona = TEMPLATES[plantilla] ? TEMPLATES[plantilla].zona : (ZONES[slug(act.zona)] ? slug(act.zona) : 'otra');  // las plantillas ya saben su zona
    const area = { id, plantilla, nombre: cleanText(act.nombre) || (TEMPLATES[plantilla] ? TEMPLATES[plantilla].nombre : id), zona };
    if (plantilla === 'personalizada') {
      const list = Array.isArray(act.cuartos) ? act.cuartos.slice(0, LIMITS.MAX_ROOMS) : [];
      const seen = new Set();
      area.cuartos = list.map((c) => ({
        id: slug(c && (c.id || c.nombre)), nombre: cleanText(c && (c.nombre || c.id)) || 'Cuarto',
        piso: FLOORS[slug(c && c.piso)] ? slug(c.piso) : 'madera', ancho: int(c && c.ancho, 3, 12, 6), alto: int(c && c.alto, 3, 8, 5), exterior: !!(c && c.exterior),
      })).filter((c) => SLUG.test(c.id) && !seen.has(c.id) && seen.add(c.id));
      if (!area.cuartos.length) return { error: 'un área personalizada necesita al menos un cuarto válido' };
    }
    return { world: { ...world, areas: world.areas.concat(area) }, area: id, info: `nueva área: ${area.nombre}` };
  }

  function ensureArea(world, place) {
    if (!place || !place.falta) return { world };
    const r = createArea(world, { plantilla: place.falta });
    return r.error ? { error: r.error } : { world: r.world, info: r.info };
  }

  // Cuarto que la IA inventó ("tiendas") dentro del área con la que está trabajando en este turno: el más parecido, o el primero.
  function guessRoom(world, areaId, name) {
    const spec = areaSpec(world, areaId);
    if (!spec) return null;
    const rooms = buildArea(spec).rooms;
    const stems = slug(name).split('_').filter((t) => t.length > 3).map((t) => t.slice(0, 4));
    const hit = Object.entries(rooms).find(([k, r]) => stems.some((st) => k.includes(st) || slug(r.nombre).includes(st)));
    const cuarto = hit ? hit[0] : Object.keys(rooms)[0];
    return { area: areaId, cuarto, key: placeKey(areaId, cuarto), falta: null, ajustado: true };
  }

  function placeObject(world, act, ctx = {}) {
    const objeto = slug(act.objeto || act.mueble || act.id);
    const o = OBJ[objeto];
    if (!o) return { error: `objeto desconocido "${cleanText(act.objeto, 24)}"` };
    if (world.objetos.length >= LIMITS.MAX_OBJECTS) return { error: 'el mapa ya tiene demasiados objetos' };
    const place = resolvePlace(world, act.donde || act.lugar || act.cuarto) || (ctx.lastArea ? guessRoom(world, ctx.lastArea, act.donde || act.lugar || act.cuarto) : null);
    if (!place) return { error: `lugar desconocido "${cleanText(act.donde || act.cuarto, 30)}"` };
    const ens = ensureArea(world, place);
    if (ens.error) return ens;
    world = ens.world;
    const a = geometry(world, place.area), r = a.rooms[place.cuarto];
    const w = o.redim ? int(act.ancho, o.redim.w[0], Math.min(o.redim.w[1], r.w), Math.min(o.w, r.w)) : o.w;
    const h = o.redim ? int(act.alto, o.redim.h[0], Math.min(o.redim.h[1], r.h), Math.min(o.h, r.h)) : o.h;
    let pos = null;
    if (act.x != null && act.y != null) {
      const x = r.x + int(act.x, 0, r.w - 1, 0), y = r.y + int(act.y, 0, r.h - 1, 0);
      if (fits(a, place.cuarto, objeto, x, y, w, h)) pos = [x, y];
    }
    pos = pos || findSpot(a, place.cuarto, objeto, w, h);
    if (!pos) return { error: `no cabe ${o.nombre} en ${r.nombre}` };
    const item = { uid: `o${world.seq + 1}`, area: place.area, cuarto: place.cuarto, objeto, x: pos[0], y: pos[1], w, h };
    const label = cleanText(act.nombre);
    if (label) item.nombre = label;
    return { world: { ...world, seq: world.seq + 1, objetos: world.objetos.concat(item) }, area: place.area, info: `${ens.info ? ens.info + '; ' : ''}${label || o.nombre} en ${r.nombre}` };
  }

  function removeObject(world, act) {
    const objeto = slug(act.objeto || act.mueble || act.id);
    if (!OBJ[objeto]) return { error: `objeto desconocido "${cleanText(act.objeto, 24)}"` };
    const place = resolvePlace(world, act.donde || act.lugar || act.cuarto);
    if (!place || place.falta) return { error: 'lugar desconocido para quitar' };
    const mine = world.objetos.filter((it) => it.area === place.area && it.cuarto === place.cuarto && it.objeto === objeto);
    if (mine.length) {
      const uid = mine[mine.length - 1].uid;
      return { world: { ...world, objetos: world.objetos.filter((it) => it.uid !== uid) }, info: `se quitó ${OBJ[objeto].nombre}` };
    }
    const a = geometry(world, place.area), r = a.rooms[place.cuarto];
    const inRoom = (it) => it.x >= r.x && it.y >= r.y && it.x < r.x + r.w && it.y < r.y + r.h;
    const b = a.items.find((it) => it.builtin && it.objeto === objeto && inRoom(it));
    if (!b) return { error: `no hay ${OBJ[objeto].nombre} en ${r.nombre}` };
    return { world: { ...world, quitados: world.quitados.concat(b.uid) }, info: `se quitó ${OBJ[objeto].nombre}` };
  }

  // Cortina sobre un cuarto: el mapa no muestra lo que pasa dentro.
  function setPrivacy(world, act) {
    const place = resolvePlace(world, act.donde || act.lugar || act.cuarto);
    if (!place || place.falta) return { error: `lugar desconocido "${cleanText(act.donde || act.cuarto, 30)}"` };
    const off = act.activa === false || act.activa === 'false';
    const rest = world.privados.filter((k) => k !== place.key);
    const nombre = geometry(world, place.area).rooms[place.cuarto].nombre;
    return off ? { world: { ...world, privados: rest }, info: `se abrió la cortina de ${nombre}` }
      : { world: { ...world, privados: rest.concat(place.key).slice(-10) }, area: place.area, info: `cortina cerrada en ${nombre}` };
  }

  const HANDLERS = { crear_area: createArea, colocar: placeObject, poner: placeObject, quitar: removeObject, privacidad: setPrivacy };

  // Aplica en orden; una acción inválida no detiene a las demás. log: [{ ok, texto }].
  function applyActions(world, actions) {
    let w = sanitizeWorld(world);
    const log = [];
    const ctx = { lastArea: null };
    const list = Array.isArray(actions) ? actions : (actions && typeof actions === 'object' ? [actions] : []);
    for (const act of list.slice(0, LIMITS.MAX_ACTIONS)) {
      if (!act || typeof act !== 'object') { log.push({ ok: false, texto: 'acción ilegible' }); continue; }
      const kind = slug(act.accion || act.op || act.tipo_accion || act.action);
      const fn = HANDLERS[kind];
      if (!fn) { log.push({ ok: false, texto: `acción desconocida "${cleanText(kind, 20)}"` }); continue; }
      const r = fn(w, act, ctx);
      if (r.error) log.push({ ok: false, texto: r.error });
      else { w = r.world; if (r.area) ctx.lastArea = r.area; log.push({ ok: true, texto: r.info }); }
    }
    if (list.length > LIMITS.MAX_ACTIONS) log.push({ ok: false, texto: `se ignoraron ${list.length - LIMITS.MAX_ACTIONS} acciones extra` });
    return { world: w, log };
  }

  // Recupera "mapa": [...] de un JSON roto: primero el arreglo completo, luego objeto por objeto.
  function salvageMapa(raw) {
    const text = String(raw || '');
    const m = text.match(/"?mapa"?\s*:\s*\[/);
    if (!m) return [];
    let depth = 0, i = m.index + m[0].length - 1, end = -1;
    for (; i < text.length; i++) { if (text[i] === '[') depth++; else if (text[i] === ']' && --depth === 0) { end = i; break; } }
    const body = text.slice(m.index + m[0].length - 1, end > 0 ? end + 1 : text.length);
    try { const arr = JSON.parse(body); if (Array.isArray(arr)) return arr; } catch (e) { /* objeto por objeto */ }
    const out = [];
    for (const mm of body.matchAll(/\{[^{}]*(\[[^\]]*\][^{}]*)?\}/g)) { try { out.push(JSON.parse(mm[0])); } catch (e) { /* se descarta */ } }
    return out;
  }

  // ---------- conocimiento para el prompt ----------
  function catalogText() {
    const groups = {};
    for (const [id, o] of Object.entries(OBJ)) {
      const size = o.redim ? `${o.w}x${o.h} ajustable` : `${o.w}x${o.h}`;
      (groups[o.capa === 0 ? 'piso' : o.capa === 2 ? 'encima' : 'mueble'] ||= []).push(`${id} (${size})`);
    }
    return `muebles: ${groups.mueble.join(', ')}\nsobre el piso: ${groups.piso.join(', ')}\nencima de otro mueble: ${groups.encima.join(', ')}`;
  }

  function worldText(world) {
    const w = sanitizeWorld(world);
    const ids = [HOME].concat(w.areas.map((a) => a.id));
    const lines = ids.map((id) => {
      const a = geometry(w, id);
      const rooms = Object.entries(a.rooms).map(([k, r]) => `${placeKey(id, k)} (${r.nombre}, ${r.w}x${r.h})`).join('; ');
      return `- ${id} «${a.nombre}» [${ZONES[a.zona] || a.zona}]: ${rooms}`;
    });
    const added = w.objetos.slice(-12).map((o) => `${OBJ[o.objeto].nombre}${o.nombre ? ` «${o.nombre}»` : ''} en ${placeKey(o.area, o.cuarto)}`);
    const pending = Object.entries(TEMPLATES).filter(([k]) => k !== HOME && !ids.includes(k)).map(([k, t]) => `${k} (${t.nombre}: ${t.descripcion})`);
    return `${lines.join('\n')}${added.length ? `\nObjetos que ya agregaste: ${added.join(', ')}.` : ''}${pending.length ? `\nPlantillas aún sin crear: ${pending.join('; ')}.` : ''}`;
  }

  const RULES = `
[HERRAMIENTA DE MAPA (pixel art que ve el jugador)]:
Tú dibujas el mapa con el campo "mapa" del JSON: una lista de máximo ${LIMITS.MAX_ACTIONS} acciones.
Cada vez que la escena mencione, compre, arme o visite un mueble, objeto o lugar que todavía no está en el mapa, agrégalo en "mapa" en ESA MISMA respuesta.
Si no aparece nada nuevo, pon "mapa": [].
Acciones válidas (copia la forma exacta):
  {"accion":"crear_area","plantilla":"planta_baja"}  ← plantillas listas: planta_baja, hotel, universidad
  {"accion":"crear_area","plantilla":"personalizada","id":"cafeteria","nombre":"Cafetería del centro","zona":"centro","cuartos":[{"id":"barra","nombre":"Barra","piso":"madera","ancho":8,"alto":5}]}
  {"accion":"colocar","objeto":"maquina_bebidas","donde":"planta_baja.maquinas"}   (x,y opcionales dentro del cuarto; "nombre" opcional)
  {"accion":"quitar","objeto":"tv","donde":"sala"}
Lugares: "area.cuarto" (los del departamento van sin prefijo: "sala", "cocina"). Zonas: ${Object.keys(ZONES).join(', ')}.
Pisos: ${Object.keys(FLOORS).join(', ')}. Cuartos personalizados: ancho 3-12, alto 3-8, máximo ${LIMITS.MAX_ROOMS}.
El campo "ubicacion" acepta cualquier lugar del mapa, p. ej. {"yukiho":"universidad.salon","jugador":"hotel.oficina"}; si el área aún no existe se crea con su plantilla.
Yukiho (19 años, universitaria) y el jugador son adultos. Para un momento romántico o íntimo entre ellos no lo describas de forma explícita: agrega
  {"accion":"privacidad","donde":"<cuarto donde están>"}  ← el mapa cierra una cortina sobre ese cuarto
y la narración hace un fundido a negro. La cortina se abre sola cuando salen del cuarto (o con "activa":false).
Ejemplo: si el jugador dice "te armo un rincón de estudio en la recámara", responde con
  "ubicacion":{"yukiho":"recamara","jugador":"recamara"},
  "mapa":[{"accion":"colocar","objeto":"escritorio","donde":"recamara","nombre":"Escritorio de Yukiho"},{"accion":"colocar","objeto":"librero","donde":"recamara"},{"accion":"colocar","objeto":"lampara","donde":"recamara"}]
Ejemplo: si van a la universidad de Yukiho por primera vez: "mapa":[{"accion":"crear_area","plantilla":"universidad"}] y "ubicacion":{"yukiho":"universidad.salon","jugador":"universidad.patio"}.`;

  function promptText(world) {
    return `${RULES}\n[CATÁLOGO DE OBJETOS (ids exactos)]:\n${catalogText()}\n[MAPA ACTUAL]:\n${worldText(world)}`;
  }

  const api = { LIMITS, HOME, emptyWorld, sanitizeWorld, buildArea, geometry, fits, findSpot, resolvePlace, placeKey, applyActions, salvageMapa, promptText, worldText, slug };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MapActions = api;
})(typeof window !== 'undefined' ? window : globalThis);
