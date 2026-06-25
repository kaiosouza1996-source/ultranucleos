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
 *  └──────────────────────────────────────────────────────────────────┘
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mime = require('mime-types');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const PORT = process.env.PORT || 8787;
const ROOT = __dirname;
const MEDIA_DIR = path.join(ROOT, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ───────────────────────────── DB ─────────────────────────────
const db = new Database(path.join(ROOT, 'data.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  nome TEXT,
  telefone TEXT UNIQUE,
  email TEXT,
  documento TEXT,
  empresa TEXT,
  origem TEXT,
  status TEXT DEFAULT 'novo',
  observacoes TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  nome TEXT UNIQUE,
  cor TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (contact_id, tag_id)
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
  assignee TEXT
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
  ack INTEGER DEFAULT 0            -- 0 sent, 1 server, 2 device, 3 read
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, ts);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, level TEXT, message TEXT, contact TEXT
);
CREATE TABLE IF NOT EXISTS sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT, telefone TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS pipeline_stages (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT,
  ord INTEGER DEFAULT 0,
  terminal INTEGER DEFAULT 0
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
`);

// Seed default pipeline stages on first boot
const stageCount = db.prepare('SELECT COUNT(*) AS n FROM pipeline_stages').get().n;
if (stageCount === 0) {
  const defaultStages = [
    { key: 'novo',           label: 'Novo',           color: '213 100% 60%', ord: 0, terminal: 0 },
    { key: 'em-atendimento', label: 'Em atendimento', color: '38 95% 55%',   ord: 1, terminal: 0 },
    { key: 'qualificado',    label: 'Qualificado',    color: '263 80% 65%',  ord: 2, terminal: 0 },
    { key: 'proposta',       label: 'Proposta',       color: '189 90% 55%',  ord: 3, terminal: 0 },
    { key: 'fechado',        label: 'Fechado',        color: '142 70% 45%',  ord: 4, terminal: 1 },
    { key: 'perdido',        label: 'Perdido',        color: '0 75% 58%',    ord: 5, terminal: 1 },
  ];
  const ins = db.prepare('INSERT INTO pipeline_stages (key,label,color,ord,terminal) VALUES (?,?,?,?,?)');
  for (const s of defaultStages) ins.run(s.key, s.label, s.color, s.ord, s.terminal);
}

// ─────────────────────────── Express ───────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use('/media', express.static(MEDIA_DIR));

const upload = multer({ dest: MEDIA_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

// ───────────────────────── WS broadcast ────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (data) => {
    try { handleClientMessage(JSON.parse(data.toString()), ws); } catch (e) { console.error(e); }
  });
  // Hello state
  ws.send(JSON.stringify({
    type: 'hello',
    status: waReady ? 'ready' : (lastQR ? 'qr' : (waInitializing ? 'connecting' : 'disconnected')),
    me: waMe, qr: lastQR,
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

function logEvent(level, message, contact) {
  db.prepare('INSERT INTO logs (ts, level, message, contact) VALUES (?,?,?,?)')
    .run(Date.now(), level, message, contact || null);
  broadcast({ type: 'log', level, message, contact });
  console.log(`[${level}] ${message}${contact ? ' • ' + contact : ''}`);
}

// ──────────────────────── WhatsApp client ──────────────────────
let lastQR = null;
let waReady = false;
let waInitializing = false;
let waMe = null;
let wa = null;
let reconnectAttempts = 0;

function buildClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(ROOT, '.wwebjs_auth') }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });
}

function attachWaHandlers(client) {
  client.on('qr', async (qr) => {
    try {
      lastQR = await QRCode.toDataURL(qr);
      waReady = false;
      broadcast({ type: 'qr', qr: lastQR });
      logEvent('info', 'QR Code gerado. Escaneie no WhatsApp.');
    } catch (e) { console.error(e); }
  });
  client.on('authenticated', () => logEvent('info', 'Sessão autenticada.'));
  client.on('auth_failure', (m) => logEvent('error', 'Falha de autenticação: ' + m));
  client.on('ready', () => {
    waReady = true; waInitializing = false; lastQR = null; reconnectAttempts = 0;
    waMe = client.info?.pushname || client.info?.wid?.user || 'WhatsApp';
    broadcast({ type: 'ready', me: waMe });
    logEvent('success', `Conectado como ${waMe}`);
  });
  client.on('disconnected', (reason) => {
    waReady = false; waMe = null;
    broadcast({ type: 'disconnected', reason: String(reason || '') });
    logEvent('warn', `Desconectado: ${reason}. Reconectando em 5s…`);
    scheduleReconnect();
  });
  client.on('change_state', (state) => broadcast({ type: 'wa-state', state }));

  client.on('message', async (msg) => {
    try { await handleIncomingMessage(msg); } catch (e) { console.error(e); }
  });
  client.on('message_create', async (msg) => {
    if (!msg.fromMe) return;
    try { await handleOutgoingMirror(msg); } catch (e) { console.error(e); }
  });
  client.on('message_ack', (msg, ack) => {
    try {
      db.prepare('UPDATE messages SET ack=? WHERE id=?').run(ack, msg.id._serialized);
      broadcast({ type: 'ack', id: msg.id._serialized, ack });
    } catch {}
  });
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(60000, 3000 * reconnectAttempts);
  setTimeout(() => initWa().catch(() => {}), delay);
}

async function initWa() {
  if (waInitializing || waReady) return;
  waInitializing = true;
  broadcast({ type: 'connecting' });
  try {
    if (wa) { try { await wa.destroy(); } catch {} }
    wa = buildClient();
    attachWaHandlers(wa);
    await wa.initialize();
  } catch (e) {
    waInitializing = false;
    logEvent('error', 'Falha ao iniciar cliente WhatsApp: ' + e.message);
    scheduleReconnect();
  }
}
initWa();

// ──────────────────────── Conversations ────────────────────────
function upsertConversation({ chatId, telefone, nome, body, ts, fromMe }) {
  const exists = db.prepare('SELECT id, unread FROM conversations WHERE id=?').get(chatId);
  if (exists) {
    const unread = fromMe ? 0 : (exists.unread || 0) + 1;
    db.prepare('UPDATE conversations SET last_message=?, last_ts=?, unread=?, nome=COALESCE(?, nome) WHERE id=?')
      .run(body, ts, unread, nome || null, chatId);
  } else {
    db.prepare(`INSERT INTO conversations (id, telefone, nome, last_message, last_ts, unread, status)
                VALUES (?,?,?,?,?,?,?)`)
      .run(chatId, telefone, nome || telefone, body, ts, fromMe ? 0 : 1, 'pendente');
  }
}

async function persistMedia(msg) {
  if (!msg.hasMedia) return null;
  try {
    const media = await msg.downloadMedia();
    if (!media) return null;
    const ext = mime.extension(media.mimetype) || 'bin';
    const filename = `${msg.id._serialized.replace(/[^\w]/g, '_')}.${ext}`;
    const filepath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
    return { path: `/media/${filename}`, mime: media.mimetype };
  } catch (e) { console.error('media error', e.message); return null; }
}

function mapMsgType(t) {
  if (t === 'chat') return 'text';
  if (t === 'ptt') return 'audio';
  if (['image', 'video', 'audio', 'document', 'sticker'].includes(t)) return t;
  return t || 'text';
}

async function handleIncomingMessage(msg) {
  const chatId = msg.from;
  if (!chatId.endsWith('@c.us')) return; // ignore groups for now
  const contact = await msg.getContact();
  const nome = contact.pushname || contact.name || contact.number;
  const telefone = contact.number;
  const ts = (msg.timestamp || Math.floor(Date.now() / 1000)) * 1000;
  const type = mapMsgType(msg.type);
  let mediaInfo = null;
  if (msg.hasMedia) mediaInfo = await persistMedia(msg);

  db.prepare(`INSERT OR REPLACE INTO messages (id, chat_id, ts, from_me, body, type, media_path, media_mime, ack)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(msg.id._serialized, chatId, ts, 0, msg.body || '', type, mediaInfo?.path || null, mediaInfo?.mime || null, 0);

  upsertConversation({ chatId, telefone, nome, body: msg.body || (type !== 'text' ? `[${type}]` : ''), ts, fromMe: false });

  // garante registro no CRM
  ensureContactFromChat({ telefone, nome });

  broadcast({ type: 'message', message: serializeMessage(msg.id._serialized) });
  broadcast({ type: 'conversations-changed' });
}

async function handleOutgoingMirror(msg) {
  // mensagens enviadas pelo próprio celular (espelhar)
  const chatId = msg.to;
  if (!chatId || !chatId.endsWith('@c.us')) return;
  if (db.prepare('SELECT 1 FROM messages WHERE id=?').get(msg.id._serialized)) return;
  const ts = (msg.timestamp || Math.floor(Date.now() / 1000)) * 1000;
  const type = mapMsgType(msg.type);
  let mediaInfo = null;
  if (msg.hasMedia) mediaInfo = await persistMedia(msg);

  db.prepare(`INSERT OR REPLACE INTO messages (id, chat_id, ts, from_me, body, type, media_path, media_mime, ack)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(msg.id._serialized, chatId, ts, 1, msg.body || '', type, mediaInfo?.path || null, mediaInfo?.mime || null, 1);

  upsertConversation({
    chatId, telefone: chatId.replace('@c.us', ''), nome: null,
    body: msg.body || (type !== 'text' ? `[${type}]` : ''), ts, fromMe: true,
  });
  broadcast({ type: 'message', message: serializeMessage(msg.id._serialized) });
  broadcast({ type: 'conversations-changed' });
}

function serializeMessage(id) {
  return db.prepare('SELECT * FROM messages WHERE id=?').get(id);
}

function ensureContactFromChat({ telefone, nome }) {
  const exists = db.prepare('SELECT id FROM contacts WHERE telefone=?').get(telefone);
  if (exists) return exists.id;
  const id = randomId();
  db.prepare('INSERT INTO contacts (id, nome, telefone, status, created_at) VALUES (?,?,?,?,?)')
    .run(id, nome || telefone, telefone, 'novo', Date.now());
  return id;
}

function randomId() {
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─────────────────────── Campaign engine ───────────────────────
let campaign = null;

function rand(min, max) { return min + Math.random() * (max - min); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function renderTemplate(body, nome) { return body.replace(/\{nome\}/gi, nome || ''); }

async function runCampaign() {
  const c = campaign;
  if (!c) return;
  while (c.idx < c.contacts.length && !c.stop) {
    if (c.paused) { await sleep(1000); continue; }
    const contact = c.contacts[c.idx++];
    const minMs = c.settings.minDelay * 1000;
    const maxMs = c.settings.maxDelay * 1000;
    const jitter = (Math.random() - 0.5) * 0.4 * (maxMs - minMs);

    if (c.settings.avoidDuplicates) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const existed = db.prepare('SELECT 1 FROM sent WHERE telefone=? AND ts>=?').get(contact.telefone, today.getTime());
      if (existed) { logEvent('warn', 'Pulado (já enviado hoje)', contact.telefone); continue; }
    }
    broadcast({ type: 'progress', sent: c.sent, failed: c.failed, total: c.contacts.length, currentContact: `${contact.nome} (${contact.telefone})` });
    logEvent('info', `Enviando para ${contact.nome}…`, contact.telefone);

    try {
      const number = contact.telefone.replace(/\D/g, '');
      const chatId = `${number}@c.us`;
      const exists = await wa.isRegisteredUser(chatId);
      if (!exists) throw new Error('Número não está no WhatsApp');
      const chat = await wa.getChatById(chatId);
      try { await chat.sendStateTyping(); await sleep(rand(800, 2200)); } catch {}
      const text = renderTemplate(c.template.body, contact.nome);
      await wa.sendMessage(chatId, text);
      db.prepare('INSERT INTO sent (telefone, ts) VALUES (?,?)').run(contact.telefone, Date.now());
      c.sent++;
      logEvent('success', 'Mensagem enviada', contact.telefone);
    } catch (e) {
      c.failed++;
      logEvent('error', `Falha: ${e.message}`, contact.telefone);
    }
    broadcast({ type: 'progress', sent: c.sent, failed: c.failed, total: c.contacts.length });

    if (c.settings.longPauseEvery && (c.idx % c.settings.longPauseEvery === 0)) {
      logEvent('info', `Pausa longa de ~${c.settings.longPauseSeconds}s`);
      await sleep(c.settings.longPauseSeconds * 1000 + rand(0, 5000));
    } else {
      await sleep(rand(minMs, maxMs) + jitter);
    }
  }
  broadcast({ type: 'campaign-end' });
  logEvent('success', `Campanha finalizada: ${c.sent} enviadas, ${c.failed} erros.`);
  campaign = null;
}

// ─────────────────────── Outbound helpers ──────────────────────
async function sendText(chatId, body) {
  if (!waReady) throw new Error('WhatsApp não conectado');
  return wa.sendMessage(chatId, body);
}

async function sendMediaFile(chatId, filepath, mimetype, caption) {
  if (!waReady) throw new Error('WhatsApp não conectado');
  const data = fs.readFileSync(filepath).toString('base64');
  const filename = path.basename(filepath);
  const media = new MessageMedia(mimetype, data, filename);
  const opts = caption ? { caption } : {};
  if (mimetype.startsWith('audio/')) opts.sendAudioAsVoice = true;
  return wa.sendMessage(chatId, media, opts);
}

// ─────────────────────────── Routes ────────────────────────────
app.get('/status', (_req, res) => {
  res.json({
    ok: true,
    whatsapp: waReady ? 'ready' : (lastQR ? 'qr' : (waInitializing ? 'connecting' : 'disconnected')),
    me: waMe,
    qr: lastQR,
    uptime: process.uptime(),
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// Contacts CRM
app.get('/contacts', (_req, res) => {
  const rows = db.prepare(`
    SELECT c.*, GROUP_CONCAT(t.nome) AS tag_names
    FROM contacts c
    LEFT JOIN contact_tags ct ON ct.contact_id = c.id
    LEFT JOIN tags t ON t.id = ct.tag_id
    GROUP BY c.id ORDER BY c.created_at DESC
  `).all();
  res.json(rows.map((r) => ({ ...r, tags: r.tag_names ? r.tag_names.split(',') : [] })));
});

app.post('/contacts', (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [req.body];
  const ins = db.prepare(`INSERT OR REPLACE INTO contacts
    (id,nome,telefone,email,documento,empresa,origem,status,observacoes,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const tagIns = db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?,?)');
  const tagFind = db.prepare('SELECT id FROM tags WHERE nome=?');
  const tagCreate = db.prepare('INSERT INTO tags (id, nome, cor, created_at) VALUES (?,?,?,?)');
  const tx = db.transaction((contacts) => {
    for (const c of contacts) {
      ins.run(c.id || randomId(), c.nome, c.telefone, c.email || null, c.documento || null,
        c.empresa || null, c.origem || null, c.status || 'novo', c.observacoes || null, c.createdAt || Date.now());
      const cid = c.id || db.prepare('SELECT id FROM contacts WHERE telefone=?').get(c.telefone).id;
      const tags = (c.tags && c.tags.length) ? c.tags : (c.tag ? [c.tag] : []);
      for (const tname of tags) {
        const norm = String(tname).toLowerCase().trim();
        if (!norm) continue;
        let row = tagFind.get(norm);
        if (!row) { const tid = randomId(); tagCreate.run(tid, norm, randomColor(), Date.now()); row = { id: tid }; }
        tagIns.run(cid, row.id);
      }
    }
  });
  tx(list);
  broadcast({ type: 'contacts-changed' });
  res.json({ ok: true, count: list.length });
});

app.patch('/contacts/:id', (req, res) => {
  const fields = ['nome', 'telefone', 'email', 'documento', 'empresa', 'origem', 'status', 'observacoes'];
  const sets = []; const vals = [];
  for (const f of fields) if (f in req.body) { sets.push(`${f}=?`); vals.push(req.body[f]); }
  if (sets.length) {
    vals.push(req.params.id);
    db.prepare(`UPDATE contacts SET ${sets.join(',')} WHERE id=?`).run(...vals);
  }
  broadcast({ type: 'contacts-changed' });
  res.json({ ok: true });
});

app.delete('/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contact_tags WHERE contact_id=?').run(req.params.id);
  db.prepare('DELETE FROM contacts WHERE id=?').run(req.params.id);
  broadcast({ type: 'contacts-changed' });
  res.json({ ok: true });
});

