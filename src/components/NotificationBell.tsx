import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Bell, MessageSquare, CalendarClock, Check } from "lucide-react";
import { useNotificationsStore } from "@/store/notificationsStore";
import type { AppNotification } from "@/lib/notifications";

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const items = useNotificationsStore((s) => s.items);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const navigate = useNavigate();

  const mensagens = items.filter((n) => n.tipo === "MENSAGEM_INTERNA");
  const agenda = items.filter((n) => n.tipo !== "MENSAGEM_INTERNA");

  const openItem = (n: AppNotification) => {
    if (!n.lida) markRead(n.id);
    setOpen(false);
    if (n.tipo === "MENSAGEM_INTERNA") navigate("/comunicacao");
    else navigate("/agenda");
  };

  const toggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    setOpen((v) => !v);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={toggle}
        className="glass-card w-9 h-9 flex items-center justify-center relative hover:bg-primary/10 transition-colors"
        title="Notificações"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="badge-pending absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && createPortal(
        <>
          {/* Renderizado via portal direto em <body> — o painel ficava
              preso ao stacking context de <main> (AppLayout.tsx tem
              `relative z-[1]` no conteúdo), então mesmo com z-20 local ele
              aparecia atrás de cards do dashboard/outras páginas que
              formam seu próprio stacking context (transform/animação). Um
              portal escapa disso de vez, sem precisar caçar z-index em
              cada página. */}
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[101] w-80 rounded-xl border border-border bg-card/95 backdrop-blur shadow-elegant overflow-hidden animate-scale-in"
            style={{ top: coords.top, right: coords.right }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notificações</span>
              {unreadCount > 0 && (
                <button onClick={() => markAllRead()} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                  <Check className="w-3 h-3" /> Marcar todas como lidas
                </button>
              )}
            </div>

            <div className="max-h-[70vh] overflow-y-auto scrollbar-thin">
              <NotifSection title="Agenda" icon={CalendarClock} items={agenda} onOpen={openItem} />
              <NotifSection title="Mensagens" icon={MessageSquare} items={mensagens} onOpen={openItem} />
              {items.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">Nenhuma notificação por aqui.</div>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function NotifSection({
  title, icon: Icon, items, onOpen,
}: {
  title: string;
  icon: React.ElementType;
  items: AppNotification[];
  onOpen: (n: AppNotification) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="px-3 pt-2.5 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Icon className="w-3 h-3" /> {title}
      </div>
      {items.map((n) => (
        <button
          key={n.id}
          onClick={() => onOpen(n)}
          className={`w-full flex items-start gap-2 text-left px-3 py-2 text-sm hover:bg-primary/10 transition-colors ${!n.lida ? "bg-primary/5" : ""}`}
        >
          {!n.lida && <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className={`truncate ${n.lida ? "text-muted-foreground" : "text-foreground"}`}>{n.preview || "—"}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.criadoEm)}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
