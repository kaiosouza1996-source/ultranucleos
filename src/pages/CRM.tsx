import { AppHeader } from "@/components/AppHeader";
import { useAppStore, type Contact, type PipelineStage } from "@/store/appStore";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, Search, X, Plus, History, Settings2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatPhoneDisplay } from "@/lib/phone";
import { toast } from "@/hooks/use-toast";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent, useDraggable, useDroppable,
} from "@dnd-kit/core";
import { Link } from "react-router-dom";
import { api } from "@/lib/engine";
import { ContactFormDialog } from "@/components/ContactFormDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { funis as funisApi, type Funil } from "@/lib/funis";

const STAGE_COLORS = [
  "213 90% 55%", "265 85% 65%", "330 85% 60%", "160 70% 45%",
  "35 90% 55%", "0 75% 60%", "190 80% 50%", "45 95% 55%",
];
interface BoardStage { key: string; label: string; color: string; terminal?: boolean }

export default function CRM() {
  const contacts    = useAppStore((s) => s.contacts);
  const stages      = useAppStore((s) => s.pipelineStages);
  const moveContact = useAppStore((s) => s.moveContactStage);
  const history     = useAppStore((s) => s.pipelineHistory);

  const [search, setSearch]   = useState("");
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Aba ativa: "__principal__" é o Funil do CRM de sempre (por usuário,
  // intocado); qualquer outro valor é o id de um funil customizado
  // (compartilhado por toda a equipe — Parte B).
  const [tab, setTab] = useState("__principal__");
  const [customFunis, setCustomFunis] = useState<Funil[]>([]);
  const [funilContatos, setFunilContatos] = useState<Record<string, Record<string, string>>>({});
  const [showCreateFunil, setShowCreateFunil] = useState(false);
  const [managingFunil, setManagingFunil] = useState<Funil | null>(null);

  const loadFunis = async () => {
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
    } catch (e) {
      toast({ title: "Erro ao carregar funis", description: (e as Error).message, variant: "destructive" });
    }
  };
  useEffect(() => { loadFunis(); }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const filtered = useMemo(() => contacts.filter((c) =>
    !search ||
    c.nome.toLowerCase().includes(search.toLowerCase()) ||
    c.telefone.includes(search) ||
    (c.empresa || "").toLowerCase().includes(search.toLowerCase())
  ), [contacts, search]);

  // ── Funil do CRM (padrão, comportamento intocado) ──
  const principalFiltered = useMemo(() => filtered.filter((c) =>
    // CRM é o funil de atendimento ativo — só mostra quem já tem uma etapa de
    // verdade (contact_stage real), nunca um contato recém-importado que
    // ninguém ainda tocou (ver hasCrmStage em GET /contacts + skipStage).
    c.hasCrmStage
  ), [filtered]);
  const principalByStage = useMemo(() => {
    const map: Record<string, Contact[]> = {};
    for (const s of stages) map[s.key] = [];
    const fallback = stages[0]?.key ?? "novo";
    for (const c of principalFiltered) {
      const k = c.status && map[c.status] !== undefined ? c.status : fallback;
      map[k].push(c);
    }
    return map;
  }, [principalFiltered, stages]);

  const handleMovePrincipal = (contactId: string, toKey: string) => {
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact || contact.status === toKey) return;
    const stage = stages.find((s) => s.key === toKey);
    moveContact(contactId, toKey);
    api.moveContactStage(contactId, toKey).catch(() => {});
    toast({ title: `Movido para ${stage?.label ?? toKey}`, description: contact.nome });
  };

  // ── Funil customizado ativo ──
  const activeFunil = tab === "__principal__" ? null : customFunis.find((f) => f.id === tab) ?? null;

  const customBoardStages: BoardStage[] = useMemo(() => {
    if (!activeFunil) return [];
    return activeFunil.etapas
      .slice()
      .sort((a, b) => a.ordem - b.ordem)
      .map((e, i) => ({ key: e.id, label: e.nome, color: e.cor || STAGE_COLORS[i % STAGE_COLORS.length] }));
  }, [activeFunil]);

  const customByStage = useMemo(() => {
    const map: Record<string, Contact[]> = {};
    if (!activeFunil) return map;
    for (const s of customBoardStages) map[s.key] = [];
    const assigned = funilContatos[activeFunil.id] || {};
    for (const c of filtered) {
      // Atribuição a funil customizado é SEMPRE manual (Parte T8) — um
      // contato sem etapa aqui simplesmente não aparece neste board (nunca
      // um bucket "Sem etapa" reunindo todo mundo que nunca foi atribuído;
      // isso era um bug visual, não uma atribuição real no backend).
      const etapaId = assigned[c.id];
      if (etapaId && map[etapaId] !== undefined) map[etapaId].push(c);
    }
    return map;
  }, [activeFunil, customBoardStages, filtered, funilContatos]);

  const handleMoveCustom = async (contactId: string, toKey: string) => {
    if (!activeFunil) return;
    const funilId = activeFunil.id;
    setFunilContatos((prev) => ({ ...prev, [funilId]: { ...(prev[funilId] || {}), [contactId]: toKey } }));
    try {
      await funisApi.setContatoEtapa(funilId, contactId, toKey);
    } catch (e) {
      toast({ title: "Erro ao mover contato", description: (e as Error).message, variant: "destructive" });
      loadFunis();
    }
  };

  return (
    <>
      <AppHeader title="CRM" subtitle="Pipeline visual — arraste contatos entre as etapas" />

      <div className="glass-card p-3 mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 bg-input/60"
            placeholder="Buscar cliente, telefone ou empresa…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowHistory(true)}>
          <History className="w-4 h-4 mr-1.5" /> Histórico
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/configuracoes#crm">
            <Settings2 className="w-4 h-4 mr-1.5" /> Configurar CRM
          </Link>
        </Button>
        <Button className="btn-glow" size="sm" onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Novo contato
        </Button>
      </div>

      <div className="flex items-center gap-1 mb-3 overflow-x-auto scrollbar-thin">
        <button onClick={() => setTab("__principal__")} className={tabClass(tab === "__principal__")}>
          Funil do CRM
        </button>
        {customFunis.map((f) => (
          <button key={f.id} onClick={() => setTab(f.id)} className={tabClass(tab === f.id)}>
            {f.nome}
          </button>
        ))}
        <Button size="icon" variant="ghost" className="shrink-0" title="Criar novo funil" onClick={() => setShowCreateFunil(true)}>
          <Plus className="w-4 h-4" />
        </Button>
        {activeFunil && (
          <Button size="icon" variant="ghost" className="shrink-0" title="Gerenciar funil" onClick={() => setManagingFunil(activeFunil)}>
            <Settings2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      {tab === "__principal__" ? (
        <Board
          sensors={sensors}
          stages={stages}
          byStage={principalByStage}
          onMove={handleMovePrincipal}
          onClickContact={(c) => setEditing(c)}
        />
      ) : activeFunil ? (
        <Board
          sensors={sensors}
          stages={customBoardStages}
          byStage={customByStage}
          onMove={handleMoveCustom}
          onClickContact={(c) => setEditing(c)}
        />
      ) : (
        <div className="text-center text-sm text-muted-foreground py-12">Carregando…</div>
      )}

      {editing && (
        <ContactFormDialog mode="edit" contact={editing} onClose={() => setEditing(null)} />
      )}

      {creating && (
        <ContactFormDialog mode="create" onClose={() => setCreating(false)} />
      )}

      {showHistory && (
        <HistoryDialog
          history={history}
          contacts={contacts}
          stages={stages}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showCreateFunil && (
        <CreateFunilDialog
          onClose={() => setShowCreateFunil(false)}
          onCreated={(f) => { setCustomFunis((prev) => [...prev, f]); setFunilContatos((prev) => ({ ...prev, [f.id]: {} })); setTab(f.id); setShowCreateFunil(false); }}
        />
      )}

      {managingFunil && (
        <ManageFunilDialog
          funil={managingFunil}
          onClose={() => setManagingFunil(null)}
          onChanged={loadFunis}
          onDeleted={() => { setTab("__principal__"); setManagingFunil(null); loadFunis(); }}
        />
      )}
    </>
  );
}

function tabClass(active: boolean) {
  return `shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
    active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40"
  }`;
}

// ─────────────────────── Board genérico (dnd-kit) ───────────────────────
function Board({
  sensors, stages, byStage, onMove, onClickContact,
}: {
  sensors: ReturnType<typeof useSensors>;
  stages: BoardStage[];
  byStage: Record<string, Contact[]>;
  onMove: (contactId: string, toKey: string) => void;
  onClickContact: (c: Contact) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const allContacts = useMemo(() => Object.values(byStage).flat(), [byStage]);
  const activeContact = activeId ? allContacts.find((c) => c.id === activeId) : null;

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const handleDragOver = (e: { over: { id: string | number } | null }) => setOverStage(e.over ? String(e.over.id) : null);
  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null); setOverStage(null);
    if (!e.over) return;
    onMove(String(e.active.id), String(e.over.id));
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setActiveId(null); setOverStage(null); }}
    >
      <div className="overflow-x-auto scrollbar-thin pb-3">
        <div className="flex gap-3 min-w-max">
          {stages.map((stage) => (
            <StageColumn
              key={stage.key}
              stage={stage}
              contacts={byStage[stage.key] || []}
              isOver={overStage === stage.key}
              onClickContact={onClickContact}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activeContact ? <ContactCard contact={activeContact} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─────────────────────── Coluna ───────────────────────
function StageColumn({
  stage, contacts, isOver, onClickContact,
}: {
  stage: BoardStage;
  contacts: Contact[];
  isOver: boolean;
  onClickContact: (c: Contact) => void;
}) {
  const { setNodeRef } = useDroppable({ id: stage.key });
  return (
    <div className="w-72 shrink-0">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: `hsl(${stage.color})`, boxShadow: `0 0 8px hsl(${stage.color})` }}
          />
          <h3 className="text-sm font-semibold">{stage.label}</h3>
          {stage.terminal && (
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">final</span>
          )}
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground">
          {contacts.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto scrollbar-thin pr-1 p-2 rounded-lg border-2 border-dashed transition-all ${
          isOver
            ? "border-primary bg-primary/10 shadow-[0_0_24px_hsl(var(--primary)/0.25)_inset]"
            : "border-transparent"
        }`}
      >
        {contacts.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-6 border border-dashed border-border rounded-lg">
            {isOver ? "Solte aqui" : "Vazio"}
          </div>
        )}
        {contacts.map((c) => (
          <DraggableCard key={c.id} contact={c} onClick={() => onClickContact(c)} />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({ contact, onClick }: { contact: Contact; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: contact.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`outline-none touch-none ${isDragging ? "opacity-30" : ""}`}
    >
      <ContactCard contact={contact} />
    </div>
  );
}

function ContactCard({ contact, dragging }: { contact: Contact; dragging?: boolean }) {
  return (
    <div
      className={`glass-card p-3 cursor-grab active:cursor-grabbing transition-all
        ${dragging
          ? "shadow-[0_20px_60px_-10px_hsl(213_100%_30%/0.6)] border-primary/60 rotate-1 scale-105"
          : "hover:border-primary/40 animate-fade-in"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{contact.nome}</div>
          <div className="text-[11px] text-muted-foreground truncate font-mono">
            {formatPhoneDisplay(contact.telefone)}
          </div>
        </div>
        <Briefcase className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </div>
      {contact.empresa && (
        <div className="text-xs text-muted-foreground mt-1.5 truncate">🏢 {contact.empresa}</div>
      )}
      {contact.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {contact.tags.slice(0, 3).map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
              {t}
            </span>
          ))}
          {contact.tags.length > 3 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground">
              +{contact.tags.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────── Histórico ───────────────────────
function HistoryDialog({
  history, contacts, stages, onClose,
}: {
  history: ReturnType<typeof useAppStore.getState>["pipelineHistory"];
  contacts: Contact[];
  stages: PipelineStage[];
  onClose: () => void;
}) {
  const stageLabel = (k: string | null) =>
    k ? (stages.find((s) => s.key === k)?.label ?? k) : "—";
  const contactName = (id: string) => contacts.find((c) => c.id === id)?.nome ?? "(removido)";

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="glass-card max-w-2xl w-full p-6 animate-scale-in max-h-[80vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <History className="w-4 h-4" /> Histórico de movimentações
          </h3>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {history.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">
            Nenhuma movimentação ainda.
          </div>
        ) : (
          <ul className="space-y-2">
            {history.slice(0, 100).map((e) => (
              <li key={e.id} className="text-sm flex items-center justify-between border-b border-border pb-2">
                <div>
                  <div className="font-medium">{contactName(e.contactId)}</div>
                  <div className="text-xs text-muted-foreground">
                    {stageLabel(e.from)} → <span className="text-primary">{stageLabel(e.to)}</span>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {new Date(e.ts).toLocaleString("pt-BR")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─────────────────────── Criar funil ───────────────────────
function CreateFunilDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (f: Funil) => void }) {
  const [nome, setNome] = useState("");
  const [etapas, setEtapas] = useState<{ nome: string; cor: string }[]>([
    { nome: "Novo", cor: STAGE_COLORS[0] },
    { nome: "Em andamento", cor: STAGE_COLORS[1] },
    { nome: "Concluído", cor: STAGE_COLORS[3] },
  ]);
  const [saving, setSaving] = useState(false);

  const addEtapa = () => setEtapas((prev) => [...prev, { nome: "", cor: STAGE_COLORS[prev.length % STAGE_COLORS.length] }]);
  const removeEtapa = (i: number) => setEtapas((prev) => prev.filter((_, idx) => idx !== i));
  const updateEtapa = (i: number, patch: Partial<{ nome: string; cor: string }>) =>
    setEtapas((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  const canSave = nome.trim() && etapas.some((e) => e.nome.trim());
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const f = await funisApi.create(
        nome.trim(),
        etapas.filter((e) => e.nome.trim()).map((e, i) => ({ nome: e.nome.trim(), cor: e.cor, ordem: i })),
      );
      toast({ title: "Funil criado", description: f.nome });
      onCreated(f);
    } catch (e) {
      toast({ title: "Erro ao criar funil", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-md w-full p-6 animate-scale-in max-h-[85vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Novo funil compartilhado</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Visível para toda a equipe — diferente do Funil do CRM padrão, que continua individual.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Nome do funil</label>
            <Input className="bg-input/60 mt-1" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Recuperação de clientes" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Etapas</label>
            <div className="space-y-2 mt-1">
              {etapas.map((e, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: `hsl(${e.cor})` }} />
                  <Input
                    className="bg-input/60 h-8 text-sm"
                    value={e.nome}
                    onChange={(ev) => updateEtapa(i, { nome: ev.target.value })}
                    placeholder={`Etapa ${i + 1}`}
                  />
                  <button onClick={() => removeEtapa(i)} className="text-muted-foreground hover:text-destructive shrink-0" title="Remover etapa">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={addEtapa}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar etapa
            </Button>
          </div>
        </div>
        <div className="flex gap-2 mt-6 justify-end">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="btn-glow" onClick={save} disabled={!canSave || saving}>
            {saving ? "Criando…" : "Criar funil"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────── Gerenciar funil ───────────────────────
function ManageFunilDialog({
  funil, onClose, onChanged, onDeleted,
}: {
  funil: Funil;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [nome, setNome] = useState(funil.nome);
  const [etapas, setEtapas] = useState(funil.etapas.slice().sort((a, b) => a.ordem - b.ordem));
  const [newEtapaNome, setNewEtapaNome] = useState("");
  const [confirmDeleteFunil, setConfirmDeleteFunil] = useState(false);
  const [confirmDeleteEtapa, setConfirmDeleteEtapa] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saveNome = async () => {
    if (!nome.trim() || nome.trim() === funil.nome) return;
    try {
      await funisApi.rename(funil.id, nome.trim());
      onChanged();
    } catch (e) {
      toast({ title: "Erro ao renomear funil", description: (e as Error).message, variant: "destructive" });
    }
  };

  const renameEtapa = async (etapaId: string, novoNome: string) => {
    try {
      await funisApi.renameEtapa(funil.id, etapaId, novoNome);
      onChanged();
    } catch (e) {
      toast({ title: "Erro ao renomear etapa", description: (e as Error).message, variant: "destructive" });
    }
  };

  const addEtapa = async () => {
    if (!newEtapaNome.trim()) return;
    try {
      const created = await funisApi.addEtapa(funil.id, { nome: newEtapaNome.trim(), cor: STAGE_COLORS[etapas.length % STAGE_COLORS.length] });
      setEtapas((prev) => [...prev, created]);
      setNewEtapaNome("");
      onChanged();
    } catch (e) {
      toast({ title: "Erro ao adicionar etapa", description: (e as Error).message, variant: "destructive" });
    }
  };

  const removeEtapa = async (etapaId: string) => {
    setBusy(true);
    try {
      await funisApi.removeEtapa(funil.id, etapaId);
      setEtapas((prev) => prev.filter((e) => e.id !== etapaId));
      onChanged();
    } catch (e) {
      toast({ title: "Erro ao remover etapa", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
      setConfirmDeleteEtapa(null);
    }
  };

  const removeFunil = async () => {
    setBusy(true);
    try {
      await funisApi.remove(funil.id);
      toast({ title: "Funil excluído" });
      onDeleted();
    } catch (e) {
      toast({ title: "Erro ao excluir funil", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
      setConfirmDeleteFunil(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-md w-full p-6 animate-scale-in max-h-[85vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Gerenciar funil</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Nome do funil</label>
            <Input className="bg-input/60 mt-1" value={nome} onChange={(e) => setNome(e.target.value)} onBlur={saveNome} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Etapas</label>
            <div className="space-y-2 mt-1">
              {etapas.map((e) => (
                <div key={e.id} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: `hsl(${e.cor || "213 90% 55%"})` }} />
                  <Input
                    className="bg-input/60 h-8 text-sm"
                    defaultValue={e.nome}
                    onBlur={(ev) => { if (ev.target.value.trim() && ev.target.value.trim() !== e.nome) renameEtapa(e.id, ev.target.value.trim()); }}
                  />
                  <button onClick={() => setConfirmDeleteEtapa(e.id)} className="text-muted-foreground hover:text-destructive shrink-0" title="Remover etapa">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Input className="bg-input/60 h-8 text-sm" value={newEtapaNome} onChange={(e) => setNewEtapaNome(e.target.value)} placeholder="Nova etapa" />
              <Button size="sm" variant="ghost" onClick={addEtapa} disabled={!newEtapaNome.trim()}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar
              </Button>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-6">
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDeleteFunil(true)}>
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Excluir funil
          </Button>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </div>
      </div>

      {confirmDeleteFunil && (
        <ConfirmDialog
          title={`Excluir o funil "${funil.nome}"?`}
          description="Todos os contatos posicionados neste funil perdem essa etapa. Não afeta o Funil do CRM padrão nem os outros funis."
          confirmLabel={busy ? "Excluindo…" : "Excluir funil"}
          onCancel={() => setConfirmDeleteFunil(false)}
          onConfirm={removeFunil}
        />
      )}
      {confirmDeleteEtapa && (
        <ConfirmDialog
          title="Excluir esta etapa?"
          description="Contatos nesta etapa migram automaticamente para a primeira etapa restante do funil."
          confirmLabel={busy ? "Excluindo…" : "Excluir etapa"}
          onCancel={() => setConfirmDeleteEtapa(null)}
          onConfirm={() => removeEtapa(confirmDeleteEtapa)}
        />
      )}
    </div>
  );
}
