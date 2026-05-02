/**
 * Engine client — REST + WebSocket bridge to the local Node engine.
 * Includes:
 *  - automatic reconnection with exponential backoff
 *  - heartbeat (ping every 25s)
 *  - simulation fallback when the engine is offline (so the UI stays usable)
 */
import { useEffect, useRef } from "react";
import { useAppStore, type ChatMessage, type Conversation, type CustomField, type PipelineStage, type Tag } from "@/store/appStore";

// Força HTTP (sem TLS) para evitar bloqueios de certificado em localhost.
export const ENGINE_HTTP = "http://localhost:8787";
export const ENGINE_WS = "ws://localhost:8787/ws";

/**
 * Limpeza rigorosa de número: remove parênteses, espaços, traços, pontos,
 * sinais de mais e qualquer caractere não numérico — mantém apenas dígitos.
 * Ex: "+55 (21) 99999-9999" → "5521999999999"
 */
export function sanitizePhoneNumber(raw: string): string {
  return String(raw ?? "").replace(/\D+/g, "");
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
        store.pushLog({ level: "info", message: "Conectado ao motor local (porta 8787)." });
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
        if (store.engineOnline) {
          store.pushLog({ level: "warn", message: "Motor local desconectado. Modo simulação ativo." });
        }
        store.setEngineOnline(false);
        this.ws = null;
        if (heartbeatTimer) { window.clearInterval(heartbeatTimer); heartbeatTimer = null; }
        startMockMode();
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
      const status = (msg.type === "hello" ? (msg.status as string) : msg.type) as
        "qr" | "ready" | "disconnected" | "connecting";
      store.setStatus(status, { qr: msg.qr ? String(msg.qr) : undefined, me: msg.me ? String(msg.me) : undefined });
      break;
    }
    case "log":
      store.pushLog({
        level: (msg.level as LogLevel) ?? "info",
        message: String(msg.message ?? ""),
        contact: msg.contact ? String(msg.contact) : undefined,
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
      }
      break;
    }
    case "conversations-changed":
      api.loadConversations().catch(() => {});
      break;
    case "contacts-changed":
      api.loadContacts().catch(() => {});
      break;
    case "pipeline-changed":
      api.loadPipelineStages().catch(() => {});
      break;
    case "custom-fields-changed":
      api.loadCustomFields().catch(() => {});
      break;
    case "ack":
      // optional UI update — could update single message ack
      break;
  }
}

