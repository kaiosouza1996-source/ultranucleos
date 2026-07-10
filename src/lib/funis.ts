/**
 * Funis de CRM customizados — compartilhados por toda a equipe (diferente do
 * "Funil do CRM" padrão, que continua por usuário via pipelineStages/
 * appStore.ts + /pipeline/stages). Vivem em Postgres (whatsapp-engine/funis.js).
 */
import { apiFetch } from "@/lib/apiFetch";

/** Sentinela usado em todo seletor "funil → etapa" (cascata) pra representar
 * o Funil do CRM padrão — que não é uma linha desta tabela (é por usuário,
 * em pipelineStages/appStore.ts), então precisa de um id que nunca colida
 * com um uuid real de funil customizado. */
export const DEFAULT_FUNIL_ID = "__default__";

export interface EtapaFunil {
  id: string;
  funilId: string;
  nome: string;
  ordem: number;
  cor: string | null;
}

export interface Funil {
  id: string;
  nome: string;
  criadoPor: string | null;
  ordem: number;
  ativo: boolean;
  createdAt: string;
  etapas: EtapaFunil[];
}

export interface ContatoFunilEtapa {
  contatoId: string;
  etapaId: string;
  atualizadoEm: string;
  atualizadoPor: string | null;
}

export const funis = {
  async list(): Promise<Funil[]> {
    return apiFetch("/funis");
  },
  async create(nome: string, etapas: { nome: string; cor?: string; ordem?: number }[]): Promise<Funil> {
    return apiFetch("/funis", { method: "POST", body: JSON.stringify({ nome, etapas }) });
  },
  async rename(id: string, nome: string): Promise<Funil> {
    return apiFetch(`/funis/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ nome }) });
  },
  async remove(id: string): Promise<void> {
    await apiFetch(`/funis/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async addEtapa(funilId: string, input: { nome: string; cor?: string; ordem?: number }): Promise<EtapaFunil> {
    return apiFetch(`/funis/${encodeURIComponent(funilId)}/etapas`, { method: "POST", body: JSON.stringify(input) });
  },
  async renameEtapa(funilId: string, etapaId: string, nome: string): Promise<EtapaFunil> {
    return apiFetch(`/funis/${encodeURIComponent(funilId)}/etapas/${encodeURIComponent(etapaId)}`, {
      method: "PATCH",
      body: JSON.stringify({ nome }),
    });
  },
  async removeEtapa(funilId: string, etapaId: string): Promise<void> {
    await apiFetch(`/funis/${encodeURIComponent(funilId)}/etapas/${encodeURIComponent(etapaId)}`, { method: "DELETE" });
  },
  async contatos(funilId: string): Promise<ContatoFunilEtapa[]> {
    return apiFetch(`/funis/${encodeURIComponent(funilId)}/contatos`);
  },
  async setContatoEtapa(funilId: string, contatoId: string, etapaId: string): Promise<void> {
    await apiFetch(`/funis/${encodeURIComponent(funilId)}/contatos/${encodeURIComponent(contatoId)}/etapa`, {
      method: "POST",
      body: JSON.stringify({ etapaId }),
    });
  },
};
