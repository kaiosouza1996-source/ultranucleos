import { create } from "zustand";
import { authClient, type Profile, type UserRole } from "@/lib/authClient";

/** Marcador leve de sessão — o token de verdade é um cookie httpOnly, nunca
 * lido pelo JS por design. Só usado por ProtectedRoute.tsx para checar
 * truthiness (`!session || !profile`), então não precisa carregar mais nada. */
export interface AuthSession {
  createdAt: string;
}

interface AuthState {
  initialized: boolean; // já checou a sessão inicial (evita "piscar" a tela de login)
  session: AuthSession | null;
  profile: Profile | null;
  error: string | null;
  loading: boolean; // login em andamento

  // MFA (TOTP) — ver Configurações → Segurança. Enquanto mfaPending=true o
  // login NÃO está completo (profile fica null de propósito, então
  // ProtectedRoute continua mandando pro /login, que mostra o desafio).
  mfaPending: boolean;

  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string; mfaRequired?: boolean }>;
  verifyMfa: (code: string) => Promise<{ ok: boolean; error?: string }>;
  cancelMfa: () => Promise<void>;
  signOut: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
}

function nowSession(): AuthSession {
  return { createdAt: new Date().toISOString() };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  initialized: false,
  session: null,
  profile: null,
  error: null,
  loading: false,
  mfaPending: false,

  signIn: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const result = await authClient.login(email, password);
      if (result.mfaRequired) {
        set({ loading: false, error: null, session: nowSession(), profile: null, mfaPending: true });
        return { ok: false, mfaRequired: true };
      }
      set({ loading: false, error: null, session: nowSession(), profile: result.profile ?? null });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao entrar.";
      set({ loading: false, error: msg });
      return { ok: false, error: msg };
    }
  },

  verifyMfa: async (code) => {
    set({ loading: true, error: null });
    try {
      const { profile } = await authClient.verifyMfa(code);
      set({ loading: false, error: null, mfaPending: false, profile, session: nowSession() });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Código inválido ou expirado.";
      set({ loading: false, error: msg });
      return { ok: false, error: msg };
    }
  },

  cancelMfa: async () => {
    await authClient.logout().catch(() => { /* melhor esforço — cookie já pode ter expirado */ });
    set({ session: null, profile: null, mfaPending: false, error: null });
  },

  signOut: async () => {
    await authClient.logout().catch(() => { /* melhor esforço */ });
    set({ session: null, profile: null, mfaPending: false });
  },

  hasRole: (...roles) => {
    const { profile } = get();
    return !!profile && roles.includes(profile.role);
  },
}));

/** Chamar uma vez na raiz do app — sincroniza com a sessão persistida (cookie httpOnly). */
export function bootstrapAuth() {
  authClient
    .getSession()
    .then((profile) => {
      if (profile) {
        useAuthStore.setState({ session: nowSession(), profile, initialized: true });
      } else {
        useAuthStore.setState({ initialized: true });
      }
    })
    .catch(() => {
      useAuthStore.setState({ initialized: true });
    });
}
