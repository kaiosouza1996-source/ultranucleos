/**
 * Engine client — REST + WebSocket bridge to the local Node engine.
 * Includes:
 *  - automatic reconnection with exponential backoff
 *  - heartbeat (ping every 25s)
 *  - simulation fallback when the engine is offline (so the UI stays usable)
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppStore, type AntiBanSettings, type ChatMessage, type Contact, type Conversation, type CustomField, type PipelineStage, type Tag } from "@/store/appStore";
import { dispatchCommsMessage } from "@/lib/commsSocket";
import { dispatchNotificationMessage, type AppNotification } from "@/lib/notifications";
import { useNotificationsStore } from "@/store/notificationsStore";

// URL do engine: usa variável de ambiente em produção, localhost em dev
export const ENGINE_HTTP = (import.meta.env.VITE_ENGINE_URL || "http://localhost:8787").replace(/\/$/, "");

// API key obrigatória (item 2 do plano de segurança) — o engine recusa (401)
// qualquer requisição sem ela. Vai tanto no header (chamadas REST) quanto na
// query string (WebSocket e <img>/<audio src> de mídia, que não enviam headers).
export const ENGINE_API_KEY = import.meta.env.VITE_ENGINE_API_KEY || "";
export const ENGINE_WS = ENGINE_HTTP.replace(/^http/, "ws") + "/ws" + (ENGINE_API_KEY ? `?apiKey=${encodeURIComponent(ENGINE_API_KEY)}` : "");

// Em produção, defina VITE_DISABLE_MOCK=true para desligar completamente o modo
// simulação: sem o Sistema local (engine) acessível, o painel fica "desconectado"
// de verdade em vez de fabricar um QR/conexão falsos — evita que alguém confunda
// uma simulação com uma conexão real de WhatsApp.
export const MOCK_DISABLED = String(import.meta.env.VITE_DISABLE_MOCK ?? "").toLowerCase() === "true";

/**
 * Limpeza rigorosa de número: remove parênteses, espaços, traços, pontos,
 * sinais de mais e qualquer caractere não numérico — mantém apenas dígitos.
 * Ex: "+55 (21) 99999-9999" → "5521999999999"
 */
export function sanitizePhoneNumber(raw: string): string {
  return String(raw ?? "").replace(/\D+/g, "");
}

function dataUrlToBlobInternal(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function extractDataUrlMime(value?: string): string {
  if (!value) return "";
  return /^data:([^;,]+)(?:;[^,]*)?;base64,/i.exec(value.trim())?.[1]?.toLowerCase() ?? "";
}

function cleanBase64Payload(value: string): string {
  let cleaned = String(value ?? "").trim();
  const dataUrlMatch = /^data:[^,]*,([\s\S]*)$/i.exec(cleaned);
  if (dataUrlMatch) cleaned = dataUrlMatch[1];
  cleaned = cleaned.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const remainder = cleaned.length % 4;
  if (remainder) cleaned += "=".repeat(4 - remainder);
  if (!cleaned || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) throw new Error("Base64 de mídia inválido");
  return cleaned;
}

function normalizeMimeType(mimetype?: string, filename?: string, dataUrl?: string): string {
  const raw = (mimetype || extractDataUrlMime(dataUrl) || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const name = (filename || "").toLowerCase();
  if (raw === "audio/mp3" || name.endsWith(".mp3")) return "audio/mpeg";
  if (raw === "audio/mpeg" || raw === "audio/ogg" || raw === "audio/webm") return raw;
  if (name.endsWith(".ogg") || name.endsWith(".opus")) return "audio/ogg";
  if (name.endsWith(".webm")) return "audio/webm";
  if (raw.startsWith("image/") || raw.startsWith("audio/")) return raw;
  return raw;
}

function normalizeFileName(filename: string, mimeType: string): string {
  const safe = (filename || `midia-${Date.now()}`).replace(/[\\/:*?"<>|]+/g, "-");
  const ext = mimeType === "audio/mpeg" ? ".mp3"
    : mimeType === "audio/ogg" ? ".ogg"
      : mimeType === "audio/webm" ? ".webm"
        : mimeType === "image/jpeg" ? ".jpg"
          : mimeType === "image/png" ? ".png"
            : mimeType === "image/webp" ? ".webp"
              : "";
  if (!ext || safe.toLowerCase().endsWith(ext)) return safe;
  return `${safe.replace(/\.[a-z0-9]+$/i, "")}${ext}`;
}

function normalizeEngineContact(raw: unknown): Contact | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<Contact> & { created_at?: number; tag_names?: string };
  const telefone = sanitizePhoneNumber(String(c.telefone ?? ""));
  if (!telefone) return null;
  const tags = Array.isArray(c.tags)
    ? c.tags.map(String).filter(Boolean)
    : c.tag_names ? c.tag_names.split(",").map((t) => t.trim()).filter(Boolean) : [];
  return {
    id: String(c.id ?? telefone),
    nome: String(c.nome ?? telefone),
    telefone,
    email: c.email,
    documento: c.documento,
    empresa: c.empresa,
    origem: c.origem,
    status: c.status ?? "novo",
    observacoes: c.observacoes,
    tags,
    customData: c.customData,
    createdAt: Number(c.createdAt ?? c.created_at ?? Date.now()),
    // Cliente da Assessoria / Lead Frio + Cadência — o backend já devolve
    // camelCase direto (ver decorateContact em whatsapp-engine/server.js).
    isClient: !!c.isClient,
    isClientSince: c.isClientSince ?? null,
    atuaMercadoFinanceiro: c.atuaMercadoFinanceiro ?? null,
    responsavelId: c.responsavelId ?? null,
    lastContactAt: c.lastContactAt ?? null,
    conversationStartedAt: c.conversationStartedAt ?? null,
    cadenceStartedAt: c.cadenceStartedAt ?? null,
    cadenceLastTouchAt: c.cadenceLastTouchAt ?? null,
    cadenceTouches: c.cadenceTouches,
    cadencePaused: !!c.cadencePaused,
    cadenceStage: c.cadenceStage ?? "NONE",
    cadenceDueAt: c.cadenceDueAt ?? null,
    cadenceOverdue: !!c.cadenceOverdue,
    deleteRequestedBy: c.deleteRequestedBy ?? null,
    deleteRequestedByName: c.deleteRequestedByName ?? null,
    deleteRequestedAt: c.deleteRequestedAt ?? null,
    hasCrmStage: !!c.hasCrmStage,
  };
}

interface EngineMessage { type: string; [k: string]: unknown }

let mockTimer: number | null = null;
let mockCampaignTimer: number | null = null;
let heartbeatTimer: number | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempts = 0;

function startMockQR() {
  const store = useAppStore.getState();
  if (store.status === "ready") return;
  store.setStatus("qr", { qr: `mock-qr-${Date.now()}` });
}
function stopMockTimers() {
  if (mockTimer) { window.clearInterval(mockTimer); mockTimer = null; }
  if (mockCampaignTimer) { window.clearInterval(mockCampaignTimer); mockCampaignTimer = null; }
}

export const engineClient = {
  ws: null as WebSocket | null,
  connect() {
    const store = useAppStore.getState();
    try {
      const ws = new WebSocket(ENGINE_WS);
      this.ws = ws;
      ws.onopen = () => {
        store.setEngineOnline(true);
        store.pushLog({ level: "info", message: "Conectado ao Sistema local (porta 8787)." });
        stopMockTimers();
        reconnectAttempts = 0;
        if (heartbeatTimer) window.clearInterval(heartbeatTimer);
        heartbeatTimer = window.setInterval(() => this.send({ type: "ping" }), 25000);
        // Bootstrap data
        api.bootstrap().catch(() => {});
      };
      ws.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data) as EngineMessage;
          // Debug: log de todas as mensagens recebidas via WebSocket
          console.log("[WS] mensagem recebida:", parsed);
          handleEngineMessage(parsed);
        } catch (err) {
          console.warn("[WS] payload inválido:", ev.data, err);
        }
      };
      ws.onerror = () => { /* handled in onclose */ };
      ws.onclose = () => {
        if (store.engineOnline && lastHealthOk !== true) {
          store.pushLog({ level: "warn", message: "Sistema local desconectado. Modo simulação ativo." });
          store.setEngineOnline(false);
        }
        this.ws = null;
        if (heartbeatTimer) { window.clearInterval(heartbeatTimer); heartbeatTimer = null; }
        if (lastHealthOk !== true) startMockMode();
        // Backoff: 2s, 4s, 8s, max 15s
        reconnectAttempts++;
        const delay = Math.min(15000, 2000 * Math.pow(1.5, Math.min(reconnectAttempts, 6)));
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(() => this.connect(), delay);
      };
    } catch {
      store.setEngineOnline(false);
      startMockMode();
    }
  },
  send(msg: EngineMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  },
};

