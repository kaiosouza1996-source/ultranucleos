import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Plus, Bold, Italic, List, ListOrdered, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { annotationsApi, NOTE_COLORS, type AnnotationItem, type AnnotationNote, type NoteSize } from "@/lib/annotations";

/**
 * Modo Bloco de Notas — grade de balões (post-it pequeno ou texto longo
 * grande) com rich text mínimo (negrito/itálico/listas) e autosave com
 * debounce. Cada balão é independente (não é um documento único).
 */
export function NotesBoard({ item, onClose }: { item: AnnotationItem; onClose: () => void }) {
  const [notes, setNotes] = useState<AnnotationNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    annotationsApi.listNotes(item.id)
      .then(setNotes)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [item.id]);

  const addNote = async (size: NoteSize) => {
    try {
      const n = await annotationsApi.createNote(item.id, { size, color: NOTE_COLORS[0] });
      setNotes((prev) => [...prev, n]);
    } catch (e) { toast.error((e as Error).message); }
  };

  const updateNoteColor = (id: string, color: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, color } : n)));
  };

  const removeNote = async (id: string) => {
    try {
      await annotationsApi.deleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <header className="flex items-center gap-3 p-4 border-b border-border shrink-0 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">{item.name}</div>
          {item.updatedByName && <div className="text-[11px] text-muted-foreground">editado por {item.updatedByName}</div>}
        </div>
        <Button size="sm" variant="outline" onClick={() => addNote("small")}><Plus className="w-3.5 h-3.5 mr-1" /> Pequeno</Button>
        <Button size="sm" variant="outline" onClick={() => addNote("large")}><Plus className="w-3.5 h-3.5 mr-1" /> Grande</Button>
        <Button size="icon" variant="ghost" onClick={onClose} title="Fechar"><X className="w-4 h-4" /></Button>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        {loading ? (
          <p className="text-xs text-muted-foreground text-center py-12">Carregando…</p>
        ) : notes.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-12">Nenhum balão ainda — crie um pequeno ou grande acima.</p>
        ) : (
          <div className="flex flex-wrap gap-3 items-start">
            {notes.map((n) => (
              <NoteCard key={n.id} note={n} onColorChange={(color) => updateNoteColor(n.id, color)} onDelete={() => removeNote(n.id)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function NoteCard({ note, onColorChange, onDelete }: {
  note: AnnotationNote;
  onColorChange: (color: string) => void;
  onDelete: () => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showColors, setShowColors] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // O conteúdo inicial só é escrito no DOM UMA vez (ao montar/trocar de
  // balão) — nunca a cada re-render, senão contentEditable (não é um input
  // controlado) perderia o cursor a cada tecla digitada.
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = note.content;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const html = editorRef.current?.innerHTML ?? "";
      annotationsApi.updateNote(note.id, { content: html }).catch((e) => toast.error((e as Error).message));
    }, 700);
  }, [note.id]);

  const format = (cmd: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd);
    scheduleSave();
  };

  const setColor = async (color: string) => {
    setShowColors(false);
    onColorChange(color);
    try { await annotationsApi.updateNote(note.id, { color }); } catch (e) { toast.error((e as Error).message); }
  };

  const sizeClass = note.size === "large" ? "w-72 min-h-[220px]" : "w-44 min-h-[140px]";

  return (
    <div
      className="group relative rounded-2xl p-3 shadow-elegant border flex flex-col"
      style={{ background: `linear-gradient(135deg, ${note.color}26, ${note.color}0d)`, borderColor: `${note.color}40` }}
    >
      <div className={`${sizeClass} flex flex-col`}>
        <div className="flex items-center gap-1 mb-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => format("bold")} className="p-1 rounded hover:bg-background/40" title="Negrito"><Bold className="w-3 h-3" /></button>
          <button onClick={() => format("italic")} className="p-1 rounded hover:bg-background/40" title="Itálico"><Italic className="w-3 h-3" /></button>
          <button onClick={() => format("insertUnorderedList")} className="p-1 rounded hover:bg-background/40" title="Lista com marcadores"><List className="w-3 h-3" /></button>
          <button onClick={() => format("insertOrderedList")} className="p-1 rounded hover:bg-background/40" title="Lista numerada"><ListOrdered className="w-3 h-3" /></button>
          <div className="relative ml-auto">
            <button onClick={() => setShowColors((v) => !v)} className="w-4 h-4 rounded-full border border-border/60" style={{ background: note.color }} title="Cor do balão" />
            {showColors && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowColors(false)} />
                <div className="absolute right-0 top-5 z-50 flex gap-1 p-1.5 rounded-lg border border-border bg-card shadow-elegant">
                  {NOTE_COLORS.map((c) => (
                    <button key={c} onClick={() => setColor(c)} className="w-4 h-4 rounded-full" style={{ background: c }} />
                  ))}
                </div>
              </>
            )}
          </div>
          <button onClick={onDelete} className="p-1 rounded hover:bg-destructive/20 text-destructive" title="Excluir balão"><Trash2 className="w-3 h-3" /></button>
        </div>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={scheduleSave}
          className="flex-1 text-sm outline-none overflow-y-auto scrollbar-thin [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4"
        />
      </div>
    </div>
  );
}
