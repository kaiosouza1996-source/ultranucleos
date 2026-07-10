import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GradientDivider } from "@/components/GradientDivider";
import { ContactCadenceFields, type CadenceFieldsValue } from "@/components/ContactCadenceFields";
import { useAppStore, type Contact, type CustomField } from "@/store/appStore";
import { api } from "@/lib/engine";
import { funis as funisApi, type Funil, DEFAULT_FUNIL_ID } from "@/lib/funis";
import { normalizePhone, formatPhoneDisplay } from "@/lib/phone";
import { X } from "lucide-react";
import { toast } from "sonner";

/**
 * Ficha de contato ÚNICA e completa — usada em toda instância de
 * criação/edição (Contatos, CRM, Atendimento). Antes cada tela tinha seu
 * próprio dialog parcial (uns só tinham nome/e-mail/empresa, outros tinham
 * o conjunto completo) — inconsistência que confundia o atendente sobre
 * onde cada dado podia ser editado. Este componente sempre mostra TODOS os
 * campos: dados básicos, tags, etapa do CRM, observações, campos
 * personalizados e a seção de Assessoria &amp; Cadência.
 */
export function ContactFormDialog({
  mode, contact, defaultTelefone, defaultNome, onClose,
}: {
  mode: "create" | "edit";
  contact?: Contact | null;
  defaultTelefone?: string;
  defaultNome?: string;
  onClose: () => void;
}) {
  const existingContacts = useAppStore((s) => s.contacts);
  const addContacts = useAppStore((s) => s.addContacts);
  const updateContact = useAppStore((s) => s.updateContact);
  const moveContactStage = useAppStore((s) => s.moveContactStage);
  const pipelineStages = useAppStore((s) => s.pipelineStages);
  const customFields = useAppStore((s) => s.customFields);

  const [nome, setNome] = useState(contact?.nome ?? defaultNome ?? "");
  const [telefone, setTelefone] = useState(contact?.telefone ?? defaultTelefone ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [empresa, setEmpresa] = useState(contact?.empresa ?? "");
  const [documento, setDocumento] = useState(contact?.documento ?? "");
  const [origem, setOrigem] = useState(contact?.origem ?? "");
  const [tags, setTags] = useState(contact?.tags.join(", ") ?? "");
  const [observacoes, setObservacoes] = useState(contact?.observacoes ?? "");
  const [custom, setCustom] = useState<Record<string, string | number | boolean>>(contact?.customData ?? {});

  // Funil → etapa em cascata (nunca lista as etapas de todos os funis de uma
  // vez): "Funil do CRM" (padrão, por usuário) vem pré-selecionado com a
  // etapa atual do contato; trocar pra um funil customizado busca a
  // atribuição atual do contato NAQUELE funil (se existir) só nesse momento,
  // não antecipadamente pra todos os funis.
  const [customFunis, setCustomFunis] = useState<Funil[]>([]);
  useEffect(() => { funisApi.list().then(setCustomFunis).catch(() => {}); }, []);
  const [funilId, setFunilId] = useState(DEFAULT_FUNIL_ID);
  const [etapaId, setEtapaId] = useState(contact?.status ?? pipelineStages[0]?.key ?? "novo");
  const [customEtapaCache, setCustomEtapaCache] = useState<Record<string, string>>({});
  const etapaOptions = funilId === DEFAULT_FUNIL_ID
    ? pipelineStages.map((s) => ({ id: s.key, label: s.label }))
    : (customFunis.find((f) => f.id === funilId)?.etapas ?? []).map((et) => ({ id: et.id, label: et.nome }));
  const changeFunil = async (id: string) => {
    setFunilId(id);
    if (id === DEFAULT_FUNIL_ID) {
      setEtapaId(contact?.status ?? pipelineStages[0]?.key ?? "novo");
      return;
    }
    const firstEtapa = customFunis.find((f) => f.id === id)?.etapas[0]?.id ?? "";
    if (contact && !(id in customEtapaCache)) {
      try {
        const rows = await funisApi.contatos(id);
        const mine = rows.find((r) => r.contatoId === contact.id)?.etapaId ?? "";
        setCustomEtapaCache((prev) => ({ ...prev, [id]: mine }));
        setEtapaId(mine || firstEtapa);
        return;
      } catch { /* segue com a primeira etapa */ }
    }
    setEtapaId(customEtapaCache[id] || firstEtapa);
  };
  const [cadence, setCadence] = useState<CadenceFieldsValue>({
    isClient: !!contact?.isClient,
    atuaMercadoFinanceiro: contact?.atuaMercadoFinanceiro ?? "",
    responsavelId: contact?.responsavelId ?? "",
  });

  const setCustomVal = (key: string, v: string | number | boolean) =>
    setCustom((prev) => ({ ...prev, [key]: v }));

  const save = () => {
    const tagList = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    const cadencePatch = {
      isClient: cadence.isClient,
      atuaMercadoFinanceiro: cadence.atuaMercadoFinanceiro || null,
      responsavelId: cadence.responsavelId || null,
    };

    if (mode === "create") {
      const tel = normalizePhone(telefone);
      if (!tel) { toast.error("Telefone inválido"); return; }
      if (existingContacts.some((c) => c.telefone === tel)) { toast.error("Telefone já cadastrado"); return; }
      const novo: Contact = {
        id: crypto.randomUUID(),
        nome: nome.trim() || tel,
        telefone: tel,
        email: email.trim() || undefined,
        empresa: empresa.trim() || undefined,
        documento: documento.trim() || undefined,
        origem: origem.trim() || undefined,
        observacoes: observacoes.trim() || undefined,
        tags: tagList,
        status: funilId === DEFAULT_FUNIL_ID ? etapaId : (pipelineStages[0]?.key ?? "novo"),
        customData: custom,
        createdAt: Date.now(),
        ...cadencePatch,
      };
      addContacts([novo]);
      api.pushContacts([novo]).catch(() => {});
      if (funilId !== DEFAULT_FUNIL_ID && etapaId) {
        funisApi.setContatoEtapa(funilId, novo.id, etapaId).catch(() => {});
      }
      toast.success("Contato criado");
    } else if (contact) {
      const patch: Partial<Contact> = {
        nome: nome.trim() || contact.nome,
        email, empresa, documento, origem, observacoes,
        tags: tagList,
        customData: custom,
        ...cadencePatch,
      };
      updateContact(contact.id, patch);
      api.updateContact(contact.id, patch).catch(() => {});
      if (funilId === DEFAULT_FUNIL_ID) {
        if (etapaId !== contact.status) {
          moveContactStage(contact.id, etapaId);
          api.moveContactStage(contact.id, etapaId).catch(() => {});
        }
      } else if (etapaId) {
        funisApi.setContatoEtapa(funilId, contact.id, etapaId).catch(() => {});
      }
      toast.success("Contato atualizado");
    }
    onClose();
  };

  // Atalhos de sistema (copiar/colar/recortar/selecionar tudo) nunca podem
  // fechar o modal — só clique fora ou Esc fecham. stopPropagation aqui
  // blinda contra qualquer handler ambiente (atual ou futuro) que reaja a
  // keydown borbulhando até um ancestral fora deste componente.
  const onKeyDownGuard = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && ["c", "v", "x", "a"].includes(e.key.toLowerCase())) { e.stopPropagation(); return; }
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose} onKeyDown={onKeyDownGuard}>
      <div className="glass-card max-w-2xl w-full p-6 animate-scale-in max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">{mode === "create" ? "Novo contato" : "Editar contato"}</h3>
            {contact && <p className="text-xs text-muted-foreground">{formatPhoneDisplay(contact.telefone)}</p>}
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome"><Input value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
          <Field label="Telefone">
            <Input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              disabled={mode === "edit"}
              placeholder="55 11 99999-9999"
            />
          </Field>
          <Field label="E-mail"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Empresa"><Input value={empresa} onChange={(e) => setEmpresa(e.target.value)} /></Field>
          <Field label="CPF/CNPJ"><Input value={documento} onChange={(e) => setDocumento(e.target.value)} /></Field>
          <Field label="Origem"><Input placeholder="Instagram, indicação, site…" value={origem} onChange={(e) => setOrigem(e.target.value)} /></Field>
          <Field label="Tags (vírgula)"><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
          <Field label="Funil">
            <select
              value={funilId}
              onChange={(e) => changeFunil(e.target.value)}
              className="w-full bg-input rounded px-3 py-2 text-sm border border-border"
            >
              <option value={DEFAULT_FUNIL_ID}>Funil do CRM</option>
              {customFunis.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </Field>
          <Field label="Etapa">
            <select
              value={etapaId}
              onChange={(e) => setEtapaId(e.target.value)}
              className="w-full bg-input rounded px-3 py-2 text-sm border border-border"
            >
              <option value="" disabled>Selecione…</option>
              {etapaOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Observações" full>
            <textarea
              rows={3}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              className="w-full bg-input rounded px-3 py-2 text-sm border border-border"
            />
          </Field>

          {customFields.length > 0 && (
            <div className="col-span-2 mt-1">
              <GradientDivider className="mb-3" />
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Campos personalizados</div>
              <div className="grid grid-cols-2 gap-3">
                {customFields.map((f) => (
                  <Field key={f.id} label={f.label} full={f.type === "checkbox"}>
                    <CustomFieldInput field={f} value={custom[f.key]} onChange={(v) => setCustomVal(f.key, v)} />
                  </Field>
                ))}
              </div>
            </div>
          )}

          <ContactCadenceFields
            contact={contact ?? null}
            value={cadence}
            onChange={(patch) => setCadence((prev) => ({ ...prev, ...patch }))}
            onTouchDone={onClose}
          />
        </div>

        <div className="flex gap-2 mt-5 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button className="btn-glow" onClick={save}>Salvar</Button>
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
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="accent-primary" />
        <span className="text-muted-foreground">Sim / Não</span>
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <select
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input rounded px-3 py-2 text-sm border border-border"
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