// Tags
app.get('/tags', (_req, res) => {
  const rows = db.prepare(`
    SELECT t.*, COUNT(ct.contact_id) AS contact_count
    FROM tags t LEFT JOIN contact_tags ct ON ct.tag_id = t.id
    GROUP BY t.id ORDER BY t.nome
  `).all();
  res.json(rows);
});

app.post('/tags', (req, res) => {
  const id = randomId();
  const nome = String(req.body.nome || '').toLowerCase().trim();
  if (!nome) return res.status(400).json({ error: 'nome obrigatório' });
  try {
    db.prepare('INSERT INTO tags (id, nome, cor, created_at) VALUES (?,?,?,?)')
      .run(id, nome, req.body.cor || randomColor(), Date.now());
    res.json({ id, nome });
  } catch (e) { res.status(409).json({ error: 'tag já existe' }); }
});

app.patch('/tags/:id', (req, res) => {
  const sets = []; const vals = [];
  if ('nome' in req.body) { sets.push('nome=?'); vals.push(String(req.body.nome).toLowerCase().trim()); }
  if ('cor' in req.body) { sets.push('cor=?'); vals.push(req.body.cor); }
  if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE tags SET ${sets.join(',')} WHERE id=?`).run(...vals); }
  res.json({ ok: true });
});

app.delete('/tags/:id', (req, res) => {
  db.prepare('DELETE FROM contact_tags WHERE tag_id=?').run(req.params.id);
  db.prepare('DELETE FROM tags WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/tags/:id/contacts', (req, res) => {
  const ins = db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?,?)');
  const tx = db.transaction((ids) => { for (const cid of ids) ins.run(cid, req.params.id); });
  tx(req.body.contactIds || []);
  res.json({ ok: true });
});
app.delete('/tags/:id/contacts/:cid', (req, res) => {
  db.prepare('DELETE FROM contact_tags WHERE tag_id=? AND contact_id=?').run(req.params.id, req.params.cid);
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

// Quick replies
app.get('/quick-replies', (_req, res) => res.json(db.prepare('SELECT * FROM quick_replies ORDER BY atalho').all()));
app.post('/quick-replies', (req, res) => {
  const q = req.body;
  db.prepare('INSERT OR REPLACE INTO quick_replies (id,atalho,body,updated_at) VALUES (?,?,?,?)')
    .run(q.id || randomId(), q.atalho, q.body, Date.now());
  res.json({ ok: true });
});
app.delete('/quick-replies/:id', (req, res) => {
  db.prepare('DELETE FROM quick_replies WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Conversations
app.get('/conversations', (req, res) => {
  const status = req.query.status; // pendente | atendendo | finalizado
  let sql = `SELECT * FROM conversations`;
  const args = [];
  if (status) { sql += ` WHERE status=?`; args.push(status); }
  sql += ` ORDER BY last_ts DESC`;
  res.json(db.prepare(sql).all(...args));
});

app.get('/conversations/:id/messages', (req, res) => {
  const rows = db.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY ts ASC LIMIT 500').all(req.params.id);
  res.json(rows);
});

app.post('/conversations/:id/read', (req, res) => {
  db.prepare('UPDATE conversations SET unread=0 WHERE id=?').run(req.params.id);
  // mark as read in WhatsApp too
  if (waReady) { wa.getChatById(req.params.id).then((ch) => ch.sendSeen()).catch(() => {}); }
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

app.post('/conversations/:id/assume', (req, res) => {
  db.prepare(`UPDATE conversations SET status='atendendo', assignee=? WHERE id=?`)
    .run(req.body.assignee || 'me', req.params.id);
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

app.post('/conversations/:id/release', (req, res) => {
  db.prepare(`UPDATE conversations SET status='pendente', assignee=NULL WHERE id=?`).run(req.params.id);
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

app.post('/conversations/:id/finish', (req, res) => {
  db.prepare(`UPDATE conversations SET status='finalizado' WHERE id=?`).run(req.params.id);
  broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

// Send messages from inbox
app.post('/conversations/:id/send', async (req, res) => {
  try {
    const { body } = req.body;
    await sendText(req.params.id, body);
    res.json({ ok: true, status: 'sucesso' });
  } catch (e) { res.status(500).json({ error: e.message, status: 'erro' }); }
});

// Disparo direto: { numero | to, mensagem | body }
app.post('/send', async (req, res) => {
  try {
    if (!waReady) return res.status(503).json({ error: 'WhatsApp não conectado', status: 'erro' });
    const numeroRaw = req.body?.numero ?? req.body?.to ?? '';
    const mensagem = req.body?.mensagem ?? req.body?.body ?? '';
    const numero = String(numeroRaw).replace(/\D+/g, '');
    if (!numero) return res.status(400).json({ error: 'numero inválido', status: 'erro' });
    if (!mensagem) return res.status(400).json({ error: 'mensagem vazia', status: 'erro' });
    const chatId = `${numero}@c.us`;
    const exists = await wa.isRegisteredUser(chatId);
    if (!exists) return res.status(404).json({ error: 'Número não está no WhatsApp', status: 'erro' });
    await wa.sendMessage(chatId, mensagem);
    db.prepare('INSERT INTO sent (telefone, ts) VALUES (?,?)').run(numero, Date.now());
    logEvent('success', 'Mensagem enviada via /send', numero);
    res.json({ ok: true, status: 'sucesso', numero });
  } catch (e) {
    logEvent('error', `Erro /send: ${e.message}`);
    res.status(500).json({ error: e.message, status: 'erro' });
  }
});

app.post('/conversations/:id/send-media', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'arquivo ausente' });
    const mimetype = req.file.mimetype || mime.lookup(req.file.originalname) || 'application/octet-stream';
    await sendMediaFile(req.params.id, req.file.path, mimetype, req.body.caption || '');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Disparo direto de mídia: suporta multipart/form-data OU JSON com base64
app.post('/send-media', upload.single('file'), async (req, res) => {
  try {
    if (!waReady) return res.status(503).json({ error: 'WhatsApp não conectado', status: 'erro' });

    const numero = String(req.body?.numero ?? req.body?.to ?? '').replace(/\D+/g, '');
    if (!numero) return res.status(400).json({ error: 'numero inválido', status: 'erro' });
    const chatId = `${numero}@c.us`;
    const exists = await wa.isRegisteredUser(chatId);
    if (!exists) return res.status(404).json({ error: 'Número não está no WhatsApp', status: 'erro' });

    // Modo JSON (base64)
    if (!req.file && req.body?.mediaData) {
      const { mediaData, mimeType, fileName, isAudio, mensagem } = req.body;
      const buffer = Buffer.from(mediaData.replace(/\s/g, ''), 'base64');
      const tmpPath = path.join(MEDIA_DIR, `tmp_${Date.now()}_${fileName || 'media'}`);
      fs.writeFileSync(tmpPath, buffer);
      const caption = mensagem || '';
      await sendMediaFile(chatId, tmpPath, mimeType || 'application/octet-stream', caption);
      try { fs.unlinkSync(tmpPath); } catch {}
      db.prepare('INSERT INTO sent (telefone, ts) VALUES (?,?)').run(numero, Date.now());
      logEvent('success', 'Mídia enviada via /send-media (json)', numero);
      return res.json({ ok: true, status: 'sucesso', numero });
    }

    // Modo multipart
    if (!req.file) return res.status(400).json({ error: 'arquivo ausente', status: 'erro' });
    const mimetype = req.file.mimetype || mime.lookup(req.file.originalname) || 'application/octet-stream';
    await sendMediaFile(chatId, req.file.path, mimetype, req.body.caption || '');
    db.prepare('INSERT INTO sent (telefone, ts) VALUES (?,?)').run(numero, Date.now());
    logEvent('success', 'Mídia enviada via /send-media', numero);
    res.json({ ok: true, status: 'sucesso', numero });
  } catch (e) {
    logEvent('error', `Erro /send-media: ${e.message}`);
    res.status(500).json({ error: e.message, status: 'erro' });
  }
});

// Aplicar etiqueta nativa WhatsApp Business
app.post('/labels/apply', async (req, res) => {
  try {
    if (!waReady) return res.status(503).json({ error: 'WhatsApp não conectado', status: 'erro' });
    const numero = String(req.body?.numero ?? '').replace(/\D+/g, '');
    const label = String(req.body?.label ?? '').trim();
    if (!numero) return res.status(400).json({ error: 'numero inválido', status: 'erro' });
    if (!label) return res.status(400).json({ error: 'label vazia', status: 'erro' });
    const chatId = `${numero}@c.us`;
    // whatsapp-web.js: addOrRemoveLabels
    try {
      const labels = await wa.getLabels();
      let lbl = labels.find((l) => l.name.toLowerCase() === label.toLowerCase());
      if (!lbl) lbl = await wa.addLabel(label);
      await wa.addOrRemoveLabels([lbl.id], [chatId]);
      res.json({ ok: true, status: 'sucesso' });
    } catch (e) {
      // Fallback — labels só disponíveis no WhatsApp Business
      res.status(501).json({ error: 'Labels requerem WhatsApp Business: ' + e.message, status: 'erro' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message, status: 'erro' });
  }
});

// Logs
app.get('/logs', (_req, res) => res.json(db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 500').all()));

// ─────────────────────── CRM: pipeline ─────────────────────────
app.get('/pipeline/stages', (_req, res) => {
  res.json(db.prepare('SELECT key, label, color, ord AS "order", terminal FROM pipeline_stages ORDER BY ord').all());
});

app.post('/pipeline/stages', (req, res) => {
  const { key, label, color, order = 0, terminal = false } = req.body || {};
  if (!key || !label) return res.status(400).json({ error: 'key e label são obrigatórios' });
  db.prepare(`INSERT OR REPLACE INTO pipeline_stages (key,label,color,ord,terminal) VALUES (?,?,?,?,?)`)
    .run(key, label, color || '213 100% 60%', Number(order) || 0, terminal ? 1 : 0);
  broadcast({ type: 'pipeline-changed' });
  res.json({ ok: true });
});

app.delete('/pipeline/stages/:key', (req, res) => {
  const remaining = db.prepare('SELECT key FROM pipeline_stages WHERE key != ? ORDER BY ord LIMIT 1').get(req.params.key);
  if (!remaining) return res.status(400).json({ error: 'pelo menos uma etapa deve existir' });
  // Move contatos órfãos para a primeira etapa restante
  db.prepare('UPDATE contacts SET status=? WHERE status=?').run(remaining.key, req.params.key);
  db.prepare('DELETE FROM pipeline_stages WHERE key=?').run(req.params.key);
  broadcast({ type: 'pipeline-changed' });
  broadcast({ type: 'contacts-changed' });
  res.json({ ok: true });
});

// Mover contato com histórico
app.post('/contacts/:id/stage', (req, res) => {
  const { to, user = 'me' } = req.body || {};
  if (!to) return res.status(400).json({ error: 'to obrigatório' });
  const contact = db.prepare('SELECT id, status, telefone FROM contacts WHERE id=?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'contato não encontrado' });
  const stage = db.prepare('SELECT key, terminal FROM pipeline_stages WHERE key=?').get(to);
  if (!stage) return res.status(400).json({ error: 'etapa inválida' });
  if (contact.status === to) return res.json({ ok: true, unchanged: true });

  const tx = db.transaction(() => {
    db.prepare('UPDATE contacts SET status=? WHERE id=?').run(to, contact.id);
    db.prepare(`INSERT INTO pipeline_history (id, contact_id, from_stage, to_stage, ts, user) VALUES (?,?,?,?,?,?)`)
      .run(randomId(), contact.id, contact.status || null, to, Date.now(), user);
    // Se for etapa terminal, finalizar conversa correspondente (se existir)
    if (stage.terminal && contact.telefone) {
      const chatId = `${contact.telefone}@c.us`;
      db.prepare(`UPDATE conversations SET status='finalizado' WHERE id=?`).run(chatId);
    }
    if (to === 'em-atendimento' && contact.telefone) {
      const chatId = `${contact.telefone}@c.us`;
      db.prepare(`UPDATE conversations SET status='atendendo', assignee=COALESCE(assignee, ?) WHERE id=?`)
        .run(user, chatId);
    }
  });
  tx();

  broadcast({ type: 'contacts-changed' });
  broadcast({ type: 'pipeline-history-changed', contactId: contact.id });
  if (stage.terminal) broadcast({ type: 'conversations-changed' });
  res.json({ ok: true });
});

app.get('/pipeline/history', (req, res) => {
  const contactId = req.query.contactId;
  let sql = 'SELECT * FROM pipeline_history';
  const args = [];
  if (contactId) { sql += ' WHERE contact_id=?'; args.push(contactId); }
  sql += ' ORDER BY ts DESC LIMIT 500';
  res.json(db.prepare(sql).all(...args));
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
app.get('/metrics', (req, res) => {
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

  // Funnel pipeline
  const funnel = db.prepare(`
    SELECT s.key, s.label, s.color, s.ord, COUNT(c.id) AS count
    FROM pipeline_stages s LEFT JOIN contacts c ON c.status = s.key
    GROUP BY s.key ORDER BY s.ord
  `).all();

  // Top tags
  const topTags = db.prepare(`
    SELECT t.nome, t.cor, COUNT(ct.contact_id) AS count
    FROM tags t LEFT JOIN contact_tags ct ON ct.tag_id = t.id
    GROUP BY t.id ORDER BY count DESC LIMIT 8
  `).all();

  res.json({
    range: { days, startTs, endTs: now },
    totals: {
      contacts: totalContacts, tags: totalTags,
      conversations: totalConv, pendentes, atendendo, finalizadas,
      sent: totalSent, errors: totalErr,
      successRate: (totalSent + totalErr) ? Math.round(totalSent / (totalSent + totalErr) * 100) : null,
      avgFirstResponseMs: avgFirstResponse,
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
  switch (msg.type) {
    case 'request-qr': if (!waReady && !waInitializing) initWa(); break;
    case 'logout':
      if (wa) wa.logout().catch(() => {});
      break;
    case 'reconnect': initWa(); break;
    case 'start-campaign':
      if (campaign) return;
      if (!waReady) { logEvent('error', 'WhatsApp não está conectado.'); return; }
      campaign = { contacts: msg.contacts, template: msg.template, settings: msg.settings, idx: 0, sent: 0, failed: 0, paused: false, stop: false };
      runCampaign();
      break;
    case 'pause-campaign': if (campaign) campaign.paused = true; break;
    case 'resume-campaign': if (campaign) campaign.paused = false; break;
    case 'stop-campaign': if (campaign) campaign.stop = true; break;
    case 'ping': broadcast({ type: 'pong', t: Date.now() }); break;
  }
}

// ─────────────────────────── Boot ──────────────────────────────
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
