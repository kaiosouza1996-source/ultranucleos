import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  FolderPlus, Folder, FileText, Table as TableIcon, Plus, X, Users, User,
  Trash2, Pencil, FolderInput, ChevronDown, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  annotationsApi, TABLE_TEMPLATES,
  type AnnotationFolder, type AnnotationItem, type AnnotationVisibility, type AnnotationItemType,
} from "@/lib/annotations";
import { ApiError } from "@/lib/apiFetch";
import { NotesBoard } from "@/components/annotations/NotesBoard";
import { AnnotationTable } from "@/components/annotations/AnnotationTable";

const ROOT_DROP_ID = "__root__";

export default function Anotacoes() {
  const [folders, setFolders] = useState<AnnotationFolder[]>([]);
  const [items, setItems] = useState<AnnotationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; kind: "folder" | "item"; id: string } | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showNewItem, setShowNewItem] = useState<{ folderId: string | null } | null>(null);
  const [renaming, setRenaming] = useState<{ kind: "folder" | "item"; id: string; value: string } | null>(null);
  const [confirmState, setConfirmState] = useState<{ title: string; description?: string; confirmLabel?: string; onConfirm: () => void | Promise<void> } | null>(null);
  const [visibilityWarning, setVisibilityWarning] = useState<{ itemId: string; targetFolderId: string | null; targetVisibility: AnnotationVisibility } | null>(null);
  const [folderDeleteChoice, setFolderDeleteChoice] = useState<{ id: string; name: string; itemCount: number } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = async () => {
    try {
      const tree = await annotationsApi.getTree();
      setFolders(tree.folders);
      setItems(tree.items);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const itemsByFolder = useMemo(() => {
    const map: Record<string, AnnotationItem[]> = { [ROOT_DROP_ID]: [] };
    for (const f of folders) map[f.id] = [];
    for (const it of items) {
      const key = it.folderId && map[it.folderId] ? it.folderId : ROOT_DROP_ID;
      map[key].push(it);
    }
    return map;
  }, [folders, items]);

  const activeItem = items.find((i) => i.id === activeItemId) || null;

  const createFolder = async (name: string, visibility: AnnotationVisibility) => {
    try {
      const f = await annotationsApi.createFolder(name, visibility);
      setFolders((prev) => [...prev, f]);
      setShowNewFolder(false);
      toast.success("Pasta criada");
    } catch (e) { toast.error((e as Error).message); }
  };

  const createItem = async (input: { name: string; type: AnnotationItemType; visibility: AnnotationVisibility; folderId: string | null; template?: string }) => {
    try {
      const it = await annotationsApi.createItem(input);
      setItems((prev) => [...prev, it]);
      setShowNewItem(null);
      setActiveItemId(it.id);
      toast.success("Item criado");
    } catch (e) { toast.error((e as Error).message); }
  };

  const commitMoveItem = async (itemId: string, targetFolderId: string | null) => {
    try {
      const updated = await annotationsApi.updateItem(itemId, { folderId: targetFolderId });
      setItems((prev) => prev.map((i) => (i.id === itemId ? updated : i)));
    } catch (e) { toast.error((e as Error).message); }
  };

  // Mover item entre pastas de visibilidade diferente exige confirmação
  // explícita ANTES de chamar o backend (que aplica a herança de qualquer
  // forma) — o aviso é pra decisão informada, não uma trava.
  const doMoveItem = async (itemId: string, targetFolderId: string | null) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    if ((item.folderId || null) === (targetFolderId || null)) return;
    const targetFolder = targetFolderId ? folders.find((f) => f.id === targetFolderId) : null;
    const targetVisibility: AnnotationVisibility = targetFolderId ? (targetFolder?.visibility ?? "personal") : item.visibility;
    if (targetFolderId && targetVisibility !== item.visibility) {
      setVisibilityWarning({ itemId, targetFolderId, targetVisibility });
      return;
    }
    await commitMoveItem(itemId, targetFolderId);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const itemId = String(e.active.id);
    const overId = String(e.over.id);
    doMoveItem(itemId, overId === ROOT_DROP_ID ? null : overId);
  };

  const commitRename = async () => {
    if (!renaming) return;
    const value = renaming.value.trim();
    if (!value) { setRenaming(null); return; }
    try {
      if (renaming.kind === "folder") {
        const updated = await annotationsApi.updateFolder(renaming.id, { name: value });
        setFolders((prev) => prev.map((f) => (f.id === renaming.id ? updated : f)));
      } else {
        const updated = await annotationsApi.updateItem(renaming.id, { name: value });
        setItems((prev) => prev.map((i) => (i.id === renaming.id ? updated : i)));
      }
    } catch (e) { toast.error((e as Error).message); }
    setRenaming(null);
  };

  const toggleVisibility = (kind: "folder" | "item", id: string) => {
    const isFolder = kind === "folder";
    const row = isFolder ? folders.find((f) => f.id === id) : items.find((i) => i.id === id);
    if (!row) return;
    const next: AnnotationVisibility = row.visibility === "shared" ? "personal" : "shared";
    setConfirmState({
      title: next === "shared" ? "Tornar compartilhada?" : "Tornar pessoal?",
      description: next === "shared"
        ? "Este item ficará visível e editável para toda a empresa."
        : "Este item deixará de ser visível para a equipe — só você vai enxergá-lo.",
      confirmLabel: next === "shared" ? "Compartilhar" : "Tornar pessoal",
      onConfirm: async () => {
        try {
          if (isFolder) {
            const updated = await annotationsApi.updateFolder(id, { visibility: next });
            setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)));
          } else {
            const updated = await annotationsApi.updateItem(id, { visibility: next });
            setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
          }
        } catch (e) { toast.error((e as Error).message); }
      },
    });
  };

  const deleteItem = (item: AnnotationItem) => {
    setConfirmState({
      title: `Excluir "${item.name}"?`,
      description: item.visibility === "shared" ? "Este item é compartilhado — a exclusão fica registrada em auditoria." : undefined,
      onConfirm: async () => {
        try {
          await annotationsApi.deleteItem(item.id);
          setItems((prev) => prev.filter((i) => i.id !== item.id));
          if (activeItemId === item.id) setActiveItemId(null);
          toast.success("Item excluído");
        } catch (e) { toast.error((e as Error).message); }
      },
    });
  };

  const deleteFolder = async (folder: AnnotationFolder, mode?: "cascade" | "move_to_root") => {
    try {
      await annotationsApi.deleteFolder(folder.id, mode);
      setFolderDeleteChoice(null);
      await load();
      toast.success("Pasta excluída");
    } catch (e) {
      if (e instanceof ApiError && e.payload && typeof e.payload === "object" && (e.payload as { requiresMode?: boolean }).requiresMode) {
        setFolderDeleteChoice({ id: folder.id, name: folder.name, itemCount: (e.payload as { itemCount: number }).itemCount });
        return;
      }
      toast.error((e as Error).message);
    }
  };

  const requestDeleteFolder = (folder: AnnotationFolder) => {
    setConfirmState({
      title: `Excluir a pasta "${folder.name}"?`,
      description: folder.visibility === "shared" ? "Pasta compartilhada — a exclusão fica registrada em auditoria." : undefined,
      onConfirm: () => deleteFolder(folder),
    });
  };

  if (loading) {
    return (
      <>
        <AppHeader title="Anotações" subtitle="Blocos de notas e tabelas do time, direto no sistema" />
        <div className="text-sm text-muted-foreground py-12 text-center">Carregando…</div>
      </>
    );
  }

  return (
    <>
      <AppHeader title="Anotações" subtitle="Blocos de notas e tabelas do time, direto no sistema" />
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid lg:grid-cols-[300px_1fr] gap-4 h-[calc(100vh-180px)]">
          <div className="glass-card p-3 flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => setShowNewFolder(true)}>
                <FolderPlus className="w-3.5 h-3.5 mr-1.5" /> Nova pasta
              </Button>
              <Button size="sm" className="btn-glow flex-1" onClick={() => setShowNewItem({ folderId: null })}>
                <Plus className="w-3.5 h-3.5 mr-1.5" /> Novo item
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin space-y-1">
              <RootDropZone
                items={itemsByFolder[ROOT_DROP_ID] || []}
                activeItemId={activeItemId}
                onSelectItem={setActiveItemId}
                onContextMenuItem={(e, id) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, kind: "item", id }); }}
              />
              {folders.map((f) => (
                <FolderRow
                  key={f.id}
                  folder={f}
                  items={itemsByFolder[f.id] || []}
                  activeItemId={activeItemId}
                  onSelectItem={setActiveItemId}
                  onContextMenuFolder={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, kind: "folder", id: f.id }); }}
                  onContextMenuItem={(e, id) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, kind: "item", id }); }}
                  onAddItem={() => setShowNewItem({ folderId: f.id })}
                />
              ))}
              {folders.length === 0 && (itemsByFolder[ROOT_DROP_ID] || []).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">Nenhuma pasta ou item ainda.</p>
              )}
            </div>
          </div>

          <div className="glass-card flex flex-col min-h-0 overflow-hidden">
            {!activeItem ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Selecione um item para abrir.
              </div>
            ) : activeItem.type === "notes" ? (
              <NotesBoard item={activeItem} onClose={() => setActiveItemId(null)} />
            ) : (
              <AnnotationTable item={activeItem} onClose={() => setActiveItemId(null)} />
            )}
          </div>
        </div>
      </DndContext>

      {contextMenu && (() => {
        const row: AnnotationFolder | AnnotationItem | undefined = contextMenu.kind === "folder"
          ? folders.find((f) => f.id === contextMenu.id)
          : items.find((i) => i.id === contextMenu.id);
        if (!row) return null;
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
            <div className="fixed z-50 w-56 rounded-xl border border-border bg-card/95 backdrop-blur shadow-elegant overflow-hidden animate-scale-in" style={{ top: contextMenu.y, left: contextMenu.x }}>
              <button onClick={() => { setRenaming({ kind: contextMenu.kind, id: row.id, value: row.name }); setContextMenu(null); }} className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10 border-b border-border">
                <Pencil className="w-4 h-4 text-primary" /> Renomear
              </button>
              {contextMenu.kind === "item" && (
                <div className="border-b border-border">
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Mover para</div>
                  <button onClick={() => { doMoveItem(row.id, null); setContextMenu(null); }} className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-primary/10">
                    <FolderInput className="w-3.5 h-3.5 text-muted-foreground" /> Raiz
                  </button>
                  {folders.map((f) => (
                    <button key={f.id} onClick={() => { doMoveItem(row.id, f.id); setContextMenu(null); }} className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-primary/10">
                      <Folder className="w-3.5 h-3.5 text-muted-foreground" /> {f.name}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => { toggleVisibility(contextMenu.kind, row.id); setContextMenu(null); }} className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary/10 border-b border-border">
                {row.visibility === "shared" ? <><User className="w-4 h-4 text-primary" /> Tornar pessoal</> : <><Users className="w-4 h-4 text-primary" /> Tornar compartilhada</>}
              </button>
              <button
                onClick={() => {
                  setContextMenu(null);
                  if (contextMenu.kind === "folder") requestDeleteFolder(row as AnnotationFolder);
                  else deleteItem(row as AnnotationItem);
                }}
                className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-destructive/10 text-destructive"
              >
                <Trash2 className="w-4 h-4" /> Excluir
              </button>
            </div>
          </>
        );
      })()}

      {renaming && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={() => setRenaming(null)}>
          <div className="glass-card max-w-sm w-full p-5 animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-sm mb-3">Renomear</h3>
            <Input
              autoFocus value={renaming.value} onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(null); }}
              className="bg-input/60"
            />
            <div className="flex gap-2 mt-4 justify-end">
              <Button variant="ghost" onClick={() => setRenaming(null)}>Cancelar</Button>
              <Button className="btn-glow" onClick={commitRename}>Salvar</Button>
            </div>
          </div>
        </div>
      )}

      {showNewFolder && <NewFolderDialog onClose={() => setShowNewFolder(false)} onCreate={createFolder} />}
      {showNewItem && (
        <NewItemDialog folders={folders} defaultFolderId={showNewItem.folderId} onClose={() => setShowNewItem(null)} onCreate={createItem} />
      )}

      {visibilityWarning && (
        <ConfirmDialog
          title={visibilityWarning.targetVisibility === "shared" ? "Este item ficará visível e editável para toda a empresa" : "Este item deixará de ser visível para a equipe"}
          description="A pasta de destino tem uma visibilidade diferente da atual do item — mover pra lá muda a visibilidade dele também."
          confirmLabel="Mover mesmo assim"
          destructive={false}
          onCancel={() => setVisibilityWarning(null)}
          onConfirm={async () => {
            await commitMoveItem(visibilityWarning.itemId, visibilityWarning.targetFolderId);
            setVisibilityWarning(null);
          }}
        />
      )}

      {folderDeleteChoice && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={() => setFolderDeleteChoice(null)}>
          <div className="glass-card max-w-sm w-full p-5 animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-sm mb-2">Excluir &quot;{folderDeleteChoice.name}&quot;</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Esta pasta tem {folderDeleteChoice.itemCount} item(ns). O que fazer com eles?
            </p>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => { const f = folders.find((x) => x.id === folderDeleteChoice.id); if (f) deleteFolder(f, "move_to_root"); }}>
                Mover itens para a raiz
              </Button>
              <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { const f = folders.find((x) => x.id === folderDeleteChoice.id); if (f) deleteFolder(f, "cascade"); }}>
                Excluir os itens junto
              </Button>
              <Button variant="ghost" onClick={() => setFolderDeleteChoice(null)}>Cancelar</Button>
            </div>
          </div>
        </div>
      )}

      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          onCancel={() => setConfirmState(null)}
          onConfirm={async () => { await confirmState.onConfirm(); }}
        />
      )}
    </>
  );
}

