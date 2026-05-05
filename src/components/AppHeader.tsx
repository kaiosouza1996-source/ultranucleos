import { useAppStore } from "@/store/appStore";
import { Wifi, WifiOff } from "lucide-react";

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const engineOnline = useAppStore((s) => s.engineOnline);
  const status = useAppStore((s) => s.status);
  const me = useAppStore((s) => s.me);
  const whatsappReady = status === "ready";

  return (
    <header className="flex items-center justify-between gap-4 mb-6 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        <div className={`glass-card px-3 py-2 flex items-center gap-2 text-xs ${engineOnline ? "" : "border-warning/40"}`}>
          {engineOnline ? <Wifi className="w-3.5 h-3.5 text-success" /> : <WifiOff className="w-3.5 h-3.5 text-warning" />}
          <span className="font-medium">{engineOnline ? "Sistema Conectado" : "Aguardando Sistema"}</span>
        </div>
        <div className="glass-card px-3 py-2 flex items-center gap-2 text-xs">
          <span
            className={`status-dot ${
              whatsappReady ? "bg-success text-success" :
              status === "qr" ? "bg-warning text-warning" :
              "bg-destructive text-destructive"
            }`}
          />
          <span className="font-medium">
            {whatsappReady ? me ?? "Conectado" : status === "qr" ? "Aguardando QR" : "WhatsApp offline"}
          </span>
        </div>
      </div>
    </header>
  );
}
