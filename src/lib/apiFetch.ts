/**
 * Fetch helper compartilhado por authClient.ts e comms.ts — chama o
 * whatsapp-engine (que agora hospeda /auth/* e /comms/*, substituindo o
 * Supabase) sempre com o cookie de sessão (credentials:"include") e o
 * cabeçalho CSRF (double-submit) em mutações. Ver whatsapp-engine/authz.js.
 */
import { ENGINE_HTTP, ENGINE_API_KEY } from "@/lib/engine";

export function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Erro de API que preserva o corpo JSON da resposta (além da mensagem) —
 * necessário quando o backend manda campos extras num 4xx (ex: `requiresMode`
 * na exclusão de pasta de Anotações). Continua funcionando como um Error
 * comum (`.message`) pra todo chamador que só precisa disso. */
export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": ENGINE_API_KEY,
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCookie("csrf");
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  const res = await fetch(ENGINE_HTTP + path, { ...init, method, credentials: "include", headers });
  let payload: unknown = null;
  try { payload = await res.json(); } catch { /* sem corpo JSON */ }
  if (!res.ok) {
    const msg = (payload && typeof payload === "object" && "error" in payload && (payload as { error?: string }).error) || `HTTP ${res.status}`;
    throw new ApiError(String(msg), res.status, payload);
  }
  return payload as T;
}
