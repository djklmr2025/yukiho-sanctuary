/*
 * ARKAIOS · Mapa vivo de la novela en pixel art (departamento + áreas que la IA va creando).
 * La IA dice dónde está cada personaje ("ubicacion") y puede dibujar con "mapa": [acciones] (ver map-actions.js).
 * El mundo dibujado se guarda en userState.mapa; los lugares en userState.location ("sala", "hotel.oficina"...).
 * Requiere map-catalog.js y map-actions.js cargados antes. Todo se dibuja por código a 8 px por tile.
 *
 * API: ApartmentMap.mount(el) · track(state, data, playerText) · restore(loc, state) · renderLog(state)
 *      promptFor(state) · salvageJson(raw) · cleanScene(data)
 */
(function () {
  const CAT = window.MapCatalog, MA = window.MapActions;
  const { OBJ, FLOORS, ZONES } = CAT;
  const T = 8;
  const WALK_TILES_PER_SEC = 4.5;
  const MAX_LOG = 100;
  const HOME = MA.HOME;
  const ZONE_ICON = { edificio: '🏢', zona_hotelera: '🏨', zona_universitaria: '🎓', centro: '🏙️', playa: '🏖️', parque: '🌳', otra: '📍' };
  const PAL = { wall: '#2b2238', wallTop: '#4a3b5e', door: '#8a5a3b', glass: '#7fb2c9' };

  window.APARTMENT_PROMPT = `
[ESCENARIO FÍSICO (mapa en pixel art visible para el jugador)]:
El departamento del jugador está en la planta 2 de un edificio en Cancún. Espacios del departamento:
recamara (cama, buró, clóset; tiene su propio baño completo), bano_recamara (regadera, WC, lavabo),
bano_tina (tina, regadera y WC), sala (sofá, mesa de centro, comedor; aquí empezó la historia con el té),
cocina (estufa, refrigerador, tetera), terraza (frontal, con plantas y la lluvia), azotehuela (lavadora y lavadero).
Agrega SIEMPRE al JSON el campo "ubicacion": {"yukiho": "<lugar>", "jugador": "<lugar>"} ("jugador" es el personaje del humano).
Solo cambia de lugar cuando la historia lo justifique y narra el traslado. Por defecto ambos están en "sala".`;

  const KEYWORDS = [
    ['bano_recamara', /baño de (la|tu|su) rec[aá]mara|baño privado|baño de la habitaci/i],
    ['bano_tina', /\btina\b|bañera|regadera|ducha|\bbaño\b/i],
    ['recamara', /rec[aá]mara|habitaci[oó]n|dormitorio|\bcama\b|dormir|acostar/i],
    ['azotehuela', /azotehuela|lavadora|lavadero|tender la ropa|ropa mojada/i],
    ['cocina', /cocina|estufa|refrigerador|cocinar|preparar (la )?cena|tetera/i],
    ['terraza', /terraza|balc[oó]n|barandal/i],
    ['sala', /\bsala\b|sof[aá]|sill[oó]n|comedor/i],
  ];
  // Si la IA no dibujó nada pero la plática nombra uno de estos lugares, se crea su área (sin mover a nadie).
  const AREA_HINTS = [
    ['planta_baja', /m[aá]quinas? expendedoras?|planta baja|vending|pan(es)? dulces?|botanas|tiendita del edificio/i],
    ['hotel', /zona hotelera|\bhotel\b/i],
    ['universidad', /universidad|campus|facultad|\bescuela\b/i],
  ];

  // Si el jugador pide poner/armar/comprar un objeto y la IA no lo dibujó, se coloca donde está el jugador (o el cuarto que nombre).
  const PLACE_VERB = /\b(pon|poner|pongo|ponerte|coloca|colocar|coloco|arma|armar|armo|armarte|instala|instalar|instalo|compr[oóa]\w*|trae|traer|traigo|agrega|agregar|agrego|acomoda|acomodar|acomodo|regal[oaé]\w*)\b/i;
  const OBJECT_HINTS = [
    ['computadora', /computadora|laptop|\bpc\b/i], ['escritorio', /escritorio/i], ['librero', /librero|estante de libros/i],
    ['lampara', /l[aá]mpara/i], ['maceta_flores', /flores|florero/i], ['planta', /\bplantas?\b(?! baja)/i], ['tv', /televisi[oó]n|\btele\b|\btv\b/i],
    ['sofa', /sof[aá]/i], ['mesa', /\bmesa\b/i], ['silla', /\bsillas?\b/i], ['tapete', /tapete/i], ['alfombra', /alfombra/i],
    ['cama', /\bcama\b/i], ['closet', /cl[oó]set|armario/i], ['buro', /bur[oó]/i], ['refrigerador', /\brefri(gerador)?\b/i],
    ['pizarron', /pizarr[oó]n/i], ['banca', /\bbanca\b/i],
  ];
  const MAX_HINTED_OBJECTS = 3;

  // ---------- estado ----------
  let world = MA.emptyWorld();
  let syncedState = null;
  const geoCache = new Map();
  const actors = {};
  let viewArea = HOME, followYukiho = true, showAll = false;
  const CITY = '__ciudad';  // pestaña con la vista general de Cancún (city-map.js)
  const CITY_NAMES = { edificio: 'Tu edificio', centro: 'Centro', zona_universitaria: 'Zona universitaria', zona_hotelera: 'Zona hotelera', playa: 'Playa', parque: 'Parque', otra: 'Afueras' };
  const areaZone = (id) => (id === HOME ? 'edificio' : ((world.areas.find((a) => a.id === id) || {}).zona || 'otra'));

  function geo(areaId) {
    if (!geoCache.has(areaId)) {
      const g = MA.geometry(world, areaId);
      if (!g) return null;
      g.canvas = document.createElement('canvas'); g.canvas.width = g.cols * T; g.canvas.height = g.rows * T;
      g.ctx = g.canvas.getContext('2d');
      g.drops = Array.from({ length: Math.round(g.cols * g.rows / 6) }, () => ({ x: Math.random() * g.cols * T, y: Math.random() * g.rows * T, s: 60 + Math.random() * 60 }));
      g.glows = g.items.filter((it) => OBJ[it.objeto].brillo).map((it) => [it.x + it.w / 2, it.y + 0.4, it.w > 1 ? 30 : 24]);
      geoCache.set(areaId, g);
    }
    return geoCache.get(areaId);
  }
  function setWorld(next) { world = next; geoCache.clear(); renderTabs(); }
  const areaIds = () => [HOME].concat(world.areas.map((a) => a.id));

  // "sala" | "hotel.oficina" -> { area, cuarto, key } (crea el área si es una plantilla pendiente)
  function resolve(value) {
    let p = MA.resolvePlace(world, value);
    if (p && p.falta) {
      const r = MA.applyActions(world, [{ accion: 'crear_area', plantilla: p.falta }]);
      if (!r.log[0].ok) return null;
      setWorld(r.world);
      p = MA.resolvePlace(world, value);
    }
    if (p) return p;
    const k = MA.slug(value).replace(/_/g, ' ');
    if (!k) return null;
    if (k.includes('tina')) return { area: HOME, cuarto: 'bano_tina', key: 'bano_tina' };
    if (k.includes('bano')) { const c = k.includes('recamara') ? 'bano_recamara' : 'bano_tina'; return { area: HOME, cuarto: c, key: c }; }
    const d = detect(k);
    return d ? { area: HOME, cuarto: d, key: d } : null;
  }
  function detect(text) { for (const [room, re] of KEYWORDS) if (re.test(text)) return room; return null; }

  // ---------- personajes ----------
  const CHARS = {
    yukiho: { hair: '#14101a', skin: '#f2d5c2', shirt: '#f4f1ea', legs: '#4a5a7a', eye: '#3fbf7f', longHair: true },
    jugador: { hair: '#3a2416', skin: '#c99a74', shirt: '#2f4a7a', legs: '#2b2b33', eye: '#3a2a1a', longHair: false },
  };

  // Lugar libre más cercano al "spot" del cuarto (por si la IA puso un mueble encima o el otro personaje está ahí).
  function freeSpot(g, room, id) {
    const r = g.rooms[room];
    const [sx, sy] = r.spots[id] || [r.x + 1, r.y + 1];
    const other = Object.values(actors).find((a) => a.id !== id && a.area === g.id && a.room === room);
    const taken = other ? `${Math.round(other.x / T)},${Math.round(other.y / T)}` : '';
    let best = null, bestD = Infinity;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if (g.blocked.has(`${x},${y}`) || `${x},${y}` === taken) continue;
      const d = Math.abs(x - sx) + Math.abs(y - sy);
      if (d < bestD) { bestD = d; best = [x, y]; }
    }
    return best || [sx, sy];
  }

  function placeActor(id, place) {
    const g = geo(place.area);
    if (!g || !g.rooms[place.cuarto]) return;
    const [x, y] = freeSpot(g, place.cuarto, id);
    actors[id] = { id, area: place.area, room: place.cuarto, key: place.key, x: x * T, y: y * T, path: [] };
  }

  function findPath(g, fx, fy, tx, ty) {
    const key = (x, y) => `${x},${y}`;
    const ok = (x, y) => x >= 0 && y >= 0 && x < g.cols && y < g.rows && g.grid[y][x] !== 'wall' && (!g.blocked.has(key(x, y)) || (x === tx && y === ty));
    const prev = new Map([[key(fx, fy), null]]);
    const q = [[fx, fy]];
    while (q.length) {
      const [x, y] = q.shift();
      if (x === tx && y === ty) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (ok(nx, ny) && !prev.has(key(nx, ny))) { prev.set(key(nx, ny), [x, y]); q.push([nx, ny]); }
      }
    }
    if (!prev.has(key(tx, ty))) return [[tx, ty]];
    const path = [];
    for (let p = [tx, ty]; p; p = prev.get(key(p[0], p[1]))) path.unshift(p);
    return path.slice(1);
  }

  function moveActor(id, place) {
    const a = actors[id];
    if (!a || !place) return;
    if (a.area !== place.area) { placeActor(id, place); return; }   // otra área: aparece allá (la narración cuenta el traslado)
    if (a.room === place.cuarto) return;
    const g = geo(place.area);
    const [tx, ty] = freeSpot(g, place.cuarto, id);
    a.path = findPath(g, Math.round(a.x / T), Math.round(a.y / T), tx, ty);
    a.room = place.cuarto; a.key = place.key;
  }

  function drawActor(c, a, time) {
    const s = CHARS[a.id];
    const moving = a.path.length > 0;
    const bob = moving ? (Math.floor(time / 120) % 2) : 0;
    const x = Math.round(a.x), y = Math.round(a.y) - 5 - bob;
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x + 1, Math.round(a.y) + 6, 6, 2);
    c.fillStyle = s.legs; c.fillRect(x + 2, y + 9, 1, 3); c.fillRect(x + 5, y + 9, 1, 3);
    if (moving && Math.floor(time / 120) % 2) c.fillRect(x + 2, y + 11, 2, 1); else c.fillRect(x + 5, y + 11, 2, 1);
    c.fillStyle = s.shirt; c.fillRect(x + 1, y + 5, 6, 5);
    c.fillStyle = s.skin; c.fillRect(x + 2, y + 1, 4, 4); c.fillRect(x, y + 6, 1, 3); c.fillRect(x + 7, y + 6, 1, 3);
    c.fillStyle = s.hair; c.fillRect(x + 1, y, 6, 2); c.fillRect(x + 1, y + 1, 1, 2); c.fillRect(x + 6, y + 1, 1, 2);
    if (s.longHair) { c.fillRect(x + 1, y + 2, 1, 6); c.fillRect(x + 6, y + 2, 1, 6); }
    c.fillStyle = s.eye; c.fillRect(x + 3, y + 3, 1, 1); c.fillRect(x + 5, y + 3, 1, 1);
  }

  // ---------- dibujo del área ----------
  function nearestRoom(g, x, y) {
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) { const k = g.grid[y + dy] && g.grid[y + dy][x + dx]; if (k && g.rooms[k]) return k; }
    return Object.keys(g.rooms)[0];
  }

  function drawFloor(g) {
    const c = g.ctx;
    const doorType = new Map(g.doors.map(([x, y, t]) => [`${x},${y}`, t]));
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
      const cell = g.grid[y][x];
      if (cell === 'wall') { c.fillStyle = PAL.wall; c.fillRect(x * T, y * T, T, T); c.fillStyle = PAL.wallTop; c.fillRect(x * T, y * T, T, 2); continue; }
      const room = g.rooms[cell === 'door' ? nearestRoom(g, x, y) : cell];
      const tones = FLOORS[room.piso] || FLOORS.madera;
      c.fillStyle = tones[(x + y) % 2]; c.fillRect(x * T, y * T, T, T);
      if (cell !== 'door') continue;
      if (doorType.get(`${x},${y}`) === 'vidrio') { c.fillStyle = PAL.glass; c.fillRect(x * T, y * T + 3, T, 2); }
      else { c.fillStyle = PAL.door; c.fillRect(x * T + 1, y * T + 1, T - 2, T - 2); }
    }
    for (const [x, y] of g.windows) { c.fillStyle = PAL.glass; c.fillRect(x * T + 1, y * T + 2, T - 2, 4); }
    if (g.glassWall) for (let x = g.glassWall.x0; x <= g.glassWall.x1; x++) if (g.grid[g.glassWall.y][x] === 'wall') { c.fillStyle = 'rgba(127,178,201,.55)'; c.fillRect(x * T, g.glassWall.y * T + 3, T, 2); }
  }

  function drawItems(g, time) {
    const items = g.items.slice().sort((a, b) => (OBJ[a.objeto].capa - OBJ[b.objeto].capa) || (a.y - b.y));
    for (const it of items) OBJ[it.objeto].draw(g.ctx, it.x * T, it.y * T, it.w, it.h, time);
  }

  const isPrivate = (key) => world.privados.includes(key);
  function roomKeyOf(g, room) { return MA.placeKey(g.id, room); }

  // Cortina de terciopelo sobre todo el cuarto: lo de adentro no se dibuja.
  function drawCurtains(g, time) {
    const c = g.ctx;
    for (const [id, r] of Object.entries(g.rooms)) {
      if (!isPrivate(roomKeyOf(g, id))) continue;
      const x = r.x * T, y = r.y * T, w = r.w * T, h = r.h * T;
      c.fillStyle = '#4a1830'; c.fillRect(x, y, w, h);
      for (let i = 0; i < w; i += 4) { c.fillStyle = (i / 4) % 2 ? '#6b2546' : '#5a1f3a'; c.fillRect(x + i, y + 2, 2, h - 3); }
      const sway = Math.round(Math.sin(time / 900) * 1);
      c.fillStyle = '#3a1226'; c.fillRect(x + Math.floor(w / 2) - 1 + sway, y + 2, 2, h - 3);
      c.fillStyle = '#c9a46a'; c.fillRect(x, y, w, 2);
      for (let i = 1; i < w; i += 3) { c.fillStyle = '#c9a46a'; c.fillRect(x + i, y + h - 2, 1, 2); }
    }
  }

  function isOutdoor(g, x, y) { const k = g.grid[y] && g.grid[y][x]; return !!(k && g.rooms[k] && g.rooms[k].exterior); }

  function drawRain(g, dt) {
    const c = g.ctx;
    for (const d of g.drops) {
      d.y += d.s * dt; d.x -= d.s * dt * 0.15;
      if (d.y > g.rows * T || d.x < 0) { d.y = Math.random() * g.rows * T * 0.3; d.x = Math.random() * g.cols * T; }
      if (isOutdoor(g, Math.floor(d.x / T), Math.floor(d.y / T))) { c.fillStyle = 'rgba(170,200,255,.6)'; c.fillRect(Math.round(d.x), Math.round(d.y), 1, 3); }
    }
  }

  function drawNight(g, time) {
    const c = g.ctx;
    c.fillStyle = 'rgba(10,8,30,.28)'; c.fillRect(0, 0, g.cols * T, g.rows * T);
    const flicker = 0.85 + Math.sin(time / 400) * 0.05;
    for (const [x, y, r] of g.glows) {
      const grad = c.createRadialGradient(x * T, y * T, 1, x * T, y * T, r);
      grad.addColorStop(0, `rgba(255,214,140,${0.28 * flicker})`); grad.addColorStop(1, 'rgba(255,214,140,0)');
      c.fillStyle = grad; c.fillRect(x * T - r, y * T - r, r * 2, r * 2);
    }
    if (Math.random() < 0.002) for (const r of Object.values(g.rooms)) if (r.exterior) { c.fillStyle = 'rgba(220,230,255,.35)'; c.fillRect(r.x * T, r.y * T, r.w * T, r.h * T); }
  }

  // ---------- cámara y vista ----------
  let view, vctx, label, toggleBtn, tabsBox;
  const cam = { x: 0, y: 0, w: 0, h: 0, area: null };

  function targetCamera(g) {
    const W = g.cols * T, H = g.rows * T, aspect = view.width / view.height;
    const whole = () => { const h = Math.max(W / aspect, H), w = h * aspect; return { x: (W - w) / 2, y: (H - h) / 2, w, h }; };
    const here = Object.values(actors).filter((a) => a.area === g.id).map((a) => a.room);
    if (showAll || !here.length) return whole();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of new Set(here)) { const r = g.rooms[id]; x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    let x = (x0 - 1) * T, y = (y0 - 1) * T, w = (x1 - x0 + 2) * T, h = (y1 - y0 + 2) * T;
    if (w / h < aspect) { const nw = h * aspect; x -= (nw - w) / 2; w = nw; } else { const nh = w / aspect; y -= (nh - h) / 2; h = nh; }
    if (w >= W || h >= H) return whole();
    return { x: Math.max(0, Math.min(x, W - w)), y: Math.max(0, Math.min(y, H - h)), w, h };
  }

  let last = 0;
  function frame(time) {
    const dt = Math.min(0.05, (time - last) / 1000 || 0); last = time;
    for (const a of Object.values(actors)) {
      if (!a.path.length) continue;
      const [tx, ty] = a.path[0];
      const step = WALK_TILES_PER_SEC * T * dt;
      const dx = tx * T - a.x, dy = ty * T - a.y, dist = Math.hypot(dx, dy);
      if (dist <= step) { a.x = tx * T; a.y = ty * T; a.path.shift(); } else { a.x += dx / dist * step; a.y += dy / dist * step; }
    }
    if (viewArea === CITY && window.CityMap) { drawCity(time); requestAnimationFrame(frame); return; }
    const g = geo(viewArea) || geo(HOME);
    g.ctx.clearRect(0, 0, g.canvas.width, g.canvas.height);
    drawFloor(g);
    drawItems(g, time);
    Object.values(actors).filter((a) => a.area === g.id && !(isPrivate(a.key) && !a.path.length)).sort((a, b) => a.y - b.y).forEach((a) => drawActor(g.ctx, a, time));
    drawCurtains(g, time);
    drawRain(g, dt);
    drawNight(g, time);

    const t = targetCamera(g);
    const k = cam.area === g.id ? 1 - Math.pow(0.0005, dt) : 1;
    cam.area = g.id;
    for (const p of ['x', 'y', 'w', 'h']) cam[p] += (t[p] - cam[p]) * k;
    const s = view.width / cam.w;
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.imageSmoothingEnabled = false;
    vctx.fillStyle = '#0d0a16'; vctx.fillRect(0, 0, view.width, view.height);
    vctx.setTransform(s, 0, 0, s, -cam.x * s, -cam.y * s);
    vctx.drawImage(g.canvas, 0, 0);
    requestAnimationFrame(frame);
  }

  function cityInfo() {
    const chars = {};
    for (const a of Object.values(actors)) { const z = areaZone(a.area); chars[z] = (chars[z] || '') + (a.id === 'yukiho' ? '🌸' : '🧍'); }
    return { discovered: areaIds().map(areaZone), zoneNames: CITY_NAMES, chars, selected: actors.yukiho ? areaZone(actors.yukiho.area) : null };
  }
  function drawCity(time) {
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.fillStyle = '#0d0a16'; vctx.fillRect(0, 0, view.width, view.height);
    window.CityMap.draw(vctx, view.width, view.height, cityInfo(), time);
    cam.area = null;
  }
  // Clic en una zona de la vista de Cancún: entra al área de esa zona (la de Yukiho si está ahí).
  function onCityClick(ev) {
    if (viewArea !== CITY || !window.CityMap) return;
    const r = view.getBoundingClientRect();
    const zone = window.CityMap.hitTest((ev.clientX - r.left) * view.width / r.width, (ev.clientY - r.top) * view.height / r.height, view.width, view.height);
    if (!zone) return;
    const ids = areaIds().filter((id) => areaZone(id) === zone);
    if (!ids.length) { label.textContent = `🌫️ ${CITY_NAMES[zone] || zone}: todavía no aparece en la historia.`; return; }
    viewArea = ids.find((id) => actors.yukiho && actors.yukiho.area === id) || ids[0];
    followYukiho = actors.yukiho && actors.yukiho.area === viewArea;
    updateLabel();
  }

  // ---------- encabezado, pestañas y etiqueta ----------
  function playerName() { try { return (typeof getProtagonistName === 'function' && getProtagonistName()) || 'Jugador'; } catch (e) { return 'Jugador'; } }
  const who = (id) => (id === 'yukiho' ? 'Yukiho' : playerName());
  function placeName(key) {
    const p = MA.resolvePlace(world, key);
    if (!p || p.falta) return key || '—';
    const g = geo(p.area);
    return p.area === HOME ? g.rooms[p.cuarto].nombre : `${g.rooms[p.cuarto].nombre} (${g.nombre})`;
  }
  function areaIcon(id) { if (id === HOME) return '🏠'; const a = world.areas.find((x) => x.id === id); return ZONE_ICON[a && a.zona] || '📍'; }

  function renderTabs() {
    if (!tabsBox) return;
    tabsBox.replaceChildren();
    if (window.CityMap) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'apt-tab' + (viewArea === CITY ? ' is-active' : '');
      c.textContent = `🗺️ Cancún · ${new Set(areaIds().map(areaZone)).size}/${window.CityMap.zones.length}`;
      c.title = 'Vista general: zonas descubiertas en la historia';
      c.setAttribute('aria-pressed', viewArea === CITY ? 'true' : 'false');
      c.onclick = () => { viewArea = CITY; followYukiho = false; updateLabel(); };
      tabsBox.append(c);
    }
    if (view) view.style.cursor = viewArea === CITY ? 'pointer' : '';
    for (const id of areaIds()) {
      const g = geo(id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'apt-tab' + (id === viewArea ? ' is-active' : '');
      const here = Object.values(actors).filter((a) => a.area === id).map((a) => (a.id === 'yukiho' ? '🌸' : '🧍')).join('');
      b.textContent = `${areaIcon(id)} ${g.nombre}${here ? ' ' + here : ''}`;
      b.title = `${ZONES[g.zona] || ''}${g.descripcion ? ' · ' + g.descripcion : ''}`;
      b.setAttribute('aria-pressed', id === viewArea ? 'true' : 'false');
      b.onclick = () => { viewArea = id; followYukiho = actors.yukiho && actors.yukiho.area === id; updateLabel(); };
      tabsBox.append(b);
    }
  }

  function updateLabel() {
    renderTabs();
    if (!label) return;
    const y = actors.yukiho, s = actors.jugador;
    if (!y || !s) return;
    if (viewArea === CITY) {
      const n = new Set(areaIds().map(areaZone)).size;
      label.textContent = `Cancún · ${n} de ${window.CityMap.zones.length} zonas descubiertas · toca una zona para entrar`;
      return;
    }
    const g = geo(viewArea);
    if (showAll) { label.textContent = `${g.nombre} completo · ${ZONES[g.zona] || ''}`; return; }
    if (y.key === s.key && isPrivate(y.key)) { label.textContent = `🎐 Momento privado · ${placeName(y.key)}`; return; }
    label.textContent = y.key === s.key ? `Yukiho y ${playerName()} · ${placeName(y.key)}` : `Yukiho · ${placeName(y.key)}  |  ${playerName()} · ${placeName(s.key)}`;
  }

  function mount(el) {
    if (!el || view) return;
    const portrait = document.getElementById('mainArt');
    el.innerHTML = `<div class="apt-head"><span class="apt-title">🗺️ Mapa vivo · Cancún</span>
      <span class="apt-tools">${portrait ? '<button type="button" class="apt-portrait" title="Ver retrato de Yukiho"><img alt="Yukiho"></button>' : ''}
      <button type="button" class="apt-toggle">🔭 Ver todo</button></span></div>
      <div class="apt-tabs" role="toolbar" aria-label="Áreas del mapa"></div>
      <canvas class="apt-view" width="448" height="320" aria-label="Mapa en pixel art"></canvas>
      <div class="apt-label" aria-live="polite"></div>
      <div class="apt-scenes" id="aptScenes" aria-live="polite"></div>
      <div class="apt-logtitle">📜 Bitácora del mapa (.log)</div>
      <div class="apt-log" id="aptLog" aria-live="polite"></div>`;
    view = el.querySelector('.apt-view'); vctx = view.getContext('2d');
    label = el.querySelector('.apt-label'); toggleBtn = el.querySelector('.apt-toggle'); tabsBox = el.querySelector('.apt-tabs');
    const thumb = el.querySelector('.apt-portrait');
    if (thumb) {
      const img = thumb.querySelector('img');
      const sync = () => { img.src = portrait.src; };
      sync(); new MutationObserver(sync).observe(portrait, { attributes: true, attributeFilter: ['src'] });
      thumb.onclick = () => (typeof openLightbox === 'function' ? openLightbox(portrait.src) : window.open(portrait.src, '_blank'));
    }
    view.addEventListener('click', onCityClick);
    toggleBtn.onclick = () => { showAll = !showAll; toggleBtn.textContent = showAll ? '🔍 Acercar' : '🔭 Ver todo'; updateLabel(); };
    resetActors({});
    updateLabel();
    requestAnimationFrame(frame);
  }

  function resetActors(loc) {
    for (const id of ['yukiho', 'jugador']) {
      const p = resolve((loc && (loc[id] || (id === 'jugador' && loc.saul))) || 'sala') || resolve('sala');
      placeActor(id, p);
    }
    viewArea = actors.yukiho.area; followYukiho = true;
  }

  // Carga el mundo guardado en el estado (nueva partida = mundo vacío).
  function syncFrom(state) {
    if (state === syncedState) return;
    syncedState = state;
    setWorld(MA.sanitizeWorld(state && state.mapa));
    if (view) resetActors(state && state.location);
  }

  // ---------- turno de la historia ----------
  function applyMapActions(state, data, playerText) {
    const entries = [];
    let actions = Array.isArray(data && data.mapa) ? data.mapa : [];
    let hinted = false;
    if (!actions.length) {
      const text = `${(data && data.narration) || ''} ${(data && data.dialogue) || ''} ${playerText || ''}`;
      actions = AREA_HINTS.filter(([id, re]) => re.test(text) && !world.areas.some((a) => a.id === id)).map(([id]) => ({ accion: 'crear_area', plantilla: id }));
      hinted = actions.length > 0;
    }
    if (!actions.length) return entries;
    const r = MA.applyActions(world, actions);
    setWorld(r.world);
    for (const l of r.log) entries.push({ ch: state.chapter, at: new Date().toISOString(), kind: 'mapa', ok: l.ok, texto: hinted ? `${l.texto} (detectado en la plática)` : l.texto });
    return entries;
  }

  function placeHintedObjects(state, playerText) {
    const text = String(playerText || '');
    if (!PLACE_VERB.test(text)) return [];
    const objs = OBJECT_HINTS.filter(([, re]) => re.test(text)).map(([id]) => id).slice(0, MAX_HINTED_OBJECTS);
    if (!objs.length) return [];
    const donde = detect(text) || actors.jugador.key;
    const r = MA.applyActions(world, objs.map((objeto) => ({ accion: 'colocar', objeto, donde })));
    setWorld(r.world);
    return r.log.map((l) => ({ ch: state.chapter, at: new Date().toISOString(), kind: 'mapa', ok: l.ok, texto: `${l.texto} (pedido en la plática)` }));
  }

  // Llamado después de cada turno: aplica "mapa", mueve a los personajes y registra todo en la bitácora.
  function track(state, data, playerText) {
    if (!view) return state.location;
    syncFrom(state);
    const entries = applyMapActions(state, data, playerText);
    const u = (data && (data.ubicacion || data.location)) || {};
    let y = resolve(u.yukiho), s = resolve(u.jugador || u.player || u.saul || u['saúl']);
    if (!y && !s) { const guess = detect(`${(data && data.narration) || ''} ${playerText || ''}`); if (guess) y = s = { area: HOME, cuarto: guess, key: guess }; }
    const before = { yukiho: actors.yukiho.key, jugador: actors.jugador.key };
    if (y) moveActor('yukiho', y);
    if (s) moveActor('jugador', s);
    for (const id of ['yukiho', 'jugador']) {
      if (before[id] !== actors[id].key) entries.push({ ch: state.chapter, at: new Date().toISOString(), who: id, from: before[id], to: actors[id].key });
    }
    if (!(Array.isArray(data && data.mapa) && data.mapa.length)) entries.push(...placeHintedObjects(state, playerText));
    // La cortina se abre sola cuando ya nadie está en ese cuarto.
    const stillPrivate = world.privados.filter((k) => Object.values(actors).some((a) => a.key === k));
    if (stillPrivate.length !== world.privados.length) {
      for (const k of world.privados.filter((p) => !stillPrivate.includes(p))) entries.push({ ch: state.chapter, at: new Date().toISOString(), kind: 'mapa', ok: true, texto: `se abrió la cortina de ${placeName(k)}` });
      setWorld({ ...world, privados: stillPrivate });
    }
    if (followYukiho || (viewArea !== CITY && !geo(viewArea))) viewArea = actors.yukiho.area;
    state.mapa = world;
    state.location = { yukiho: actors.yukiho.key, jugador: actors.jugador.key };
    state.moves = (state.moves || []).concat(entries).slice(-MAX_LOG);
    state.lastTurnAt = Date.now();
    syncedState = state;
    updateLabel();
    renderLog(state);
    if (window.LifeSim) window.LifeSim.onStoryTurn(state);
    return state.location;
  }

  // Movimiento por rutina (life-sim.js): solo entre lugares que ya existen y nunca saca a nadie de un momento privado.
  function routineMove(state, plan) {
    if (!view || !state) return [];
    syncFrom(state);
    const entries = [];
    for (const id of ['yukiho', 'jugador']) {
      const step = plan && plan[id];
      if (!step || isPrivate(actors[id].key)) continue;
      const p = MA.resolvePlace(world, step.key);
      if (!p || p.falta || p.key === actors[id].key) continue;
      const from = actors[id].key;
      moveActor(id, p);
      entries.push({ ch: state.chapter, at: new Date().toISOString(), kind: 'rutina', who: id, from, to: p.key, actividad: step.actividad });
    }
    if (!entries.length) return entries;
    if (followYukiho) viewArea = actors.yukiho.area;
    state.location = { yukiho: actors.yukiho.key, jugador: actors.jugador.key };
    state.moves = (state.moves || []).concat(entries).slice(-MAX_LOG);
    updateLabel();
    renderLog(state);
    return entries;
  }

  function snapshot() {
    const one = (id) => actors[id] && { key: actors[id].key, area: actors[id].area, private: isPrivate(actors[id].key), placeName: placeName(actors[id].key) };
    return { yukiho: one('yukiho'), jugador: one('jugador') };
  }

  function restore(loc, state) {
    if (!view) return;
    syncedState = null;
    syncFrom(state || { location: loc });
    if (state) syncedState = state;
    updateLabel();
    if (window.LifeSim && state) window.LifeSim.render(state);
  }

  // ---------- bitácora ----------
  const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  function renderLog(state) {
    const box = document.getElementById('aptLog');
    if (!box || !state) return;
    syncFrom(state);
    box.replaceChildren();
    const loc = state.location || { yukiho: 'sala', jugador: 'sala' };
    const now = document.createElement('div');
    now.className = 'apt-now';
    now.textContent = `📍 Ahora: Yukiho en ${placeName(loc.yukiho || 'sala')} · ${playerName()} en ${placeName(loc.jugador || loc.saul || 'sala')}`;
    box.append(now);
    const rows = (state.moves || []).slice().reverse();
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'apt-move';
      empty.textContent = 'Todavía nadie se ha movido de la sala. Cuando la historia los lleve a otro lugar o aparezca algo nuevo en el mapa, quedará aquí.';
      box.append(empty);
      return;
    }
    for (const m of rows) {
      const row = document.createElement('div');
      row.className = 'apt-move' + (m.kind === 'mapa' ? (m.ok ? ' is-map' : ' is-rejected') : m.kind === 'rutina' ? ' is-routine' : '');
      row.textContent = m.kind === 'mapa'
        ? `Esc. ${m.ch} · ${hhmm(m.at)} — ${m.ok ? '🖌️' : '✖ rechazado:'} ${m.texto}`
        : `Esc. ${m.ch} · ${hhmm(m.at)} — ${m.kind === 'rutina' ? '🕰️ ' : ''}${who(m.who)}: ${placeName(m.from)} → ${placeName(m.to)}${m.actividad ? ' · ' + m.actividad : ''}`;
      box.append(row);
    }
  }

  // ---------- prompt ----------
  function promptFor(state) {
    syncFrom(state);
    const loc = (state && state.location) || { yukiho: 'sala', jugador: 'sala' };
    const recent = ((state && state.moves) || []).filter((m) => m.kind !== 'mapa').slice(-6)
      .map((m) => `  * Escena ${m.ch}: ${who(m.who)} pasó de ${m.from} a ${m.to}${m.kind === 'rutina' ? ` por su rutina (${m.actividad})` : ''}.`).join('\n');
    return `${window.APARTMENT_PROMPT}
${MA.promptText(world)}
[POSICIÓN ACTUAL EN EL MAPA]: yukiho en "${loc.yukiho || 'sala'}", jugador en "${loc.jugador || loc.saul || 'sala'}". Respeta esta posición: si nadie se mueve, siguen ahí.
${recent ? `[RASTRO DE MOVIMIENTOS RECIENTES]:\n${recent}` : ''}
${window.LifeSim ? window.LifeSim.promptBlock(state) : ''}`;
  }

  // ---------- JSON del modelo ----------
  function salvageJson(raw) {
    const text = String(raw || '');
    const str = (key) => {
      const m = text.match(new RegExp(`"?${key}"?\\s*:?\\s*"((?:[^"\\\\]|\\\\.)*)"`));
      if (!m) return null;
      try { return JSON.parse(`"${m[1]}"`); } catch (e) { return m[1]; }
    };
    const narration = str('narration');
    const dialogue = str('dialogue');
    if (!narration || !dialogue) return null;
    const bond = text.match(/"?bond_change"?\s*:?\s*(-?\d+)/);
    const opts = text.match(/"?options"?\s*:?\s*\[([\s\S]*?)\]/);
    const options = opts ? [...opts[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).slice(0, 3) : [];
    const ubic = text.match(/"?ubicacion"?\s*:?\s*\{([^}]*)\}/);
    const loc = {};
    if (ubic) for (const m of ubic[1].matchAll(/"?(yukiho|jugador|player|saul|saúl)"?\s*:\s*"([^"]+)"/gi)) loc[/yukiho/i.test(m[1]) ? 'yukiho' : 'jugador'] = m[2];
    return {
      narration, dialogue,
      bond_change: bond ? Number(bond[1]) : 5,
      status_text: str('status_text') || 'Contigo',
      options: options.length === 3 ? options : ['Escucharla con calma.', 'Ofrecerle algo caliente.', 'Preguntarle cómo se siente.'],
      ubicacion: loc,
      mapa: MA.salvageMapa(text),
    };
  }

  const DEFAULT_OPTIONS = ['Quedarte a su lado en silencio, escuchando la lluvia.', 'Ofrecerle algo caliente de la cocina.', 'Preguntarle con suavidad qué está pensando.'];
  function cleanScene(data) {
    if (!data || typeof data !== 'object') return data;
    const opts = Array.isArray(data.options) ? data.options.filter((o) => typeof o === 'string' && o.trim() && !/^opci[oó]n \d/i.test(o.trim())) : [];
    return { ...data, options: opts.length >= 2 ? opts.slice(0, 3) : DEFAULT_OPTIONS };
  }

  const css = document.createElement('style');
  css.textContent = `
    .apt-card{background:var(--bg-card,#141020);border:1px solid var(--border-color,#2a2238);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:6px}
    .apt-head{display:flex;justify-content:space-between;align-items:center}
    .apt-title{font-size:12px;font-weight:700;color:var(--accent-teal,#2dd4bf)}
    .apt-toggle{font-size:11px;background:transparent;color:var(--text-muted,#aaa);border:1px solid var(--border-color,#333);border-radius:8px;padding:3px 8px;cursor:pointer}
    .apt-toggle:hover,.apt-toggle:focus-visible{color:#fff;border-color:var(--accent-teal,#2dd4bf)}
    .apt-tabs{display:flex;gap:4px;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px}
    .apt-tab{flex:0 0 auto;font-size:11px;background:#1b1529;color:var(--text-muted,#bbb);border:1px solid var(--border-color,#333);border-radius:999px;padding:3px 10px;cursor:pointer;white-space:nowrap;transition:border-color .15s,color .15s}
    .apt-tab:hover,.apt-tab:focus-visible{color:#fff;border-color:var(--accent-teal,#2dd4bf)}
    .apt-tab.is-active{background:var(--accent-teal,#2dd4bf);color:#0d0a16;border-color:var(--accent-teal,#2dd4bf);font-weight:700}
    .apt-view{width:100%;height:auto;aspect-ratio:7/5;image-rendering:pixelated;border-radius:10px;background:#0d0a16;display:block}
    .apt-label{font-size:11px;color:var(--text-muted,#aaa);text-align:center;min-height:14px}
    .apt-tools{display:flex;align-items:center;gap:6px}
    .apt-portrait{width:30px;height:30px;padding:0;border-radius:50%;overflow:hidden;border:1px solid var(--accent-teal,#2dd4bf);cursor:pointer;background:none}
    .apt-portrait img{width:100%;height:100%;object-fit:cover;display:block}
    .apt-logtitle{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,#aaa);margin-top:4px}
    .apt-log{max-height:260px;overflow:auto;font:12px/1.5 ui-monospace,Consolas,monospace;color:var(--text-muted,#bbb);display:flex;flex-direction:column;gap:3px}
    .apt-now{color:var(--accent-teal,#2dd4bf);font-weight:700}
    .apt-move{border-left:2px solid var(--border-color,#333);padding-left:8px}
    .apt-move.is-map{border-left-color:#f2c14e;color:#e9dcae}
    .apt-move.is-routine{border-left-color:#7fb2c9;color:#cfe3ee}
    .apt-move.is-rejected{border-left-color:#7a3a46;opacity:.7}`;
  document.head.appendChild(css);

  window.ApartmentMap = { mount, restore, track, routineMove, snapshot, renderLog, promptFor, salvageJson, cleanScene, get world() { return world; }, get viewArea() { return viewArea; } };
})();
