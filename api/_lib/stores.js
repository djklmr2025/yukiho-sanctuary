/*
 * Stores para el libro mayor: memoria (pruebas y servidor local) y Firestore (Vercel, Admin SDK).
 * Interfaz: runTransaction(async (tx) => { await tx.get(path); tx.set(path, data); })
 * En Firestore todas las lecturas van antes que las escrituras; ledger.js respeta ese orden.
 */
function createMemoryStore(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  let chain = Promise.resolve();
  return {
    docs,
    runTransaction(fn) {
      const run = chain.then(async () => {
        const writes = new Map();
        const tx = {
          get: async (p) => (docs.has(p) ? structuredClone(docs.get(p)) : null),
          set: (p, d) => { writes.set(p, structuredClone(d)); },
        };
        const out = await fn(tx);
        for (const [p, d] of writes) docs.set(p, d);
        return out;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}

let firestoreStore = null;
function getFirestoreStore() {
  if (firestoreStore) return firestoreStore;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const database = process.env.LEDGER_DATABASE || '(default)';   // proyecto Firebase aparte: yukiho-ledger
  if (!raw) throw new Error('falta FIREBASE_SERVICE_ACCOUNT');
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = getApps().find((a) => a.name === 'ledger') || initializeApp({ credential: cert(JSON.parse(raw)) }, 'ledger');
  const db = database === '(default)' ? getFirestore(app) : getFirestore(app, database);
  firestoreStore = {
    db,
    runTransaction(fn) {
      return db.runTransaction(async (t) => fn({
        get: async (p) => { const s = await t.get(db.doc(p)); return s.exists ? s.data() : null; },
        set: (p, d) => { t.set(db.doc(p), d); },
      }));
    },
  };
  return firestoreStore;
}

// Servidor local de pruebas: LEDGER_DEV=1 fuera de Vercel usa memoria.
let devStore = null;
function getStore() {
  if (process.env.LEDGER_DEV === '1' && !process.env.VERCEL) return (devStore = devStore || createMemoryStore());
  return getFirestoreStore();
}

module.exports = { createMemoryStore, getFirestoreStore, getStore };

// Instancia compartida del libro mayor (las pruebas la reemplazan con _setLedger).
let ledgerOverride = null;
// Saldo del sistema viejo: documento users/usr_* de la base compartida de arkaios-world, leído por la API REST
// pública (sus reglas permiten leer un documento, no listar). null = no existe; un error de red corta la operación
// para no perder la importación.
const LEGACY_URL = 'https://firestore.googleapis.com/v1/projects/arkaios-world/databases/'
  + `${process.env.LEGACY_DATABASE || 'ai-studio-arkaioscentralbu-6a109dde-5c44-4c0a-8ce7-4afaa1c95d6c'}/documents/users/`;
const LEGACY_KEY = process.env.LEGACY_API_KEY || 'AIzaSyD-ceCiJPVnLlepVBcMBhLABJEC771uypM';

async function legacyBalance(email, fetchImpl = fetch) {
  if (!email) return null;
  const { legacyDocId } = require('./ledger.js');
  const r = await fetchImpl(`${LEGACY_URL}${legacyDocId(email)}?key=${LEGACY_KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`saldo viejo no disponible (HTTP ${r.status})`);
  const f = (await r.json()).fields || {};
  const num = (v) => (v ? Number(v.integerValue ?? v.doubleValue ?? 0) : 0);
  const total = Math.floor(num(f.amrBlue) + num(f.amrDorado));
  return Number.isFinite(total) && total >= 0 ? total : null;
}

function getLedger() {
  if (ledgerOverride) return ledgerOverride;
  const dev = process.env.LEDGER_DEV === '1' && !process.env.VERCEL;
  return require('./ledger.js').createLedger(getStore(), dev ? {} : { legacyBalance });
}
module.exports.legacyBalance = legacyBalance;
module.exports.getLedger = getLedger;
module.exports._setLedger = (l) => { ledgerOverride = l; };
