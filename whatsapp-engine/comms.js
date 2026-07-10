/**
 * Comunicação Interna — mapeamento 1:1 das ~40 funções que antes viviam em
 * src/lib/comms.ts (chamando o Supabase SDK direto) para rotas REST.
 * Autorização 100% em app-layer (ver authz.js) — sem RLS.
 * Respostas em camelCase direto, pra eliminar os map*() que o frontend
 * precisava fazer antes.
 */
const express = require('express');
const { query, pool } = require('./pg');
const { requireSession, canAccessChannel, canAccessChannelRow, getChannelRecipients, isSocio, parsePgArray } = require('./authz');
const { uploadCommsAttachment } = require('./uploads-comms');
const { broadcastToUser } = require('./realtime');

const router = express.Router();
router.use(requireSession); // tudo em /comms exige sessão completa (aal2)

function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ─────────────────────────── mapeadores snake_case -> camelCase ───────────────────────────
const mapProfile = (r) => ({ id: r.id, fullName: r.full_name, role: r.role });
const mapServer = (r) => ({ id: r.id, name: r.name, iconEmoji: r.icon_emoji, createdBy: r.created_by, createdAt: r.created_at });
const mapCategory = (r) => ({ id: r.id, serverId: r.server_id, name: r.name, position: r.position, createdBy: r.created_by, createdAt: r.created_at });
const mapChannel = (r) => ({
  id: r.id, name: r.name, description: r.description, category: r.category,
  visibility: r.visibility, allowedRoles: parsePgArray(r.allowed_roles), isDm: r.is_dm, isHandoff: r.is_handoff,
  createdBy: r.created_by, createdAt: r.created_at, serverId: r.server_id, categoryId: r.category_id, position: r.position,
});
const mapMessage = (r) => ({
  id: r.id, channelId: r.channel_id, authorId: r.author_id, body: r.body,
  isClientData: r.is_client_data, pinned: r.pinned, createdAt: r.created_at, editedAt: r.edited_at,
  attachmentPath: r.attachment_path, attachmentName: r.attachment_name, attachmentType: r.attachment_type,
});
const mapCard = (r) => ({
  id: r.id, channelId: r.channel_id, messageId: r.message_id, createdBy: r.created_by,
  clienteNome: r.cliente_nome, perfil: r.perfil, instrumento: r.instrumento, urgencia: r.urgencia,
  telefone: r.telefone, documento: r.documento, observacoes: r.observacoes,
  autorizacaoExpressa: r.autorizacao_expressa, createdAt: r.created_at,
});
const mapAudit = (r) => ({ id: r.id, ts: r.ts, actorName: r.actor_name, action: r.action, targetType: r.target_type, targetId: r.target_id, details: r.details });

async function logAudit(req, action, targetType, targetId, details) {
  try {
    await query('select log_comms_audit($1,$2,$3,$4,$5,$6)', [
      req.profile.id, req.profile.fullName, action, targetType, targetId, details ? JSON.stringify(details) : null,
    ]);
  } catch (e) {
    console.error('[comms] falha ao gravar audit log:', e.message);
  }
}

async function getCategoryIfOwned(req, res) {
  const { rows } = await query('select * from comms_categories where id = $1', [req.params.id]);
  const row = rows[0];
  if (!row) { res.status(404).json({ error: 'Categoria não encontrada.' }); return null; }
  if (!isSocio(req.profile) && row.created_by !== req.profile.id) { res.status(403).json({ error: 'Acesso restrito.' }); return null; }
  return row;
}

async function getChannelIfOwned(req, res, id) {
  const { rows } = await query('select * from channels where id = $1', [id]);
  const row = rows[0];
  if (!row) { res.status(404).json({ error: 'Canal não encontrado.' }); return null; }
  if (!isSocio(req.profile) && row.created_by !== req.profile.id) { res.status(403).json({ error: 'Acesso restrito.' }); return null; }
  return row;
}

// ─────────────────────────────── profiles ───────────────────────────────
router.get('/profiles', ah(async (req, res) => {
  const { rows } = await query('select id, full_name, role from auth_users where is_active = true order by full_name');
  res.json(rows.map(mapProfile));
}));

// ─────────────────────────────── servers ───────────────────────────────
router.get('/servers', ah(async (req, res) => {
  const { rows } = await query('select * from comms_servers order by created_at');
  res.json(rows.map(mapServer));
}));

