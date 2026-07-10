import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

/**
 * Confirmação de ação destrutiva (apagar mensagem, apagar conversa, etc.) —
 * mesmo padrão visual de FilePreviewDialog (glass-card). Clicar fora ou no
 * botão "Cancelar" sempre descarta sem executar nada; nenhum efeito colateral
 * acontece até o usuário confirmar explicitamente.
 */
export function ConfirmDialog({
  title, description, confirmLabel = "Apagar", destructive = true, onCancel, onConfirm,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };

  // Atalhos de sistema (copiar/colar/recortar/selecionar tudo) nunca podem
  // fechar o modal — só clique fora ou Esc fecham.
  const onKeyDownGuard = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && ["c", "v", "x", "a"].includes(e.key.toLowerCase())) { e.stopPropagation(); return; }
    if (e.key === "Escape") onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onCancel} onKeyDown={onKeyDownGuard}>
      <div className="glass-card max-w-sm w-full p-5 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2">
          {destructive && <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />}
          <h3 className="font-semibold text-sm">{title}</h3>
        </div>
        {description && <p className="text-xs text-muted-foreground mb-2">{description}</p>}
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button
            className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "btn-glow"}
            onClick={confirm}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
