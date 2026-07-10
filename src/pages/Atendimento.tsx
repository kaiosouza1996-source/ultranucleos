import { AppHeader } from "@/components/AppHeader";
import { GradientDivider } from "@/components/GradientDivider";
import { Button } from "@/components/ui/button";
import { useAppStore, type Conversation, type ChatMessage, type Contact, type QuickReply } from "@/store/appStore";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/engine";
import { Inbox, MessageSquareText, Send, ArrowRightLeft, CheckCheck, Check, User, Search, Image as ImageIcon, FileText, Mic, ArrowLeft, Zap, Plus, X, Archive, Pencil, Trash2, Ban, Smile, Users2, IdCard, Circle, Pin, PinOff, EyeOff } from "lucide-react";
import { EmojiPicker } from "@/components/EmojiPicker";
import { ContactAvatar } from "@/components/ContactAvatar";
import { ContactFormDialog } from "@/components/ContactFormDialog";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { MediaAttachment } from "@/components/MediaAttachment";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { funis as funisApi, type Funil, DEFAULT_FUNIL_ID } from "@/lib/funis";
import { Input } from "@/components/ui/input";
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone";
import { toast } from "sonner";
import { useAuthStore } from "@/store/authStore";

type Tab = "meus" | "nao_lidas" | "pendentes";
const VALID_TABS: Tab[] = ["meus", "nao_lidas", "pendentes"];

