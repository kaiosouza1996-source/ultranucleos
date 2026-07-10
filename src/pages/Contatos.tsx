import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppStore, type Contact } from "@/store/appStore";
import { useAuthStore } from "@/store/authStore";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, Trash2, Users, Pencil, Plus, UserCheck, Snowflake, MessageCircle, HelpCircle, ShieldAlert, Check, X } from "lucide-react";
import { formatPhoneDisplay } from "@/lib/phone";
import { api } from "@/lib/engine";
import { ContactFormDialog } from "@/components/ContactFormDialog";
import { toast } from "sonner";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
type ContatosTab = "clientes" | "leads_frios" | "nao_salvos";

export default function Contatos() {
  const contacts = useAppStore((s) => s.contacts);
  const removeContact = useAppStore((s) => s.removeContact);
  const updateContact = useAppStore((s) => s.updateContact);
  const isSocio = useAuthStore((s) => s.hasRole("socio"));
  const [searchParams] = useSearchParams();
  const filtro = searchParams.get("filtro");
  const navigate = useNavigate();
  const sendMessage = (c: Contact) => {
    navigate(`/atendimento?startChat=${encodeURIComponent(c.telefone)}&startName=${encodeURIComponent(c.nome)}`);
  };

  // Contato não pode simplesmente ser apagado por qualquer usuário — quem não
  // é Sócio só solicita (POST decide sozinho, no backend, se apaga na hora ou
  // fica pendente aguardando aprovação); Sócio vê e resolve (Aprovar/Rejeitar).
  const requestDelete = async (c: Contact) => {
    try {
      const res = await api.requestDeleteContact(c.id);
      if (res.deleted) {
        removeContact(c.id);
        toast.success(`Contato "${c.nome}" excluído.`);
      } else {
        const profile = useAuthStore.getState().profile;
        updateContact(c.id, { deleteRequestedBy: profile?.id ?? "pending", deleteRequestedByName: profile?.fullName ?? null, deleteRequestedAt: Date.now() });
        toast.success(`Solicitação de exclusão enviada — aguardando aprovação de um Sócio.`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const approveDelete = async (c: Contact) => {
    try {
      await api.approveDeleteContact(c.id);
      removeContact(c.id);
      toast.success(`Exclusão de "${c.nome}" aprovada.`);
    } catch (e) { toast.error((e as Error).message); }
  };
  const rejectDelete = async (c: Contact) => {
    try {
      await api.rejectDeleteContact(c.id);
      updateContact(c.id, { deleteRequestedBy: null, deleteRequestedByName: null, deleteRequestedAt: null });
      toast.success(`Solicitação de exclusão de "${c.nome}" rejeitada.`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [showDesqualificados, setShowDesqualificados] = useState(filtro === "desqualificados");
  const [tab, setTab] = useState<ContatosTab>(
    filtro === "leads_frios" || filtro === "sem_contato_30d" || filtro === "desqualificados" ? "leads_frios" : "clientes",
  );
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) for (const t of c.tags) set.add(t);
    return Array.from(set).sort();
  }, [contacts]);

  const matchesBase = (c: Contact) => {
    const matchQ = !q || c.nome.toLowerCase().includes(q.toLowerCase()) || c.telefone.includes(q);
    const matchTag = !tagFilter || c.tags.includes(tagFilter);
    return matchQ && matchTag;
  };

  const clientes = useMemo(() => {
    let list = contacts.filter((c) => c.isClient && matchesBase(c));
    if (filtro === "sem_contato_30d") {
      const cutoff = Date.now() - THIRTY_DAYS_MS;
      list = list.filter((c) => !c.lastContactAt || c.lastContactAt <= cutoff);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, q, tagFilter, filtro]);

  // "Não confirmados" = ainda não foram triados por ninguém (A_CONFIRMAR é o
  // valor que nasce automaticamente quando um contato é criado só porque
  // mandou uma mensagem — ver ensureContactFromChat no engine; null cobre
  // contatos adicionados manualmente sem essa pergunta respondida ainda).
  const isNaoConfirmado = (c: Contact) => !c.atuaMercadoFinanceiro || c.atuaMercadoFinanceiro === "A_CONFIRMAR";
  const isDesqualificado = (c: Contact) => !!c.atuaMercadoFinanceiro && c.atuaMercadoFinanceiro !== "SIM" && c.atuaMercadoFinanceiro !== "A_CONFIRMAR";

  const naoClientes = useMemo(() => contacts.filter((c) => !c.isClient && matchesBase(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacts, q, tagFilter]);

  const naoSalvos = useMemo(() => naoClientes.filter(isNaoConfirmado), [naoClientes]);
  const leadsFriosTodos = useMemo(() => naoClientes.filter((c) => !isNaoConfirmado(c)), [naoClientes]);
  const leadsFrios = useMemo(
    () => leadsFriosTodos.filter((c) => (showDesqualificados ? isDesqualificado(c) : !isDesqualificado(c))),
    [leadsFriosTodos, showDesqualificados],
  );
  const desqualificadosCount = useMemo(() => leadsFriosTodos.filter(isDesqualificado).length, [leadsFriosTodos]);

  return (
    <>
      <AppHeader title="Contatos" subtitle={`${contacts.length} contatos em ${tags.length} tags`} />
      <div className="flex justify-end mb-3">
        <Button className="btn-glow" onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Novo contato
        </Button>
      </div>

      <div className="glass-card p-5 animate-fade-in mb-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9 bg-input/60" placeholder="Buscar por nome ou telefone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setTagFilter("")}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all
                ${!tagFilter ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
            >Todas</button>
            {tags.map((t) => (
              <button key={t} onClick={() => setTagFilter(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all
                  ${tagFilter === t ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
              >{t}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="glass-card p-5 animate-fade-in">
        <Tabs value={tab} onValueChange={(v) => setTab(v as ContatosTab)}>
          <TabsList className="bg-muted/30 mb-4">
            <TabsTrigger value="clientes"><UserCheck className="w-3.5 h-3.5 mr-1.5" /> Clientes da Assessoria ({clientes.length})</TabsTrigger>
            <TabsTrigger value="leads_frios"><Snowflake className="w-3.5 h-3.5 mr-1.5" /> Leads Frios ({leadsFriosTodos.length})</TabsTrigger>
            <TabsTrigger value="nao_salvos"><HelpCircle className="w-3.5 h-3.5 mr-1.5" /> Contatos não salvos ({naoSalvos.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="clientes">
            <ContactsTable
              contacts={clientes} onEdit={setEditing} onMessage={sendMessage}
              isSocio={isSocio} onRequestDelete={requestDelete} onApproveDelete={approveDelete} onRejectDelete={rejectDelete}
            />
          </TabsContent>

          <TabsContent value="leads_frios">
            <div className="flex items-center justify-end mb-3">
              <button
                onClick={() => setShowDesqualificados((v) => !v)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all
                  ${showDesqualificados ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
              >Desqualificados ({desqualificadosCount})</button>
            </div>
            <ContactsTable
              contacts={leadsFrios} onEdit={setEditing} onMessage={sendMessage} showCadenceCol
              isSocio={isSocio} onRequestDelete={requestDelete} onApproveDelete={approveDelete} onRejectDelete={rejectDelete}
            />
          </TabsContent>

          <TabsContent value="nao_salvos">
            <p className="text-xs text-muted-foreground mb-3">
              Contatos que já mandaram mensagem (ou foram criados) mas ainda não foram triados por um atendente — nem cliente, nem lead frio confirmado.
            </p>
            <ContactsTable
              contacts={naoSalvos} onEdit={setEditing} onMessage={sendMessage}
              isSocio={isSocio} onRequestDelete={requestDelete} onApproveDelete={approveDelete} onRejectDelete={rejectDelete}
            />
          </TabsContent>
        </Tabs>
      </div>

      {editing && (
        <ContactFormDialog mode="edit" contact={editing} onClose={() => setEditing(null)} />
      )}

      {creating && (
        <ContactFormDialog mode="create" onClose={() => setCreating(false)} />
      )}
    </>
  );
}

function ContactsTable({
  contacts, onEdit, onMessage, showCadenceCol, isSocio, onRequestDelete, onApproveDelete, onRejectDelete,
}: {
  contacts: Contact[];
  onEdit: (c: Contact) => void;
  onMessage: (c: Contact) => void;
  showCadenceCol?: boolean;
  isSocio: boolean;
  onRequestDelete: (c: Contact) => void;
  onApproveDelete: (c: Contact) => void;
  onRejectDelete: (c: Contact) => void;
}) {
  if (contacts.length === 0) {
    return (
      <div className="py-10 text-center text-muted-foreground text-sm">
        <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
        Nenhum contato encontrado.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-muted-foreground">
          <tr>
            <th className="text-left py-2 px-2">Nome</th>
            <th className="text-left py-2 px-2">Telefone</th>
            <th className="text-left py-2 px-2">Tags</th>
            <th className="text-left py-2 px-2">Status</th>
            {showCadenceCol && <th className="text-left py-2 px-2">Cadência</th>}
            <th className="text-left py-2 px-2">Empresa</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id} className="border-t border-border hover:bg-primary/5 transition-colors">
              <td className="py-2.5 px-2 font-medium">{c.nome}</td>
              <td className="py-2.5 px-2 font-mono text-xs text-muted-foreground">{formatPhoneDisplay(c.telefone)}</td>
              <td className="py-2.5 px-2">
                <div className="flex flex-wrap gap-1">
                  {c.tags.map((t) => <span key={t} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">{t}</span>)}
                </div>
              </td>
              <td className="py-2.5 px-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted/40">{c.status || "novo"}</span>
              </td>
              {showCadenceCol && (
                <td className="py-2.5 px-2">
                  {c.cadenceStage && c.cadenceStage !== "NONE" ? (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${c.cadenceOverdue ? "bg-destructive/20 text-destructive" : "bg-primary/10 text-primary"}`}>
                      {c.cadenceStage}{c.cadenceOverdue ? " · atrasado" : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              )}
              <td className="py-2.5 px-2 text-xs text-muted-foreground">{c.empresa || "—"}</td>
              <td className="py-2.5 px-2 text-right whitespace-nowrap">
                {c.deleteRequestedBy ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning" title={c.deleteRequestedByName ? `Solicitado por ${c.deleteRequestedByName}` : undefined}>
                      <ShieldAlert className="w-3 h-3" /> Exclusão pendente
                    </span>
                    {isSocio && (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => onApproveDelete(c)} title="Aprovar exclusão">
                          <Check className="w-3.5 h-3.5 text-success" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => onRejectDelete(c)} title="Rejeitar exclusão">
                          <X className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </>
                    )}
                  </span>
                ) : (
                  <>
                    <Button size="icon" variant="ghost" onClick={() => onMessage(c)} title="Enviar mensagem">
                      <MessageCircle className="w-3.5 h-3.5 text-success" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => onEdit(c)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => onRequestDelete(c)} title={isSocio ? "Excluir" : "Solicitar exclusão"}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