// ─────────────────── REST helpers ───────────────────

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  // Garante que sempre usamos http:// (nunca https) para o motor local.
  const url = ENGINE_HTTP.replace(/^https:/, "http:") + path;
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
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
      const [tags, conversations, stages, fields] = await Promise.all([
        fetchJson<Tag[]>("/tags"),
        fetchJson<Conversation[]>("/conversations"),
        fetchJson<PipelineStage[]>("/pipeline/stages").catch(() => null),
        fetchJson<CustomField[]>("/custom-fields").catch(() => null),
      ]);
      store.setTags(tags);
      store.setConversations(conversations);
      if (stages?.length) store.setPipelineStages(stages);
      if (fields) store.setCustomFields(fields);
    } catch { /* ignore — modo offline */ }
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
        body: JSON.stringify({ to, user: "me" }),
      });
    } catch { /* ignore — store já mudou local */ }
  },
  async loadContacts() {
    const data = await fetchJson<unknown[]>("/contacts");
    return data;
  },
  async loadConversations() {
    const data = await fetchJson<Conversation[]>("/conversations");
    useAppStore.getState().setConversations(data);
  },
  async loadMessages(chatId: string) {
    const data = await fetchJson<ChatMessage[]>(`/conversations/${encodeURIComponent(chatId)}/messages`);
    useAppStore.getState().setMessages(chatId, data);
    return data;
  },
  async markRead(chatId: string) {
    await fetchJson(`/conversations/${encodeURIComponent(chatId)}/read`, { method: "POST" });
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
  async finish(chatId: string) {
    await fetchJson(`/conversations/${encodeURIComponent(chatId)}/finish`, { method: "POST" });
  },
  async sendText(chatId: string, body: string) {
    // Sanitiza o número (mantém apenas dígitos) antes de chamar /send.
    const cleanId = sanitizePhoneNumber(chatId) || chatId;
    try {
      const resp = await fetchJson<{ status?: string; success?: boolean; error?: string; message?: string }>(
        `/conversations/${encodeURIComponent(cleanId)}/send`,
        { method: "POST", body: JSON.stringify({ body, to: cleanId }) },
      );
      // Mesmo com 200, validar se o motor confirmou sucesso.
      const ok = resp?.status === "sucesso" || resp?.status === "success" || resp?.success === true;
      if (!ok) {
        const reason = resp?.error || resp?.message || `Status inesperado: ${resp?.status ?? "desconhecido"}`;
        useAppStore.getState().pushLog({ level: "error", message: `Falha ao enviar: ${reason}`, contact: cleanId });
        throw new Error(reason);
      }
      useAppStore.getState().pushLog({ level: "success", message: "Mensagem enviada.", contact: cleanId });
      return resp;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useAppStore.getState().pushLog({ level: "error", message: `Erro do motor: ${msg}`, contact: cleanId });
      throw err;
    }
  },
  /**
   * Envia mensagem direta para um número (rota /send do motor local),
   * com sanitização do telefone e validação do status retornado.
   */
  async sendToNumber(numero: string, body: string) {
    const to = sanitizePhoneNumber(numero);
    if (!to) {
      const msg = "Número inválido (sem dígitos).";
      useAppStore.getState().pushLog({ level: "error", message: msg, contact: numero });
      throw new Error(msg);
    }
    try {
      const resp = await fetchJson<{ status?: string; success?: boolean; error?: string; message?: string }>(
        `/send`,
        { method: "POST", body: JSON.stringify({ to, body }) },
      );
      const ok = resp?.status === "sucesso" || resp?.status === "success" || resp?.success === true;
      if (!ok) {
        const reason = resp?.error || resp?.message || `Status inesperado: ${resp?.status ?? "desconhecido"}`;
        useAppStore.getState().pushLog({ level: "error", message: `Falha ao enviar: ${reason}`, contact: to });
        throw new Error(reason);
      }
      useAppStore.getState().pushLog({ level: "success", message: "Mensagem enviada.", contact: to });
      return resp;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useAppStore.getState().pushLog({ level: "error", message: `Erro do motor: ${msg}`, contact: to });
      throw err;
    }
  },
  async sendMedia(chatId: string, file: File, caption: string) {
    const cleanId = sanitizePhoneNumber(chatId) || chatId;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("caption", caption);
    const url = `${ENGINE_HTTP.replace(/^https:/, "http:")}/conversations/${encodeURIComponent(cleanId)}/send-media`;
    const res = await fetch(url, { method: "POST", body: fd });
    let payload: { status?: string; success?: boolean; error?: string; message?: string } | null = null;
    try { payload = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      const reason = payload?.error || payload?.message || `HTTP ${res.status}`;
      useAppStore.getState().pushLog({ level: "error", message: `Falha ao enviar mídia: ${reason}`, contact: cleanId });
      throw new Error(reason);
    }
    const ok = !payload || payload.status === "sucesso" || payload.status === "success" || payload.success === true;
    if (!ok) {
      const reason = payload?.error || payload?.message || `Status inesperado: ${payload?.status ?? "desconhecido"}`;
      useAppStore.getState().pushLog({ level: "error", message: `Falha ao enviar mídia: ${reason}`, contact: cleanId });
      throw new Error(reason);
    }
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
  async loadQuickReplies() {
    try {
      const data = await fetchJson<{ id: string; atalho: string; body: string }[]>("/quick-replies");
      useAppStore.getState().setQuickReplies(data as never);
      return data;
    } catch { return []; }
  },
  async saveQuickReply(q: { id?: string; atalho: string; body: string }) {
    await fetchJson("/quick-replies", { method: "POST", body: JSON.stringify(q) });
  },
  async deleteQuickReply(id: string) {
    await fetchJson(`/quick-replies/${id}`, { method: "DELETE" });
  },
  async fetchMetrics(days = 7) {
    return fetchJson<MetricsResponse>(`/metrics?days=${days}`);
  },
  mediaUrl(p?: string | null) { return p ? ENGINE_HTTP + p : undefined; },
};

export interface MetricsResponse {
  range: { days: number; startTs: number; endTs: number };
  totals: {
    contacts: number; tags: number;
    conversations: number; pendentes: number; atendendo: number; finalizadas: number;
    sent: number; errors: number;
    successRate: number | null;
    avgFirstResponseMs: number;
  };
  series: { day: string; envios: number; ts: number }[];
  funnel: { key: string; label: string; color: string; ord: number; count: number }[];
  topTags: { nome: string; cor: string; count: number }[];
}

// ─────────────────── MOCK MODE ───────────────────
function startMockMode() {
  if (mockTimer) return;
  window.setTimeout(startMockQR, 800);
  mockTimer = window.setInterval(() => {
    const st = useAppStore.getState();
    if (st.status === "qr") startMockQR();
  }, 20000);
}

export function mockConnectWhatsApp() {
  const store = useAppStore.getState();
  store.setStatus("ready", { me: "Demo (modo simulação)" });
  store.pushLog({ level: "success", message: "Conexão simulada estabelecida (sem motor local)." });
}
export function mockDisconnect() {
  const store = useAppStore.getState();
  store.setStatus("disconnected");
  store.pushLog({ level: "warn", message: "Sessão WhatsApp encerrada." });
}

// ─────────────────── Campaigns ───────────────────
export interface CampaignParams { contactIds: string[]; templateId: string }

export function startCampaign(params: CampaignParams) {
  const store = useAppStore.getState();
  const contacts = store.contacts.filter((c) => params.contactIds.includes(c.id));
  const tpl = store.templates.find((t) => t.id === params.templateId);
  if (!tpl || contacts.length === 0) return;

  if (engineClient.send({ type: "start-campaign", contacts, template: tpl, settings: store.settings })) {
    store.resetCampaign();
    store.setCampaign({ running: true, total: contacts.length, startedAt: Date.now() });
    store.pushLog({ level: "info", message: `Campanha iniciada: ${contacts.length} contatos.` });
    return;
  }

  // mock fallback
  store.resetCampaign();
  store.setCampaign({ running: true, total: contacts.length, startedAt: Date.now() });
  store.pushLog({ level: "info", message: `Campanha SIMULADA iniciada (${contacts.length} contatos).` });

  let i = 0; let sent = 0; let failed = 0;
  const tick = () => {
    const s = useAppStore.getState();
    if (!s.campaign.running) { stopMockCampaign(); return; }
    if (s.campaign.paused) { mockCampaignTimer = window.setTimeout(tick, 1000); return; }
    if (i >= contacts.length) {
      s.setCampaign({ running: false, paused: false });
      s.pushLog({ level: "success", message: `Campanha simulada finalizada: ${sent} enviadas, ${failed} erros.` });
      stopMockCampaign();
      return;
    }
    const c = contacts[i++];
    const msg = renderTemplate(tpl.body, c.nome);
    s.setCampaign({ currentContact: `${c.nome} (${c.telefone})`, sent, failed });
    s.pushLog({ level: "info", message: `Enviando para ${c.nome}…`, contact: c.telefone });
    const ok = Math.random() > 0.08;
    window.setTimeout(() => {
      if (ok) { sent++; s.pushLog({ level: "success", message: `✓ ${msg.slice(0, 40)}…`, contact: c.telefone }); }
      else { failed++; s.pushLog({ level: "error", message: `Falha ao enviar`, contact: c.telefone }); }
      s.setCampaign({ sent, failed });
    }, 600);
    const min = s.settings.minDelay * 1000;
    const max = s.settings.maxDelay * 1000;
    mockCampaignTimer = window.setTimeout(tick, min + Math.random() * (max - min));
  };
  tick();
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
}

export function renderTemplate(body: string, nome: string): string {
  return body.replace(/\{nome\}/gi, nome);
}

export function useEngineBootstrap() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    engineClient.connect();
  }, []);
}
