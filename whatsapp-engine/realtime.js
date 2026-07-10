/**
 * Realtime da Comunicação Interna — substitui o Supabase Realtime.
 * Reaproveita o WebSocketServer único já existente em server.js (path /ws),
 * roteando mensagens por `type: "comms:*"`. Um client `pg` dedicado escuta
 * `NOTIFY comms_events` (disparado pelos triggers da migration 0005) e faz o
 * broadcast em memória para quem está inscrito no canal.
 *
 * Typing/presence são 100% efêmeros (sem persistência) — só repasse direto
 * entre as conexões abertas no processo. Limitação assumida e documentada:
 * isso não escala para múltiplas instâncias do engine atrás de um load
 * balancer (hoje é single-instance, então é aceitável).
 */
const { Client } = require('pg');
const { pool, PG_CONFIGURED } = require('./pg');
const { canAccessChannel, canAccessChannelRow } = require('./authz');

const subsByWs = new Map(); // ws -> { profile, channels: Set<channelId>, presenceJoined: boolean }
const wsByChannel = new Map(); // channelId -> Set<ws>
const presenceCount = new Map(); // userId -> nº de conexões ativas com presença

function send(ws, msg) {
  try { ws.send(JSON.stringify(msg)); } catch { /* conexão pode já ter fechado */ }
}

function broadcastPresence() {
  const onlineIds = Array.from(presenceCount.keys());
  for (const ws of subsByWs.keys()) send(ws, { type: 'comms:presence:sync', onlineIds });
}

function registerConnection(ws, profile) {
  subsByWs.set(ws, { profile, channels: new Set(), presenceJoined: false });
}

function unregisterConnection(ws) {
  const state = subsByWs.get(ws);
  if (!state) return;
  for (const channelId of state.channels) {
    const set = wsByChannel.get(channelId);
    if (set) { set.delete(ws); if (!set.size) wsByChannel.delete(channelId); }
  }
  const hadPresence = state.presenceJoined;
  if (hadPresence) {
    const count = (presenceCount.get(state.profile.id) || 1) - 1;
    if (count <= 0) presenceCount.delete(state.profile.id); else presenceCount.set(state.profile.id, count);
  }
  subsByWs.delete(ws);
  if (hadPresence) broadcastPresence();
}

async function handleCommsMessage(ws, msg) {
  const state = subsByWs.get(ws);
  if (!state || !state.profile) return send(ws, { type: 'comms:error', code: 'unauthenticated' });
  const { profile } = state;

  switch (msg.type) {
    case 'comms:subscribe': {
      const { channelId } = msg;
      if (!channelId) return;
      const allowed = await canAccessChannel(pool, profile, channelId).catch(() => false);
      if (!allowed) return send(ws, { type: 'comms:error', code: 'forbidden', channelId });
      state.channels.add(channelId);
      if (!wsByChannel.has(channelId)) wsByChannel.set(channelId, new Set());
      wsByChannel.get(channelId).add(ws);
      break;
    }
    case 'comms:unsubscribe': {
      const { channelId } = msg;
      state.channels.delete(channelId);
      const set = wsByChannel.get(channelId);
      if (set) { set.delete(ws); if (!set.size) wsByChannel.delete(channelId); }
      break;
    }
    case 'comms:typing': {
      const { channelId } = msg;
      if (!state.channels.has(channelId)) break; // subscribe já validou acesso a este canal
      const set = wsByChannel.get(channelId);
      if (set) for (const other of set) if (other !== ws) send(other, { type: 'comms:typing', channelId, userId: profile.id });
      break;
    }
    case 'comms:presence:join': {
      if (state.presenceJoined) break;
      state.presenceJoined = true;
      presenceCount.set(profile.id, (presenceCount.get(profile.id) || 0) + 1);
      broadcastPresence();
      break;
    }
    case 'comms:presence:leave': {
      if (!state.presenceJoined) break;
      state.presenceJoined = false;
      const count = (presenceCount.get(profile.id) || 1) - 1;
      if (count <= 0) presenceCount.delete(profile.id); else presenceCount.set(profile.id, count);
      broadcastPresence();
      break;
    }
    default:
      break;
  }
}

function broadcastToChannel(channelId, msg) {
  const set = wsByChannel.get(channelId);
  if (!set) return;
  for (const ws of set) send(ws, msg);
}

/** Derruba toda conexão WS aberta em nome deste usuário — chamado no logout
 * e na troca de senha (auth.js), pra não deixar uma sessão revogada com
 * acesso realtime "esquecido" vivo até o próximo reconnect. O perfil da
 * conexão é resolvido uma vez no handshake e nunca reconferido por mensagem
 * (ver handleCommsMessage); fechar o socket é a forma de propagar a revogação. */
function closeUserConnections(userId) {
  for (const [ws, state] of subsByWs) {
    if (state.profile && state.profile.id === userId) {
      try { ws.close(4001, 'sessão encerrada'); } catch { /* já pode estar fechando */ }
    }
  }
}

function broadcastToUser(userId, msg) {
  for (const [ws, state] of subsByWs) if (state.profile && state.profile.id === userId) send(ws, msg);
}

function mapMessageRow(row) {
  return {
    id: row.id, channelId: row.channel_id, authorId: row.author_id, body: row.body,
    isClientData: row.is_client_data, pinned: row.pinned, createdAt: row.created_at, editedAt: row.edited_at,
    attachmentPath: row.attachment_path, attachmentName: row.attachment_name, attachmentType: row.attachment_type,
  };
}

let listenerClient = null;
async function startListener() {
  if (!PG_CONFIGURED) {
    console.warn('[realtime] DATABASE_URL não configurada — realtime da Comunicação Interna desativado.');
    return;
  }
  listenerClient = new Client({ connectionString: process.env.DATABASE_URL });
  await listenerClient.connect();
  await listenerClient.query('LISTEN comms_events');
  listenerClient.on('notification', (msg) => {
    let payload;
    try { payload = JSON.parse(msg.payload); } catch { return; }
    if (payload.table === 'messages') {
      const type = payload.op === 'INSERT' ? 'comms:message:insert' : 'comms:message:update';
      broadcastToChannel(payload.row.channel_id, { type, channelId: payload.row.channel_id, message: mapMessageRow(payload.row) });
    } else if (payload.table === 'channel_reads') {
      broadcastToUser(payload.row.user_id, { type: 'comms:unread:changed', channelId: payload.row.channel_id });
    }
  });
  listenerClient.on('error', (e) => console.error('[realtime] listener pg client erro:', e.message));
  console.log('[realtime] LISTEN comms_events ativo.');
}

module.exports = { registerConnection, unregisterConnection, handleCommsMessage, startListener, closeUserConnections, broadcastToUser };
