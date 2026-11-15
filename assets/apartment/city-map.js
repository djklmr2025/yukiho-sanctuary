/*
 * ARKAIOS · Vista general de Cancún para el mapa vivo: zonas que se descubren conforme avanza la historia.
 * Una zona está descubierta cuando existe al menos un área con esa zona (el edificio siempre lo está).
 * La niebla de una zona nueva se disipa poco a poco. Dibujo a 112x80 px lógicos, escalado a la vista.
 * API: CityMap.draw(ctx, W, H, info, time) · CityMap.hitTest(x, y, W, H) -> zona | null
 */
(function () {
  const LW = 112, LH = 80;
  const FOG_FADE_MS = 1800;

  // Rectángulos en px lógicos; la zona hotelera tiene forma de "7" como la real (franja entre la laguna y el mar).
  const ZONES = {
    edificio: { rects: [[26, 44, 16, 12]], ground: '#7a6a8a', block: '#5b4b6e', label: [34, 50] },
    centro: { rects: [[18, 16, 30, 22]], ground: '#8a8f99', block: '#62666e', label: [33, 27] },
    zona_universitaria: { rects: [[4, 50, 20, 22]], ground: '#5f8a54', block: '#c9b48e', label: [14, 61] },
    parque: { rects: [[44, 46, 14, 14]], ground: '#4f8a3c', block: '#2f6b3a', label: [51, 53] },
    zona_hotelera: { rects: [[62, 8, 36, 6], [92, 8, 6, 66]], ground: '#e3cf9a', block: '#f4f1ea', label: [80, 11] },
    playa: { rects: [[98, 20, 5, 54]], ground: '#f0dca8', block: '#e46a8a', label: [100, 47] },
    otra: { rects: [[4, 6, 12, 12]], ground: '#6c6f75', block: '#8b8f96', label: [10, 12] },
  };
  const ROADS = [[34, 50, 33, 27], [34, 50, 14, 61], [34, 50, 51, 53], [33, 27, 80, 11], [33, 27, 10, 12], [51, 53, 95, 53]];

  const fog = {};           // zona -> { since } cuando se descubrió en esta sesión
  let known = null;          // zonas descubiertas en el cuadro anterior

  function hash(x, y) { const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return n - Math.floor(n); }

  function drawBase(c, time) {
    c.fillStyle = '#1f5f86'; c.fillRect(0, 0, LW, LH);                        // mar Caribe
    for (let i = 0; i < 40; i++) { const x = (i * 37 + Math.floor(time / 90)) % LW, y = (i * 19) % LH; if (x > 96) { c.fillStyle = '#3f8fb8'; c.fillRect(x, y, 2, 1); } }
    c.fillStyle = '#3d6b4a'; c.fillRect(0, 0, 90, LH);                         // tierra firme
    c.fillStyle = '#2f7aa0'; c.fillRect(60, 16, 30, 58);                       // laguna Nichupté
    c.fillStyle = '#4a8fb5'; for (let y = 18; y < 72; y += 6) c.fillRect(64 + (y % 12), y, 6, 1);
  }

  function drawRoads(c) {
    c.fillStyle = '#c9ccd1';
    for (const [x1, y1, x2, y2] of ROADS) {
      const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      for (let i = 0; i <= n; i += 1) { if (i % 3 === 2) continue; c.fillRect(Math.round(x1 + (x2 - x1) * i / n), Math.round(y1 + (y2 - y1) * i / n), 1, 1); }
    }
  }

  function drawZone(c, z, id) {
    for (const [x, y, w, h] of z.rects) {
      c.fillStyle = z.ground; c.fillRect(x, y, w, h);
      for (let j = y + 1; j < y + h - 1; j += 3) for (let i = x + 1; i < x + w - 1; i += 3) if (hash(i, j) > 0.45) { c.fillStyle = z.block; c.fillRect(i, j, 2, 2); }
      if (id === 'zona_hotelera') { c.fillStyle = '#3fa9d6'; c.fillRect(x + 2, y + 2, 2, 1); }
    }
  }

  function drawFog(c, z, alpha) {
    for (const [x, y, w, h] of z.rects) for (let j = y - 1; j < y + h + 1; j++) for (let i = x - 1; i < x + w + 1; i++) {
      c.fillStyle = hash(i, j) > 0.5 ? `rgba(24,18,38,${alpha})` : `rgba(44,34,64,${alpha})`;
      c.fillRect(i, j, 1, 1);
    }
  }

  let buf = null;
  function draw(ctx, W, H, info, time) {
    if (!buf) { buf = document.createElement('canvas'); buf.width = LW; buf.height = LH; }
    const c = buf.getContext('2d');
    const now = new Set(info.discovered);
    if (known) for (const z of now) if (!known.has(z)) fog[z] = { since: time };
    known = now;
    drawBase(c, time);
    drawRoads(c);
    for (const [id, z] of Object.entries(ZONES)) drawZone(c, z, id);
    for (const [id, z] of Object.entries(ZONES)) {
      let a = now.has(id) ? 0 : 0.95;
      if (now.has(id) && fog[id]) { a = Math.max(0, 0.95 * (1 - (time - fog[id].since) / FOG_FADE_MS)); if (!a) delete fog[id]; }
      if (a > 0) drawFog(c, z, a);
    }
    c.fillStyle = 'rgba(10,8,30,.22)'; c.fillRect(0, 0, LW, LH);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 0, 0, W, H);
    const sx = W / LW, sy = H / LH;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [id, z] of Object.entries(ZONES)) {
      const [lx, ly] = z.label, x = lx * sx, y = ly * sy;
      if (!now.has(id)) { ctx.font = 'bold 16px ui-monospace,Consolas,monospace'; ctx.fillStyle = 'rgba(200,190,230,.55)'; ctx.fillText('?', x, y); continue; }
      const name = info.zoneNames[id] || id;
      ctx.font = 'bold 11px system-ui,sans-serif';
      const tw = ctx.measureText(name).width + 10;
      ctx.fillStyle = id === info.selected ? 'rgba(45,212,191,.92)' : 'rgba(13,10,22,.78)';
      ctx.fillRect(x - tw / 2, y - 9, tw, 18);
      ctx.fillStyle = id === info.selected ? '#0d0a16' : '#f4f1ea';
      ctx.fillText(name, x, y);
      const who = info.chars[id] || '';
      if (who) { ctx.font = '13px system-ui,sans-serif'; ctx.fillText(who, x, y + 18); }
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  function hitTest(px, py, W, H) {
    const x = px * LW / W, y = py * LH / H;
    for (const [id, z] of Object.entries(ZONES)) for (const [rx, ry, w, h] of z.rects) if (x >= rx - 1 && y >= ry - 1 && x < rx + w + 1 && y < ry + h + 1) return id;
    return null;
  }

  window.CityMap = { draw, hitTest, zones: Object.keys(ZONES) };
})();
