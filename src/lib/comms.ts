/**
 * Comunicação Interna — canais, DMs, mensagens e cards de handoff.
 * Antes: 100% em cima do Supabase (Auth+Postgres+Realtime). Agora: fala com
 * /comms/* no whatsapp-engine (comms.js), que por sua vez usa Postgres
 * self-hosted com autorização em app-layer (ver whatsapp-engine/authz.js) —
 * mesma lógica de papéis, só sem depender de nenhum serviço terceiro.
 * Realtime via WebSocket próprio — ver src/lib/commsSocket.ts.
 */
import type { UserRole } from "@/lib/authClient";
import { apiFetch, readCookie } from "@/lib/apiFetch";
import { ENGINE_HTTP, ENGINE_API_KEY } from "@/lib/engine";
import * as commsSocket from "@/lib/commsSocket";
import type { CommsSubscription, TypingHandle } from "@/lib/commsSocket";

export type { CommsSubscription, TypingHandle } from "@/lib/commsSocket";
export type ChannelVisibility = "public" | "role" | "private";

export interface Channel {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  visibility: ChannelVisibility;
  allowedRoles: UserRole[] | null;
  isDm: boolean;
  isHandoff: boolean;
  createdBy: string | null;
  createdAt: string;
  serverId: string | null;
  categoryId: string | null;
  position: number;
}

