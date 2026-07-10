import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Zap, Lock, Mail, LogIn, ShieldCheck, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/store/authStore";
import { SUPABASE_CONFIGURED } from "@/lib/supabase";
import { authClient } from "@/lib/authClient";

/**
 * Porta de entrada do sistema — precisa parecer Áurea desde o primeiro
 * segundo: navy #070C1F, gradiente de marca, Inter, cards 16px (mesmos
 * tokens do resto do CRM, ver src/index.css).
 */
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const signIn = useAuthStore((s) => s.signIn);
  const verifyMfa = useAuthStore((s) => s.verifyMfa);
  const cancelMfa = useAuthStore((s) => s.cancelMfa);
  const loading = useAuthStore((s) => s.loading);
  const mfaPending = useAuthStore((s) => s.mfaPending);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);

  const from = (location.state as { from?: string })?.from || "/";

  const handleForgotSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setForgotBusy(true);
    try {
      await authClient.forgotPassword(forgotEmail.trim());
    } finally {
      setForgotBusy(false);
      setForgotSent(true); // resposta sempre genérica — nunca revela se o e-mail existe
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = await signIn(email.trim(), password);
    if (result.ok) navigate(from, { replace: true });
    else if (!result.mfaRequired) setError(result.error || "Não foi possível entrar.");
  };

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = await verifyMfa(code.trim());
    if (result.ok) navigate(from, { replace: true });
    else setError(result.error || "Código inválido.");
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
          <p className="text-sm text-muted-foreground mt-1">Áurea Investing · CRM interno</p>
        </div>

        {mfaPending ? (
          <form onSubmit={handleVerify} className="glass-card glass-card-accent p-7 space-y-5 animate-scale-in">
            <div className="flex flex-col items-center text-center gap-2 mb-1">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-sm font-semibold">Verificação em duas etapas</h2>
              <p className="text-xs text-muted-foreground">Digite o código do seu aplicativo autenticador.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="mfa-code">Código de 6 dígitos</label>
              <Input
                id="mfa-code"
                inputMode="numeric"
                autoFocus
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="text-center tracking-[0.5em] font-mono text-lg"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs px-3 py-2.5">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full btn-glow" disabled={loading || code.length !== 6}>
              {loading ? "Verificando…" : "Confirmar"}
            </Button>
            <button
              type="button"
              onClick={() => { cancelMfa(); setCode(""); setError(null); }}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Voltar ao login
            </button>
          </form>
        ) : forgotMode ? (
          <div className="glass-card glass-card-accent p-7 space-y-5 animate-scale-in">
            <div className="flex flex-col items-center text-center gap-2 mb-1">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-sm font-semibold">Esqueci minha senha</h2>
              <p className="text-xs text-muted-foreground">Enviaremos um link de redefinição para o seu e-mail, se ele existir no sistema.</p>
            </div>

            {forgotSent ? (
              <p className="text-xs text-center text-muted-foreground">
                Se o e-mail informado existir, um link de redefinição foi enviado. Confira sua caixa de entrada.
              </p>
            ) : (
              <form onSubmit={handleForgotSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="forgot-email">E-mail</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="forgot-email"
                      type="email"
                      required
                      autoFocus
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="voce@aureainvesting.com"
                      className="pl-9"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full btn-glow" disabled={forgotBusy}>
                  {forgotBusy ? "Enviando…" : "Enviar link de redefinição"}
                </Button>
              </form>
            )}

            <button
              type="button"
              onClick={() => { setForgotMode(false); setForgotSent(false); setForgotEmail(""); }}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Voltar ao login
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="glass-card glass-card-accent p-7 space-y-5 animate-scale-in">
            {!SUPABASE_CONFIGURED && (
              <div className="rounded-lg border border-warning/30 bg-warning/10 text-warning text-xs px-3 py-2.5">
                Login ainda não configurado neste ambiente. Peça para o administrador configurar
                <code className="mx-1 px-1 rounded bg-warning/15">DATABASE_URL</code> no servidor.
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="login-email">E-mail</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@aureainvesting.com"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="login-password">Senha</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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

            <Button type="submit" className="w-full btn-glow" disabled={loading || !SUPABASE_CONFIGURED}>
              <LogIn className="w-4 h-4 mr-2" />
              {loading ? "Entrando…" : "Entrar"}
            </Button>
            <button
              type="button"
              onClick={() => { setForgotMode(true); setError(null); }}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Esqueci minha senha
            </button>
          </form>
        )}

        <p className="text-center text-[11px] text-muted-foreground mt-6">
          Documento Interno · Confidencial · Áurea Investing
        </p>
      </div>
    </div>
  );
}
