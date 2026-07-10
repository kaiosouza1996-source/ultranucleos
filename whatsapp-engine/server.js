/* eslint-disable no-console */
/**
 * WhatsApp Sender — Motor local v2
 *
 * Plataforma completa: disparo + central de atendimento + CRM + mídias.
 *
 *  ┌──────────────────────────────────────────────────────────────────┐
 *  │  HTTP REST + WebSocket  →  http://localhost:8787                 │
 *  │  Cliente WhatsApp Web (whatsapp-web.js + Puppeteer)             │
 *  │  SQLite local (data.db)                                          │
 *  │  Mídias armazenadas em ./media/                                  │
 *  │  Reconexão automática, heartbeat, /status                        │
 *  │  Segurança: API key obrigatória, rate limit, dados sensíveis      │
 *  │  criptografados, audit log imutável (ver SECURITY.md)             │
 *  └──────────────────────────────────────────────────────────────────┘
 */
require('dotenv').config(); // carrega whatsapp-engine/.env em dev local. Em produção (Railway/VPS), as env vars são setadas direto pela plataforma — este .config() não sobrescreve nada que já esteja definido no ambiente.
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const mime = require('mime-types');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { encrypt, decrypt, hashPhone, displayPhone } = require('./crypto');
const authModule = require('./auth');
const commsModule = require('./comms');
const realtimeModule = require('./realtime');
const notificationsModule = require('./notifications');
const agendaModule = require('./agenda');
const funisModule = require('./funis');
const annotationsModule = require('./annotations');
const { downloadAttachment } = require('./uploads-comms');
const { computeCadence, STAGE_TOUCH_COLUMN, STAGE_DUE_DAYS, D75_SILENCE_DAYS, DAY_MS } = require('./cadence');

const PORT = process.env.PORT || 8787;
const ROOT = __dirname;
// DATA_DIR: raiz de tudo que precisa sobreviver a um redeploy (sessão do
// WhatsApp, banco SQLite, mídias). No Railway, o disco do container é efêmero
// por padrão — todo redeploy apaga o filesystem. Anexe um Volume ao serviço e
// aponte DATA_DIR para o mount path (ex: /data) para persistir entre deploys.
// Sem essa variável, cai no comportamento antigo (tudo dentro do próprio ROOT).
const DATA_DIR = process.env.DATA_DIR || ROOT;
fs.mkdirSync(DATA_DIR, { recursive: true });
const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ───────────────────────── Segurança — item 2 e 3 ───────────────────────
// ENGINE_API_KEY e as chaves de criptografia são OBRIGATÓRIAS — o servidor
// recusa subir sem elas (fail-fast) em vez de rodar exposto sem querer.
const ENGINE_API_KEY = process.env.ENGINE_API_KEY;
if (!ENGINE_API_KEY) {
  console.error('[BOOT] ENGINE_API_KEY não definida. Obrigatória (item 2 do plano de segurança).');
  console.error('       Gere com: openssl rand -hex 32');
  process.exit(1);
}
if (!process.env.DATA_ENCRYPTION_KEY || !process.env.PHONE_HASH_SECRET) {
  console.error('[BOOT] DATA_ENCRYPTION_KEY e/ou PHONE_HASH_SECRET não definidas. Obrigatórias (item 3).');
  console.error('       Gere com: openssl rand -base64 32   (DATA_ENCRYPTION_KEY)');
  console.error('       Gere com: openssl rand -hex 32       (PHONE_HASH_SECRET)');
  process.exit(1);
}

// Postgres self-hosted — substitui o Supabase por completo (login, papéis,
// Comunicação Interna). Sem DATABASE_URL, o resto do sistema (CRM/WhatsApp em
// SQLite) continua funcionando normalmente; só login e rotas restritas a
// Sócio ficam indisponíveis (503) até configurar.
const { PG_CONFIGURED } = require('./pg');
if (!PG_CONFIGURED) {
  console.warn('[BOOT] DATABASE_URL não configurada.');
  console.warn('       Login, Comunicação Interna e rotas restritas a Sócio responderão 503/401 até configurar.');
}

// ───────────────────────────── DB ─────────────────────────────
const db = new Database(path.join(DATA_DIR, 'data.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  nome TEXT,
  telefone_enc TEXT,        -- AES-256-GCM do telefone completo (exibição/exportação)
  telefone_hash TEXT,       -- HMAC-SHA256 do telefone normalizado (lookup determinístico, nunca exibido)
  telefone_display TEXT,    -- DDD + 4 últimos dígitos, sem criptografia (busca parcial em auditoria/atendimento)
  email TEXT,
  documento_enc TEXT,       -- AES-256-GCM do documento (CPF/CNPJ)
  empresa TEXT,
  origem TEXT,
  status TEXT DEFAULT 'novo',
  observacoes TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_contacts_telefone_hash ON contacts(telefone_hash);
-- Tags e a aplicação delas nos contatos são organização PESSOAL de cada
-- usuário (item combinado com o CRM/pipeline abaixo) — o contato em si é
-- compartilhado, mas cada usuário mantém suas próprias tags e decide quais
-- aplicar, sem interferir na visão dos colegas.
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  cor TEXT,
  created_at INTEGER,
  UNIQUE(user_id, nome)
);
CREATE TABLE IF NOT EXISTS contact_tags (
  user_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (user_id, contact_id, tag_id)
);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, name TEXT, tag TEXT, body TEXT, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS quick_replies (
  id TEXT PRIMARY KEY, atalho TEXT UNIQUE, body TEXT, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,             -- chatId (5511...@c.us)
  telefone TEXT,
  nome TEXT,
  last_message TEXT,
  last_ts INTEGER,
  unread INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pendente',  -- pendente | atendendo | finalizado
  assignee TEXT,
  archived INTEGER DEFAULT 0,      -- "arquivar" nunca deleta o registro — só esconde da tela normal. Se DELETE real chega a existir um dia, ele é condicionado a workspace_settings.retention_policy (ver abaixo), não a uma regra fixa do código.
  archived_at INTEGER,
  archived_by TEXT,
  archived_reason TEXT,
  connection_id TEXT DEFAULT 'default' -- qual número de WhatsApp recebeu essa conversa
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  ts INTEGER,
  from_me INTEGER,
  body TEXT,
  type TEXT,                       -- text | image | audio | video | document | sticker
  media_path TEXT,
  media_mime TEXT,
  ack INTEGER DEFAULT 0,           -- 0 sent, 1 server, 2 device, 3 read
  connection_id TEXT DEFAULT 'default'
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, ts);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, level TEXT, message TEXT, contact TEXT,
  actor_id TEXT,     -- quem disparou a ação (id do Supabase) — null = evento de sistema, visível pra todos
  actor_name TEXT
);
-- Números de WhatsApp conectados. 'default' sempre existe (compatibilidade
-- com deployments de número único já em produção). Cada linha aqui = uma
-- sessão/Chromium própria — ver connState no código.
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT, telefone TEXT, ts INTEGER
);
-- Cache da foto de perfil real do WhatsApp por telefone do cliente — nunca
-- busca na API do WhatsApp a cada render; só reconsulta quando fetched_at
-- está a mais de 24h (ver getProfilePicPath). path=NULL registrado quando o
-- cliente não tem foto (ou privacidade bloqueia), pra não reconsultar toda
-- hora e ainda assim cair no fallback de iniciais no frontend.
CREATE TABLE IF NOT EXISTS contact_avatars (
  telefone TEXT PRIMARY KEY,
  path TEXT,
  fetched_at INTEGER
);
-- Etapas do pipeline são organização PESSOAL de cada usuário — cada um tem
-- seu próprio funil (nomes, cores, ordem). O mesmo contato compartilhado pode
-- estar em etapas diferentes para usuários diferentes (ver contact_stage).
CREATE TABLE IF NOT EXISTS pipeline_stages (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT,
  ord INTEGER DEFAULT 0,
  terminal INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, key)
);
-- Em qual etapa do funil de CADA usuário um contato compartilhado está.
CREATE TABLE IF NOT EXISTS contact_stage (
  user_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  stage_key TEXT NOT NULL,
  updated_at INTEGER,
  PRIMARY KEY (user_id, contact_id)
);
-- Configurações anti-ban (delays/limites de disparo) — pessoais por usuário.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  min_delay INTEGER,
  max_delay INTEGER,
  per_run_limit INTEGER,
  per_day_limit INTEGER,
  avoid_duplicates INTEGER,
  long_pause_every INTEGER,
  long_pause_seconds INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS custom_fields (
  id TEXT PRIMARY KEY,
  field_key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL,           -- text|number|date|select|checkbox
  options TEXT,                 -- JSON array p/ select
  required INTEGER DEFAULT 0,
  ord INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contact_custom_data (
  contact_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (contact_id, field_key)
);
CREATE TABLE IF NOT EXISTS pipeline_history (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  ts INTEGER NOT NULL,
  user TEXT
);
CREATE INDEX IF NOT EXISTS idx_pipeline_history_contact ON pipeline_history(contact_id, ts DESC);

-- Audit log — imutável por construção: nenhuma rota da API faz UPDATE/DELETE
-- aqui, e os triggers abaixo bloqueiam no nível do próprio banco (defesa em
-- profundidade — mesmo um bug futuro no código não consegue alterar/apagar).
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  actor TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  reason TEXT,
  details TEXT
);
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log é imutável'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log é imutável'); END;

-- Configuração por workspace/tenant — pensado para quando este CRM virar um
-- produto reutilizado por outros negócios, não só a Áurea Investing. A
-- política de retenção de conversas NÃO é uma regra fixa do sistema: é um
-- campo de configuração aqui. Hoje só existe uma linha ('default'), porque
-- este deployment é de um único workspace (Áurea). Um deployment futuro para
-- outro cliente, sem obrigação regulatória de CVM/ANCORD, poderia rodar com
-- retention_policy='flexible' — sem precisar mudar uma linha de código, só
-- essa configuração.
CREATE TABLE IF NOT EXISTS workspace_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  workspace_name TEXT,
  retention_policy TEXT NOT NULL DEFAULT 'strict', -- 'strict' = nunca deleta conversa/mensagem, só arquiva (exigido para a Áurea) | 'flexible' = delete real permitido (não implementado ainda — ver nota perto de /conversations/:id/archive)
  created_at INTEGER,
  updated_at INTEGER
);
`);

// Áurea Investing é credenciada à Genial e sujeita a auditoria CVM/ANCORD —
// por isso o workspace 'default' já nasce com retention_policy='strict'.
// Isso é dado de configuração, não uma regra hardcoded no código acima.
if (db.prepare(`SELECT COUNT(*) AS n FROM workspace_settings`).get().n === 0) {
  db.prepare(`INSERT INTO workspace_settings (id, workspace_name, retention_policy, created_at, updated_at) VALUES (?,?,?,?,?)`)
    .run('default', 'Áurea Investing', 'strict', Date.now(), Date.now());
}

function getWorkspaceSettings() {
  return db.prepare(`SELECT * FROM workspace_settings WHERE id='default'`).get();
}

// ─────────── Migração idempotente (bancos criados antes do item 3) ───────────
function ensureColumn(table, name, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
}
ensureColumn('contacts', 'telefone_enc', 'TEXT');
ensureColumn('contacts', 'telefone_hash', 'TEXT');
ensureColumn('contacts', 'telefone_display', 'TEXT');
ensureColumn('contacts', 'documento_enc', 'TEXT');
ensureColumn('conversations', 'archived', 'INTEGER DEFAULT 0');
ensureColumn('conversations', 'archived_at', 'INTEGER');
ensureColumn('conversations', 'archived_by', 'TEXT');
ensureColumn('conversations', 'archived_reason', 'TEXT');
ensureColumn('conversations', 'connection_id', "TEXT DEFAULT 'default'");
// Fixar conversa + marcar como não lida manualmente (Atendimento).
// pinned_at também serve de critério de ordenação (fixação mais recente
// primeiro) sem precisar de uma coluna extra só pra isso.
ensureColumn('conversations', 'pinned_at', 'INTEGER');
ensureColumn('messages', 'connection_id', "TEXT DEFAULT 'default'");
// Edição/"apagar" de mensagem no WhatsApp real — nunca perdemos o registro:
// editar sobrescreve body + marca edited_at (mesmo padrão de comms.js);
// "apagar para todos" do OUTRO lado só marca revoked_at, nunca apaga o body
// (Seção 13 do Manual: histórico nunca é destruído — aqui vale também pra
// mensagens, não só pra conversas arquivadas).
ensureColumn('messages', 'edited_at', 'INTEGER');
ensureColumn('messages', 'revoked_at', 'INTEGER');
// Quem revogou "para todos" a partir do nosso lado (POST
// /messages/:id/delete-for-everyone) — nulo quando a revogação veio do
// próprio cliente (evento message_revoke_everyone do WhatsApp), caso em que
// não existe "quem" do nosso lado.
ensureColumn('messages', 'revoked_by_user_id', 'TEXT');
ensureColumn('messages', 'revoked_by_name', 'TEXT');
// Nome de exibição do arquivo — o nome físico em disco (media_path) sempre
// foi um hash/id interno; sem esta coluna, tanto quem recebe no WhatsApp
// quanto o histórico aqui dentro mostravam esse nome aleatório em vez do
// nome real do arquivo que o usuário escolheu no computador.
ensureColumn('messages', 'media_filename', 'TEXT');
// Identificação interna de quem enviou (rastreio em transferências/auditoria
// de resposta) — UI interna estritamente: nunca sai daqui pro payload do
// WhatsApp. Guardamos o nome junto (não só o id) pelo mesmo motivo de
// revoked_by_name — não dá pra fazer JOIN cross-database contra auth_users,
// que vive no Postgres. Mensagens antigas ficam NULL (não exibe nada, sem
// placeholder — pedido explícito do usuário).
ensureColumn('messages', 'sender_user_id', 'TEXT');
ensureColumn('messages', 'sender_name', 'TEXT');
ensureColumn('logs', 'actor_id', 'TEXT');
ensureColumn('logs', 'actor_name', 'TEXT');
ensureColumn('pipeline_history', 'user_id', 'TEXT');

// ─── Cliente da Assessoria / Lead Frio + Cadência de Follow-up ───
// Colunas diretas (mesmo padrão de telefone_enc/documento_enc acima) — ver
// whatsapp-engine/cadence.js para a função que interpreta este estado bruto.
ensureColumn('contacts', 'is_client', 'INTEGER DEFAULT 0');              // 0=Lead Frio, 1=Cliente da Assessoria — fonte única de verdade
ensureColumn('contacts', 'is_client_since', 'INTEGER');                  // última vez que virou cliente — base do card "Convertidos este mês"
ensureColumn('contacts', 'atua_mercado_financeiro', 'TEXT');             // SIM | NAO | NUMERO_MUDOU_TITULAR | A_CONFIRMAR | CONCORRENCIA | NULL
ensureColumn('contacts', 'responsavel_id', 'TEXT');                      // colaborador dono da execução manual da cadência
ensureColumn('contacts', 'last_contact_at', 'INTEGER');                  // último toque (inbound OU outbound) — base "sem contato 30d+"
ensureColumn('contacts', 'conversation_started_at', 'INTEGER');          // primeira resposta INBOUND do lead — nunca sobrescrita depois de setada
ensureColumn('contacts', 'cadence_started_at', 'INTEGER');               // quando entrou em D1
ensureColumn('contacts', 'cadence_last_touch_at', 'INTEGER');            // último toque manual confirmado
ensureColumn('contacts', 'cadence_touch_d1_done', 'INTEGER DEFAULT 0');
ensureColumn('contacts', 'cadence_touch_d3_done', 'INTEGER DEFAULT 0');
ensureColumn('contacts', 'cadence_touch_d7_done', 'INTEGER DEFAULT 0');
ensureColumn('contacts', 'cadence_touch_d15_done', 'INTEGER DEFAULT 0');
ensureColumn('contacts', 'cadence_touch_d75_done', 'INTEGER DEFAULT 0');
ensureColumn('contacts', 'cadence_d15_done_at', 'INTEGER');              // necessário p/ calcular vencimento do D75 (D15 confirmado + 60d)
ensureColumn('contacts', 'cadence_paused', 'INTEGER DEFAULT 0');         // lead respondeu — handoff humano, suprime alerta de atraso
ensureColumn('contacts', 'cadence_encerrado_sem_resposta', 'INTEGER DEFAULT 0'); // D75 tocado sem resposta — sai definitivamente da fila ativa
ensureColumn('contacts', 'cadence_stage_cache', 'TEXT');                 // conveniência de consulta direta no banco — NUNCA lido como fonte de verdade pelas rotas
// Exclusão de contato exige aprovação de um Sócio — nunca é removido na hora
// quando quem pede não é sócio (ver POST /contacts/:id/request-delete).
ensureColumn('contacts', 'delete_requested_by', 'TEXT');
ensureColumn('contacts', 'delete_requested_by_name', 'TEXT');
ensureColumn('contacts', 'delete_requested_at', 'INTEGER');
// Captação via landing page externa (POST /public/leads) — atribuição de
// campanha de tráfego pago. Só setados nessa rota; import manual/CRM nunca
// preenche.
ensureColumn('contacts', 'utm_source', 'TEXT');
ensureColumn('contacts', 'utm_medium', 'TEXT');
ensureColumn('contacts', 'utm_campaign', 'TEXT');
// Respostas rápidas híbridas (Pessoal por padrão, ou Empresa/compartilhada) —
// tabela nasceu sem dono nenhum (visível a todos, sem noção de quem criou);
// ensureColumn preserva as respostas já existentes como 'shared' (mantém o
// comportamento antigo de "todo mundo vê tudo" pra quem já tinha cadastrado).
ensureColumn('quick_replies', 'visibility', "TEXT DEFAULT 'shared'");
ensureColumn('quick_replies', 'created_by', 'TEXT');
ensureColumn('quick_replies', 'created_by_name', 'TEXT');

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_telefone_hash_unique ON contacts(telefone_hash) WHERE telefone_hash IS NOT NULL`);

