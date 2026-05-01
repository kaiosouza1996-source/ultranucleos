import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useAppStore,
  type CustomField,
  type CustomFieldType,
  type LogEntry,
} from "@/store/appStore";
import { Save, Shield, Trash, Plus, X, GripVertical, Briefcase, QrCode, ScrollText, CheckCircle2, RefreshCw, LogOut, Filter, Download } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { mockConnectWhatsApp, mockDisconnect, engineClient } from "@/lib/engine";

export default function Configuracoes() {
  const settings = useAppStore((s) => s.settings);
  const update   = useAppStore((s) => s.updateSettings);
  const location = useLocation();
  const [tab, setTab] = useState("anti-ban");

  useEffect(() => {
    if (location.hash === "#crm") setTab("crm");
    else if (location.pathname === "/conexao") setTab("conexao");
    else if (location.pathname === "/logs") setTab("logs");
    else if (location.hash === "#motor") setTab("motor");
  }, [location.hash, location.pathname]);

  return (
    <>
      <AppHeader title="Configurações" subtitle="Conexão, anti-ban, CRM, logs e motor local" />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="bg-muted/30 flex-wrap h-auto">
          <TabsTrigger value="conexao"><QrCode className="w-3.5 h-3.5 mr-1.5" /> Conexão</TabsTrigger>
          <TabsTrigger value="anti-ban"><Shield className="w-3.5 h-3.5 mr-1.5" /> Anti-ban</TabsTrigger>
          <TabsTrigger value="crm"><Briefcase className="w-3.5 h-3.5 mr-1.5" /> CRM</TabsTrigger>
          <TabsTrigger value="logs"><ScrollText className="w-3.5 h-3.5 mr-1.5" /> Logs</TabsTrigger>
          <TabsTrigger value="motor">Motor local</TabsTrigger>
        </TabsList>

        <TabsContent value="conexao" className="space-y-4">
          <ConexaoSection />
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <LogsSection />
        </TabsContent>

        {/* ─────────── Anti-ban ─────────── */}
        <TabsContent value="anti-ban" className="space-y-4">
          <div className="glass-card p-6 animate-fade-in space-y-5">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Controle anti-ban</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumField label="Delay mínimo (s)"        value={settings.minDelay}         onChange={(v) => update({ minDelay: v })} />
              <NumField label="Delay máximo (s)"        value={settings.maxDelay}         onChange={(v) => update({ maxDelay: v })} />
              <NumField label="Limite por execução"     value={settings.perRunLimit}      onChange={(v) => update({ perRunLimit: v })} />
              <NumField label="Limite diário"           value={settings.perDayLimit}      onChange={(v) => update({ perDayLimit: v })} />
              <NumField label="Pausa longa a cada N"    value={settings.longPauseEvery}   onChange={(v) => update({ longPauseEvery: v })} />
              <NumField label="Duração pausa longa (s)" value={settings.longPauseSeconds} onChange={(v) => update({ longPauseSeconds: v })} />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border/30">
              <div>
                <div className="text-sm font-medium">Evitar duplicados</div>
                <div className="text-xs text-muted-foreground">Não reenviar para o mesmo contato no mesmo dia</div>
              </div>
              <Switch checked={settings.avoidDuplicates} onCheckedChange={(v) => update({ avoidDuplicates: v })} />
            </div>
            <Button className="btn-glow w-full" onClick={() => toast.success("Configurações salvas")}>
              <Save className="w-4 h-4 mr-2" /> Salvar
            </Button>
          </div>
        </TabsContent>

        {/* ─────────── CRM ─────────── */}
        <TabsContent value="crm" className="space-y-4">
          <PipelineEditor />
          <CustomFieldsEditor />
        </TabsContent>

        {/* ─────────── Motor + reset ─────────── */}
        <TabsContent value="motor" className="space-y-4">
          <div className="glass-card p-6 animate-fade-in">
            <h3 className="font-semibold mb-3">Motor local</h3>
            <p className="text-sm text-muted-foreground mb-3">
              O motor roda separadamente em <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-xs">whatsapp-engine/</code>.
              Inicie com:
            </p>
            <pre className="text-xs bg-muted/40 rounded p-3"><code>cd whatsapp-engine
npm install
npm start</code></pre>
            <p className="text-xs text-muted-foreground mt-3">
              Endereço esperado: <code className="px-1 rounded bg-muted text-foreground">ws://localhost:8787</code>
            </p>
          </div>

          <div className="glass-card p-6 animate-fade-in border-destructive/30">
            <h3 className="font-semibold mb-2 text-destructive flex items-center gap-2">
              <Trash className="w-4 h-4" /> Zona de risco
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Limpa todos os dados salvos no navegador (contatos, templates, CRM e configurações).
            </p>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => {
                localStorage.removeItem("wa-sender-state-v2");
                window.location.reload();
              }}
            >
              Resetar dados locais
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

// ─────────────── Pipeline editor ───────────────
function PipelineEditor() {
  const stages       = useAppStore((s) => s.pipelineStages);
  const upsertStage  = useAppStore((s) => s.upsertStage);
  const removeStage  = useAppStore((s) => s.removeStage);
  const setStages    = useAppStore((s) => s.setPipelineStages);

  const [draft, setDraft] = useState({ label: "", color: "213 100% 60%" });

  const add = () => {
    const label = draft.label.trim();
    if (!label) return;
    const key = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "-");
    if (stages.some((s) => s.key === key)) {
      toast.error("Já existe uma etapa com esse nome.");
      return;
    }
    upsertStage({
      key, label, color: draft.color,
      order: stages.length,
    });
    setDraft({ label: "", color: "213 100% 60%" });
    toast.success(`Etapa "${label}" criada`);
  };

  const move = (key: string, dir: -1 | 1) => {
    const idx = stages.findIndex((s) => s.key === key);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= stages.length) return;
    const next = [...stages];
    [next[idx].order, next[swap].order] = [next[swap].order, next[idx].order];
    setStages(next);
  };

  return (
    <div className="glass-card p-6 animate-fade-in">
      <div className="flex items-center gap-2 mb-3">
        <Briefcase className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">Etapas do pipeline</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Personalize as colunas que aparecem no Kanban do CRM. Etapas terminais marcam conversas como finalizadas.
      </p>

      <div className="space-y-2 mb-4">
        {stages.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/30">
            <div className="flex flex-col">
              <button
                onClick={() => move(s.key, -1)}
                disabled={i === 0}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
              >▲</button>
              <button
                onClick={() => move(s.key, 1)}
                disabled={i === stages.length - 1}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
              >▼</button>
            </div>
            <GripVertical className="w-4 h-4 text-muted-foreground" />
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: `hsl(${s.color})`, boxShadow: `0 0 8px hsl(${s.color})` }}
            />
            <Input
              value={s.label}
              onChange={(e) => upsertStage({ ...s, label: e.target.value })}
              className="bg-input/60 flex-1"
            />
            <Input
              value={s.color}
              onChange={(e) => upsertStage({ ...s, color: e.target.value })}
              className="bg-input/60 w-32 font-mono text-xs"
              placeholder="HSL ex: 213 100% 60%"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
              <input
                type="checkbox"
                checked={!!s.terminal}
                onChange={(e) => upsertStage({ ...s, terminal: e.target.checked })}
                className="accent-primary"
              />
              Final
            </label>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                if (stages.length <= 1) { toast.error("Deve haver pelo menos uma etapa."); return; }
                removeStage(s.key);
              }}
            >
              <X className="w-4 h-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-border/30">
        <Input
          placeholder="Nome da nova etapa"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className="bg-input/60 flex-1"
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <Input
          placeholder="HSL: 213 100% 60%"
          value={draft.color}
          onChange={(e) => setDraft({ ...draft, color: e.target.value })}
          className="bg-input/60 w-44 font-mono text-xs"
        />
        <Button className="btn-glow" onClick={add}>
          <Plus className="w-4 h-4 mr-1" /> Adicionar
        </Button>
      </div>
    </div>
  );
}

