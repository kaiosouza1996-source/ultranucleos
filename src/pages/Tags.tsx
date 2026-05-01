import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/appStore";
import { Tag as TagIcon, Plus, Trash2, Pencil, Users, UserPlus, Check, Search, X, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { formatPhoneDisplay } from "@/lib/phone";
import { toast } from "sonner";

const PALETTE = ["#2D8CFF", "#22D3EE", "#A78BFA", "#F59E0B", "#10B981", "#EF4444", "#EC4899", "#84CC16"];

interface TagAggregate { nome: string; cor: string; count: number }

export default function Tags() {
  const contacts = useAppStore((s) => s.contacts);
  const updateContact = useAppStore((s) => s.updateContact);
  const persisted = useAppStore((s) => s.tags);
  const setTags = useAppStore((s) => s.setTags);

  const [newTag, setNewTag] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  // Bulk apply
  const [bulkTag, setBulkTag] = useState<string | null>(null);
  const [bulkSearch, setBulkSearch] = useState("");
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  const tags: TagAggregate[] = useMemo(() => {
    const map = new Map<string, TagAggregate>();
    for (const t of persisted) map.set(t.nome, { nome: t.nome, cor: t.cor, count: 0 });
    for (const c of contacts) for (const t of c.tags) {
      const ex = map.get(t);
      if (ex) ex.count++;
      else map.set(t, { nome: t, cor: PALETTE[map.size % PALETTE.length], count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [contacts, persisted]);

  const create = () => {
    const norm = newTag.toLowerCase().trim();
    if (!norm) return;
    if (tags.some((t) => t.nome === norm)) { toast.error("Tag já existe"); return; }
    setTags([...persisted, { id: crypto.randomUUID(), nome: norm, cor: PALETTE[persisted.length % PALETTE.length] }]);
    setNewTag("");
    toast.success("Tag criada");
  };

  const remove = (nome: string) => {
    if (!confirm(`Remover a tag "${nome}" de todos os contatos?`)) return;
    for (const c of contacts) {
      if (c.tags.includes(nome)) updateContact(c.id, { tags: c.tags.filter((t) => t !== nome) });
    }
    setTags(persisted.filter((t) => t.nome !== nome));
    toast.success("Tag removida");
  };

  const rename = (oldName: string) => {
    const norm = renameValue.toLowerCase().trim();
    if (!norm || norm === oldName) { setEditing(null); return; }
    if (tags.some((t) => t.nome === norm)) { toast.error("Já existe uma tag com esse nome"); return; }
    for (const c of contacts) {
      if (c.tags.includes(oldName)) {
        updateContact(c.id, { tags: Array.from(new Set(c.tags.map((t) => t === oldName ? norm : t))) });
      }
    }
    setTags(persisted.map((t) => t.nome === oldName ? { ...t, nome: norm } : t));
    setEditing(null);
    toast.success("Tag renomeada");
  };

  const openBulk = (nome: string) => {
    setBulkTag(nome);
    setBulkSelected(new Set(contacts.filter((c) => c.tags.includes(nome)).map((c) => c.id)));
    setBulkSearch("");
  };
  const closeBulk = () => { setBulkTag(null); setBulkSelected(new Set()); setBulkSearch(""); };
  const toggleBulk = (id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const applyBulk = () => {
    if (!bulkTag) return;
    let added = 0; let removed = 0;
    for (const c of contacts) {
      const has = c.tags.includes(bulkTag);
      const should = bulkSelected.has(c.id);
      if (should && !has) { updateContact(c.id, { tags: [...c.tags, bulkTag] }); added++; }
      else if (!should && has) { updateContact(c.id, { tags: c.tags.filter((t) => t !== bulkTag) }); removed++; }
    }
    toast.success(`#${bulkTag}: ${added} adicionadas, ${removed} removidas`);
    closeBulk();
  };

  const bulkContacts = useMemo(() => {
    const q = bulkSearch.toLowerCase().trim();
    return contacts
      .filter((c) => !q || c.nome.toLowerCase().includes(q) || c.telefone.includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .slice(0, 500);
  }, [contacts, bulkSearch]);

  return (
    <>
      <AppHeader title="Tags" subtitle={`${tags.length} tags · ${contacts.length} contatos`} />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card p-5 animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <Plus className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Nova tag</h3>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="ex: black-friday"
                className="bg-input/60"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value.toLowerCase())}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
              <Button className="btn-glow" onClick={create}><Plus className="w-4 h-4 mr-1" /> Criar</Button>
            </div>
          </div>

          <div className="glass-card p-5 animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <TagIcon className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Todas as tags</h3>
            </div>
            {tags.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <TagIcon className="w-8 h-8 mx-auto mb-2 opacity-50" /> Nenhuma tag ainda.
              </div>
            ) : (
              <div className="space-y-2">
                {tags.map((t) => {
                  const isOpen = expanded === t.nome;
                  const tagContacts = contacts.filter((c) => c.tags.includes(t.nome));
                  return (
                    <div key={t.nome} className="rounded-lg bg-muted/30 border border-border/30 hover:border-primary/40 transition-all">
                      <div className="group flex items-center gap-3 p-3">
                        <button onClick={() => setExpanded(isOpen ? null : t.nome)} className="text-muted-foreground hover:text-foreground">
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <span className="w-3 h-3 rounded-full" style={{ background: t.cor, boxShadow: `0 0 10px ${t.cor}80` }} />
                        {editing === t.nome ? (
                          <Input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value.toLowerCase())}
                            onKeyDown={(e) => e.key === "Enter" && rename(t.nome)}
                            onBlur={() => rename(t.nome)}
                            className="h-7 text-sm bg-input flex-1"
                          />
                        ) : (
                          <button onClick={() => setExpanded(isOpen ? null : t.nome)} className="flex-1 min-w-0 text-left">
                            <div className="text-sm font-medium truncate">#{t.nome}</div>
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Users className="w-3 h-3" /> {t.count} contatos
                            </div>
                          </button>
                        )}
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openBulk(t.nome)} title="Aplicar em contatos">
                          <UserPlus className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(t.nome); setRenameValue(t.nome); }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(t.nome)}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                      {isOpen && (
                        <div className="border-t border-border/30 p-3 max-h-72 overflow-y-auto scrollbar-thin">
                          {tagContacts.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4">Nenhum contato com essa tag.</p>
                          ) : (
                            <ul className="space-y-1">
                              {tagContacts.map((c) => (
                                <li key={c.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-primary/5">
                                  <div className="min-w-0">
                                    <div className="text-xs font-medium truncate">{c.nome}</div>
                                    <div className="text-[10px] text-muted-foreground font-mono">{formatPhoneDisplay(c.telefone)}</div>
                                  </div>
                                  <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0"
                                    title="Remover desta tag"
                                    onClick={() => updateContact(c.id, { tags: c.tags.filter((x) => x !== t.nome) })}>
                                    <X className="w-3 h-3 text-destructive" />
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass-card p-5 animate-fade-in">
            <h3 className="font-semibold text-sm mb-3">Como funciona</h3>
            <ul className="text-xs text-muted-foreground space-y-2 list-disc list-inside">
              <li>Cada contato pode ter múltiplas tags.</li>
              <li>Usadas em <strong className="text-foreground">Disparos</strong> para segmentação OU/E.</li>
              <li>Renomear/remover atualiza todos os contatos.</li>
              <li>As tags da importação são criadas aqui automaticamente.</li>
            </ul>
          </div>
        </div>
      </div>

      {bulkTag && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={closeBulk}>
          <div className="glass-card w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between p-5 border-b border-border/30">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-primary" />
                  Aplicar tag <span className="text-primary">#{bulkTag}</span>
                </h3>
                <p className="text-xs text-muted-foreground mt-1">Marque os contatos que devem receber esta tag</p>
              </div>
              <Button size="icon" variant="ghost" onClick={closeBulk}><X className="w-4 h-4" /></Button>
            </header>

            <div className="p-4 border-b border-border/30 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8 h-9 bg-input/60" placeholder="Buscar contato por nome ou telefone…"
                  value={bulkSearch} onChange={(e) => setBulkSearch(e.target.value)} />
              </div>
              <Button variant="outline" size="sm" onClick={() => setBulkSelected(new Set(bulkContacts.map((c) => c.id)))}>
                Selecionar todos visíveis
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setBulkSelected(new Set())}>Limpar</Button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {bulkContacts.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-12">Nenhum contato encontrado.</p>
              ) : bulkContacts.map((c) => {
                const checked = bulkSelected.has(c.id);
                return (
                  <button key={c.id} onClick={() => toggleBulk(c.id)}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-left border-b border-border/20 transition-colors
                      ${checked ? "bg-primary/10" : "hover:bg-muted/30"}`}>
                    <span className={`w-5 h-5 rounded border flex items-center justify-center
                      ${checked ? "bg-primary border-primary" : "border-border"}`}>
                      {checked && <Check className="w-3 h-3 text-primary-foreground" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{c.nome}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.telefone}</div>
                    </div>
                    {c.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap justify-end max-w-[40%]">
                        {c.tags.slice(0, 3).map((t) => (
                          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40">#{t}</span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <footer className="p-4 border-t border-border/30 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{bulkSelected.size} contatos selecionados</span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={closeBulk}>Cancelar</Button>
                <Button className="btn-glow" onClick={applyBulk}>Aplicar mudanças</Button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
