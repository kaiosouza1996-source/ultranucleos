import { useAppStore } from "@/store/appStore";

/**
 * Indicador visual em tempo real do estado do WhatsApp.
 * Reflete o estado global `statusWhatsApp` (store.status) atualizado pelo WebSocket.
 *  🟢 Conectado   🔴 Desconectado   📱 Aguardando QR
 */
export function WhatsAppStatusBadge({ className = "" }: { className?: string }) {
  const status = useAppStore((s) => s.status);
  const me = useAppStore((s) => s.me);

  let icon = "🔴";
  let label = "WhatsApp desconectado";
  let tone = "border-destructive/40 text-destructive";

  if (status === "ready") {
    icon = "🟢";
    label = me ? `Conectado como ${me}` : "WhatsApp conectado";
    tone = "border-success/40 text-success";
  } else if (status === "qr") {
    icon = "📱";
    label = "Aguardando QR Code";
    tone = "border-warning/40 text-warning";
  } else if (status === "connecting") {
    icon = "📱";
    label = "Conectando…";
    tone = "border-warning/40 text-warning";
  }

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border bg-card/60 backdrop-blur-sm px-3 py-1.5 text-xs font-medium ${tone} ${className}`}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden className="text-sm leading-none">{icon}</span>
      <span>{label}</span>
    </div>
  );
}