// ─────────────── Custom fields editor ───────────────
function CustomFieldsEditor() {
  const fields  = useAppStore((s) => s.customFields);
  const upsert  = useAppStore((s) => s.upsertCustomField);
  const remove  = useAppStore((s) => s.removeCustomField);

  const [draft, setDraft] = useState<{ label: string; type: CustomFieldType; options: string }>({
    label: "", type: "text", options: "",
  });

  const add = () => {
    const label = draft.label.trim();
    if (!label) return;
    const key = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "_");
    if (fields.some((f) => f.key === key)) {
      toast.error("Já existe um campo com esse nome.");
      return;
    }
    const f: CustomField = {
      id: crypto.randomUUID(),
      key, label,
      type: draft.type,
      options: draft.type === "select"
        ? draft.options.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
    };
    upsert(f);
    setDraft({ label: "", type: "text", options: "" });
    toast.success(`Campo "${label}" criado`);
  };

  return (
    <div className="glass-card p-6 animate-fade-in">
      <h3 className="font-semibold mb-1">Campos personalizados</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Adicione campos extras à ficha do contato (texto, número, data, seleção, checkbox).
      </p>

      <div className="space-y-2 mb-4">
        {fields.length === 0 && (
          <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border/30 rounded-lg">
            Nenhum campo personalizado ainda.
          </div>
        )}
        {fields.map((f) => (
          <div key={f.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/30">
            <Input
              value={f.label}
              onChange={(e) => upsert({ ...f, label: e.target.value })}
              className="bg-input/60 flex-1"
            />
            <select
              value={f.type}
              onChange={(e) => upsert({ ...f, type: e.target.value as CustomFieldType })}
              className="bg-input rounded px-3 py-2 text-sm border border-border/40 w-32"
            >
              <option value="text">Texto</option>
              <option value="number">Número</option>
              <option value="date">Data</option>
              <option value="select">Seleção</option>
              <option value="checkbox">Checkbox</option>
            </select>
            {f.type === "select" && (
              <Input
                value={(f.options || []).join(", ")}
                onChange={(e) => upsert({
                  ...f,
                  options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })}
                placeholder="opção 1, opção 2"
                className="bg-input/60 flex-1"
              />
            )}
            <Button size="icon" variant="ghost" onClick={() => remove(f.id)}>
              <X className="w-4 h-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-border/30">
        <Input
          placeholder="Nome do campo (ex: Aniversário)"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className="bg-input/60 flex-1"
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <select
          value={draft.type}
          onChange={(e) => setDraft({ ...draft, type: e.target.value as CustomFieldType })}
          className="bg-input rounded px-3 py-2 text-sm border border-border/40 w-32"
        >
          <option value="text">Texto</option>
          <option value="number">Número</option>
          <option value="date">Data</option>
          <option value="select">Seleção</option>
          <option value="checkbox">Checkbox</option>
        </select>
        {draft.type === "select" && (
          <Input
            placeholder="opção 1, opção 2"
            value={draft.options}
            onChange={(e) => setDraft({ ...draft, options: e.target.value })}
            className="bg-input/60 flex-1"
          />
        )}
        <Button className="btn-glow" onClick={add}>
          <Plus className="w-4 h-4 mr-1" /> Adicionar
        </Button>
      </div>
    </div>
  );
}

// ─────────────── helpers ───────────────
function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      <Input
        type="number"
        min={0}
        className="bg-input/60 mt-1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}

// ─────────────── Conexão ───────────────
function ConexaoSection() {
  const status = useAppStore((s) => s.status);
  const qr = useAppStore((s) => s.qr);
  const me = useAppStore((s) => s.me);
  const engineOnline = useAppStore((s) => s.engineOnline);

  const handleConnect = () => {
    if (engineOnline) engineClient.send({ type: "request-qr" });
    else mockConnectWhatsApp();
  };
  const handleDisconnect = () => {
    if (engineOnline) engineClient.send({ type: "logout" });
    else mockDisconnect();
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="glass-card p-6 animate-scale-in flex flex-col items-center justify-center text-center min-h-[360px]">
        {status === "ready" ? (
          <>
            <div className="w-16 h-16 rounded-full bg-success/15 flex items-center justify-center mb-3 animate-pulse-glow">
              <CheckCircle2 className="w-8 h-8 text-success" />
            </div>
            <h3 className="text-lg font-semibold">Conectado</h3>
            <p className="text-sm text-muted-foreground mt-1">{me}</p>
            <Button variant="outline" className="mt-5" onClick={handleDisconnect}>
              <LogOut className="w-4 h-4 mr-2" /> Desconectar
            </Button>
          </>
        ) : qr ? (
          <>
            <div className="bg-white p-4 rounded-xl shadow-elevated">
              <QRCodeSVG value={qr} size={200} level="M" />
            </div>
            <p className="text-xs text-muted-foreground mt-3 max-w-xs">
              WhatsApp → <strong className="text-foreground">Aparelhos conectados</strong> → Conectar um aparelho.
            </p>
            <Button variant="ghost" className="mt-2 text-xs" onClick={handleConnect}>
              <RefreshCw className="w-3.5 h-3.5 mr-2" /> Atualizar QR
            </Button>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
              <LogOut className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">Desconectado</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {!engineOnline && "(modo simulação ativo)"}
            </p>
            <Button className="btn-glow mt-5" onClick={handleConnect}>Iniciar conexão</Button>
          </>
        )}
      </div>

      <div className="glass-card p-5 animate-fade-in">
        <h3 className="font-semibold mb-3">Status do motor</h3>
        <div className="flex items-center gap-3 text-sm mb-4">
          <span className={`status-dot ${engineOnline ? "bg-success text-success" : "bg-warning text-warning"}`} />
          <span>{engineOnline ? "ws://localhost:8787 conectado" : "Motor offline — simulação"}</span>
        </div>
        <h4 className="font-semibold text-sm mb-2">Como funciona</h4>
        <ol className="space-y-2 text-xs text-muted-foreground list-decimal list-inside">
          <li>Inicie <code className="px-1 rounded bg-muted text-foreground">npm start</code> em <code className="px-1 rounded bg-muted text-foreground">whatsapp-engine/</code></li>
          <li>O painel conecta automaticamente</li>
          <li>Escaneie o QR uma única vez — sessão persistente</li>
        </ol>
      </div>
    </div>
  );
}

// ─────────────── Logs ───────────────
const levelStyles: Record<LogEntry["level"], string> = {
  success: "bg-success/15 text-success border-success/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
  warn: "bg-warning/15 text-warning border-warning/30",
  info: "bg-primary/15 text-primary border-primary/30",
};

function LogsSection() {
  const logs = useAppStore((s) => s.logs);
  const clear = useAppStore((s) => s.clearLogs);
  const [filter, setFilter] = useState<"all" | LogEntry["level"]>("all");

  const filtered = useMemo(() => filter === "all" ? logs : logs.filter((l) => l.level === filter), [logs, filter]);

  const exportCsv = () => {
    const header = "data,nivel,mensagem,contato\n";
    const rows = logs.map((l) => `"${new Date(l.ts).toISOString()}","${l.level}","${(l.message ?? "").replace(/"/g, '""')}","${l.contact ?? ""}"`).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `logs-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const filters: ("all" | LogEntry["level"])[] = ["all", "info", "success", "warn", "error"];
  const labels: Record<string, string> = { all: "Todos", info: "Info", success: "Sucesso", warn: "Aviso", error: "Erro" };

  return (
    <div className="glass-card p-5 animate-fade-in">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Filter className="w-4 h-4 text-muted-foreground" />
        {filters.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200
              ${filter === f ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
          >{labels[f]}</button>
        ))}
        <span className="text-xs text-muted-foreground ml-2">{logs.length} eventos</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv}><Download className="w-3.5 h-3.5 mr-2" /> CSV</Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={clear}><Trash className="w-3.5 h-3.5 mr-2" /> Limpar</Button>
        </div>
      </div>

      <div className="max-h-[600px] overflow-y-auto scrollbar-thin space-y-1.5">
        {filtered.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">Sem eventos para exibir.</div>
        ) : filtered.map((l) => (
          <div key={l.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-primary/5 transition-colors animate-slide-in">
            <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border ${levelStyles[l.level]} shrink-0`}>{l.level}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm">{l.message}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {new Date(l.ts).toLocaleString("pt-BR")} {l.contact && `• +${l.contact}`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