// ─────────────────────────────── categories ───────────────────────────────
router.get('/servers/:serverId/categories', ah(async (req, res) => {
  const { rows } = await query('select * from comms_categories where server_id = $1 order by position, created_at', [req.params.serverId]);
  res.json(rows.map(mapCategory));
}));

router.post('/servers/:serverId/categories', ah(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name é obrigatório.' });
  const { rows } = await query(
    'insert into comms_categories (server_id, name, created_by) values ($1,$2,$3) returning *',
    [req.params.serverId, name, req.profile.id],
  );
  res.json(mapCategory(rows[0]));
}));

router.patch('/categories/:id', ah(async (req, res) => {
  const row = await getCategoryIfOwned(req, res);
  if (!row) return;
  const { name, position } = req.body || {};
  if (name !== undefined) await query('update comms_categories set name = $2 where id = $1', [req.params.id, name]);
  if (position !== undefined) await query('update comms_categories set position = $2 where id = $1', [req.params.id, position]);
  const { rows } = await query('select * from comms_categories where id = $1', [req.params.id]);
  res.json(mapCategory(rows[0]));
}));

router.delete('/categories/:id', ah(async (req, res) => {
  const row = await getCategoryIfOwned(req, res);
  if (!row) return;
  await query('delete from comms_categories where id = $1', [req.params.id]);
  res.json({});
}));

// ─────────────────────────────── channels ───────────────────────────────
router.get('/channels', ah(async (req, res) => {
  const { serverId } = req.query;
  const params = [];
  let sql = 'select * from channels where is_dm = false';
  if (serverId) { params.push(serverId); sql += ` and server_id = $${params.length}`; }
  sql += ' order by position, created_at';
  const { rows } = await query(sql, params);
  const accessible = [];
  for (const row of rows) {
    if (await canAccessChannelRow(pool, req.profile, row)) accessible.push(row);
  }
  res.json(accessible.map(mapChannel));
}));

