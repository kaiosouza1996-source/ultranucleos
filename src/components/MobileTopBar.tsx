import { useLocation } from "react-router-dom";
import { Zap } from "lucide-react";

const titles: Record<string, string> = {
  "/": "Início",
  "/atendimento": "Atendimento",
  "/crm": "CRM",
  "/contatos": "Contatos",
  "/tags": "Tags",
  "/importar": "Importar",
  "/disparos": "Disparos",
  "/configuracoes": "Configurações",
  "/conexao": "Conexão",
  "/mensagens": "Mensagens",
  "/logs": "Logs",
};

export function MobileTopBar() {
  const { pathname } = useLocation();
  const title = titles[pathname] ?? "Ultra Nucleos";

  return (
    <header
      className="lg:hidden sticky top-0 z-30 bg-background/70 backdrop-blur-2xl"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        WebkitBackdropFilter: "saturate(180%) blur(24px)",
      }}
    >
      <div className="flex items-center justify-between px-5 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
            <Zap className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <span className="text-[13px] font-medium text-muted-foreground tracking-tight">
            Ultra Nucleos
          </span>
        </div>
      </div>
      <div className="px-5 pb-3 pt-1">
        <h1 className="text-[32px] leading-[1.1] font-bold tracking-tight">
          {title}
        </h1>
      </div>
    </header>
  );
}
