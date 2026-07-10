import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Upload, Send, Settings, Users, Zap, Tag, Inbox, Briefcase, BookOpen, LogOut, MessageSquare, Clock, CalendarDays, StickyNote } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useAuthStore } from "@/store/authStore";
import { SUPABASE_CONFIGURED } from "@/lib/supabase";
import { agendaApi, subscribeAgendaEvents } from "@/lib/notifications";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/atendimento", label: "Atendimento", icon: Inbox, badge: "pend" as const },
  { to: "/crm", label: "CRM", icon: Briefcase },
  { to: "/cadencia", label: "Cadência Follow Up", icon: Clock },
  { to: "/agenda", label: "Agenda", icon: CalendarDays, badge: "agenda" as const },
  { to: "/contatos", label: "Contatos", icon: Users },
  { to: "/tags", label: "Tags", icon: Tag },
  { to: "/importar", label: "Importar", icon: Upload },
  { to: "/disparos", label: "Disparos", icon: Send },
  { to: "/comunicacao", label: "Comunicação Interna", icon: MessageSquare },
  { to: "/manual", label: "Manual Operacional", icon: BookOpen },
  { to: "/anotacoes", label: "Anotações", icon: StickyNote },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

const roleLabel: Record<string, string> = { socio: "Sócio", comercial: "Comercial", operacional: "Operacional" };

function useTodayAgendaCount() {
  const [count, setCount] = useState(0);

  const reload = () => {
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    Promise.all([
      agendaApi.listEvents({ scope: "pessoal", from: start.toISOString(), to: end.toISOString() }),
      agendaApi.listEvents({ scope: "corporativo", from: start.toISOString(), to: end.toISOString() }),
    ])
      .then(([pessoal, corporativo]) => setCount(pessoal.length + corporativo.length))
      .catch(() => setCount(0));
  };

  useEffect(() => {
    reload();
    // Evento corporativo criado por qualquer um atualiza a bolinha na hora,
    // sem precisar recarregar a página — mesmo WS da Comunicação Interna.
    return subscribeAgendaEvents(() => reload());
  }, []);

  return count;
}

export function AppSidebar() {
  const { pathname } = useLocation();
  const conversations = useAppStore((s) => s.conversations);
  // Badge do item "Atendimento" — não é a fila de pendentes (que é uma aba
  // separada dentro da própria página de Atendimento), e sim quantas
  // conversas já assumidas (status="atendendo") ainda não foram abertas ou
  // foram marcadas manualmente como não lida (mesmo critério da aba "Não
  // lidas" dentro de Atendimento.tsx).
  const pendentes = conversations.filter((c) => c.status === "atendendo" && c.unread > 0).length;
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const agendaToday = useTodayAgendaCount();

  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col h-screen sticky top-0 bg-sidebar/60 backdrop-blur-xl z-10 relative">
      {/* Linha degradê suave separando o menu do painel */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 h-full w-px transition-opacity duration-700"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, hsl(var(--primary) / 0.05) 12%, hsl(var(--primary) / 0.45) 50%, hsl(var(--primary) / 0.05) 88%, transparent 100%)",
        }}
      />
      <div className="px-6 py-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
          <Zap className="w-5 h-5 text-primary-foreground" />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-tight text-foreground">Ultra Nucleos</div>
        </div>
      </div>

      <nav className="flex-1 min-h-0 px-3 space-y-0.5 overflow-y-auto scrollbar-thin">
        {items.map((it) => {
          const active = pathname === it.to;
          const Icon = it.icon;
          const badgeCount = it.badge === "pend" ? pendentes : it.badge === "agenda" ? agendaToday : 0;
          const showBadge = badgeCount > 0;
          return (
            <NavLink
              key={it.to}
              to={it.to}
              className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all
                ${active
                  ? "bg-primary/15 text-foreground"
                  : "text-sidebar-foreground hover:bg-primary/8 hover:text-foreground hover:translate-x-0.5"
                }`}
              style={active ? { boxShadow: "inset 3px 0 0 hsl(var(--primary)), 0 0 24px -8px hsl(var(--primary) / 0.4)" } : undefined}
            >
              <Icon className={`w-4 h-4 transition-transform group-hover:scale-110 ${active ? "text-primary" : ""}`} />
              <span>{it.label}</span>
              {showBadge && (
                <span className="badge-pending ml-auto text-[10px] rounded-full px-1.5 py-0.5 font-semibold animate-pulse">
                  {badgeCount}
                </span>
              )}
              {active && !showBadge && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-glow animate-pulse-glow" />}
            </NavLink>
          );
        })}
      </nav>

      {SUPABASE_CONFIGURED && profile && (
        <div className="px-3 pt-0 pb-4 mt-auto relative">
          {/* Mesma linha degradê (fade nas pontas + brilho no meio) da divisória vertical do menu, só que na horizontal */}
          <div
            aria-hidden
            className="h-px w-full mb-4"
            style={{
              background:
                "linear-gradient(to right, transparent 0%, hsl(var(--primary) / 0.05) 12%, hsl(var(--primary) / 0.45) 50%, hsl(var(--primary) / 0.05) 88%, transparent 100%)",
            }}
          />
          <div className="flex items-center gap-2.5 px-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-brandblue/15 flex items-center justify-center text-xs font-bold text-brandblue-2 shrink-0">
              {profile.fullName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate">{profile.fullName}</div>
              <div className="text-[10px] text-muted-foreground">{roleLabel[profile.role] ?? profile.role}</div>
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      )}
    </aside>
  );
}