router.post('/channels', ah(async (req, res) => {
  const { name, description, serverId, categoryId, visibility, allowedRoles, memberIds } = req.body || {};
  if (!name || !visibility) return res.status(400).json({ error: 'name e visibility são obrigatórios.' });
  const { rows } = await query(
    `insert into channels (name, description, server_id, category_id, visibility, allowed_roles, created_by)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [name, description || null, serverId || null, categoryId || null, visibility, visibility === 'role' ? (allowedRoles || []) : null, req.profile.id],
  );
  const channel = rows[0];
  if (visibility === 'private' && Array.isArray(memberIds) && memberIds.length) {
    const values = [req.profile.id, ...memberIds.filter((id) => id !== req.profile.id)];
    for (const userId of values) {
      await query('insert into channel_members (channel_id, user_id) values ($1,$2) on conflict do nothing', [channel.id, userId]);
    }
  }
  await logAudit(req, 'channel.create', 'channel', channel.id, { name, visibility });
  res.json(mapChannel(channel));
}));

router.patch('/channels/:id', ah(async (req, res) => {
  const row = await getChannelIfOwned(req, res, req.params.id);
  if (!row) return;
  const { name, position } = req.body || {};
  if (name !== undefined) await query('update channels set name = $2 where id = $1', [req.params.id, name]);
  if (position !== undefined) await query('update channels set position = $2 where id = $1', [req.params.id, position]);
  const { rows } = await query('select * from channels where id = $1', [req.params.id]);
  res.json(mapChannel(rows[0]));
}));

router.delete('/channels/:id', ah(async (req, res) => {
  const row = await getChannelIfOwned(req, res, req.params.id);
  if (!row) return;
  await query('delete from channels where id = $1', [req.params.id]);
  await logAudit(req, 'channel.delete', 'channel', req.params.id, { name: row.name });
  res.json({});
}));

router.get('/channels/:id/members', ah(async (req, res) => {
  if (!(await canAccessChannel(pool, req.profile, req.params.id))) return res.status(403).json({ error: 'Acesso restrito.' });
  const { rows } = await query('select user_id from channel_members where channel_id = $1', [req.params.id]);
  res.json(rows.map((r) => r.user_id));
}));

router.post('/channels/:id/members', ah(async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });
  if (!(await canAccessChannel(pool, req.profile, req.params.id))) return res.status(403).json({ error: 'Acesso restrito.' });
  await query('insert into channel_members (channel_id, user_id) values ($1,$2) on conflict do nothing', [req.params.id, userId]);
  await logAudit(req, 'channel.add_member', 'channel', req.params.id, { userId });
  res.json({});
}));

router.delete('/channels/:id/members/:userId', ah(async (req, res) => {
  const { userId } = req.params;
  const isSelf = userId === req.profile.id;
  if (!isSelf && !isSocio(req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
  await query('delete from channel_members where channel_id = $1 and user_id = $2', [req.params.id, userId]);
  res.json({});
}));

// ─────────────────────────────── DMs ───────────────────────────────
router.get('/dms', ah(async (req, res) => {
  const { rows } = await query(
    `select c.* from channels c
     join channel_members m on m.channel_id = c.id
     where c.is_dm = true and m.user_id = $1 and m.hidden_at is null
     order by c.created_at`,
    [req.profile.id],
  );
  res.json(rows.map(mapChannel));
}));

router.post('/dms', ah(async (req, res) => {
  const { otherUserId } = req.body || {};
  if (!otherUserId) return res.status(400).json({ error: 'otherUserId é obrigatório.' });
  const { rows } = await query('select get_or_create_dm($1,$2) as channel_id', [req.profile.id, otherUserId]);
  // Reabrir uma DM que o próprio usuário tinha ocultado antes, ao iniciar uma
  // nova conversa com a mesma pessoa — nunca fica escondida "para sempre".
  await query('update channel_members set hidden_at = null where channel_id = $1 and user_id = $2', [rows[0].channel_id, req.profile.id]);
  res.json({ channelId: rows[0].channel_id });
}));

// Ocultar DM — só quem INICIOU a conversa (channels.created_by), e só some da
// PRÓPRIA lista (channel_members.hidden_at é por linha/membro, não afeta a
// visibilidade do outro participante).
router.post('/channels/:id/hide', ah(async (req, res) => {
  const { rows: channelRows } = await query('select * from channels where id = $1', [req.params.id]);
  const channel = channelRows[0];
  if (!channel) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (!channel.is_dm) return res.status(400).json({ error: 'Só é possível ocultar conversas diretas.' });
  if (channel.created_by !== req.profile.id) return res.status(403).json({ error: 'Só quem iniciou a conversa pode ocultá-la.' });
  await query('update channel_members set hidden_at = now() where channel_id = $1 and user_id = $2', [req.params.id, req.profile.id]);
  res.json({ ok: true });
}));

// ─────────────────────────────── messages ───────────────────────────────
router.get('/channels/:id/messages', ah(async (req, res) => {
  if (!(await canAccessChannel(pool, req.profile, req.params.id))) return res.status(403).json({ error: 'Acesso restrito.' });
  const { rows } = await query('select * from messages where channel_id = $1 order by created_at', [req.params.id]);
  res.json(rows.map(mapMessage));
}));

router.post('/channels/:id/messages', ah(async (req, res) => {
  const { rows: channelRows } = await query('select * from channels where id = $1', [req.params.id]);
  const channelRow = channelRows[0];
  if (!(await canAccessChannelRow(pool, req.profile, channelRow))) return res.status(403).json({ error: 'Acesso restrito.' });
  const { body, attachment } = req.body || {};
  const { rows } = await query(
    `insert into messages (channel_id, author_id, body, attachment_path, attachment_name, attachment_type)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [req.params.id, req.profile.id, body || null, attachment?.path || null, attachment?.name || null, attachment?.type || null],
  );
  const message = rows[0];
  res.json(mapMessage(message));

  // Fan-out de notificação MENSAGEM_INTERNA — nunca dispara popup (só o
  // badge do sino sobe), diferente de AGENDA_CORPORATIVA_CRIADA/AGENDA_LEMBRETE.
  // Roda depois do res.json (não atrasa a resposta ao remetente) — falha aqui
  // nunca deve derrubar o envio da mensagem em si.
  try {
    const recipientIds = (await getChannelRecipients(pool, channelRow)).filter((id) => id !== req.profile.id);
    for (const userId of recipientIds) {
      const { rows: notifRows } = await query(
        `insert into notifications (tipo, referencia_id, usuario_destino_id) values ('MENSAGEM_INTERNA', $1, $2) returning *`,
        [message.id, userId],
      );
      broadcastToUser(userId, {
        type: 'notification:new',
        notification: { id: notifRows[0].id, tipo: 'MENSAGEM_INTERNA', referenciaId: message.id, lida: false, criadoEm: notifRows[0].criado_em },
      });
    }
  } catch (e) {
    console.error('[comms] falha ao notificar mensagem interna:', e.message);
  }
}));

