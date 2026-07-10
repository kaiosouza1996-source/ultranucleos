/**
 * Anotações — pastas/itens (bloco de notas ou tabela), hierarquia de 1
 * nível, visibilidade pessoal/compartilhada. Backend em
 * whatsapp-engine/annotations.js (Postgres) — mesmo padrão de funis.ts/comms.ts.
 */
import { apiFetch } from "@/lib/apiFetch";

export type AnnotationVisibility = "personal" | "shared";
export type AnnotationItemType = "notes" | "table";
export type TableColumnType = "text" | "number" | "currency" | "link" | "email";
export type NoteSize = "small" | "large";

export interface AnnotationFolder {
  id: string;
  name: string;
  visibility: AnnotationVisibility;
  ordem: number;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

export interface AnnotationItem {
  id: string;
  folderId: string | null;
  name: string;
  type: AnnotationItemType;
  visibility: AnnotationVisibility;
  ordem: number;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

export interface AnnotationNote {
  id: string;
  itemId: string;
  content: string;
  size: NoteSize;
  color: string;
  ordem: number;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

export interface AnnotationTableColumn {
  id: string;
  itemId: string;
  name: string;
  type: TableColumnType;
  ordem: number;
}

export interface AnnotationTableRow {
  id: string;
  itemId: string;
  data: Record<string, string | number | null>;
  ordem: number;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

// Paleta fixa derivada do tema atual (mesmos hex usados como acento em toda a
// UI — ver src/index.css e a PALETTE de Tags.tsx) — nunca um color picker livre.
export const NOTE_COLORS = ["#4A8EFF", "#C84BFF", "#FF4B9E", "#10B981", "#F59E0B", "#EF4444", "#22D3EE", "#84CC16"];

export const TABLE_TEMPLATES: Record<string, { label: string; columns: { name: string; type: TableColumnType }[] }> = {
  barras_corretagem: {
    label: "Barras de Corretagem",
    columns: [
      { name: "Nome da Barra", type: "text" },
      { name: "Corretagem", type: "currency" },
      { name: "Parceiro", type: "text" },
      { name: "Código", type: "text" },
      { name: "Link de Abertura de Conta", type: "link" },
      { name: "E-mail", type: "email" },
    ],
  },
};

export const annotationsApi = {
  async getTree(): Promise<{ folders: AnnotationFolder[]; items: AnnotationItem[] }> {
    return apiFetch("/annotations/tree");
  },

  async createFolder(name: string, visibility: AnnotationVisibility): Promise<AnnotationFolder> {
    return apiFetch("/annotations/folders", { method: "POST", body: JSON.stringify({ name, visibility }) });
  },
  async updateFolder(id: string, patch: Partial<{ name: string; visibility: AnnotationVisibility; ordem: number }>): Promise<AnnotationFolder> {
    return apiFetch(`/annotations/folders/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  /** mode é obrigatório só quando a pasta tem itens visíveis — o backend
   * responde 409 com `requiresMode: true` se faltar. */
  async deleteFolder(id: string, mode?: "cascade" | "move_to_root"): Promise<void> {
    const qs = mode ? `?mode=${mode}` : "";
    await apiFetch(`/annotations/folders/${encodeURIComponent(id)}${qs}`, { method: "DELETE" });
  },

  async createItem(input: { name: string; type: AnnotationItemType; visibility: AnnotationVisibility; folderId?: string | null; template?: string }): Promise<AnnotationItem> {
    return apiFetch("/annotations/items", { method: "POST", body: JSON.stringify(input) });
  },
  async updateItem(id: string, patch: Partial<{ name: string; visibility: AnnotationVisibility; folderId: string | null; ordem: number }>): Promise<AnnotationItem> {
    return apiFetch(`/annotations/items/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  async deleteItem(id: string): Promise<void> {
    await apiFetch(`/annotations/items/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  // ── Bloco de notas ──
  async listNotes(itemId: string): Promise<AnnotationNote[]> {
    return apiFetch(`/annotations/items/${encodeURIComponent(itemId)}/notes`);
  },
  async createNote(itemId: string, input?: Partial<{ size: NoteSize; color: string }>): Promise<AnnotationNote> {
    return apiFetch(`/annotations/items/${encodeURIComponent(itemId)}/notes`, { method: "POST", body: JSON.stringify(input || {}) });
  },
  async updateNote(id: string, patch: Partial<{ content: string; size: NoteSize; color: string; ordem: number }>): Promise<AnnotationNote> {
    return apiFetch(`/annotations/notes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  async deleteNote(id: string): Promise<void> {
    await apiFetch(`/annotations/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  // ── Tabela ──
  async getTable(itemId: string): Promise<{ columns: AnnotationTableColumn[]; rows: AnnotationTableRow[] }> {
    return apiFetch(`/annotations/items/${encodeURIComponent(itemId)}/table`);
  },
  async addColumn(itemId: string, name: string, type: TableColumnType): Promise<AnnotationTableColumn> {
    return apiFetch(`/annotations/items/${encodeURIComponent(itemId)}/table/columns`, { method: "POST", body: JSON.stringify({ name, type }) });
  },
  async updateColumn(id: string, patch: Partial<{ name: string; type: TableColumnType; ordem: number }>): Promise<AnnotationTableColumn> {
    return apiFetch(`/annotations/table/columns/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  async deleteColumn(id: string): Promise<void> {
    await apiFetch(`/annotations/table/columns/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async addRow(itemId: string, data?: Record<string, string | number | null>): Promise<AnnotationTableRow> {
    return apiFetch(`/annotations/items/${encodeURIComponent(itemId)}/table/rows`, { method: "POST", body: JSON.stringify({ data: data || {} }) });
  },
  /** Faz merge parcial (last-write-wins por célula) — só as chaves alteradas. */
  async updateRow(id: string, data: Record<string, string | number | null>): Promise<AnnotationTableRow> {
    return apiFetch(`/annotations/table/rows/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ data }) });
  },
  async deleteRow(id: string): Promise<void> {
    await apiFetch(`/annotations/table/rows/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};
