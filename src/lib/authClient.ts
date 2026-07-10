/**
 * Cliente de autenticação própria — substitui `supabase.auth.*`. Fala com
 * /auth/* no whatsapp-engine (auth.js). Sessão via cookie httpOnly, nunca
 * lida diretamente por este arquivo (o navegador anexa automaticamente com
 * credentials:"include", ver apiFetch.ts).
 */
import { apiFetch } from "@/lib/apiFetch";

export type UserRole = "socio" | "comercial" | "operacional";

export interface Profile {
  id: string;
  fullName: string;
  role: UserRole;
}

export const authClient = {
  async login(email: string, password: string): Promise<{ mfaRequired: boolean; profile?: Profile }> {
    return apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  },
  async verifyMfa(code: string): Promise<{ profile: Profile }> {
    return apiFetch("/auth/mfa/challenge-verify", { method: "POST", body: JSON.stringify({ code }) });
  },
  async logout(): Promise<void> {
    await apiFetch("/auth/logout", { method: "POST" });
  },
  async getSession(): Promise<Profile | null> {
    try {
      const { profile } = await apiFetch<{ profile: Profile }>("/auth/session");
      return profile;
    } catch {
      return null;
    }
  },
  async forgotPassword(email: string): Promise<void> {
    await apiFetch("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
  },
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await apiFetch("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) });
  },
  /** Troca de senha com o usuário já logado — exige a senha atual (fluxo de
   * "esqueci minha senha" é o /reset-password acima, sem sessão prévia). */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiFetch("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
  },
  async mfaEnroll(): Promise<{ qrCodeDataUrl: string; secret: string }> {
    return apiFetch("/auth/mfa/enroll", { method: "POST" });
  },
  async mfaEnrollConfirm(code: string): Promise<void> {
    await apiFetch("/auth/mfa/enroll/confirm", { method: "POST", body: JSON.stringify({ code }) });
  },
  async mfaUnenroll(): Promise<void> {
    await apiFetch("/auth/mfa/unenroll", { method: "POST" });
  },
  async mfaFactors(): Promise<{ verified: boolean }> {
    return apiFetch("/auth/mfa/factors");
  },
};