async function getMessageIfEditable(req, res) {
  const { rows } = await query('select * from messages where id = $1', [req.params.id]);
  const row = rows[0];
  if (!row) { res.status(404).json({ error: 'Mensagem não encontrada.' }); return null; }
  if (row.author_id !== req.profile.id && !isSocio(req.profile)) { res.status(403).json({ error: 'Acesso restrito.' }); return null; }
  return row;
}

router.patch('/messages/:id', ah(async (req, res) => {
  const row = await getMessageIfEditable(req, res);
  if (!row) return;
  const { body } = req.body || {};
  // O trigger messages_immutable barra a UPDATE no Postgres se for dado de
  // cliente/handoff — o erro sobe pelo catch global do router (ver final do arquivo).
  const { rows } = await query('update messages set body = $2, edited_at = now() where id = $1 returning *', [req.params.id, body]);
  res.json(mapMessage(rows[0]));
}));

router.patch('/messages/:id/pin', ah(async (req, res) => {
  const { pinned } = req.body || {};
  const { rows } = await query('select * from messages where id = $1', [req.params.id]);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  // Mesma regra da RLS original (autor ou sócio) — pin/unpin é uma mutação da
  // linha, não deve ser mais permissivo que editar/apagar só por ter acesso
  // de leitura ao canal.
  if (row.author_id !== req.profile.id && !isSocio(req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
  const { rows: updated } = await query('update messages set pinned = $2 where id = $1 returning *', [req.params.id, !!pinned]);
  await logAudit(req, pinned ? 'message.pin' : 'message.unpin', 'message', req.params.id, null);
  res.json(mapMessage(updated[0]));
}));

// Checagem PRÓPRIA do DELETE — não reaproveita getMessageIfEditable (que não
// deve ganhar limite de tempo; afetaria edição, fora do escopo desta regra).
// Handoff/dado de cliente é bloqueado aqui de propósito ANTES de tentar o
// DELETE (o trigger messages_immutable do Postgres também bloqueia, mas essa
// checagem prévia devolve um 403 amigável em vez da exceção crua do trigger).
async function getMessageIfDeletable(req, res) {
  const { rows } = await query(
    `select m.*, c.is_handoff as channel_is_handoff
     from messages m join channels c on c.id = m.channel_id
     where m.id = $1`,
    [req.params.id],
  );
  const row = rows[0];
  if (!row) { res.status(404).json({ error: 'Mensagem não encontrada.' }); return null; }
  if (row.is_client_data || row.channel_is_handoff) {
    res.status(403).json({ error: 'Mensagens de dado de cliente ou de canal de handoff não podem ser apagadas (Seção 13 do Manual Operacional).' });
    return null;
  }
  const isAuthor = row.author_id === req.profile.id;
  const isModerator = !isAuthor && isSocio(req.profile);
  if (!isAuthor && !isModerator) { res.status(403).json({ error: 'Acesso restrito.' }); return null; }
  if (!isModerator) {
    // Apagar a PRÓPRIA mensagem sempre respeita os 15 minutos, mesmo pra
    // Sócio — o poder sem limite de tempo do Sócio é só pra MODERAR mensagem
    // alheia (decisão confirmada com o usuário), não uma isenção geral.
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (ageMs > 15 * 60 * 1000) {
      res.status(403).json({ error: 'Essa mensagem só pode ser apagada em até 15 minutos após o envio.' });
      return null;
    }
  }
  return row;
}

router.delete('/messages/:id', ah(async (req, res) => {
  const row = await getMessageIfDeletable(req, res);
  if (!row) return;
  await query('delete from messages where id = $1', [req.params.id]);
  res.json({});
}));

// ─────────────────────────────── anexos ───────────────────────────────
// Checagem de acesso ANTES do multer gravar qualquer coisa em disco — um
// usuário sem acesso ao canal não deve conseguir causar escrita de arquivo
// nenhuma, mesmo que a resposta final seja rejeitada de qualquer forma.
router.post('/channels/:id/attachments', ah(async (req, res, next) => {
  if (!(await canAccessChannel(pool, req.profile, req.params.id))) return res.status(403).json({ error: 'Acesso restrito.' });
  next();
}), uploadCommsAttachment.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo ausente.' });
  res.json({
    path: `${req.params.id}/${req.file.filename}`,
    name: req.file.originalname,
    type: req.file.mimetype || 'application/octet-stream',
  });
}));
// GET /comms/attachments/:channelId/:filename é montado em server.js (uploads-comms.js:downloadAttachment).

