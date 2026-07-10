/**
 * Cadência de Follow-up — classificação AUTOMÁTICA de estágio por tempo
 * decorrido, execução SEMPRE manual (o sistema nunca envia mensagem
 * sozinho). Módulo puro, sem dependência de `db`, para poder ser testado
 * isoladamente e para deixar claro que não existe nenhum cron/scheduler
 * por trás disso — cadence_stage/cadence_due_at/cadence_overdue são
 * recalculados aqui a cada leitura (GET /contacts, GET /cadencia,
 * GET /metrics), nunca mantidos "quietos" por um job em background.
 *
 * Intervalos (confirmados com o usuário):
 *   D1=dia 1, D3=dia 3, D7=dia 7, D15=dia 15 — contados a partir de
 *   cadence_started_at.
 *   D75 = 60 dias DEPOIS que o toque de D15 foi CONFIRMADO feito
 *   (cadence_d15_done_at), não 60 dias a partir do início da cadência.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const D75_SILENCE_DAYS = 60;
const STAGE_DUE_DAYS = { D1: 1, D3: 3, D7: 7, D15: 15 };
const STAGE_ORDER = ['D1', 'D3', 'D7', 'D15'];
const STAGE_TOUCH_COLUMN = {
  D1: 'cadence_touch_d1_done',
  D3: 'cadence_touch_d3_done',
  D7: 'cadence_touch_d7_done',
  D15: 'cadence_touch_d15_done',
  D75: 'cadence_touch_d75_done',
};

/**
 * @param {object} c - linha crua de `contacts` (precisa ter is_client,
 *   atua_mercado_financeiro, cadence_started_at, cadence_paused,
 *   cadence_encerrado_sem_resposta, cadence_touch_d1_done..d75_done,
 *   cadence_d15_done_at)
 * @param {number} [now] - epoch ms, injetável para testes
 * @returns {{ stage: string, dueAt: number|null, overdue: boolean }}
 */
function computeCadence(c, now = Date.now()) {
  const none = { stage: 'NONE', dueAt: null, overdue: false };
  if (!c) return none;
  if (c.is_client) return none;
  if (c.atua_mercado_financeiro && c.atua_mercado_financeiro !== 'SIM') return none;
  if (c.cadence_encerrado_sem_resposta) return { stage: 'ENCERRADO_SEM_RESPOSTA', dueAt: null, overdue: false };
  if (!c.cadence_started_at) return none;

  // D75 só entra em jogo depois que D15 foi CONFIRMADO feito.
  if (c.cadence_touch_d15_done && c.cadence_d15_done_at) {
    if (c.cadence_touch_d75_done) {
      // Já tocado; a decisão de encerrar (ENCERRADO_SEM_RESPOSTA) já foi
      // tomada (ou não) no momento do toque — ver POST /contacts/:id/cadence/touch.
      // Se chegou aqui sem cadence_encerrado_sem_resposta, é porque o
      // colaborador confirmou que houve resposta (handoff humano).
      return { stage: 'D75', dueAt: null, overdue: false };
    }
    const dueAt = c.cadence_d15_done_at + D75_SILENCE_DAYS * DAY_MS;
    return { stage: 'D75', dueAt, overdue: !c.cadence_paused && now >= dueAt };
  }

  const doneFlags = {
    D1: c.cadence_touch_d1_done,
    D3: c.cadence_touch_d3_done,
    D7: c.cadence_touch_d7_done,
    D15: c.cadence_touch_d15_done,
  };
  const currentStage = STAGE_ORDER.find((s) => !doneFlags[s]) || 'D15';
  const dueAt = c.cadence_started_at + STAGE_DUE_DAYS[currentStage] * DAY_MS;
  const overdue = !c.cadence_paused && now >= dueAt;
  return { stage: currentStage, dueAt, overdue };
}

module.exports = { computeCadence, STAGE_DUE_DAYS, STAGE_ORDER, STAGE_TOUCH_COLUMN, D75_SILENCE_DAYS, DAY_MS };