export interface Server {
  id: string;
  name: string;
  iconEmoji: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface Category {
  id: string;
  serverId: string;
  name: string;
  position: number;
  createdBy: string | null;
  createdAt: string;
}

export interface CommsMessage {
  id: string;
  channelId: string;
  authorId: string;
  body: string | null;
  isClientData: boolean;
  pinned: boolean;
  createdAt: string;
  editedAt: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
}

export type Urgencia = "baixa" | "media" | "alta";

export interface ClientDataCard {
  id: string;
  channelId: string;
  messageId: string | null;
  createdBy: string;
  clienteNome: string;
  perfil: string;
  instrumento: string;
  urgencia: Urgencia;
  telefone: string | null;
  documento: string | null;
  observacoes: string | null;
  autorizacaoExpressa: boolean;
  createdAt: string;
}

export interface Profile {
  id: string;
  fullName: string;
  role: UserRole;
}

export const comms = {
  /** Todos os colegas (nome/papel) — usado pra montar lista de membros/DM. */
  async listProfiles(): Promise<Profile[]> {
    return apiFetch("/comms/profiles");
  },

  // Só existe UM servidor nessa empresa (ver ComunicacaoInterna.tsx) — sem UI
  // pra criar/apagar servidor de propósito (evita apagar sem querer).
  async listServers(): Promise<Server[]> {
    return apiFetch("/comms/servers");
  },

  async listCategories(serverId: string): Promise<Category[]> {
    return apiFetch(`/comms/servers/${encodeURIComponent(serverId)}/categories`);
  },
  async createCategory(serverId: string, name: string): Promise<Category> {
    return apiFetch(`/comms/servers/${encodeURIComponent(serverId)}/categories`, { method: "POST", body: JSON.stringify({ name }) });
  },
  async deleteCategory(id: string) {
    await apiFetch(`/comms/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async reorderCategory(id: string, position: number) {
    await apiFetch(`/comms/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ position }) });
  },
  async renameCategory(id: string, name: string) {
    await apiFetch(`/comms/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) });
  },

  async listChannels(serverId?: string): Promise<Channel[]> {
    const qs = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
    return apiFetch(`/comms/channels${qs}`);
  },

  async reorderChannel(id: string, position: number) {
    await apiFetch(`/comms/channels/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ position }) });
  },
  async renameChannel(id: string, name: string) {
    await apiFetch(`/comms/channels/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) });
  },

  async deleteChannel(id: string) {
    await apiFetch(`/comms/channels/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async listDms(): Promise<Channel[]> {
    return apiFetch("/comms/dms");
  },

  async getOrCreateDm(otherUserId: string): Promise<string> {
    const { channelId } = await apiFetch<{ channelId: string }>("/comms/dms", { method: "POST", body: JSON.stringify({ otherUserId }) });
    return channelId;
  },

  /** Oculta uma DM só pra mim — só quem iniciou a conversa pode chamar (o
   * backend valida de novo); a outra pessoa continua vendo normalmente. */
  async hideDm(channelId: string): Promise<void> {
    await apiFetch(`/comms/channels/${encodeURIComponent(channelId)}/hide`, { method: "POST" });
  },

  async listMembers(channelId: string): Promise<string[]> {
    return apiFetch(`/comms/channels/${encodeURIComponent(channelId)}/members`);
  },

  async createChannel(input: { name: string; description?: string; serverId: string; categoryId?: string | null; visibility: ChannelVisibility; allowedRoles?: UserRole[]; memberIds?: string[] }): Promise<Channel> {
    return apiFetch("/comms/channels", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        description: input.description || null,
        serverId: input.serverId,
        categoryId: input.categoryId || null,
        visibility: input.visibility,
        allowedRoles: input.visibility === "role" ? input.allowedRoles : undefined,
        memberIds: input.memberIds,
      }),
    });
  },

  async addMember(channelId: string, userId: string) {
    await apiFetch(`/comms/channels/${encodeURIComponent(channelId)}/members`, { method: "POST", body: JSON.stringify({ userId }) });
  },

  async removeMember(channelId: string, userId: string) {
    await apiFetch(`/comms/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
  },

  async listMessages(channelId: string): Promise<CommsMessage[]> {
    return apiFetch(`/comms/channels/${encodeURIComponent(channelId)}/messages`);
  },

  async sendMessage(channelId: string, body: string, attachment?: { path: string; name: string; type: string }): Promise<CommsMessage> {
    return apiFetch(`/comms/channels/${encodeURIComponent(channelId)}/messages`, { method: "POST", body: JSON.stringify({ body, attachment }) });
  },

  async editMessage(id: string, body: string): Promise<void> {
    await apiFetch(`/comms/messages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ body }) });
  },

  async togglePin(id: string, pinned: boolean) {
    await apiFetch(`/comms/messages/${encodeURIComponent(id)}/pin`, { method: "PATCH", body: JSON.stringify({ pinned }) });
  },

  async deleteMessage(id: string) {
    await apiFetch(`/comms/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  /** Envia o arquivo para o engine (disco local, autenticado por canal) —
   * substitui o bucket privado do Supabase Storage. */
  async uploadAttachment(channelId: string, file: File): Promise<{ path: string; name: string; type: string }> {
    const fd = new FormData();
    fd.append("file", file);
    // Upload multipart chama fetch() direto (FormData não pode ir por
    // apiFetch, que força content-type: application/json) — mas isso
    // significa que precisa anexar o header CSRF manualmente, igual
    // apiFetch já faz para toda outra mutação. Sem isso, requireSession
    // rejeitava com "Token CSRF inválido ou ausente" mesmo com sessão válida.
    const csrf = readCookie("csrf");
    const res = await fetch(`${ENGINE_HTTP}/comms/channels/${encodeURIComponent(channelId)}/attachments`, {
      method: "POST",
      credentials: "include",
      headers: { "x-api-key": ENGINE_API_KEY, ...(csrf ? { "x-csrf-token": csrf } : {}) },
      body: fd,
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
    return payload;
  },

  /** Download sempre autenticado por sessão+canal no próprio engine — sem
   * necessidade de URL assinada (não há mais bucket de terceiro).
   * Precisa do ?apiKey= na própria URL (mesmo padrão de api.mediaUrl em
   * engine.ts) — sem isso, <img src=...>/abrir em nova aba batiam direto no
   * requireApiKey global (server.js) e voltavam "API key inválida ou
   * ausente", já que tag de imagem/navegação de topo não manda header
   * customizado nenhum. */
  async getAttachmentUrl(path: string): Promise<string | null> {
    if (!path) return null;
    return `${ENGINE_HTTP}/comms/attachments/${path}${ENGINE_API_KEY ? `?apiKey=${encodeURIComponent(ENGINE_API_KEY)}` : ""}`;
  },

  /** Indicador de "digitando" — broadcast efêmero, não grava nada no banco. */
  subscribeTyping(channelId: string, onTyping: (userId: string) => void): TypingHandle {
    return commsSocket.subscribeTyping(channelId, onTyping);
  },
  sendTyping(handle: TypingHandle) {
    commsSocket.sendTyping(handle.channelId);
  },

  /** Marca o canal como lido até agora (zera o badge de não lidas). */
  async markRead(channelId: string) {
    await apiFetch(`/comms/channels/${encodeURIComponent(channelId)}/read`, { method: "POST" });
  },

  async getUnreadCounts(): Promise<Record<string, number>> {
    try {
      return await apiFetch("/comms/unread-counts");
    } catch {
      return {};
    }
  },

  async listCards(channelId: string): Promise<ClientDataCard[]> {
    return apiFetch(`/comms/channels/${encodeURIComponent(channelId)}/cards`);
  },

  /** Cria o card de handoff (o backend também grava a mensagem que o representa na thread). */
  async createHandoffCard(channelId: string, input: {
    clienteNome: string; perfil: string; instrumento: string; urgencia: Urgencia;
    telefone?: string; documento?: string; observacoes?: string; autorizacaoExpressa: boolean;
  }): Promise<ClientDataCard> {
    if (!input.autorizacaoExpressa) {
      throw new Error("Autorização expressa é obrigatória para registrar dado de cliente (Seção 13 do Manual Operacional).");
    }
    return apiFetch(`/comms/channels/${encodeURIComponent(channelId)}/cards`, { method: "POST", body: JSON.stringify(input) });
  },

  /** O backend já grava auditoria automaticamente nas ações relevantes
   * (criação/exclusão de canal, pin, handoff) — mantido aqui só por
   * compatibilidade de assinatura; não precisa mais ser chamado manualmente. */
  async logAudit(_action: string, _targetType: string, _targetId: string, _details?: Record<string, unknown>) {
    // no-op — ver whatsapp-engine/comms.js:logAudit
  },

  async listAuditLog(): Promise<{ id: string; ts: string; actorName: string | null; action: string; targetType: string | null; targetId: string | null; details: unknown }[]> {
    return apiFetch("/comms/audit-log");
  },

  /** Mensagens em tempo real de um canal — chama onInsert a cada nova linha. */
  subscribeMessages(channelId: string, onInsert: (m: CommsMessage) => void, onUpdate?: (m: CommsMessage) => void): CommsSubscription {
    return commsSocket.subscribeMessages(channelId, onInsert, onUpdate);
  },

  /** Presença online — cada aba "se marca" presente; o servidor já sabe quem é pela sessão da conexão WebSocket. */
  presence: {
    join(_profile: { id: string; name: string }, onSync: (onlineIds: Set<string>) => void) {
      commsSocket.presence.join(onSync);
    },
    leave() {
      commsSocket.presence.leave();
    },
  },
};
