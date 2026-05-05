import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Upload, Send, Settings, Users, Zap, Tag, Inbox, Briefcase } from "lucide-react";
import { useAppStore } from "@/store/appStore";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/atendimento", label: "Atendimento", icon: Inbox, badge: "pend" as const },
  { to: "/crm", label: "CRM", icon: Briefcase },
  { to: "/contatos", label: "Contatos", icon: Users },
  { to: "/tags", label: "Tags", icon: Tag },
  { to: "/importar", label: "Importar", icon: Upload },
  { to: "/disparos", label: "Disparos", icon: Send },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppSidebar() {
  const { pathname } = useLocation();
  const conversations = useAppStore((s) => s.conversations);
  const pendentes = conversations.filter((c) => c.status === "pendente").length;

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col h-screen sticky top-0 bg-sidebar/60 backdrop-blur-xl z-10 relative">
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

      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto scrollbar-thin">
        {items.map((it) => {
          const active = pathname === it.to;
          const Icon = it.icon;
          const showBadge = it.badge === "pend" && pendentes > 0;
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
                <span className="ml-auto text-[10px] bg-warning text-warning-foreground rounded-full px-1.5 py-0.5 font-semibold animate-pulse">
                  {pendentes}
                </span>
              )}
              {active && !showBadge && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-glow animate-pulse-glow" />}
            </NavLink>
          );
        })}
      </nav>

    </aside>
  );
}
