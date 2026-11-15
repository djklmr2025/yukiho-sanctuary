/*
 * Crea códigos de recarga AMR en el libro mayor (Firestore, proyecto Firebase yukiho-ledger). Uso local del dueño:
 *   set FIREBASE_SERVICE_ACCOUNT=<json>  (o FIREBASE_SERVICE_ACCOUNT_FILE=ruta.json)
 *   node scripts/amr-codes.js --amount 100 --count 5 [--uses 1]
 * Imprime los códigos; cada jugador puede canjear un código una sola vez y el código se agota tras --uses canjes.
 */
const crypto = require('crypto');
const fs = require('fs');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

async function main() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) process.env.FIREBASE_SERVICE_ACCOUNT = fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_FILE, 'utf8');
  const amount = Number(arg('amount'));
  const count = Number(arg('count', '1'));
  const uses = Number(arg('uses', '1'));
  if (!(amount > 0 && amount <= 10000) || !(count > 0 && count <= 500) || !(uses > 0 && uses <= 10000)) {
    throw new Error('uso: --amount 1..10000 --count 1..500 [--uses 1..10000]');
  }
  const { getFirestoreStore } = require('../api/_lib/stores.js');
  const store = getFirestoreStore();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from(crypto.randomBytes(4), (b) => alphabet[b % alphabet.length]).join('');
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = `AMR-${part()}-${part()}-${part()}`;
    await store.runTransaction(async (tx) => {
      if (await tx.get(`codes/${code}`)) throw new Error('colisión, vuelve a correr');
      tx.set(`codes/${code}`, { amount, usesLeft: uses, redeemedBy: {}, createdAt: new Date().toISOString() });
    });
    codes.push(code);
  }
  process.stdout.write(codes.join('\n') + '\n');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
