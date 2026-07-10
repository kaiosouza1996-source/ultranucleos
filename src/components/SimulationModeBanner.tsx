import { AlertTriangle } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { MOCK_DISABLED } from "@/lib/engine";

/**
 * Banner permanente e inconfundível: aparece em toda a aplicação sempre que o
 * Sistema local (whatsapp-engine) está inacessível e o painel está operando em
 * modo simulação (QR/conexão falsos, gerados só para permitir navegar na UI).
 * Nunca deve ser confundido com uma conexão real — por isso fica sempre visível,
 * não dentro de um card discreto.
 */
export function SimulationModeBanner() {
  const engineOnline = useAppStore((s) => s.engineOnline);

  if (engineOnline) return null;

  if (MOCK_DISABLED) {
    return (
      <div className="w-full bg-destructive text-destructive-foreground px-4 py-2 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 text-center">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        Sistema local (WhatsApp) indisponível — simulação desativada em produção. Nenhuma mensagem pode ser enviada até o Sistema reconectar.
      </div>
    );
  }

  return (
    <div className="w-full bg-warning text-navy px-4 py-2 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 text-center">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      MODO SIMULAÇÃO — o Sistema local (WhatsApp) não está conectado. QR Code e status são fictícios e nenhuma mensagem real é enviada.
    </div>
  );
}
