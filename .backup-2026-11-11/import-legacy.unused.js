/*
 * Foto única de los saldos viejos del juego (users/usr_* en la base compartida de arkaios-world, amrBlue + amrDorado)
 * hacia legacy/{docId} del libro mayor (proyecto Firebase yukiho-ledger). Cada jugador lo reclama una vez al abrir su
 * cartera (sin tope, decisión del dueño 2026-11-11). Correr UNA vez justo antes de publicar.
 * La base vieja se lee por la API REST pública de Firestore (sus reglas permiten leer; la apiKey es la pública del juego).
 *   set FIREBASE_SERVICE_ACCOUNT_FILE=C:\ARKAIOS\_SECRETS\yukiho-ledger-sa.json
 *   node scripts/import-legacy.js [--dry]
 */
const fs = require('fs');

const OLD_PROJECT = 'arkaios-world';
const OLD_DB = process.env.LEGACY_DATABASE || 'ai-studio-arkaioscentralbu-6a109dde-5c44-4c0a-8ce7-4afaa1c95d6c';
const OLD_API_KEY = process.env.LEGACY_API_KEY || 'AIzaSyD-ceCiJPVnLlepVBcMBhLABJEC771uypM';

const num = (f) => (f ? Number(f.integerValue ?? f.doubleValue ?? 0) : 0);

async function* oldUsers() {
  let pageToken = '';
  do {
    const u = new URL(`https://firestore.googleapis.com/v1/projects/${OLD_PROJECT}/databases/${OLD_DB}/documents/users`);
    u.searchParams.set('pageSize', '300');
    u.searchParams.set('key', OLD_API_KEY);
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const r = await fetch(u);
    if (!r.ok) throw new Error(`lectura de la base vieja: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const data = await r.json();
    for (const d of data.documents || []) yield { id: d.name.split('/').pop(), fields: d.fields || {} };
    pageToken = data.nextPageToken || '';
  } while (pageToken);
}

async function main() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) process.env.FIREBASE_SERVICE_ACCOUNT = fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_FILE, 'utf8');
  const dry = process.argv.includes('--dry');
  const ledger = dry ? null : require('../api/_lib/stores.js').getFirestoreStore();
  let n = 0, total = 0;
  for await (const doc of oldUsers()) {
    if (!doc.id.startsWith('usr_')) continue;   // solo documentos del juego de Yukiho (Expo usa users/{uid})
    const balance = Math.max(0, Math.floor(num(doc.fields.amrBlue) + num(doc.fields.amrDorado)));
    if (!Number.isFinite(balance)) continue;
    n++; total += balance;
    if (dry) continue;
    const email = (doc.fields.email && doc.fields.email.stringValue) || '';
    await ledger.runTransaction(async (tx) => {
      const cur = await tx.get(`legacy/${doc.id}`);
      if (cur && cur.claimedBy) return;   // ya reclamado: no se toca
      tx.set(`legacy/${doc.id}`, { balance, email, snapshotAt: new Date().toISOString() });
    });
  }
  console.log(`${dry ? '[prueba] ' : ''}${n} saldos, ${total} AMR en total`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
