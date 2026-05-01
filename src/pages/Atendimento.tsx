import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { useAppStore, type Conversation, type ChatMessage } from "@/store/appStore";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/engine";
import { Inbox, MessageSquareText, Send, Paperclip, ArrowRightLeft, CheckCheck, Check, User, Search, Image as ImageIcon, FileText, Mic, ArrowLeft, Zap, AtSign, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone";
import { toast } from "sonner";

type Tab = "pendentes" | "meus";

export default function Atendimento() {
  const conversations = useAppStore((s) => s.conversations);
  const messagesByChat = useAppStore((s) => s.messagesByChat);
  const engineOnline = useAppStore((s) => s.engineOnline);
  const contacts = useAppStore((s) => s.contacts);
  const setConversations = useAppStore((s) => s.setConversations);
  const [tab, setTab] = useState<Tab>("pendentes");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newChat, setNewChat] = useState(false);

  const startConversation = (telefone: string, nome: string) => {
    const tel = normalizePhone(telefone);
    if (!tel) { toast.error("Telefone inválido"); return; }
    const id = `${tel}@c.us`;
    if (!conversations.some((c) => c.id === id)) {
      setConversations([
        { id, telefone: tel, nome, last_message: "", last_ts: Date.now(), unread: 0, status: "atendendo", assignee: "me" },
        ...conversations,
      ]);
    }
    setTab("meus");
    setActiveId(id);
    setNewChat(false);
  };

  useEffect(() => {
    if (engineOnline) {
      api.loadConversations().catch(() => {});
      api.loadQuickReplies().catch(() => {});
    }
  }, [engineOnline]);

  // Buscar também por tag (#tagname) ou conteúdo da última mensagem
  const list = useMemo(() => {
    const q = search.toLowerCase().trim();
    const tagFilter = q.startsWith("#") ? q.slice(1) : null;
    const filtered = conversations.filter((c) => {
      if (tab === "pendentes") return c.status === "pendente";
      return c.status === "atendendo";
    }).filter((c) => {
      if (!q) return true;
      if (tagFilter) {
        const ct = contacts.find((x) => x.telefone === c.telefone);
        return ct?.tags?.some((t) => t.toLowerCase().includes(tagFilter));
      }
      return c.nome.toLowerCase().includes(q)
        || c.telefone.includes(q)
        || (c.last_message || "").toLowerCase().includes(q);
    });
    return filtered.sort((a, b) => b.last_ts - a.last_ts);
  }, [conversations, tab, search, contacts]);

  const active = conversations.find((c) => c.id === activeId) || null;
  const messages = activeId ? (messagesByChat[activeId] || []) : [];
  const activeContact = active ? contacts.find((c) => c.telefone === active.telefone) : null;

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
            <TabBtn active={tab === "pendentes"} onClick={() => setTab("pendentes")} icon={Inbox}
              count={conversations.filter((c) => c.status === "pendente").length}>Pendentes</TabBtn>
            <TabBtn active={tab === "meus"} onClick={() => setTab("meus")} icon={MessageSquareText}
              count={conversations.filter((c) => c.status === "atendendo").length}>Meus</TabBtn>
          </div>
          <Button size="sm" className="btn-glow w-full mb-2" onClick={() => setNewChat(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Nova conversa
          </Button>

          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8 h-8 bg-input/60 text-sm" placeholder="Buscar — use #tag para filtrar" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin space-y-1">
            {list.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-12">
                {!engineOnline ? "Inicie o motor local para receber mensagens." : "Nenhuma conversa aqui."}
              </div>
            )}
            {list.map((c) => (
              <button key={c.id} onClick={() => open(c)}
                className={`w-full text-left p-3 rounded-lg transition-all border
                  ${activeId === c.id ? "bg-primary/15 border-primary/40" : "border-transparent hover:bg-primary/5"}`}
              >
                <div className="flex items-start gap-2">
                  <div className="w-9 h-9 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground text-xs font-semibold shrink-0">
                    {c.nome.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium truncate">{c.nome}</div>
                      <div className="text-[10px] text-muted-foreground shrink-0">{relTime(c.last_ts)}</div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <div className="text-xs text-muted-foreground truncate">{c.last_message || "—"}</div>
                      {c.unread > 0 && (
                        <span className="text-[10px] bg-success text-success-foreground rounded-full px-1.5 py-0.5 font-semibold shrink-0">{c.unread}</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

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
            <ChatView active={active} messages={messages} onClose={() => setActiveId(null)} contactTags={activeContact?.tags || []} contactName={activeContact?.nome || active.nome} />
          )}
        </div>
      </div>

      {newChat && (
        <NewChatDialog contacts={contacts} onClose={() => setNewChat(false)} onPick={startConversation} />
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
        <div className="flex-1 overflow-y-auto scrollbar-thin border border-border/30 rounded-lg mb-3">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">Nenhum contato encontrado.</p>
          ) : filtered.map((c) => (
            <button key={c.id} onClick={() => onPick(c.telefone, c.nome)}
              className="w-full text-left px-3 py-2 hover:bg-primary/10 border-b border-border/20 last:border-b-0">
              <div className="text-sm font-medium truncate">{c.nome}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{formatPhoneDisplay(c.telefone)}</div>
            </button>
          ))}
        </div>
        <div className="border-t border-border/30 pt-3">
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

function TabBtn({ active, onClick, icon: Icon, count, children }: { active: boolean; onClick: () => void; icon: React.ElementType; count: number; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-2 rounded text-xs font-medium transition-all
        ${active ? "bg-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground"}`}
    >
      <Icon className="w-3.5 h-3.5" /> {children}
      <span className={`text-[10px] px-1.5 rounded-full ${active ? "bg-primary-foreground/20" : "bg-foreground/10"}`}>{count}</span>
    </button>
  );
}

function ChatView({ active, messages, onClose, contactTags, contactName }: {
  active: Conversation; messages: ChatMessage[]; onClose: () => void;
  contactTags: string[]; contactName: string;
}) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const engineOnline = useAppStore((s) => s.engineOnline);
  const quickReplies = useAppStore((s) => s.quickReplies);

  // gravação de áudio (PTT)
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);

  // dropdown de respostas rápidas — abre quando texto começa com /
  const showQuickReplies = text.startsWith("/");
  const filteredQR = useMemo(() => {
    if (!showQuickReplies) return [];
    const q = text.slice(1).toLowerCase();
    return quickReplies.filter((r) => r.atalho.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)).slice(0, 6);
  }, [text, quickReplies, showQuickReplies]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  const renderBody = (body: string) => body.replace(/\{nome\}/gi, contactName.split(" ")[0] || contactName);

  const send = async () => {
    if (!text.trim()) return;
    if (!engineOnline) { toast.error("Motor local offline"); return; }
    try {
      await api.sendText(active.id, renderBody(text.trim()));
      setText("");
    } catch (e) { toast.error((e as Error).message); }
  };

  const sendFile = async (file: File) => {
    if (!engineOnline) { toast.error("Motor local offline"); return; }
    try {
      await api.sendMedia(active.id, file, renderBody(text));
      setText("");
      toast.success("Mídia enviada");
    } catch (e) { toast.error((e as Error).message); }
  };

  const startRecording = async () => {
    if (!engineOnline) { toast.error("Motor local offline"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recChunksRef.current, { type: mime });
        const file = new File([blob], `audio-${Date.now()}.webm`, { type: mime });
        try { await api.sendMedia(active.id, file, ""); toast.success("Áudio enviado"); }
        catch (e) { toast.error((e as Error).message); }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true); setRecSeconds(0);
      recTimerRef.current = window.setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch (e) {
      toast.error("Permissão de microfone negada");
    }
  };

  const stopRecording = (cancel = false) => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      if (cancel) {
        rec.ondataavailable = null as never;
        rec.onstop = () => rec.stream.getTracks().forEach((t) => t.stop());
      }
      rec.stop();
    }
    if (recTimerRef.current) { window.clearInterval(recTimerRef.current); recTimerRef.current = null; }
    setRecording(false); setRecSeconds(0);
  };

  const useQuickReply = (body: string) => { setText(renderBody(body)); };
  const insertNomeToken = () => setText((t) => t + (t.endsWith(" ") || !t ? "" : " ") + "{nome}");

  const assume  = async () => { try { await api.assume(active.id);  toast.success("Atendimento assumido"); } catch (e) { toast.error((e as Error).message); } };
  const release = async () => { try { await api.release(active.id); toast.success("Devolvido para pendentes"); } catch (e) { toast.error((e as Error).message); } };
  const finish  = async () => { try { await api.finish(active.id);  toast.success("Atendimento finalizado"); } catch (e) { toast.error((e as Error).message); } };

  return (
    <>
      <header className="flex items-center gap-3 p-4 border-b border-border/30">
        <Button size="icon" variant="ghost" className="lg:hidden" onClick={onClose}><ArrowLeft className="w-4 h-4" /></Button>
        <div className="w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground text-sm font-semibold">
          {active.nome.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{active.nome}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>{formatPhoneDisplay(active.telefone)}</span>
            {contactTags.slice(0, 4).map((t) => (
              <span key={t} className="px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-medium">#{t}</span>
            ))}
          </div>
        </div>
        <div className="flex gap-1">
          {active.status === "pendente" && (
            <Button size="sm" className="btn-glow" onClick={assume}><User className="w-3.5 h-3.5 mr-1" /> Assumir</Button>
          )}
          {active.status === "atendendo" && (
            <>
              <Button size="sm" variant="outline" onClick={release}><ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> Devolver</Button>
              <Button size="sm" variant="ghost" className="text-success" onClick={finish}><CheckCheck className="w-3.5 h-3.5 mr-1" /> Finalizar</Button>
            </>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-2">
        {messages.length === 0 && <div className="text-center text-xs text-muted-foreground py-8">Sem mensagens nesta conversa.</div>}
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
      </div>

      {/* Quick replies dropdown */}
      {showQuickReplies && filteredQR.length > 0 && (
        <div className="mx-3 mb-1 rounded-lg border border-border/40 bg-card/95 backdrop-blur shadow-elegant max-h-48 overflow-y-auto scrollbar-thin">
          {filteredQR.map((r) => (
            <button key={r.id} onClick={() => useQuickReply(r.body)}
              className="w-full text-left px-3 py-2 hover:bg-primary/10 border-b border-border/20 last:border-b-0">
              <div className="flex items-center gap-2 text-xs text-primary font-mono"><Zap className="w-3 h-3" />/{r.atalho}</div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">{r.body}</div>
            </button>
          ))}
        </div>
      )}

      <div className="p-3 border-t border-border/30 flex items-end gap-2">
        <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = ""; }} />
        <Button size="icon" variant="ghost" onClick={() => fileRef.current?.click()} disabled={active.status !== "atendendo" || recording} title="Anexar arquivo">
          <Paperclip className="w-4 h-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={insertNomeToken} disabled={active.status !== "atendendo" || recording} title="Inserir {nome}">
          <AtSign className="w-4 h-4" />
        </Button>
        {recording ? (
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/40">
            <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            <span className="text-sm text-destructive font-mono">Gravando… {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, "0")}</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => stopRecording(true)}>Cancelar</Button>
            <Button size="sm" className="btn-glow" onClick={() => stopRecording(false)}>Enviar</Button>
          </div>
        ) : (
          <textarea
            rows={1}
            placeholder={active.status === "atendendo" ? "Digite uma mensagem… ( / para respostas rápidas )" : "Assuma o atendimento para responder"}
            disabled={active.status !== "atendendo"}
            className="flex-1 bg-input/60 rounded-lg px-3 py-2 text-sm resize-none border border-border/40 focus:border-primary/60 focus:outline-none disabled:opacity-60 max-h-32"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
        )}
        {!recording && !text.trim() && (
          <Button size="icon" variant="ghost" onClick={startRecording} disabled={active.status !== "atendendo"} title="Gravar áudio">
            <Mic className="w-4 h-4" />
          </Button>
        )}
        {(text.trim() || recording) && (
          <Button className="btn-glow" onClick={send} disabled={!text.trim() || active.status !== "atendendo" || recording}>
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>
    </>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const mine = m.from_me === 1;
  const time = new Date(m.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const url = api.mediaUrl(m.media_path);

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"} animate-fade-in`}>
      <div className={`max-w-[78%] rounded-2xl px-3 py-2 ${mine ? "bg-primary/20 border border-primary/30" : "bg-muted/40 border border-border/30"}`}>
        {m.type === "image" && url && (
          <img src={url} alt="" className="rounded-lg max-w-full mb-1" loading="lazy" />
        )}
        {m.type === "video" && url && (
          <video src={url} controls className="rounded-lg max-w-full mb-1" />
        )}
        {m.type === "audio" && url && (
          <audio src={url} controls className="mb-1 max-w-full" />
        )}
        {m.type === "document" && url && (
          <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-2 py-1.5 rounded bg-background/40 text-xs hover:underline">
            <FileText className="w-4 h-4" /> Abrir documento
          </a>
        )}
        {m.body && <div className="text-sm whitespace-pre-wrap break-words">{m.body}</div>}
        {!m.body && m.type !== "text" && !url && (
          <div className="text-xs italic text-muted-foreground flex items-center gap-1">
            {m.type === "image" ? <ImageIcon className="w-3 h-3" /> : m.type === "audio" ? <Mic className="w-3 h-3" /> : <FileText className="w-3 h-3" />} [{m.type}]
          </div>
        )}
        <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground mt-0.5">
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
