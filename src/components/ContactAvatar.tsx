import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { api } from "@/lib/engine";

/**
 * Foto de perfil real do WhatsApp (com cache — ver api.loadAvatar), caindo
 * pras iniciais quando não há foto ou o cliente/privacidade bloqueia.
 * `clickable` abre um lightbox em tela cheia (Esc ou clique fora fecha) —
 * usado no cabeçalho da conversa, não nas linhas da lista.
 */
export function ContactAvatar({
  telefone, nome, size = "w-9 h-9", textSize = "text-xs", clickable = false,
}: {
  telefone: string;
  nome: string;
  size?: string;
  textSize?: string;
  clickable?: boolean;
}) {
  const tel = telefone.replace(/\D+/g, "");
  const path = useAppStore((s) => s.avatars[tel]);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    if (tel) api.loadAvatar(tel).catch(() => {});
  }, [tel]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const initials = (nome || telefone).slice(0, 2).toUpperCase();
  const url = path ? api.mediaUrl(path) : null;
  const isClickable = clickable && !!url;

  return (
    <>
      <div
        className={`${size} rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground ${textSize} font-semibold shrink-0 overflow-hidden ${isClickable ? "cursor-zoom-in" : ""}`}
        onClick={isClickable ? () => setLightbox(true) : undefined}
      >
        {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : initials}
      </div>

      {lightbox && url && createPortal(
        <div
          className="fixed inset-0 z-[200] bg-background/90 backdrop-blur flex items-center justify-center p-6 animate-fade-in"
          onClick={() => setLightbox(false)}
        >
          <div className="w-[90vw] h-[90vh] flex items-center justify-center">
            <img src={url} alt="" className="w-full h-full rounded-lg object-contain" />
          </div>
          <button
            onClick={() => setLightbox(false)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-card/80 flex items-center justify-center hover:bg-card"
          >
            <X className="w-4 h-4" />
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
