import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { SUPABASE_CONFIGURED, type UserRole } from "@/lib/supabase";

/**
 * Porta de entrada da aplicação inteira: sem sessão válida, redireciona pro
 * /login. Passe `roles` para também restringir por papel (ex: só Sócio).
 *
 * Enquanto o Supabase não estiver configurado (SUPABASE_CONFIGURED=false),
 * deixa passar direto — evita travar o ambiente de desenvolvimento antes das
 * credenciais existirem. Em produção, configure sempre.
 */
export function ProtectedRoute({ children, roles }: { children: ReactNode; roles?: UserRole[] }) {
  const location = useLocation();
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);

  if (!SUPABASE_CONFIGURED) return <>{children}</>;
  if (!initialized) return null; // evita "flash" da tela de login antes de checar a sessão persistida

  if (!session || !profile) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && !roles.includes(profile.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <div className="glass-card p-8 max-w-sm">
          <h2 className="text-lg font-bold mb-2">Acesso restrito</h2>
          <p className="text-sm text-muted-foreground">Esta área é restrita a outro papel de usuário.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