function ItemRow({ item, active, onSelect, onContextMenu }: {
  item: AnnotationItem; active: boolean; onSelect: () => void; onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });
  const Icon = item.type === "notes" ? FileText : TableIcon;
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition-all touch-none
        ${active ? "bg-primary/15 text-foreground" : "hover:bg-primary/8"} ${isDragging ? "opacity-30" : ""}`}
    >
      <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span className="truncate flex-1">{item.name}</span>
      {item.visibility === "shared" && <Users className="w-3 h-3 text-primary shrink-0" />}
    </button>
  );
}

function RootDropZone({ items, activeItemId, onSelectItem, onContextMenuItem }: {
  items: AnnotationItem[]; activeItemId: string | null;
  onSelectItem: (id: string) => void; onContextMenuItem: (e: React.MouseEvent, id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROP_ID });
  return (
    <div ref={setNodeRef} className={`rounded-lg p-1 space-y-0.5 transition-colors ${isOver ? "bg-primary/10 ring-1 ring-primary/40" : ""}`}>
      {items.map((it) => (
        <ItemRow key={it.id} item={it} active={activeItemId === it.id} onSelect={() => onSelectItem(it.id)} onContextMenu={(e) => onContextMenuItem(e, it.id)} />
      ))}
    </div>
  );
}

function FolderRow({ folder, items, activeItemId, onSelectItem, onContextMenuFolder, onContextMenuItem, onAddItem }: {
  folder: AnnotationFolder; items: AnnotationItem[]; activeItemId: string | null;
  onSelectItem: (id: string) => void;
  onContextMenuFolder: (e: React.MouseEvent) => void;
  onContextMenuItem: (e: React.MouseEvent, id: string) => void;
  onAddItem: () => void;
}) {
  const [open, setOpen] = useState(true);
  const { setNodeRef, isOver } = useDroppable({ id: folder.id });
  return (
    <div>
      <div
        onContextMenu={onContextMenuFolder}
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-primary/8 cursor-pointer"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
        <Folder className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-sm font-medium truncate flex-1">{folder.name}</span>
        {folder.visibility === "shared" && <Users className="w-3 h-3 text-primary shrink-0" />}
        <button onClick={(e) => { e.stopPropagation(); onAddItem(); }} title="Novo item nesta pasta"
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-primary/15">
          <Plus className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
      {open && (
        <div ref={setNodeRef} className={`ml-4 pl-2 border-l border-border space-y-0.5 py-0.5 rounded-r-lg transition-colors ${isOver ? "bg-primary/10 ring-1 ring-primary/40" : ""}`}>
          {items.length === 0 && <div className="text-[11px] text-muted-foreground px-2 py-1">Vazia</div>}
          {items.map((it) => (
            <ItemRow key={it.id} item={it} active={activeItemId === it.id} onSelect={() => onSelectItem(it.id)} onContextMenu={(e) => onContextMenuItem(e, it.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function VisibilityToggle({ value, onChange }: { value: AnnotationVisibility; onChange: (v: AnnotationVisibility) => void }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">Visibilidade</label>
      <div className="flex gap-2 mt-1">
        <button type="button" onClick={() => onChange("personal")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-colors ${value === "personal" ? "bg-primary/15 border-primary/40 text-foreground" : "border-border text-muted-foreground hover:bg-muted/30"}`}>
          <User className="w-3.5 h-3.5" /> Pessoal
        </button>
        <button type="button" onClick={() => onChange("shared")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-colors ${value === "shared" ? "bg-primary/15 border-primary/40 text-foreground" : "border-border text-muted-foreground hover:bg-muted/30"}`}>
          <Users className="w-3.5 h-3.5" /> Compartilhada
        </button>
      </div>
    </div>
  );
}

function NewFolderDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, visibility: AnnotationVisibility) => void }) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<AnnotationVisibility>("personal");
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-sm w-full p-5 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">Nova pasta</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Nome</label>
            <Input
              autoFocus className="bg-input/60 mt-1" value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onCreate(name.trim(), visibility); }}
            />
          </div>
          <VisibilityToggle value={visibility} onChange={setVisibility} />
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button className="btn-glow" disabled={!name.trim()} onClick={() => onCreate(name.trim(), visibility)}>Criar</Button>
        </div>
      </div>
    </div>
  );
}

function NewItemDialog({ folders, defaultFolderId, onClose, onCreate }: {
  folders: AnnotationFolder[];
  defaultFolderId: string | null;
  onClose: () => void;
  onCreate: (input: { name: string; type: AnnotationItemType; visibility: AnnotationVisibility; folderId: string | null; template?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AnnotationItemType>("notes");
  const [visibility, setVisibility] = useState<AnnotationVisibility>("personal");
  const [folderId, setFolderId] = useState<string>(defaultFolderId || "");
  const [template, setTemplate] = useState<string>("");

  const targetFolder = folderId ? folders.find((f) => f.id === folderId) : null;
  const submit = () => {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), type, visibility, folderId: folderId || null, template: type === "table" && template ? template : undefined });
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-md w-full p-5 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">Novo item</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Nome</label>
            <Input autoFocus className="bg-input/60 mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Formato</label>
            <div className="flex gap-2 mt-1">
              <button type="button" onClick={() => setType("notes")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-colors ${type === "notes" ? "bg-primary/15 border-primary/40 text-foreground" : "border-border text-muted-foreground hover:bg-muted/30"}`}>
                <FileText className="w-3.5 h-3.5" /> Bloco de Notas
              </button>
              <button type="button" onClick={() => setType("table")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-colors ${type === "table" ? "bg-primary/15 border-primary/40 text-foreground" : "border-border text-muted-foreground hover:bg-muted/30"}`}>
                <TableIcon className="w-3.5 h-3.5" /> Tabela
              </button>
            </div>
          </div>
          {type === "table" && (
            <div>
              <label className="text-xs text-muted-foreground">Modelo</label>
              <select value={template} onChange={(e) => setTemplate(e.target.value)} className="w-full mt-1 h-9 rounded-lg border border-border bg-input/60 px-2 text-sm">
                <option value="">Começar em branco</option>
                {Object.entries(TABLE_TEMPLATES).map(([key, t]) => (
                  <option key={key} value={key}>Usar template: {t.label}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground">Pasta</label>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="w-full mt-1 h-9 rounded-lg border border-border bg-input/60 px-2 text-sm">
              <option value="">Raiz</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          {targetFolder ? (
            <p className="text-[11px] text-muted-foreground">
              Este item vai herdar a visibilidade da pasta "{targetFolder.name}" ({targetFolder.visibility === "shared" ? "Compartilhada" : "Pessoal"}).
            </p>
          ) : (
            <VisibilityToggle value={visibility} onChange={setVisibility} />
          )}
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button className="btn-glow" disabled={!name.trim()} onClick={submit}>Criar</Button>
        </div>
      </div>
    </div>
  );
}
