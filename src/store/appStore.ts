import { create } from "zustand";

export type ConnectionStatus = "disconnected" | "connecting" | "qr" | "ready";

export interface Contact {
  id: string;
  nome: string;
  telefone: string;
  email?: string;
  documento?: string;
  empresa?: string;
  origem?: string;
  status?: string; // pipeline CRM
  observacoes?: string;
  tags: string[];      // múltiplas tags
  customData?: Record<string, string | number | boolean>;
  createdAt: number;
}

export interface Tag {
  id: string;
  nome: string;
  cor: string;
  contact_count?: number;
}

export interface Template {
  id: string;
  name: string;
  tag: string;
  body: string;
  updatedAt: number;
}

export interface QuickReply {
  id: string;
  atalho: string;
  body: string;
}

// ─────────────── CRM: pipeline customizável ───────────────
export interface PipelineStage {
  key: string;
  label: string;
  color: string;
  order: number;
  terminal?: boolean; // marca conversa como finalizada ao mover
}

export type CustomFieldType = "text" | "number" | "date" | "select" | "checkbox";
export interface CustomField {
  id: string;
  key: string;        // chave usada em contact.customData
  label: string;
  type: CustomFieldType;
  options?: string[]; // para "select"
  required?: boolean;
}

export interface PipelineEvent {
  id: string;
  contactId: string;
  from: string | null;
  to: string;
  ts: number;
  user: string;
}

export interface LogEntry {
  id: string;
  ts: number;
  level: "info" | "success" | "error" | "warn";
  message: string;
  contact?: string;
}

export interface CampaignState {
  running: boolean;
  paused: boolean;
  total: number;
  sent: number;
  failed: number;
  currentContact?: string;
  startedAt?: number;
}

export interface AntiBanSettings {
  minDelay: number;
  maxDelay: number;
  perRunLimit: number;
  perDayLimit: number;
  avoidDuplicates: boolean;
  longPauseEvery: number;
  longPauseSeconds: number;
}

export type ConvStatus = "pendente" | "atendendo" | "finalizado";

export interface Conversation {
  id: string;            // chatId
  telefone: string;
  nome: string;
  last_message: string;
  last_ts: number;
  unread: number;
  status: ConvStatus;
  assignee?: string | null;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  ts: number;
  from_me: number;        // 0 / 1
  body: string;
  type: "text" | "image" | "audio" | "video" | "document" | "sticker" | string;
  media_path?: string | null;
  media_mime?: string | null;
  ack: number;
}

interface AppState {
  engineOnline: boolean;
  setEngineOnline: (v: boolean) => void;

  status: ConnectionStatus;
  qr?: string;
  me?: string;
  setStatus: (s: ConnectionStatus, extras?: { qr?: string; me?: string }) => void;

  contacts: Contact[];
  setContacts: (c: Contact[]) => void;
  addContacts: (c: Contact[]) => void;
  removeContact: (id: string) => void;
  updateContact: (id: string, patch: Partial<Contact>) => void;

  tags: Tag[];
  setTags: (t: Tag[]) => void;

  templates: Template[];
  setTemplates: (t: Template[]) => void;
  upsertTemplate: (t: Template) => void;
  removeTemplate: (id: string) => void;

  quickReplies: QuickReply[];
  setQuickReplies: (q: QuickReply[]) => void;

  conversations: Conversation[];
  setConversations: (c: Conversation[]) => void;

  messagesByChat: Record<string, ChatMessage[]>;
  setMessages: (chatId: string, msgs: ChatMessage[]) => void;
  pushMessage: (m: ChatMessage) => void;

  logs: LogEntry[];
  pushLog: (l: Omit<LogEntry, "id" | "ts"> & { ts?: number }) => void;
  clearLogs: () => void;

  campaign: CampaignState;
  setCampaign: (c: Partial<CampaignState>) => void;
  resetCampaign: () => void;

  settings: AntiBanSettings;
  updateSettings: (s: Partial<AntiBanSettings>) => void;

  // ─────────── CRM ───────────
  pipelineStages: PipelineStage[];
  setPipelineStages: (s: PipelineStage[]) => void;
  upsertStage: (s: PipelineStage) => void;
  removeStage: (key: string) => void;

  customFields: CustomField[];
  setCustomFields: (f: CustomField[]) => void;
  upsertCustomField: (f: CustomField) => void;
  removeCustomField: (id: string) => void;

  pipelineHistory: PipelineEvent[];
  pushPipelineEvent: (e: PipelineEvent) => void;
  moveContactStage: (contactId: string, toKey: string) => void;
}

const STORAGE_KEY = "wa-sender-state-v2";

const defaultSettings: AntiBanSettings = {
  minDelay: 5,
  maxDelay: 15,
  perRunLimit: 100,
  perDayLimit: 300,
  avoidDuplicates: true,
  longPauseEvery: 25,
  longPauseSeconds: 90,
};

