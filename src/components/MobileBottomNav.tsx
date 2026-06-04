import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Inbox,
  Send,
  Briefcase,
  MoreHorizontal,
  Users,
  Tag,
  Upload,
  Settings,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useEffect, useState } from "react";

const primary = [
  { to: "/", label: "Início", icon: LayoutDashboard },
  { to: "/atendimento", label: "Chat", icon: Inbox, badge: "pend" as const },
  { to: "/disparos", label: "Disparos", icon: Send },
  { to: "/crm", label: "CRM", icon: Briefcase },
];

const more = [
  { to: "/contatos", label: "Contatos", icon: Users },
  { to: "/tags", label: "Tags", icon: Tag },
  { to: "/importar", label: "Importar", icon: Upload },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

export function MobileBottomNav() {
  const { pathname } = useLocation();
  const conversations = useAppStore((s) => s.conversations);
  const pendentes = conversations.filter((c) => c.status === "pendente").length;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const moreActive = more.some((m) => m.to === pathname);

  return (
    <nav
      aria-label="Navegação principal"
      className="md:hidden fixed bottom-0 inset-x-0 z-40"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        className="mx-3 mb-2 rounded-[28px] border border-white/10 bg-background/65 backdrop-blur-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)]"
        style={{ WebkitBackdropFilter: "saturate(180%) blur(24px)" }}
      >
        <ul className="grid grid-cols-5 px-1.5 py-1.5">
          {primary.map((it) => {
            const Icon = it.icon;
            const active = pathname === it.to;
            const showBadge = it.badge === "pend" && pendentes > 0;
            return (
              <li key={it.to} className="flex">
                <NavLink
                  to={it.to}
                  className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-2xl transition-all duration-200 active:scale-[0.92] ${
                    active
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="relative">
                    <Icon
                      className={`w-[22px] h-[22px] transition-transform duration-200 ${
                        active ? "scale-110" : ""
                      }`}
                      strokeWidth={active ? 2.4 : 2}
                    />
                    {showBadge && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground flex items-center justify-center leading-none">
                        {pendentes > 9 ? "9+" : pendentes}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] font-medium tracking-tight">
                    {it.label}
                  </span>
                </NavLink>
              </li>
            );
          })}

          <li className="flex">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button
                  className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-2xl transition-all duration-200 active:scale-[0.92] ${
                    moreActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-label="Mais opções"
                >
                  <MoreHorizontal className="w-[22px] h-[22px]" strokeWidth={moreActive ? 2.4 : 2} />
                  <span className="text-[10px] font-medium tracking-tight">Mais</span>
                </button>
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="rounded-t-[28px] border-white/10 bg-background/85 backdrop-blur-2xl p-0 pb-[env(safe-area-inset-bottom)]"
              >
                <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-white/15" />
                <div className="px-5 pt-4 pb-2">
                  <h2 className="text-xl font-semibold tracking-tight">Mais</h2>
                </div>
                <div className="px-3 pb-5">
                  <ul className="rounded-2xl bg-white/[0.04] divide-y divide-white/5 overflow-hidden">
                    {more.map((m) => {
                      const Icon = m.icon;
                      const active = pathname === m.to;
                      return (
                        <li key={m.to}>
                          <NavLink
                            to={m.to}
                            className="flex items-center gap-3 px-4 py-3.5 active:bg-white/5 transition-colors"
                          >
                            <span
                              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                                active
                                  ? "bg-primary/20 text-primary"
                                  : "bg-white/5 text-foreground"
                              }`}
                            >
                              <Icon className="w-[18px] h-[18px]" />
                            </span>
                            <span className="text-[15px] font-medium flex-1">{m.label}</span>
                            <span className="text-muted-foreground text-lg">›</span>
                          </NavLink>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </SheetContent>
            </Sheet>
          </li>
        </ul>
      </div>
    </nav>
  );
}