type LogLevel = "info" | "success" | "error" | "warn";

function handleEngineMessage(msg: EngineMessage) {
  const store = useAppStore.getState();
  switch (msg.type) {
    case "hello":
    case "qr":
    case "ready":
    case "disconnected":
    case "connecting": {
      const connectionId = msg.connectionId ? String(msg.connectionId) : "default";
      // status/qr/me (singular) só refletem a conexão 'default' — compatibilidade
      // com o resto do app, que ainda assume um número só. Outras conexões
      // atualizam a lista `connections` (ver connections-changed/snapshot).
      if (connectionId === "default") {
        const status = (msg.type === "hello" ? (msg.status as string) : msg.type) as
          "qr" | "ready" | "disconnected" | "connecting";
        store.setStatus(status, { qr: msg.qr ? String(msg.qr) : undefined, me: msg.me ? String(msg.me) : undefined });
      } else {
        api.listConnections().catch(() => {});
      }
      break;
    }
    case "connections-snapshot":
      store.setConnections((msg.connections as typeof store.connections) ?? []);
      break;
    case "connections-changed":
      api.listConnections().catch(() => {});
      break;
    case "log":
      store.pushLog({
        level: (msg.level as LogLevel) ?? "info",
        message: String(msg.message ?? ""),
        contact: msg.contact ? String(msg.contact) : undefined,
        actorId: msg.actorId ? String(msg.actorId) : undefined,
        actorName: msg.actorName ? String(msg.actorName) : undefined,
      });
      break;
    case "progress":
      store.setCampaign({
        sent: Number(msg.sent ?? 0),
        failed: Number(msg.failed ?? 0),
        total: Number(msg.total ?? 0),
        currentContact: msg.currentContact ? String(msg.currentContact) : undefined,
      });
      break;
    case "campaign-end":
      store.setCampaign({ running: false, paused: false });
      store.pushLog({ level: "success", message: "Campanha finalizada." });
      break;
    case "message":
    case "nova_mensagem": {
      // Atualiza em tempo real a lista de mensagens do chat aberto
      const m = (msg.message ?? msg.data ?? msg) as ChatMessage;
      if (m && m.chat_id && m.id) {
        console.log("[WS] nova mensagem para chat", m.chat_id, m);
        store.pushMessage(m);
        // Qualificação do CRM é sempre manual (Parte B1) — só registra o
        // evento no feed de atividades, nunca move a etapa sozinho.
        if (!m.from_me) {
          const tel = String(m.chat_id).replace(/\D+/g, "");
          const contact = store.contacts.find((c) => c.telefone === tel);
          if (contact) {
            store.pushLog({ level: "info", message: `${contact.nome} respondeu`, contact: tel });
          }
        }
      }
      break;
    }
    case "conversations-changed":
      api.loadConversations().catch(() => {});
      break;
    case "message-edited": {
      const chatId = String(msg.chatId ?? "");
      const messageId = String(msg.messageId ?? "");
      if (chatId && messageId) {
        store.patchMessage(chatId, messageId, { body: String(msg.body ?? ""), edited_at: Number(msg.editedAt ?? Date.now()) });
      }
      break;
    }
    case "message-revoked": {
      const chatId = String(msg.chatId ?? "");
      const messageId = String(msg.messageId ?? "");
      if (chatId && messageId) {
        store.patchMessage(chatId, messageId, {
          revoked_at: Number(msg.revokedAt ?? Date.now()),
          revoked_by_name: msg.revokedByName ? String(msg.revokedByName) : null,
        });
      }
      break;
    }
    case "contacts-changed":
      api.loadContacts().catch(() => {});
      break;
    case "pipeline-changed":
      api.loadPipelineStages().catch(() => {});
      break;
    case "custom-fields-changed":
      api.loadCustomFields().catch(() => {});
      break;
    case "ack": {
      // Antes era um no-op — os dois tracinhos (✓✓) só atualizavam depois de
      // um reload completo da conversa, nunca em tempo real via WS.
      const chatId = String(msg.chatId ?? "");
      const messageId = String(msg.id ?? "");
      if (chatId && messageId) {
        store.patchMessage(chatId, messageId, { ack: Number(msg.ack ?? 0) });
      }
      break;
    }
    case "notification:new": {
      const n = msg.notification as AppNotification;
      useNotificationsStore.getState().pushNew(n);
      // Popup (toast) só para os dois tipos de agenda — mensagem interna é
      // frequente e não urgente, só incrementa o badge do sino (pedido
      // explícito: nunca interromper quem está atendendo cliente).
      if (n.tipo !== "MENSAGEM_INTERNA") {
        toast(n.preview || (n.tipo === "AGENDA_LEMBRETE" ? "Lembrete de agenda" : "Novo evento corporativo"), {
          action: { label: "Ver agenda", onClick: () => { window.location.href = "/agenda"; } },
        });
      }
      break;
    }
    case "agenda:event-created":
      dispatchNotificationMessage(msg);
      break;
    default:
      // Mensagens da Comunicação Interna (comms:subscribe/typing/presence/...)
      // reaproveitam esta mesma conexão WS — ver src/lib/commsSocket.ts.
      if (typeof msg.type === "string" && msg.type.startsWith("comms:")) {
        dispatchCommsMessage(msg);
      }
      break;
  }
}

