/**
 * Pool de conexão com o Postgres self-hosted (substitui o Postgres gerenciado
 * do Supabase). Usado por auth.js, authz.js, comms.js e realtime.js.
 *
 * DATABASE_URL é obrigatória — sem ela nada relacionado a login/Comunicação
 * Interna funciona (mesmo padrão fail-soft do antigo SUPABASE_URL: o resto do
 * engine — CRM/SQLite — continua funcionando normalmente).
 */
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';
const PG_CONFIGURED = !!DATABASE_URL;

let pool = null;
if (PG_CONFIGURED) {
  pool = new Pool({ connectionString: DATABASE_URL });
  pool.on('error', (err) => {
    // Erro em cliente ocioso do pool — não derruba o processo.
    console.error('[pg] erro inesperado em cliente ocioso:', err.message);
  });
} else {
  console.warn('[BOOT] DATABASE_URL não configurada — rotas de login e Comunicação Interna responderão 503.');
}

async function query(text, params) {
  if (!pool) throw new Error('DATABASE_URL não configurada.');
  return pool.query(text, params);
}

module.exports = { pool, query, PG_CONFIGURED };
