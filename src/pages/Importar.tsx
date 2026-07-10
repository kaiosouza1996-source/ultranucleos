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
  const existingTags = useAppStore((s) => s.tags);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [fileTag, setFileTag] = useState<string>("");          // tag derivada do nome do arquivo — busca no banco de tags; se não existir, nasce nova ao importar
  const [useFileTag, setUseFileTag] = useState(true);
  const [rows, setRows] = useState<NormalizedRow[]>([]);
  const [fileName, setFileName] = useState("");
  // Cliente da Assessoria vs Lead Frio — obrigatório escolher antes de "Importar
  // e Salvar" (seção 3 da spec de Cadência de Follow-up): "Não" entra em
  // cadência D1. O botão simples "Importar" não exige essa escolha — o
  // contato entra como pendente de triagem (aba Contatos não salvos).
  const [isClientBatch, setIsClientBatch] = useState<boolean | null>(null);
  const [importing, setImporting] = useState(false);

  const reprocess = (p: ParsedSheet, fTag?: string) => {
    const known = new Set(existing.map((c) => c.telefone));
    const out = normalizeRows(p, { knownPhones: known });
    if (fTag) {
      // adiciona a tag-do-arquivo a TODAS as linhas (sem duplicar) — única
      // tag aplicada automaticamente, sem "geral" nem "tag padrão" por cima.
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
      setIsClientBatch(null);
      try {
        const p = await parseSpreadsheet(file);
        setParsed(p);
        reprocess(p, useFileTag ? auto : undefined);
        toast.success(`${p.rows.length} linhas lidas — colunas detectadas. Tag de lista: #${auto}`);
      } catch (e) {
        toast.error("Falha ao ler planilha: " + (e as Error).message);
      }
    },
  });

  const setMapping = (header: string, field: FieldKey | "ignorar") => {
    if (!parsed) return;
    const next: ParsedSheet = { ...parsed, mapping: { byHeader: { ...parsed.mapping.byHeader, [header]: field } } };
    setParsed(next); reprocess(next, useFileTag ? fileTag : undefined);
  };

  const onFileTagChange = (v: string) => {
    setFileTag(v);
    if (parsed) reprocess(parsed, useFileTag ? v : undefined);
  };
  const onUseFileTagChange = (v: boolean) => {
    setUseFileTag(v);
    if (parsed) reprocess(parsed, v ? fileTag : undefined);
  };

  const validRows = rows.filter((r) => r.status === "ok");
  const dupRows = rows.filter((r) => r.status === "duplicate");
  const invalidRows = rows.filter((r) => r.status === "invalid");

  // Sempre só os NOVOS (nunca duplicados) — reimportar quem já existe não
  // cria um segundo registro nem apaga classificação/cadência já feita
  // manualmente (o backend agora faz UPDATE seletivo em vez de recriar a
  // linha). Por isso não existe mais um botão "importar tudo".
  const runImport = async (opts: { save: boolean }) => {
    if (opts.save && isClientBatch === null) {
      toast.error("Selecione se estes contatos já são clientes da Áurea antes de importar e salvar.");
      return;
    }
    if (validRows.length === 0) { toast.error("Nenhuma linha nova para importar"); return; }
    setImporting(true);
    const newContacts: Contact[] = validRows.map((r) => ({
      id: crypto.randomUUID(),
      nome: r.nome,
      telefone: r.telefone,
      email: r.email,
      documento: r.documento,
      empresa: r.empresa,
      tags: r.tags,
      status: "novo",
      createdAt: Date.now(),
      // "Importar" simples nunca manda isClient — o contato nasce pendente de
      // triagem (Contatos não salvos). "Importar e Salvar" já classifica.
      ...(opts.save ? { isClient: isClientBatch as boolean } : {}),
    }));
    addContacts(newContacts);
    try {
      // skipStage: true — importação nunca deve criar entrada no funil do
      // CRM (contact_stage); isso é reservado pra atendimento de verdade
      // (aba Contatos é o destino real de todo contato importado).
      await api.pushContacts(newContacts.map((c) => ({ ...c, skipStage: true })));
      toast.success(
        opts.save
          ? `${newContacts.length} contatos importados e salvos como ${isClientBatch ? "Clientes da Assessoria" : "Leads Frios"}.`
          : `${newContacts.length} contatos importados — em Contatos não salvos, aguardando triagem.`,
      );
    } catch {
      toast.warning(`${newContacts.length} contatos importados só localmente — Sistema local offline.`);
    } finally {
      setImporting(false);
    }

    setRows([]); setParsed(null); setFileName(""); setFileTag(""); setIsClientBatch(null);
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
                <Button
                  variant="outline"
                  className="ml-auto"
                  disabled={validRows.length === 0 || importing}
                  onClick={() => runImport({ save: false })}
                  title="Registra os contatos novos em Contatos não salvos, aguardando triagem"
                >
                  Importar {validRows.length} novos
                </Button>
                <Button
                  className="btn-glow"
                  disabled={validRows.length === 0 || isClientBatch === null || importing}
                  onClick={() => runImport({ save: true })}
                  title="Importa e já classifica como Cliente da Assessoria ou Lead Frio"
                >
                  Importar e Salvar
                </Button>
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
                      <tr key={i} className="border-t border-border">
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
                <span className="text-xs">Aplicar esta tag a TODOS os contatos importados</span>
              </label>
              <Input
                disabled={!useFileTag}
                list="tags-existentes"
                className="bg-input/60 border-transparent focus-visible:ring-1 focus-visible:ring-primary/30 disabled:opacity-50"
                value={fileTag}
                onChange={(e) => onFileTagChange(e.target.value.toLowerCase())}
              />
              {/* Autocomplete nativo com as tags já existentes — escolher uma
                  delas anexa a este segmento; digitar um nome novo cria a tag
                  na hora da importação (o backend já faz isso automaticamente). */}
              <datalist id="tags-existentes">
                {existingTags.map((t) => <option key={t.id} value={t.nome} />)}
              </datalist>
              {useFileTag && fileTag && (
                <p className="text-[11px] mt-1.5">
                  {existingTags.some((t) => t.nome === fileTag) ? (
                    <span className="text-primary">Tag existente — os contatos serão anexados a ela.</span>
                  ) : (
                    <span className="text-warning">Tag nova — será criada ao importar.</span>
                  )}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Garante que toda lista importada vire um segmento rastreável — nunca perde o vínculo de origem.
              </p>
            </div>
          )}

          {fileName && (
            <div className={`glass-card p-5 animate-fade-in border ${isClientBatch === null ? "border-destructive/40" : "border-primary/20"}`}>
              <h3 className="font-semibold text-sm mb-1">Estes contatos já são clientes da Áurea?</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Obrigatório para "Importar e Salvar". "Não" entra automaticamente na Cadência de Follow-up (D1).
                O botão "Importar" simples não exige isso — os contatos entram como pendentes de triagem.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setIsClientBatch(true)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all
                    ${isClientBatch === true ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
                >Sim, já são clientes</button>
                <button
                  onClick={() => setIsClientBatch(false)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all
                    ${isClientBatch === false ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
                >Não, são leads frios</button>
              </div>
              {isClientBatch === null && (
                <p className="text-[11px] text-destructive mt-2">Selecione uma opção para liberar o "Importar e Salvar".</p>
              )}
            </div>
          )}

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
