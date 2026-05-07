import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface RecordedAudio {
  dataUrl: string;
  filename: string;
  mimetype: string;
}

export function AudioRecorder({ onRecorded }: { onRecorded: (audio: RecordedAudio) => void }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => stop(true), []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        const dataUrl = await blobToDataUrl(blob);
        onRecorded({ dataUrl, filename: `gravacao-${Date.now()}.webm`, mimetype: mime });
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (err) {
      toast.error("Não foi possível acessar o microfone.");
      console.error(err);
    }
  };

  const stop = (silent = false) => {
    try { recRef.current?.stop(); } catch { /* noop */ }
    recRef.current = null;
    setRecording(false);
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (!silent && elapsed === 0) toast("Gravação muito curta.");
  };

  return recording ? (
    <Button type="button" variant="destructive" size="sm" onClick={() => stop()} className="gap-2">
      <Square className="w-3.5 h-3.5" /> Parar ({elapsed}s)
    </Button>
  ) : (
    <Button type="button" variant="outline" size="sm" onClick={start} className="gap-2">
      <Mic className="w-3.5 h-3.5" /> Gravar áudio
    </Button>
  );
}

export function MediaPreview({
  media, onRemove,
}: { media: { kind: "image" | "audio"; dataUrl: string; filename: string }; onRemove: () => void }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  return (
    <div className="mt-2 flex items-center gap-2 p-2 rounded-md border border-border/40 bg-muted/20">
      {media.kind === "image" ? (
        <img src={media.dataUrl} alt={media.filename} className="w-14 h-14 object-cover rounded" />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10"
          onClick={() => {
            if (!audioRef.current) audioRef.current = new Audio(media.dataUrl);
            if (playing) { audioRef.current.pause(); setPlaying(false); }
            else { audioRef.current.play(); setPlaying(true); audioRef.current.onended = () => setPlaying(false); }
          }}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </Button>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{media.filename}</div>
        <div className="text-[10px] text-muted-foreground">{media.kind === "image" ? "Imagem anexada" : "Áudio anexado"}</div>
      </div>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onRemove}>
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
