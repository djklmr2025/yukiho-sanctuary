/*
 * ARKAIOS · Álbumes de fotos (cliente). El catálogo y el cobro viven en el servidor (api/_lib/albums.js,
 * /api/wallet op 'buy'); las fotos completas solo las entrega /api/album a quien desbloqueó el álbum.
 * Aquí se muestran miniaturas borrosas, se paga con AmrWallet y se abren las fotos.
 * API: window.PhotoAlbums
 */
(function () {
  let overlay = null;
  let photoUrls = [];

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  function close() {
    photoUrls.forEach((url) => URL.revokeObjectURL(url));
    photoUrls = [];
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function zoom(url, titulo) {
    const view = el('div', 'alb-zoom');
    view.setAttribute('role', 'dialog');
    view.setAttribute('aria-label', titulo);
    const img = el('img');
    img.src = url; img.alt = titulo;
    view.append(img, el('div', 'alb-zoom-cap', titulo));
    view.onclick = () => view.remove();
    overlay.append(view);
  }

  function tile(album, foto, unlocked) {
    const cell = el('button', unlocked ? 'alb-tile' : 'alb-tile alb-locked');
    cell.type = 'button';
    cell.title = foto.titulo;
    const img = el('img');
    img.alt = unlocked ? foto.titulo : `${foto.titulo} (bloqueada)`;
    img.src = foto.mini;
    cell.append(img);
    if (!unlocked) { cell.disabled = true; cell.append(el('span', 'alb-lock', '🔒')); return cell; }
    window.AmrWallet.photo(album.id, foto.n).then((url) => {
      photoUrls.push(url);
      img.src = url;
      cell.classList.add('alb-ready');
      cell.onclick = () => zoom(url, foto.titulo);
    }).catch(() => { cell.title = 'No se pudo cargar esta foto'; });
    return cell;
  }

  function section(album, msg) {
    const box = el('section', 'alb-album');
    const head = el('div', 'alb-head');
    const grid = el('div', 'alb-grid');
    const paint = () => {
      const unlocked = window.AmrWallet.owns(album.item);
      head.replaceChildren(el('span', 'alb-name', album.titulo));
      grid.replaceChildren(...album.fotos.map((foto) => tile(album, foto, unlocked)));
      if (unlocked) { head.append(el('span', 'alb-owned', '✓ Desbloqueado')); return; }
      const buy = el('button', 'apt-toggle', `🔓 ${album.precio} AMR`);
      buy.type = 'button';
      buy.onclick = async () => {
        buy.disabled = true; msg.textContent = 'Cobrando en tu billetera AMR…';
        try { await window.AmrWallet.buy(album.item); msg.textContent = ''; paint(); }
        catch (e) { msg.textContent = e.message; buy.disabled = false; }
      };
      head.append(buy);
    };
    paint();
    box.append(head, grid);
    return box;
  }

  async function open() {
    close();
    overlay = el('div', 'alb-overlay');
    overlay.onclick = (ev) => { if (ev.target === overlay) close(); };
    const card = el('div', 'alb-card');
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Álbumes de fotos');
    const x = el('button', 'alb-close', '✕');
    x.type = 'button'; x.setAttribute('aria-label', 'Cerrar'); x.onclick = close;
    const list = el('div', 'alb-list');
    const msg = el('div', 'alb-msg');
    card.append(x, el('div', 'alb-title', '📷 Álbumes de Yukiho'),
      el('div', 'alb-sub', 'Colecciones de ilustraciones. Se desbloquean una vez y son tuyas para siempre.'), list, msg);
    overlay.append(card);
    document.body.append(overlay);

    if (!window.AmrWallet || !window.AmrWallet.signedIn()) { msg.textContent = 'Inicia sesión con Google para usar AMR.'; return; }
    msg.textContent = 'Cargando álbumes…';
    try {
      const albums = await window.AmrWallet.albums();
      msg.textContent = albums.length ? '' : 'Todavía no hay álbumes.';
      if (overlay) list.append(...albums.map((album) => section(album, msg)));
    } catch (e) { msg.textContent = e.message; }
  }

  function button() {
    const b = el('button', 'apt-toggle alb-open', '📷 Álbumes');
    b.type = 'button';
    b.onclick = open;
    return b;
  }

  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });

  const css = document.createElement('style');
  css.textContent = `
    .alb-overlay{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:16px;background:rgba(8,6,14,.78)}
    .alb-card{position:relative;width:min(520px,100%);max-height:88vh;overflow:auto;padding:18px 16px 14px;border-radius:14px;
      background:#15101f;border:1px solid rgba(251,191,36,.35);box-shadow:0 18px 50px rgba(0,0,0,.5);color:#f4f1ea}
    .alb-title{font-weight:800;font-size:15px;color:#fbbf24;margin-bottom:4px}
    .alb-sub{font-size:12px;color:var(--text-muted,#aaa);margin-bottom:12px}
    .alb-album+.alb-album{margin-top:16px}
    .alb-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}
    .alb-name{font-size:14px;font-weight:700}
    .alb-owned{font-size:12px;color:#86efac}
    .alb-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .alb-tile{position:relative;aspect-ratio:2/3;padding:0;border:1px solid rgba(255,255,255,.12);border-radius:10px;overflow:hidden;background:#0d0a14;cursor:default}
    .alb-tile img{width:100%;height:100%;object-fit:cover;display:block;filter:blur(6px);transform:scale(1.15);transition:filter .3s ease,transform .3s ease}
    .alb-ready{cursor:zoom-in}
    .alb-ready img{filter:none;transform:none}
    .alb-ready:hover img,.alb-ready:focus-visible img{transform:scale(1.04)}
    .alb-tile:focus-visible{outline:2px solid #fbbf24;outline-offset:2px}
    .alb-lock{position:absolute;inset:0;display:grid;place-items:center;font-size:22px;background:rgba(8,6,14,.35)}
    .alb-msg{font-size:12px;margin-top:10px;color:#fbbf24}
    .alb-msg:empty{display:none}
    .alb-close{position:absolute;top:8px;right:10px;background:none;border:0;color:#f4f1ea;font-size:16px;cursor:pointer;opacity:.7}
    .alb-close:hover,.alb-close:focus-visible{opacity:1}
    .alb-zoom{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;align-content:center;gap:8px;padding:12px;background:rgba(8,6,14,.94);cursor:zoom-out}
    .alb-zoom img{max-width:100%;max-height:86vh;border-radius:10px}
    .alb-zoom-cap{font-size:13px;color:#f4f1ea}`;
  document.head.appendChild(css);

  window.PhotoAlbums = { open, close, button };
})();
