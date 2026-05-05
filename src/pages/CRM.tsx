import { AppHeader } from "@/components/AppHeader";
import { useAppStore, type Contact, type CustomField, type PipelineStage } from "@/store/appStore";
import { useMemo, useState } from "react";
import { Briefcase, Search, Pencil, X, Plus, History, Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone";
import { toast } from "@/hooks/use-toast";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent, useDraggable, useDroppable,
} from "@dnd-kit/core";
import { Link } from "react-router-dom";
import { api } from "@/lib/engine";

export default function CRM() {
  const contacts        = useAppStore((s) => s.contacts);
  const stages          = useAppStore((s) => s.pipelineStages);
  const customFields    = useAppStore((s) => s.customFields);
  const moveContact     = useAppStore((s) => s.moveContactStage);
  const updateContact   = useAppStore((s) => s.updateContact);
  const addContacts     = useAppStore((s) => s.addContacts);
  const history         = useAppStore((s) => s.pipelineHistory);

  const [search, setSearch]   = useState("");
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const filtered = useMemo(() => contacts.filter((c) =>
    !search ||
    c.nome.toLowerCase().includes(search.toLowerCase()) ||
    c.telefone.includes(search) ||
    (c.empresa || "").toLowerCase().includes(search.toLowerCase())
  ), [contacts, search]);

  const byStage = useMemo(() => {
    const map: Record<string, Contact[]> = {};
    for (const s of stages) map[s.key] = [];
    const fallback = stages[0]?.key ?? "novo";
    for (const c of filtered) {
      const k = c.status && map[c.status] !== undefined ? c.status : fallback;
      map[k].push(c);
    }
    return map;
  }, [filtered, stages]);

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  };

  const handleDragOver = (e: { over: { id: string | number } | null }) => {
    setOverStage(e.over ? String(e.over.id) : null);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null); setOverStage(null);
    if (!e.over) return;
    const contactId = String(e.active.id);
    const toKey = String(e.over.id);
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact || contact.status === toKey) return;
    const stage = stages.find((s) => s.key === toKey);
    moveContact(contactId, toKey);
    api.moveContactStage(contactId, toKey).catch(() => {});
    toast({
      title: `Movido para ${stage?.label ?? toKey}`,
      description: contact.nome,
    });
  };

  const activeContact = activeId ? contacts.find((c) => c.id === activeId) : null;

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
                contacts={byStage[stage.key]}
                isOver={overStage === stage.key}
                onClickContact={(c) => setEditing(c)}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeContact ? <ContactCard contact={activeContact} dragging /> : null}
        </DragOverlay>
      </DndContext>

      {editing && (
        <ContactDialog
          contact={editing}
          stages={stages}
          customFields={customFields}
          onClose={() => setEditing(null)}
          onSave={(p) => { updateContact(editing.id, p); setEditing(null); }}
        />
      )}

      {creating && (
        <ContactDialog
          contact={null}
          stages={stages}
          customFields={customFields}
          onClose={() => setCreating(false)}
          onSave={(p) => {
            const tel = normalizePhone(String(p.telefone || ""));
            if (!tel) {
              toast({ title: "Telefone inválido", description: "Informe um número válido.", variant: "destructive" });
              return;
            }
            const { telefone: _drop, ...rest } = p;
            void _drop;
            addContacts([{
              id: crypto.randomUUID(),
              nome: String(p.nome || "Sem nome"),
              tags: [],
              createdAt: Date.now(),
              ...rest,
              telefone: tel,
            } as Contact]);
            setCreating(false);
            toast({ title: "Contato criado" });
          }}
        />
      )}

      {showHistory && (
        <HistoryDialog
          history={history}
          contacts={contacts}
          stages={stages}
          onClose={() => setShowHistory(false)}
        />
      )}
    </>
  );
}

