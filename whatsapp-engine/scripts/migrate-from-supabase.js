#!/usr/bin/env node
/**
 * Migração única: copia os dados que hoje vivem no Postgres do Supabase
 * Cloud (profiles/auth.users + todo o módulo Comunicação Interna) para o
 * novo Postgres self-hosted, preservando os mesmos UUIDs — assim as FKs
 * (messages.author_id, comms_audit_log.actor_id, channels.created_by etc.)
 * continuam válidas sem precisar de remapeamento.
 *
 * Requer duas env vars TEMPORÁRIAS (nunca comitar, só exportar no shell
 * antes de rodar este script uma vez):
 *   SUPABASE_DB_URL — connection string direta do Postgres do Supabase
 *                     (Dashboard → Project Settings → Database → Connection string,
 *                     "URI" — não confundir com a REST API/anon key)
 *   DATABASE_URL     — connection string do Postgres novo (já usado pelo engine)
 *
 * Senhas: por segurança, NÃO tentamos extrair o hash interno do Supabase
 * Auth (formato do GoTrue não é público/estável). Cada usuário migrado
 * recebe uma senha descartável + um link de "definir senha" (mesmo fluxo de
 * scripts/seed-users.js) — precisa ser reenviado/entregue manualmente a cada
 * pessoa.
 *
 * Uso: SUPABASE_DB_URL="postgres://..." node scripts/migrate-from-supabase.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const argon2 = require('argon2');
const { Client } = require('pg');

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const DATABASE_URL = process.env.DATABASE_URL;
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:8080';
const PASSWORD_RESET_TTL_MIN = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MIN || 30);

if (!SUPABASE_DB_URL || !DATABASE_URL) {
  console.error('Defina SUPABASE_DB_URL (origem) e DATABASE_URL (destino) antes de rodar.');
  process.exit(1);
}

function sha256(input) { return crypto.createHash('sha256').update(input).digest('hex'); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }

// Tabelas do módulo Comunicação Interna, na ordem certa de FK (pai antes de filho).
const TABLES = [
  'comms_servers',
  'comms_categories',
  'channels',
  'channel_members',
  'messages',
  'client_data_cards',
  'comms_audit_log',
  'channel_reads',
];

async function copyTable(src, dst, table) {
  const { rows } = await src.query(`select * from public.${table}`);
  if (!rows.length) { console.log(`[migrate] ${table}: 0 linhas na origem, pulando.`); return 0; }
  const columns = Object.keys(rows[0]);
  let inserted = 0;
  for (const row of rows) {
    const values = columns.map((c) => row[c]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    // "on conflict do nothing" sem alvo nomeado — funciona tanto para tabelas
    // com PK simples (id) quanto composta (ex: channel_reads: user_id+channel_id).
    const sql = `insert into ${table} (${columns.join(', ')}) values (${placeholders}) on conflict do nothing`;
    try {
      const result = await dst.query(sql, values);
      inserted += result.rowCount;
    } catch (err) {
      console.error(`[migrate] falha ao inserir em ${table} (id=${row.id}):`, err.message);
      throw err;
    }
  }
  console.log(`[migrate] ${table}: ${inserted}/${rows.length} linhas inseridas (resto já existia).`);
  return inserted;
}

async function migrateUsers(src, dst) {
  // profiles (id, full_name, role) + auth.users (id, email) — precisa da
  // connection string direta (não da REST API) para acessar o schema auth.
  const { rows: profiles } = await src.query('select id, full_name, role from public.profiles');
  const { rows: authUsers } = await src.query('select id, email from auth.users');
  const emailById = new Map(authUsers.map((u) => [u.id, u.email]));

  const resetLinks = [];
  for (const p of profiles) {
    const email = (emailById.get(p.id) || '').trim().toLowerCase();
    if (!email) { console.warn(`[migrate] profile ${p.id} sem e-mail correspondente em auth.users — pulando.`); continue; }

    const { rows: existing } = await dst.query('select id from auth_users where id = $1', [p.id]);
    if (!existing[0]) {
      const throwawayHash = await argon2.hash(randomToken(32), { type: argon2.argon2id });
      await dst.query(
        'insert into auth_users (id, email, password_hash, full_name, role) values ($1,$2,$3,$4,$5)',
        [p.id, email, throwawayHash, p.full_name, p.role],
      );
      console.log(`[migrate] usuário criado: ${email} (${p.role}) — ${p.id}`);
    } else {
      console.log(`[migrate] usuário já existia: ${email} (${p.id})`);
    }

    const token = randomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MIN * 60000);
    await dst.query('insert into auth_password_resets (token_hash, user_id, expires_at) values ($1,$2,$3)', [tokenHash, p.id, expiresAt]);
    resetLinks.push({ email, link: `${APP_BASE_URL}/reset-password?token=${token}` });
  }
  return resetLinks;
}

async function main() {
  const src = new Client({ connectionString: SUPABASE_DB_URL });
  const dst = new Client({ connectionString: DATABASE_URL });
  await src.connect();
  await dst.connect();

  try {
    console.log('=== 1/2: usuários (profiles + auth.users) ===');
    const resetLinks = await migrateUsers(src, dst);

    console.log('\n=== 2/2: dados da Comunicação Interna ===');
    for (const table of TABLES) {
      await copyTable(src, dst, table);
    }

    console.log('\n=== Validação de contagem ===');
    for (const table of TABLES) {
      const [{ rows: s }, { rows: d }] = await Promise.all([
        src.query(`select count(*) from public.${table}`),
        dst.query(`select count(*) from ${table}`),
      ]);
      const match = Number(s[0].count) <= Number(d[0].count) ? 'OK' : 'DIVERGENTE';
      console.log(`  ${table}: origem=${s[0].count} destino=${d[0].count} [${match}]`);
    }

    console.log('\n=== Links de redefinição de senha (entregar manualmente a cada pessoa) ===');
    for (const r of resetLinks) console.log(`  ${r.email}: ${r.link}`);

    console.log('\nNota: anexos (bucket comms-attachments) não são copiados por este script —');
    console.log('baixe-os manualmente via Supabase Storage e grave em DATA_DIR/comms-attachments/<mesmo path>.');
  } finally {
    await src.end();
    await dst.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
