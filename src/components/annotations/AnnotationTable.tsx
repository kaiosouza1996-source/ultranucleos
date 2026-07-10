import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, Search as SearchIcon, ArrowUp, ArrowDown, Copy, Check, Trash2, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import {
  annotationsApi,
  type AnnotationItem, type AnnotationTableColumn, type AnnotationTableRow, type TableColumnType,
} from "@/lib/annotations";

const COLUMN_TYPE_LABEL: Record<TableColumnType, string> = {
  text: "Texto", number: "Número", currency: "Moeda (R$)", link: "Link", email: "E-mail",
};
const COLUMN_TYPES: TableColumnType[] = ["text", "number", "currency", "link", "email"];

function formatCurrencyBRL(v: string | number | null | undefined): string {
  if (v == null || v === "") return "";
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/\./g, "").replace(",", "."));
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Modo Tabela — datagrid editável com colunas dinâmicas, edição inline
 * (clique/Enter/Esc), busca e ordenação em memória, botão de copiar em
 * Link/E-mail, e last-write-wins por célula (PATCH manda só a chave alterada).
 */
export function AnnotationTable({ item, onClose }: { item: AnnotationItem; onClose: () => void }) {
  const [columns, setColumns] = useState<AnnotationTableColumn[]>([]);
  const [rows, setRows] = useState<AnnotationTableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ columnId: string; dir: "asc" | "desc" } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    annotationsApi.getTable(item.id)
      .then(({ columns: cols, rows: rws }) => { setColumns(cols); setRows(rws); })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [item.id]);

  const filteredSortedRows = useMemo(() => {
    let list = rows;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => columns.some((c) => String(r.data[c.id] ?? "").toLowerCase().includes(q)));
    if (sort) {
      list = [...list].sort((a, b) => {
        const cmp = String(a.data[sort.columnId] ?? "").localeCompare(String(b.data[sort.columnId] ?? ""), "pt-BR", { numeric: true });
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [rows, search, sort, columns]);

  const addColumn = async (name: string, type: TableColumnType) => {
    try {
      const col = await annotationsApi.addColumn(item.id, name, type);
      setColumns((prev) => [...prev, col]);
      setShowAddColumn(false);
    } catch (e) { toast.error((e as Error).message); }
  };

  const renameColumn = async (col: AnnotationTableColumn, name: string) => {
    if (!name.trim() || name.trim() === col.name) return;
    try {
      const updated = await annotationsApi.updateColumn(col.id, { name: name.trim() });
      setColumns((prev) => prev.map((c) => (c.id === col.id ? updated : c)));
    } catch (e) { toast.error((e as Error).message); }
  };

  const removeColumn = async (col: AnnotationTableColumn) => {
    try {
      await annotationsApi.deleteColumn(col.id);
      setColumns((prev) => prev.filter((c) => c.id !== col.id));
    } catch (e) { toast.error((e as Error).message); }
  };

  const reorderColumn = async (col: AnnotationTableColumn, dir: -1 | 1) => {
    const idx = columns.findIndex((c) => c.id === col.id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= columns.length) return;
    const reordered = [...columns];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    setColumns(reordered);
    try {
      await Promise.all(reordered.map((c, i) => annotationsApi.updateColumn(c.id, { ordem: i })));
    } catch (e) { toast.error((e as Error).message); }
  };

  const addRow = async () => {
    try {
      const row = await annotationsApi.addRow(item.id, {});
      setRows((prev) => [...prev, row]);
    } catch (e) { toast.error((e as Error).message); }
  };

  const removeRow = async (row: AnnotationTableRow) => {
    try {
      await annotationsApi.deleteRow(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e) { toast.error((e as Error).message); }
  };

  const startEdit = (rowId: string, columnId: string, current: string | number | null) => {
    setEditingCell({ rowId, columnId });
    setDraft(current == null ? "" : String(current));
  };

  const commitEdit = async () => {
    if (!editingCell) return;
    const { rowId, columnId } = editingCell;
    setEditingCell(null);
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const prevData = row.data;
    if (String(prevData[columnId] ?? "") === draft) return;
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, data: { ...r.data, [columnId]: draft } } : r)));
    try {
      await annotationsApi.updateRow(rowId, { [columnId]: draft });
    } catch (e) {
      toast.error((e as Error).message);
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, data: prevData } : r)));
    }
  };

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const toggleSort = (columnId: string) => {
    setSort((prev) => {
      if (!prev || prev.columnId !== columnId) return { columnId, dir: "asc" };
      if (prev.dir === "asc") return { columnId, dir: "desc" };
      return null;
    });
  };

  return (
    <>
      <header className="flex items-center gap-3 p-4 border-b border-border shrink-0 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{item.name}</div>
          {item.updatedByName && <div className="text-[11px] text-muted-foreground">editado por {item.updatedByName}</div>}
        </div>
        <div className="relative flex-1 min-w-[160px] max-w-xs ml-auto">
          <SearchIcon className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-8 bg-input/60 text-sm" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAddColumn(true)}><Plus className="w-3.5 h-3.5 mr-1" /> Coluna</Button>
        <Button size="icon" variant="ghost" onClick={onClose} title="Fechar"><X className="w-4 h-4" /></Button>
      </header>
      <div className="flex-1 overflow-auto scrollbar-thin">
        {loading ? (
          <p className="text-xs text-muted-foreground text-center py-12">Carregando…</p>
        ) : columns.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">
            Nenhuma coluna ainda.
            <div className="mt-2"><Button size="sm" className="btn-glow" onClick={() => setShowAddColumn(true)}><Plus className="w-3.5 h-3.5 mr-1" /> Adicionar coluna</Button></div>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-card/95 backdrop-blur z-10">
              <tr>
                {columns.map((col) => (
                  <th key={col.id} className="text-left px-3 py-2 border-b border-border font-medium text-xs text-muted-foreground whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <button onClick={() => toggleSort(col.id)} className="flex items-center gap-1 hover:text-foreground">
                        {col.name}
                        {sort?.columnId === col.id && (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                      </button>
                      <ColumnHeaderMenu
                        col={col}
                        canMoveLeft={columns.findIndex((c) => c.id === col.id) > 0}
                        canMoveRight={columns.findIndex((c) => c.id === col.id) < columns.length - 1}
                        onRename={(name) => renameColumn(col, name)}
                        onDelete={() => removeColumn(col)}
                        onReorder={(dir) => reorderColumn(col, dir)}
                      />
                    </div>
                  </th>
                ))}
                <th className="w-8 border-b border-border" />
              </tr>
            </thead>
            <tbody>
              {filteredSortedRows.map((row) => (
                <tr key={row.id} className="group hover:bg-primary/5">
                  {columns.map((col) => {
                    const raw = row.data[col.id];
                    const isEditing = editingCell?.rowId === row.id && editingCell?.columnId === col.id;
                    const cellKey = `${row.id}:${col.id}`;
                    const copyable = (col.type === "link" || col.type === "email") && !!raw;
                    return (
                      <td key={col.id} className="px-3 py-1.5 border-b border-border/60 align-middle">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit();
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                            className="w-full bg-input/60 border border-primary/40 rounded px-1.5 py-0.5 text-sm outline-none"
                          />
                        ) : (
                          <div className="flex items-center gap-1.5 min-h-[22px]">
                            <span onClick={() => startEdit(row.id, col.id, raw)} className="flex-1 cursor-text truncate">
                              {col.type === "currency" ? formatCurrencyBRL(raw) : (raw ?? "")}
                            </span>
                            {copyable && (
                              <button
                                onClick={() => copyValue(cellKey, String(raw))}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-primary/15 shrink-0"
                                title="Copiar"
                              >
                                {copiedKey === cellKey ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 border-b border-border/60">
                    <button onClick={() => removeRow(row)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/15 text-destructive" title="Excluir linha">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-2">
                  <button onClick={addRow} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                    <Plus className="w-3.5 h-3.5" /> Adicionar linha
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {showAddColumn && <AddColumnDialog onClose={() => setShowAddColumn(false)} onCreate={addColumn} />}
    </>
  );
}

function ColumnHeaderMenu({ col, canMoveLeft, canMoveRight, onRename, onDelete, onReorder }: {
  col: AnnotationTableColumn;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onReorder: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(col.name);

  return (
    <div className="relative">
      <button onClick={() => { setOpen((v) => !v); setRenaming(false); setValue(col.name); }} className="p-0.5 rounded hover:bg-primary/15" title="Mais opções">
        <MoreVertical className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-5 z-50 w-44 rounded-lg border border-border bg-card shadow-elegant overflow-hidden normal-case font-normal">
            {renaming ? (
              <div className="p-2">
                <input
                  autoFocus value={value} onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { onRename(value); setRenaming(false); setOpen(false); } if (e.key === "Escape") setRenaming(false); }}
                  className="w-full bg-input/60 border border-border rounded px-1.5 py-1 text-xs outline-none"
                />
              </div>
            ) : (
              <button onClick={() => setRenaming(true)} className="w-full text-left px-3 py-2 text-xs hover:bg-primary/10">Renomear</button>
            )}
            {canMoveLeft && <button onClick={() => { onReorder(-1); setOpen(false); }} className="w-full text-left px-3 py-2 text-xs hover:bg-primary/10">Mover p/ esquerda</button>}
            {canMoveRight && <button onClick={() => { onReorder(1); setOpen(false); }} className="w-full text-left px-3 py-2 text-xs hover:bg-primary/10">Mover p/ direita</button>}
            <button onClick={() => { onDelete(); setOpen(false); }} className="w-full text-left px-3 py-2 text-xs hover:bg-destructive/10 text-destructive">Excluir coluna</button>
          </div>
        </>
      )}
    </div>
  );
}

function AddColumnDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, type: TableColumnType) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<TableColumnType>("text");
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-sm w-full p-5 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">Nova coluna</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Nome</label>
            <Input autoFocus className="bg-input/60 mt-1" value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onCreate(name.trim(), type); }} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Tipo</label>
            <select value={type} onChange={(e) => setType(e.target.value as TableColumnType)} className="w-full mt-1 h-9 rounded-lg border border-border bg-input/60 px-2 text-sm">
              {COLUMN_TYPES.map((t) => <option key={t} value={t}>{COLUMN_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button className="btn-glow" disabled={!name.trim()} onClick={() => onCreate(name.trim(), type)}>Adicionar</Button>
        </div>
      </div>
    </div>
  );
}
