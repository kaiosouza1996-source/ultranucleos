import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Send, X } from "lucide-react";

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Prévia antes de enviar — igual ao WhatsApp: mostra a imagem/arquivo
 * selecionado com opção de legenda, confirmar ou cancelar, em vez de disparar
 * o envio na hora que o usuário escolhe o arquivo no seletor do sistema.
 * Compartilhado entre Atendimento e Comunicação Interna — mesmo modelo de
 * chat nas duas telas.
 */
export function FilePreviewDialog({
  file, asDocument = false, initialCaption, onCancel, onConfirm,
}: {
  file: File;
  asDocument?: boolean;
  initialCaption: string;
  onCancel: () => void;
  onConfirm: (caption: string) => void | Promise<void>;
}) {
  const [caption, setCaption] = useState(initialCaption);
  const [sending, setSending] = useState(false);
  const isImage = !asDocument && file.type.startsWith("image/");
  const isVideo = !asDocument && file.type.startsWith("video/");
  const previewUrl = useMemo(() => (isImage || isVideo ? URL.createObjectURL(file) : null), [file, isImage, isVideo]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const confirm = async () => {
    setSending(true);
    try { await onConfirm(caption); } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onCancel}>
      <div className="glass-card max-w-md w-full p-5 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Enviar arquivo</h3>
          <Button size="icon" variant="ghost" onClick={onCancel}><X className="w-4 h-4" /></Button>
        </div>

        <div className="rounded-lg bg-muted/20 border border-border p-3 flex items-center justify-center min-h-[160px] max-h-[320px] overflow-hidden">
          {isImage && previewUrl && <img src={previewUrl} alt="" className="max-w-full max-h-[290px] rounded-lg object-contain" />}
          {isVideo && previewUrl && <video src={previewUrl} controls className="max-w-full max-h-[290px] rounded-lg" />}
          {!isImage && !isVideo && (
            <div className="flex flex-col items-center gap-2 text-muted-foreground py-6">
              <FileText className="w-10 h-10" />
              <span className="text-sm text-foreground truncate max-w-[280px]">{file.name}</span>
              <span className="text-xs">{formatFileSize(file.size)}</span>
            </div>
          )}
        </div>

        <Input
          className="mt-3 bg-input/60"
          placeholder="Adicionar legenda…"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
        />

        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="ghost" onClick={onCancel} disabled={sending}>Cancelar</Button>
          <Button className="btn-glow" onClick={confirm} disabled={sending}>
            <Send className="w-4 h-4 mr-1.5" /> Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}
