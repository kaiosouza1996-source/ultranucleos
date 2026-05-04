import { useAppStore } from "@/store/appStore";
import { Wifi, WifiOff, Shield, ShieldOff } from "lucide-react";

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const engineOnline = useAppStore((s) => s.engineOnline);
  const forced = useAppStore((s) => s.forcedConnection);
  const setForced = useAppStore((s) => s.setForcedConnection);
  const status = useAppStore((s) => s.status);
  const me = useAppStore((s) => s.me);

  const effectiveOnline = engineOnline || forced;
  const effectiveStatus: typeof status = forced && status !== "ready" ? "ready" : status;

  return (
    <header className="flex items-center justify-between gap-4 mb-6 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setForced(!forced)}
          title={forced ? "Modo de Conexão Forçada ativo — clique para desativar" : "Ativar Modo de Conexão Forçada"}
          className={`glass-card px-3 py-2 flex items-center gap-2 text-xs transition-all hover:scale-[1.02] ${
            forced ? "border-primary/50 text-primary shadow-glow" : "text-muted-foreground"
          }`}
        >
          {forced ? <Shield className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
          <span className="font-medium">{forced ? "Conexão forçada" : "Modo automático"}</span>
        </button>
        <div className={`glass-card px-3 py-2 flex items-center gap-2 text-xs ${effectiveOnline ? "" : "border-warning/40"}`}>
          {effectiveOnline ? <Wifi className="w-3.5 h-3.5 text-success" /> : <WifiOff className="w-3.5 h-3.5 text-warning" />}
          <span className="font-medium">{effectiveOnline ? "Sistema Conectado" : "Modo simulação"}</span>
        </div>
        <div className="glass-card px-3 py-2 flex items-center gap-2 text-xs">
          <span
            className={`status-dot ${
              effectiveStatus === "ready" ? "bg-success text-success" :
              effectiveStatus === "qr" ? "bg-warning text-warning" :
              "bg-destructive text-destructive"
            }`}
          />
          <span className="font-medium">
            {effectiveStatus === "ready" ? me ?? "Conectado" : effectiveStatus === "qr" ? "Escaneie QR" : "WhatsApp offline"}
          </span>
        </div>
      </div>
    </header>
  );
}