interface Persisted {
  contacts: Contact[];
  templates: Template[];
  tags: Tag[];
  logs?: LogEntry[];
  conversations?: Conversation[];
  settings: AntiBanSettings;
  pipelineStages?: PipelineStage[];
  customFields?: CustomField[];
  pipelineHistory?: PipelineEvent[];
}

const defaultStages: PipelineStage[] = [
  { key: "novo",            label: "Novo",            color: "213 100% 60%", order: 0 },
  { key: "em-atendimento",  label: "Em atendimento",  color: "38 95% 55%",   order: 1 },
  { key: "qualificado",     label: "Qualificado",     color: "263 80% 65%",  order: 2 },
  { key: "proposta",        label: "Proposta",        color: "189 90% 55%",  order: 3 },
  { key: "fechado",         label: "Fechado",         color: "142 70% 45%",  order: 4, terminal: true },
  { key: "perdido",         label: "Perdido",         color: "0 75% 58%",    order: 5, terminal: true },
];

const seedTemplates = (): Template[] => [
  {
    id: crypto.randomUUID(),
    name: "Boas-vindas",
    tag: "lead",
    body: "Olá {nome}! Tudo bem? Passando para apresentar nossa solução. Posso te enviar mais detalhes?",
    updatedAt: Date.now(),
  },
  {
    id: crypto.randomUUID(),
    name: "Reativação cliente",
    tag: "cliente",
    body: "Oi {nome}, faz um tempo que não falamos! Temos uma novidade que pode te interessar. 🚀",
    updatedAt: Date.now(),
  },
];

const loadPersisted = (): Persisted => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {
      contacts: [], templates: seedTemplates(), tags: [], settings: defaultSettings,
      pipelineStages: defaultStages, customFields: [], pipelineHistory: [],
    };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const contacts = (parsed.contacts ?? []).map((c) => {
      const anyC = c as Contact & { tag?: string };
      if (!Array.isArray(anyC.tags)) anyC.tags = anyC.tag ? [anyC.tag] : [];
      return anyC as Contact;
    });
    return {
      contacts,
      templates: parsed.templates ?? seedTemplates(),
      tags: parsed.tags ?? [],
      logs: parsed.logs ?? [],
      conversations: parsed.conversations ?? [],
      settings: { ...defaultSettings, ...(parsed.settings ?? {}) },
      pipelineStages: parsed.pipelineStages?.length ? parsed.pipelineStages : defaultStages,
      customFields: parsed.customFields ?? [],
      pipelineHistory: parsed.pipelineHistory ?? [],
    };
  } catch {
    return {
      contacts: [], templates: seedTemplates(), tags: [], settings: defaultSettings,
      pipelineStages: defaultStages, customFields: [], pipelineHistory: [],
    };
  }
};

const persist = (s: AppState) => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        contacts: s.contacts, templates: s.templates, tags: s.tags, logs: s.logs.slice(0, 2000), conversations: s.conversations,
        settings: s.settings,
        pipelineStages: s.pipelineStages, customFields: s.customFields,
        pipelineHistory: s.pipelineHistory.slice(0, 1000),
      } satisfies Persisted),
    );
  } catch { /* ignore */ }
};