// Upgrade de bancos criados antes da organização pessoal por usuário (pipeline
// global -> por usuário). Ainda não há dados reais de produção nessas tabelas
// (só testes locais), então o upgrade recria do zero em vez de tentar
// adivinhar a qual usuário atribuir as linhas globais antigas.
(function migrateToPerUserOrganization() {
  const stageCols = db.prepare(`PRAGMA table_info(pipeline_stages)`).all().map((c) => c.name);
  if (stageCols.includes('user_id')) return; // já migrado
  db.exec(`
    DROP TABLE IF EXISTS pipeline_stages;
    CREATE TABLE pipeline_stages (
      user_id TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, color TEXT,
      ord INTEGER DEFAULT 0, terminal INTEGER DEFAULT 0, PRIMARY KEY (user_id, key)
    );
    DROP TABLE IF EXISTS tags;
    CREATE TABLE tags (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, nome TEXT NOT NULL, cor TEXT,
      created_at INTEGER, UNIQUE(user_id, nome)
    );
    DROP TABLE IF EXISTS contact_tags;
    CREATE TABLE contact_tags (
      user_id TEXT NOT NULL, contact_id TEXT NOT NULL, tag_id TEXT NOT NULL,
      PRIMARY KEY (user_id, contact_id, tag_id)
    );
  `);
  console.log('[BOOT] pipeline_stages/tags/contact_tags recriadas para organização pessoal por usuário (dados de teste anteriores foram limpos).');
})();

// Sempre garante que a conexão 'default' (número principal) existe — é o que
// faz um deployment de número único continuar funcionando sem reconfiguração.
if (!db.prepare(`SELECT id FROM connections WHERE id='default'`).get()) {
  db.prepare(`INSERT INTO connections (id, label, created_at) VALUES ('default', 'Principal', ?)`).run(Date.now());
}

// Bancos legados (de antes do item 3) ainda têm colunas "telefone"/"documento"
// em texto puro — migra para as colunas criptografadas e some com o texto puro.
(function migrateLegacyPlaintext() {
  const cols = db.prepare(`PRAGMA table_info(contacts)`).all().map((c) => c.name);
  if (!cols.includes('telefone') && !cols.includes('documento')) return; // banco já é novo, nada a fazer
  const legacy = db.prepare(`SELECT id, telefone, documento FROM contacts WHERE telefone_hash IS NULL`).all();
  if (legacy.length) {
    const upd = db.prepare(`UPDATE contacts SET telefone_enc=?, telefone_hash=?, telefone_display=?, documento_enc=? WHERE id=?`);
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        const tel = String(r.telefone || '').replace(/\D+/g, '');
        upd.run(
          tel ? encrypt(tel) : null,
          tel ? hashPhone(tel) : null,
          tel ? displayPhone(tel) : null,
          r.documento ? encrypt(String(r.documento)) : null,
          r.id,
        );
      }
    });
    tx(legacy);
    console.log(`[BOOT] Migrados ${legacy.length} contato(s) legados para colunas criptografadas.`);
  }
  try { db.exec('ALTER TABLE contacts DROP COLUMN telefone'); } catch { try { db.exec('UPDATE contacts SET telefone=NULL'); } catch { /* ignore */ } }
  try { db.exec('ALTER TABLE contacts DROP COLUMN documento'); } catch { try { db.exec('UPDATE contacts SET documento=NULL'); } catch { /* ignore */ } }
})();

// Etapas padrão do pipeline — cada usuário recebe sua própria cópia na
// primeira vez que acessa o CRM (ver ensureDefaultStages, chamado a partir
// de GET /pipeline/stages), já que a organização agora é pessoal.
const DEFAULT_PIPELINE_STAGES = [
  { key: 'novo',           label: 'Novo',           color: '213 100% 60%', ord: 0, terminal: 0 },
  { key: 'em-atendimento', label: 'Em atendimento', color: '38 95% 55%',   ord: 1, terminal: 0 },
  { key: 'qualificado',    label: 'Qualificado',    color: '263 80% 65%',  ord: 2, terminal: 0 },
  { key: 'proposta',       label: 'Proposta',       color: '189 90% 55%',  ord: 3, terminal: 0 },
  { key: 'fechado',        label: 'Fechado',        color: '142 70% 45%',  ord: 4, terminal: 1 },
  { key: 'perdido',        label: 'Perdido',        color: '0 75% 58%',    ord: 5, terminal: 1 },
];
function ensureDefaultStages(userId) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM pipeline_stages WHERE user_id=?').get(userId).n;
  if (count > 0) return;
  const ins = db.prepare('INSERT INTO pipeline_stages (user_id,key,label,color,ord,terminal) VALUES (?,?,?,?,?,?)');
  const tx = db.transaction(() => {
    for (const s of DEFAULT_PIPELINE_STAGES) ins.run(userId, s.key, s.label, s.color, s.ord, s.terminal);
  });
  tx();
}

// ─────────────────────────── Express ───────────────────────────
const app = express();
// credentials:true + origem explícita — obrigatório para o cookie de sessão
// httpOnly funcionar entre o frontend (outra origem) e este servidor. Sem
// FRONTEND_ORIGIN configurada, cai para '*' (sem cookies — só API key), o
// que é o comportamento antigo e continua funcionando pro resto do sistema.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '';
app.use(cors(FRONTEND_ORIGIN ? { origin: FRONTEND_ORIGIN, credentials: true } : {}));
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// Rate limit — item 2: barra abuso/força-bruta por IP.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições deste IP — aguarde um minuto.' },
});
app.use(limiter);

// ───────────── Endpoint público de captação de leads (landing page) ─────────────
// Montada ANTES do requireApiKey abaixo — nunca depende do ENGINE_API_KEY
// interno (esse é o que o frontend usa); tem sua própria chave fixa
// (PUBLIC_LEADS_API_KEY) e seu próprio rate limit, mais restrito que o
// global, já que é a única rota deste servidor exposta pra internet sem
// sessão/CSRF nenhum por trás.
const publicLeadsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições — aguarde um minuto.' },
});
const LEAD_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
app.post('/public/leads', publicLeadsLimiter, (req, res) => {
  const PUBLIC_LEADS_API_KEY = process.env.PUBLIC_LEADS_API_KEY;
  if (!PUBLIC_LEADS_API_KEY) return res.status(503).json({ error: 'Captação pública ainda não configurada neste servidor.' });
  const key = req.headers['x-landing-key'] || req.query.key;
  if (key !== PUBLIC_LEADS_API_KEY) return res.status(401).json({ error: 'Chave inválida ou ausente.' });

  const { nome, email, whatsapp, utm_source, utm_medium, utm_campaign, origem } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ error: 'nome é obrigatório.' });
  const emailNorm = String(email || '').trim().toLowerCase();
  if (!emailNorm || !LEAD_EMAIL_RE.test(emailNorm)) return res.status(400).json({ error: 'email inválido ou ausente.' });
  const tel = String(whatsapp || '').replace(/\D+/g, '');
  if (!tel || tel.length < 10 || tel.length > 13) return res.status(400).json({ error: 'whatsapp inválido ou ausente.' });

  const hash = hashPhone(tel);
  const existing = db.prepare('SELECT * FROM contacts WHERE telefone_hash=? OR email=?').get(hash, emailNorm);
  const now = Date.now();

  if (existing) {
    // Reenvio do mesmo formulário — nunca duplica; só atualiza nome (se veio
    // diferente) e completa atribuição de campanha que ainda estivesse vazia
    // (não sobrescreve a origem/UTM já registrada na primeira captação).
    db.prepare(`UPDATE contacts SET
        nome = COALESCE(?, nome),
        utm_source = COALESCE(utm_source, ?),
        utm_medium = COALESCE(utm_medium, ?),
        utm_campaign = COALESCE(utm_campaign, ?),
        origem = COALESCE(origem, ?)
      WHERE id = ?`)
      .run(nome || null, utm_source || null, utm_medium || null, utm_campaign || null, origem || null, existing.id);
    logEvent('info', 'Lead reenviou formulário (landing page)', existing.nome || tel, null);
    broadcast({ type: 'contacts-changed' });
    return res.json({ ok: true, id: existing.id, duplicate: true });
  }

  // Nasce Lead Frio (is_client=0, default da coluna) e 'A_CONFIRMAR' (default
  // do schema — nunca 'SIM', que pularia a triagem manual: ver Parte A3 do
  // plano) mas JÁ entra na cadência D1 (cadence_started_at explícito aqui,
  // diferente do fluxo isClient=false de POST /contacts, que força 'SIM').
  const id = randomId();
  db.prepare(`INSERT INTO contacts
      (id, nome, telefone_enc, telefone_hash, telefone_display, email, origem, status, created_at, atua_mercado_financeiro, cadence_started_at, utm_source, utm_medium, utm_campaign)
      VALUES (?,?,?,?,?,?,?, 'novo', ?, 'A_CONFIRMAR', ?, ?, ?, ?)`)
    .run(id, nome, encrypt(tel), hash, displayPhone(tel), emailNorm, origem || 'landing-page', now, now, utm_source || null, utm_medium || null, utm_campaign || null);

  broadcast({ type: 'contacts-changed' });
  res.json({ ok: true, id, duplicate: false });
});

// API key obrigatória — item 2: sem ela, nenhuma rota (exceto /health) responde.
// Aceita a chave tanto por header (chamadas REST normais) quanto por query
// string (WebSocket e URLs de mídia embutidas em <img>/<audio>, que não
// conseguem enviar headers customizados).
function requireApiKey(req, res, next) {
  if (req.path === '/health') return next();
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (key !== ENGINE_API_KEY) return res.status(401).json({ error: 'API key inválida ou ausente.' });
  next();
}
app.use(requireApiKey);

app.use('/media', express.static(MEDIA_DIR));

const upload = multer({ dest: MEDIA_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

// ───────────────── RBAC (sessão própria) — item 1/3 ──────────────────────
// Antes: o engine não guardava usuários e validava o Bearer token do
// Supabase a cada chamada via PostgREST. Agora: sessão em cookie httpOnly
// (auth.js) resolvida uma vez por requisição pelo middleware global abaixo —
// req.profile fica disponível para todo o resto do arquivo sem round-trip a
// serviço nenhum. Mantém o mesmo shape ({id, role, name}) que o resto deste
// arquivo (CRM/pipeline/tags/audit) já espera, para não precisar tocar em
// nenhum call site existente.
app.use(authModule.sessionMiddleware);
app.use((req, _res, next) => {
  if (req.profile) req.profile.name = req.profile.fullName;
  next();
});
// Nota de escopo: as rotas legadas de CRM/WhatsApp abaixo (contacts, tags,
// pipeline, conexões, etc.) já eram e continuam protegidas contra CSRF pelo
// par requireApiKey (header customizado) + CORS restrito a FRONTEND_ORIGIN —
// nenhum site de terceiro consegue montar essa combinação num POST forjado.
// O double-submit de /auth e /comms (authz.js:checkCsrf) é uma camada extra
// específica da nova sessão em cookie, não uma lacuna sendo deixada aqui.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!PG_CONFIGURED) return res.status(503).json({ error: 'Autenticação ainda não configurada neste servidor.' });
    if (!req.profile || req.session?.aal !== 'aal2' || !roles.includes(req.profile.role)) {
      return res.status(403).json({ error: 'Acesso restrito.' });
    }
    next();
  };
}

// Exige só um usuário autenticado (qualquer papel) — usado nas rotas de
// organização pessoal (pipeline, tags, configurações anti-ban), onde o que
// importa não é o papel e sim SABER QUEM está perguntando, pra isolar os
// dados de cada um.
function requireProfile(req, res, next) {
  if (!PG_CONFIGURED) return res.status(503).json({ error: 'Autenticação ainda não configurada neste servidor.' });
  if (!req.profile || req.session?.aal !== 'aal2') return res.status(401).json({ error: 'Login necessário.' });
  next();
}

// Compat: várias rotas abaixo chamam `await getCallerProfile(req)` direto (em
// vez de usar o middleware requireRole/requireProfile) quando o papel é só
// checado condicionalmente no meio do handler. Antes isso fazia um round-trip
// ao Supabase por chamada; agora é só devolver o req.profile já resolvido
// pelo sessionMiddleware global (sem round-trip nenhum).
async function getCallerProfile(req) {
  if (!req.profile || !req.session || req.session.aal !== 'aal2') return null;
  return req.profile;
}

app.use('/auth', authModule.router);
app.use('/comms', commsModule.router);
app.get('/comms/attachments/:channelId/:filename', downloadAttachment);

// ───────────────────────── WS broadcast ────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', async (ws, req) => {
  const { searchParams } = new URL(req.url, 'http://internal');
  if (searchParams.get('apiKey') !== ENGINE_API_KEY) {
    ws.close(4001, 'API key inválida');
    return;
  }
  clients.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => { clients.delete(ws); realtimeModule.unregisterConnection(ws); });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return console.error(e); }
    if (typeof msg.type === 'string' && msg.type.startsWith('comms:')) {
      realtimeModule.handleCommsMessage(ws, msg).catch((e) => console.error('[realtime]', e));
      return;
    }
    try { handleClientMessage(msg, ws); } catch (e) { console.error(e); }
  });

  // Autentica a conexão para o protocolo comms:* a partir do cookie de sessão
  // (mesma origem via proxy nginx — o navegador já anexa o cookie no handshake
  // do WebSocket, igual faria numa requisição HTTP normal para o mesmo host).
  const resolved = await authModule.resolveSessionFromCookieHeader(req.headers.cookie).catch(() => null);
  if (resolved) realtimeModule.registerConnection(ws, resolved.profile);

  // Snapshot de todas as conexões (números) configuradas + a conexão
  // 'default' isolada em 'hello' pra manter compatibilidade com o frontend
  // que ainda só entende um número só.
  ws.send(JSON.stringify({ type: 'connections-snapshot', connections: listConnectionsSnapshot() }));
  const d = getConn('default');
  ws.send(JSON.stringify({
    type: 'hello',
    status: d.ready ? 'ready' : (d.qr ? 'qr' : (d.initializing ? 'connecting' : 'disconnected')),
    me: d.me, qr: d.qr,
  }));
});

// Heartbeat: derruba conexões mortas a cada 30s
setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of clients) { try { c.send(data); } catch {} }
}

// Agenda/Notificações — mesma natureza de dado multiusuário da Comunicação
// Interna (Postgres), entrega em tempo real reaproveitando o WS único.
const agendaDeps = { broadcastAll: broadcast, broadcastToUser: realtimeModule.broadcastToUser };
app.use('/notifications', notificationsModule.router);
app.use('/agenda', agendaModule.createRouter(agendaDeps));
agendaModule.startReminderScanner(agendaDeps);
// Funis de CRM customizados (compartilhados) — ver whatsapp-engine/funis.js.
app.use('/funis', funisModule.createRouter());
// Anotações (pastas/itens/notas/tabelas) — ver whatsapp-engine/annotations.js.
app.use('/annotations', annotationsModule.createRouter());

// actor: { id, name } | null — null = evento de sistema (conexão, erro geral),
// sempre visível pra todo mundo. Com actor, só quem tem esse id (ou Sócio) vê
// no feed "Atividade recente" — ver GET /logs.
function logEvent(level, message, contact, actor) {
  db.prepare('INSERT INTO logs (ts, level, message, contact, actor_id, actor_name) VALUES (?,?,?,?,?,?)')
    .run(Date.now(), level, message, contact || null, actor?.id || null, actor?.name || null);
  broadcast({ type: 'log', level, message, contact, actorId: actor?.id || null, actorName: actor?.name || null });
  console.log(`[${level}] ${message}${contact ? ' • ' + contact : ''}${actor ? ' (por ' + actor.name + ')' : ''}`);
}

// ──────────────────────── WhatsApp client(s) ────────────────────
// Um Map em vez de um client único: cada conexão (número de WhatsApp) tem sua
// própria sessão, seu próprio Chromium e seu próprio estado de QR/pronto.
// 'default' sempre existe (número principal, compatível com deployments
// antigos de número único). Custo real de cada conexão extra: ~500MB-1GB de
// RAM (um Chromium inteiro por número) — ver aviso na doc de deploy.
const connState = new Map(); // id -> { client, qr, ready, initializing, me, reconnectAttempts }
function getConn(id) {
  if (!connState.has(id)) connState.set(id, { client: null, qr: null, ready: false, initializing: false, me: null, reconnectAttempts: 0, manualLogout: false });
  return connState.get(id);
}
function listConnectionsSnapshot() {
  const rows = db.prepare('SELECT * FROM connections ORDER BY created_at').all();
  return rows.map((r) => {
    const c = getConn(r.id);
    return {
      id: r.id,
      label: r.label,
      status: c.ready ? 'ready' : (c.qr ? 'qr' : (c.initializing ? 'connecting' : 'disconnected')),
      me: c.me,
      qr: c.qr,
      number: c.meNumber || null,
    };
  });
}

