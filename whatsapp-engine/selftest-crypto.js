/**
 * Teste de ida e volta (encrypt -> decrypt) exigido antes de considerar o
 * item 3 (criptografia) concluído. Roda isolado, sem precisar do server.js
 * nem de um banco real.
 *
 *   node selftest-crypto.js
 */
if (!process.env.DATA_ENCRYPTION_KEY) {
  process.env.DATA_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  console.log('[selftest] DATA_ENCRYPTION_KEY não definida no ambiente — usando uma chave gerada só para este teste.');
}
if (!process.env.PHONE_HASH_SECRET) {
  process.env.PHONE_HASH_SECRET = 'selftest-secret-nao-usar-em-producao';
  console.log('[selftest] PHONE_HASH_SECRET não definida no ambiente — usando um valor só para este teste.');
}

const { encrypt, decrypt, hashPhone, displayPhone } = require('./crypto');

const samples = [
  '12345678900',
  '55 (21) 99999-9999',
  'documento com acentuação é/ã/ç e símbolos !@#$%',
  'x',
  '0'.repeat(500), // string longa
];

let allOk = true;
for (const original of samples) {
  const enc = encrypt(original);
  const dec = decrypt(enc);
  const pass = dec === original;
  console.log(`[${pass ? 'OK' : 'FALHA'}] original="${original.slice(0, 40)}${original.length > 40 ? '…' : ''}" -> decrypt bate byte-a-byte: ${pass}`);
  if (!pass) allOk = false;
}

// Caso nulo/vazio: encrypt(null/'') deve retornar null, e decrypt(null) também.
const nullPass = encrypt(null) === null && encrypt('') === null && decrypt(null) === null && decrypt('') === null;
console.log(`[${nullPass ? 'OK' : 'FALHA'}] valores vazios/nulos tratados corretamente: ${nullPass}`);
if (!nullPass) allOk = false;

const phone = '21999999999';
console.log('hashPhone(21999999999) =', hashPhone(phone));
console.log('displayPhone(21999999999) =', displayPhone(phone));
const hashDeterministic = hashPhone(phone) === hashPhone(phone) && hashPhone(phone) !== hashPhone('21999999998');
console.log(`[${hashDeterministic ? 'OK' : 'FALHA'}] hash determinístico e sensível ao valor: ${hashDeterministic}`);
if (!hashDeterministic) allOk = false;

if (!allOk) {
  console.error('\nSELFTEST FALHOU — NÃO marcar item 3 (criptografia) como concluído.');
  process.exit(1);
}
console.log('\nSELFTEST OK — ida e volta (encrypt -> decrypt) bate exatamente com o original em todos os casos.');
