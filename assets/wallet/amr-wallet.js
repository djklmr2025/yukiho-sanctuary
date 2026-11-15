/*
 * ARKAIOS · Billetera AMR del juego (cliente). El saldo lo decide /api/wallet; aquí solo se muestra.
 * userState.amrBalance queda como copia para pintar la interfaz: editarla no da AMR.
 * API: window.AmrWallet
 */
(function () {
  const API = '/api/wallet';
  const KEY = 'arkaios_amr_session';
  const LOGIN_MSG = 'Inicia sesión con Google para usar AMR.';
  let especiales = null;
  let albumes = null;

  // Foto completa de un álbum desbloqueado: se pide con la sesión y se devuelve como URL local (blob).
  async function albumPhoto(album, n) {
    const r = await fetch(`/api/album?a=${encodeURIComponent(album)}&f=${encodeURIComponent(n)}`, {
      headers: { Authorization: `Bearer ${read()}` },
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo cargar la foto.');
    return URL.createObjectURL(await r.blob());
  }

  const read = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const write = (v) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* almacenamiento bloqueado */ } };

  function apply(wallet) {
    if (!wallet || typeof wallet.balance !== 'number') return wallet;
    const st = typeof userState !== 'undefined' ? userState : null;   // eslint-disable-line no-undef
    if (st) {
      st.amrBalance = wallet.balance;
      st.amrOwned = wallet.owned || [];
      try { if (typeof saveUserStory === 'function') saveUserStory(false); } catch (e) { /* opcional */ } // eslint-disable-line no-undef
    }
    for (const fn of ['updateBazaarUI', 'updatePassportUI', 'updateStatus']) {
      try { if (typeof window[fn] === 'function') window[fn](); } catch (e) { /* UI opcional */ }
    }
    try { if (typeof window.updateCloudStatusBadge === 'function') window.updateCloudStatusBadge(true); } catch (e) { /* opcional */ }
    return wallet;
  }

  async function request(method, body) {
    const session = read();
    if (!session && !(body && body.op === 'login')) throw new Error(LOGIN_MSG);
    let r;
    try {
      r = await fetch(API, {
        method,
        headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new Error('Sin conexión con la billetera AMR. Intenta de nuevo.'); }
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) { write(''); throw new Error(data.error || LOGIN_MSG); }
    if (!r.ok) throw new Error(data.error || 'La billetera AMR no respondió.');
    if (data.session) write(data.session);
    if (Array.isArray(data.especiales)) especiales = data.especiales;
    if (Array.isArray(data.albumes)) albumes = data.albumes;
    apply(data.wallet);
    return data;
  }

  window.AmrWallet = {
    LOGIN_MSG,
    signedIn: () => !!read(),
    logout: () => write(''),
    login: (credential) => request('POST', { op: 'login', credential }),
    refresh: () => (read() ? request('GET') : Promise.resolve(null)),
    daily: () => request('POST', { op: 'daily' }),
    buy: (item) => request('POST', { op: 'buy', item }),
    redeem: (code) => request('POST', { op: 'redeem', code }),
    scene: (scene) => request('POST', { op: 'scene', scene }),
    special: (id, s) => request('POST', { op: 'special', id, s }),
    specials: async () => { if (!especiales && read()) await request('GET'); return especiales || []; },
    albums: async () => { if (!albumes && read()) await request('GET'); return albumes || []; },
    photo: albumPhoto,
    owns: (item) => { const st = typeof userState !== 'undefined' ? userState : null; return !!(st && (st.amrOwned || []).includes(item)); }, // eslint-disable-line no-undef
  };
})();
