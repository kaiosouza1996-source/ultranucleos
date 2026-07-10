/**
 * Criptografia de dados sensíveis (documento, telefone) — item 3 do plano de
 * segurança. AES-256-GCM para os campos que precisam ser recuperados
 * byte-a-byte (exibição/exportação); HMAC-SHA256 para o hash determinístico
 * usado só para casar mensagens recebidas com o contato certo (nunca exibido).
 *
 * Chaves SEMPRE vêm de variável de ambiente, nunca do código:
 *   DATA_ENCRYPTION_KEY — 32 bytes em base64 (gerar com: openssl rand -base64 32)
 *   PHONE_HASH_SECRET   — string secreta qualquer (gerar com: openssl rand -hex 32)
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

let _dataKey = null;
function dataKey() {
  if (_dataKey) return _dataKey;
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('DATA_ENCRYPTION_KEY não definida. Gere com: openssl rand -base64 32');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`DATA_ENCRYPTION_KEY precisa decodificar para 32 bytes (AES-256). Tamanho atual: ${key.length}.`);
  }
  _dataKey = key;
  return _dataKey;
}

function hashSecret() {
  const secret = process.env.PHONE_HASH_SECRET;
  if (!secret) throw new Error('PHONE_HASH_SECRET não definida.');
  return secret;
}

/**
 * Criptografa uma string em texto puro.
 * Retorna "iv:tag:ciphertext" (cada parte em base64) ou null se input vazio/nulo.
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, dataKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/**
 * Descriptografa o formato gerado por encrypt(). Retorna null se o payload for
 * nulo/vazio/malformado — NUNCA lança para não derrubar uma rota inteira por
 * causa de um registro legado ausente.
 */
function decrypt(payload) {
  if (!payload) return null;
  try {
    const [ivB64, tagB64, dataB64] = String(payload).split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, dataKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  } catch (e) {
    console.error('[crypto] falha ao descriptografar:', e.message);
    return null;
  }
}

/** Hash determinístico (HMAC-SHA256) do telefone normalizado — só para lookup, nunca exibido. */
function hashPhone(normalizedPhone) {
  if (!normalizedPhone) return null;
  return crypto.createHmac('sha256', hashSecret()).update(String(normalizedPhone)).digest('hex');
}

/** DDD + 4 últimos dígitos, sem criptografia — permite busca parcial em auditoria/atendimento. */
function displayPhone(normalizedPhone) {
  const digits = String(normalizedPhone || '').replace(/\D+/g, '');
  if (digits.length < 4) return digits || null;
  const last4 = digits.slice(-4);
  const ddd = digits.length >= 10 ? digits.slice(-11, -9) || digits.slice(-10, -8) : '';
  return ddd ? `(${ddd}) ••••-${last4}` : `••••-${last4}`;
}

module.exports = { encrypt, decrypt, hashPhone, displayPhone };