export default function Atendimento() {
  const conversations = useAppStore((s) => s.conversations);
  const messagesByChat = useAppStore((s) => s.messagesByChat);
  const engineOnline = useAppStore((s) => s.engineOnline);
  const contacts = useAppStore((s) => s.contacts);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTabState] = useState<Tab>(
    initialTab && VALID_TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "meus",
  );
  const setTab = (t: Tab) => {
    setTabState(t);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("tab", t); return next; }, { replace: true });
  };
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newChat, setNewChat] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const connections = useAppStore((s) => s.connections);
  const [numberPicker, setNumberPicker] = useState<{ telefone: string; nome: string } | null>(null);
  const [duplicateAlert, setDuplicateAlert] = useState<{
    telefone: string; nome: string; connectionId: string; conversationId: string; receiverLast4: string | null;
  } | null>(null);

  // Efetivamente cria/reabre a conversa pelo número escolhido — chamado só
  // depois que já sabemos qual connectionId usar (direto, se só há um número
  // pronto, ou depois da escolha no NumberSelectDialog).
  const doStartConversation = async (telefone: string, nome: string, connectionId: string, force = false) => {
    try {
      const resp = await api.startConversation(telefone, nome, connectionId, force);
      if (resp.conflict) {
        setDuplicateAlert({ telefone, nome, connectionId, conversationId: resp.conversationId, receiverLast4: resp.receiverLast4 ?? null });
        return;
      }
      await api.loadConversations();
      setTab("meus");
      setActiveId(resp.conversationId);
      setNewChat(false);
      setNumberPicker(null);
      setDuplicateAlert(null);
    } catch (e) {
      toast.error((e as Error).message || "Falha ao iniciar conversa");
    }
  };

  // Ponto de entrada único pra "iniciar conversa" (diálogo Nova conversa e
  // deep-link a partir de Contatos): com só 1 número pronto, pula direto pra
  // doStartConversation; com 2+, abre o modal de escolha primeiro.
  const requestStartConversation = (telefone: string, nome: string) => {
    const tel = normalizePhone(telefone);
    if (!tel) { toast.error("Telefone inválido"); return; }
    const ready = connections.filter((c) => c.status === "ready");
    if (ready.length <= 1) {
      void doStartConversation(tel, nome, ready[0]?.id || "default");
    } else {
      setNumberPicker({ telefone: tel, nome });
    }
  };

  // Deep-link a partir de Contatos ("enviar mensagem") — abre/inicia direto
  // a conversa com esse telefone/nome, sem precisar passar pelo diálogo
  // "Nova conversa" de novo.
  useEffect(() => {
    const startChat = searchParams.get("startChat");
    if (!startChat) return;
    const startName = searchParams.get("startName") || startChat;
    requestStartConversation(startChat, startName);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("startChat"); next.delete("startName");
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (engineOnline) {
      api.loadConversations().catch(() => {});
      api.loadQuickReplies().catch(() => {});
      api.listConnections().catch(() => {});
    }
  }, [engineOnline]);

  // Busca por nome, número, conteúdo da última mensagem ou tag (com ou sem #).
  const list = useMemo(() => {
    const raw = search.toLowerCase().trim();
    const q = raw.startsWith("#") ? raw.slice(1) : raw;
    const filtered = conversations.filter((c) => {
      if (tab === "pendentes") return c.status === "pendente";
      // "Não lidas" é um recorte de "Atendimento" (conversas já assumidas
      // que ainda não foram abertas, ou foram marcadas como não lida) — não
      // mistura com Pendentes, que já é uma fila separada por natureza.
      if (tab === "nao_lidas") return c.status === "atendendo" && c.unread > 0;
      return c.status === "atendendo";
    }).filter((c) => {
      if (!q) return true;
      const ct = contacts.find((x) => x.telefone === c.telefone);
      const tagMatch = ct?.tags?.some((t) => t.toLowerCase().includes(q));
      return c.nome.toLowerCase().includes(q)
        || (ct?.nome ?? "").toLowerCase().includes(q)
        || c.telefone.includes(q)
        || (c.last_message || "").toLowerCase().includes(q)
        || !!tagMatch;
    });
    // Fixadas sempre primeiro (fixação mais recente no topo); entre as não
    // fixadas, não lidas sobem pro topo; dentro de cada grupo, mais recente
    // primeiro.
    return filtered.sort((a, b) => {
      const pinnedA = a.pinned_at ?? 0;
      const pinnedB = b.pinned_at ?? 0;
      if (pinnedA !== pinnedB) return pinnedB - pinnedA;
      if (!pinnedA) {
        const unreadA = a.unread > 0 ? 1 : 0;
        const unreadB = b.unread > 0 ? 1 : 0;
        if (unreadA !== unreadB) return unreadB - unreadA;
      }
      return b.last_ts - a.last_ts;
    });
  }, [conversations, tab, search, contacts]);

  const active = conversations.find((c) => c.id === activeId) || null;
  const messages = activeId ? (messagesByChat[activeId] || []) : [];
  const activeContact = active ? contacts.find((c) => c.telefone === active.telefone) : null;

  const markUnread = async (c: Conversation) => {
    setContextMenu(null);
    try { await api.markUnread(c.id); } catch (e) { toast.error((e as Error).message); }
  };
  const togglePin = async (c: Conversation) => {
    setContextMenu(null);
    try {
      if (c.pinned_at) await api.unpinConversation(c.id);
      else await api.pinConversation(c.id);
    } catch (e) { toast.error((e as Error).message); }
  };

  // Nome exibido SEMPRE prefere o contato salvo em Contatos — o nome gravado
  // na própria conversa (conversations.nome) fica preso no número puro
  // quando ela nasce de um envio nosso (handleOutgoingMirror manda nome:null
  // pro servidor), então sem isso a lista/atendimento mostrava só o telefone
  // mesmo com o contato já cadastrado.
  const displayName = (c: Conversation) => contacts.find((x) => x.telefone === c.telefone)?.nome || c.nome;

  const open = async (c: Conversation) => {
    setActiveId(c.id);
    if (engineOnline) {
      try { await api.loadMessages(c.id); await api.markRead(c.id); } catch { /* ignore */ }
    }
  };

  return (
    <>
      <AppHeader title="Atendimento" subtitle="Central de conversas estilo WhatsApp" />

      <div className="grid lg:grid-cols-[340px_1fr] gap-4 h-[calc(100vh-180px)]">
        {/* Coluna esquerda */}
        <div className={`glass-card p-3 flex flex-col min-h-0 ${active ? "hidden lg:flex" : ""}`}>
          <div className="flex gap-1 p-1 rounded-lg bg-muted/30 mb-2">
            <TabBtn active={tab === "meus"} onClick={() => setTab("meus")} icon={MessageSquareText}
              count={conversations.filter((c) => c.status === "atendendo").length}>Atendimento</TabBtn>
            <TabBtn active={tab === "nao_lidas"} onClick={() => setTab("nao_lidas")} icon={Circle}
              count={conversations.filter((c) => c.status === "atendendo" && c.unread > 0).length}>Não lidas</TabBtn>
            <TabBtn active={tab === "pendentes"} onClick={() => setTab("pendentes")} icon={Inbox}
              count={conversations.filter((c) => c.status === "pendente").length}>Pendentes</TabBtn>
          </div>
          <Button size="sm" className="btn-glow w-full mb-2" onClick={() => setNewChat(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Nova conversa
          </Button>

          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8 h-8 bg-input/60 text-sm" placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin space-y-1">
            {list.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-12">
                {!engineOnline ? "Inicie o Sistema local para receber mensagens." : "Nenhuma conversa aqui."}
              </div>
            )}
            {list.map((c) => (
              <button
                key={c.id}
                onClick={() => open(c)}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ id: c.id, x: e.clientX, y: e.clientY }); }}
                className={`w-full text-left p-3 rounded-lg transition-all border
                  ${activeId === c.id ? "bg-primary/15 border-primary/40" : "border-transparent hover:bg-primary/5"}`}
              >
                <div className="flex items-start gap-2">
                  <ContactAvatar telefone={c.telefone} nome={displayName(c)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 min-w-0">
                        {!!c.pinned_at && <Pin className="w-3 h-3 text-primary shrink-0" />}
                        <div className="text-sm font-medium truncate">{displayName(c)}</div>
                      </div>
                      <div className="text-[10px] text-muted-foreground shrink-0">
                        {relTime(c.last_ts)}{c.receiverLast4 ? ` · ${c.receiverLast4}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <div className="text-xs text-muted-foreground truncate">{c.last_message || "—"}</div>
                      {c.unread > 0 && (
                        <span className="badge-pending text-[10px] rounded-full px-1.5 py-0.5 font-semibold shrink-0">{c.unread}</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {contextMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
            <div
              className="fixed z-50 w-56 rounded-xl border border-border bg-card/95 backdrop-blur shadow-elegant overflow-hidden animate-scale-in"
              style={{ top: contextMenu.y, left: contextMenu.x }}
            >
              {(() => {
                const c = conversations.find((x) => x.id === contextMenu.id);
                if (!c) return null;
                return (
                  <>
                    <button onClick={() => markUnread(c)} className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10 border-b border-border">
                      <EyeOff className="w-4 h-4 text-primary" /> Marcar como não lida
                    </button>
                    <button onClick={() => togglePin(c)} className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10">
                      {c.pinned_at ? <><PinOff className="w-4 h-4 text-primary" /> Desafixar conversa</> : <><Pin className="w-4 h-4 text-primary" /> Fixar conversa</>}
                    </button>
                  </>
                );
              })()}
            </div>
          </>
        )}

        {/* Coluna direita: conversa */}
        <div className={`glass-card flex flex-col min-h-0 ${active ? "" : "hidden lg:flex"}`}>
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              <div className="text-center">
                <MessageSquareText className="w-12 h-12 mx-auto opacity-40 mb-2" />
                Selecione uma conversa para começar.
              </div>
            </div>
          ) : (
            <ChatView active={active} messages={messages} onClose={() => setActiveId(null)} contactTags={activeContact?.tags || []} contactName={activeContact?.nome || active.nome} contact={activeContact || null} />
          )}
        </div>
      </div>

      {newChat && (
        <NewChatDialog contacts={contacts} onClose={() => setNewChat(false)} onPick={requestStartConversation} />
      )}

      {numberPicker && (
        <NumberSelectDialog
          connections={connections}
          onClose={() => setNumberPicker(null)}
          onPick={(connectionId) => void doStartConversation(numberPicker.telefone, numberPicker.nome, connectionId)}
        />
      )}

      {duplicateAlert && (
        <DuplicateConversationDialog
          receiverLast4={duplicateAlert.receiverLast4}
          onClose={() => setDuplicateAlert(null)}
          onOpenExisting={() => {
            setTab("meus");
            setActiveId(duplicateAlert.conversationId);
            setNewChat(false);
            setNumberPicker(null);
            setDuplicateAlert(null);
          }}
          onStartAnyway={() => void doStartConversation(duplicateAlert.telefone, duplicateAlert.nome, duplicateAlert.connectionId, true)}
        />
      )}
    </>
  );
}

function NewChatDialog({ contacts, onClose, onPick }: {
  contacts: { id: string; nome: string; telefone: string }[];
  onClose: () => void;
  onPick: (telefone: string, nome: string) => void;
}) {
  const [q, setQ] = useState("");
  const [manual, setManual] = useState({ nome: "", telefone: "" });
  const filtered = contacts
    .filter((c) => !q || c.nome.toLowerCase().includes(q.toLowerCase()) || c.telefone.includes(q))
    .slice(0, 50);

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-md w-full p-5 animate-scale-in max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Nova conversa</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <Input className="mb-2 bg-input/60" placeholder="Buscar contato existente…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex-1 overflow-y-auto scrollbar-thin border border-border rounded-lg mb-3">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">Nenhum contato encontrado.</p>
          ) : filtered.map((c) => (
            <button key={c.id} onClick={() => onPick(c.telefone, c.nome)}
              className="w-full text-left px-3 py-2 hover:bg-primary/10 border-b border-border last:border-b-0">
              <div className="text-sm font-medium truncate">{c.nome}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{formatPhoneDisplay(c.telefone)}</div>
            </button>
          ))}
        </div>
        <GradientDivider className="mb-3" />
        <div className="pt-0">
          <p className="text-xs text-muted-foreground mb-2">Ou inicie por número avulso:</p>
          <div className="flex gap-2">
            <Input className="bg-input/60" placeholder="Nome" value={manual.nome} onChange={(e) => setManual({ ...manual, nome: e.target.value })} />
            <Input className="bg-input/60" placeholder="Telefone" value={manual.telefone} onChange={(e) => setManual({ ...manual, telefone: e.target.value })} />
            <Button className="btn-glow" onClick={() => onPick(manual.telefone, manual.nome || manual.telefone)}>Abrir</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumberSelectDialog({ connections, onClose, onPick }: {
  connections: { id: string; label: string; status: string; me?: string | null; last4?: string | null }[];
  onClose: () => void;
  onPick: (connectionId: string) => void;
}) {
  const ready = connections.filter((c) => c.status === "ready");
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-sm w-full p-5 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Por qual número deseja estabelecer o contato?</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="space-y-2">
          {ready.map((c) => (
            <button key={c.id} onClick={() => onPick(c.id)}
              className="w-full text-left px-3 py-2.5 rounded-lg border border-border hover:bg-primary/10 transition-colors flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{c.label}</span>
              {c.last4 && <span className="text-xs font-mono text-muted-foreground shrink-0">•••• {c.last4}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DuplicateConversationDialog({ receiverLast4, onClose, onOpenExisting, onStartAnyway }: {
  receiverLast4: string | null;
  onClose: () => void;
  onOpenExisting: () => void;
  onStartAnyway: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-sm w-full p-5 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-sm mb-2">Conversa já existente</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Já existe uma conversa estabelecida com este cliente{receiverLast4 ? ` no número •••• ${receiverLast4}` : ""}.
        </p>
        <div className="flex flex-col gap-2">
          <Button className="btn-glow" onClick={onOpenExisting}>Abrir conversa existente</Button>
          <Button variant="outline" onClick={onStartAnyway}>Iniciar mesmo assim pelo número escolhido</Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, count, children }: { active: boolean; onClick: () => void; icon: React.ElementType; count: number; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-1.5 px-0.5 rounded text-[10px] font-medium leading-none whitespace-nowrap transition-all
        ${active ? "bg-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground"}`}
    >
      <Icon className="w-3 h-3 shrink-0" />
      <span>{children}</span>
      <span className={`text-[9px] px-1 rounded-full shrink-0 ${active ? "bg-primary-foreground/20" : "bg-foreground/10"}`}>{count}</span>
    </button>
  );
}

