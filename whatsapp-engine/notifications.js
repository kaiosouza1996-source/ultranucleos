/**
 * Sino de notificações — agrega mensagens internas não lidas + eventos de
 * agenda. Notificação é por usuário (uma linha por destinatário em
 * `notifications`), nunca compartilhada — ler não afeta o contador de
 * outro usuário. Fan-out de criação vive em comms.js (mensagem) e agenda.js
 * (evento corporativo/lembrete); este módulo só lê/marca como lida.
 */
const express = require('express');
const { query } = require('./pg');
const { requireSession } = require('./authz');

const router = express.Router();
router.use(requireSession);

function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const mapNotification = (r, extra) => ({
  id: r.id,
  tipo: r.tipo,
  referenciaId: r.referencia_id,
  lida: r.lida,
  criadoEm: r.criado_em,
  ...extra,
});

router.get('/', ah(async (req, res) => {
  const { rows } = await query(
    'select * from notifications where usuario_destino_id = $1 order by criado_em desc limit 100',
    [req.profile.id],
  );

  // Enriquecimento em JS (não SQL polimórfico) — referencia_id aponta pra
  // `messages` ou `calendar_events` conforme `tipo`, então busca em lote cada
  // grupo em vez de um JOIN heterogêneo.
  const messageIds = rows.filter((r) => r.tipo === 'MENSAGEM_INTERNA' && r.referencia_id).map((r) => r.referencia_id);
  const eventIds = rows.filter((r) => r.tipo !== 'MENSAGEM_INTERNA' && r.referencia_id).map((r) => r.referencia_id);

  const messagesById = new Map();
  if (messageIds.length) {
    const { rows: msgs } = await query(
      `select m.id, m.body, m.channel_id, u.full_name as author_name
       from messages m left join auth_users u on u.id = m.author_id
       where m.id = any($1::uuid[])`,
      [messageIds],
    );
    for (const m of msgs) messagesById.set(m.id, m);
  }

  const eventsById = new Map();
  if (eventIds.length) {
    const { rows: evs } = await query(
      'select id, titulo, data_hora_inicio, tipo from calendar_events where id = any($1::uuid[])',
      [eventIds],
    );
    for (const e of evs) eventsById.set(e.id, e);
  }

  const out = rows.map((r) => {
    if (r.tipo === 'MENSAGEM_INTERNA') {
      const msg = messagesById.get(r.referencia_id);
      return mapNotification(r, msg ? {
        preview: `${msg.author_name || 'Alguém'}: ${(msg.body || '[anexo]').slice(0, 80)}`,
        channelId: msg.channel_id,
      } : { preview: 'Mensagem removida' });
    }
    const ev = eventsById.get(r.referencia_id);
    return mapNotification(r, ev ? {
      preview: ev.titulo,
      eventStart: ev.data_hora_inicio,
    } : { preview: 'Evento removido' });
  });

  res.json(out);
}));

router.post('/:id/read', ah(async (req, res) => {
  await query(
    'update notifications set lida = true where id = $1 and usuario_destino_id = $2',
    [req.params.id, req.profile.id],
  );
  res.json({ ok: true });
}));

router.post('/read-all', ah(async (req, res) => {
  await query('update notifications set lida = true where usuario_destino_id = $1 and lida = false', [req.profile.id]);
  res.json({ ok: true });
}));

module.exports = { router };
