#!/usr/bin/env node
/**
 * Cria as contas iniciais (Kaio, Jociney, Yuri = sócio; Nicolas = comercial;
 * Celene = operacional) direto no Postgres — usado uma vez, antes de existir
 * qualquer sócio logado pra chamar POST /auth/admin/create-user.
 *
 * Edite a lista USERS abaixo com o e-mail real de cada pessoa antes de rodar.
 * Uso: node scripts/seed-users.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const argon2 = require('argon2');
const { Pool } = require('pg');

const USERS = [
  { email: 'kaiofgsouza@gmail.com', fullName: 'Kaio', role: 'socio' },
  { email: 'jociney@aureainvesting.com.br', fullName: 'Jociney', role: 'socio' },
  { email: 'yuri@aureainvesting.com.br', fullName: 'Yuri', role: 'socio' },
  { email: 'nicolas@aureainvesting.com.br', fullName: 'Nicolas', role: 'comercial' },
  { email: 'celene@aureainvesting.com.br', fullName: 'Celene', role: 'operacional' },
];

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:8080';
const PASSWORD_RESET_TTL_MIN = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MIN || 30);

function sha256(input) { return crypto.createHash('sha256').update(input).digest('hex'); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) { console.error('DATABASE_URL não definida.'); process.exit(1); }
  const pool = new Pool({ connectionString: DATABASE_URL });

  for (const u of USERS) {
    const email = u.email.trim().toLowerCase();
    const { rows: existingRows } = await pool.query('select id from auth_users where email = $1', [email]);
    let userId;
    if (existingRows[0]) {
      userId = existingRows[0].id;
      console.log(`[seed] ${email} já existe (${userId}) — só gerando novo link de senha.`);
    } else {
      const throwawayHash = await argon2.hash(randomToken(32), { type: argon2.argon2id });
      const { rows } = await pool.query(
        'insert into auth_users (email, password_hash, full_name, role) values ($1,$2,$3,$4) returning id',
        [email, throwawayHash, u.fullName, u.role],
      );
      userId = rows[0].id;
      console.log(`[seed] criado ${email} (${u.role}) — ${userId}`);
    }

    const token = randomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MIN * 60000);
    await pool.query('insert into auth_password_resets (token_hash, user_id, expires_at) values ($1,$2,$3)', [tokenHash, userId, expiresAt]);
    console.log(`  -> link para definir senha (expira em ${PASSWORD_RESET_TTL_MIN}min): ${APP_BASE_URL}/reset-password?token=${token}`);
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
