import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAppStore, type Template, type TemplatePart, type TemplateMedia } from "@/store/appStore";
import { useRef, useState, useMemo } from "react";
import { Plus, Save, Trash2, Copy, MessageSquareText, Layers, ArrowUp, ArrowDown, X, Image as ImageIcon } from "lucide-react";
import { renderTemplate } from "@/lib/engine";
import { toast } from "sonner";
import { AudioRecorder, MediaPreview, fileToDataUrl, type RecordedAudio } from "@/components/AudioRecorder";

const empty = (): Template => ({ id: crypto.randomUUID(), name: "Novo template", tag: "geral", body: "Olá {nome}! ", updatedAt: Date.now(), multiPart: false, parts: [], media: null });

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

  // Helpers de partes
  const ensureParts = (t: Template): TemplatePart[] => (t.parts && t.parts.length > 0 ? t.parts : [{ body: t.body, delaySeconds: 0, media: t.media ?? null }]);
  const updatePart = (idx: number, patch: Partial<TemplatePart>) => {
    if (!draft) return;
    const parts = ensureParts(draft).map((p, i) => i === idx ? { ...p, ...patch } : p);
    setDraft({ ...draft, parts });
  };
  const addPart = () => {
    if (!draft) return;
    const parts = [...ensureParts(draft), { body: "", delaySeconds: 5, media: null }];
    setDraft({ ...draft, parts });
  };
  const removePart = (idx: number) => {
    if (!draft) return;
    const parts = ensureParts(draft).filter((_, i) => i !== idx);
    setDraft({ ...draft, parts: parts.length ? parts : [{ body: draft.body, delaySeconds: 0, media: null }] });
  };
  const movePart = (idx: number, dir: -1 | 1) => {
    if (!draft) return;
    const parts = [...ensureParts(draft)];
    const j = idx + dir;
    if (j < 0 || j >= parts.length) return;
    [parts[idx], parts[j]] = [parts[j], parts[idx]];
    setDraft({ ...draft, parts });
  };
  const toggleMulti = (on: boolean) => {
    if (!draft) return;
    if (on) {
      const parts = draft.parts && draft.parts.length > 0 ? draft.parts : [{ body: draft.body, delaySeconds: 0, media: draft.media ?? null }];
      setDraft({ ...draft, multiPart: true, parts });
    } else {
      setDraft({ ...draft, multiPart: false });
    }
  };

  // ─── Mídia ───
  const handleImageFile = async (file: File, target: "draft" | number) => {
    if (!draft) return;
    if (!file.type.startsWith("image/")) { toast.error("Selecione um arquivo de imagem."); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Imagem maior que 10MB."); return; }
    const dataUrl = await fileToDataUrl(file);
    const media: TemplateMedia = { kind: "image", dataUrl, filename: file.name, mimetype: file.type };
    if (target === "draft") setDraft({ ...draft, media });
    else updatePart(target, { media });
  };
  const handleAudio = (audio: RecordedAudio, target: "draft" | number) => {
    if (!draft) return;
    const media: TemplateMedia = { kind: "audio", dataUrl: audio.dataUrl, filename: audio.filename, mimetype: audio.mimetype };
    if (target === "draft") setDraft({ ...draft, media });
    else updatePart(target, { media });
  };
  const handleAudioFile = async (file: File, target: "draft" | number) => {
    if (!draft) return;
    if (!file.type.startsWith("audio/")) { toast.error("Selecione um arquivo de áudio."); return; }
    if (file.size > 16 * 1024 * 1024) { toast.error("Áudio maior que 16MB."); return; }
    const dataUrl = await fileToDataUrl(file);
    const media: TemplateMedia = { kind: "audio", dataUrl, filename: file.name, mimetype: file.type };
    if (target === "draft") setDraft({ ...draft, media });
    else updatePart(target, { media });
  };

  return (
    <div className="grid lg:grid-cols-[280px_1fr] gap-6">
      <div className="space-y-3">
        <Button className="btn-glow w-full" onClick={create}><Plus className="w-4 h-4 mr-2" /> Novo template</Button>
        <div className="space-y-2">
          {templates.map((t) => (
            <button key={t.id} onClick={() => open(t)}
              className={`w-full text-left glass-card p-3 transition-all duration-200 hover:border-primary/40
                ${selectedId === t.id ? "border-primary/60 shadow-glow" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium truncate">{t.name}</div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">{t.tag}</span>
              </div>
              <div className="text-xs text-muted-foreground truncate mt-1">{t.body}</div>
              {t.multiPart && t.parts && t.parts.length > 1 && (
                <div className="mt-1 text-[10px] text-primary/80 flex items-center gap-1">
                  <Layers className="w-3 h-3" /> {t.parts.length} partes
                </div>
              )}
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

          <div className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-muted/20 mb-4">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              <div>
                <div className="text-sm font-medium">Enviar em partes</div>
                <div className="text-xs text-muted-foreground">Divida a mensagem em vários envios sequenciais com intervalo entre eles.</div>
              </div>
            </div>
            <Switch checked={!!draft.multiPart} onCheckedChange={toggleMulti} />
          </div>

          {!draft.multiPart && (
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Mensagem</label>
              <Textarea
                rows={8}
                className="bg-input/60 mt-1 font-mono text-sm"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-2">Use <code className="px-1 rounded bg-muted text-foreground">{"{nome}"}</code> para inserir o nome do contato.</p>

              <MediaToolbar
                onImage={(f) => handleImageFile(f, "draft")}
                onAudioFile={(f) => handleAudioFile(f, "draft")}
                onAudioRecorded={(a) => handleAudio(a, "draft")}
              />
              {draft.media && (
                <MediaPreview
                  media={draft.media}
                  onRemove={() => setDraft({ ...draft, media: null })}
                />
              )}
            </div>
          )}

          {draft.multiPart && (
            <div className="space-y-3">
              {ensureParts(draft).map((p, idx) => (
                <div key={idx} className="rounded-lg border border-border/40 bg-muted/10 p-3 animate-fade-in">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs uppercase tracking-wider text-primary font-semibold">Parte {idx + 1}</div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => movePart(idx, -1)} disabled={idx === 0}><ArrowUp className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => movePart(idx, 1)} disabled={idx === ensureParts(draft).length - 1}><ArrowDown className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removePart(idx)} disabled={ensureParts(draft).length <= 1}><X className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                  <Textarea
                    rows={4}
                    className="bg-input/60 font-mono text-sm"
                    placeholder="Conteúdo desta parte (opcional se anexar mídia)…"
                    value={p.body}
                    onChange={(e) => updatePart(idx, { body: e.target.value })}
                  />
                  <MediaToolbar
                    onImage={(f) => handleImageFile(f, idx)}
                    onAudioFile={(f) => handleAudioFile(f, idx)}
                    onAudioRecorded={(a) => handleAudio(a, idx)}
                  />
                  {p.media && (
                    <MediaPreview media={p.media} onRemove={() => updatePart(idx, { media: null })} />
                  )}
                  {idx > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-muted-foreground">Intervalo antes desta parte:</label>
                      <Input
                        type="number"
                        min={0}
                        className="bg-input/60 h-8 w-24"
                        value={p.delaySeconds}
                        onChange={(e) => updatePart(idx, { delaySeconds: Math.max(0, Number(e.target.value) || 0) })}
                      />
                      <span className="text-xs text-muted-foreground">segundos</span>
                    </div>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addPart}><Plus className="w-3.5 h-3.5 mr-1.5" /> Adicionar parte</Button>
              <p className="text-xs text-muted-foreground">Use <code className="px-1 rounded bg-muted text-foreground">{"{nome}"}</code> em qualquer parte para inserir o nome do contato.</p>
            </div>
          )}

          <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
            <div className="text-xs uppercase tracking-wider text-primary mb-2 flex items-center gap-2">
              <MessageSquareText className="w-3.5 h-3.5" /> Pré-visualização
            </div>
            {draft.multiPart ? (
              <div className="space-y-2">
                {ensureParts(draft).map((p, idx) => (
                  <div key={idx} className="text-sm">
                    {idx > 0 && <div className="text-[10px] text-muted-foreground mb-1">⏱ aguarda {p.delaySeconds}s</div>}
                    {p.media?.kind === "image" && <img src={p.media.dataUrl} alt="" className="rounded max-h-40 mb-1" />}
                    {p.media?.kind === "audio" && <audio controls src={p.media.dataUrl} className="w-full mb-1" />}
                    {p.body && <div className="whitespace-pre-wrap rounded-md bg-background/40 p-2 border border-border/30">{renderTemplate(p.body, "Maria")}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm space-y-2">
                {draft.media?.kind === "image" && <img src={draft.media.dataUrl} alt="" className="rounded max-h-40" />}
                {draft.media?.kind === "audio" && <audio controls src={draft.media.dataUrl} className="w-full" />}
                {draft.body && <div className="whitespace-pre-wrap">{renderTemplate(draft.body, "Maria")}</div>}
              </div>
            )}
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
  );
}

function MediaToolbar({
  onImage, onAudioFile, onAudioRecorded,
}: {
  onImage: (file: File) => void;
  onAudioFile: (file: File) => void;
  onAudioRecorded: (audio: RecordedAudio) => void;
}) {
  const imgRef = useRef<HTMLInputElement>(null);
  const audRef = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImage(f); e.target.value = ""; }} />
      <input ref={audRef} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onAudioFile(f); e.target.value = ""; }} />
      <Button type="button" variant="outline" size="sm" onClick={() => imgRef.current?.click()} className="gap-2">
        <ImageIcon className="w-3.5 h-3.5" /> Imagem
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => audRef.current?.click()} className="gap-2">
        🎵 Áudio do PC
      </Button>
      <AudioRecorder onRecorded={onAudioRecorded} />
    </div>
  );
}
