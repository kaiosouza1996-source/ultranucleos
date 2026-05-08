import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore, type Contact } from "@/store/appStore";
import { useDropzone } from "react-dropzone";
import { useState } from "react";
import { Upload, FileSpreadsheet, Check, X, Download, Tag as TagIcon } from "lucide-react";
import { parseSpreadsheet, normalizeRows, type ParsedSheet, type NormalizedRow, type FieldKey } from "@/lib/import";
import { api } from "@/lib/engine";
import { toast } from "sonner";

const FIELDS: { key: FieldKey | "ignorar"; label: string }[] = [
  { key: "ignorar", label: "Ignorar" },
  { key: "nome", label: "Nome" },
  { key: "telefone", label: "Telefone" },
  { key: "ddd", label: "DDD" },
  { key: "tag", label: "Tag" },
  { key: "email", label: "E-mail" },
  { key: "documento", label: "CPF/CNPJ" },
  { key: "empresa", label: "Empresa" },
];

export default function Importar() {
  const addContacts = useAppStore((s) => s.addContacts);
  const existing = useAppStore((s) => s.contacts);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [defaultTag, setDefaultTag] = useState<string>("");
  const [fileTag, setFileTag] = useState<string>("");          // tag derivada do nome do arquivo
  const [useFileTag, setUseFileTag] = useState(true);
  const [rows, setRows] = useState<NormalizedRow[]>([]);
  const [fileName, setFileName] = useState("");

  const reprocess = (p: ParsedSheet, tag: string, fTag?: string) => {
    const known = new Set(existing.map((c) => c.telefone));
    const out = normalizeRows(p, { defaultTag: tag, knownPhones: known });
    if (fTag) {
      // adiciona a tag-do-arquivo a TODAS as linhas (sem duplicar)
      for (const r of out) {
        if (!r.tags.includes(fTag)) r.tags = [...r.tags, fTag];
      }
    }
    setRows(out);
  };

  const slugFromFileName = (name: string) => {
    return name
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
    onDrop: async (files) => {
      const file = files[0]; if (!file) return;
      setFileName(file.name);
      const auto = slugFromFileName(file.name);
      setFileTag(auto);
      try {
        const p = await parseSpreadsheet(file);
        setParsed(p);
        reprocess(p, defaultTag, useFileTag ? auto : undefined);
        toast.success(`${p.rows.length} linhas lidas — colunas detectadas. Tag de lista: #${auto}`);
      } catch (e) {
        toast.error("Falha ao ler planilha: " + (e as Error).message);
      }
    },
  });

  const setMapping = (header: string, field: FieldKey | "ignorar") => {
    if (!parsed) return;
    const next: ParsedSheet = { ...parsed, mapping: { byHeader: { ...parsed.mapping.byHeader, [header]: field } } };
    setParsed(next); reprocess(next, defaultTag, useFileTag ? fileTag : undefined);
  };

  const onTagChange = (v: string) => {
    setDefaultTag(v);
    if (parsed) reprocess(parsed, v, useFileTag ? fileTag : undefined);
  };
  const onFileTagChange = (v: string) => {
    setFileTag(v);
    if (parsed) reprocess(parsed, defaultTag, useFileTag ? v : undefined);
  };
  const onUseFileTagChange = (v: boolean) => {
    setUseFileTag(v);
    if (parsed) reprocess(parsed, defaultTag, v ? fileTag : undefined);
  };

  const validRows = rows.filter((r) => r.status === "ok");
  const dupRows = rows.filter((r) => r.status === "duplicate");
  const invalidRows = rows.filter((r) => r.status === "invalid");

  const handleImport = async (includeDuplicates = false) => {
    const toImport = includeDuplicates ? [...validRows, ...dupRows] : validRows;
    if (toImport.length === 0) { toast.error("Nenhuma linha para importar"); return; }
    const newContacts: Contact[] = toImport.map((r) => ({
      id: crypto.randomUUID(),
      nome: r.nome,
      telefone: r.telefone,
      email: r.email,
      documento: r.documento,
      empresa: r.empresa,
      tags: r.tags,
      status: "novo",
      createdAt: Date.now(),
    }));
    addContacts(newContacts);
    try { await api.pushContacts(newContacts); } catch { /* engine offline = só local */ }
    toast.success(`${newContacts.length} contatos importados`);
    setRows([]); setParsed(null); setFileName(""); setFileTag("");
  };

  const downloadSample = () => {
    const csv = "nome,telefone,ddd,tag,email,empresa\nMaria Silva,987654321,11,lead,maria@x.com,ACME\nJoão Souza,21998765432,,cliente,,\nAna Costa,5511912345678,,vip,ana@y.com,Beta\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "exemplo-contatos.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <AppHeader title="Importação inteligente" subtitle="Detecta colunas automaticamente — XLSX e CSV" />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div
            {...getRootProps()}
            className={`glass-card glass-card-hover p-10 text-center cursor-pointer border-2 border-dashed transition-all
              ${isDragActive ? "border-primary bg-primary/5" : "border-white/[0.06] hover:border-primary/40"}`}
          >
            <input {...getInputProps()} />
            <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Upload className="w-6 h-6 text-primary" />
            </div>
            <h3 className="font-semibold">{isDragActive ? "Solte o arquivo aqui" : "Arraste seu .xlsx ou .csv"}</h3>
            <p className="text-xs text-muted-foreground mt-1">O sistema detecta nome, telefone, DDD e tag automaticamente</p>
            {fileName && <p className="text-xs text-primary mt-2 flex items-center justify-center gap-1.5"><FileSpreadsheet className="w-3 h-3" />{fileName}</p>}
          </div>

          {parsed && (
            <div className="glass-card p-5 animate-fade-in space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Mapeamento de colunas</h3>
                <span className="text-xs text-muted-foreground">{parsed.rows.length} linhas detectadas</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {parsed.headers.map((h) => (
                  <div key={h} className="flex items-center gap-2 p-2 rounded bg-muted/30 border border-white/[0.04]">
                    <div className="text-sm font-medium truncate flex-1">{h}</div>
                    <select
                      value={parsed.mapping.byHeader[h]}
                      onChange={(e) => setMapping(h, e.target.value as FieldKey | "ignorar")}
                      className="text-xs bg-input/60 rounded px-2 py-1 border border-white/[0.04]"
                    >
                      {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="glass-card p-4 animate-fade-in">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <Stat label="Total" value={rows.length} />
                <Stat label="Válidos" value={validRows.length} accent="success" />
                <Stat label="Duplicados" value={dupRows.length} accent="warn" />
                <Stat label="Inválidos" value={invalidRows.length} accent="destructive" />
                <Button className="btn-glow ml-auto" disabled={validRows.length === 0} onClick={() => handleImport(false)}>
                  Importar {validRows.length} novos
                </Button>
                {dupRows.length > 0 && (
                  <Button variant="outline" onClick={() => handleImport(true)} title="Atualiza/recria contatos duplicados também">
                    Importar tudo ({validRows.length + dupRows.length})
                  </Button>
                )}
              </div>
              <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground sticky top-0 bg-card/90 backdrop-blur">
                    <tr>
                      <th className="text-left py-2 px-2">Status</th>
                      <th className="text-left py-2 px-2">Nome</th>
                      <th className="text-left py-2 px-2">Telefone</th>
                      <th className="text-left py-2 px-2">Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map((r, i) => (
                      <tr key={i} className="border-t border-border/30">
                        <td className="py-2 px-2">
                          {r.status === "ok" ? <Check className="w-4 h-4 text-success" /> :
                           <span className="flex items-center gap-1 text-xs text-muted-foreground">
                             <X className="w-3.5 h-3.5 text-destructive" />{r.reason}
                           </span>}
                        </td>
                        <td className="py-2 px-2">{r.nome || <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-2 px-2 font-mono text-xs">{r.telefone}</td>
                        <td className="py-2 px-2">
                          <div className="flex flex-wrap gap-1">
                            {r.tags.map((t) => <span key={t} className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">{t}</span>)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 200 && <p className="text-center text-xs text-muted-foreground py-2">+ {rows.length - 200} linhas (mostrando 200)</p>}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {fileName && (
            <div className="glass-card p-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-3">
                <TagIcon className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Tag automática da lista</h3>
              </div>
              <label className="flex items-center gap-2 mb-3 cursor-pointer">
                <input type="checkbox" checked={useFileTag} onChange={(e) => onUseFileTagChange(e.target.checked)} className="accent-primary" />
                <span className="text-xs">Aplicar tag derivada do nome do arquivo a TODOS os contatos importados</span>
              </label>
              <Input
                disabled={!useFileTag}
                className="bg-input/60 border-transparent focus-visible:ring-1 focus-visible:ring-primary/30 disabled:opacity-50"
                value={fileTag}
                onChange={(e) => onFileTagChange(e.target.value.toLowerCase())}
              />
              <p className="text-xs text-muted-foreground mt-2">
                Garante que toda lista importada vire um segmento rastreável — nunca perde o vínculo de origem.
              </p>
            </div>
          )}

          <div className="glass-card p-5 animate-fade-in">
            <div className="flex items-center gap-2 mb-3">
              <TagIcon className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Tag padrão</h3>
            </div>
            <Input
              placeholder="Ex: black-friday-2024"
              className="bg-input/60 border-transparent focus-visible:ring-1 focus-visible:ring-primary/30"
              value={defaultTag}
              onChange={(e) => onTagChange(e.target.value.toLowerCase())}
            />
            <p className="text-xs text-muted-foreground mt-2">Aplicada às linhas que não tiverem coluna "tag" preenchida.</p>
          </div>

          <div className="glass-card p-5 animate-fade-in">
            <h3 className="font-semibold text-sm mb-2">Aliases reconhecidos</h3>
            <div className="text-xs text-muted-foreground space-y-1.5">
              <p><strong className="text-foreground">Nome:</strong> nome, name, cliente, razao social</p>
              <p><strong className="text-foreground">Telefone:</strong> telefone, celular, whatsapp, numero, fone</p>
              <p><strong className="text-foreground">DDD:</strong> ddd, código area</p>
              <p><strong className="text-foreground">Tag:</strong> tag, grupo, segmento, categoria</p>
            </div>
          </div>

          <div className="glass-card p-5 text-xs text-muted-foreground space-y-1.5 animate-fade-in">
            <p>✓ DDD ausente → assume <strong className="text-foreground">21</strong></p>
            <p>✓ Sem DDI → adiciona <strong className="text-foreground">+55</strong></p>
            <p>✓ Cabeçalho detectado nas 10 primeiras linhas</p>
            <p>✓ Linhas duplicadas e vazias são ignoradas</p>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={downloadSample}>
              <Download className="w-3.5 h-3.5 mr-2" /> Baixar CSV de exemplo
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "success" | "warn" | "destructive" }) {
  const cls = accent === "success" ? "text-success" : accent === "warn" ? "text-warning" : accent === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="px-3 py-1.5 rounded-lg bg-muted/30 border border-white/[0.04]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
