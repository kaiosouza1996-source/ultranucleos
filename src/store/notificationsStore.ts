import { create } from "zustand";
import { notificationsApi, type AppNotification } from "@/lib/notifications";

interface NotificationsState {
  items: AppNotification[];
  unreadCount: number;
  load: () => Promise<void>;
  pushNew: (n: AppNotification) => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  unreadCount: 0,

  load: async () => {
    try {
      const items = await notificationsApi.list();
      set({ items, unreadCount: items.filter((n) => !n.lida).length });
    } catch {
      // Postgres/Comunicação Interna pode não estar configurado neste deploy
      // — sino fica mudo em vez de quebrar o resto do app.
    }
  },

  // Push otimista ao vivo (WS) — não espera um refetch de /notifications.
  pushNew: (n) => {
    set((s) => ({ items: [n, ...s.items], unreadCount: s.unreadCount + 1 }));
  },

  markRead: async (id) => {
    const already = get().items.find((n) => n.id === id)?.lida;
    set((s) => ({
      items: s.items.map((n) => (n.id === id ? { ...n, lida: true } : n)),
      unreadCount: already ? s.unreadCount : Math.max(0, s.unreadCount - 1),
    }));
    try { await notificationsApi.markRead(id); } catch { /* otimista já refletido */ }
  },

  markAllRead: async () => {
    set((s) => ({ items: s.items.map((n) => ({ ...n, lida: true })), unreadCount: 0 }));
    try { await notificationsApi.markAllRead(); } catch { /* otimista já refletido */ }
  },
}));
