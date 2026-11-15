/*
 * ARKAIOS · Vida propia en el navegador: cuando nadie está platicando, Yukiho y el jugador siguen su rutina
 * (life-routine.js) por el mapa, y los momentos de Yukiho quedan como "escenas". Pintar una escena cuesta AMR y la
 * pinta /api/escena (modelo de pago; la llave vive en el servidor). Se ve con acercamiento lento + lluvia de noche.
 * Las escenas se guardan en userState.escenas.
 * Requiere map-actions.js, life-routine.js y apartment-map.js. API: window.LifeSim
 */
(function () {
  const LR = window.LifeRoutine;
  const TICK_MS = 30000;          // cada cuánto revisa el reloj
  const IDLE_MS = 90000;          // sin turnos de historia por este tiempo = la vida sigue sola
  const MAX_SCENES = 12;
  let clock = () => new Date();
  let selected = -1;              // escena mostrada en grande (-1 = la más reciente)
  let rendered = null;

  const getState = () => (typeof userState !== 'undefined' ? userState : null);   // eslint-disable-line no-undef
  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  const nowHour = () => LR.hourIn(clock());
  function save(state) { try { if (typeof saveUserStory === 'function' && !state.busy) saveUserStory(false); } catch (e) { /* guardar es opcional */ } } // eslint-disable-line no-undef

  function currentSlots() {
    const w = window.ApartmentMap.world, h = nowHour();
    return { yukiho: LR.routineFor(w, 'yukiho', h), jugador: LR.routineFor(w, 'jugador', h) };
  }

  // La historia manda en la franja actual: la rutina espera a la siguiente franja.
  function onStoryTurn(state) {
    const cur = currentSlots();
    state.rutina = { yukiho: cur.yukiho && cur.yukiho.slot, jugador: cur.jugador && cur.jugador.slot };
    render(state);
  }

  function tick() {
    const state = getState();
    if (!state || state.busy || !window.ApartmentMap) return;
    if (rendered !== state) render(state);
    if (Date.now() - (state.lastTurnAt || 0) < IDLE_MS) return;
    const cur = currentSlots(), plan = {};
    for (const who of ['yukiho', 'jugador']) if (cur[who] && (state.rutina || {})[who] !== cur[who].slot) plan[who] = cur[who];
    if (!Object.keys(plan).length) return;
    const moved = window.ApartmentMap.routineMove(state, plan);
    state.rutina = { ...(state.rutina || {}), ...Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.slot])) };
    if (moved.some((m) => m.who === 'yukiho')) addScene(state, plan.yukiho);   // queda pendiente: se pinta solo si el jugador paga
    save(state);
  }

  // ---------- imágenes: cola ----------
  // /api/escena acepta una escena nueva cada 20 s por jugador; las imágenes ya pintadas salen de la caché
  // (Cache-Control: immutable), así que se piden de una en una con <img> y solo la primera vez cuesta.
  const API = '/api/escena';
  const SCENE_COST_AMR = 2;
  const GAP_MS = 21000;
  const MAX_TRIES = 3;
  const CACHE_HIT_MS = 2500;
  const loaded = new Set(), pending = new Map(), queue = [];
  let lastGen = 0, pumping = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tryImage = (url) => new Promise((resolve) => { const im = new Image(); im.onload = () => resolve(true); im.onerror = () => resolve(false); im.src = url; });
  const isApiScene = (s) => String((s && s.url) || '').startsWith(API);

  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      const job = queue[0];
      await sleep(Math.max(0, lastGen + GAP_MS - Date.now()));
      const t0 = Date.now();
      const ok = await tryImage(job.url);
      if (!ok || Date.now() - t0 > CACHE_HIT_MS) lastGen = t0;   // una imagen en caché no gasta el turno
      if (ok) { queue.shift(); loaded.add(job.url); job.resolve(job.url); }
      else if (++job.tries >= MAX_TRIES) { queue.shift(); job.reject(new Error('imagen no disponible')); }
    }
    pumping = false;
  }

  function loadScene(url) {
    if (loaded.has(url)) return Promise.resolve(url);
    if (pending.has(url)) return pending.get(url);
    const p = new Promise((resolve, reject) => { queue.push({ url, resolve, reject, tries: 0 }); pump(); });
    pending.set(url, p);
    p.catch(() => {}).then(() => pending.delete(url));
    return p;
  }

  // ---------- AMR ----------
  const balanceOf = (state) => Number(state.amrBalance !== undefined ? state.amrBalance : 0);
  function refreshWallet() {
    for (const fn of ['updateBazaarUI', 'updatePassportUI', 'updateStatus']) { try { if (typeof window[fn] === 'function') window[fn](); } catch (e) { /* UI opcional */ } }
  }
  // El cobro lo hace /api/wallet en el servidor y devuelve la URL con el boleto de la escena pagada.
  async function charge(state, scene) {
    if (!window.AmrWallet || !window.AmrWallet.signedIn()) return 'Inicia sesión con Google para pintar escenas con AMR.';
    const p = new URLSearchParams(String(scene.url).split('?')[1] || '');
    try {
      const r = await window.AmrWallet.scene({ lugar: p.get('lugar'), slot: p.get('slot') || '', h: p.get('h'), t: p.get('t'), s: p.get('s'), n: p.get('n') || '' });
      scene.url = r.url;
      scene.pagada = true; scene.reembolsada = false;
      save(state);
      return null;
    } catch (e) { return e.message; }
  }
  // Tras 3 fallas el servidor regresa los AMR; aquí solo se marca y se relee el saldo.
  function refund(state, scene) {
    if (!scene.pagada || scene.reembolsada) return;
    scene.url = String(scene.url).replace(/&tk=[^&]*/, '');
    scene.pagada = false; scene.reembolsada = true;
    save(state);
    if (window.AmrWallet) window.AmrWallet.refresh().catch(() => {});
  }

  // ---------- escenas ----------
  // Lugar con el nombre de su plantilla ("escuela.salon" de partidas viejas -> "universidad.salon").
  function templateKey(key) {
    const p = window.MapActions.resolvePlace(window.ApartmentMap.world, key);
    if (!p || p.area === window.MapActions.HOME) return p ? p.cuarto : key;
    const a = window.ApartmentMap.world.areas.find((x) => x.id === p.area);
    return `${a && a.plantilla !== 'personalizada' ? a.plantilla : p.area}.${p.cuarto}`;
  }

  function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h) % 2147483647; }

  // Crea la escena del momento actual. Las de la rutina quedan pendientes: solo se pintan si el jugador paga.
  function addScene(state, step, opts) {
    const pay = !!(opts && opts.pay);
    const snap = window.ApartmentMap.snapshot();
    const y = snap.yukiho;
    if (!y) return { error: 'Yukiho todavía no está en el mapa.' };
    const h = nowHour();
    const routine = currentSlots().yukiho;
    const fromRoutine = step || (routine && routine.key === y.key ? routine : null);
    const together = !!(snap.jugador && snap.jugador.key === y.key);
    const lugar = templateKey(y.key);
    if (!LR.scenePrompt({ key: lugar, placeName: y.placeName, en: 'x', hour: h, together, private: y.private })) {
      return { error: y.private ? 'Es un momento privado: la cortina se queda cerrada.' : 'Este lugar no se ilustra.' };
    }
    const day = clock().toISOString().slice(0, 10);
    const slot = fromRoutine ? fromRoutine.slot : '';
    const q = new URLSearchParams({ lugar, slot, h: h.toFixed(2), t: together ? '1' : '0', s: String(hash(`${day}|${lugar}|${slot || 'momento'}|${state.chapter}`)) });
    if (y.placeName) q.set('n', y.placeName);
    const scene = {
      url: `${API}?${q}`,
      caption: `${hhmm(h)} · Yukiho ${fromRoutine ? fromRoutine.actividad : 'contigo'} · ${y.placeName}`,
      at: new Date().toISOString(), key: y.key, noche: h < 6 || h >= 19, pagada: false,
    };
    if (pay && !(window.AmrWallet && window.AmrWallet.signedIn())) return { error: 'Inicia sesión con Google para pintar escenas con AMR.' };
    state.escenas = (state.escenas || []).concat(scene).slice(-MAX_SCENES);
    selected = -1;
    render(state);
    if (!pay) return { scene };
    const paid = charge(state, scene).then((err) => { render(state); return err; });
    return { scene, paid };
  }

  function stage(state, scene, box, onRemove) {
    const st = document.createElement('div');
    st.className = 'scene-stage';
    const wait = document.createElement('div');
    wait.className = 'scene-wait';
    const cap = document.createElement('div');
    cap.className = 'scene-caption'; cap.textContent = scene.caption;
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'scene-del'; del.textContent = '✕ Quitar'; del.title = 'Descartar esta escena';
    del.onclick = (ev) => { ev.stopPropagation(); onRemove(); };

    if (!scene.pagada) {
      const payBox = document.createElement('div');
      payBox.className = 'scene-pay';
      const msg = document.createElement('div');
      msg.textContent = scene.reembolsada ? 'No se pudo pintar esta escena; se te regresaron tus AMR.' : 'Este momento todavía no está pintado.';
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'apt-toggle';
      b.textContent = `🎨 Pintar esta escena · ${SCENE_COST_AMR} AMR (tienes ${balanceOf(state)})`;
      b.onclick = async (ev) => {
        ev.stopPropagation();
        b.disabled = true; msg.textContent = 'Cobrando en tu billetera AMR…';
        const err = await charge(state, scene);
        if (err) { msg.textContent = err; b.disabled = false; } else render(state);
      };
      payBox.append(msg, b);
      wait.append(payBox);
      st.append(wait, cap, del);
      box.append(st);
      return;
    }

    const img = document.createElement('img');
    img.alt = scene.caption; img.decoding = 'async';
    wait.textContent = '🎨 Pintando la escena…';
    img.onload = () => { wait.remove(); st.classList.add('is-ready'); };
    const failed = () => { refund(state, scene); render(state); };
    loadScene(scene.url).then((src) => { img.src = src; }, failed);
    st.append(img, wait);
    if (scene.noche) { const rain = document.createElement('div'); rain.className = 'scene-rain'; st.append(rain); }
    st.append(cap, del);
    st.onclick = () => { if (typeof openLightbox === 'function') openLightbox(scene.url); }; // eslint-disable-line no-undef
    box.append(st);
  }

  function render(state) {
    const box = document.getElementById('aptScenes');
    if (!box || !state) return;
    rendered = state;
    // Las escenas del generador gratis anterior se descartan: eran de baja calidad.
    if ((state.escenas || []).some((s) => !isApiScene(s))) state.escenas = state.escenas.filter(isApiScene);
    box.replaceChildren();
    const head = document.createElement('div');
    head.className = 'scene-head';
    const title = document.createElement('span');
    title.className = 'apt-logtitle'; title.textContent = '🎞️ Escenas del día';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'apt-toggle'; btn.textContent = `📸 Ilustrar este momento · ${SCENE_COST_AMR} AMR`;
    const note = document.createElement('div');
    note.className = 'scene-note';
    btn.onclick = async () => {
      const r = addScene(state, null, { pay: true });
      if (r.error) { note.textContent = r.error; return; }
      const err = await r.paid;
      if (err) { const n = document.querySelector('#aptScenes .scene-note'); if (n) n.textContent = err; }
    };
    head.append(title, btn);
    if (window.SpecialScenes) head.append(window.SpecialScenes.button(state));
    if (window.PhotoAlbums) head.append(window.PhotoAlbums.button());
    box.append(head, note);
    const list = state.escenas || [];
    if (!list.length) {
      note.textContent = `Cuando Yukiho siga su rutina, aquí aparecerán sus momentos. Pintar cada escena cuesta ${SCENE_COST_AMR} AMR; las ya pintadas se quedan guardadas.`;
      return;
    }
    const idx = selected < 0 || selected >= list.length ? list.length - 1 : selected;
    stage(state, list[idx], box, () => { state.escenas = list.filter((_, i) => i !== idx); selected = -1; save(state); render(state); });
    if (list.length > 1) {
      const thumbs = document.createElement('div');
      thumbs.className = 'scene-thumbs';
      list.forEach((s, i) => {
        const t = document.createElement('button');
        t.type = 'button'; t.className = 'scene-thumb' + (i === idx ? ' is-active' : '') + (s.pagada ? '' : ' is-pending'); t.title = s.caption;
        if (s.pagada) { const im = document.createElement('img'); im.alt = s.caption; loadScene(s.url).then((src) => { im.src = src; }, () => {}); t.append(im); }
        else t.textContent = '🎨';
        t.onclick = () => { selected = i; render(state); };
        thumbs.append(t);
      });
      box.append(thumbs);
    }
  }

  // ---------- conocimiento para la IA ----------
  function promptBlock(state) {
    const cur = currentSlots(), h = nowHour();
    const line = (who, name) => (cur[who] ? `${name} estaría en "${cur[who].key}" (${cur[who].actividad})` : '');
    return `[VIDA DIARIA]: Son las ${hhmm(h)} en Cancún. Según su rutina, ${line('yukiho', 'Yukiho')} y ${line('jugador', 'el jugador')}.
Cuando no platican, cada quien sigue su día por el mapa; si el rastro dice que alguien se movió por su rutina, retómalo con naturalidad.`;
  }

  const css = document.createElement('style');
  css.textContent = `
    .apt-scenes{display:flex;flex-direction:column;gap:6px;margin-top:4px}
    .scene-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
    .scene-note{font-size:11px;color:var(--text-muted,#aaa)}
    .scene-note:empty{display:none}
    .scene-stage{position:relative;width:100%;aspect-ratio:4/5;max-height:380px;overflow:hidden;border-radius:10px;background:#0d0a16;cursor:zoom-in}
    .scene-stage img{width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .8s}
    .scene-stage.is-ready img{opacity:1;animation:scene-kb 24s ease-in-out infinite alternate}
    @keyframes scene-kb{from{transform:scale(1.02) translate(0,0)}to{transform:scale(1.14) translate(-2%,-3%)}}
    .scene-wait{position:absolute;inset:0;display:grid;place-items:center;padding:16px;text-align:center;font-size:12px;color:var(--text-muted,#bbb)}
    .scene-rain{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(105deg,transparent 0 9px,rgba(200,220,255,.16) 9px 10px);background-size:46px 140px;animation:scene-rain .7s linear infinite}
    @keyframes scene-rain{to{background-position:-24px 140px}}
    .scene-del{position:absolute;top:6px;right:6px;font-size:10px;padding:2px 7px;border-radius:8px;border:1px solid rgba(255,255,255,.3);background:rgba(13,10,22,.7);color:#f4f1ea;cursor:pointer;opacity:.75}
    .scene-del:hover,.scene-del:focus-visible{opacity:1;border-color:var(--accent-teal,#2dd4bf)}
    .scene-caption{position:absolute;left:0;right:0;bottom:0;padding:18px 10px 8px;font-size:11px;color:#f4f1ea;background:linear-gradient(transparent,rgba(13,10,22,.85))}
    .scene-thumbs{display:flex;gap:4px;overflow-x:auto;padding-bottom:2px}
    .scene-thumb{flex:0 0 auto;width:42px;height:52px;padding:0;border:1px solid var(--border-color,#333);border-radius:6px;overflow:hidden;cursor:pointer;background:#0d0a16}
    .scene-thumb img{width:100%;height:100%;object-fit:cover;display:block}
    .scene-pay{display:flex;flex-direction:column;gap:10px;align-items:center;max-width:260px}
    .scene-thumb.is-pending{display:grid;place-items:center;font-size:18px;color:var(--text-muted,#aaa)}
    .scene-thumb.is-active{border-color:var(--accent-teal,#2dd4bf)}
    @media (prefers-reduced-motion: reduce){.scene-stage.is-ready img,.scene-rain{animation:none}}`;
  document.head.appendChild(css);

  function start() { setTimeout(tick, 3000); setInterval(tick, TICK_MS); }
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);

  window.LifeSim = { tick, onStoryTurn, promptBlock, render, addScene, setClock: (fn) => { clock = fn; }, IDLE_MS };
})();
