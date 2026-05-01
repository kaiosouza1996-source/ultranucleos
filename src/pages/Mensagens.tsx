import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAppStore, type Template } from "@/store/appStore";
import { useState, useMemo } from "react";
import { Plus, Save, Trash2, Copy, MessageSquareText } from "lucide-react";
import { renderTemplate } from "@/lib/engine";
import { toast } from "sonner";

const empty = (): Template => ({ id: crypto.randomUUID(), name: "Novo template", tag: "geral", body: "Olá {nome}! ", updatedAt: Date.now() });

export default function Mensagens() {
  const templates = useAppStore((s) => s.templates);
  const upsert = useAppStore((s) => s.upsertTemplate);
  const remove = useAppStore((s) => s.removeTemplate);
  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const c of useAppStore.getState().contacts) for (const t of c.tags) set.add(t);
    return Array.from(set).sort();
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null);
  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const [draft, setDraft] = useState<Template | null>(selected);

  const open = (t: Template) => { setSelectedId(t.id); setDraft(t); };
  const create = () => { const t = empty(); upsert(t); open(t); toast.success("Template criado"); };
  const save = () => { if (!draft) return; upsert({ ...draft, updatedAt: Date.now() }); toast.success("Template salvo"); };
  const duplicate = () => { if (!draft) return; const t = { ...draft, id: crypto.randomUUID(), name: draft.name + " (cópia)" }; upsert(t); open(t); };
  const del = () => { if (!draft) return; remove(draft.id); setDraft(null); setSelectedId(null); toast.success("Removido"); };

  return (
    <>
      <AppHeader title="Mensagens" subtitle="Templates personalizados com variáveis dinâmicas" />

      <div className="grid lg:grid-cols-[280px_1fr] gap-6">
        <div className="space-y-3">
          <Button className="btn-glow w-full" onClick={create}><Plus className="w-4 h-4 mr-2" /> Novo template</Button>
          <div className="space-y-2">
            {templates.map((t) => (
              <button key={t.id} onClick={() => open(t)}
                className={`w-full text-left glass-card p-3 transition-all duration-200 hover:border-primary/40
                  ${selectedId === t.id ? "border-primary/60 shadow-glow" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium truncate">{t.name}</div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">{t.tag}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate mt-1">{t.body}</div>
              </button>
            ))}
            {templates.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nenhum template ainda.</p>}
          </div>
        </div>

        {draft ? (
          <div className="glass-card p-6 animate-fade-in">
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Nome</label>
                <Input className="bg-input/60 mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Tag alvo</label>
                <Input className="bg-input/60 mt-1" value={draft.tag} list="tags-list" onChange={(e) => setDraft({ ...draft, tag: e.target.value.toLowerCase() })} />
                <datalist id="tags-list">{tags.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Mensagem</label>
              <Textarea
                rows={8}
                className="bg-input/60 mt-1 font-mono text-sm"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-2">Use <code className="px-1 rounded bg-muted text-foreground">{"{nome}"}</code> para inserir o nome do contato.</p>
            </div>

            <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
              <div className="text-xs uppercase tracking-wider text-primary mb-2 flex items-center gap-2">
                <MessageSquareText className="w-3.5 h-3.5" /> Pré-visualização
              </div>
              <div className="text-sm whitespace-pre-wrap">{renderTemplate(draft.body, "Maria")}</div>
            </div>

            <div className="flex gap-2 mt-5">
              <Button className="btn-glow" onClick={save}><Save className="w-4 h-4 mr-2" /> Salvar</Button>
              <Button variant="outline" onClick={duplicate}><Copy className="w-4 h-4 mr-2" /> Duplicar</Button>
              <Button variant="ghost" onClick={del} className="text-destructive ml-auto"><Trash2 className="w-4 h-4 mr-2" /> Excluir</Button>
            </div>
          </div>
        ) : (
          <div className="glass-card p-12 text-center text-muted-foreground">Selecione ou crie um template para começar.</div>
        )}
      </div>
    </>
  );
}
