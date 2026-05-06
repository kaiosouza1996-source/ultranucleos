import { useAppStore } from "@/store/appStore";
import { Wifi, WifiOff } from "lucide-react";

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const engineOnline = useAppStore((s) => s.engineOnline);
  const status = useAppStore((s) => s.status);
  const me = useAppStore((s) => s.me);
  const whatsappReady = status === "ready";

  return (
    <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-5 sm:mb-6 animate-fade-in">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 line-clamp-2">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className={`glass-card px-2.5 py-1.5 sm:px-3 sm:py-2 flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs ${engineOnline ? "" : "border-warning/40"}`}>
          {engineOnline ? <Wifi className="w-3.5 h-3.5 text-success" /> : <WifiOff className="w-3.5 h-3.5 text-warning" />}
          <span className="font-medium whitespace-nowrap">{engineOnline ? "Sistema Conectado" : "Aguardando Sistema"}</span>
        </div>
        <div className="glass-card px-2.5 py-1.5 sm:px-3 sm:py-2 flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs">
          <span
            className={`status-dot ${
              whatsappReady ? "bg-success text-success" :
              status === "qr" ? "bg-warning text-warning" :
              "bg-destructive text-destructive"
            }`}
          />
          <span className="font-medium whitespace-nowrap max-w-[140px] truncate">
            {whatsappReady ? me ?? "Conectado" : status === "qr" ? "Aguardando QR" : "WhatsApp offline"}
          </span>
        </div>
      </div>
    </header>
  );
}