// ─────────────────── REST helpers ───────────────────

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  // Usa ENGINE_HTTP como está configurado (http em dev local, https em produção).
  // NUNCA forçar downgrade para http: aqui — em produção o painel roda em HTTPS
  // (Railway) e o navegador bloqueia por mixed content qualquer fetch para http://,
  // derrubando silenciosamente todas as chamadas REST (enviar mensagem, carregar
  // conversas, etc.) mesmo com o WebSocket (wss://) aparentando estar conectado.
  const url = ENGINE_HTTP + path;
  const res = await fetch(url, {
    ...init,
    // O cookie de sessão (httpOnly) vai automaticamente em toda chamada com
    // credentials:"include" — não precisa mais montar um header manual com
    // token. Pipeline/tags/configurações anti-ban são organização pessoal por
    // usuário, e o motor precisa saber quem está perguntando pra isolar os
    // dados corretamente (ver whatsapp-engine/auth.js:sessionMiddleware).
    credentials: "include",
    headers: { "content-type": "application/json", "x-api-key": ENGINE_API_KEY, ...(init?.headers || {}) },
  });
  // Tenta parsear o JSON mesmo em caso de erro para extrair mensagem do servidor.
  let payload: unknown = null;
  try { payload = await res.json(); } catch { /* sem corpo JSON */ }
  if (!res.ok) {
    const serverMsg = (payload && typeof payload === "object"
      && (("error" in payload && (payload as { error?: string }).error)
        || ("message" in payload && (payload as { message?: string }).message))) || "";
    throw new Error(serverMsg ? String(serverMsg) : `HTTP ${res.status}`);
  }
  return payload as T;
}

