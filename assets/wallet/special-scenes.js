/*
 * ARKAIOS · Escenas especiales de pago (cliente). El catálogo, el precio y el prompt viven en el servidor
 * (api/_lib/specials.js); aquí solo se elige y se paga con AmrWallet. La escena pagada entra a "Escenas del día".
 * API: window.SpecialScenes
 */
(function () {
  let overlay = null;

  const seed = () => Math.floor(Math.random() * 2147483646) + 1;
  const getState = () => (typeof userState !== 'undefined' ? userState : null);   // eslint-disable-line no-undef

  function close() { if (overlay) { overlay.remove(); overlay = null; } }

  function addToScenes(state, url, titulo) {
    state.escenas = (state.escenas || []).concat({
      url, caption: `✨ ${titulo}`, at: new Date().toISOString(), key: 'especial', noche: false, pagada: true, especial: true,
    }).slice(-12);
    try { if (typeof saveUserStory === 'function') saveUserStory(false); } catch (e) { /* opcional */ } // eslint-disable-line no-undef
    if (window.LifeSim) window.LifeSim.render(state);
  }

  function row(item, msg) {
    const li = document.createElement('li');
    li.className = 'esp-row';
    const name = document.createElement('span');
    name.className = 'esp-name';
    name.textContent = item.titulo;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'apt-toggle';
    const locked = item.requiere && !window.AmrWallet.owns(item.requiere);
    b.textContent = locked ? '🔒 Requiere atuendo' : `🎨 ${item.precio} AMR`;
    b.disabled = !!locked;
    if (locked) b.title = 'Consíguelo primero en el Vestidor del bazar';
    b.onclick = async () => {
      const state = getState();
      if (!state) return;
      b.disabled = true; msg.textContent = 'Cobrando en tu billetera AMR…';
      try {
        const r = await window.AmrWallet.special(item.id, seed());
        addToScenes(state, r.url, r.titulo || item.titulo);
        close();
      } catch (e) {
        msg.textContent = e.message; b.disabled = false;
      }
    };
    li.append(name, b);
    return li;
  }

  async function open() {
    close();
    overlay = document.createElement('div');
    overlay.className = 'esp-overlay';
    overlay.onclick = (ev) => { if (ev.target === overlay) close(); };
    const card = document.createElement('div');
    card.className = 'esp-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Escenas especiales');
    const h = document.createElement('div');
    h.className = 'esp-title'; h.textContent = '✨ Escenas especiales con Yukiho';
    const sub = document.createElement('div');
    sub.className = 'esp-sub'; sub.textContent = 'Momentos ilustrados fuera de la rutina. Cada una se pinta una vez y se queda en tus escenas.';
    const msg = document.createElement('div');
    msg.className = 'esp-msg';
    const list = document.createElement('ul');
    list.className = 'esp-list';
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'esp-close'; x.textContent = '✕'; x.setAttribute('aria-label', 'Cerrar'); x.onclick = close;
    card.append(x, h, sub, list, msg);
    overlay.append(card);
    document.body.append(overlay);

    if (!window.AmrWallet || !window.AmrWallet.signedIn()) { msg.textContent = 'Inicia sesión con Google para usar AMR.'; return; }
    msg.textContent = 'Cargando catálogo…';
    try {
      const items = await window.AmrWallet.specials();
      msg.textContent = '';
      for (const it of items) list.append(row(it, msg));
    } catch (e) { msg.textContent = e.message; }
  }

  function button() {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'apt-toggle esp-open'; b.textContent = '✨ Especiales';
    b.onclick = open;
    return b;
  }

  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });

  const css = document.createElement('style');
  css.textContent = `
    .esp-overlay{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:16px;background:rgba(8,6,14,.72)}
    .esp-card{position:relative;width:min(440px,100%);max-height:85vh;overflow:auto;padding:18px 16px 14px;border-radius:14px;
      background:#15101f;border:1px solid rgba(192,132,252,.35);box-shadow:0 18px 50px rgba(0,0,0,.5);color:#f4f1ea}
    .esp-title{font-weight:800;font-size:15px;color:#c084fc;margin-bottom:4px}
    .esp-sub{font-size:12px;color:var(--text-muted,#aaa);margin-bottom:10px}
    .esp-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
    .esp-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04)}
    .esp-name{font-size:13px}
    .esp-row .apt-toggle{flex:0 0 auto;white-space:nowrap}
    .esp-msg{font-size:12px;margin-top:10px;color:#fbbf24}
    .esp-msg:empty{display:none}
    .esp-close{position:absolute;top:8px;right:10px;background:none;border:0;color:#f4f1ea;font-size:16px;cursor:pointer;opacity:.7}
    .esp-close:hover,.esp-close:focus-visible{opacity:1}`;
  document.head.appendChild(css);

  window.SpecialScenes = { open, close, button };
})();
