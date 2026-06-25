/**
 * Engine client — REST + WebSocket bridge to the local Node engine.
 * Includes:
 *  - automatic reconnection with exponential backoff
 *  - heartbeat (ping every 25s)
 *  - simulation fallback when the engine is offline (so the UI stays usable)
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppStore, type ChatMessage, type Contact, type Conversation, type CustomField, type PipelineStage, type Tag } from "@/store/appStore";

// URL do engine: usa variável de ambiente em produção, localhost em dev
export const ENGINE_HTTP = (import.meta.env.VITE_ENGINE_URL || "http://localhost:8787").replace(/\/$/, "");
export const ENGINE_WS = ENGINE_HTTP.replace(/^http/, "ws") + "/ws";

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
        // Auto-classificação CRM: ao receber a PRIMEIRA resposta de um contato
        // que está como "novo" no pipeline, move para "em-atendimento".
        if (!m.from_me) {
          const tel = String(m.chat_id).replace(/\D+/g, "");
          const contact = store.contacts.find((c) => c.telefone === tel);
          if (contact && (contact.status === "novo" || !contact.status)) {
            store.moveContactStage(contact.id, "em-atendimento");
            store.pushLog({ level: "info", message: `${contact.nome} respondeu — movido para "Em atendimento"`, contact: tel });
          }
        }
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
  // Garante que sempre usamos http:// (nunca https) para o Sistema local.
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
      const [contacts, tags, conversations, stages, fields] = await Promise.all([
        fetchJson<unknown[]>("/contacts").catch(() => null),
        fetchJson<Tag[]>("/tags"),
        fetchJson<Conversation[]>("/conversations"),
        fetchJson<PipelineStage[]>("/pipeline/stages").catch(() => null),
        fetchJson<CustomField[]>("/custom-fields").catch(() => null),
      ]);
      if (contacts) {
        const normalized = contacts.map(normalizeEngineContact).filter(Boolean) as Contact[];
        if (normalized.length > 0 || store.contacts.length === 0) store.setContacts(normalized);
      }
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
    const contacts = data.map(normalizeEngineContact).filter(Boolean) as Contact[];
    const store = useAppStore.getState();
    if (contacts.length > 0 || store.contacts.length === 0) store.setContacts(contacts);
    return contacts;
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
      // Mesmo com 200, validar se o Sistema confirmou sucesso.
      const ok = resp?.status === "sucesso" || resp?.status === "success" || resp?.success === true;
      if (!ok) {
        const reason = resp?.error || resp?.message || `Status inesperado: ${resp?.status ?? "desconhecido"}`;
        useAppStore.getState().pushLog({ level: "error", message: `Falha ao enviar: ${reason}`, contact: cleanId });
        throw new Error(reason);
      }
      useAppStore.getState().setEngineOnline(true);
      useAppStore.getState().setStatus("ready");
      useAppStore.getState().pushLog({ level: "success", message: "Mensagem enviada.", contact: cleanId });
      return resp;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useAppStore.getState().pushLog({ level: "error", message: `Erro do Sistema: ${msg}`, contact: cleanId });
      throw err;
    }
  },
  /**
   * Envia mensagem direta para um número (rota POST /send do Sistema local).
   * Payload: { numero: "5521999999999", mensagem: "..." }
   * Sanitiza telefone, valida resposta e gera logs claros (incluindo erro de rede).
   */
  async sendToNumber(numero: string, mensagem: string) {
    const to = sanitizePhoneNumber(numero);
    const store = useAppStore.getState();
    if (!to) {
      const msg = "Número inválido (sem dígitos).";
      store.pushLog({ level: "error", message: msg, contact: numero });
      throw new Error(msg);
    }
    const url = `${ENGINE_HTTP.replace(/^https:/, "http:")}/send`;
    const payloadOut = { numero: to, mensagem };
    console.log("[ENGINE] POST", url, payloadOut);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
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
  /** Envia mídia (imagem/áudio) direto para um número via POST /send-media.
   *  Payload JSON estrito: numero, mediaData limpo, mimeType, fileName, isAudio e mensagem. */
  async sendMediaToNumber(numero: string, media: { dataUrl?: string; file?: File; filename: string; mimetype: string }, caption?: string) {
    const to = sanitizePhoneNumber(numero);
    const store = useAppStore.getState();
    if (!to) throw new Error("Número inválido");
    const url = `${ENGINE_HTTP.replace(/^https:/, "http:")}/send-media`;

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
    };
    console.log("[ENGINE] POST /send-media (json)", { ...jsonPayload, mediaData: `<${mediaDataB64.length} chars>` });

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
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
   * Aplica uma etiqueta NATIVA do WhatsApp Business a um número.
   * O servidor local (whatsapp-web.js) cria a label se ainda não existir
   * e a vincula ao chat — assim ela aparece no WhatsApp do celular.
   * Endpoint esperado: POST /labels/apply  { numero, label }
   */
  async applyWhatsappLabel(numero: string, label: string) {
    const to = sanitizePhoneNumber(numero);
    if (!to) throw new Error("Número inválido");
    if (!label?.trim()) throw new Error("Label vazia");
    const url = `${ENGINE_HTTP.replace(/^https:/, "http:")}/labels/apply`;
    const res = await fetch(url, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ numero: to, label: label.trim() }),
    });
    let payload: { status?: string; success?: boolean; ok?: boolean; error?: string; message?: string } | null = null;
    try { payload = await res.json(); } catch { /* sem corpo */ }
    if (!res.ok) {
      const reason = payload?.error || payload?.message || `HTTP ${res.status}`;
      throw new Error(reason);
    }
    const ok = !payload || payload.status === "sucesso" || payload.status === "success" || payload.success === true || payload.ok === true;
    if (!ok) {
      const reason = payload?.error || payload?.message || `Status inesperado: ${payload?.status ?? "desconhecido"}`;
      throw new Error(reason);
    }
    return payload;
  },
  /** Aplica a mesma label em massa, sequencialmente, com pequeno delay anti-ban. */
  async applyWhatsappLabelBulk(numeros: string[], label: string, opts?: { delayMs?: number; onProgress?: (done: number, total: number, ok: boolean, num: string) => void }) {
    const delay = opts?.delayMs ?? 600;
    let okCount = 0; let failCount = 0;
    for (let i = 0; i < numeros.length; i++) {
      const n = numeros[i];
      try {
        await api.applyWhatsappLabel(n, label);
        okCount++;
        opts?.onProgress?.(i + 1, numeros.length, true, n);
      } catch (e) {
        failCount++;
        useAppStore.getState().pushLog({ level: "error", message: `Falha ao aplicar etiqueta "${label}": ${(e as Error).message}`, contact: n });
        opts?.onProgress?.(i + 1, numeros.length, false, n);
      }
      if (i < numeros.length - 1) await new Promise((r) => setTimeout(r, delay));
    }
    return { ok: okCount, fail: failCount };
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
  store.pushLog({ level: "success", message: "Conexão simulada estabelecida (sem Sistema local)." });
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
  runHttpCampaign(contacts, tpl, store.settings);
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
          await api.sendMediaToNumber(c.telefone, part.media!, hasText ? text : undefined);
        } else {
          await api.sendToNumber(c.telefone, text);
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
  const url = `${ENGINE_HTTP.replace(/^https:/, "http:")}/health`;
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
    return () => {
      if (healthTimer) { window.clearInterval(healthTimer); healthTimer = null; }
    };
  }, []);
}

