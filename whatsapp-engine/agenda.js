/**
 * Agenda — eventos PESSOAL (do próprio usuário; Sócio pode ver a de qualquer
 * colaborador em modo leitura) e CORPORATIVO (visível a todos automaticamente,
 * qualquer usuário pode criar). Criar um evento corporativo ou bater o
 * lembrete dispara notificação (ver notifications.js) — a entrega em tempo
 * real reaproveita o mesmo WebSocket da Comunicação Interna
 * (`realtime.js::broadcastToUser`) + o broadcast geral do engine (`broadcast`
 * de server.js, injetado via `deps`) para a grade atualizar sem F5.
 */
const express = require('express');
const { query } = require('./pg');
const { requireSession, isSocio } = require('./authz');

function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const mapEvent = (r) => ({
  id: r.id,
  titulo: r.titulo,
  descricao: r.descricao,
  dataHoraInicio: r.data_hora_inicio,
  dataHoraFim: r.data_hora_fim,
  criadoPor: r.criado_por,
  tipo: r.tipo,
  lembreteMinutosAntes: r.lembrete_minutos_antes,
  createdAt: r.created_at,
});

async function getActiveUserIds(excludeId) {
  const { rows } = await query('select id from auth_users where is_active = true and id <> coalesce($1, \'00000000-0000-0000-0000-000000000000\'::uuid)', [excludeId || null]);
  return rows.map((r) => r.id);
}

async function notifyUsers(userIds, tipo, referenciaId, deps) {
  for (const userId of userIds) {
    const { rows } = await query(
      `insert into notifications (tipo, referencia_id, usuario_destino_id) values ($1,$2,$3) returning *`,
      [tipo, referenciaId, userId],
    );
    deps.broadcastToUser(userId, {
      type: 'notification:new',
      notification: { id: rows[0].id, tipo: rows[0].tipo, referenciaId: rows[0].referencia_id, lida: false, criadoEm: rows[0].criado_em },
    });
  }
}

function createRouter(deps) {
  const router = express.Router();
  router.use(requireSession);

  router.get('/events', ah(async (req, res) => {
    const { scope, userId, from, to } = req.query;
    const range = [];
    let where = '';
    if (from) { range.push(from); where += ` and data_hora_inicio >= $${range.length}`; }
    if (to) { range.push(to); where += ` and data_hora_inicio <= $${range.length}`; }

    if (scope === 'corporativo') {
      const { rows } = await query(`select * from calendar_events where tipo = 'CORPORATIVO'${where} order by data_hora_inicio`, range);
      return res.json(rows.map(mapEvent));
    }

    // scope pessoal (default): só os próprios, a menos que um Sócio peça
    // explicitamente a agenda de outro colaborador (visualização, sem edição
    // liberada no frontend).
    let targetUserId = req.profile.id;
    if (userId && userId !== req.profile.id) {
      if (!isSocio(req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
      targetUserId = userId;
    }
    range.push(targetUserId);
    const { rows } = await query(
      `select * from calendar_events where tipo = 'PESSOAL' and criado_por = $${range.length}${where} order by data_hora_inicio`,
      range,
    );
    res.json(rows.map(mapEvent));
  }));

  router.post('/events', ah(async (req, res) => {
    const { titulo, descricao, dataHoraInicio, dataHoraFim, tipo, lembreteMinutosAntes } = req.body || {};
    if (!titulo || !dataHoraInicio) return res.status(400).json({ error: 'titulo e dataHoraInicio são obrigatórios.' });
    const eventType = tipo === 'CORPORATIVO' ? 'CORPORATIVO' : 'PESSOAL';
    const { rows } = await query(
      `insert into calendar_events (titulo, descricao, data_hora_inicio, data_hora_fim, criado_por, tipo, lembrete_minutos_antes)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [titulo, descricao || null, dataHoraInicio, dataHoraFim || null, req.profile.id, eventType, lembreteMinutosAntes ?? 15],
    );
    const event = rows[0];

    if (eventType === 'CORPORATIVO') {
      const recipientIds = await getActiveUserIds(req.profile.id);
      await notifyUsers(recipientIds, 'AGENDA_CORPORATIVA_CRIADA', event.id, deps);
      deps.broadcastAll({ type: 'agenda:event-created', event: mapEvent(event) });
    }

    res.json(mapEvent(event));
  }));

  async function getEventIfEditable(req, res) {
    const { rows } = await query('select * from calendar_events where id = $1', [req.params.id]);
    const row = rows[0];
    if (!row) { res.status(404).json({ error: 'Evento não encontrado.' }); return null; }
    if (row.criado_por !== req.profile.id && !isSocio(req.profile)) { res.status(403).json({ error: 'Acesso restrito.' }); return null; }
    return row;
  }

  router.patch('/events/:id', ah(async (req, res) => {
    const row = await getEventIfEditable(req, res);
    if (!row) return;
    const { titulo, descricao, dataHoraInicio, dataHoraFim, lembreteMinutosAntes } = req.body || {};
    const { rows } = await query(
      `update calendar_events set
         titulo = coalesce($1, titulo),
         descricao = coalesce($2, descricao),
         data_hora_inicio = coalesce($3, data_hora_inicio),
         data_hora_fim = $4,
         lembrete_minutos_antes = coalesce($5, lembrete_minutos_antes),
         updated_at = now()
       where id = $6 returning *`,
      [titulo, descricao, dataHoraInicio, dataHoraFim ?? row.data_hora_fim, lembreteMinutosAntes, req.params.id],
    );
    res.json(mapEvent(rows[0]));
  }));

  router.delete('/events/:id', ah(async (req, res) => {
    const row = await getEventIfEditable(req, res);
    if (!row) return;
    await query('delete from calendar_events where id = $1', [req.params.id]);
    res.json({ ok: true });
  }));

  return router;
}

/** Sem cron/scheduler no projeto — dispara por polling a cada 60s. Idempotente
 * via `reminder_sent`, então um tick perdido/atrasado nunca duplica aviso. */
function startReminderScanner(deps) {
  setInterval(async () => {
    try {
      const { rows } = await query(`
        select * from calendar_events
        where reminder_sent = false
          and data_hora_inicio > now()
          and now() >= data_hora_inicio - (lembrete_minutos_antes || ' minutes')::interval
      `);
      for (const ev of rows) {
        const recipientIds = ev.tipo === 'CORPORATIVO' ? await getActiveUserIds() : [ev.criado_por];
        await notifyUsers(recipientIds, 'AGENDA_LEMBRETE', ev.id, deps);
        await query('update calendar_events set reminder_sent = true where id = $1', [ev.id]);
      }
    } catch (e) {
      console.error('[agenda] falha no scanner de lembretes:', e.message);
    }
  }, 60000);
}

module.exports = { createRouter, startReminderScanner };
