import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GradientDivider } from "@/components/GradientDivider";
import { api } from "@/lib/engine";
import type { AtuaMercadoFinanceiro, CadenceStage, Contact } from "@/store/appStore";
import { toast } from "sonner";

const ATUA_MERCADO_OPTIONS: { value: AtuaMercadoFinanceiro | ""; label: string }[] = [
  { value: "", label: "Não perguntado ainda" },
  { value: "SIM", label: "Sim" },
  { value: "NAO", label: "Não" },
  { value: "NUMERO_MUDOU_TITULAR", label: "Número mudou de titular" },
  { value: "CONCORRENCIA", label: "Foi para outra corretora" },
  { value: "A_CONFIRMAR", label: "A confirmar / pendente de triagem" },
];

const STAGE_LABELS: Record<CadenceStage, string> = {
  NONE: "Sem cadência ativa",
  D1: "D1 — primeiro contato",
  D3: "D3 — toque leve",
  D7: "D7 — conteúdo de valor",
  D15: "D15 — último toque do 1º ciclo",
  D75: "D75 — reativação",
  ENCERRADO_SEM_RESPOSTA: "Ciclo encerrado — sem resposta",
};

export interface CadenceFieldsValue {
  isClient: boolean;
  atuaMercadoFinanceiro: AtuaMercadoFinanceiro | "";
  responsavelId: string;
}

export function ContactCadenceFields({
  contact,
  value,
  onChange,
  onTouchDone,
}: {
  contact: Contact | null;
  value: CadenceFieldsValue;
  onChange: (patch: Partial<CadenceFieldsValue>) => void;
  onTouchDone?: () => void;
}) {
  const [profiles, setProfiles] = useState<{ id: string; fullName: string; role: string }[]>([]);
  const [confirmD75, setConfirmD75] = useState(false);
  const [touching, setTouching] = useState(false);

  useEffect(() => {
    api.loadProfiles().then(setProfiles).catch(() => setProfiles([]));
  }, []);

  const stage = contact?.cadenceStage ?? "NONE";
  const canTouch = !!contact && !value.isClient && stage !== "NONE" && stage !== "ENCERRADO_SEM_RESPOSTA";

  const doTouch = async (gotResponse?: boolean) => {
    if (!contact) return;
    setTouching(true);
    try {
      await api.markCadenceTouch(contact.id, gotResponse);
      toast.success("Toque registrado.");
      setConfirmD75(false);
      onTouchDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao registrar toque");
    } finally {
      setTouching(false);
    }
  };

  return (
    <div className="col-span-2 space-y-3 mt-1">
      <GradientDivider />
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Assessoria &amp; cadência</div>

      <div>
        <label className="text-xs uppercase tracking-wider text-muted-foreground">Este contato já está na Assessoria?</label>
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={() => onChange({ isClient: true })}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${value.isClient ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
          >Sim, é cliente</button>
          <button
            type="button"
            onClick={() => onChange({ isClient: false })}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${!value.isClient ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
          >Não, é lead frio</button>
        </div>
      </div>

      {!value.isClient && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Atua no mercado financeiro?</label>
            <select
              value={value.atuaMercadoFinanceiro}
              onChange={(e) => onChange({ atuaMercadoFinanceiro: e.target.value as AtuaMercadoFinanceiro | "" })}
              className="w-full bg-input rounded px-3 py-2 text-sm border border-border mt-1"
            >
              {ATUA_MERCADO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Responsável</label>
            <select
              value={value.responsavelId}
              onChange={(e) => onChange({ responsavelId: e.target.value })}
              className="w-full bg-input rounded px-3 py-2 text-sm border border-border mt-1"
            >
              <option value="">— Sem responsável —</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          </div>
        </div>
      )}

      {contact && !value.isClient && (
        <div className="rounded-lg bg-muted/20 border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">{STAGE_LABELS[stage]}</div>
              {contact.cadenceDueAt && (
                <div className="text-[11px] text-muted-foreground">
                  Vencimento: {new Date(contact.cadenceDueAt).toLocaleDateString("pt-BR")}
                  {contact.cadenceOverdue && <span className="text-destructive font-medium"> — atrasado</span>}
                </div>
              )}
              {contact.cadencePaused && (
                <div className="text-[11px] text-primary">Lead respondeu — aguardando atendimento humano</div>
              )}
            </div>
            {canTouch && !confirmD75 && (
              <Button
                size="sm"
                className="btn-glow shrink-0"
                disabled={touching}
                onClick={() => (stage === "D75" ? setConfirmD75(true) : doTouch())}
              >
                Marcar toque de {stage} como realizado
              </Button>
            )}
          </div>

          {confirmD75 && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="text-xs mb-2">O lead respondeu?</div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" disabled={touching} onClick={() => doTouch(true)}>Sim, respondeu</Button>
                <Button size="sm" variant="ghost" disabled={touching} onClick={() => doTouch(false)}>Não respondeu — encerrar</Button>
                <Button size="sm" variant="ghost" disabled={touching} onClick={() => setConfirmD75(false)}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
