import { useState } from "react";
import { createPortal } from "react-dom";
import { FileText, X } from "lucide-react";

/**
 * Renderização de mídia recebida/enviada — mesmo modelo de bolha usado em
 * Atendimento (WhatsApp) e Comunicação Interna (100% interno): imagem em
 * miniatura com lightbox em tela cheia ao clicar, vídeo/áudio com player
 * nativo, documento com o nome real do arquivo (nunca abre em aba nova —
 * fica tudo dentro do próprio chat).
 */
export function MediaAttachment({
  mimeType, url, filename, variant = "received",
}: {
  mimeType?: string | null;
  url: string;
  filename?: string | null;
  /** De qual bolha o chip herda o degradê — "sent" (nossa) ou "received"
   * (cliente/colega). Sem isso o chip cairia sempre no mesmo tom, quebrando
   * o contraste equivalente exigido nas duas variantes. */
  variant?: "sent" | "received";
}) {
  const [lightbox, setLightbox] = useState(false);
  const mime = mimeType || "";
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");

  if (isImage) {
    return (
      <>
        <img
          src={url} alt="" loading="lazy"
          onClick={() => setLightbox(true)}
          className="rounded-lg max-w-[260px] max-h-[260px] w-auto h-auto object-cover mb-1 cursor-zoom-in"
        />
        {lightbox && createPortal(
          <div
            className="fixed inset-0 z-[200] bg-background/90 backdrop-blur flex items-center justify-center p-6 animate-fade-in"
            onClick={() => setLightbox(false)}
          >
            {/* Renderizado via portal em document.body — bolhas de mensagem
                (Bubble/MessageBubble) usam animate-fade-in, cujo transform
                (mesmo translateY(0) parado no fill-mode "both" ao final da
                animação) cria um containing block para descendentes
                position:fixed, prendendo o lightbox dentro do tamanho da
                própria bolha em vez da tela cheia. O portal escapa desse
                ancestral por completo, igual ao NotificationBell. */}
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

  if (isVideo) {
    return <video src={url} controls className="rounded-lg max-w-[280px] max-h-[280px] mb-1" />;
  }

  if (isAudio) {
    return <audio src={url} controls className="mb-1 max-w-full" />;
  }

  // Nomes de classe sempre escritos por extenso (nunca `attachment-chip-${variant}`)
  // — o scanner de conteúdo do Tailwind procura substrings literais no
  // código-fonte; uma classe montada por concatenação em runtime nunca
  // aparece como string completa no arquivo, então o Tailwind a descarta do
  // CSS final por achar que não é usada (bug real encontrado em produção:
  // o degradê do chip simplesmente não existia no CSS compilado).
  const variantClass = variant === "sent" ? "attachment-chip-sent" : "attachment-chip-received";
  return (
    <a
      href={url} target="_blank" rel="noreferrer" download={filename || undefined}
      className={`attachment-chip ${variantClass} flex items-center gap-2 px-2 py-1.5 rounded-[10px] text-xs hover:underline max-w-[240px]`}
    >
      <FileText className="w-4 h-4 shrink-0" /> <span className="truncate">{filename || "Abrir documento"}</span>
    </a>
  );
}