function ChatView({ active, messages, onClose, contactTags, contactName, contact }: {
  active: Conversation; messages: ChatMessage[]; onClose: () => void;
  contactTags: string[]; contactName: string; contact: Contact | null;
}) {
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showFicha, setShowFicha] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ file: File; asDocument: boolean } | null>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const mediaFileRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const engineOnline = useAppStore((s) => s.engineOnline);
  const quickReplies = useAppStore((s) => s.quickReplies);
  const contacts = useAppStore((s) => s.contacts);
  const updateContact = useAppStore((s) => s.updateContact);
  const pipelineStages = useAppStore((s) => s.pipelineStages);
  const moveContactStage = useAppStore((s) => s.moveContactStage);

  // Funis customizados (Parte B — compartilhados por toda a equipe, além do
  // Funil do CRM padrão acima). Carregado uma vez por sessão de chat aberta;
  // o mapeamento contato→etapa é por funil, então guardamos os dois juntos.
  const [customFunis, setCustomFunis] = useState<Funil[]>([]);
  const [funilContatos, setFunilContatos] = useState<Record<string, Record<string, string>>>({});
  const reloadCustomFunis = async () => {
    try {
      const list = await funisApi.list();
      setCustomFunis(list);
      const entries = await Promise.all(list.map(async (f) => {
        const rows = await funisApi.contatos(f.id);
        const map: Record<string, string> = {};
        for (const r of rows) map[r.contatoId] = r.etapaId;
        return [f.id, map] as const;
      }));
      setFunilContatos(Object.fromEntries(entries));
    } catch {
      // silencioso — seletor de funil customizado só não aparece
    }
  };
  useEffect(() => { reloadCustomFunis(); }, []);

  const setContactCustomEtapa = async (funilId: string, contatoId: string, etapaId: string) => {
    setFunilContatos((prev) => ({ ...prev, [funilId]: { ...(prev[funilId] || {}), [contatoId]: etapaId } }));
    try {
      await funisApi.setContatoEtapa(funilId, contatoId, etapaId);
    } catch (e) {
      toast.error((e as Error).message);
      reloadCustomFunis();
    }
  };

  // Popover de respostas rápidas — abre quando o texto começa com "/" (o
  // placeholder do composer já avisa isso), filtra em tempo real, e separa
  // em dois grupos: "Empresa" (compartilhadas) e "Minhas" (pessoais — o
  // backend já só devolve as pessoais de quem está logado, então tudo que
  // cai aqui com visibility!=="shared" é sempre do próprio usuário).
  const showQuickReplies = text.startsWith("/");
  const qrQuery = useMemo(() => text.slice(1).toLowerCase(), [text]);
  const qrShared = useMemo(() => {
    if (!showQuickReplies) return [];
    return quickReplies
      .filter((r) => r.visibility === "shared" && (r.atalho.toLowerCase().includes(qrQuery) || r.body.toLowerCase().includes(qrQuery)))
      .slice(0, 8);
  }, [quickReplies, qrQuery, showQuickReplies]);
  const qrPersonal = useMemo(() => {
    if (!showQuickReplies) return [];
    return quickReplies
      .filter((r) => r.visibility !== "shared" && (r.atalho.toLowerCase().includes(qrQuery) || r.body.toLowerCase().includes(qrQuery)))
      .slice(0, 8);
  }, [quickReplies, qrQuery, showQuickReplies]);
  const qrFlat = useMemo(() => [...qrShared, ...qrPersonal], [qrShared, qrPersonal]);
  const [qrActiveIndex, setQrActiveIndex] = useState(0);
  useEffect(() => { setQrActiveIndex(0); }, [qrFlat.length, text]);
  const [showCreateQR, setShowCreateQR] = useState(false);
  const [editingQR, setEditingQR] = useState<QuickReply | null>(null);
  const [confirmDeleteQR, setConfirmDeleteQR] = useState<QuickReply | null>(null);

  const useQuickReply = (body: string) => {
    setText(renderBody(body));
    textareaRef.current?.focus();
  };
  const reloadQuickReplies = () => { api.loadQuickReplies().catch(() => {}); };
  const deleteQR = async (r: QuickReply) => {
    try {
      await api.deleteQuickReply(r.id);
      reloadQuickReplies();
      setConfirmDeleteQR(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  // Caixa de texto cresce um pouco conforme o conteúdo (até um limite —
  // combinado com max-h-32 no className), em vez de ficar sempre travada
  // numa única linha.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text]);

  const renderBody = (body: string) => body.replace(/\{nome\}/gi, contactName.split(" ")[0] || contactName);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    if (!engineOnline) { toast.error("Sistema local offline"); return; }
    // Limpa o campo IMEDIATAMENTE (otimista) — antes disso o texto só era
    // apagado depois do round-trip completo com o servidor, e se o
    // atendente já começasse a digitar a próxima mensagem nesse meio tempo,
    // as teclas entravam no meio do texto antigo ainda exibido, "juntando"
    // as duas mensagens numa só.
    setText("");
    try {
      await api.sendText(active.id, renderBody(body));
    } catch (e) {
      toast.error((e as Error).message);
      // só devolve o texto se o campo ainda estiver vazio — se o atendente
      // já começou a digitar outra coisa, não sobrescreve o que ele digitou.
      setText((current) => (current === "" ? body : current));
    }
  };

  const sendFile = async (file: File, asDocument = false, captionOverride?: string) => {
    if (!engineOnline) { toast.error("Sistema local offline"); return; }
    try {
      await api.sendMedia(active.id, file, renderBody(captionOverride ?? text), asDocument);
      setText("");
      toast.success("Mídia enviada");
    } catch (e) { toast.error((e as Error).message); }
  };

  const sendContact = async (nome: string, telefone: string) => {
    if (!engineOnline) { toast.error("Sistema local offline"); return; }
    try {
      await api.sendContact(active.id, nome, telefone);
      toast.success("Contato compartilhado");
      setShowContactPicker(false);
    } catch (e) { toast.error((e as Error).message); }
  };

  const assume  = async () => { try { await api.assume(active.id);  toast.success("Atendimento assumido"); } catch (e) { toast.error((e as Error).message); } };
  const release = async () => { try { await api.release(active.id); toast.success("Devolvido para pendentes"); } catch (e) { toast.error((e as Error).message); } };

  // Finalizar sempre pergunta o desfecho E a etapa CRM (quando há um contato
  // vinculado) — qualificação é sempre manual (Parte B), então finalizar sem
  // escolher uma etapa deixaria o funil desatualizado silenciosamente. A
  // escolha do funil/etapa é sempre em cascata (Parte T7): um único funil por
  // vez, nunca todos os selects de todos os funis ao mesmo tempo.
  const [showFinishTriage, setShowFinishTriage] = useState(false);
  const [desfecho, setDesfecho] = useState<"cliente" | "lead" | "concorrencia" | "depois" | null>(null);
  const [triageFunilId, setTriageFunilId] = useState(DEFAULT_FUNIL_ID);
  const [triageEtapa, setTriageEtapa] = useState("");
  const doFinish = async () => {
    try {
      await api.finish(active.id);
      toast.success("Atendimento finalizado");
      setShowFinishTriage(false);
    } catch (e) { toast.error((e as Error).message); }
  };
  const finish = () => {
    if (contact) {
      setDesfecho(null);
      setTriageFunilId(DEFAULT_FUNIL_ID);
      setTriageEtapa(pipelineStages.find((s) => s.key === contact.status)?.key ?? pipelineStages[0]?.key ?? "");
      setShowFinishTriage(true);
    } else {
      doFinish();
    }
  };
  const triageEtapaOptions = triageFunilId === DEFAULT_FUNIL_ID
    ? pipelineStages.map((s) => ({ id: s.key, label: s.label }))
    : (customFunis.find((f) => f.id === triageFunilId)?.etapas ?? []).map((et) => ({ id: et.id, label: et.nome }));
  const changeTriageFunil = (funilId: string) => {
    setTriageFunilId(funilId);
    if (funilId === DEFAULT_FUNIL_ID) {
      setTriageEtapa(pipelineStages.find((s) => s.key === contact?.status)?.key ?? pipelineStages[0]?.key ?? "");
    } else {
      // Cascata: trocar de funil nunca herda a etapa do funil anterior —
      // pré-seleciona a atribuição atual deste contato NESTE funil (se
      // já existir) ou a primeira etapa, mas sempre uma escolha nova e
      // explícita para o funil recém-selecionado.
      const current = funilContatos[funilId]?.[contact?.id ?? ""];
      const firstEtapa = customFunis.find((f) => f.id === funilId)?.etapas[0]?.id ?? "";
      setTriageEtapa(current ?? firstEtapa);
    }
  };
  const canConfirmFinish = !!desfecho && !!triageEtapa;
  const confirmFinish = async () => {
    if (!canConfirmFinish || !contact) return;
    const patch: { isClient?: boolean; atuaMercadoFinanceiro?: string } =
      desfecho === "cliente" ? { isClient: true }
      : desfecho === "lead" ? { atuaMercadoFinanceiro: "SIM" }
      : desfecho === "concorrencia" ? { atuaMercadoFinanceiro: "CONCORRENCIA" }
      : {};
    updateContact(contact.id, patch);
    api.updateContact(contact.id, patch).catch(() => {});
    if (triageFunilId === DEFAULT_FUNIL_ID) {
      moveContactStage(contact.id, triageEtapa);
      api.moveContactStage(contact.id, triageEtapa).catch(() => {});
    } else {
      setContactCustomEtapa(triageFunilId, contact.id, triageEtapa);
    }
    await doFinish();
  };

  // Transferir — diferente de "Devolver" (solta pro pool sem dono), passa a
  // conversa direto pra um colega específico, já assumida por ele.
  const [showTransfer, setShowTransfer] = useState(false);
  const [profiles, setProfiles] = useState<{ id: string; fullName: string }[]>([]);
  const openTransfer = async () => {
    setShowTransfer(true);
    try { setProfiles(await api.loadProfiles()); } catch { setProfiles([]); }
  };
  const transferTo = async (userId: string) => {
    try {
      await api.transferConversation(active.id, userId);
      toast.success("Atendimento transferido.");
      setShowTransfer(false);
    } catch (e) { toast.error((e as Error).message); }
  };

  // Busca dentro da conversa aberta — filtra as mensagens exibidas pelo
  // texto, sem afetar a lista de conversas (busca à esquerda é outra coisa).
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [chatQuery, setChatQuery] = useState("");
  const visibleMessages = useMemo(() => {
    const q = chatQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => (m.body || "").toLowerCase().includes(q));
  }, [messages, chatQuery]);

  // Arquivar — restrito a Sócio (Seção 13 do Manual: histórico nunca é
  // destruído, só escondido da tela normal). Exige justificativa registrada;
  // fica no audit log imutável e continua consultável em Auditoria.
  const isSocio = useAuthStore((s) => s.profile?.role === "socio");
  const archive = async () => {
    const reason = window.prompt("Justificativa para arquivar esta conversa (obrigatória, fica registrada no audit log):");
    if (reason == null) return; // cancelou
    if (!reason.trim()) { toast.error("Justificativa é obrigatória para arquivar."); return; }
    try {
      await api.archiveConversation(active.id, reason.trim());
      toast.success("Conversa arquivada. O histórico continua consultável em Auditoria.");
      onClose();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <header className="flex items-center gap-3 p-4">
        <Button size="icon" variant="ghost" className="lg:hidden" onClick={onClose}><ArrowLeft className="w-4 h-4" /></Button>
        <ContactAvatar telefone={active.telefone} nome={contactName} size="w-10 h-10" textSize="text-sm" clickable />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{contactName}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>{formatPhoneDisplay(active.telefone)}</span>
            {contactTags.slice(0, 4).map((t) => (
              <span key={t} className="px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-medium">#{t}</span>
            ))}
          </div>
        </div>
        <div className="flex gap-1 relative">
          <Button size="icon" variant="ghost" onClick={() => setShowFicha(true)} title={contact ? "Editar contato" : "Salvar como contato"}>
            <IdCard className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => { setShowChatSearch((v) => !v); if (showChatSearch) setChatQuery(""); }} title="Buscar na conversa">
            <Search className="w-4 h-4" />
          </Button>
          {active.status === "pendente" && (
            <Button size="sm" className="btn-glow" onClick={assume}><User className="w-3.5 h-3.5 mr-1" /> Assumir</Button>
          )}
          {active.status === "atendendo" && (
            <>
              <Button size="sm" variant="outline" onClick={release}><ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> Devolver</Button>
              <Button size="sm" variant="outline" onClick={openTransfer}><Users2 className="w-3.5 h-3.5 mr-1" /> Transferir</Button>
              <Button size="sm" variant="ghost" className="text-success" onClick={finish}><CheckCheck className="w-3.5 h-3.5 mr-1" /> Finalizar</Button>
            </>
          )}
          {isSocio && (
            <Button size="sm" variant="ghost" className="text-warning" onClick={archive} title="Restrito a Sócio">
              <Archive className="w-3.5 h-3.5 mr-1" /> Arquivar
            </Button>
          )}
          {/* Fechar a janela — só UI (activeId=null via onClose), nunca finaliza,
              arquiva, muda etapa/desfecho, nem status de leitura. Sempre
              visível (diferente do ArrowLeft acima, que é só o "voltar" do
              mobile). */}
          <Button size="icon" variant="ghost" onClick={onClose} title="Fechar conversa">
            <X className="w-4 h-4" />
          </Button>
          {showTransfer && (
            <div className="absolute top-full right-0 mt-2 z-20 w-56 rounded-xl border border-border bg-card/95 backdrop-blur shadow-elegant overflow-hidden animate-scale-in">
              <div className="px-3 py-2 text-xs font-medium border-b border-border">Transferir para…</div>
              {profiles.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 py-3">Nenhum colaborador encontrado.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto scrollbar-thin">
                  {profiles.map((p) => (
                    <button key={p.id} onClick={() => transferTo(p.id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-primary/10 border-b border-border last:border-b-0">
                      {p.fullName}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setShowTransfer(false)} className="w-full text-center px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/30">
                Cancelar
              </button>
            </div>
          )}
          {showFinishTriage && (
            <>
              {/* Overlay próprio — antes esse painel não tinha nenhum, então
                  clicar fora não fechava nada (só dava pra sair escolhendo uma
                  opção). Clicar fora agora cancela sem finalizar. */}
              <div className="fixed inset-0 z-10" onClick={() => setShowFinishTriage(false)} />
              <div className="absolute top-full right-0 mt-2 z-20 w-72 rounded-xl border border-border bg-card/95 backdrop-blur shadow-elegant overflow-hidden animate-scale-in">
                <div className="px-3 py-2 text-xs font-medium border-b border-border">Qual foi o desfecho?</div>
                <div className="p-2 space-y-1 border-b border-border">
                  {([
                    ["cliente", "Entrou na Assessoria"],
                    ["lead", "Virou Lead Frio"],
                    ["concorrencia", "Tem condições melhores em outra corretora"],
                    ["depois", "Decidir depois"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setDesfecho(value)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                        desfecho === value ? "bg-primary/15 text-primary" : "hover:bg-primary/10"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="p-3 space-y-2 border-b border-border">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Funil</label>
                    <select
                      value={triageFunilId}
                      onChange={(e) => changeTriageFunil(e.target.value)}
                      className="w-full mt-1 h-8 rounded-lg border border-border bg-input/60 px-2 text-sm"
                    >
                      <option value={DEFAULT_FUNIL_ID}>Funil do CRM</option>
                      {customFunis.map((f) => (
                        <option key={f.id} value={f.id}>{f.nome}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Etapa (obrigatório)</label>
                    <select
                      value={triageEtapa}
                      onChange={(e) => setTriageEtapa(e.target.value)}
                      className="w-full mt-1 h-8 rounded-lg border border-border bg-input/60 px-2 text-sm"
                    >
                      <option value="" disabled>Selecione…</option>
                      {triageEtapaOptions.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="p-2">
                  <Button className="w-full btn-glow" size="sm" disabled={!canConfirmFinish} onClick={confirmFinish}>
                    Confirmar e finalizar
                  </Button>
                </div>
                <button onClick={() => setShowFinishTriage(false)}
                  className="w-full text-center px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/30 border-t border-border">
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      </header>
      {showChatSearch && (
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-8 h-8 bg-input/60 text-sm"
              placeholder="Buscar nesta conversa…"
              value={chatQuery}
              onChange={(e) => setChatQuery(e.target.value)}
            />
          </div>
          {chatQuery.trim() && (
            <p className="text-[11px] text-muted-foreground mt-1">{visibleMessages.length} resultado(s)</p>
          )}
        </div>
      )}
      <GradientDivider />

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin px-4 py-4 space-y-2">
        {visibleMessages.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">
            {chatQuery.trim() ? "Nenhuma mensagem encontrada." : "Sem mensagens nesta conversa."}
          </div>
        )}
        {visibleMessages.map((m) => <Bubble key={m.id} m={m} />)}
      </div>

      {/* Emoji picker */}
      {showEmoji && (
        <div className="relative mx-3">
          <EmojiPicker onPick={(e) => setText((t) => t + e)} onClose={() => setShowEmoji(false)} />
        </div>
      )}

      {/* Popover de respostas rápidas — grupos Empresa/Minhas, navegação por
          teclado (setas/Enter/Esc — ver onKeyDown do textarea), inserção no
          campo pra revisão (nunca envia direto). */}
      {showQuickReplies && qrFlat.length > 0 && (
        <div className="mx-3 mb-1 rounded-lg border border-border bg-card/95 backdrop-blur shadow-elegant max-h-64 overflow-y-auto scrollbar-thin">
          {qrShared.length > 0 && (
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold bg-muted/20">Empresa</div>
          )}
          {qrShared.map((r) => (
            <QuickReplyRow key={r.id} r={r} active={qrFlat.indexOf(r) === qrActiveIndex}
              onPick={() => useQuickReply(r.body)} onEdit={() => setEditingQR(r)} onDelete={() => setConfirmDeleteQR(r)} />
          ))}
          {qrPersonal.length > 0 && (
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold bg-muted/20">Minhas</div>
          )}
          {qrPersonal.map((r) => (
            <QuickReplyRow key={r.id} r={r} active={qrFlat.indexOf(r) === qrActiveIndex}
              onPick={() => useQuickReply(r.body)} onEdit={() => setEditingQR(r)} onDelete={() => setConfirmDeleteQR(r)} />
          ))}
          <button
            onClick={() => setShowCreateQR(true)}
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-primary hover:bg-primary/10 border-t border-border font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Criar nova resposta rápida
          </button>
        </div>
      )}

      <GradientDivider />
      <div className="p-3 flex items-end gap-2 relative">
        <input ref={docFileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingFile({ file: f, asDocument: true }); e.target.value = ""; }} />
        <input ref={mediaFileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingFile({ file: f, asDocument: false }); e.target.value = ""; }} />
        <input ref={audioFileRef} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingFile({ file: f, asDocument: false }); e.target.value = ""; }} />

        <div className="relative">
          <Button size="icon" variant="ghost" onClick={() => setShowAttach((v) => !v)} disabled={active.status !== "atendendo"} title="Anexar">
            <Plus className="w-4 h-4" />
          </Button>
          {showAttach && (
            <div className="absolute bottom-full mb-2 left-0 z-20 w-52 rounded-xl border border-border bg-card/95 backdrop-blur shadow-elegant overflow-hidden animate-scale-in">
              <button onClick={() => { setShowAttach(false); docFileRef.current?.click(); }}
                className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10 border-b border-border">
                <FileText className="w-4 h-4 text-primary" /> Documento
              </button>
              <button onClick={() => { setShowAttach(false); mediaFileRef.current?.click(); }}
                className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10 border-b border-border">
                <ImageIcon className="w-4 h-4 text-primary" /> Fotos e vídeos
              </button>
              <button onClick={() => { setShowAttach(false); audioFileRef.current?.click(); }}
                className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10 border-b border-border">
                <Mic className="w-4 h-4 text-primary" /> Áudio
              </button>
              <button onClick={() => { setShowAttach(false); setShowContactPicker(true); }}
                className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10 border-b border-border">
                <User className="w-4 h-4 text-primary" /> Contato
              </button>
              <button onClick={() => { setShowAttach(false); setText("/"); }}
                className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10">
                <Zap className="w-4 h-4 text-primary" /> Respostas rápidas
              </button>
            </div>
          )}
        </div>

        <Button size="icon" variant="ghost" onClick={() => setShowEmoji((v) => !v)} disabled={active.status !== "atendendo"} title="Emoji">
          <Smile className="w-4 h-4" />
        </Button>
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={active.status === "atendendo" ? "Digite uma mensagem… ( / para respostas rápidas )" : "Assuma o atendimento para responder"}
          disabled={active.status !== "atendendo"}
          className="scrollbar-thin-composer flex-1 bg-input/60 rounded-lg pl-3 pr-2 py-2 text-sm resize-none border border-primary/30 focus:border-primary/60 focus:outline-none disabled:opacity-60 max-h-32 overflow-y-auto"
          style={{ scrollbarGutter: "stable" }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (showQuickReplies && qrFlat.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setQrActiveIndex((i) => Math.min(i + 1, qrFlat.length - 1)); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setQrActiveIndex((i) => Math.max(i - 1, 0)); return; }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const r = qrFlat[qrActiveIndex]; if (r) useQuickReply(r.body); return; }
              if (e.key === "Escape") { e.preventDefault(); setText(""); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <Button className="btn-glow" size="icon" onClick={send} disabled={!text.trim() || active.status !== "atendendo"} title="Enviar">
          <Send className="w-4 h-4" />
        </Button>
      </div>

      {showContactPicker && (
        <ContactPickerDialog contacts={contacts} onClose={() => setShowContactPicker(false)} onPick={(c) => sendContact(c.nome, c.telefone)} />
      )}

      {pendingFile && (
        <FilePreviewDialog
          file={pendingFile.file}
          asDocument={pendingFile.asDocument}
          initialCaption={text}
          onCancel={() => setPendingFile(null)}
          onConfirm={async (caption) => {
            await sendFile(pendingFile.file, pendingFile.asDocument, caption);
            setPendingFile(null);
          }}
        />
      )}

      {showFicha && (
        contact
          ? <ContactFormDialog mode="edit" contact={contact} onClose={() => setShowFicha(false)} />
          : <ContactFormDialog mode="create" defaultTelefone={active.telefone} defaultNome={contactName} onClose={() => setShowFicha(false)} />
      )}

      {showCreateQR && (
        <QuickReplyFormDialog
          onClose={() => setShowCreateQR(false)}
          onSaved={() => { setShowCreateQR(false); reloadQuickReplies(); }}
        />
      )}
      {editingQR && (
        <QuickReplyFormDialog
          quickReply={editingQR}
          onClose={() => setEditingQR(null)}
          onSaved={() => { setEditingQR(null); reloadQuickReplies(); }}
        />
      )}
      {confirmDeleteQR && (
        <ConfirmDialog
          title="Apagar resposta rápida"
          description={confirmDeleteQR.visibility === "shared"
            ? "Esta resposta é compartilhada com toda a equipe — apagar afeta todo mundo. Continuar?"
            : "Apagar esta resposta pessoal?"}
          confirmLabel="Apagar"
          onCancel={() => setConfirmDeleteQR(null)}
          onConfirm={() => deleteQR(confirmDeleteQR)}
        />
      )}
    </>
  );
}

function QuickReplyRow({ r, active, onPick, onEdit, onDelete }: {
  r: QuickReply; active: boolean;
  onPick: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className={`flex items-center border-b border-border last:border-b-0 ${active ? "bg-primary/10" : ""}`}>
      <button onClick={onPick} className="flex-1 min-w-0 text-left px-3 py-2 hover:bg-primary/10">
        <div className="flex items-center gap-2 text-xs text-primary font-mono"><Zap className="w-3 h-3" />/{r.atalho}</div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">{r.body}</div>
      </button>
      <button onClick={onEdit} className="p-1.5 text-muted-foreground hover:text-foreground shrink-0" title="Editar">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button onClick={onDelete} className="p-1.5 mr-1 text-muted-foreground hover:text-destructive shrink-0" title="Excluir">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function QuickReplyFormDialog({ quickReply, onClose, onSaved }: {
  quickReply?: QuickReply;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [atalho, setAtalho] = useState(quickReply?.atalho ?? "");
  const [body, setBody] = useState(quickReply?.body ?? "");
  const [visibility, setVisibility] = useState<"personal" | "shared">(quickReply?.visibility === "shared" ? "shared" : "personal");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!atalho.trim() || !body.trim()) { toast.error("Atalho e mensagem são obrigatórios."); return; }
    setSaving(true);
    try {
      await api.saveQuickReply({ id: quickReply?.id, atalho: atalho.trim().replace(/^\/+/, ""), body: body.trim(), visibility });
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-sm w-full p-5 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">{quickReply ? "Editar resposta rápida" : "Criar nova resposta rápida"}</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Atalho</label>
            <Input className="bg-input/60" placeholder="ex: bomdia" value={atalho} onChange={(e) => setAtalho(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Mensagem completa</label>
            <textarea
              className="w-full bg-input/60 rounded-lg px-3 py-2 text-sm border border-border focus:border-primary/60 focus:outline-none resize-none"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Tipo</label>
            <div className="flex gap-2">
              <button
                onClick={() => setVisibility("personal")}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${visibility === "personal" ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
              >Pessoal</button>
              <button
                onClick={() => setVisibility("shared")}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${visibility === "shared" ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
              >Empresa</button>
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="btn-glow" onClick={save} disabled={saving}>Salvar</Button>
        </div>
      </div>
    </div>
  );
}

function ContactPickerDialog({ contacts, onClose, onPick }: {
  contacts: { id: string; nome: string; telefone: string }[];
  onClose: () => void;
  onPick: (c: { nome: string; telefone: string }) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = contacts
    .filter((c) => !q || c.nome.toLowerCase().includes(q.toLowerCase()) || c.telefone.includes(q))
    .slice(0, 50);

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-md w-full p-5 animate-scale-in max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Enviar contato</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <Input className="mb-2 bg-input/60" placeholder="Buscar contato…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex-1 overflow-y-auto scrollbar-thin border border-border rounded-lg">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">Nenhum contato encontrado.</p>
          ) : filtered.map((c) => (
            <button key={c.id} onClick={() => onPick(c)}
              className="w-full text-left px-3 py-2 hover:bg-primary/10 border-b border-border last:border-b-0">
              <div className="text-sm font-medium truncate">{c.nome}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{formatPhoneDisplay(c.telefone)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const mine = m.from_me === 1;
  const time = new Date(m.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const url = api.mediaUrl(m.media_path);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [saving, setSaving] = useState(false);
  // Menu de contexto (botão direito) — só em mensagens NOSSAS (Parte E1);
  // mensagens do cliente nunca ganham esse handler nem essas opções. Editar
  // e apagar SÓ existem por aqui agora (o lápis fixo no hover foi removido —
  // duplicava a mesma ação e confundia sobre onde cada uma vive).
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // O menu é renderizado via portal em document.body (mesma razão do
  // lightbox em MediaAttachment.tsx): a bolha tem animate-fade-in, cujo
  // transform cria um containing block pra descendentes position:fixed —
  // sem o portal, o menu ficava "preso" dentro do tamanho da bolha em vez de
  // aparecer na posição real do clique, empurrando a conversa pra criar
  // scroll horizontal. Depois de portado, medimos o próprio menu e invertemos
  // a posição se ele for estourar a borda direita/inferior da tela.
  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) { setMenuPos(null); return; }
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 8;
    let left = contextMenu.x;
    let top = contextMenu.y;
    if (left + rect.width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - rect.width - margin);
    if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - rect.height - margin);
    setMenuPos({ top, left });
  }, [contextMenu]);

  const startEdit = () => { setDraft(m.body); setEditing(true); setContextMenu(null); };
  const saveEdit = async () => {
    const next = draft.trim();
    if (!next || next === m.body) { setEditing(false); return; }
    setSaving(true);
    try {
      await api.editMessage(m.id, next);
      setEditing(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteForEveryone = async () => {
    setDeleting(true);
    try {
      await api.deleteForEveryone(m.id);
      setConfirmDelete(false);
    } catch (e) {
      // Fail-closed no backend — se a mensagem não puder mais ser revogada no
      // WhatsApp (fora da janela de tempo, etc.), nada muda aqui nem lá; só
      // avisamos o motivo.
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"} animate-fade-in`}>
      <div
        className={`group relative max-w-[78%] rounded-2xl px-3 py-2 ${mine ? "bubble-sent" : "bubble-received"}`}
        onContextMenu={mine ? (e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); } : undefined}
      >
        {contextMenu && createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
            <div
              ref={menuRef}
              className="fixed z-50 w-52 rounded-xl border border-border bg-card/95 backdrop-blur shadow-elegant overflow-hidden animate-scale-in"
              style={{
                top: (menuPos ?? { top: contextMenu.y, left: contextMenu.x }).top,
                left: (menuPos ?? { top: contextMenu.y, left: contextMenu.x }).left,
                visibility: menuPos ? "visible" : "hidden",
              }}
            >
              {m.type === "text" && !m.revoked_at && (
                <button onClick={startEdit} className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10 border-b border-border">
                  <Pencil className="w-4 h-4 text-primary" /> Editar
                </button>
              )}
              {!m.revoked_at && (
                <button
                  onClick={() => { setContextMenu(null); setConfirmDelete(true); }}
                  className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-destructive/10 text-destructive"
                >
                  <Ban className="w-4 h-4" /> Apagar para todos
                </button>
              )}
            </div>
          </>,
          document.body
        )}

        {confirmDelete && (
          <ConfirmDialog
            title="Apagar esta mensagem para todos?"
            description="Some do WhatsApp do cliente (se ainda estiver dentro da janela de tempo permitida). O conteúdo original continua visível aqui internamente pra equipe, com a marcação de quem apagou."
            confirmLabel={deleting ? "Apagando…" : "Apagar para todos"}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={deleteForEveryone}
          />
        )}

        {!!m.revoked_at && (
          <div className="flex items-center gap-1 text-[10px] text-warning mb-1">
            <Ban className="w-3 h-3" />
            {m.revoked_by_name
              ? `${m.revoked_by_name} apagou esta mensagem para o cliente`
              : mine ? "Você apagou esta mensagem no WhatsApp" : "Cliente apagou esta mensagem no WhatsApp"}
            {" "}— mantida aqui no registro
          </div>
        )}

        {url && (m.type === "image" || m.type === "video" || m.type === "audio" || m.type === "document") && (
          <MediaAttachment mimeType={m.media_mime || `${m.type}/*`} url={url} filename={m.media_filename} variant={mine ? "sent" : "received"} />
        )}
        {m.type === "vcard" && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-background/40 text-xs">
            <User className="w-4 h-4" /> Contato compartilhado
          </div>
        )}
        {editing ? (
          <div className="space-y-1.5">
            <textarea
              rows={2}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === "Escape") setEditing(false); }}
              className="w-full bg-background/60 rounded-lg px-2 py-1.5 text-sm resize-none border border-primary/40 focus:outline-none"
            />
            <div className="flex gap-1.5 justify-end">
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditing(false)} disabled={saving}>Cancelar</Button>
              <Button size="sm" className="btn-glow h-6 px-2 text-xs" onClick={saveEdit} disabled={saving}>Salvar</Button>
            </div>
          </div>
        ) : (
          <>
            {m.body && m.type !== "vcard" && <div className="text-sm whitespace-pre-wrap break-words">{m.body}</div>}
            {!m.body && m.type !== "text" && m.type !== "vcard" && !url && (
              <div className="text-xs italic text-muted-foreground flex items-center gap-1">
                {m.type === "image" ? <ImageIcon className="w-3 h-3" /> : m.type === "audio" ? <Mic className="w-3 h-3" /> : <FileText className="w-3 h-3" />} [{m.type}]
              </div>
            )}
          </>
        )}
        <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground mt-0.5">
          {mine && !!m.sender_name && <span className="truncate max-w-[120px]">{m.sender_name}</span>}
          {mine && !!m.sender_name && <span>·</span>}
          {!!m.edited_at && <span className="italic">editado</span>}
          {time}
          {mine && (m.ack >= 3 ? <CheckCheck className="w-3 h-3 text-primary" /> : m.ack >= 2 ? <CheckCheck className="w-3 h-3" /> : <Check className="w-3 h-3" />)}
        </div>
      </div>
    </div>
  );
}

function relTime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "agora";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
