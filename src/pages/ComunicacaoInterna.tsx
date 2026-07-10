import { AppHeader } from "@/components/AppHeader";
import { GradientDivider } from "@/components/GradientDivider";
import { MediaAttachment } from "@/components/MediaAttachment";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/store/authStore";
import { comms, type Category, type Channel, type ClientDataCard, type CommsMessage, type Server, type TypingHandle, type Urgencia } from "@/lib/comms";
import type { Profile, UserRole } from "@/lib/supabase";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pin, PinOff, Send, ShieldAlert, Trash, Users, X, Circle, Image as ImageIcon, Mic, Pencil, FileText, Check, ChevronDown, ChevronRight, GripVertical, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const ROLE_LABEL: Record<UserRole, string> = { socio: "Sócio", comercial: "Comercial", operacional: "Operacional" };

export default function ComunicacaoInterna() {
  const me = useAuthStore((s) => s.profile);
  const isSocio = me?.role === "socio";

  const [servers, setServers] = useState<Server[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<Channel[]>([]);
  const [dmCounterpart, setDmCounterpart] = useState<Record<string, string>>({}); // channelId -> userId
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CommsMessage[]>([]);
  const [cards, setCards] = useState<Record<string, ClientDataCard>>({});
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [createChannelCategoryId, setCreateChannelCategoryId] = useState<string | null | undefined>(undefined);
  const [showHandoff, setShowHandoff] = useState(false);
  const [showColleaguePicker, setShowColleaguePicker] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({}); // userId -> expira em (ms epoch)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<{ file: File; asDocument: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  // Confirmação genérica (apagar mensagem/categoria/canal, ocultar DM) — um
  // único ConfirmDialog reutilizável (Parte C1) em vez de window.confirm.
  const [confirmState, setConfirmState] = useState<{ title: string; description?: string; confirmLabel?: string; onConfirm: () => void | Promise<void> } | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const typingChannelRef = useRef<TypingHandle | null>(null);
  const lastTypingSentRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const profileById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const active = useMemo(() => [...channels, ...dms].find((c) => c.id === activeId) || null, [channels, dms, activeId]);

  const loadServers = async () => {
    const [srv, dm, pr] = await Promise.all([comms.listServers(), comms.listDms(), comms.listProfiles()]);
    setServers(srv);
    setDms(dm);
    setProfiles(pr);
    const counterparts: Record<string, string> = {};
    await Promise.all(dm.map(async (d) => {
      const members = await comms.listMembers(d.id);
      const other = members.find((id) => id !== me?.id);
      if (other) counterparts[d.id] = other;
    }));
    setDmCounterpart(counterparts);
    setActiveServerId((prev) => prev || srv[0]?.id || null);
  };

  useEffect(() => {
    loadServers().catch((e) => toast.error("Não foi possível carregar os servidores: " + e.message));
    if (!me) return;
    comms.presence.join({ id: me.id, name: me.fullName }, setOnlineIds);
    comms.getUnreadCounts().then(setUnreadCounts).catch(() => {});
    const unreadTimer = window.setInterval(() => { comms.getUnreadCounts().then(setUnreadCounts).catch(() => {}); }, 12000);
    return () => { comms.presence.leave(); window.clearInterval(unreadTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // Recarrega categorias/canais sempre que o servidor selecionado muda.
  useEffect(() => {
    if (!activeServerId) { setCategories([]); setChannels([]); return; }
    let cancelled = false;
    Promise.all([comms.listCategories(activeServerId), comms.listChannels(activeServerId)]).then(([cats, chs]) => {
      if (cancelled) return;
      setCategories(cats);
      setChannels(chs);
      setActiveId((prev) => {
        if (prev && (chs.some((c) => c.id === prev) || dms.some((d) => d.id === prev))) return prev;
        return chs[0]?.id ?? null;
      });
    }).catch((e) => toast.error("Não foi possível carregar os canais: " + e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServerId]);

  // Limpa indicadores de "digitando" expirados a cada segundo.
  useEffect(() => {
    const t = window.setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(prev).filter(([, exp]) => exp > now));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setEditingId(null);
    comms.listMessages(activeId).then((msgs) => { if (!cancelled) setMessages(msgs); }).catch((e) => toast.error(e.message));
    comms.listCards(activeId).then((list) => {
      if (cancelled) return;
      setCards(Object.fromEntries(list.filter((c) => c.messageId).map((c) => [c.messageId as string, c])));
    }).catch(() => {});
    comms.markRead(activeId).then(() => setUnreadCounts((prev) => ({ ...prev, [activeId]: 0 }))).catch(() => {});
    const sub = comms.subscribeMessages(activeId,
      (m) => {
        setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
        comms.markRead(activeId).catch(() => {});
      },
      (m) => setMessages((prev) => prev.map((x) => x.id === m.id ? m : x)));
    const typingCh = comms.subscribeTyping(activeId, (userId) => {
      if (userId === me?.id) return;
      setTypingUsers((prev) => ({ ...prev, [userId]: Date.now() + 4000 }));
    });
    typingChannelRef.current = typingCh;
    setTypingUsers({});
    return () => { cancelled = true; sub.unsubscribe(); typingCh.unsubscribe(); typingChannelRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => { threadEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  // Caixa de texto cresce com o conteúdo, mesmo padrão do composer de
  // Atendimento — antes ficava sempre travada numa única linha.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId) return;
    setDraft("");
    try { await comms.sendMessage(activeId, body); } catch (e) { toast.error((e as Error).message); }
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (!activeId || !typingChannelRef.current || !me) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current > 2000) {
      lastTypingSentRef.current = now;
      comms.sendTyping(typingChannelRef.current);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, asDocument = false) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeId) return;
    if (file.size > 15 * 1024 * 1024) { toast.error("Arquivo maior que 15MB — envie algo menor."); return; }
    setPendingFile({ file, asDocument });
  };

  const sendPendingFile = async (caption: string) => {
    if (!pendingFile || !activeId) return;
    setUploading(true);
    try {
      const attachment = await comms.uploadAttachment(activeId, pendingFile.file);
      await comms.sendMessage(activeId, caption, attachment);
      setPendingFile(null);
      setDraft("");
    } catch (err) {
      toast.error("Falha ao enviar arquivo: " + (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (m: CommsMessage) => { setEditingId(m.id); setEditDraft(m.body || ""); };
  const cancelEdit = () => { setEditingId(null); setEditDraft(""); };
  const saveEdit = async (id: string) => {
    const body = editDraft.trim();
    if (!body) return;
    try {
      await comms.editMessage(id, body);
      setMessages((prev) => prev.map((x) => x.id === id ? { ...x, body, editedAt: new Date().toISOString() } : x));
      setEditingId(null);
    } catch (e) { toast.error((e as Error).message); }
  };

  const togglePin = async (m: CommsMessage) => {
    try {
      await comms.togglePin(m.id, !m.pinned);
      setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, pinned: !m.pinned } : x));
    } catch (e) { toast.error((e as Error).message); }
  };

  const remove = (m: CommsMessage) => {
    setConfirmState({
      title: "Apagar esta mensagem?",
      onConfirm: async () => {
        try {
          await comms.deleteMessage(m.id);
          setMessages((prev) => prev.filter((x) => x.id !== m.id));
        } catch (e) {
          toast.error("Não foi possível apagar: " + (e as Error).message);
        } finally {
          setConfirmState(null);
        }
      },
    });
  };

  const startDm = async (userId: string) => {
    try {
      const id = await comms.getOrCreateDm(userId);
      setShowColleaguePicker(false);
      await loadServers();
      setActiveId(id);
    } catch (e) { toast.error((e as Error).message); }
  };

  const reloadChannels = async () => {
    if (!activeServerId) return;
    const chs = await comms.listChannels(activeServerId);
    setChannels(chs);
  };

  const deleteCategory = (id: string) => {
    setConfirmState({
      title: "Apagar esta categoria?",
      description: "Os canais dentro dela ficam sem categoria.",
      onConfirm: async () => {
        try {
          await comms.deleteCategory(id);
          setCategories((prev) => prev.filter((c) => c.id !== id));
          await reloadChannels();
        } catch (e) { toast.error((e as Error).message); } finally { setConfirmState(null); }
      },
    });
  };

  const renameCategory = async (id: string, name: string) => {
    try {
      await comms.renameCategory(id, name);
      setCategories((prev) => prev.map((c) => c.id === id ? { ...c, name } : c));
    } catch (e) { toast.error((e as Error).message); }
  };

  const renameChannel = async (id: string, name: string) => {
    try {
      await comms.renameChannel(id, name);
      setChannels((prev) => prev.map((c) => c.id === id ? { ...c, name } : c));
    } catch (e) { toast.error((e as Error).message); }
  };

  const deleteChannel = (c: Channel) => {
    setConfirmState({
      title: `Apagar o canal "${c.name}"?`,
      description: "As mensagens dentro dele somem junto.",
      onConfirm: async () => {
        try {
          await comms.deleteChannel(c.id);
          if (activeId === c.id) setActiveId(null);
          await reloadChannels();
        } catch (e) { toast.error((e as Error).message); } finally { setConfirmState(null); }
      },
    });
  };

  // Ocultar DM (Parte D2) — só quem iniciou a conversa vê a opção (checado no
  // menu, ver renderização abaixo); o backend também valida de novo.
  const hideDm = (c: Channel) => {
    setConfirmState({
      title: "Ocultar esta conversa?",
      description: "Ela some só da sua lista — a outra pessoa continua vendo normalmente. Se você iniciar uma nova conversa com ela, volta a aparecer.",
      confirmLabel: "Ocultar",
      onConfirm: async () => {
        try {
          await comms.hideDm(c.id);
          if (activeId === c.id) setActiveId(null);
          setDms((prev) => prev.filter((d) => d.id !== c.id));
        } catch (e) { toast.error((e as Error).message); } finally { setConfirmState(null); }
      },
    });
  };

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const type = active.data.current?.type as "category" | "channel" | undefined;

    if (type === "category") {
      const oldIndex = categories.findIndex((c) => c.id === active.id);
      const newIndex = categories.findIndex((c) => c.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const reordered = arrayMove(categories, oldIndex, newIndex);
      setCategories(reordered);
      try {
        await Promise.all(reordered.map((c, i) => c.position !== i ? comms.reorderCategory(c.id, i) : null));
      } catch (e) { toast.error((e as Error).message); }
    } else if (type === "channel") {
      const groupKey = active.data.current?.categoryId as string | null;
      const group = channels.filter((c) => c.categoryId === groupKey).sort((a, b) => a.position - b.position);
      const oldIndex = group.findIndex((c) => c.id === active.id);
      const newIndex = group.findIndex((c) => c.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const reorderedGroup = arrayMove(group, oldIndex, newIndex);
      setChannels((prev) => prev.map((c) => {
        const idx = reorderedGroup.findIndex((x) => x.id === c.id);
        return idx >= 0 ? { ...c, position: idx } : c;
      }));
      try {
        await Promise.all(reorderedGroup.map((c, i) => c.position !== i ? comms.reorderChannel(c.id, i) : null));
      } catch (e) { toast.error((e as Error).message); }
    }
  };

  const toggleCollapse = (catId: string) => setCollapsedCats((prev) => {
    const next = new Set(prev);
    if (next.has(catId)) next.delete(catId); else next.add(catId);
    return next;
  });

  const pinned = messages.filter((m) => m.pinned);

  const channelsByCategory = useMemo(() => {
    const map: Record<string, Channel[]> = {};
    const uncategorized: Channel[] = [];
    for (const c of channels) {
      if (c.categoryId) (map[c.categoryId] ||= []).push(c);
      else uncategorized.push(c);
    }
    // Reordenar (arrastar) só atualiza o campo `position` de cada canal — sem
    // reordenar aqui por esse campo, a lista visual nunca refletia a nova
    // ordem mesmo com o valor salvo certo no banco.
    for (const key in map) map[key].sort((a, b) => a.position - b.position);
    uncategorized.sort((a, b) => a.position - b.position);
    return { map, uncategorized };
  }, [channels]);

  const activeServer = servers.find((s) => s.id === activeServerId) || null;

  return (
    <>
      <AppHeader title="Comunicação Interna" subtitle="Canais, grupos e mensagens diretas da equipe — 100% interno, sem WhatsApp" />

      <div className="grid lg:grid-cols-[260px_1fr] gap-3 h-[calc(100vh-9rem)]">
        {/* ─────────── Categorias/canais + DMs ─────────── */}
        <div className="glass-card p-3 overflow-y-auto scrollbar-thin flex flex-col">
          {activeServer && (
            <>
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="text-sm font-semibold truncate">{activeServer.name}</span>
                <button onClick={() => setShowCreateCategory(true)} title="Nova categoria" className="text-muted-foreground hover:text-foreground shrink-0"><Plus className="w-3.5 h-3.5" /></button>
              </div>
              <GradientDivider className="mb-2" />
            </>
          )}

          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {categories.map((cat) => (
                <CategoryBlock
                  key={cat.id}
                  category={cat}
                  channels={channelsByCategory.map[cat.id] || []}
                  collapsed={collapsedCats.has(cat.id)}
                  canDeleteCategory={isSocio || cat.createdBy === me?.id}
                  activeId={activeId}
                  unreadCounts={unreadCounts}
                  isSocio={isSocio}
                  meId={me?.id}
                  onToggleCollapse={() => toggleCollapse(cat.id)}
                  onCreateChannel={() => setCreateChannelCategoryId(cat.id)}
                  onDeleteCategory={() => deleteCategory(cat.id)}
                  onRenameCategory={(name) => renameCategory(cat.id, name)}
                  onSelectChannel={setActiveId}
                  onDeleteChannel={deleteChannel}
                  onRenameChannel={renameChannel}
                />
              ))}
            </SortableContext>

            {channelsByCategory.uncategorized.length > 0 && (
              <div className="mb-2">
                <div className="px-1 text-[10px] font-semibold text-muted-foreground/70 tracking-wider mb-1">SEM CATEGORIA</div>
                <SortableContext items={channelsByCategory.uncategorized.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  {channelsByCategory.uncategorized.map((c) => (
                    <ChannelRow key={c.id} channel={c} categoryId={null} active={c.id === activeId} unread={unreadCounts[c.id]}
                      canDelete={isSocio || c.createdBy === me?.id}
                      onClick={() => setActiveId(c.id)} onDelete={() => deleteChannel(c)}
                      onRename={(name) => renameChannel(c.id, name)} />
                  ))}
                </SortableContext>
              </div>
            )}
          </DndContext>

          {activeServer && categories.length === 0 && channelsByCategory.uncategorized.length === 0 && (
            <p className="px-1 text-xs text-muted-foreground mb-2">Nenhuma categoria ainda — clique no + acima pra criar a primeira.</p>
          )}

          <GradientDivider className="mt-2" />
          <div className="flex items-center justify-between px-1 mb-2 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Diretas</h3>
            <button onClick={() => setShowColleaguePicker(true)} title="Nova DM" className="text-muted-foreground hover:text-foreground">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          {dms.map((d) => {
            const otherId = dmCounterpart[d.id];
            const other = otherId ? profileById[otherId] : null;
            const unread = unreadCounts[d.id];
            return (
              <div
                key={d.id}
                className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors cursor-pointer
                  ${d.id === activeId ? "bg-primary/15 text-foreground" : "text-sidebar-foreground hover:bg-primary/8 hover:text-foreground"}`}
                onClick={() => setActiveId(d.id)}
              >
                <span className="relative shrink-0">
                  <span className="w-6 h-6 rounded-full bg-brandblue/15 flex items-center justify-center text-[10px] font-bold text-brandblue-2">
                    {(other?.fullName || "?").slice(0, 1).toUpperCase()}
                  </span>
                  {otherId && onlineIds.has(otherId) && (
                    <Circle className="w-2 h-2 fill-success text-success absolute -bottom-0.5 -right-0.5" />
                  )}
                </span>
                <span className="truncate flex-1 text-left">{other?.fullName || "…"}</span>
                {!!unread && <span className="text-[10px] font-semibold bg-primary text-primary-foreground rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{unread}</span>}
                {/* Ocultar — só quem INICIOU a DM (Parte D2); some só da própria lista. */}
                {d.createdBy === me?.id && (
                  <button
                    onClick={(e) => { e.stopPropagation(); hideDm(d); }}
                    title="Ocultar conversa"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {dms.length === 0 && <p className="px-2 text-xs text-muted-foreground">Nenhuma DM ainda.</p>}
        </div>

        {/* ─────────── Thread ─────────── */}
        <div className="glass-card p-0 flex flex-col overflow-hidden">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Selecione um canal ou DM</div>
          ) : (
            <>
              <div className="px-5 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  {active.isDm ? (
                    <span className="font-semibold truncate">{profileById[dmCounterpart[active.id]]?.fullName || "Direta"}</span>
                  ) : (
                    <span className="font-semibold truncate">{active.name}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {active.isHandoff && (
                    <Button size="sm" className="btn-glow shrink-0" onClick={() => setShowHandoff(true)}>
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Novo handoff
                    </Button>
                  )}
                  {/* Fechar — só UI (activeId=null), nunca apaga/finaliza nada. */}
                  <Button size="icon" variant="ghost" onClick={() => setActiveId(null)} title="Fechar conversa">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <GradientDivider />

              {pinned.length > 0 && (
                <>
                  <div className="px-5 py-2 bg-muted/10 text-xs space-y-1 shrink-0 max-h-24 overflow-y-auto scrollbar-thin">
                    {pinned.map((m) => (
                      <div key={m.id} className="flex items-center gap-1.5 text-muted-foreground">
                        <Pin className="w-3 h-3 text-primary shrink-0" />
                        <span className="truncate">{profileById[m.authorId]?.fullName}: {m.body}</span>
                      </div>
                    ))}
                  </div>
                  <GradientDivider />
                </>
              )}

              <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-3">
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    author={profileById[m.authorId]}
                    isMe={m.authorId === me?.id}
                    card={m.messageId ? undefined : cards[m.id]}
                    canModerate={me?.role === "socio"}
                    isHandoffChannel={!!active?.isHandoff}
                    isEditing={editingId === m.id}
                    editDraft={editDraft}
                    onEditDraftChange={setEditDraft}
                    onPin={() => togglePin(m)}
                    onDelete={() => remove(m)}
                    onStartEdit={() => startEdit(m)}
                    onCancelEdit={cancelEdit}
                    onSaveEdit={() => saveEdit(m.id)}
                  />
                ))}
                <div ref={threadEndRef} />
              </div>

              {Object.keys(typingUsers).length > 0 && (
                <div className="px-5 pb-1 text-xs text-muted-foreground italic shrink-0">
                  {Object.keys(typingUsers).map((id) => profileById[id]?.fullName || "Alguém").join(", ")} digitando…
                </div>
              )}

              {pendingFile && (
                <FilePreviewDialog
                  file={pendingFile.file}
                  asDocument={pendingFile.asDocument}
                  initialCaption={draft}
                  onCancel={() => setPendingFile(null)}
                  onConfirm={sendPendingFile}
                />
              )}

              <GradientDivider />
              <div className="p-3 flex items-end gap-2 shrink-0 relative">
                <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleFileSelect(e, true)} />
                <input ref={mediaInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => handleFileSelect(e, false)} />
                <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileSelect(e, false)} />
                <div className="relative">
                  <Button size="icon" variant="ghost" onClick={() => setShowAttach((v) => !v)} disabled={uploading} title="Anexar">
                    <Plus className="w-4 h-4" />
                  </Button>
                  {showAttach && (
                    <div className="absolute bottom-full mb-2 left-0 z-20 w-52 rounded-xl border border-border bg-card/95 backdrop-blur shadow-elegant overflow-hidden animate-scale-in">
                      <button onClick={() => { setShowAttach(false); fileInputRef.current?.click(); }}
                        className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10 border-b border-border">
                        <FileText className="w-4 h-4 text-primary" /> Documento
                      </button>
                      <button onClick={() => { setShowAttach(false); mediaInputRef.current?.click(); }}
                        className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10 border-b border-border">
                        <ImageIcon className="w-4 h-4 text-primary" /> Fotos e vídeos
                      </button>
                      <button onClick={() => { setShowAttach(false); audioInputRef.current?.click(); }}
                        className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10">
                        <Mic className="w-4 h-4 text-primary" /> Áudio
                      </button>
                    </div>
                  )}
                </div>
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Escreva uma mensagem…"
                  className="scrollbar-thin-composer flex-1 bg-input/60 rounded-lg pl-3 pr-2 py-2 text-sm resize-none border border-primary/30 focus:border-primary/60 focus:outline-none max-h-32 overflow-y-auto"
                  style={{ scrollbarGutter: "stable" }}
                />
                <Button size="icon" className="btn-glow shrink-0" onClick={send} disabled={uploading}><Send className="w-4 h-4" /></Button>
              </div>
            </>
          )}
        </div>
      </div>

      {showCreateCategory && activeServerId && (
        <CreateCategoryModal
          serverId={activeServerId}
          onClose={() => setShowCreateCategory(false)}
          onCreated={async () => { setShowCreateCategory(false); setCategories(await comms.listCategories(activeServerId)); }}
        />
      )}
      {createChannelCategoryId !== undefined && activeServerId && (
        <CreateChannelModal
          serverId={activeServerId}
          categoryId={createChannelCategoryId}
          profiles={profiles.filter((p) => p.id !== me?.id)}
          onClose={() => setCreateChannelCategoryId(undefined)}
          onCreated={async () => { setCreateChannelCategoryId(undefined); await reloadChannels(); }}
        />
      )}
      {showHandoff && active && (
        <HandoffModal channelId={active.id} onClose={() => setShowHandoff(false)} onCreated={() => setShowHandoff(false)} />
      )}
      {showColleaguePicker && (
        <ColleaguePickerModal profiles={profiles.filter((p) => p.id !== me?.id)} onPick={startDm} onClose={() => setShowColleaguePicker(false)} />
      )}
      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          onCancel={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
        />
      )}
    </>
  );
}

function ChannelRow({ channel, categoryId, active, unread, canDelete, onClick, onDelete, onRename }: {
  channel: Channel; categoryId: string | null; active: boolean; unread?: number; canDelete: boolean;
  onClick: () => void; onDelete: () => void; onRename: (name: string) => void;
}) {
  const roleNames = channel.allowedRoles?.map((r) => ROLE_LABEL[r]).join(", ");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: channel.id, data: { type: "channel", categoryId } });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(channel.name);

  const startRename = (e: React.MouseEvent) => { e.stopPropagation(); setDraft(channel.name); setRenaming(true); };
  const saveRename = () => { setRenaming(false); const v = draft.trim(); if (v && v !== channel.name) onRename(v); };

  return (
    <div
      ref={setNodeRef}
      style={style}
      title={channel.visibility === "role" ? `Visível para: ${roleNames}` : undefined}
      className={`group w-full flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer
        ${active ? "bg-primary/15 text-foreground" : "text-sidebar-foreground hover:bg-primary/8 hover:text-foreground"}`}
      onClick={onClick}
    >
      <button {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground -ml-1">
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      {renaming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={saveRename}
          onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenaming(false); }}
          className="flex-1 min-w-0 bg-input/60 rounded px-1 text-xs outline-none ring-1 ring-primary/50"
        />
      ) : (
        <span className="truncate flex-1 text-left">{channel.name}</span>
      )}
      {!!unread && <span className="text-[10px] font-semibold bg-primary text-primary-foreground rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center shrink-0">{unread}</span>}
      {!renaming && (
        <button onClick={startRename} title="Renomear" className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity shrink-0">
          <Pencil className="w-3 h-3" />
        </button>
      )}
      {canDelete && !renaming && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0">
          <Trash className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function CategoryBlock({ category, channels, collapsed, canDeleteCategory, activeId, unreadCounts, isSocio, meId, onToggleCollapse, onCreateChannel, onDeleteCategory, onRenameCategory, onSelectChannel, onDeleteChannel, onRenameChannel }: {
  category: Category; channels: Channel[]; collapsed: boolean; canDeleteCategory: boolean;
  activeId: string | null; unreadCounts: Record<string, number>; isSocio: boolean; meId: string | undefined;
  onToggleCollapse: () => void; onCreateChannel: () => void; onDeleteCategory: () => void; onRenameCategory: (name: string) => void;
  onSelectChannel: (id: string) => void; onDeleteChannel: (c: Channel) => void; onRenameChannel: (id: string, name: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id, data: { type: "category" } });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(category.name);

  const startRename = () => { setDraft(category.name); setRenaming(true); };
  const saveRename = () => { setRenaming(false); const v = draft.trim(); if (v && v !== category.name) onRenameCategory(v); };

  return (
    <div ref={setNodeRef} style={style} className="mb-2">
      <div className="group flex items-center gap-0.5 px-1 py-1 rounded hover:bg-muted/10">
        <button {...attributes} {...listeners} className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveRename}
            onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenaming(false); }}
            className="flex-1 min-w-0 bg-input/60 rounded px-1 text-sm font-semibold tracking-wide outline-none ring-1 ring-primary/50"
          />
        ) : (
          <button onClick={onToggleCollapse} className="flex items-center gap-1 flex-1 min-w-0">
            {collapsed ? <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />}
            <span className="text-sm font-semibold text-foreground/90 tracking-wide truncate">{category.name}</span>
          </button>
        )}
        {!renaming && (
          <button onClick={startRename} title="Renomear categoria" className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity">
            <Pencil className="w-3 h-3" />
          </button>
        )}
        <button onClick={onCreateChannel} title="Novo canal" className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity">
          <Plus className="w-3 h-3" />
        </button>
        {canDeleteCategory && (
          <button onClick={onDeleteCategory} title="Apagar categoria" className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity">
            <Trash className="w-3 h-3" />
          </button>
        )}
      </div>
      {!collapsed && (
        <SortableContext items={channels.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {channels.map((c) => (
            <ChannelRow key={c.id} channel={c} categoryId={category.id} active={c.id === activeId} unread={unreadCounts[c.id]}
              canDelete={isSocio || c.createdBy === meId} onClick={() => onSelectChannel(c.id)} onDelete={() => onDeleteChannel(c)}
              onRename={(name) => onRenameChannel(c.id, name)} />
          ))}
        </SortableContext>
      )}
    </div>
  );
}

function MessageBubble({ message, author, isMe, card, canModerate, isHandoffChannel, isEditing, editDraft, onEditDraftChange, onPin, onDelete, onStartEdit, onCancelEdit, onSaveEdit }: {
  message: CommsMessage; author?: Profile; isMe: boolean; card?: ClientDataCard; canModerate: boolean; isHandoffChannel: boolean;
  isEditing: boolean; editDraft: string; onEditDraftChange: (v: string) => void;
  onPin: () => void; onDelete: () => void; onStartEdit: () => void; onCancelEdit: () => void; onSaveEdit: () => void;
}) {
  // Dado de cliente OU qualquer mensagem dentro do canal Handoff é imutável
  // (mesma regra do trigger messages_immutable no Postgres) — checar só
  // isClientData deixava o botão "Apagar" aparecer numa mensagem de texto
  // comum dentro do Handoff, que falhava ao clicar (bug corrigido aqui).
  const immutable = message.isClientData || isHandoffChannel;
  const canEdit = !immutable && isMe;
  // Mesma regra de 15 minutos do backend (Parte D1): autor só apaga a
  // própria mensagem dentro da janela; Sócio modera mensagem ALHEIA sem
  // limite de tempo (ver getMessageIfDeletable em comms.js).
  const withinDeleteWindow = Date.now() - new Date(message.createdAt).getTime() <= 15 * 60 * 1000;
  const canDelete = !immutable && ((isMe && withinDeleteWindow) || (!isMe && canModerate));
  return (
    <div className="group flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-full bg-brandblue/15 flex items-center justify-center text-[11px] font-bold text-brandblue-2 shrink-0 mt-0.5">
        {(author?.fullName || "?").slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold">{author?.fullName || "Alguém"}</span>
          <span className="text-[10px] text-muted-foreground">{new Date(message.createdAt).toLocaleString("pt-BR")}</span>
          {message.editedAt && <span className="text-[10px] text-muted-foreground">(editado)</span>}
          {message.pinned && <Pin className="w-2.5 h-2.5 text-primary" />}
        </div>

        {isEditing ? (
          <div className="mt-1 space-y-1.5">
            <Input value={editDraft} onChange={(e) => onEditDraftChange(e.target.value)} className="bg-input/60 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(); if (e.key === "Escape") onCancelEdit(); }} autoFocus />
            <div className="flex items-center gap-2">
              <button onClick={onSaveEdit} className="text-[10px] text-primary hover:underline flex items-center gap-1"><Check className="w-3 h-3" /> Salvar</button>
              <button onClick={onCancelEdit} className="text-[10px] text-muted-foreground hover:text-foreground">Cancelar</button>
            </div>
          </div>
        ) : card ? (
          <HandoffCardView card={card} />
        ) : isMe ? (
          <div className="bubble-sent inline-block max-w-[85%] rounded-xl px-3 py-1.5 mt-0.5">
            {message.body && <p className="text-sm break-words">{message.body}</p>}
            {message.attachmentPath && <AttachmentView path={message.attachmentPath} name={message.attachmentName} type={message.attachmentType} variant="sent" />}
          </div>
        ) : (
          <div className="bubble-received inline-block max-w-[85%] rounded-xl px-3 py-1.5 mt-0.5">
            {message.body && <p className="text-sm break-words">{message.body}</p>}
            {message.attachmentPath && <AttachmentView path={message.attachmentPath} name={message.attachmentName} type={message.attachmentType} variant="received" />}
          </div>
        )}

        {!isEditing && (
          <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onPin} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
              {message.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />} {message.pinned ? "Desafixar" : "Fixar"}
            </button>
            {canEdit && (
              <button onClick={onStartEdit} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                <Pencil className="w-3 h-3" /> Editar
              </button>
            )}
            {canDelete && (
              <button onClick={onDelete} className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1">
                <Trash className="w-3 h-3" /> Apagar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentView({ path, name, type, variant }: { path: string; name: string | null; type: string | null; variant: "sent" | "received" }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    comms.getAttachmentUrl(path).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [path]);

  if (!url) return <div className="mt-1.5 text-xs text-muted-foreground">Carregando anexo…</div>;
  // Mesmo componente de mídia do Atendimento — imagem em miniatura com
  // lightbox em tela cheia (não abre mais aba nova quebrada), documento com
  // nome real, áudio/vídeo com player nativo.
  return (
    <div className="mt-1.5">
      <MediaAttachment mimeType={type} url={url} filename={name} variant={variant} />
    </div>
  );
}

const URGENCIA_STYLE: Record<Urgencia, string> = {
  baixa: "bg-success/15 text-success",
  media: "bg-warning/15 text-warning",
  alta: "bg-destructive/15 text-destructive",
};

function HandoffCardView({ card }: { card: ClientDataCard }) {
  return (
    <div className="mt-1.5 glass-card p-3 max-w-md border border-primary/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold">{card.clienteNome}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${URGENCIA_STYLE[card.urgencia]}`}>{card.urgencia}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div><span className="text-muted-foreground">Perfil: </span>{card.perfil}</div>
        <div><span className="text-muted-foreground">Instrumento: </span>{card.instrumento}</div>
        {card.telefone && <div className="col-span-2"><span className="text-muted-foreground">Telefone: </span>{card.telefone}</div>}
        {card.documento && <div className="col-span-2"><span className="text-muted-foreground">Documento: </span>{card.documento}</div>}
        {card.observacoes && <div className="col-span-2"><span className="text-muted-foreground">Obs.: </span>{card.observacoes}</div>}
      </div>
      <p className="text-[10px] text-success mt-2">✓ Autorização expressa registrada — dado imutável (Seção 13)</p>
    </div>
  );
}

function CreateCategoryModal({ serverId, onClose, onCreated }: { serverId: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return toast.error("Dê um nome à categoria.");
    setBusy(true);
    try {
      await comms.createCategory(serverId, name.trim());
      toast.success("Categoria criada.");
      onCreated();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-sm w-full p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Nova categoria</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <div className="space-y-3">
          <Input placeholder="Nome da categoria (ex: PRODUTO)" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} className="bg-input/60"
            onKeyDown={(e) => { if (e.key === "Enter") create(); }} autoFocus />
          <Button className="btn-glow w-full" disabled={busy} onClick={create}>Criar</Button>
        </div>
      </div>
    </div>
  );
}

function CreateChannelModal({ serverId, categoryId, profiles, onClose, onCreated }: {
  serverId: string; categoryId: string | null; profiles: Profile[]; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "role" | "private">("public");
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggleRole = (r: UserRole) => setRoles((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]);
  const toggleMember = (id: string) => setMembers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const create = async () => {
    if (!name.trim()) return toast.error("Dê um nome ao canal.");
    setBusy(true);
    try {
      await comms.createChannel({ name: name.trim(), description, serverId, categoryId, visibility, allowedRoles: roles, memberIds: members });
      toast.success("Canal criado.");
      onCreated();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-md w-full p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Criar canal de texto</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <div className="space-y-3">
          <Input placeholder="Nome do canal" value={name} onChange={(e) => setName(e.target.value)} className="bg-input/60" autoFocus />
          <Input placeholder="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} className="bg-input/60" />

          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Visibilidade</label>
            <div className="flex gap-1.5">
              {([["public", "Toda a empresa"], ["role", "Por papel"], ["private", "Lista de pessoas"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => setVisibility(v)}
                  className={`flex-1 text-xs px-2 py-2 rounded-lg border transition-colors
                    ${visibility === v ? "border-primary/60 bg-primary/10 text-foreground" : "border-white/[0.06] text-muted-foreground hover:border-primary/30"}`}
                >{label}</button>
              ))}
            </div>
          </div>

          {visibility === "role" && (
            <div className="flex gap-1.5">
              {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
                <button key={r} onClick={() => toggleRole(r)}
                  className={`flex-1 text-xs px-2 py-1.5 rounded-lg border transition-colors
                    ${roles.includes(r) ? "border-primary/60 bg-primary/10" : "border-white/[0.06] text-muted-foreground hover:border-primary/30"}`}
                >{ROLE_LABEL[r]}</button>
              ))}
            </div>
          )}

          {visibility === "private" && (
            <div className="max-h-40 overflow-y-auto scrollbar-thin space-y-1 border border-border rounded-lg p-2">
              {profiles.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-xs px-1 py-1 rounded hover:bg-muted/20 cursor-pointer">
                  <input type="checkbox" checked={members.includes(p.id)} onChange={() => toggleMember(p.id)} className="accent-primary" />
                  {p.fullName} <span className="text-muted-foreground">({ROLE_LABEL[p.role]})</span>
                </label>
              ))}
            </div>
          )}

          <Button className="btn-glow w-full" disabled={busy} onClick={create}>Criar</Button>
        </div>
      </div>
    </div>
  );
}

function ColleaguePickerModal({ profiles, onPick, onClose }: { profiles: Profile[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-sm w-full p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> Iniciar conversa direta</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <div className="space-y-1">
          {profiles.map((p) => (
            <button key={p.id} onClick={() => onPick(p.id)} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-left hover:bg-primary/8 transition-colors">
              <span className="w-7 h-7 rounded-full bg-brandblue/15 flex items-center justify-center text-xs font-bold text-brandblue-2">{p.fullName.slice(0, 1).toUpperCase()}</span>
              {p.fullName} <span className="text-xs text-muted-foreground">({ROLE_LABEL[p.role]})</span>
            </button>
          ))}
          {profiles.length === 0 && <p className="text-xs text-muted-foreground">Nenhum colega cadastrado ainda.</p>}
        </div>
      </div>
    </div>
  );
}

function HandoffModal({ channelId, onClose, onCreated }: { channelId: string; onClose: () => void; onCreated: () => void }) {
  const [clienteNome, setClienteNome] = useState("");
  const [perfil, setPerfil] = useState("");
  const [instrumento, setInstrumento] = useState("");
  const [urgencia, setUrgencia] = useState<Urgencia>("media");
  const [telefone, setTelefone] = useState("");
  const [documento, setDocumento] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [autorizado, setAutorizado] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!clienteNome.trim() || !perfil.trim() || !instrumento.trim()) return toast.error("Nome, perfil e instrumento são obrigatórios.");
    if (!autorizado) return toast.error("Confirme a autorização expressa para registrar dado de cliente (Seção 13 do Manual).");
    setBusy(true);
    try {
      await comms.createHandoffCard(channelId, { clienteNome: clienteNome.trim(), perfil: perfil.trim(), instrumento: instrumento.trim(), urgencia, telefone, documento, observacoes, autorizacaoExpressa: autorizado });
      toast.success("Handoff registrado — imutável a partir de agora.");
      onCreated();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-lg w-full p-6 animate-scale-in max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-warning" /> Novo handoff (dado de cliente)</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Este registro é permanente e não pode ser editado ou apagado (Seção 13 do Manual Operacional).</p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome do cliente"><Input value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} className="bg-input/60" /></Field>
          <Field label="Perfil de investidor"><Input value={perfil} onChange={(e) => setPerfil(e.target.value)} className="bg-input/60" placeholder="ex: moderado" /></Field>
          <Field label="Instrumento que opera"><Input value={instrumento} onChange={(e) => setInstrumento(e.target.value)} className="bg-input/60" placeholder="ex: ações, opções…" /></Field>
          <Field label="Urgência">
            <div className="flex gap-1.5">
              {(["baixa", "media", "alta"] as Urgencia[]).map((u) => (
                <button key={u} onClick={() => setUrgencia(u)}
                  className={`flex-1 text-xs px-2 py-2 rounded-lg border capitalize transition-colors
                    ${urgencia === u ? "border-primary/60 bg-primary/10" : "border-white/[0.06] text-muted-foreground hover:border-primary/30"}`}
                >{u}</button>
              ))}
            </div>
          </Field>
          <Field label="Telefone (real, sem máscara)"><Input value={telefone} onChange={(e) => setTelefone(e.target.value)} className="bg-input/60" /></Field>
          <Field label="Documento (CPF/CNPJ)"><Input value={documento} onChange={(e) => setDocumento(e.target.value)} className="bg-input/60" /></Field>
          <div className="col-span-2">
            <Field label="Observações">
              <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} className="bg-input/60" rows={3} />
            </Field>
          </div>
        </div>

        <label className="flex items-start gap-2 mt-4 p-3 rounded-lg bg-warning/10 border border-warning/30 cursor-pointer">
          <input type="checkbox" checked={autorizado} onChange={(e) => setAutorizado(e.target.checked)} className="accent-primary mt-0.5" />
          <span className="text-xs">Confirmo que tenho <strong>autorização expressa</strong> para compartilhar este dado de cliente com o Operacional, conforme a Seção 13 do Manual Operacional.</span>
        </label>

        <Button className="btn-glow w-full mt-4" disabled={busy || !autorizado} onClick={create}>Registrar handoff</Button>
      </div>
    </div>
  );
}


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
