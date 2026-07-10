/**
 * Sino de notificações — mensagens internas não lidas + eventos de agenda.
 * Fala com /notifications e /agenda no whatsapp-engine (mesma autenticação
 * por sessão/CSRF da Comunicação Interna — ver whatsapp-engine/authz.js).
 * Realtime via o MESMO WebSocket único (ver src/lib/engine.ts, que roteia
 * `notification:*`/`agenda:event-created` para os handlers registrados aqui).
 */
import { apiFetch } from "@/lib/apiFetch";

export type NotificationType = "MENSAGEM_INTERNA" | "AGENDA_CORPORATIVA_CRIADA" | "AGENDA_LEMBRETE";

export interface AppNotification {
  id: string;
  tipo: NotificationType;
  referenciaId: string | null;
  lida: boolean;
  criadoEm: string;
  preview?: string;
  channelId?: string;
  eventStart?: string;
}

export type CalendarEventType = "PESSOAL" | "CORPORATIVO";

export interface CalendarEvent {
  id: string;
  titulo: string;
  descricao: string | null;
  dataHoraInicio: string;
  dataHoraFim: string | null;
  criadoPor: string;
  tipo: CalendarEventType;
  lembreteMinutosAntes: number;
  createdAt: string;
}

type NewNotificationHandler = (n: AppNotification) => void;
type NewEventHandler = (e: CalendarEvent) => void;

let onNewNotification: NewNotificationHandler | null = null;
let onNewEvent: NewEventHandler | null = null;

export function subscribeNotifications(handler: NewNotificationHandler) {
  onNewNotification = handler;
  return () => { if (onNewNotification === handler) onNewNotification = null; };
}

export function subscribeAgendaEvents(handler: NewEventHandler) {
  onNewEvent = handler;
  return () => { if (onNewEvent === handler) onNewEvent = null; };
}

/** Chamado por engine.ts:handleEngineMessage() para "notification:new"/"agenda:event-created". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dispatchNotificationMessage(msg: any) {
  if (msg.type === "notification:new") onNewNotification?.(msg.notification as AppNotification);
  else if (msg.type === "agenda:event-created") onNewEvent?.(msg.event as CalendarEvent);
}

export const notificationsApi = {
  async list() {
    return apiFetch<AppNotification[]>("/notifications");
  },
  async markRead(id: string) {
    return apiFetch<{ ok: boolean }>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
  },
  async markAllRead() {
    return apiFetch<{ ok: boolean }>("/notifications/read-all", { method: "POST" });
  },
};

export const agendaApi = {
  async listEvents(params: { scope: "pessoal" | "corporativo"; userId?: string; from?: string; to?: string }) {
    const qs = new URLSearchParams({ scope: params.scope });
    if (params.userId) qs.set("userId", params.userId);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    return apiFetch<CalendarEvent[]>(`/agenda/events?${qs.toString()}`);
  },
  async createEvent(input: {
    titulo: string; descricao?: string; dataHoraInicio: string; dataHoraFim?: string;
    tipo: CalendarEventType; lembreteMinutosAntes?: number;
  }) {
    return apiFetch<CalendarEvent>("/agenda/events", { method: "POST", body: JSON.stringify(input) });
  },
  async updateEvent(id: string, patch: Partial<{ titulo: string; descricao: string; dataHoraInicio: string; dataHoraFim: string | null; lembreteMinutosAntes: number }>) {
    return apiFetch<CalendarEvent>(`/agenda/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  async deleteEvent(id: string) {
    return apiFetch<{ ok: boolean }>(`/agenda/events/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};
