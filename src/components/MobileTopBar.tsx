import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu, Zap } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Upload, Send, Settings, Users, Tag, Inbox, Briefcase } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useState, useEffect } from "react";

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

export function MobileTopBar() {
  const { pathname } = useLocation();
  const conversations = useAppStore((s) => s.conversations);
  const pendentes = conversations.filter((c) => c.status === "pendente").length;
  const [open, setOpen] = useState(false);

  // Fecha o menu ao trocar de rota
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-2 px-4 py-3 bg-sidebar/85 backdrop-blur-xl border-b border-border/30">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
          <Zap className="w-4 h-4 text-primary-foreground" />
        </div>
        <div className="text-sm font-semibold tracking-tight">Ultra Nucleos</div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            aria-label="Abrir menu"
            className="w-10 h-10 rounded-lg bg-card/60 border border-border/40 flex items-center justify-center active:scale-95 transition-transform"
          >
            <Menu className="w-5 h-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0 bg-sidebar/95 backdrop-blur-xl border-r border-border/30">
          <div className="px-5 py-5 flex items-center gap-3 border-b border-border/30">
            <div className="w-10 h-10 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
              <Zap className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="text-sm font-semibold tracking-tight">Ultra Nucleos</div>
          </div>
          <nav className="px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
            {items.map((it) => {
              const active = pathname === it.to;
              const Icon = it.icon;
              const showBadge = it.badge === "pend" && pendentes > 0;
              return (
                <NavLink
                  key={it.to}
                  to={it.to}
                  className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                    ${active ? "bg-primary/15 text-foreground" : "text-sidebar-foreground hover:bg-primary/10"}`}
                  style={active ? { boxShadow: "inset 3px 0 0 hsl(var(--primary))" } : undefined}
                >
                  <Icon className={`w-4 h-4 ${active ? "text-primary" : ""}`} />
                  <span>{it.label}</span>
                  {showBadge && (
                    <span className="ml-auto text-[10px] bg-warning text-warning-foreground rounded-full px-1.5 py-0.5 font-semibold animate-pulse">
                      {pendentes}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}
