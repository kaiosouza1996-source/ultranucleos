#!/usr/bin/env node
/**
 * Aplica as migrations .sql de db/migrations/ (na raiz do repo) em ordem,
 * registrando cada arquivo já aplicado em schema_migrations — evita reaplicar.
 *
 * Uso: node scripts/migrate.js
 * Requer DATABASE_URL no ambiente (ou whatsapp-engine/.env via dotenv).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL não definida.');
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows: appliedRows } = await client.query('select filename from schema_migrations');
    const applied = new Set(appliedRows.map((r) => r.filename));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] já aplicada, pulando: ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] aplicando: ${file}`);
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (filename) values ($1)', [file]);
      } catch (err) {
        console.error(`[migrate] falhou em ${file}:`, err.message);
        throw err;
      }
    }
    console.log('[migrate] concluído.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