export const api = {
  async bootstrap() {
    const store = useAppStore.getState();
    if (!store.engineOnline) return;
    try {
      const [contacts, tags, conversations, stages, fields, settings] = await Promise.all([
        fetchJson<unknown[]>("/contacts").catch(() => null),
        fetchJson<Tag[]>("/tags").catch(() => null),
        fetchJson<Conversation[]>("/conversations"),
        fetchJson<PipelineStage[]>("/pipeline/stages").catch(() => null),
        fetchJson<CustomField[]>("/custom-fields").catch(() => null),
        fetchJson<Partial<AntiBanSettings>>("/settings").catch(() => null),
      ]);
      if (contacts) {
        const normalized = contacts.map(normalizeEngineContact).filter(Boolean) as Contact[];
        if (normalized.length > 0 || store.contacts.length === 0) store.setContacts(normalized);
      }
      if (tags) store.setTags(tags);
      store.setConversations(conversations);
      if (stages?.length) store.setPipelineStages(stages);
      if (fields) store.setCustomFields(fields);
      if (settings) store.updateSettings(settings);
    } catch { /* ignore — modo offline */ }
  },
  async getSettings() {
    return fetchJson<Partial<AntiBanSettings>>("/settings");
  },
  async updateSettingsRemote(patch: Partial<AntiBanSettings>) {
    return fetchJson("/settings", { method: "PUT", body: JSON.stringify(patch) });
  },
  async loadPipelineStages() {
    try {
      const stages = await fetchJson<PipelineStage[]>("/pipeline/stages");
      if (stages?.length) useAppStore.getState().setPipelineStages(stages);
    } catch { /* ignore */ }
  },
  async loadCustomFields() {
    try {
      const fields = await fetchJson<CustomField[]>("/custom-fields");
      useAppStore.getState().setCustomFields(fields);
    } catch { /* ignore */ }
  },
  async moveContactStage(contactId: string, to: string) {
    try {
      await fetchJson(`/contacts/${encodeURIComponent(contactId)}/stage`, {
        method: "POST",
        body: JSON.stringify({ to }),
      });
    } catch { /* ignore — store já mudou local */ }
  },
  async loadContacts() {
    const data = await fetchJson<unknown[]>("/contacts");
    const contacts = data.map(normalizeEngineContact).filter(Boolean) as Contact[];
    const store = useAppStore.getState();
    if (contacts.length > 0 || store.contacts.length === 0) store.setContacts(contacts);
    return contacts;
  },
  async loadConversations() {
    const data = await fetchJson<Conversation[]>("/conversations");
    useAppStore.getState().setConversations(data);
  },
  /**
   * Foto de perfil real do WhatsApp, com cache no store (nunca refaz a
   * chamada pro mesmo telefone na mesma sessão — o backend já tem seu
   * próprio cache de 24h, mas isso evita bater no endpoint a cada render).
   */
  async loadAvatar(telefone: string) {
    const tel = sanitizePhoneNumber(telefone);
    if (!tel) return;
    const store = useAppStore.getState();
    if (tel in store.avatars) return;
    try {
      const resp = await fetchJson<{ path: string | null }>(`/avatars/${encodeURIComponent(tel)}`);
      store.setAvatar(tel, resp.path ?? null);
    } catch {
      store.setAvatar(tel, null);
    }
  },
  async loadMessages(chatId: string) {
    const data = await fetchJson<ChatMessage[]>(`/conversations/${encodeURIComponent(chatId)}/messages`);
    useAppStore.getState().setMessages(chatId, data);
    return data;
  },
  async markRead(chatId: string) {
    await fetchJson(`/conversations/${encodeURIComponent(chatId)}/read`, { method: "POST" });
  },
  async markUnread(chatId: string) {
    await fetchJson(`/conversations/${encodeURIComponent(chatId)}/mark-unread`, { method: "POST" });
  },
  async pinConversation(chatId: string) {
    await fetchJson(`/conversations/${encodeURIComponent(chatId)}/pin`, { method: "POST" });
  },
  async unpinConversation(chatId: string) {
    await fetchJson(`/conversations/${encodeURIComponent(chatId)}/unpin`, { method: "POST" });
  },
  async assume(chatId: string) {
    await fetchJson(`/conversations/${encodeURIComponent(chatId)}/assume`, {
      method: "POST",
      body: JSON.stringify({ assignee: "me" }),
    });
  },
  async release(chatId: string) {
    await fetchJson(`/conversations/${encodeURIComponent(chatId)}/release`, { method: "POST" });
  },
  /**
   * Inicia (ou reabre) uma conversa pelo número da empresa escolhido.
   * Se já existir uma conversa ATIVA com esse cliente (em qualquer número) e
   * `force` não for passado, o backend recusa e devolve `conflict:true` em
   * vez de criar/mover a conversa — a UI decide então se abre a existente ou
   * chama de novo com `force:true`.
   */
  async startConversation(telefone: string, nome: string, connectionId: string, force = false) {
    return fetchJson<{ conflict?: boolean; conversationId: string; receiverLast4?: string | null }>(
      "/conversations/start",
      { method: "POST", body: JSON.stringify({ telefone, nome, connectionId, force }) },
    );
  },
  /** Transfere a conversa direto pra outro colaborador (já assumida por ele). */
  async transferConversation(chatId: string, toUserId: string) {
    await fetchJson(`/conversations/${encodeURIComponent(chatId)}/transfer`, {
      method: "POST",
      body: JSON.stringify({ toUserId }),
    });
  },
  async finish(chatId: string) {
    await fetchJson(`/conversations/${encodeURIComponent(chatId)}/finish`, { method: "POST" });
  },
  async sendText(chatId: string, body: string) {
    // NUNCA sanitizar/derrubar dígitos aqui: chatId já é o JID completo da
    // conversa (ex.: "5521982818751@c.us"), construído em Atendimento.tsx.
    // Antes este método rodava sanitizePhoneNumber(chatId), que arranca o
    // sufixo "@c.us" — o resultado (só dígitos) virava tanto o parâmetro da
    // rota quanto o próprio chatId repassado ao whatsapp-web.js no servidor,
    // que exige o JID completo pra client.sendMessage(...). Isso quebrava
    // todo envio pela aba Atendimento.
    try {
      const resp = await fetchJson<{ status?: string; success?: boolean; error?: string; message?: string }>(
        `/conversations/${encodeURIComponent(chatId)}/send`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
      // Mesmo com 200, validar se o Sistema confirmou sucesso.
      const ok = resp?.status === "sucesso" || resp?.status === "success" || resp?.success === true;
      if (!ok) {
        const reason = resp?.error || resp?.message || `Status inesperado: ${resp?.status ?? "desconhecido"}`;
        useAppStore.getState().pushLog({ level: "error", message: `Falha ao enviar: ${reason}`, contact: chatId });
        throw new Error(reason);
      }
      useAppStore.getState().setEngineOnline(true);
      useAppStore.getState().setStatus("ready");
      useAppStore.getState().pushLog({ level: "success", message: "Mensagem enviada.", contact: chatId });
      return resp;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useAppStore.getState().pushLog({ level: "error", message: `Erro do Sistema: ${msg}`, contact: chatId });
      throw err;
    }
  },
  /** Edita uma mensagem já enviada por nós (WhatsApp só permite dentro de uma
   * janela curta após o envio) — reflete de verdade no WhatsApp do cliente. */
  async editMessage(messageId: string, body: string) {
    return fetchJson<{ ok: boolean }>(`/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
  },
  /** "Apagar para todos" no WhatsApp real — fail-closed no backend (ver
   * POST /messages/:id/delete-for-everyone): se o WhatsApp não confirmar que
   * a revogação-para-todos é permitida, a rota rejeita e nada muda aqui nem
   * lá. Conteúdo original nunca é apagado — só marcado revoked_at. */
  async deleteForEveryone(messageId: string) {
    return fetchJson<{ ok: boolean }>(`/messages/${encodeURIComponent(messageId)}/delete-for-everyone`, {
      method: "POST",
    });
  },
  /**
   * Envia mensagem direta para um número (rota POST /send do Sistema local).
   * Payload: { numero: "5521999999999", mensagem: "..." }
   * Sanitiza telefone, valida resposta e gera logs claros (incluindo erro de rede).
   */
  async sendToNumber(numero: string, mensagem: string, connectionId = "default") {
    const to = sanitizePhoneNumber(numero);
    const store = useAppStore.getState();
    if (!to) {
      const msg = "Número inválido (sem dígitos).";
      store.pushLog({ level: "error", message: msg, contact: numero });
      throw new Error(msg);
    }
    const url = `${ENGINE_HTTP}/send`;
    const payloadOut = { numero: to, mensagem, connectionId };
    console.log("[ENGINE] POST", url, payloadOut);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-API-Key": ENGINE_API_KEY,
        },
        body: JSON.stringify(payloadOut),
      });
    } catch (err) {
      // Erro de rede — Sistema desligado, porta bloqueada, CORS, mixed-content, etc.
      const detail = err instanceof Error ? err.message : String(err);
      const msg = `Erro de conexão com o Sistema local (${detail})`;
      console.error("[ENGINE] fetch falhou:", err);
      store.pushLog({ level: "error", message: msg, contact: to });
      try { toast.error(msg); } catch { /* ignore */ }
      throw new Error(msg);
    }
    console.log("[ENGINE] resposta HTTP", res.status, res.statusText);
    let payload: { status?: string; success?: boolean; ok?: boolean; error?: string; message?: string } | null = null;
    try { payload = await res.json(); } catch { /* sem corpo */ }
    if (!res.ok) {
      const reason = payload?.error || payload?.message || `HTTP ${res.status}`;
      store.pushLog({ level: "error", message: `Falha ao enviar: ${reason}`, contact: to });
      throw new Error(reason);
    }
    const ok = payload?.status === "sucesso" || payload?.status === "success" || payload?.success === true || payload?.ok === true;
    if (!ok) {
      const reason = payload?.error || payload?.message || `Status inesperado: ${payload?.status ?? "desconhecido"}`;
      store.pushLog({ level: "error", message: `Falha ao enviar: ${reason}`, contact: to });
      throw new Error(reason);
    }
    store.setEngineOnline(true);
    store.setStatus("ready");
    store.pushLog({ level: "success", message: "Mensagem enviada.", contact: to });
    return payload;
  },
  async sendMedia(chatId: string, file: File, caption: string, asDocument = false) {
    // Mesmo bug do sendText: chatId já é o JID completo da conversa
    // ("...@c.us") — sanitizePhoneNumber() arrancava o sufixo, quebrando
    // tanto o envio de áudio (gravação PTT) quanto de imagem/documento pela
    // aba Atendimento.
    const fd = new FormData();
    fd.append("file", file);
    fd.append("caption", caption);
    if (asDocument) fd.append("asDocument", "true");
    const url = `${ENGINE_HTTP}/conversations/${encodeURIComponent(chatId)}/send-media`;
    const res = await fetch(url, { method: "POST", body: fd, credentials: "include", headers: { "X-API-Key": ENGINE_API_KEY } });
    let payload: { ok?: boolean; status?: string; success?: boolean; error?: string; message?: string } | null = null;
    try { payload = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      const reason = payload?.error || payload?.message || `HTTP ${res.status}`;
      useAppStore.getState().pushLog({ level: "error", message: `Falha ao enviar mídia: ${reason}`, contact: chatId });
      throw new Error(reason);
    }
    // POST /conversations/:id/send-media só devolve { ok: true } (sem
    // `status`/`success`) — checar só esses dois campos fazia todo envio de
    // mídia (imagem/documento) cair no "Status inesperado: desconhecido"
    // mesmo quando o arquivo chegava certinho no WhatsApp do cliente.
    const ok = !payload || payload.ok === true || payload.status === "sucesso" || payload.status === "success" || payload.success === true;
    if (!ok) {
      const reason = payload?.error || payload?.message || `Status inesperado: ${payload?.status ?? "desconhecido"}`;
      useAppStore.getState().pushLog({ level: "error", message: `Falha ao enviar mídia: ${reason}`, contact: chatId });
      throw new Error(reason);
    }
  },
  /** Compartilha um contato (vCard nativo do WhatsApp) — opção "Contato" do menu "+". */
  async sendContact(chatId: string, nome: string, telefone: string) {
    return fetchJson(`/conversations/${encodeURIComponent(chatId)}/send-contact`, {
      method: "POST",
      body: JSON.stringify({ nome, telefone }),
    });
  },
  /** Envia mídia (imagem/áudio) direto para um número via POST /send-media.
   *  Payload JSON estrito: numero, mediaData limpo, mimeType, fileName, isAudio e mensagem. */
  async sendMediaToNumber(numero: string, media: { dataUrl?: string; file?: File; filename: string; mimetype: string }, caption?: string, connectionId = "default") {
    const to = sanitizePhoneNumber(numero);
    const store = useAppStore.getState();
    if (!to) throw new Error("Número inválido");
    const url = `${ENGINE_HTTP}/send-media`;

    // Resolver dataUrl → base64 limpo (sem prefixo "data:...;base64,")
    let dataUrl = media.dataUrl;
    let mimetype = media.mimetype;
    if (!dataUrl && media.file) {
      dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(media.file!);
      });
      mimetype = mimetype || media.file.type;
    }
    if (!dataUrl) throw new Error("Mídia ausente");
    const mimeType = normalizeMimeType(mimetype, media.filename, dataUrl);
    const mediaDataB64 = cleanBase64Payload(dataUrl);
    const isAudio = mimeType.startsWith("audio/");
    const fileName = normalizeFileName(media.filename, mimeType);

    const legenda = caption ?? "";
    const jsonPayload = {
      numero: to,
      mediaData: mediaDataB64,
      mimeType,
      fileName,
      isAudio,
      mensagem: legenda,
      connectionId,
    };
    console.log("[ENGINE] POST /send-media (json)", { ...jsonPayload, mediaData: `<${mediaDataB64.length} chars>` });

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-Key": ENGINE_API_KEY },
        body: JSON.stringify(jsonPayload),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const msg = `Erro de conexão com o Sistema local (${detail})`;
      store.pushLog({ level: "error", message: msg, contact: to });
      throw new Error(msg);
    }
    let payload: { status?: string; success?: boolean; ok?: boolean; error?: string; message?: string } | null = null;
    try { payload = await res.json(); } catch { /* sem corpo */ }

    if (!res.ok) {
      const reason = payload?.error || payload?.message || `HTTP ${res.status}`;
      store.pushLog({ level: "error", message: `Falha ao enviar mídia: ${reason}`, contact: to });
      throw new Error(reason);
    }
    store.setEngineOnline(true);
    store.setStatus("ready");
    store.pushLog({ level: "success", message: "Mídia enviada.", contact: to });
    return payload;
  },
  async createTag(nome: string, cor?: string) {
    return fetchJson<{ id: string; nome: string }>("/tags", { method: "POST", body: JSON.stringify({ nome, cor }) });
  },
  async updateTag(id: string, patch: { nome?: string; cor?: string }) {
    await fetchJson(`/tags/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  async deleteTag(id: string) { await fetchJson(`/tags/${id}`, { method: "DELETE" }); },
  async tagContacts(tagId: string, contactIds: string[]) {
    await fetchJson(`/tags/${tagId}/contacts`, { method: "POST", body: JSON.stringify({ contactIds }) });
  },
  async untagContact(tagId: string, contactId: string) {
    await fetchJson(`/tags/${tagId}/contacts/${contactId}`, { method: "DELETE" });
  },
  async pushContacts(contacts: unknown[]) {
    await fetchJson("/contacts", { method: "POST", body: JSON.stringify(contacts) });
  },
  /**
   * Persiste edição de ficha no servidor — antes desta função, `updateContact`
   * do appStore só mexia em memória/localStorage (bug real: edições nunca
   * sincronizavam entre colegas/computadores). A rota PATCH /contacts/:id já
   * existia no backend, só nunca era chamada por aqui.
   */
  async updateContact(id: string, patch: Record<string, unknown>) {
    // A rota PATCH /contacts/:id espera snake_case pros campos de cadência
    // (schema do SQLite), enquanto o resto do app usa Contact em camelCase —
    // traduz aqui pra manter os call sites (Contatos.tsx/CRM.tsx) simples.
    const body: Record<string, unknown> = { ...patch };
    if ("isClient" in body) { body.is_client = body.isClient; delete body.isClient; }
    if ("atuaMercadoFinanceiro" in body) { body.atua_mercado_financeiro = body.atuaMercadoFinanceiro; delete body.atuaMercadoFinanceiro; }
    if ("responsavelId" in body) { body.responsavel_id = body.responsavelId; delete body.responsavelId; }
    return fetchJson(`/contacts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
  },
  /**
   * Contato não pode simplesmente ser apagado por qualquer usuário — quem não
   * é Sócio só pede a exclusão (o contato continua existindo, marcado como
   * "exclusão pendente" pra todo mundo, até um Sócio aprovar/rejeitar). Sócio
   * chamando esta mesma rota apaga na hora (ele já é quem aprovaria mesmo).
   */
  async requestDeleteContact(id: string) {
    return fetchJson<{ ok: boolean; deleted?: boolean; pending?: boolean }>(
      `/contacts/${encodeURIComponent(id)}/request-delete`, { method: "POST" },
    );
  },
  async approveDeleteContact(id: string) {
    return fetchJson<{ ok: boolean }>(`/contacts/${encodeURIComponent(id)}/approve-delete`, { method: "POST" });
  },
  async rejectDeleteContact(id: string) {
    return fetchJson<{ ok: boolean }>(`/contacts/${encodeURIComponent(id)}/reject-delete`, { method: "POST" });
  },
  /** Confirma manualmente o toque do estágio de cadência atual — nunca envia
   * mensagem nenhuma, só registra que o colaborador já fez o contato pelo
   * WhatsApp de verdade. `gotResponse` só é relevante ao confirmar o D75. */
  async markCadenceTouch(id: string, gotResponse?: boolean) {
    return fetchJson<{ ok: boolean; stage: string; dueAt: number | null }>(
      `/contacts/${encodeURIComponent(id)}/cadence/touch`,
      { method: "POST", body: JSON.stringify({ gotResponse: !!gotResponse }) },
    );
  },
  async loadCadencia(tab: string, estagio?: string) {
    const qs = new URLSearchParams({ tab, ...(estagio ? { estagio } : {}) });
    const rows = await fetchJson<unknown[]>(`/cadencia?${qs.toString()}`);
    return rows.map(normalizeEngineContact).filter(Boolean) as Contact[];
  },
  async loadCadenciaConvertidos() {
    const rows = await fetchJson<unknown[]>(`/cadencia/convertidos`);
    return rows.map(normalizeEngineContact).filter(Boolean) as Contact[];
  },
  /** Lista de colaboradores para o dropdown "Responsável" — reaproveita a
   * rota de perfis já usada pela Comunicação Interna. */
  async loadProfiles() {
    return fetchJson<{ id: string; fullName: string; role: string }[]>(`/comms/profiles`);
  },
  async loadQuickReplies() {
    try {
      const data = await fetchJson<{ id: string; atalho: string; body: string; visibility?: string; created_by?: string | null; created_by_name?: string | null }[]>("/quick-replies");
      const mapped = data.map((r) => ({
        id: r.id, atalho: r.atalho, body: r.body,
        visibility: (r.visibility === "shared" ? "shared" : "personal") as "shared" | "personal",
        createdBy: r.created_by ?? null,
        createdByName: r.created_by_name ?? null,
      }));
      useAppStore.getState().setQuickReplies(mapped);
      return mapped;
    } catch { return []; }
  },
  async saveQuickReply(q: { id?: string; atalho: string; body: string; visibility?: "personal" | "shared" }) {
    await fetchJson("/quick-replies", { method: "POST", body: JSON.stringify(q) });
  },
  async deleteQuickReply(id: string) {
    await fetchJson(`/quick-replies/${id}`, { method: "DELETE" });
  },
  async fetchMetrics(days = 7) {
    return fetchJson<MetricsResponse>(`/metrics?days=${days}`);
  },
  // <img>/<audio src> não conseguem enviar headers customizados — a API key
  // vai como query string aqui (mesma chave, já exposta no bundle do frontend).
  mediaUrl(p?: string | null) {
    if (!p) return undefined;
    const sep = p.includes("?") ? "&" : "?";
    return `${ENGINE_HTTP}${p}${ENGINE_API_KEY ? `${sep}apiKey=${encodeURIComponent(ENGINE_API_KEY)}` : ""}`;
  },
  /** Arquivar conversa (item 3) — NUNCA deleta; restrito a Sócio no engine, exige justificativa. */
  async archiveConversation(chatId: string, reason: string) {
    return fetchJson(`/conversations/${encodeURIComponent(chatId)}/archive`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },
  /** Desarquivar — restrito a Sócio, mesmo padrão do archive. */
  async unarchiveConversation(chatId: string) {
    return fetchJson(`/conversations/${encodeURIComponent(chatId)}/unarchive`, { method: "POST" });
  },
  /** Busca de auditoria (Sócio) — inclui conversas arquivadas. */
  async auditSearchConversations(params: { name?: string; from?: number; to?: number; keyword?: string; archivedBy?: string }) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return fetchJson<Conversation[]>(`/audit/conversations?${qs.toString()}`);
  },
  /** Log de auditoria bruto (quem/quando/por quê de cada arquivamento) — Sócio. */
  async auditLog() {
    return fetchJson<{ id: string; ts: number; actor: string; actor_role: string; action: string; target_type: string; target_id: string; reason: string; details: string }[]>(
      `/audit/log`,
    );
  },
  // ─────────── Múltiplos números de WhatsApp ───────────
  async listConnections() {
    const list = await fetchJson<{ id: string; label: string; status: string; me?: string | null; qr?: string | null; last4?: string | null }[]>("/connections");
    useAppStore.getState().setConnections(list as never);
    return list;
  },
  /** Cadastrar um novo número — restrito a Sócio no engine. */
  async createConnection(id: string, label: string) {
    return fetchJson("/connections", { method: "POST", body: JSON.stringify({ id, label }) });
  },
  /** Remover um número (não é possível remover o "default") — restrito a Sócio. */
  async deleteConnection(id: string) {
    return fetchJson(`/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async requestQrForConnection(id: string) {
    return fetchJson(`/connections/${encodeURIComponent(id)}/request-qr`, { method: "POST" });
  },
  async logoutConnection(id: string) {
    return fetchJson(`/connections/${encodeURIComponent(id)}/logout`, { method: "POST" });
  },
  async reconnectConnection(id: string) {
    return fetchJson(`/connections/${encodeURIComponent(id)}/reconnect`, { method: "POST" });
  },
  // ─────────── Trava de disparo por número (servidor) ───────────
  /** Tenta reservar o direito de rodar uma campanha para este número. 409 se já houver uma em andamento (de qualquer usuário). */
  async lockCampaign(connectionId = "default") {
    return fetchJson<{ ok: true }>("/campaigns/lock", { method: "POST", body: JSON.stringify({ connectionId }) });
  },
  async unlockCampaign(connectionId = "default") {
    return fetchJson("/campaigns/unlock", { method: "POST", body: JSON.stringify({ connectionId }) });
  },
};

export interface MetricsResponse {
  range: { days: number; startTs: number; endTs: number };
  totals: {
    contacts: number; tags: number;
    conversations: number; pendentes: number; atendendo: number; finalizadas: number;
    sent: number; errors: number;
    successRate: number | null;
    avgFirstResponseMs: number;
    // Cliente da Assessoria / Lead Frio + Cadência de Follow-up
    clientesAssessoria: number; leadsFrios: number; semContato30d: number;
    cadenceD1: number; cadenceD3: number; cadenceD7: number; cadenceD15: number; cadenceD75: number;
    cadenceEncerrado: number; cadenciaAtiva: number;
    convertidosEsteMes: number; taxaConversao: number | null;
  };
  series: { day: string; envios: number; ts: number }[];
  funnel: { key: string; label: string; color: string; ord: number; count: number }[];
  topTags: { nome: string; cor: string; count: number }[];
}

// ─────────────────── MOCK MODE ───────────────────
function startMockMode() {
  if (MOCK_DISABLED) return;
  if (mockTimer) return;
  window.setTimeout(startMockQR, 800);
  mockTimer = window.setInterval(() => {
    const st = useAppStore.getState();
    if (st.status === "qr") startMockQR();
  }, 20000);
}

export function mockConnectWhatsApp() {
  if (MOCK_DISABLED) {
    useAppStore.getState().pushLog({
      level: "warn",
      message: "Modo simulação está desativado (VITE_DISABLE_MOCK=true). Conecte o Sistema local para usar o WhatsApp real.",
    });
    return;
  }
  const store = useAppStore.getState();
  store.setStatus("ready", { me: "Demo (modo simulação — NÃO é uma conexão real)" });
  store.pushLog({ level: "success", message: "Conexão simulada estabelecida (sem Sistema local)." });
}
export function mockDisconnect() {
  const store = useAppStore.getState();
  store.setStatus("disconnected");
  store.pushLog({ level: "warn", message: "Sessão WhatsApp encerrada." });
}

// ─────────────────── Campaigns ───────────────────
export interface CampaignParams { contactIds: string[]; templateId: string }

// Lock de nível de módulo — independente do ciclo de render do React.
// Garante que um segundo clique (ou uma segunda chamada concorrente) nunca
// inicie um segundo loop de disparo enquanto o primeiro não terminar.
let campaignLock = false;

export function isCampaignRunning(): boolean {
  return campaignLock || useAppStore.getState().campaign.running;
}

// Configurações anti-ban são pessoais por usuário — atualiza o estado local
// (feedback imediato na UI) e persiste no motor em paralelo, pra sobreviver a
// trocas de dispositivo/login (localStorage sozinho não faz isso).
export function updateAntiBanSettings(patch: Partial<AntiBanSettings>) {
  useAppStore.getState().updateSettings(patch);
  api.updateSettingsRemote(patch).catch(() => {});
}

export function startCampaign(params: CampaignParams, connectionId = "default") {
  if (isCampaignRunning()) {
    useAppStore.getState().pushLog({
      level: "warn",
      message: "Já existe uma campanha em andamento — novo disparo ignorado até a atual terminar.",
    });
    return;
  }
  // Trava local imediatamente (síncrono, antes de qualquer coisa assíncrona)
  // para que nenhuma segunda chamada concorrente NESTE MESMO navegador passe
  // pela checagem acima (ex: duplo clique). Isso sozinho NÃO impede dois
  // atendentes diferentes, cada um no seu computador — por isso a reserva no
  // servidor logo abaixo (api.lockCampaign) é o que realmente resolve isso:
  // ela é compartilhada entre todo mundo, por número (connectionId).
  campaignLock = true;

  const store = useAppStore.getState();
  const contacts = store.contacts.filter((c) => params.contactIds.includes(c.id));
  const tpl = store.templates.find((t) => t.id === params.templateId);
  if (!tpl || contacts.length === 0) {
    campaignLock = false;
    return;
  }

  api.lockCampaign(connectionId).then(() => {
    // Auto-classificação CRM: todos os contatos disparados vão para "Novo".
    for (const c of contacts) {
      if (c.status !== "novo") store.moveContactStage(c.id, "novo");
    }

    // Disparo SEMPRE sequencial pelo frontend via HTTP /send.
    // (Não delegamos mais para o WS do backend, que poderia processar em paralelo.)
    // Garante: 1 cliente por vez → todas as partes do template → delay anti-ban → próximo cliente.
    store.resetCampaign();
    store.setCampaign({ running: true, total: contacts.length, startedAt: Date.now() });
    store.pushLog({
      level: "info",
      message: `Campanha iniciada (sequencial, 1 cliente por vez): ${contacts.length} contatos. Intervalo entre clientes: ${store.settings.minDelay}–${store.settings.maxDelay}s.`,
    });
    runHttpCampaign(contacts, tpl, store.settings, connectionId).finally(() => {
      campaignLock = false;
      api.unlockCampaign(connectionId).catch(() => {});
    });
  }).catch((err) => {
    campaignLock = false;
    const reason = err instanceof Error ? err.message : "Já existe um disparo em andamento para este número (outro atendente).";
    store.pushLog({ level: "warn", message: `Disparo não iniciado: ${reason}` });
    try { toast.error(reason); } catch { /* ignore */ }
  });
  return;
}

/**
 * Loop HTTP sequencial por cliente com delays dinâmicos por parte (jitter ±20%)
 * + delay anti-ban entre clientes. Respeita pausa longa a cada N envios.
 *
 * Hierarquia:
 *   for cada CONTATO (sequencial)
 *     for cada PARTE do template
 *       - aplica delay configurado da parte (com jitter ±20%) se p > 0
 *       - aguarda success:true (await) antes de seguir
 *     - após a ÚLTIMA parte, aplica delay anti-ban global antes do próximo cliente
 */
async function runHttpCampaign(
  contacts: { id: string; nome: string; telefone: string }[],
  tpl: {
    body: string;
    multiPart?: boolean;
    parts?: { body: string; delaySeconds: number; media?: { dataUrl: string; filename: string; mimetype: string } | null }[];
    media?: { dataUrl: string; filename: string; mimetype: string } | null;
  },
  settings: { minDelay: number; maxDelay: number; longPauseEvery: number; longPauseSeconds: number },
  connectionId: string,
) {
  let sent = 0, failed = 0;
  const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
  // Jitter ±20% sobre um valor de segundos.
  const jitter = (sec: number) => {
    const base = Math.max(0, sec);
    const variation = base * 0.2;
    const val = base + (Math.random() * 2 - 1) * variation;
    return Math.max(0, val);
  };
  const parts = tpl.multiPart && tpl.parts && tpl.parts.length > 0
    ? tpl.parts
    : [{ body: tpl.body, delaySeconds: 0, media: tpl.media ?? null }];
  const totalParts = parts.length;

  for (let i = 0; i < contacts.length; i++) {
    const s0 = useAppStore.getState();
    if (!s0.campaign.running) break;
    while (useAppStore.getState().campaign.paused) await sleep(800);
    const c = contacts[i];
    s0.setCampaign({ currentContact: `${c.nome} (${c.telefone})`, sent, failed });
    s0.pushLog({ level: "info", message: `▶ Iniciando bloco para ${c.nome} (${totalParts} mensagem${totalParts > 1 ? "s" : ""})`, contact: c.telefone });

    let contactFailed = false;
    for (let p = 0; p < parts.length; p++) {
      if (!useAppStore.getState().campaign.running) { contactFailed = true; break; }
      while (useAppStore.getState().campaign.paused) await sleep(800);
      const part = parts[p];

      // Delay dinâmico antes desta parte (não na primeira) com jitter ±20%.
      if (p > 0 && part.delaySeconds > 0) {
        const wait = jitter(part.delaySeconds);
        useAppStore.getState().pushLog({
          level: "info",
          message: `⏱ Aplicando delay dinâmico de ${wait.toFixed(1)}s antes da mensagem ${p + 1}/${totalParts}…`,
          contact: c.telefone,
        });
        await sleep(wait * 1000);
      }

      const text = renderTemplate(part.body, c.nome);
      const hasText = text.trim().length > 0;
      const hasMedia = !!part.media;
      if (!hasText && !hasMedia) continue;

      useAppStore.getState().pushLog({
        level: "info",
        message: `Enviando mensagem ${p + 1}/${totalParts} para ${c.nome}…`,
        contact: c.telefone,
      });

      try {
        if (hasMedia) {
          await api.sendMediaToNumber(c.telefone, part.media!, hasText ? text : undefined, connectionId);
        } else {
          await api.sendToNumber(c.telefone, text, connectionId);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        useAppStore.getState().pushLog({
          level: "error",
          message: `Falha na mensagem ${p + 1}/${totalParts} para ${c.nome}: ${reason}. Pulando para o próximo cliente.`,
          contact: c.telefone,
        });
        contactFailed = true;
        break;
      }
    }

    if (contactFailed) failed++; else {
      sent++;
      useAppStore.getState().pushLog({ level: "success", message: `✔ Bloco concluído para ${c.nome}.`, contact: c.telefone });
    }
    useAppStore.getState().setCampaign({ sent, failed });

    // Após o ÚLTIMO contato, não aplica pausa.
    if (i === contacts.length - 1) break;

    // Pausa longa anti-ban a cada N envios.
    if (settings.longPauseEvery && (i + 1) % settings.longPauseEvery === 0) {
      useAppStore.getState().pushLog({
        level: "info",
        message: `🛡 Pausa longa anti-ban de ~${settings.longPauseSeconds}s após ${i + 1} clientes.`,
      });
      await sleep(settings.longPauseSeconds * 1000);
    } else {
      // Delay anti-ban entre clientes (intervalo aleatório dentro do range global).
      const min = Math.max(0, settings.minDelay) * 1000;
      const max = Math.max(min, settings.maxDelay * 1000);
      const wait = min + Math.random() * Math.max(0, max - min);
      useAppStore.getState().pushLog({
        level: "info",
        message: `🛡 Bloco concluído. Iniciando pausa de segurança Anti-ban de ${(wait / 1000).toFixed(1)}s antes do próximo cliente…`,
      });
      await sleep(wait);
    }
  }
  const fin = useAppStore.getState();
  fin.setCampaign({ running: false, paused: false });
  fin.pushLog({ level: "success", message: `Campanha finalizada: ${sent} enviadas, ${failed} erros.` });
}

function stopMockCampaign() {
  if (mockCampaignTimer) { window.clearTimeout(mockCampaignTimer); mockCampaignTimer = null; }
}

export function pauseCampaign() {
  engineClient.send({ type: "pause-campaign" });
  useAppStore.getState().setCampaign({ paused: true });
}
export function resumeCampaign() {
  engineClient.send({ type: "resume-campaign" });
  useAppStore.getState().setCampaign({ paused: false });
}
export function stopCampaign() {
  engineClient.send({ type: "stop-campaign" });
  stopMockCampaign();
  useAppStore.getState().setCampaign({ running: false, paused: false });
  // Não libera campaignLock aqui: o loop em runHttpCampaign ainda está rodando
  // (aguardando um sleep/parte em andamento) e só libera a trava no seu próprio
  // .finally() ao perceber `running=false` e encerrar de fato — evita que um novo
  // clique em "Iniciar" crie uma segunda campanha sobreposta à que está finalizando.
}

export function renderTemplate(body: string, nome: string): string {
  return body.replace(/\{nome\}/gi, nome);
}

let healthTimer: number | null = null;
let lastHealthOk: boolean | null = null;
let healthFailures = 0;
let lastHealthSuccessAt = 0;

async function syncSystemStatus() {
  try {
    const data = await fetchJson<{ whatsapp?: string; me?: string; qr?: string | null }>("/status");
    const whatsapp = data.whatsapp === "ready" || data.whatsapp === "qr" || data.whatsapp === "connecting"
      ? data.whatsapp
      : "disconnected";
    useAppStore.getState().setStatus(whatsapp, { me: data.me, qr: data.qr || undefined });
  } catch { /* silencioso */ }
}

/**
 * Polling silencioso de /health.
 * - Não gera toast nem log de erro (evita ruído de mixed-content HTTPS→HTTP).
 * - Atualiza `engineOnline` (isLocalConnected) automaticamente.
 * - Tenta WS quando o Sistema responde.
 */
async function pingHealth() {
  const url = `${ENGINE_HTTP}/health`;
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { method: "GET", cache: "no-store", signal: ctrl.signal });
    window.clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const store = useAppStore.getState();
    if (!store.engineOnline) {
      store.setEngineOnline(true);
      store.pushLog({ level: "success", message: "Sistema Conectado — Sistema local respondendo." });
    }
    healthFailures = 0;
    lastHealthSuccessAt = Date.now();
    void syncSystemStatus();
    if (lastHealthOk !== true) {
      console.log("[ENGINE] /health OK — Sistema Conectado");
      if (!engineClient.ws || engineClient.ws.readyState !== WebSocket.OPEN) {
        try { engineClient.connect(); } catch { /* ignore */ }
      }
    }
    lastHealthOk = true;
  } catch {
    // Falha silenciosa — sem toast, sem log visível. Apenas baixa o estado.
    healthFailures += 1;
    if (healthFailures >= 3 && Date.now() - lastHealthSuccessAt > 20000) {
      const store = useAppStore.getState();
      if (store.engineOnline) store.setEngineOnline(false);
      lastHealthOk = false;
    }
  }
}

export function useEngineBootstrap() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    engineClient.connect();
    // Polling automático e silencioso a cada 5s — zero-config e estável.
    pingHealth();
    healthTimer = window.setInterval(pingHealth, 5000);
    // Carrega o estado inicial do sino — atualizações depois disso chegam ao
    // vivo pelo WS (case "notification:new" acima), sem precisar de polling.
    useNotificationsStore.getState().load();
    return () => {
      if (healthTimer) { window.clearInterval(healthTimer); healthTimer = null; }
    };
  }, []);
}

