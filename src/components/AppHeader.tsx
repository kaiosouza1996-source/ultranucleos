import { useAppStore } from "@/store/appStore";
import { NotificationBell } from "@/components/NotificationBell";

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const engineOnline = useAppStore((s) => s.engineOnline);
  const status = useAppStore((s) => s.status);
  const me = useAppStore((s) => s.me);
  const connections = useAppStore((s) => s.connections);
  // "Conectado" de verdade exige status ready E o Sistema realmente online —
  // nunca mostrar o indicador verde para uma conexão simulada (mock). Qualquer
  // outro estado (qr, connecting, disconnected, ou simulado) cai em "Aguardando
  // conexão" — um único indicador, sem expor o detalhe técnico de "Sistema"
  // separado do WhatsApp.
  const whatsappReallyReady = status === "ready" && engineOnline;

  // Com só 1 número conectado, mostra como sempre (bolinha verde + nome
  // completo). Com 2+ números conectados, mantém um único badge no topo com
  // o nome do número PRINCIPAL (o primeiro conectado) seguido de "+N" (N =
  // quantidade de números adicionais) — detalhe completo de cada número só
  // aparece na aba Conexão.
  const readyConnections = engineOnline ? connections.filter((c) => c.status === "ready" && c.me) : [];

  return (
    <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-5 sm:mb-6 animate-fade-in">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 line-clamp-2">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <NotificationBell />
        {readyConnections.length > 1 ? (
          <div className="glass-card px-2.5 py-1.5 sm:px-3 sm:py-2 flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs">
            <span className="status-dot bg-success text-success" />
            <span className="font-medium whitespace-nowrap">
              {readyConnections[0].me} +{readyConnections.length - 1}
            </span>
          </div>
        ) : (
          <div className="glass-card px-2.5 py-1.5 sm:px-3 sm:py-2 flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs">
            <span className={`status-dot ${whatsappReallyReady ? "bg-success text-success" : "bg-warning text-warning"}`} />
            <span className="font-medium whitespace-nowrap">
              {whatsappReallyReady ? me ?? "Conectado" : "Aguardando conexão"}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
