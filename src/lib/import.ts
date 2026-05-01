/**
 * Smart import: detects header columns, normalizes Brazilian phones,
 * deduplicates and supports XLSX + CSV. Used by the Importar page.
 */
import * as XLSX from "xlsx";
import { normalizePhone } from "./phone";

export interface RawRow { [k: string]: unknown }

export type FieldKey = "nome" | "telefone" | "ddd" | "tag" | "email" | "documento" | "empresa";

export const FIELD_ALIASES: Record<FieldKey, string[]> = {
  nome:      ["nome", "name", "nome completo", "nomecompleto", "cliente", "razao social", "razão social"],
  telefone:  ["telefone", "celular", "whatsapp", "wpp", "numero", "número", "fone", "phone", "mobile"],
  ddd:       ["ddd", "código area", "codigo area", "area code", "cod area"],
  tag:       ["tag", "grupo", "segmento", "classificacao", "classificação", "categoria"],
  email:     ["email", "e-mail", "mail"],
  documento: ["cpf", "cnpj", "documento", "doc"],
  empresa:   ["empresa", "company", "organizacao", "organização"],
};

export interface DetectedMapping {
  // header (original) → field
  byHeader: Record<string, FieldKey | "ignorar">;
}

export interface ParsedSheet {
  headers: string[];
  rows: RawRow[];
  mapping: DetectedMapping;
}

function norm(s: string) {
  return String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function detectMapping(headers: string[]): DetectedMapping {
  const byHeader: Record<string, FieldKey | "ignorar"> = {};
  for (const h of headers) {
    const nh = norm(h);
    let found: FieldKey | "ignorar" = "ignorar";
    for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [FieldKey, string[]][]) {
      if (aliases.some((a) => nh === a || nh.includes(a))) { found = field; break; }
    }
    byHeader[h] = found;
  }
  return { byHeader };
}

/**
 * Reads a File (csv | xlsx | xls) and returns headers + rows.
 * Uses the first sheet of XLSX. CSV is parsed by SheetJS too for unified pipeline.
 */
export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Planilha vazia");
  const ws = wb.Sheets[sheetName];

  // Tenta detectar a linha de cabeçalho automaticamente: primeira linha
  // que contenha pelo menos um alias conhecido. Pega as 10 primeiras.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: false });
  let headerRow = 0;
  for (let i = 0; i < Math.min(10, matrix.length); i++) {
    const row = matrix[i] as unknown[];
    let score = 0;
    for (const cell of row) {
      const nc = norm(String(cell));
      if (Object.values(FIELD_ALIASES).some((a) => a.some((x) => nc === x || nc.includes(x)))) score++;
    }
    if (score >= 1) { headerRow = i; break; }
  }
  const headers = (matrix[headerRow] as unknown[]).map((h, i) => String(h || `col_${i + 1}`).trim());
  const rows: RawRow[] = [];
  for (let i = headerRow + 1; i < matrix.length; i++) {
    const r = matrix[i] as unknown[];
    if (!r || r.every((c) => c === "" || c == null)) continue;
    const obj: RawRow = {};
    headers.forEach((h, idx) => { obj[h] = r[idx]; });
    rows.push(obj);
  }
  return { headers, rows, mapping: detectMapping(headers) };
}

export interface NormalizedRow {
  nome: string;
  telefone: string;        // sem "+"
  tags: string[];
  email?: string;
  documento?: string;
  empresa?: string;
  status: "ok" | "duplicate" | "invalid";
  reason?: string;
  raw: RawRow;
}

export function normalizeRows(parsed: ParsedSheet, opts: {
  defaultTag?: string;
  knownPhones?: Set<string>;       // contatos já existentes (telefones normalizados)
}): NormalizedRow[] {
  const inv = (() => {
    const m: Partial<Record<FieldKey, string>> = {};
    for (const [h, f] of Object.entries(parsed.mapping.byHeader)) if (f !== "ignorar") m[f] = h;
    return m;
  })();
  // re-normaliza tudo o que veio para garantir mesma chave
  const known = new Set<string>();
  for (const p of opts.knownPhones || []) {
    const np = normalizePhone(p);
    if (np) known.add(np);
  }
  const seenInFile = new Set<string>();
  const out: NormalizedRow[] = [];

  for (const r of parsed.rows) {
    const nome = String(inv.nome ? r[inv.nome] ?? "" : "").trim();
    const telRaw = String(inv.telefone ? r[inv.telefone] ?? "" : "").trim();
    const dddRaw = String(inv.ddd ? r[inv.ddd] ?? "" : "").trim();
    const tagRaw = String(inv.tag ? r[inv.tag] ?? "" : "").trim();
    const tags = (tagRaw || opts.defaultTag || "geral")
      .split(/[,;|]/).map((s) => s.toLowerCase().trim()).filter(Boolean);
    const email = inv.email ? String(r[inv.email] ?? "").trim() : undefined;
    const documento = inv.documento ? String(r[inv.documento] ?? "").trim() : undefined;
    const empresa = inv.empresa ? String(r[inv.empresa] ?? "").trim() : undefined;

    const tel = normalizePhone(telRaw, dddRaw);
    if (!nome && !tel) continue; // linha vazia
    if (!tel) { out.push({ nome, telefone: telRaw, tags, status: "invalid", reason: "Telefone inválido", raw: r }); continue; }
    if (seenInFile.has(tel)) {
      out.push({ nome, telefone: tel, tags, status: "duplicate", reason: "Repetido na planilha", raw: r });
      continue;
    }
    if (known.has(tel)) {
      out.push({ nome, telefone: tel, tags, status: "duplicate", reason: "Já existe no sistema", raw: r });
      continue;
    }
    const finalNome = nome || tel;
    seenInFile.add(tel);
    out.push({ nome: finalNome, telefone: tel, tags, email, documento, empresa, status: "ok", raw: r });
  }
  return out;
}