// 4 últimos dígitos do número que RECEBEU a conversa (não o do cliente) —
// só existe enquanto essa conexão estiver com sessão ativa (client.info.wid
// só é conhecido depois do 'ready'); sem isso, undefined (nunca um
// placeholder — pedido explícito da Parte T3).
function connectionLast4(connectionId) {
  const st = connState.get(connectionId || 'default');
  const digits = String(st?.meNumber || '').replace(/\D+/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

const AVATAR_REFRESH_MS = 24 * 60 * 60 * 1000; // 24h — nunca busca no WhatsApp a cada render

// Foto de perfil real do WhatsApp, com cache em disco. path=NULL registrado
// quando o cliente não tem foto (ou privacidade bloqueia) — frontend cai
// pras iniciais nesse caso. Falha de rede/sessão não apaga o que já estava
// em cache (devolve o path antigo em vez de derrubar pra null).
async function getProfilePicPath(telefone, connectionId) {
  const row = db.prepare('SELECT * FROM contact_avatars WHERE telefone=?').get(telefone);
  const now = Date.now();
  if (row && (now - row.fetched_at) < AVATAR_REFRESH_MS) return row.path;
  const st = getConn(connectionId || 'default');
  if (!st.ready) return row?.path ?? null;
  try {
    const url = await st.client.getProfilePicUrl(`${telefone}@c.us`);
    let relPath = null;
    if (url) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`status ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      const filename = `avatar_${telefone}.jpg`;
      fs.writeFileSync(path.join(MEDIA_DIR, filename), buf);
      relPath = `/media/${filename}`;
    }
    db.prepare(`INSERT INTO contact_avatars (telefone, path, fetched_at) VALUES (?,?,?)
                ON CONFLICT(telefone) DO UPDATE SET path=excluded.path, fetched_at=excluded.fetched_at`)
      .run(telefone, relPath, now);
    return relPath;
  } catch (e) {
    return row?.path ?? null; // mantém o cache anterior (ou null) em caso de falha
  }
}

function buildClient(connectionId) {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, '.wwebjs_auth', connectionId) }),
    puppeteer: {
      headless: true,
      // Em produção (Railway/Docker), aponta para o Chromium instalado via apt no
      // Dockerfile (ver whatsapp-engine/Dockerfile). Sem essa env, cai no Chromium
      // baixado pelo próprio puppeteer (padrão em desenvolvimento local).
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
      ],
    },
  });
}

function attachWaHandlers(client, connectionId) {
  const st = getConn(connectionId);
  client.on('qr', async (qr) => {
    try {
      st.qr = await QRCode.toDataURL(qr);
      st.ready = false;
      broadcast({ type: 'qr', connectionId, qr: st.qr });
      logEvent('info', `QR Code gerado (${connectionId}). Escaneie no WhatsApp.`);
    } catch (e) { console.error(e); }
  });
  client.on('authenticated', () => logEvent('info', `Sessão autenticada (${connectionId}).`));
  client.on('auth_failure', (m) => logEvent('error', `Falha de autenticação (${connectionId}): ` + m));
  client.on('ready', () => {
    st.ready = true; st.initializing = false; st.qr = null; st.reconnectAttempts = 0;
    st.me = client.info?.pushname || client.info?.wid?.user || 'WhatsApp';
    // Guardado à parte de st.me (que pode ser o pushname, um nome comercial
    // qualquer) — meNumber é sempre os dígitos reais do número, única fonte
    // confiável pros 4 últimos dígitos mostrados na lista de conversas.
    st.meNumber = client.info?.wid?.user || null;
    broadcast({ type: 'ready', connectionId, me: st.me });
    logEvent('success', `Conectado como ${st.me} (${connectionId})`);
  });
  client.on('disconnected', (reason) => {
    st.ready = false; st.me = null; st.meNumber = null;
    broadcast({ type: 'disconnected', connectionId, reason: String(reason || '') });
    // Logout manual (via /connections/:id/logout ou WS 'logout') já zerou o
    // estado e não deve reconectar sozinho — só reconecta em queda inesperada.
    if (st.manualLogout) { st.manualLogout = false; return; }
    logEvent('warn', `Desconectado (${connectionId}): ${reason}. Reconectando em 5s…`);
    scheduleReconnect(connectionId);
  });
  client.on('change_state', (state) => broadcast({ type: 'wa-state', connectionId, state }));

  client.on('message', async (msg) => {
    try { await handleIncomingMessage(msg, connectionId); } catch (e) { console.error(e); }
  });
  client.on('message_create', async (msg) => {
    if (!msg.fromMe) return;
    try { await handleOutgoingMirror(msg, connectionId); } catch (e) { console.error(e); }
  });
  client.on('message_ack', (msg, ack) => {
    try {
      const id = msg.id._serialized;
      db.prepare('UPDATE messages SET ack=? WHERE id=?').run(ack, id);
      // msg.to pode vir como "...@lid" pra contas migradas (ver
      // handleOutgoingMirror) — em vez de confiar nele, busca o chat_id
      // canônico que a própria mensagem já tem gravado, garantindo que o
      // ✓✓ chegue no chat certo instantaneamente via WS.
      const row = db.prepare('SELECT chat_id FROM messages WHERE id=?').get(id);
      broadcast({ type: 'ack', connectionId, id, chatId: row?.chat_id, ack });
    } catch {}
  });
  // "Apagar para todos" no WhatsApp real — isso só deveria remover a
  // mensagem da tela de QUEM apagou e de quem recebeu a revogação (o outro
  // lado da conversa). Aqui a gente NUNCA apaga/zera o body já persistido —
  // só marca revoked_at, preservando o conteúdo original 100% visível pro
  // time, exatamente como já vale para conversas arquivadas.
  client.on('message_revoke_everyone', (message) => {
    try {
      const id = message.id._serialized;
      const existing = db.prepare('SELECT id, chat_id FROM messages WHERE id=?').get(id);
      if (!existing) return; // nunca vimos essa mensagem — nada a preservar
      const ts = Date.now();
      db.prepare('UPDATE messages SET revoked_at=? WHERE id=?').run(ts, id);
      broadcast({ type: 'message-revoked', connectionId, chatId: existing.chat_id, messageId: id, revokedAt: ts });
    } catch (e) { console.error('[revoke]', e.message); }
  });
}

function scheduleReconnect(connectionId) {
  const st = getConn(connectionId);
  st.reconnectAttempts++;
  const delay = Math.min(60000, 3000 * st.reconnectAttempts);
  setTimeout(() => initWa(connectionId).catch(() => {}), delay);
}

// Desconecta uma conexão a pedido do usuário. Zera o estado e avisa o
// frontend IMEDIATAMENTE — não espera o evento 'disconnected' do
// whatsapp-web.js, que pode demorar ou nunca chegar a disparar (deixando a
// UI presa em "conectado" mesmo depois do logout).
async function disconnectConnection(connectionId) {
  const st = connState.get(connectionId);
  if (!st) return;
  const client = st.client;
  st.client = null;
  st.ready = false;
  st.qr = null;
  st.me = null;
  st.meNumber = null;
  st.initializing = false;
  st.manualLogout = true;
  broadcast({ type: 'disconnected', connectionId, reason: 'manual-logout' });
  logEvent('warn', `Desconectado manualmente (${connectionId}).`);
  if (client) {
    try { await client.logout(); } catch {}
    try { await client.destroy(); } catch {}
  }
}

// Depois de um restart não-gracioso do container (kill -9, OOM, docker
// restart no meio de uma sessão), o Chromium anterior morre sem apagar os
// próprios SingletonLock/SingletonCookie/SingletonSocket dentro do profile
// (persistido no volume engine_data). O próximo client.initialize() então
// falha achando que "outro processo" ainda está usando o profile — mesmo
// não havendo mais nenhum processo rodando — e o QR nunca chega a ser
// gerado. Como o volume garante que só este container acessa esse profile,
// é seguro limpar esses arquivos de trava antes de cada tentativa de início.
function clearStaleSingletonLocks(connectionId) {
  const sessionDir = path.join(DATA_DIR, '.wwebjs_auth', connectionId, 'session');
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(sessionDir, name)); } catch { /* não existe — ok */ }
  }
}

async function initWa(connectionId) {
  const st = getConn(connectionId);
  if (st.initializing || st.ready) return;
  st.initializing = true;
  broadcast({ type: 'connecting', connectionId });
  try {
    if (st.client) { try { await st.client.destroy(); } catch {} }
    clearStaleSingletonLocks(connectionId);
    st.client = buildClient(connectionId);
    attachWaHandlers(st.client, connectionId);
    await st.client.initialize();
  } catch (e) {
    st.initializing = false;
    logEvent('error', `Falha ao iniciar cliente WhatsApp (${connectionId}): ` + e.message);
    scheduleReconnect(connectionId);
  }
}

// Inicializa todas as conexões já configuradas no banco (normalmente só
// 'default', a menos que novos números tenham sido adicionados).
for (const row of db.prepare('SELECT id FROM connections').all()) {
  initWa(row.id);
}

// ──────────────────────── Conversations ────────────────────────
function upsertConversation({ chatId, telefone, nome, body, ts, fromMe, connectionId, assignee }) {
  const exists = db.prepare('SELECT id, unread FROM conversations WHERE id=?').get(chatId);
  if (exists) {
    const unread = fromMe ? 0 : (exists.unread || 0) + 1;
    db.prepare('UPDATE conversations SET last_message=?, last_ts=?, unread=?, nome=COALESCE(?, nome) WHERE id=?')
      .run(body, ts, unread, nome || null, chatId);
  } else {
    // Uma conversa nova que NÓS iniciamos (fromMe) já nasce assumida por quem
    // mandou a primeira mensagem — não faz sentido cair em "pendente"
    // esperando alguém assumir algo que o próprio atendente acabou de
    // começar. Conversas que chegam de fora (fromMe=false) continuam
    // 'pendente' como sempre, aguardando alguém assumir.
    const status = fromMe ? 'atendendo' : 'pendente';
    db.prepare(`INSERT INTO conversations (id, telefone, nome, last_message, last_ts, unread, status, assignee, connection_id)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(chatId, telefone, nome || telefone, body, ts, fromMe ? 0 : 1, status, fromMe ? (assignee || null) : null, connectionId);
  }
}

async function persistMedia(msg) {
  if (!msg.hasMedia) return null;
  try {
    const media = await msg.downloadMedia();
    if (!media) return null;
    const ext = mime.extension(media.mimetype) || 'bin';
    // Nome físico em disco continua sendo o id da mensagem (garante unicidade
    // e evita path traversal) — o nome de EXIBIÇÃO real do arquivo (o que o
    // remetente anexou) vem de msg.filename/media.filename, quando o
    // WhatsApp o expõe (documentos sempre têm; fotos/áudio de câmera não têm
    // nome de verdade nem no WhatsApp original, então ficam sem essa coluna).
    const filename = `${msg.id._serialized.replace(/[^\w]/g, '_')}.${ext}`;
    const filepath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
    return { path: `/media/${filename}`, mime: media.mimetype, originalName: msg.filename || media.filename || null };
  } catch (e) { console.error('media error', e.message); return null; }
}

function mapMsgType(t) {
  if (t === 'chat') return 'text';
  if (t === 'ptt') return 'audio';
  if (['image', 'video', 'audio', 'document', 'sticker'].includes(t)) return t;
  return t || 'text';
}

// Tipos de PROTOCOLO do WhatsApp (avisos internos, nunca conteúdo real
// digitado por alguém) — apareciam na tela como "[e2e_notification]" e
// similares, parecendo uma mensagem perdida/ilegível quando na verdade nunca
// houve conteúdo nenhum ali.
const PROTOCOL_MSG_TYPES = new Set([
  'e2e_notification', 'notification', 'notification_template', 'gp2',
  'group_notification', 'call_log', 'ciphertext', 'message_ciphertext',
  'message_ciphertext_failed', 'broadcast_notification', 'protocol', 'debug',
]);

async function handleIncomingMessage(msg, connectionId) {
  if (PROTOCOL_MSG_TYPES.has(msg.type)) return; // aviso interno, não é mensagem de verdade
  const rawFrom = msg.from || '';
  if (rawFrom.endsWith('@g.us')) return; // ignore groups for now

  // Contas migradas pro novo esquema de identidade do WhatsApp fazem
  // msg.from vir como "117007911526428@lid" em vez do "5521982818751@c.us"
  // tradicional. A primeira tentativa de corrigir isso usava
  // contact.number como telefone "real" — só que pra contatos @lid,
  // contact.number TAMBÉM devolve os dígitos do LID (não o telefone de
  // verdade), o que criava uma SEGUNDA conversa falsa por contato (uma pelo
  // que nós mandamos, outra pelo que a pessoa responde). O jeito correto é
  // pedir pro próprio WhatsApp resolver o par {lid, pn} via
  // client.getContactLidAndPhone — API interna oficial da lib pra isso.
  let chatId = rawFrom;
  if (rawFrom.endsWith('@lid')) {
    try {
      const st = getConn(connectionId);
      const [resolved] = await st.client.getContactLidAndPhone([rawFrom]);
      if (resolved?.pn) chatId = resolved.pn;
    } catch (e) { console.error('[lid-resolve]', e.message); }
  }
  if (!chatId.endsWith('@c.us')) return; // não deu pra resolver o telefone real — nada a fazer

  const contact = await msg.getContact();
  const telefone = chatId.replace('@c.us', '');
  const nome = contact.pushname || contact.name || telefone;
  const ts = (msg.timestamp || Math.floor(Date.now() / 1000)) * 1000;
  const type = mapMsgType(msg.type);
  let mediaInfo = null;
  if (msg.hasMedia) mediaInfo = await persistMedia(msg);

  db.prepare(`INSERT OR REPLACE INTO messages (id, chat_id, ts, from_me, body, type, media_path, media_mime, ack, connection_id, media_filename)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(msg.id._serialized, chatId, ts, 0, msg.body || '', type, mediaInfo?.path || null, mediaInfo?.mime || null, 0, connectionId, mediaInfo?.originalName || null);

  upsertConversation({ chatId, telefone, nome, body: msg.body || (type !== 'text' ? `[${type}]` : ''), ts, fromMe: false, connectionId });

  // garante registro no CRM — casa pelo hash do telefone, nunca pelo texto puro
  const contactId = ensureContactFromChat({ telefone, nome });
  registerInboundTouch(contactId, ts);

  broadcast({ type: 'message', connectionId, message: serializeMessage(msg.id._serialized) });
  broadcast({ type: 'conversations-changed' });
}

// Resposta inbound do lead durante a cadência PAUSA a classificação
// automática (handoff pro atendimento humano) — seção 4/5 da spec. Não
// reabre/avança estágio sozinho, só sinaliza e registra os timestamps base
// de "Sem Contato 30d+" (last_contact_at) e Taxa de Conversão
// (conversation_started_at, primeira resposta inbound, nunca sobrescrita).
function registerInboundTouch(contactId, ts) {
  const row = db.prepare('SELECT * FROM contacts WHERE id=?').get(contactId);
  if (!row) return;
  const sets = ['last_contact_at=?']; const vals = [ts];
  if (!row.conversation_started_at) { sets.push('conversation_started_at=?'); vals.push(ts); }
  if (!row.is_client && row.cadence_started_at && !row.cadence_encerrado_sem_resposta) {
    sets.push('cadence_paused=?'); vals.push(1);
  }
  vals.push(contactId);
  db.prepare(`UPDATE contacts SET ${sets.join(',')} WHERE id=?`).run(...vals);
  broadcast({ type: 'contacts-changed' });
}

// assigneeId/senderName identificam quem MANDOU chamar nossa API de envio —
// mesma pessoa nos dois casos, só que assigneeId vira o "responsável" da
// conversa (se for nova) e sender_user_id/sender_name ficam gravados na
// PRÓPRIA mensagem (rótulo "enviado por" no chat, UI interna, nunca vai pro
// WhatsApp). Quando a mensagem foi mandada direto do celular (client.on
// 'message_create', sem passar pela nossa API), os dois vêm undefined —
// mensagem fica sem autor registrado, e a UI não mostra nada (sem placeholder).
async function handleOutgoingMirror(msg, connectionId, knownChatId, assigneeId, senderName) {
  // mensagens enviadas pelo próprio celular (espelhar) — ou, quando chamado
  // logo após um envio nosso (ver rotas /send*), o chatId JÁ conhecido
  // (knownChatId) tem prioridade sobre msg.to. Contas migradas pro novo
  // esquema de identidade do WhatsApp (@lid, em vez do @c.us tradicional)
  // fazem msg.to/msg.from virem algo como "117007911526428@lid" mesmo quando
  // enviamos explicitamente para um "...@c.us" — sem esse fallback, a
  // mensagem nunca era gravada (o guard abaixo sempre falhava) e o próprio
  // envio nunca aparecia no nosso histórico.
  const chatId = knownChatId || msg.to;
  if (!chatId || !chatId.endsWith('@c.us')) return;
  if (db.prepare('SELECT 1 FROM messages WHERE id=?').get(msg.id._serialized)) return;

  const ts = (msg.timestamp || Math.floor(Date.now() / 1000)) * 1000;
  const type = mapMsgType(msg.type);
  let mediaInfo = null;
  if (msg.hasMedia) mediaInfo = await persistMedia(msg);

  db.prepare(`INSERT OR REPLACE INTO messages (id, chat_id, ts, from_me, body, type, media_path, media_mime, ack, connection_id, media_filename, sender_user_id, sender_name)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(msg.id._serialized, chatId, ts, 1, msg.body || '', type, mediaInfo?.path || null, mediaInfo?.mime || null, 1, connectionId, mediaInfo?.originalName || null, assigneeId || null, senderName || null);

  upsertConversation({
    chatId, telefone: chatId.replace('@c.us', ''), nome: null,
    body: msg.body || (type !== 'text' ? `[${type}]` : ''), ts, fromMe: true, connectionId,
    assignee: assigneeId,
  });
  // last_contact_at conta toque inbound OU outbound — atualiza aqui também.
  const telHash = hashPhone(chatId.replace('@c.us', ''));
  const outContact = telHash ? db.prepare('SELECT id FROM contacts WHERE telefone_hash=?').get(telHash) : null;
  if (outContact) db.prepare('UPDATE contacts SET last_contact_at=? WHERE id=?').run(ts, outContact.id);

  // Qualificação do CRM é sempre manual (pedido explícito do usuário) — enviar
  // mensagem pro cliente nunca move a etapa sozinho, nem na primeira resposta.

  broadcast({ type: 'message', connectionId, message: serializeMessage(msg.id._serialized) });
  broadcast({ type: 'conversations-changed' });
}

function serializeMessage(id) {
  return db.prepare('SELECT * FROM messages WHERE id=?').get(id);
}

// Casa pelo HASH do telefone (nunca pelo texto puro) — mesmo com o telefone
// criptografado em repouso, mensagens recebidas continuam sendo linkadas ao
// contato certo.
function ensureContactFromChat({ telefone, nome }) {
  const tel = String(telefone || '').replace(/\D+/g, '');
  const hash = tel ? hashPhone(tel) : null;
  const exists = hash ? db.prepare('SELECT id FROM contacts WHERE telefone_hash=?').get(hash) : null;
  if (exists) return exists.id;
  const id = randomId();
  // atua_mercado_financeiro nasce 'A_CONFIRMAR', nunca SIM/NULL direto — um
  // contato que só existe porque alguém mandou uma mensagem ainda não foi
  // triado por ninguém, então NÃO deve contar como "Lead Frio" de verdade
  // nas métricas/Contatos até um atendente decidir isso (ver
  // POST /conversations/:id/finish-triage). O filtro de "elegível" em
  // GET /metrics já exclui qualquer atua_mercado_financeiro != SIM — usar
  // A_CONFIRMAR aqui é o que faz esse contato ficar neutro (nem cliente, nem
  // lead frio, nem desqualificado) até ser realmente triado.
  db.prepare(`INSERT INTO contacts (id, nome, telefone_enc, telefone_hash, telefone_display, status, atua_mercado_financeiro, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, nome || telefone, tel ? encrypt(tel) : null, hash, tel ? displayPhone(tel) : null, 'novo', 'A_CONFIRMAR', Date.now());
  return id;
}

function randomId() {
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Descriptografa os campos sensíveis de uma linha de `contacts` para a resposta da API.
 *  Mantém os mesmos nomes de campo (telefone/documento) que a API sempre teve —
 *  o frontend não precisa saber que por baixo dos panos isso é criptografado. */
function decorateContact(row) {
  if (!row) return row;
  const {
    telefone_enc, telefone_hash, telefone_display, documento_enc,
    is_client, is_client_since, atua_mercado_financeiro, responsavel_id,
    last_contact_at, conversation_started_at,
    cadence_started_at, cadence_last_touch_at,
    cadence_touch_d1_done, cadence_touch_d3_done, cadence_touch_d7_done, cadence_touch_d15_done, cadence_touch_d75_done,
    cadence_d15_done_at, cadence_paused, cadence_encerrado_sem_resposta, cadence_stage_cache,
    delete_requested_by, delete_requested_by_name, delete_requested_at,
    ...rest
  } = row;
  const { stage, dueAt, overdue } = computeCadence(row);
  return {
    ...rest,
    telefone: decrypt(telefone_enc),
    telefoneDisplay: telefone_display,
    documento: decrypt(documento_enc),
    // Cliente da Assessoria / Lead Frio + Cadência — cadenceStage/dueAt/overdue
    // são sempre recalculados aqui (nunca lidos de cadence_stage_cache).
    isClient: !!is_client,
    isClientSince: is_client_since || null,
    atuaMercadoFinanceiro: atua_mercado_financeiro || null,
    responsavelId: responsavel_id || null,
    lastContactAt: last_contact_at || null,
    conversationStartedAt: conversation_started_at || null,
    cadenceStartedAt: cadence_started_at || null,
    cadenceLastTouchAt: cadence_last_touch_at || null,
    cadenceTouches: {
      d1: !!cadence_touch_d1_done, d3: !!cadence_touch_d3_done, d7: !!cadence_touch_d7_done,
      d15: !!cadence_touch_d15_done, d75: !!cadence_touch_d75_done,
    },
    cadencePaused: !!cadence_paused,
    cadenceStage: stage,
    cadenceDueAt: dueAt,
    cadenceOverdue: overdue,
    deleteRequestedBy: delete_requested_by || null,
    deleteRequestedByName: delete_requested_by_name || null,
    deleteRequestedAt: delete_requested_at || null,
  };
}

// ─────────────────────── Outbound helpers ──────────────────────
// NOTA: o motor de disparo em massa (campanha) roda inteiramente no frontend,
// sequencialmente via HTTP POST /send (ver src/lib/engine.ts::runHttpCampaign).
// Um segundo motor de campanha (via mensagens WS 'start-campaign') existia aqui
// e foi removido de propósito: ele nunca é mais acionado pelo frontend atual,
// mas se permanecesse ativo poderia ser disparado por engano (msg WS manual,
// build antigo em cache, etc.) e rodar EM PARALELO ao disparo HTTP, ignorando
// os delays e o limite de "1 contato por vez" configurados no CRM.
async function sendText(chatId, body, connectionId = 'default') {
  const st = getConn(connectionId);
  if (!st.ready) throw new Error('WhatsApp não conectado');
  return st.client.sendMessage(chatId, body);
}

async function sendMediaFile(chatId, filepath, mimetype, caption, connectionId = 'default', asDocument = false, originalFilename = null) {
  const st = getConn(connectionId);
  if (!st.ready) throw new Error('WhatsApp não conectado');
  const data = fs.readFileSync(filepath).toString('base64');
  // multer salva o upload num arquivo temporário com nome aleatório (sem
  // relação com o nome real escolhido pelo usuário) — sem originalFilename
  // aqui, esse nome aleatório era o que o cliente via chegar no WhatsApp dele.
  const filename = originalFilename || path.basename(filepath);
  const media = new MessageMedia(mimetype, data, filename);
  const opts = caption ? { caption } : {};
  if (mimetype.startsWith('audio/')) opts.sendAudioAsVoice = true;
  // "Documento" no menu "+" força o envio como arquivo bruto mesmo que seja
  // uma imagem/vídeo — igual ao WhatsApp de verdade, onde "Documento" e
  // "Fotos e vídeos" são fluxos distintos. Sem essa flag, imagem/vídeo
  // escolhido em "Fotos e vídeos" já vai como mídia nativa (preview inline),
  // nunca como arquivo, só pelo mimetype detectado.
  if (asDocument) opts.sendMediaAsDocument = true;
  return st.client.sendMessage(chatId, media, opts);
}

// vCard mínimo (nome + telefone) — client.sendMessage já reconhece uma
// string nesse formato e converte pra bolha de "Contato" nativa do
// WhatsApp (parseVCards é true por padrão).
function buildVCard(nome, telefone) {
  const tel = String(telefone || '').replace(/\D+/g, '');
  return `BEGIN:VCARD\nVERSION:3.0\nFN:${nome}\nTEL;TYPE=CELL:+${tel}\nEND:VCARD`;
}

async function sendContactCard(chatId, nome, telefone, connectionId = 'default') {
  const st = getConn(connectionId);
  if (!st.ready) throw new Error('WhatsApp não conectado');
  return st.client.sendMessage(chatId, buildVCard(nome, telefone));
}

// Resolve qual conexão (número) atende uma conversa já existente — evita
// exigir que o frontend saiba/mande o connectionId pra ações em cima de uma
// conversa que já existe (ela já sabe a qual número pertence).
function connectionIdForConversation(chatId) {
  const row = db.prepare('SELECT connection_id FROM conversations WHERE id=?').get(chatId);
  return row?.connection_id || 'default';
}

// ─────────────────────────── Routes ────────────────────────────
// Mantido por compatibilidade — reflete sempre a conexão 'default' (número
// principal). Para o estado de TODOS os números, ver GET /connections.
app.get('/status', (req, res) => {
  const st = getConn(req.query.connectionId || 'default');
  res.json({
    ok: true,
    whatsapp: st.ready ? 'ready' : (st.qr ? 'qr' : (st.initializing ? 'connecting' : 'disconnected')),
    me: st.me,
    qr: st.qr,
    uptime: process.uptime(),
  });
});

// ─────────────────────── Conexões (múltiplos números) ───────────
app.get('/connections', (_req, res) => {
  res.json(listConnectionsSnapshot().map((c) => ({ ...c, last4: connectionLast4(c.id) })));
});

// Foto de perfil real do WhatsApp (com cache — ver getProfilePicPath). Chave
// é o telefone do CLIENTE, não o id da tabela contacts, porque a lista de
// conversas também precisa da foto pra números ainda não salvos como contato.
app.get('/avatars/:telefone', async (req, res) => {
  const telefone = String(req.params.telefone).replace(/\D+/g, '');
  if (!telefone) return res.status(400).json({ error: 'Telefone inválido' });
  const connectionId = connectionIdForConversation(`${telefone}@c.us`);
  const path_ = await getProfilePicPath(telefone, connectionId);
  res.json({ path: path_ });
});

app.post('/connections', requireRole('socio'), (req, res) => {
  const id = String(req.body?.id || '').trim().toLowerCase();
  const label = String(req.body?.label || '').trim();
  if (!id || !label) return res.status(400).json({ error: 'id e label são obrigatórios' });
  if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'id deve conter só letras minúsculas, números e hífen' });
  if (db.prepare('SELECT id FROM connections WHERE id=?').get(id)) return res.status(409).json({ error: 'já existe uma conexão com esse id' });
  db.prepare('INSERT INTO connections (id, label, created_at) VALUES (?,?,?)').run(id, label, Date.now());
  broadcast({ type: 'connections-changed' });
  initWa(id);
  res.json({ ok: true, id });
});

app.delete('/connections/:id', requireRole('socio'), async (req, res) => {
  const id = req.params.id;
  if (id === 'default') return res.status(400).json({ error: 'a conexão principal (default) não pode ser removida' });
  await disconnectConnection(id);
  connState.delete(id);
  db.prepare('DELETE FROM connections WHERE id=?').run(id);
  broadcast({ type: 'connections-changed' });
  res.json({ ok: true });
});

app.post('/connections/:id/request-qr', (req, res) => {
  const id = req.params.id;
  if (!db.prepare('SELECT id FROM connections WHERE id=?').get(id)) return res.status(404).json({ error: 'conexão não encontrada' });
  const st = getConn(id);
  if (!st.ready) {
    // `initializing` fica true assim que o cliente começa a subir e só volta a
    // false no evento 'ready' — ou seja, continua true o tempo todo em que a
    // conexão está parada esperando o scan do QR. Sem resetar aqui, o "Atualizar
    // QR" nunca conseguia passar da guarda de initWa() e não fazia nada.
    st.initializing = false;
    initWa(id).catch(() => {});
  }
  res.json({ ok: true });
});

app.post('/connections/:id/logout', async (req, res) => {
  await disconnectConnection(req.params.id);
  res.json({ ok: true });
});

app.post('/connections/:id/reconnect', (req, res) => {
  initWa(req.params.id);
  res.json({ ok: true });
});

// ─────────────────────── Trava de campanha por número ───────────
// Servidor-side (não no navegador de cada usuário) — impede que DOIS
// ATENDENTES DIFERENTES, cada um no seu computador, iniciem disparo pro MESMO
// número ao mesmo tempo. Cada número tem sua própria trava; números
// diferentes podem disparar em paralelo sem problema.
const campaignLocks = new Map(); // connectionId -> { actor, startedAt }
const MAX_CAMPAIGN_LOCK_MS = 2 * 60 * 60 * 1000; // 2h — trava expira sozinha se um navegador travar/fechar sem avisar

function isCampaignLocked(connectionId) {
  const lock = campaignLocks.get(connectionId);
  if (!lock) return false;
  if (Date.now() - lock.startedAt > MAX_CAMPAIGN_LOCK_MS) { campaignLocks.delete(connectionId); return false; }
  return true;
}

app.post('/campaigns/lock', async (req, res) => {
  const connectionId = req.body?.connectionId || 'default';
  if (isCampaignLocked(connectionId)) {
    const lock = campaignLocks.get(connectionId);
    return res.status(409).json({ error: `Já existe um disparo em andamento para este número (iniciado por ${lock.actor}).` });
  }
  const profile = await getCallerProfile(req);
  campaignLocks.set(connectionId, { actor: profile?.name || 'desconhecido', startedAt: Date.now() });
  res.json({ ok: true });
});

app.post('/campaigns/unlock', (req, res) => {
  const connectionId = req.body?.connectionId || 'default';
  campaignLocks.delete(connectionId);
  res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// Contacts CRM
// Contatos são compartilhados (nome/telefone/campos), mas tags e etapa do
// pipeline são organização PESSOAL — por isso essa rota calcula `tags` e
// `status` relativos a QUEM está pedindo. Sem login identificável (chamada
// só com a API key), devolve os contatos sem tags/etapa pessoal (não dá pra
// saber de quem seriam).
app.get('/contacts', async (req, res) => {
  const profile = await getCallerProfile(req);
  if (!profile) {
    const rows = db.prepare(`SELECT * FROM contacts ORDER BY created_at DESC`).all();
    return res.json(rows.map((r) => ({ ...decorateContact(r), tags: [], status: 'novo' })));
  }
  ensureDefaultStages(profile.id);
  const firstStage = db.prepare('SELECT key FROM pipeline_stages WHERE user_id=? ORDER BY ord LIMIT 1').get(profile.id)?.key || 'novo';
  const rows = db.prepare(`
    SELECT c.*, GROUP_CONCAT(t.nome) AS tag_names, cs.stage_key AS my_stage
    FROM contacts c
    LEFT JOIN contact_tags ct ON ct.contact_id = c.id AND ct.user_id = ?
    LEFT JOIN tags t ON t.id = ct.tag_id
    LEFT JOIN contact_stage cs ON cs.contact_id = c.id AND cs.user_id = ?
    GROUP BY c.id ORDER BY c.created_at DESC
  `).all(profile.id, profile.id);
  res.json(rows.map((r) => ({
    ...decorateContact(r),
    tags: r.tag_names ? r.tag_names.split(',') : [],
    status: r.my_stage || firstStage,
    // Sem isso, o board do CRM não conseguia distinguir "de fato está sendo
    // trabalhado no funil" de "só existe no banco, nunca teve interação" —
    // status sempre cai pra firstStage ('novo') quando não há linha em
    // contact_stage, fazendo até contato recém-importado (sem nenhum
    // atendimento real) aparecer lá. Ver CRM.tsx: só mostra quem tem
    // hasCrmStage=true.
    hasCrmStage: !!r.my_stage,
  })));
});

// Cadência de Follow-up — tela dedicada (sub-abas Hoje/Atrasados/Por
// estágio/Encerrados/Convertidos). Reaproveita a mesma decoração de
// GET /contacts (mesmo cálculo de cadenceStage/dueAt/overdue) pra nunca
// dessincronizar do que a aba Contatos mostra — só filtra/ordena no servidor.
app.get('/cadencia', async (req, res) => {
  const rows = db.prepare(`SELECT * FROM contacts WHERE is_client=0`).all();
  const decorated = rows
    .filter((r) => !r.atua_mercado_financeiro || r.atua_mercado_financeiro === 'SIM')
    .map((r) => decorateContact(r))
    .filter((c) => c.cadenceStage !== 'NONE');

  const { tab, estagio } = req.query;
  const now = Date.now();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate() + 1);

  let out;
  if (tab === 'hoje') {
    out = decorated.filter((c) => c.cadenceDueAt && c.cadenceDueAt >= startOfDay.getTime() && c.cadenceDueAt < endOfDay.getTime());
  } else if (tab === 'atrasados') {
    out = decorated.filter((c) => c.cadenceOverdue);
  } else if (tab === 'estagio') {
    out = decorated.filter((c) => c.cadenceStage === estagio);
  } else if (tab === 'encerrados') {
    out = decorated.filter((c) => c.cadenceStage === 'ENCERRADO_SEM_RESPOSTA');
  } else {
    out = decorated;
  }

  // Atrasados sempre no topo (seção 8 da spec).
  out.sort((a, b) => (b.cadenceOverdue ? 1 : 0) - (a.cadenceOverdue ? 1 : 0) || (a.cadenceDueAt || 0) - (b.cadenceDueAt || 0));
  res.json(out);
});

// "Convertidos" (lead frio -> Cliente da Assessoria) é um universo diferente
// do resto da tela de Cadência (is_client=1, não =0) — rota separada e fina.
// Usa is_client_since (nunca apagado ao converter) em vez de
// cadence_started_at, que é zerado justamente no momento da conversão.
app.get('/cadencia/convertidos', async (_req, res) => {
  const rows = db.prepare(`SELECT * FROM contacts WHERE is_client=1 AND is_client_since IS NOT NULL`).all();
  res.json(rows.map((r) => decorateContact(r)));
});

app.post('/contacts', async (req, res) => {
  // Opcional: se identificável, as tags do import e a etapa inicial ficam
  // associadas a quem importou (organização pessoal). Sem login, o contato
  // ainda é criado normalmente (dado compartilhado) — só não ganha tags/etapa
  // de ninguém em particular.
  const profile = await getCallerProfile(req);
  const list = Array.isArray(req.body) ? req.body : [req.body];
  const findByHash = db.prepare('SELECT id FROM contacts WHERE telefone_hash=?');
  const findById = db.prepare('SELECT id FROM contacts WHERE id=?');
  // Contato novo nasce 'A_CONFIRMAR' (mesma semântica de ensureContactFromChat)
  // — nunca NULL, senão volta a contar como Lead Frio "de graça" nas métricas
  // antes de qualquer triagem de verdade.
  const insertNew = db.prepare(`INSERT INTO contacts
    (id,nome,telefone_enc,telefone_hash,telefone_display,email,documento_enc,empresa,origem,status,observacoes,created_at,atua_mercado_financeiro)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'A_CONFIRMAR')`);
  // Reimportar um contato que já existe (mesmo telefone/id) NUNCA pode usar
  // INSERT OR REPLACE — isso apaga a linha inteira e recria com as colunas
  // ausentes voltando a NULL/0, zerando is_client/cadência/responsável que já
  // tivessem sido definidos manualmente. Um UPDATE seletivo preserva tudo que
  // não veio nesta importação.
  const updateExisting = db.prepare(`UPDATE contacts SET
    nome=?, telefone_enc=?, telefone_hash=?, telefone_display=?, email=?, documento_enc=?, empresa=?, origem=?, observacoes=?
    WHERE id=?`);
  const tagIns = db.prepare('INSERT OR IGNORE INTO contact_tags (user_id, contact_id, tag_id) VALUES (?,?,?)');
  const tagFind = db.prepare('SELECT id FROM tags WHERE user_id=? AND nome=?');
  const tagCreate = db.prepare('INSERT INTO tags (id, user_id, nome, cor, created_at) VALUES (?,?,?,?,?)');
  const stageUps = db.prepare('INSERT OR REPLACE INTO contact_stage (user_id, contact_id, stage_key, updated_at) VALUES (?,?,?,?)');
  if (profile) ensureDefaultStages(profile.id);
  let created = 0, duplicates = 0;
  const tx = db.transaction((contacts) => {
    for (const c of contacts) {
      const tel = String(c.telefone || '').replace(/\D+/g, '');
      const hash = tel ? hashPhone(tel) : null;
      const existing = (c.id && findById.get(c.id)) || (hash ? findByHash.get(hash) : null);
      let cid;
      if (existing) {
        cid = existing.id;
        updateExisting.run(
          c.nome, tel ? encrypt(tel) : null, hash, tel ? displayPhone(tel) : null,
          c.email || null, c.documento ? encrypt(String(c.documento)) : null,
          c.empresa || null, c.origem || null, c.observacoes || null,
          cid,
        );
        duplicates++;
      } else {
        cid = randomId();
        insertNew.run(
          cid, c.nome,
          tel ? encrypt(tel) : null,
          hash,
          tel ? displayPhone(tel) : null,
          c.email || null,
          c.documento ? encrypt(String(c.documento)) : null,
          c.empresa || null, c.origem || null, c.status || 'novo', c.observacoes || null, c.createdAt || Date.now(),
        );
        created++;
      }
      if (profile) {
        const tags = (c.tags && c.tags.length) ? c.tags : (c.tag ? [c.tag] : []);
        for (const tname of tags) {
          const norm = String(tname).toLowerCase().trim();
          if (!norm) continue;
          let row = tagFind.get(profile.id, norm);
          if (!row) { const tid = randomId(); tagCreate.run(tid, profile.id, norm, randomColor(), Date.now()); row = { id: tid }; }
          tagIns.run(profile.id, cid, row.id);
        }
        // skipStage: true (só a importação por planilha manda isso) — CRM é
        // o funil de atendimento ativo, não uma cópia de "todo contato que
        // existe". Sem essa flag, todo import criava uma linha em
        // contact_stage e o contato aparecia na coluna "Novo" do board sem
        // ninguém ter sequer falado com ele ainda (ver GET /contacts
        // hasCrmStage). A ficha manual de "Novo contato" continua mandando
        // c.status normalmente e respeitando a Etapa escolhida ali.
        if (c.status && !c.skipStage) stageUps.run(profile.id, cid, c.status, Date.now());
      }
      // Cliente da Assessoria / Lead Frio — seção 3 da spec (Aba Importar).
      // `isClient` é opcional aqui: o botão simples "Importar" nunca manda
      // esse campo (contato fica 'A_CONFIRMAR', cai em Contatos não salvos até
      // alguém triar de verdade); só "Importar e Salvar" manda isClient, e aí
      // sim classifica na hora — "Não, são leads frios" é a própria triagem
      // (atua_mercado_financeiro='SIM', confirma que é um lead frio de
      // verdade, não fica pendente).
      if (typeof c.isClient === 'boolean') {
        const responsavelId = c.responsavelId || profile?.id || null;
        db.prepare('UPDATE contacts SET is_client=?, atua_mercado_financeiro=?, cadence_started_at=?, responsavel_id=? WHERE id=?')
          .run(c.isClient ? 1 : 0, c.isClient ? null : 'SIM', c.isClient ? null : Date.now(), c.isClient ? null : responsavelId, cid);
        if (!c.isClient) {
          const updated = db.prepare('SELECT * FROM contacts WHERE id=?').get(cid);
          syncFunnelStage(updated, profile);
        }
      }
    }
  });
  tx(list);
  broadcast({ type: 'contacts-changed' });
  res.json({ ok: true, count: list.length, created, duplicates });
});

// Move o contato no Funil do CRM (contact_stage do responsável) de acordo com
// o estado de cadência/cliente — seção 7 da spec: D1 -> 'novo', vira Cliente
// da Assessoria -> 'fechado'. Reaproveita a mesma transação/pipeline_history
// que POST /contacts/:id/stage já usa. Sem responsavel_id definido, não há
// de quem funil mexer (toque não tem dono ainda).
function syncFunnelStage(contact, actorProfile) {
  const userId = contact.responsavel_id;
  if (!userId) return;
  ensureDefaultStages(userId);
  const targetStage = contact.is_client ? 'fechado' : (contact.cadence_started_at ? 'novo' : null);
  if (!targetStage) return;
  const stage = db.prepare('SELECT key, terminal FROM pipeline_stages WHERE user_id=? AND key=?').get(userId, targetStage);
  if (!stage) return;
  const currentStage = db.prepare('SELECT stage_key FROM contact_stage WHERE user_id=? AND contact_id=?').get(userId, contact.id)?.stage_key || null;
  if (currentStage === targetStage) return;
  const tx = db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO contact_stage (user_id, contact_id, stage_key, updated_at) VALUES (?,?,?,?)')
      .run(userId, contact.id, targetStage, Date.now());
    db.prepare('INSERT INTO pipeline_history (id, contact_id, from_stage, to_stage, ts, user, user_id) VALUES (?,?,?,?,?,?,?)')
      .run(randomId(), contact.id, currentStage, targetStage, Date.now(), actorProfile?.name || 'sistema', userId);
    if (stage.terminal && contact.telefone_enc) {
      const tel = decrypt(contact.telefone_enc);
      if (tel) db.prepare(`UPDATE conversations SET status='finalizado' WHERE id=?`).run(`${tel}@c.us`);
    }
  });
  tx();
  broadcast({ type: 'contacts-changed' });
  broadcast({ type: 'pipeline-history-changed', contactId: contact.id });
  if (stage.terminal) broadcast({ type: 'conversations-changed' });
}

app.patch('/contacts/:id', async (req, res) => {
  const existing = db.prepare('SELECT * FROM contacts WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'contato não encontrado' });
  const profile = await getCallerProfile(req);
  const now = Date.now();

  const sets = []; const vals = [];
  if ('nome' in req.body) { sets.push('nome=?'); vals.push(req.body.nome); }
  if ('telefone' in req.body) {
    const tel = String(req.body.telefone || '').replace(/\D+/g, '');
    sets.push('telefone_enc=?'); vals.push(tel ? encrypt(tel) : null);
    sets.push('telefone_hash=?'); vals.push(tel ? hashPhone(tel) : null);
    sets.push('telefone_display=?'); vals.push(tel ? displayPhone(tel) : null);
  }
  if ('documento' in req.body) {
    sets.push('documento_enc=?'); vals.push(req.body.documento ? encrypt(String(req.body.documento)) : null);
  }
  for (const f of ['email', 'empresa', 'origem', 'status', 'observacoes']) {
    if (f in req.body) { sets.push(`${f}=?`); vals.push(req.body[f]); }
  }

  // ─── Cliente da Assessoria / Lead Frio + Cadência (seção 1 e 4 da spec) ───
  if ('atua_mercado_financeiro' in req.body) {
    const v = req.body.atua_mercado_financeiro;
    const VALID = ['SIM', 'NAO', 'NUMERO_MUDOU_TITULAR', 'A_CONFIRMAR', 'CONCORRENCIA'];
    if (v !== null && !VALID.includes(v)) return res.status(400).json({ error: 'atua_mercado_financeiro inválido' });
    sets.push('atua_mercado_financeiro=?'); vals.push(v);
    if (v && v !== 'SIM') {
      // Diferente de SIM: encerra cadência e exclui de toda métrica (não conta
      // nem como sucesso nem como fracasso) — não é ENCERRADO_SEM_RESPOSTA
      // (reservado para "D75 tocado sem resposta"), é simplesmente "sai do jogo".
      sets.push('cadence_started_at=?'); vals.push(null);
      logEvent('info', `Cadência encerrada — atua_mercado_financeiro=${v}`, existing.id, profile);
    }
  }

  if ('responsavel_id' in req.body) { sets.push('responsavel_id=?'); vals.push(req.body.responsavel_id || null); }

  if ('is_client' in req.body) {
    const next = req.body.is_client ? 1 : 0;
    if (next !== existing.is_client) {
      sets.push('is_client=?'); vals.push(next);
      if (next === 1) {
        sets.push('is_client_since=?'); vals.push(now);
        sets.push('cadence_started_at=?'); vals.push(null);
        sets.push('cadence_paused=?'); vals.push(0);
        logEvent('success', 'Contato virou Cliente da Assessoria', existing.id, profile);
      } else {
        sets.push('cadence_started_at=?'); vals.push(now);
        sets.push('cadence_touch_d1_done=?'); vals.push(0);
        sets.push('cadence_touch_d3_done=?'); vals.push(0);
        sets.push('cadence_touch_d7_done=?'); vals.push(0);
        sets.push('cadence_touch_d15_done=?'); vals.push(0);
        sets.push('cadence_touch_d75_done=?'); vals.push(0);
        sets.push('cadence_d15_done_at=?'); vals.push(null);
        sets.push('cadence_encerrado_sem_resposta=?'); vals.push(0);
        sets.push('cadence_paused=?'); vals.push(0);
        logEvent('info', 'Contato virou Lead Frio — cadência reiniciada em D1', existing.id, profile);
      }
    }
  }

  if (sets.length) {
    vals.push(req.params.id);
    db.prepare(`UPDATE contacts SET ${sets.join(',')} WHERE id=?`).run(...vals);
  }

  const updated = db.prepare('SELECT * FROM contacts WHERE id=?').get(req.params.id);
  syncFunnelStage(updated, profile);

  broadcast({ type: 'contacts-changed' });
  res.json({ ok: true });
});

function deleteContactCascade(id) {
  db.prepare('DELETE FROM contact_tags WHERE contact_id=?').run(id);
  db.prepare('DELETE FROM contact_stage WHERE contact_id=?').run(id);
  db.prepare('DELETE FROM contacts WHERE id=?').run(id);
}

// Sócio apaga direto — ele já É quem aprova, não faz sentido pedir aprovação
// de si mesmo. Qualquer outro papel precisa passar por
// request-delete/approve-delete abaixo.
app.delete('/contacts/:id', requireRole('socio'), (req, res) => {
  const contact = db.prepare('SELECT nome FROM contacts WHERE id=?').get(req.params.id);
  deleteContactCascade(req.params.id);
  broadcast({ type: 'contacts-changed' });
  if (contact) logEvent('warn', `Excluiu o contato "${contact.nome}"`, req.params.id, req.profile);
  res.json({ ok: true });
});

// Contato não pode simplesmente ser apagado por qualquer usuário — quem não é
// Sócio só pode SOLICITAR a exclusão; o contato continua existindo (com um
// marcador visível pra todo mundo) até um Sócio aprovar ou rejeitar.
app.post('/contacts/:id/request-delete', requireProfile, (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'contato não encontrado' });
  if (req.profile.role === 'socio') {
    deleteContactCascade(req.params.id);
    broadcast({ type: 'contacts-changed' });
    logEvent('warn', `Excluiu o contato "${contact.nome}"`, req.params.id, req.profile);
    return res.json({ ok: true, deleted: true });
  }
  db.prepare('UPDATE contacts SET delete_requested_by=?, delete_requested_by_name=?, delete_requested_at=? WHERE id=?')
    .run(req.profile.id, req.profile.name, Date.now(), req.params.id);
  broadcast({ type: 'contacts-changed' });
  // Notifica os Sócios — mesmo canal (WS 'log' + feed de Atividade recente)
  // que já é visto por todos os Sócios em tempo real hoje.
  logEvent('warn', `Solicitou exclusão do contato "${contact.nome}" — aguardando aprovação de um Sócio`, req.params.id, req.profile);
  res.json({ ok: true, deleted: false, pending: true });
});

app.post('/contacts/:id/approve-delete', requireRole('socio'), (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'contato não encontrado' });
  if (!contact.delete_requested_by) return res.status(400).json({ error: 'não há solicitação de exclusão pendente para este contato' });
  deleteContactCascade(req.params.id);
  broadcast({ type: 'contacts-changed' });
  logEvent('warn', `Aprovou a exclusão do contato "${contact.nome}"`, req.params.id, req.profile);
  res.json({ ok: true });
});

app.post('/contacts/:id/reject-delete', requireRole('socio'), (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'contato não encontrado' });
  db.prepare('UPDATE contacts SET delete_requested_by=NULL, delete_requested_by_name=NULL, delete_requested_at=NULL WHERE id=?')
    .run(req.params.id);
  broadcast({ type: 'contacts-changed' });
  logEvent('info', `Rejeitou a exclusão do contato "${contact.nome}"`, req.params.id, req.profile);
  res.json({ ok: true });
});

// Confirma manualmente o toque do estágio de cadência ATUAL — nunca envia
// mensagem nenhuma, só registra que o colaborador já fez o contato pelo
// WhatsApp de verdade e avança a régua de tempo. Seção 4/5 da spec.
app.post('/contacts/:id/cadence/touch', requireProfile, (req, res) => {
  const row = db.prepare('SELECT * FROM contacts WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'contato não encontrado' });
  if (row.is_client) return res.status(400).json({ error: 'cliente da assessoria não está em cadência' });
  if (row.atua_mercado_financeiro && row.atua_mercado_financeiro !== 'SIM') {
    return res.status(400).json({ error: 'contato desqualificado, fora de cadência' });
  }
  const { stage } = computeCadence(row);
  if (stage === 'NONE' || stage === 'ENCERRADO_SEM_RESPOSTA') {
    return res.status(400).json({ error: `não há toque pendente (estágio atual: ${stage})` });
  }
  const col = STAGE_TOUCH_COLUMN[stage];
  const now = Date.now();

  const sets = [`${col}=1`, 'cadence_last_touch_at=?', 'cadence_paused=0'];
  const vals = [now];
  if (stage === 'D15') { sets.push('cadence_d15_done_at=?'); vals.push(now); }

  // D75: o sistema não sabe quando a mensagem foi enviada de verdade no
  // WhatsApp (é manual, fora do sistema) — em vez de inferir por data, o
  // próprio colaborador confirma explicitamente se houve resposta.
  let encerradoSemResposta = false;
  if (stage === 'D75') {
    const gotResponse = !!req.body?.gotResponse;
    if (!gotResponse) { sets.push('cadence_encerrado_sem_resposta=1'); encerradoSemResposta = true; }
  }

  db.prepare(`UPDATE contacts SET ${sets.join(',')} WHERE id=?`).run(...vals, req.params.id);
  const updated = db.prepare('SELECT * FROM contacts WHERE id=?').get(req.params.id);
  const recomputed = computeCadence(updated);
  db.prepare('UPDATE contacts SET cadence_stage_cache=? WHERE id=?').run(recomputed.stage, updated.id);

  logEvent('success', `Toque de ${stage} confirmado manualmente${encerradoSemResposta ? ' — ciclo encerrado sem resposta' : ''}`, updated.id, req.profile);
  syncFunnelStage(updated, req.profile);

  broadcast({ type: 'contacts-changed' });
  res.json({ ok: true, stage: recomputed.stage, dueAt: recomputed.dueAt });
});

// Tags — organização pessoal por usuário (ver nota no schema). Toda rota
// exige login identificável (requireProfile) e é sempre filtrada/gravada por
// req.profile.id, pra nunca vazar ou deixar mexer na tag de outro usuário.
app.get('/tags', requireProfile, (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, COUNT(ct.contact_id) AS contact_count
    FROM tags t LEFT JOIN contact_tags ct ON ct.tag_id = t.id AND ct.user_id = t.user_id
    WHERE t.user_id = ?
    GROUP BY t.id ORDER BY t.nome
  `).all(req.profile.id);
  res.json(rows);
});

app.post('/tags', requireProfile, (req, res) => {
  const id = randomId();
  const nome = String(req.body.nome || '').toLowerCase().trim();
  if (!nome) return res.status(400).json({ error: 'nome obrigatório' });
  try {
    db.prepare('INSERT INTO tags (id, user_id, nome, cor, created_at) VALUES (?,?,?,?,?)')
      .run(id, req.profile.id, nome, req.body.cor || randomColor(), Date.now());
    res.json({ id, nome });
  } catch (e) { res.status(409).json({ error: 'tag já existe' }); }
});

app.patch('/tags/:id', requireProfile, (req, res) => {
  const sets = []; const vals = [];
  if ('nome' in req.body) { sets.push('nome=?'); vals.push(String(req.body.nome).toLowerCase().trim()); }
  if ('cor' in req.body) { sets.push('cor=?'); vals.push(req.body.cor); }
  if (sets.length) {
    vals.push(req.params.id, req.profile.id);
    db.prepare(`UPDATE tags SET ${sets.join(',')} WHERE id=? AND user_id=?`).run(...vals);
  }
  res.json({ ok: true });
});

app.delete('/tags/:id', requireProfile, (req, res) => {
  db.prepare('DELETE FROM contact_tags WHERE tag_id=? AND user_id=?').run(req.params.id, req.profile.id);
  db.prepare('DELETE FROM tags WHERE id=? AND user_id=?').run(req.params.id, req.profile.id);
  res.json({ ok: true });
});

app.post('/tags/:id/contacts', requireProfile, (req, res) => {
  const ins = db.prepare('INSERT OR IGNORE INTO contact_tags (user_id, contact_id, tag_id) VALUES (?,?,?)');
  const tx = db.transaction((ids) => { for (const cid of ids) ins.run(req.profile.id, cid, req.params.id); });
  tx(req.body.contactIds || []);
  res.json({ ok: true });
});
app.delete('/tags/:id/contacts/:cid', requireProfile, (req, res) => {
  db.prepare('DELETE FROM contact_tags WHERE tag_id=? AND contact_id=? AND user_id=?').run(req.params.id, req.params.cid, req.profile.id);
  res.json({ ok: true });
});

// Templates
app.get('/templates', (_req, res) => res.json(db.prepare('SELECT * FROM templates ORDER BY updated_at DESC').all()));
app.post('/templates', (req, res) => {
  const t = req.body;
  db.prepare('INSERT OR REPLACE INTO templates (id,name,tag,body,updated_at) VALUES (?,?,?,?,?)')
    .run(t.id || randomId(), t.name, t.tag || 'geral', t.body, Date.now());
  res.json({ ok: true });
});
app.delete('/templates/:id', (req, res) => {
  db.prepare('DELETE FROM templates WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Respostas rápidas híbridas — Pessoal (só quem criou vê/edita/apaga, tanto
// aqui quanto em qualquer listagem) ou Empresa/compartilhada (todos veem e
// editam; apagar exige confirmação, que é responsabilidade do frontend —
// aqui só a validação de permissão de edição/pessoal é obrigatória).
app.get('/quick-replies', async (req, res) => {
  const profile = await getCallerProfile(req);
  const rows = db.prepare(`SELECT * FROM quick_replies WHERE visibility='shared' OR created_by=? ORDER BY atalho`)
    .all(profile?.id || '__nenhum__');
  res.json(rows);
});
app.post('/quick-replies', async (req, res) => {
  const q = req.body || {};
  const atalho = String(q.atalho || '').trim();
  const body = String(q.body || '').trim();
  if (!atalho || !body) return res.status(400).json({ error: 'Atalho e mensagem são obrigatórios.' });
  const profile = await getCallerProfile(req);
  const visibility = q.visibility === 'shared' ? 'shared' : 'personal';
  if (q.id) {
    const existing = db.prepare('SELECT * FROM quick_replies WHERE id=?').get(q.id);
    if (existing && existing.visibility === 'personal' && existing.created_by && existing.created_by !== profile?.id) {
      return res.status(403).json({ error: 'Só quem criou pode editar esta resposta pessoal.' });
    }
  }
  db.prepare(`INSERT INTO quick_replies (id,atalho,body,updated_at,visibility,created_by,created_by_name)
              VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET atalho=excluded.atalho, body=excluded.body, updated_at=excluded.updated_at, visibility=excluded.visibility`)
    .run(q.id || randomId(), atalho, body, Date.now(), visibility, profile?.id || null, profile?.name || null);
  res.json({ ok: true });
});
app.delete('/quick-replies/:id', async (req, res) => {
  const row = db.prepare('SELECT * FROM quick_replies WHERE id=?').get(req.params.id);
  if (!row) return res.json({ ok: true });
  const profile = await getCallerProfile(req);
  if (row.visibility === 'personal' && row.created_by && row.created_by !== profile?.id) {
    return res.status(403).json({ error: 'Só quem criou pode apagar esta resposta pessoal.' });
  }
  db.prepare('DELETE FROM quick_replies WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Conversations
app.get('/conversations', async (req, res) => {
  const status = req.query.status; // pendente | atendendo | finalizado
  const wantsArchived = req.query.includeArchived === '1';
  const profile = await getCallerProfile(req);
  if (wantsArchived) {
    if (!profile || profile.role !== 'socio') return res.status(403).json({ error: 'Ver conversas arquivadas é restrito ao papel Sócio.' });
  }
  let sql = `SELECT * FROM conversations WHERE 1=1`;
  const args = [];
  if (!wantsArchived) sql += ` AND (archived IS NULL OR archived=0)`;
  if (status) { sql += ` AND status=?`; args.push(status); }
  // "pendente" é fila compartilhada (todo mundo precisa ver pra poder
  // assumir); qualquer outro status (atendendo/finalizado) passa a
  // pertencer só a quem assumiu — ninguém mais enxerga, nem Sócio (que já
  // tem visão completa via /audit/conversations, uma tela separada de
  // auditoria/compliance, não a fila de trabalho do dia a dia).
  sql += ` AND (status='pendente' OR assignee=?)`;
  args.push(profile?.id || '__nenhum__');
  sql += ` ORDER BY last_ts DESC`;
  const rows = db.prepare(sql).all(...args);
  res.json(rows.map((r) => ({ ...r, receiverLast4: connectionLast4(r.connection_id) })));
});

app.get('/conversations/:id/messages', async (req, res) => {
  // Mesma restrição do endpoint de listagem: uma conversa arquivada só pode
  // ter seu CONTEÚDO lido por Sócio. Sem esta checagem, qualquer usuário
  // autenticado no CRM (comercial/operacional, que usam a mesma API key)
  // conseguiria ler o histórico completo de uma conversa arquivada só
  // sabendo o número de telefone — driblando por completo a restrição de
  // papel que este endpoint deveria ter.
  const conv = db.prepare('SELECT archived, status, assignee FROM conversations WHERE id=?').get(req.params.id);
  if (conv?.archived) {
    const profile = await getCallerProfile(req);
    if (!profile || profile.role !== 'socio') {
      return res.status(403).json({ error: 'Ver mensagens de uma conversa arquivada é restrito ao papel Sócio.' });
    }
  } else if (conv && conv.status !== 'pendente') {
    // Mesma regra de dono de GET /conversations: uma vez assumida
    // (atendendo/finalizado), o CONTEÚDO só pode ser lido por quem assumiu —
    // ninguém mais, nem Sócio (que enxerga só metadados via Auditoria, nunca
    // o texto das mensagens em si, quando a conversa não está arquivada).
    const profile = await getCallerProfile(req);
    if (!profile || conv.assignee !== profile.id) {
      return res.status(403).json({ error: 'Esta conversa pertence a outro usuário.' });
    }
  }
  const rows = db.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY ts ASC LIMIT 500').all(req.params.id);
  res.json(rows);
});

// Inicia (ou reabre) uma conversa a partir de Atendimento/Contatos, com
// escolha explícita de qual número da empresa vai atender e checagem de
// duplicidade — antes disso, toda conversa nova nascia sempre em
// 'default' (ver connectionIdForConversation), ignorando qual número o
// atendente realmente queria usar.
// id da conversa é o telefone do CLIENTE (chatId), então só pode existir
// UMA linha por cliente — não é possível ter duas conversas "paralelas"
// pelo mesmo cliente em números diferentes. Por isso "iniciar mesmo assim
// pelo número escolhido" (force=true) não cria uma segunda linha: ele
// reaponta a MESMA conversa pro connection_id escolhido (decisão técnica,
// já que o schema não permite duplicar por chatId).
app.post('/conversations/start', async (req, res) => {
  const numero = String(req.body?.telefone || '').replace(/\D+/g, '');
  const nome = String(req.body?.nome || '').trim();
  const connectionId = String(req.body?.connectionId || 'default');
  const force = !!req.body?.force;
  if (!numero) return res.status(400).json({ error: 'Telefone inválido' });
  const chatId = `${numero}@c.us`;
  const existing = db.prepare('SELECT * FROM conversations WHERE id=?').get(chatId);
  const isActive = existing && !existing.archived && existing.status !== 'finalizado';
  if (isActive && !force) {
    return res.json({
      conflict: true,
      conversationId: chatId,
      receiverLast4: connectionLast4(existing.connection_id),
    });
  }
  const profile = await getCallerProfile(req);
  if (existing) {
    db.prepare(`UPDATE conversations SET connection_id=?, status=?, assignee=COALESCE(assignee, ?), nome=COALESCE(?, nome) WHERE id=?`)
      .run(connectionId, existing.status === 'finalizado' ? 'atendendo' : existing.status, profile?.id || null, nome || null, chatId);
  } else {
    db.prepare(`INSERT INTO conversations (id, telefone, nome, last_message, last_ts, unread, status, assignee, connection_id)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(chatId, numero, nome || numero, '', Date.now(), 0, 'atendendo', profile?.id || null, connectionId);
  }
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true, conversationId: chatId });
});

app.post('/conversations/:id/read', (req, res) => {
  db.prepare('UPDATE conversations SET unread=0 WHERE id=?').run(req.params.id);
  // mark as read in WhatsApp too
  const st = getConn(connectionIdForConversation(req.params.id));
  if (st.ready) { st.client.getChatById(req.params.id).then((ch) => ch.sendSeen()).catch(() => {}); }
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

// Marcar como não lida manualmente — reaproveita a mesma coluna `unread` que
// já conta mensagens novas (a UI só olha "unread > 0", não o valor exato).
app.post('/conversations/:id/mark-unread', (req, res) => {
  const row = db.prepare('SELECT unread FROM conversations WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'conversa não encontrada' });
  if (!row.unread) db.prepare('UPDATE conversations SET unread=1 WHERE id=?').run(req.params.id);
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

app.post('/conversations/:id/pin', (req, res) => {
  db.prepare('UPDATE conversations SET pinned_at=? WHERE id=?').run(Date.now(), req.params.id);
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

app.post('/conversations/:id/unpin', (req, res) => {
  db.prepare('UPDATE conversations SET pinned_at=NULL WHERE id=?').run(req.params.id);
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

app.post('/conversations/:id/assume', async (req, res) => {
  // O corpo da requisição nunca é confiável pra identidade — usava
  // literalmente a string fixa "me" antes, o que deixava `assignee` inútil
  // pra distinguir quem é o dono de cada conversa (toda conversa "assumida"
  // por qualquer pessoa ficava com o mesmo valor). Usa sempre o perfil da
  // sessão autenticada, que é o que a Auditoria (seção "seus próprios
  // finalizados") depende para escopar por usuário.
  const profile = await getCallerProfile(req);
  const assignee = profile?.id || 'me';
  db.prepare(`UPDATE conversations SET status='atendendo', assignee=? WHERE id=?`)
    .run(assignee, req.params.id);
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

app.post('/conversations/:id/release', (req, res) => {
  db.prepare(`UPDATE conversations SET status='pendente', assignee=NULL WHERE id=?`).run(req.params.id);
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

// Transferir atendimento — diferente de "Devolver" (que solta pro pool
// pendente, sem dono), transferir passa a conversa DIRETO pra outro
// colaborador específico, já assumida por ele (continua 'atendendo', só
// muda o assignee).
app.post('/conversations/:id/transfer', requireProfile, async (req, res) => {
  const toUserId = String(req.body?.toUserId || '').trim();
  if (!toUserId) return res.status(400).json({ error: 'toUserId é obrigatório.' });
  const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'conversa não encontrada' });
  db.prepare(`UPDATE conversations SET status='atendendo', assignee=? WHERE id=?`).run(toUserId, req.params.id);
  logEvent('info', 'Atendimento transferido', req.params.id, req.profile);
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

app.post('/conversations/:id/finish', (req, res) => {
  db.prepare(`UPDATE conversations SET status='finalizado' WHERE id=?`).run(req.params.id);
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

// Arquivar conversa — item 3: nunca faz DELETE, independente da política do
// workspace (arquivar é sempre não-destrutivo, então não precisa checar
// retention_policy). Esconde da tela normal, exige justificativa, restrito a
// Sócio, e fica logado em audit_log (imutável). O histórico original
// continua consultável via /audit/*.
app.post('/conversations/:id/archive', requireRole('socio'), (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Justificativa (reason) é obrigatória para arquivar.' });
  const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'conversa não encontrada' });
  const now = Date.now();
  const actor = req.profile.name || req.profile.id;
  db.prepare(`UPDATE conversations SET archived=1, archived_at=?, archived_by=?, archived_reason=? WHERE id=?`)
    .run(now, actor, reason, req.params.id);
  db.prepare(`INSERT INTO audit_log (id, ts, actor, actor_role, action, target_type, target_id, reason, details)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(randomId(), now, actor, req.profile.role, 'conversation.archive', 'conversation', req.params.id, reason, JSON.stringify({ nome: conv.nome }));
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

// Desarquivar — mesma restrição de papel do arquivamento (Sócio). Nunca
// apagou nada de verdade (arquivar só escondia da tela normal), então
// desarquivar é só reverter as colunas archived_* e deixar a conversa
// voltar a aparecer em GET /conversations (Atendimento) normalmente.
app.post('/conversations/:id/unarchive', requireRole('socio'), (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'conversa não encontrada' });
  const now = Date.now();
  const actor = req.profile.name || req.profile.id;
  db.prepare(`UPDATE conversations SET archived=0, archived_at=NULL, archived_by=NULL, archived_reason=NULL WHERE id=?`)
    .run(req.params.id);
  db.prepare(`INSERT INTO audit_log (id, ts, actor, actor_role, action, target_type, target_id, reason, details)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(randomId(), now, actor, req.profile.role, 'conversation.unarchive', 'conversation', req.params.id, null, JSON.stringify({ nome: conv.nome }));
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

// NOTA (reuso multi-tenant/produto): a Áurea Investing roda com
// retention_policy='strict' (credenciada à Genial, sujeita a auditoria
// CVM/ANCORD) — por isso não existe rota de DELETE real de conversa/mensagem
// aqui. Isso é uma decisão de CONFIGURAÇÃO do workspace, não uma regra fixa
// do sistema. Um workspace futuro de outro segmento, configurado com
// retention_policy='flexible' em workspace_settings, poderia habilitar um
// delete real — não construído agora por não ser necessário, mas o gate
// ficaria assim:
//
//   app.delete('/conversations/:id', requireRole('socio'), (req, res) => {
//     if (getWorkspaceSettings().retention_policy !== 'flexible') {
//       return res.status(403).json({ error: 'Este workspace exige retenção de histórico (retention_policy=strict) — use arquivar.' });
//     }
//     // ... DELETE real de conversations + messages, com audit_log antes de apagar ...
//   });

// Configuração do workspace (leitura) — Sócio. Hoje só existe para permitir
// inspecionar/validar a política de retenção; ainda não há rota de escrita
// (mudar retention_policy é uma decisão de compliance, feita direto no banco
// por enquanto — não uma troca casual de configuração pela UI).
app.get('/workspace/settings', requireRole('socio'), (_req, res) => {
  res.json(getWorkspaceSettings());
});

// Auditoria — Sócio vê tudo (inclusive arquivadas); qualquer outro papel
// autenticado só vê as próprias conversas (em aberto/finalizadas — nunca
// arquivadas, mesma restrição de conteúdo de GET /conversations/:id/messages)
// via o campo `assignee`, que agora é sempre o id real do perfil autenticado
// (ver POST /conversations/:id/assume). Volume esperado é baixo (equipe
// pequena), por isso filtra em JS em vez de SQL dinâmico — mais simples de
// ler e manter correto.
app.get('/audit/conversations', requireProfile, (req, res) => {
  const { name, from, to, keyword, archivedBy } = req.query;
  let rows = db.prepare(`SELECT * FROM conversations`).all();
  if (req.profile.role !== 'socio') {
    rows = rows.filter((r) => !r.archived && r.assignee === req.profile.id);
  }
  if (from) rows = rows.filter((r) => (r.last_ts || 0) >= Number(from));
  if (to) rows = rows.filter((r) => (r.last_ts || 0) <= Number(to));
  if (archivedBy) rows = rows.filter((r) => (r.archived_by || '').toLowerCase().includes(String(archivedBy).toLowerCase()));
  if (name) rows = rows.filter((r) => (r.nome || '').toLowerCase().includes(String(name).toLowerCase()));
  if (keyword) {
    const kw = `%${keyword}%`;
    const matchIds = new Set(
      db.prepare(`SELECT DISTINCT chat_id FROM messages WHERE body LIKE ?`).all(kw).map((m) => m.chat_id),
    );
    rows = rows.filter((r) => matchIds.has(r.id));
  }
  res.json(rows);
});

app.get('/audit/log', requireRole('socio'), (_req, res) => {
  res.json(db.prepare('SELECT * FROM audit_log ORDER BY ts DESC LIMIT 1000').all());
});

// Migração pontual — corrige conversas que nasceram ANTES do fix de
// handleIncomingMessage, quando um contato @lid virava uma conversa com o
// próprio LID no lugar do telefone real (ex: "117007911526428@c.us"). Tenta
// resolver cada conversa como se seu "telefone" fosse na verdade um LID; se
// o WhatsApp devolver um número de telefone diferente, migra as mensagens
// pro chat_id correto (mesclando com uma conversa correta já existente, se
// houver) e nunca apaga o conteúdo — só corrige a chave.
app.post('/admin/fix-lid-conversations', requireRole('socio'), async (req, res) => {
  const st = getConn('default');
  if (!st.ready) return res.status(400).json({ error: 'WhatsApp não conectado.' });
  const rows = db.prepare('SELECT * FROM conversations').all();
  const fixed = [];
  for (const row of rows) {
    try {
      const [resolved] = await st.client.getContactLidAndPhone([`${row.telefone}@lid`]);
      if (!resolved?.pn || resolved.pn === row.id) continue;
      const realChatId = resolved.pn;
      const realTelefone = realChatId.replace('@c.us', '');
      db.prepare('UPDATE messages SET chat_id=? WHERE chat_id=?').run(realChatId, row.id);
      const existing = db.prepare('SELECT id FROM conversations WHERE id=?').get(realChatId);
      if (existing) {
        db.prepare('DELETE FROM conversations WHERE id=?').run(row.id);
      } else {
        db.prepare('UPDATE conversations SET id=?, telefone=? WHERE id=?').run(realChatId, realTelefone, row.id);
      }
      fixed.push({ from: row.id, to: realChatId });
    } catch (e) { console.error('[fix-lid]', row.id, e.message); }
  }
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true, fixed });
});

// Send messages from inbox — usa a conexão (número) que já pertence a essa conversa
app.post('/conversations/:id/send', async (req, res) => {
  try {
    const { body } = req.body;
    const connectionId = connectionIdForConversation(req.params.id);
    const profile = await getCallerProfile(req);
    const sentMsg = await sendText(req.params.id, body, connectionId);
    // Mensagens que NÓS enviamos deveriam ser espelhadas pelo evento
    // 'message_create' do whatsapp-web.js, mas na prática ele nem sempre
    // dispara pra envios feitos programaticamente (via sendMessage(), não
    // pelo app do celular) — sem isso a mensagem nunca aparecia no nosso
    // próprio histórico/Atendimento. Espelha aqui direto, na hora, usando o
    // Message já retornado pelo envio; handleOutgoingMirror já é idempotente
    // (ignora se o 'message_create' também chegar a disparar depois).
    if (sentMsg) await handleOutgoingMirror(sentMsg, connectionId, req.params.id, profile?.id, profile?.name).catch((e) => console.error('[mirror]', e.message));
    logEvent('success', 'Mensagem enviada (Atendimento)', req.params.id, profile);
    res.json({ ok: true, status: 'sucesso' });
  } catch (e) { res.status(500).json({ error: e.message, status: 'erro' }); }
});

// Editar mensagem já enviada — só a nossa própria (from_me=1). O WhatsApp só
// permite editar dentro de uma janela curta depois do envio (~15min); fora
// dela msg.edit() retorna null/lança erro e devolvemos isso claro pro
// atendente em vez de só atualizar nosso banco sem refletir de verdade no
// WhatsApp do cliente (o que deixaria os dois lados dessincronizados).
app.patch('/messages/:id', async (req, res) => {
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'Corpo da mensagem é obrigatório.' });
  const row = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  if (!row.from_me) return res.status(403).json({ error: 'Só é possível editar mensagens enviadas por você.' });
  const st = getConn(row.connection_id || 'default');
  if (!st.ready) return res.status(400).json({ error: 'WhatsApp não conectado.' });
  try {
    const waMsg = await st.client.getMessageById(req.params.id);
    if (!waMsg) return res.status(404).json({ error: 'Mensagem não encontrada no WhatsApp (sessão pode ter sido reiniciada).' });
    const edited = await waMsg.edit(body);
    if (!edited) return res.status(400).json({ error: 'WhatsApp recusou a edição — provavelmente fora da janela de tempo permitida para editar.' });
  } catch (e) {
    return res.status(400).json({ error: 'Falha ao editar no WhatsApp: ' + e.message });
  }
  const now = Date.now();
  db.prepare('UPDATE messages SET body=?, edited_at=? WHERE id=?').run(body, now, req.params.id);
  const profile = await getCallerProfile(req);
  logEvent('info', 'Mensagem editada (Atendimento)', row.chat_id, profile);
  broadcast({ type: 'message-edited', connectionId: row.connection_id, chatId: row.chat_id, messageId: req.params.id, body, editedAt: now });
  res.json({ ok: true });
});

// "Apagar para todos" iniciado por NÓS (menu de contexto em Atendimento) —
// diferente do listener message_revoke_everyone (que só reage a uma
// revogação que o CLIENTE já fez do lado dele). Nunca apaga o body: mesma
// regra de preservação interna (Seção 13) já usada para revoke recebido.
app.post('/messages/:id/delete-for-everyone', async (req, res) => {
  const row = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  if (!row.from_me) return res.status(403).json({ error: 'Só é possível apagar para todos mensagens enviadas por você.' });
  if (row.revoked_at) return res.status(400).json({ error: 'Esta mensagem já foi apagada.' });
  const st = getConn(row.connection_id || 'default');
  if (!st.ready) return res.status(400).json({ error: 'WhatsApp não conectado.' });

  let waMsg;
  try {
    waMsg = await st.client.getMessageById(req.params.id);
  } catch (e) {
    return res.status(400).json({ error: 'Falha ao localizar a mensagem no WhatsApp: ' + e.message });
  }
  if (!waMsg) return res.status(404).json({ error: 'Mensagem não encontrada no WhatsApp (sessão pode ter sido reiniciada).' });

  // Pré-checagem OBRIGATÓRIA e fail-closed: Message.delete(true) da própria
  // lib NÃO lança erro nem devolve falso quando a revogação-para-todos não é
  // mais permitida (fora da janela de tempo do WhatsApp, tipo não suportado,
  // etc.) — em vez disso, cai silenciosamente para "apagar só pra mim"
  // (sendDeleteMsgs), o oposto do que precisamos aqui (ver
  // node_modules/whatsapp-web.js/src/structures/Message.js:604-647).
  // Replicamos a MESMA checagem interna que a lib usa antes de decidir
  // revogar, e abortamos ANTES de chamar delete() se não for elegível —
  // nunca deixamos a lib decidir sozinha e cair no fallback silencioso.
  let canRevoke = false;
  try {
    canRevoke = await st.client.pupPage.evaluate(async (msgId) => {
      const msg = window.require('WAWebCollections').Msg.get(msgId)
        || (await window.require('WAWebCollections').Msg.getMessagesById([msgId]))?.messages?.[0];
      if (!msg) return false;
      const cap = window.require('WAWebMsgActionCapability');
      return !!(cap.canSenderRevokeMsg(msg) || cap.canAdminRevokeMsg(msg));
    }, req.params.id);
  } catch (e) {
    return res.status(400).json({ error: 'Falha ao verificar permissão de revogação no WhatsApp: ' + e.message });
  }
  if (!canRevoke) {
    return res.status(400).json({ error: 'Esta mensagem não pode mais ser apagada para o cliente — fora da janela de tempo permitida pelo WhatsApp.' });
  }

  try {
    await waMsg.delete(true, true);
  } catch (e) {
    return res.status(400).json({ error: 'Falha ao apagar no WhatsApp: ' + e.message });
  }

  const now = Date.now();
  const profile = await getCallerProfile(req);
  db.prepare('UPDATE messages SET revoked_at=?, revoked_by_user_id=?, revoked_by_name=? WHERE id=?')
    .run(now, profile?.id || null, profile?.name || null, req.params.id);
  logEvent('info', 'Mensagem apagada para o cliente (Atendimento)', row.chat_id, profile);
  broadcast({
    type: 'message-revoked', connectionId: row.connection_id, chatId: row.chat_id,
    messageId: req.params.id, revokedAt: now, revokedByName: profile?.name || null,
  });
  res.json({ ok: true });
});

// Disparo direto: { numero | to, mensagem | body, connectionId? }
app.post('/send', async (req, res) => {
  try {
    const connectionId = req.body?.connectionId || 'default';
    const st = getConn(connectionId);
    if (!st.ready) return res.status(503).json({ error: 'WhatsApp não conectado', status: 'erro' });
    const numeroRaw = req.body?.numero ?? req.body?.to ?? '';
    const mensagem = req.body?.mensagem ?? req.body?.body ?? '';
    const numero = String(numeroRaw).replace(/\D+/g, '');
    if (!numero) return res.status(400).json({ error: 'numero inválido', status: 'erro' });
    if (!mensagem) return res.status(400).json({ error: 'mensagem vazia', status: 'erro' });
    const chatId = `${numero}@c.us`;
    const exists = await st.client.isRegisteredUser(chatId);
    if (!exists) return res.status(404).json({ error: 'Número não está no WhatsApp', status: 'erro' });
    const profile = await getCallerProfile(req);
    const sentMsg = await st.client.sendMessage(chatId, mensagem);
    if (sentMsg) await handleOutgoingMirror(sentMsg, connectionId, chatId, profile?.id, profile?.name).catch((e) => console.error('[mirror]', e.message));
    db.prepare('INSERT INTO sent (telefone, ts) VALUES (?,?)').run(numero, Date.now());
    logEvent('success', 'Mensagem enviada via /send', numero, profile);
    res.json({ ok: true, status: 'sucesso', numero });
  } catch (e) {
    logEvent('error', `Erro /send: ${e.message}`);
    res.status(500).json({ error: e.message, status: 'erro' });
  }
});

app.post('/conversations/:id/send-media', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'arquivo ausente' });
    const connectionId = connectionIdForConversation(req.params.id);
    const mimetype = req.file.mimetype || mime.lookup(req.file.originalname) || 'application/octet-stream';
    const asDocument = req.body?.asDocument === 'true' || req.body?.asDocument === true;
    const profile = await getCallerProfile(req);
    const sentMsg = await sendMediaFile(req.params.id, req.file.path, mimetype, req.body.caption || '', connectionId, asDocument, req.file.originalname);
    if (sentMsg) await handleOutgoingMirror(sentMsg, connectionId, req.params.id, profile?.id, profile?.name).catch((e) => console.error('[mirror]', e.message));
    logEvent('success', 'Mídia enviada (Atendimento)', req.params.id, profile);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enviar cartão de contato (vCard) — opção "Contato" do menu "+" do composer.
app.post('/conversations/:id/send-contact', async (req, res) => {
  try {
    const nome = String(req.body?.nome || '').trim();
    const telefone = String(req.body?.telefone || '').trim();
    if (!nome || !telefone) return res.status(400).json({ error: 'nome e telefone são obrigatórios' });
    const connectionId = connectionIdForConversation(req.params.id);
    const profile = await getCallerProfile(req);
    const sentMsg = await sendContactCard(req.params.id, nome, telefone, connectionId);
    if (sentMsg) await handleOutgoingMirror(sentMsg, connectionId, req.params.id, profile?.id, profile?.name).catch((e) => console.error('[mirror]', e.message));
    logEvent('success', 'Contato compartilhado (Atendimento)', req.params.id, profile);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Disparo direto de mídia: suporta multipart/form-data OU JSON com base64. Aceita connectionId (body).
app.post('/send-media', upload.single('file'), async (req, res) => {
  try {
    const connectionId = req.body?.connectionId || 'default';
    const st = getConn(connectionId);
    if (!st.ready) return res.status(503).json({ error: 'WhatsApp não conectado', status: 'erro' });

    const numero = String(req.body?.numero ?? req.body?.to ?? '').replace(/\D+/g, '');
    if (!numero) return res.status(400).json({ error: 'numero inválido', status: 'erro' });
    const chatId = `${numero}@c.us`;
    const exists = await st.client.isRegisteredUser(chatId);
    if (!exists) return res.status(404).json({ error: 'Número não está no WhatsApp', status: 'erro' });
    const profile = await getCallerProfile(req);

    // Modo JSON (base64)
    if (!req.file && req.body?.mediaData) {
      const { mediaData, mimeType, fileName, isAudio, mensagem } = req.body;
      const buffer = Buffer.from(mediaData.replace(/\s/g, ''), 'base64');
      const tmpPath = path.join(MEDIA_DIR, `tmp_${Date.now()}_${fileName || 'media'}`);
      fs.writeFileSync(tmpPath, buffer);
      const caption = mensagem || '';
      const sentMsg = await sendMediaFile(chatId, tmpPath, mimeType || 'application/octet-stream', caption, connectionId, false, fileName || null);
      if (sentMsg) await handleOutgoingMirror(sentMsg, connectionId, chatId, profile?.id, profile?.name).catch((e) => console.error('[mirror]', e.message));
      try { fs.unlinkSync(tmpPath); } catch {}
      db.prepare('INSERT INTO sent (telefone, ts) VALUES (?,?)').run(numero, Date.now());
      logEvent('success', 'Mídia enviada via /send-media (json)', numero, profile);
      return res.json({ ok: true, status: 'sucesso', numero });
    }

    // Modo multipart
    if (!req.file) return res.status(400).json({ error: 'arquivo ausente', status: 'erro' });
    const mimetype = req.file.mimetype || mime.lookup(req.file.originalname) || 'application/octet-stream';
    const sentMsg = await sendMediaFile(chatId, req.file.path, mimetype, req.body.caption || '', connectionId, false, req.file.originalname);
    if (sentMsg) await handleOutgoingMirror(sentMsg, connectionId, chatId, profile?.id, profile?.name).catch((e) => console.error('[mirror]', e.message));
    db.prepare('INSERT INTO sent (telefone, ts) VALUES (?,?)').run(numero, Date.now());
    logEvent('success', 'Mídia enviada via /send-media', numero, profile);
    res.json({ ok: true, status: 'sucesso', numero });
  } catch (e) {
    logEvent('error', `Erro /send-media: ${e.message}`);
    res.status(500).json({ error: e.message, status: 'erro' });
  }
});

// Logs — feed de "Atividade recente". Sócio vê tudo (visão de equipe); os
// demais papéis só veem o que fizeram eles mesmos + eventos de sistema (sem
// dono, ex: conexão/desconexão) — pra não misturar a atividade de todo mundo.
app.get('/logs', async (req, res) => {
  const rows = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 500').all();
  const profile = await getCallerProfile(req);
  if (profile?.role === 'socio') return res.json(rows);
  if (!profile) return res.json(rows.filter((r) => !r.actor_id)); // sem sessão: só eventos de sistema
  res.json(rows.filter((r) => !r.actor_id || r.actor_id === profile.id));
});

// ─────────── CRM: pipeline — organização PESSOAL de cada usuário ───────────
// O contato é compartilhado, mas em qual etapa ele está e quais etapas
// existem é individual — dois usuários podem organizar o mesmo contato de
// forma completamente diferente (ver contact_stage / requireProfile).
app.get('/pipeline/stages', requireProfile, (req, res) => {
  ensureDefaultStages(req.profile.id);
  res.json(db.prepare('SELECT key, label, color, ord AS "order", terminal FROM pipeline_stages WHERE user_id=? ORDER BY ord').all(req.profile.id));
});

app.post('/pipeline/stages', requireProfile, (req, res) => {
  const { key, label, color, order = 0, terminal = false } = req.body || {};
  if (!key || !label) return res.status(400).json({ error: 'key e label são obrigatórios' });
  db.prepare(`INSERT OR REPLACE INTO pipeline_stages (user_id,key,label,color,ord,terminal) VALUES (?,?,?,?,?,?)`)
    .run(req.profile.id, key, label, color || '213 100% 60%', Number(order) || 0, terminal ? 1 : 0);
  broadcast({ type: 'pipeline-changed', userId: req.profile.id });
  res.json({ ok: true });
});

app.delete('/pipeline/stages/:key', requireProfile, (req, res) => {
  const remaining = db.prepare('SELECT key FROM pipeline_stages WHERE user_id=? AND key != ? ORDER BY ord LIMIT 1').get(req.profile.id, req.params.key);
  if (!remaining) return res.status(400).json({ error: 'pelo menos uma etapa deve existir' });
  // Move contatos órfãos (na visão deste usuário) para a primeira etapa restante
  db.prepare('UPDATE contact_stage SET stage_key=? WHERE user_id=? AND stage_key=?').run(remaining.key, req.profile.id, req.params.key);
  db.prepare('DELETE FROM pipeline_stages WHERE user_id=? AND key=?').run(req.profile.id, req.params.key);
  broadcast({ type: 'pipeline-changed', userId: req.profile.id });
  broadcast({ type: 'contacts-changed' });
  res.json({ ok: true });
});

// Mover contato com histórico — sempre na visão pessoal de quem está logado
app.post('/contacts/:id/stage', requireProfile, (req, res) => {
  const { to } = req.body || {};
  const userId = req.profile.id;
  const userLabel = req.profile.name;
  if (!to) return res.status(400).json({ error: 'to obrigatório' });
  const contactRow = db.prepare('SELECT id, telefone_enc FROM contacts WHERE id=?').get(req.params.id);
  if (!contactRow) return res.status(404).json({ error: 'contato não encontrado' });
  const contact = { ...contactRow, telefone: decrypt(contactRow.telefone_enc) };
  const stage = db.prepare('SELECT key, terminal FROM pipeline_stages WHERE user_id=? AND key=?').get(userId, to);
  if (!stage) return res.status(400).json({ error: 'etapa inválida' });
  const currentStage = db.prepare('SELECT stage_key FROM contact_stage WHERE user_id=? AND contact_id=?').get(userId, contact.id)?.stage_key || null;
  if (currentStage === to) return res.json({ ok: true, unchanged: true });

  const tx = db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO contact_stage (user_id, contact_id, stage_key, updated_at) VALUES (?,?,?,?)')
      .run(userId, contact.id, to, Date.now());
    db.prepare(`INSERT INTO pipeline_history (id, contact_id, from_stage, to_stage, ts, user, user_id) VALUES (?,?,?,?,?,?,?)`)
      .run(randomId(), contact.id, currentStage, to, Date.now(), userLabel, userId);
    // Se for etapa terminal, finalizar conversa correspondente (se existir)
    if (stage.terminal && contact.telefone) {
      const chatId = `${contact.telefone}@c.us`;
      db.prepare(`UPDATE conversations SET status='finalizado' WHERE id=?`).run(chatId);
    }
    if (to === 'em-atendimento' && contact.telefone) {
      const chatId = `${contact.telefone}@c.us`;
      db.prepare(`UPDATE conversations SET status='atendendo', assignee=COALESCE(assignee, ?) WHERE id=?`)
        .run(userLabel, chatId);
    }
  });
  tx();

  broadcast({ type: 'contacts-changed' });
  broadcast({ type: 'pipeline-history-changed', contactId: contact.id });
  if (stage.terminal) broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

app.get('/pipeline/history', requireProfile, (req, res) => {
  const contactId = req.query.contactId;
  let sql = 'SELECT * FROM pipeline_history WHERE user_id=?';
  const args = [req.profile.id];
  if (contactId) { sql += ' AND contact_id=?'; args.push(contactId); }
  sql += ' ORDER BY ts DESC LIMIT 500';
  res.json(db.prepare(sql).all(...args));
});

// ─────── Configurações anti-ban — pessoais por usuário ───────
const DEFAULT_ANTIBAN_SETTINGS = {
  minDelay: 5, maxDelay: 15, perRunLimit: 100, perDayLimit: 300,
  avoidDuplicates: true, longPauseEvery: 25, longPauseSeconds: 120,
};
app.get('/settings', requireProfile, (req, res) => {
  const row = db.prepare('SELECT * FROM user_settings WHERE user_id=?').get(req.profile.id);
  if (!row) return res.json(DEFAULT_ANTIBAN_SETTINGS);
  res.json({
    minDelay: row.min_delay, maxDelay: row.max_delay, perRunLimit: row.per_run_limit,
    perDayLimit: row.per_day_limit, avoidDuplicates: !!row.avoid_duplicates,
    longPauseEvery: row.long_pause_every, longPauseSeconds: row.long_pause_seconds,
  });
});

app.put('/settings', requireProfile, (req, res) => {
  const s = { ...DEFAULT_ANTIBAN_SETTINGS, ...req.body };
  db.prepare(`INSERT INTO user_settings (user_id, min_delay, max_delay, per_run_limit, per_day_limit, avoid_duplicates, long_pause_every, long_pause_seconds, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET min_delay=excluded.min_delay, max_delay=excluded.max_delay,
      per_run_limit=excluded.per_run_limit, per_day_limit=excluded.per_day_limit,
      avoid_duplicates=excluded.avoid_duplicates, long_pause_every=excluded.long_pause_every,
      long_pause_seconds=excluded.long_pause_seconds, updated_at=excluded.updated_at`)
    .run(req.profile.id, s.minDelay, s.maxDelay, s.perRunLimit, s.perDayLimit, s.avoidDuplicates ? 1 : 0, s.longPauseEvery, s.longPauseSeconds, Date.now());
  res.json({ ok: true });
});

// ─────────────────────── CRM: custom fields ────────────────────
app.get('/custom-fields', (_req, res) => {
  const rows = db.prepare('SELECT * FROM custom_fields ORDER BY ord, label').all();
  res.json(rows.map((r) => ({
    id: r.id, key: r.field_key, label: r.label, type: r.type,
    options: r.options ? JSON.parse(r.options) : undefined,
    required: !!r.required, order: r.ord,
  })));
});

app.post('/custom-fields', (req, res) => {
  const { id, key, label, type, options, required = false, order = 0 } = req.body || {};
  if (!key || !label || !type) return res.status(400).json({ error: 'key, label e type obrigatórios' });
  db.prepare(`INSERT OR REPLACE INTO custom_fields (id, field_key, label, type, options, required, ord) VALUES (?,?,?,?,?,?,?)`)
    .run(id || randomId(), key, label, type, options ? JSON.stringify(options) : null, required ? 1 : 0, Number(order) || 0);
  broadcast({ type: 'custom-fields-changed' });
  res.json({ ok: true });
});

app.delete('/custom-fields/:id', (req, res) => {
  const f = db.prepare('SELECT field_key FROM custom_fields WHERE id=?').get(req.params.id);
  if (f) db.prepare('DELETE FROM contact_custom_data WHERE field_key=?').run(f.field_key);
  db.prepare('DELETE FROM custom_fields WHERE id=?').run(req.params.id);
  broadcast({ type: 'custom-fields-changed' });
  res.json({ ok: true });
});

// ─────────────────────── Métricas / Dashboard ─────────────────
app.get('/metrics', async (req, res) => {
  const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
  const now = Date.now();
  const startDay = new Date(); startDay.setHours(0, 0, 0, 0);
  startDay.setDate(startDay.getDate() - (days - 1));
  const startTs = startDay.getTime();

  // Envios bem sucedidos por dia (logs success)
  const sentRows = db.prepare(
    `SELECT ts FROM logs WHERE level='success' AND ts >= ?`
  ).all(startTs);
  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDay); d.setDate(startDay.getDate() + i);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    const label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const envios = sentRows.filter((r) => r.ts >= d.getTime() && r.ts < next.getTime()).length;
    series.push({ day: label, envios, ts: d.getTime() });
  }

  const totalSent  = db.prepare(`SELECT COUNT(*) AS n FROM logs WHERE level='success' AND ts >= ?`).get(startTs).n;
  const totalErr   = db.prepare(`SELECT COUNT(*) AS n FROM logs WHERE level='error'   AND ts >= ?`).get(startTs).n;
  const totalConv  = db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n;
  const pendentes  = db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE status='pendente'`).get().n;
  const atendendo  = db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE status='atendendo'`).get().n;
  const finalizadas= db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE status='finalizado'`).get().n;
  const totalContacts = db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n;
  const totalTags  = db.prepare('SELECT COUNT(*) AS n FROM tags').get().n;

  // Tempo médio de primeira resposta (ms): para cada conversa, pegar a primeira mensagem
  // recebida e a próxima enviada por nós depois dela.
  let avgRespMs = 0; let respCount = 0;
  const conv = db.prepare(`SELECT id FROM conversations LIMIT 200`).all();
  for (const c of conv) {
    const inMsg = db.prepare(`SELECT ts FROM messages WHERE chat_id=? AND from_me=0 AND ts>=? ORDER BY ts ASC LIMIT 1`).get(c.id, startTs);
    if (!inMsg) continue;
    const outMsg = db.prepare(`SELECT ts FROM messages WHERE chat_id=? AND from_me=1 AND ts>? ORDER BY ts ASC LIMIT 1`).get(c.id, inMsg.ts);
    if (!outMsg) continue;
    avgRespMs += (outMsg.ts - inMsg.ts);
    respCount++;
  }
  const avgFirstResponse = respCount ? Math.round(avgRespMs / respCount) : 0;

  // Funil do CRM — pipeline_stages é POR USUÁRIO (uma linha por
  // user_id+key), e a etapa real de cada contato mora em contact_stage
  // (também por usuário), nunca em contacts.status (coluna legada que
  // nenhuma rota atualiza mais). A query antiga fazia
  // `pipeline_stages s LEFT JOIN contacts c ON c.status = s.key` — como
  // existe uma linha de pipeline_stages por USUÁRIO pra cada key (ex: 5
  // pessoas × a etapa "novo"), e contacts.status fica sempre 'novo' (nunca
  // é escrito), cada contato era multiplicado por USUÁRIO só na etapa
  // "novo" (por isso 4755 ≈ 5× o total real de ~952, e as outras etapas
  // sempre em 0). Corrigido pra contar contact_stage do usuário chamador,
  // igual GET /contacts já faz (hasCrmStage).
  const metricsProfile = await getCallerProfile(req);
  let funnel = [];
  if (metricsProfile) {
    ensureDefaultStages(metricsProfile.id);
    funnel = db.prepare(`
      SELECT s.key, s.label, s.color, s.ord,
        (SELECT COUNT(*) FROM contact_stage cs WHERE cs.user_id = s.user_id AND cs.stage_key = s.key) AS count
      FROM pipeline_stages s
      WHERE s.user_id = ?
      ORDER BY s.ord
    `).all(metricsProfile.id);
  }

  // Top tags
  const topTags = db.prepare(`
    SELECT t.nome, t.cor, COUNT(ct.contact_id) AS count
    FROM tags t LEFT JOIN contact_tags ct ON ct.tag_id = t.id
    GROUP BY t.id ORDER BY count DESC LIMIT 8
  `).all();

  // ─── Cliente da Assessoria / Lead Frio + Cadência (mesmo padrão de
  // avgFirstResponseMs acima: mistura SQL + agregação em JS, sem cron) ───
  const allContacts = db.prepare('SELECT * FROM contacts').all();
  const elegiveis = allContacts.filter((c) => !c.atua_mercado_financeiro || c.atua_mercado_financeiro === 'SIM');

  const clientesAssessoria = elegiveis.filter((c) => c.is_client).length;
  const leadsFrios = elegiveis.filter((c) => !c.is_client).length;

  const THIRTY_DAYS = 30 * DAY_MS;
  const semContato30d = elegiveis.filter((c) => c.is_client && (!c.last_contact_at || (now - c.last_contact_at) >= THIRTY_DAYS)).length;

  const cadenceCounts = { D1: 0, D3: 0, D7: 0, D15: 0, D75: 0, ENCERRADO_SEM_RESPOSTA: 0 };
  for (const c of elegiveis) {
    if (c.is_client) continue;
    const { stage } = computeCadence(c, now);
    if (stage in cadenceCounts) cadenceCounts[stage]++;
  }
  const cadenciaAtiva = cadenceCounts.D1 + cadenceCounts.D3 + cadenceCounts.D7 + cadenceCounts.D15 + cadenceCounts.D75;

  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
  const convertidosEsteMes = elegiveis.filter((c) => c.is_client && c.is_client_since && c.is_client_since >= startOfMonth.getTime()).length;

  // Taxa de Conversão (seção 6): só entram no denominador leads que
  // efetivamente estabeleceram conversa (responderam ao menos uma vez) —
  // nunca o total de leads contatados.
  const comConversa = elegiveis.filter((c) => c.conversation_started_at).length;
  const convertidosTotal = elegiveis.filter((c) => c.is_client && c.conversation_started_at).length;
  const taxaConversao = comConversa ? Math.round((convertidosTotal / comConversa) * 100) : null;

  res.json({
    range: { days, startTs, endTs: now },
    totals: {
      contacts: totalContacts, tags: totalTags,
      conversations: totalConv, pendentes, atendendo, finalizadas,
      sent: totalSent, errors: totalErr,
      successRate: (totalSent + totalErr) ? Math.round(totalSent / (totalSent + totalErr) * 100) : null,
      avgFirstResponseMs: avgFirstResponse,
      clientesAssessoria, leadsFrios, semContato30d,
      cadenceD1: cadenceCounts.D1, cadenceD3: cadenceCounts.D3, cadenceD7: cadenceCounts.D7,
      cadenceD15: cadenceCounts.D15, cadenceD75: cadenceCounts.D75,
      cadenceEncerrado: cadenceCounts.ENCERRADO_SEM_RESPOSTA,
      cadenciaAtiva, convertidosEsteMes, taxaConversao,
    },
    series,
    funnel,
    topTags,
  });
});

app.put('/contacts/:id/custom-data', (req, res) => {
  const data = req.body || {};
  const ins = db.prepare('INSERT OR REPLACE INTO contact_custom_data (contact_id, field_key, value) VALUES (?,?,?)');
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(data)) {
      ins.run(req.params.id, k, v == null ? null : String(v));
    }
  });
  tx();
  res.json({ ok: true });
});



// Helpers
function randomColor() {
  const palette = ['#2D8CFF', '#22D3EE', '#A78BFA', '#F59E0B', '#10B981', '#EF4444', '#EC4899', '#84CC16'];
  return palette[Math.floor(Math.random() * palette.length)];
}

// ─────────────────────── WS messages in ────────────────────────
function handleClientMessage(msg) {
  const connectionId = msg.connectionId || 'default';
  switch (msg.type) {
    case 'request-qr': {
      const st = getConn(connectionId);
      if (!st.ready) { st.initializing = false; initWa(connectionId).catch(() => {}); }
      break;
    }
    case 'logout': {
      disconnectConnection(connectionId).catch(() => {});
      break;
    }
    case 'reconnect': initWa(connectionId); break;
    // 'start-campaign'/'pause-campaign'/'resume-campaign'/'stop-campaign' foram
    // removidos de propósito: o disparo em massa roda só no frontend via HTTP
    // (ver nota acima de sendText/sendMediaFile). Mensagens desses tipos são ignoradas.
    case 'ping': broadcast({ type: 'pong', t: Date.now() }); break;
  }
}

// ─────────────────────────── Boot ──────────────────────────────
realtimeModule.startListener().catch((e) => console.error('[realtime] falha ao iniciar listener:', e.message));

server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║   WhatsApp Sender — motor v2 ATIVO           ║`);
  console.log(`  ║   ws://localhost:${PORT}/ws                    ║`);
  console.log(`  ║   http://localhost:${PORT}/status              ║`);
  console.log(`  ║   mídias: ${MEDIA_DIR}`);
  console.log(`  ╚══════════════════════════════════════════════╝\n`);
});

// Graceful errors — não derrubar o motor
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => console.error('uncaughtException', e));

// Encerramento gracioso — mata o processo à força (SIGKILL, ou o Node
// abruptamente encerrado) pode cortar o Chromium/Puppeteer no meio de uma
// escrita do perfil (LevelDB), corrompendo a sessão salva do WhatsApp e
// forçando escanear o QR de novo no próximo start. Fechando cada client()
// corretamente aqui, o Chromium encerra sua sequência normal de shutdown e a
// sessão persiste de verdade. Isso importa tanto localmente (reinícios
// durante desenvolvimento) quanto na VPS (deploys/restarts do processo).
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] Recebido ${signal} — fechando conexões do WhatsApp antes de sair…`);
  const closes = [];
  for (const [id, st] of connState) {
    if (st.client) closes.push(st.client.destroy().catch(() => {}));
  }
  await Promise.race([Promise.all(closes), new Promise((r) => setTimeout(r, 8000))]);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