// ─────────────────────────────── não lidas ───────────────────────────────
router.post('/channels/:id/read', ah(async (req, res) => {
  await query(
    `insert into channel_reads (user_id, channel_id, last_read_at) values ($1,$2, now())
     on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at`,
    [req.profile.id, req.params.id],
  );
  // Mantém o sino em sincronia com a leitura real do canal — sem isso, o
  // badge de MENSAGEM_INTERNA só zerava clicando item por item no dropdown do
  // sino, mesmo depois do usuário já ter lido tudo abrindo o canal normalmente.
  await query(
    `update notifications set lida = true
     where usuario_destino_id = $1 and tipo = 'MENSAGEM_INTERNA'
       and referencia_id in (select id from messages where channel_id = $2)`,
    [req.profile.id, req.params.id],
  );
  res.json({});
}));

router.get('/unread-counts', ah(async (req, res) => {
  const { rows: channelRows } = await query('select id, visibility, allowed_roles from channels where is_dm = false or exists (select 1 from channel_members m where m.channel_id = channels.id and m.user_id = $1)', [req.profile.id]);
  const accessibleIds = [];
  for (const row of channelRows) {
    if (await canAccessChannelRow(pool, req.profile, row)) accessibleIds.push(row.id);
  }
  if (!accessibleIds.length) return res.json({});
  const { rows } = await query('select * from get_unread_counts($1, $2)', [req.profile.id, accessibleIds]);
  const result = {};
  for (const r of rows) result[r.channel_id] = Number(r.unread_count);
  res.json(result);
}));

// ─────────────────────────────── handoff cards ───────────────────────────────
router.get('/channels/:id/cards', ah(async (req, res) => {
  if (!(await canAccessChannel(pool, req.profile, req.params.id))) return res.status(403).json({ error: 'Acesso restrito.' });
  const { rows } = await query('select * from client_data_cards where channel_id = $1 order by created_at', [req.params.id]);
  res.json(rows.map(mapCard));
}));

router.post('/channels/:id/cards', ah(async (req, res) => {
  if (!(await canAccessChannel(pool, req.profile, req.params.id))) return res.status(403).json({ error: 'Acesso restrito.' });
  const { clienteNome, perfil, instrumento, urgencia, telefone, documento, observacoes, autorizacaoExpressa } = req.body || {};
  if (!autorizacaoExpressa) return res.status(400).json({ error: 'Autorização expressa é obrigatória para registrar dado de cliente.' });

  const { rows: msgRows } = await query(
    `insert into messages (channel_id, author_id, body, is_client_data) values ($1,$2,$3,true) returning *`,
    [req.params.id, req.profile.id, `📋 Handoff: ${clienteNome}`],
  );
  const message = msgRows[0];
  const { rows: cardRows } = await query(
    `insert into client_data_cards
       (channel_id, message_id, created_by, cliente_nome, perfil, instrumento, urgencia, telefone, documento, observacoes, autorizacao_expressa)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [req.params.id, message.id, req.profile.id, clienteNome, perfil, instrumento, urgencia, telefone || null, documento || null, observacoes || null, true],
  );
  await logAudit(req, 'client_data_card.create', 'client_data_card', cardRows[0].id, { clienteNome, urgencia });
  res.json(mapCard(cardRows[0]));
}));

// ─────────────────────────────── audit log ───────────────────────────────
router.get('/audit-log', ah(async (req, res) => {
  if (!isSocio(req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
  const { rows } = await query('select * from comms_audit_log order by ts desc limit 500');
  res.json(rows.map(mapAudit));
}));

// Erros lançados por qualquer rota acima (inclusive os triggers de
// imutabilidade do Postgres) caem aqui — nunca um 500 cru sem contexto.
router.use((err, req, res, next) => {
  console.error('[comms] erro:', err.message);
  res.status(400).json({ error: err.message || 'Erro ao processar requisição.' });
});

module.exports = { router };
