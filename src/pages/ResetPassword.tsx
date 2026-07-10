import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Zap, Lock, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/authClient";

/**
 * Consome o link de "esqueci minha senha" (token de uso único, expira em
 * pouco tempo — ver whatsapp-engine/auth.js). Mesma identidade visual do
 * Login.tsx.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("A senha precisa ter pelo menos 8 caracteres."); return; }
    if (password !== confirm) { setError("As senhas não coincidem."); return; }
    setLoading(true);
    try {
      await authClient.resetPassword(token, password);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível redefinir a senha.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 relative">
      <div aria-hidden className="fixed top-0 inset-x-0 h-[3px] bg-gradient-brand pointer-events-none" />
      <div aria-hidden className="fixed bottom-0 inset-x-0 h-[3px] bg-gradient-brand pointer-events-none" />

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 animate-fade-in">
          <div className="w-14 h-14 rounded-2xl bg-gradient-primary flex items-center justify-center shadow-glow mb-4">
            <Zap className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Ultra <span className="text-gradient-brand">Nucleos</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Redefinir senha</p>
        </div>

        {!token ? (
          <div className="glass-card glass-card-accent p-7 space-y-4 animate-scale-in text-center">
            <p className="text-sm text-muted-foreground">Link inválido — faltando token de redefinição.</p>
            <Link to="/login" className="text-xs text-primary hover:underline">Voltar ao login</Link>
          </div>
        ) : done ? (
          <div className="glass-card glass-card-accent p-7 space-y-4 animate-scale-in text-center">
            <div className="w-10 h-10 rounded-xl bg-success/15 flex items-center justify-center mx-auto">
              <KeyRound className="w-5 h-5 text-success" />
            </div>
            <p className="text-sm">Senha redefinida com sucesso.</p>
            <Button className="w-full btn-glow" onClick={() => navigate("/login", { replace: true })}>Ir para o login</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="glass-card glass-card-accent p-7 space-y-5 animate-scale-in">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="new-password">Nova senha</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="new-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="confirm-password">Confirmar senha</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="confirm-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs px-3 py-2.5">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full btn-glow" disabled={loading}>
              {loading ? "Salvando…" : "Redefinir senha"}
            </Button>
          </form>
        )}

        <p className="text-center text-[11px] text-muted-foreground mt-6">
          Documento Interno · Confidencial · Áurea Investing
        </p>
      </div>
    </div>
  );
}
