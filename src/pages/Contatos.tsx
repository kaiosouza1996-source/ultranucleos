import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAppStore, type Contact } from "@/store/appStore";
import { useMemo, useState } from "react";
import { Search, Trash2, Users, Pencil, X, Plus } from "lucide-react";
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone";
import { toast } from "sonner";

export default function Contatos() {
  const contacts = useAppStore((s) => s.contacts);
  const removeContact = useAppStore((s) => s.removeContact);
  const updateContact = useAppStore((s) => s.updateContact);
  const addContacts = useAppStore((s) => s.addContacts);
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) for (const t of c.tags) set.add(t);
    return Array.from(set).sort();
  }, [contacts]);

  const filtered = useMemo(() => contacts.filter((c) => {
    const matchQ = !q || c.nome.toLowerCase().includes(q.toLowerCase()) || c.telefone.includes(q);
    const matchTag = !tagFilter || c.tags.includes(tagFilter);
    return matchQ && matchTag;
  }), [contacts, q, tagFilter]);

  return (
    <>
      <AppHeader title="Contatos" subtitle={`${contacts.length} contatos em ${tags.length} tags`} />
      <div className="flex justify-end mb-3">
        <Button className="btn-glow" onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Novo contato
        </Button>
      </div>
      <div className="glass-card p-5 animate-fade-in">
        <div className="flex flex-col md:flex-row gap-3 mb-4">
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

        {filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            Nenhum contato encontrado.
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left py-2 px-2">Nome</th>
                  <th className="text-left py-2 px-2">Telefone</th>
                  <th className="text-left py-2 px-2">Tags</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-left py-2 px-2">Empresa</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-t border-border/30 hover:bg-primary/5 transition-colors">
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
                    <td className="py-2.5 px-2 text-xs text-muted-foreground">{c.empresa || "—"}</td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap">
                      <Button size="icon" variant="ghost" onClick={() => setEditing(c)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => removeContact(c.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EditDialog
          contact={editing}
          onClose={() => setEditing(null)}
          onSave={(p) => { updateContact(editing.id, p); setEditing(null); }}
        />
      )}

      {creating && (
        <NewContactDialog
          existing={contacts}
          onClose={() => setCreating(false)}
          onCreate={(c) => { addContacts([c]); setCreating(false); toast.success("Contato adicionado"); }}
        />
      )}
    </>
  );
}

function NewContactDialog({ existing, onClose, onCreate }: { existing: Contact[]; onClose: () => void; onCreate: (c: Contact) => void }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [tags, setTags] = useState("");

  const submit = () => {
    if (!nome.trim()) { toast.error("Nome é obrigatório"); return; }
    const tel = normalizePhone(telefone);
    if (!tel) { toast.error("Telefone inválido"); return; }
    if (existing.some((c) => c.telefone === tel)) { toast.error("Telefone já cadastrado"); return; }
    onCreate({
      id: crypto.randomUUID(),
      nome: nome.trim(),
      telefone: tel,
      email: email.trim() || undefined,
      empresa: empresa.trim() || undefined,
      tags: tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      status: "novo",
      createdAt: Date.now(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-md w-full p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Novo contato</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="space-y-3">
          <Field label="Nome" full><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Maria Silva" /></Field>
          <Field label="Telefone" full><Input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="11 99999-9999" /></Field>
          <Field label="E-mail" full><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Empresa" full><Input value={empresa} onChange={(e) => setEmpresa(e.target.value)} /></Field>
          <Field label="Tags (vírgula)" full><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="lead, vip" /></Field>
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button className="btn-glow" onClick={submit}>Criar contato</Button>
        </div>
      </div>
    </div>
  );
}

function EditDialog({ contact, onClose, onSave }: { contact: Contact; onClose: () => void; onSave: (p: Partial<Contact>) => void }) {
  const [nome, setNome] = useState(contact.nome);
  const [email, setEmail] = useState(contact.email || "");
  const [empresa, setEmpresa] = useState(contact.empresa || "");
  const [documento, setDocumento] = useState(contact.documento || "");
  const [tags, setTags] = useState(contact.tags.join(", "));
  const [observacoes, setObservacoes] = useState(contact.observacoes || "");
  const [status, setStatus] = useState(contact.status || "novo");

  const STATUSES = ["novo", "em-atendimento", "qualificado", "proposta", "fechado", "perdido"];
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-lg w-full p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Editar contato</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome"><Input value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
          <Field label="E-mail"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Empresa"><Input value={empresa} onChange={(e) => setEmpresa(e.target.value)} /></Field>
          <Field label="CPF/CNPJ"><Input value={documento} onChange={(e) => setDocumento(e.target.value)} /></Field>
          <Field label="Tags (vírgula)" full><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
          <Field label="Status" full>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full bg-input rounded px-3 py-2 text-sm border border-border/40">
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Observações" full>
            <textarea rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)}
              className="w-full bg-input rounded px-3 py-2 text-sm border border-border/40" />
          </Field>
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button className="btn-glow" onClick={() => onSave({
            nome, email, empresa, documento, observacoes, status,
            tags: tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
          })}>Salvar</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