export const useAppStore = create<AppState>((set, get) => {
  const initial = loadPersisted();
  return {
    engineOnline: false,
    setEngineOnline: (v) => set({ engineOnline: v }),

    status: "disconnected",
    qr: undefined,
    me: undefined,
    setStatus: (s, extras) => set({ status: s, qr: extras?.qr, me: extras?.me ?? get().me }),

    contacts: initial.contacts,
    setContacts: (c) => { set({ contacts: c }); persist({ ...get(), contacts: c }); },
    addContacts: (c) => {
      const map = new Map(get().contacts.map((x) => [x.telefone, x]));
      for (const n of c) {
        const prev = map.get(n.telefone);
        const merged: Contact = prev
          ? { ...prev, ...n, tags: Array.from(new Set([...(prev.tags || []), ...(n.tags || [])])) }
          : { ...n, tags: n.tags || [] };
        map.set(n.telefone, merged);
      }
      const next = [...map.values()];
      set({ contacts: next }); persist({ ...get(), contacts: next });
    },
    removeContact: (id) => {
      const next = get().contacts.filter((c) => c.id !== id);
      set({ contacts: next }); persist({ ...get(), contacts: next });
    },
    updateContact: (id, patch) => {
      const next = get().contacts.map((c) => c.id === id ? { ...c, ...patch } : c);
      set({ contacts: next }); persist({ ...get(), contacts: next });
    },

    tags: initial.tags,
    setTags: (t) => { set({ tags: t }); persist({ ...get(), tags: t }); },

    templates: initial.templates,
    setTemplates: (t) => { set({ templates: t }); persist({ ...get(), templates: t }); },
    upsertTemplate: (t) => {
      const exists = get().templates.find((x) => x.id === t.id);
      const next = exists
        ? get().templates.map((x) => (x.id === t.id ? t : x))
        : [...get().templates, t];
      set({ templates: next }); persist({ ...get(), templates: next });
    },
    removeTemplate: (id) => {
      const next = get().templates.filter((t) => t.id !== id);
      set({ templates: next }); persist({ ...get(), templates: next });
    },

    quickReplies: [],
    setQuickReplies: (q) => set({ quickReplies: q }),

    conversations: [],
    setConversations: (c) => set({ conversations: c }),

    messagesByChat: {},
    setMessages: (chatId, msgs) => set((st) => ({ messagesByChat: { ...st.messagesByChat, [chatId]: msgs } })),
    pushMessage: (m) => set((st) => {
      const list = st.messagesByChat[m.chat_id] || [];
      if (list.some((x) => x.id === m.id)) return {};
      return { messagesByChat: { ...st.messagesByChat, [m.chat_id]: [...list, m] } };
    }),

    logs: initial.logs ?? [],
    pushLog: (l) => {
      const next = [{ id: crypto.randomUUID(), ts: l.ts ?? Date.now(), level: l.level, message: l.message, contact: l.contact }, ...get().logs].slice(0, 2000);
      set({ logs: next });
      persist({ ...get(), logs: next });
    },
    clearLogs: () => { set({ logs: [] }); persist({ ...get(), logs: [] }); },

    campaign: { running: false, paused: false, total: 0, sent: 0, failed: 0 },
    setCampaign: (c) => set((st) => ({ campaign: { ...st.campaign, ...c } })),
    resetCampaign: () => set({ campaign: { running: false, paused: false, total: 0, sent: 0, failed: 0 } }),

    settings: initial.settings,
    updateSettings: (s) => {
      const next = { ...get().settings, ...s };
      set({ settings: next }); persist({ ...get(), settings: next });
    },

    // ─────────── CRM ───────────
    pipelineStages: initial.pipelineStages ?? defaultStages,
    setPipelineStages: (stages) => {
      const sorted = [...stages].sort((a, b) => a.order - b.order);
      set({ pipelineStages: sorted });
      persist({ ...get(), pipelineStages: sorted });
    },
    upsertStage: (stage) => {
      const list = get().pipelineStages;
      const exists = list.find((s) => s.key === stage.key);
      const next = exists
        ? list.map((s) => (s.key === stage.key ? stage : s))
        : [...list, stage];
      const sorted = next.sort((a, b) => a.order - b.order);
      set({ pipelineStages: sorted });
      persist({ ...get(), pipelineStages: sorted });
    },
    removeStage: (key) => {
      const next = get().pipelineStages.filter((s) => s.key !== key);
      // contatos órfãos voltam pra primeira coluna
      const fallback = next[0]?.key ?? "novo";
      const contacts = get().contacts.map((c) => c.status === key ? { ...c, status: fallback } : c);
      set({ pipelineStages: next, contacts });
      persist({ ...get(), pipelineStages: next, contacts });
    },

    customFields: initial.customFields ?? [],
    setCustomFields: (f) => { set({ customFields: f }); persist({ ...get(), customFields: f }); },
    upsertCustomField: (f) => {
      const list = get().customFields;
      const exists = list.find((x) => x.id === f.id);
      const next = exists ? list.map((x) => (x.id === f.id ? f : x)) : [...list, f];
      set({ customFields: next });
      persist({ ...get(), customFields: next });
    },
    removeCustomField: (id) => {
      const next = get().customFields.filter((f) => f.id !== id);
      set({ customFields: next });
      persist({ ...get(), customFields: next });
    },

    pipelineHistory: initial.pipelineHistory ?? [],
    pushPipelineEvent: (e) => {
      const next = [e, ...get().pipelineHistory].slice(0, 1000);
      set({ pipelineHistory: next });
      persist({ ...get(), pipelineHistory: next });
    },
    moveContactStage: (contactId, toKey) => {
      const contact = get().contacts.find((c) => c.id === contactId);
      if (!contact) return;
      const from = contact.status ?? null;
      if (from === toKey) return;
      const event: PipelineEvent = {
        id: crypto.randomUUID(),
        contactId,
        from,
        to: toKey,
        ts: Date.now(),
        user: "me",
      };
      const contacts = get().contacts.map((c) => c.id === contactId ? { ...c, status: toKey } : c);
      const history = [event, ...get().pipelineHistory].slice(0, 1000);
      set({ contacts, pipelineHistory: history });
      persist({ ...get(), contacts, pipelineHistory: history });
    },
  };
});
