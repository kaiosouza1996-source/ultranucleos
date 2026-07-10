import { useEffect, useRef, useState } from "react";

/**
 * Picker de emoji leve, sem dependência nova — uma lista curada (não o
 * unicode inteiro) já cobre o uso real de um atendimento comercial. Fecha ao
 * clicar fora ou pressionar Esc, como qualquer popover do resto do app.
 */
const GROUPS: { label: string; emojis: string[] }[] = [
  { label: "Frequentes", emojis: ["😀", "😂", "😊", "😍", "🙏", "👍", "👏", "🎉", "❤️", "🔥"] },
  { label: "Rostos", emojis: ["😀", "😃", "😄", "😁", "😅", "😂", "🙂", "😊", "😇", "😉", "😍", "🥰", "😘", "😜", "🤔", "😐", "😴", "😢", "😭", "😡"] },
  { label: "Gestos", emojis: ["👍", "👎", "👏", "🙌", "🙏", "💪", "🤝", "👋", "✌️", "🤞"] },
  { label: "Símbolos", emojis: ["❤️", "💙", "💚", "💛", "💜", "🔥", "✅", "❌", "⭐", "🎉", "📌", "⏰", "💰", "📈", "📉"] },
];

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const [active, setActive] = useState(0);

  return (
    <div
      ref={ref}
      className="absolute bottom-full mb-2 left-0 z-20 w-72 rounded-xl border border-border bg-card/95 backdrop-blur shadow-elegant overflow-hidden animate-scale-in"
    >
      <div className="flex gap-1 p-1.5 border-b border-border">
        {GROUPS.map((g, i) => (
          <button
            key={g.label}
            onClick={() => setActive(i)}
            className={`flex-1 text-[11px] px-2 py-1 rounded-md transition-colors ${active === i ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40"}`}
          >{g.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-1 p-2 max-h-48 overflow-y-auto scrollbar-thin">
        {GROUPS[active].emojis.map((e, i) => (
          <button
            key={`${e}-${i}`}
            onClick={() => onPick(e)}
            className="text-lg leading-none p-1.5 rounded hover:bg-primary/10 transition-colors"
          >{e}</button>
        ))}
      </div>
    </div>
  );
}