// ─────────────────────── Coluna ───────────────────────
function StageColumn({
  stage, contacts, isOver, onClickContact,
}: {
  stage: PipelineStage;
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
          <div className="text-center text-xs text-muted-foreground py-6 border border-dashed border-border/30 rounded-lg">
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

// ─────────────────────── Dialog ───────────────────────
function ContactDialog({
  contact, stages, customFields, onClose, onSave,
}: {
  contact: Contact | null;
  stages: PipelineStage[];
  customFields: CustomField[];
  onClose: () => void;
  onSave: (p: Partial<Contact>) => void;
}) {
  const [data, setData] = useState({
    nome: contact?.nome ?? "",
    telefone: contact?.telefone ?? "",
    email: contact?.email ?? "",
    documento: contact?.documento ?? "",
    empresa: contact?.empresa ?? "",
    origem: contact?.origem ?? "",
    status: contact?.status ?? stages[0]?.key ?? "novo",
    observacoes: contact?.observacoes ?? "",
    tags: contact?.tags.join(", ") ?? "",
  });
  const [custom, setCustom] = useState<Record<string, string | number | boolean>>(
    contact?.customData ?? {},
  );

  const setCustomVal = (key: string, v: string | number | boolean) =>
    setCustom((prev) => ({ ...prev, [key]: v }));

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="glass-card max-w-2xl w-full p-6 animate-scale-in max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">{contact ? "Ficha do cliente" : "Novo contato"}</h3>
            <p className="text-xs text-muted-foreground">
              {contact ? formatPhoneDisplay(contact.telefone) : "Preencha os dados abaixo"}
            </p>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome">
            <Input value={data.nome} onChange={(e) => setData({ ...data, nome: e.target.value })} />
          </Field>
          <Field label="Telefone">
            <Input
              value={data.telefone}
              onChange={(e) => setData({ ...data, telefone: e.target.value })}
              disabled={!!contact}
              placeholder="55 11 99999-9999"
            />
          </Field>
          <Field label="E-mail">
            <Input value={data.email} onChange={(e) => setData({ ...data, email: e.target.value })} />
          </Field>
          <Field label="Empresa">
            <Input value={data.empresa} onChange={(e) => setData({ ...data, empresa: e.target.value })} />
          </Field>
          <Field label="CPF/CNPJ">
            <Input value={data.documento} onChange={(e) => setData({ ...data, documento: e.target.value })} />
          </Field>
          <Field label="Origem">
            <Input
              placeholder="Instagram, indicação, site…"
              value={data.origem}
              onChange={(e) => setData({ ...data, origem: e.target.value })}
            />
          </Field>
          <Field label="Etapa">
            <select
              value={data.status}
              onChange={(e) => setData({ ...data, status: e.target.value })}
              className="w-full bg-input rounded px-3 py-2 text-sm border border-border/40"
            >
              {stages.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Tags (vírgula)">
            <Input value={data.tags} onChange={(e) => setData({ ...data, tags: e.target.value })} />
          </Field>
          <Field label="Observações" full>
            <textarea
              rows={3}
              value={data.observacoes}
              onChange={(e) => setData({ ...data, observacoes: e.target.value })}
              className="w-full bg-input rounded px-3 py-2 text-sm border border-border/40"
            />
          </Field>

          {customFields.length > 0 && (
            <div className="col-span-2 mt-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Campos personalizados
              </div>
              <div className="grid grid-cols-2 gap-3">
                {customFields.map((f) => (
                  <Field key={f.id} label={f.label} full={f.type === "checkbox"}>
                    <CustomFieldInput
                      field={f}
                      value={custom[f.key]}
                      onChange={(v) => setCustomVal(f.key, v)}
                    />
                  </Field>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-5 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            className="btn-glow"
            onClick={() => onSave({
              ...data,
              tags: data.tags.split(",").map((t) => t.trim()).filter(Boolean),
              customData: custom,
            })}
          >
            <Pencil className="w-4 h-4 mr-1" /> Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}

function CustomFieldInput({
  field, value, onChange,
}: {
  field: CustomField;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-primary"
        />
        <span className="text-muted-foreground">Sim / Não</span>
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <select
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input rounded px-3 py-2 text-sm border border-border/40"
      >
        <option value="">—</option>
        {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.type === "number") {
    return (
      <Input
        type="number"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
    );
  }
  if (field.type === "date") {
    return <Input type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
  return <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
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
              <li key={e.id} className="text-sm flex items-center justify-between border-b border-border/30 pb-2">
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
