import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { useAppStore, type LogEntry } from "@/store/appStore";
import { useMemo, useState } from "react";
import { Trash2, Download, Filter } from "lucide-react";

const levelStyles: Record<LogEntry["level"], string> = {
  success: "bg-success/15 text-success border-success/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
  warn: "bg-warning/15 text-warning border-warning/30",
  info: "bg-primary/15 text-primary border-primary/30",
};

export default function Logs() {
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
    <>
      <AppHeader title="Logs" subtitle={`${logs.length} eventos registrados`} />

      <div className="glass-card p-5 animate-fade-in">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {filters.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200
                ${filter === f ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
            >{labels[f]}</button>
          ))}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={exportCsv}><Download className="w-3.5 h-3.5 mr-2" /> Exportar CSV</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={clear}><Trash2 className="w-3.5 h-3.5 mr-2" /> Limpar</Button>
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
    </>
  );
}
