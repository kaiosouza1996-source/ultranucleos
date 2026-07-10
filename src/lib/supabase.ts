/**
 * Nome do arquivo mantido por compatibilidade — os únicos consumidores
 * (AppSidebar.tsx, ProtectedRoute.tsx) só precisam do flag e dos tipos, nunca
 * de um client de verdade. Login/Auth/Comunicação Interna agora rodam
 * inteiramente no whatsapp-engine (ver src/lib/authClient.ts, src/lib/comms.ts),
 * sem nenhum serviço terceiro.
 */
export type { UserRole, Profile } from "@/lib/authClient";

/** Sempre true agora — a autenticação é parte do próprio backend, não um
 * serviço externo que possa estar "não configurado" do ponto de vista do
 * frontend. Se o engine não tiver DATABASE_URL configurada, /auth/* responde
 * 503 e o erro aparece normalmente na tela de login. */
export const SUPABASE_CONFIGURED = true;
