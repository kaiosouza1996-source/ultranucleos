import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/engine";
import type { Contact, CadenceStage } from "@/store/appStore";
import { formatPhoneDisplay } from "@/lib/phone";
import { toast } from "sonner";
import { Clock, AlarmClock, Layers, Ban, Trophy, Loader2 } from "lucide-react";

type SubTab = "hoje" | "atrasados" | "estagio" | "encerrados" | "convertidos";
const SUB_TABS: { key: SubTab; label: string; icon: React.ElementType }[] = [
  { key: "hoje", label: "Hoje", icon: Clock },
  { key: "atrasados", label: "Atrasados", icon: AlarmClock },
  { key: "estagio", label: "Por estágio", icon: Layers },
  { key: "encerrados", label: "Encerrados", icon: Ban },
  { key: "convertidos", label: "Convertidos", icon: Trophy },
];
const STAGES: Exclude<CadenceStage, "NONE" | "ENCERRADO_SEM_RESPOSTA">[] = ["D1", "D3", "D7", "D15", "D75"];

export default function Cadencia() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const initialEstagio = searchParams.get("estagio");

  const [tab, setTabState] = useState<SubTab>(() => {
    if (initialTab && SUB_TABS.some((t) => t.key === initialTab)) return initialTab as SubTab;
    if (initialEstagio) return "estagio";
    return "hoje";
  });
  const [estagio, setEstagioState] = useState<string>(
    initialEstagio && STAGES.includes(initialEstagio as typeof STAGES[number]) ? initialEstagio : "D1",
  );
  const [rows, setRows] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; fullName: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmD75For, setConfirmD75For] = useState<string | null>(null);
  const [touchingId, setTouchingId] = useState<string | null>(null);

  const setTab = (t: SubTab) => {
    setTabState(t);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", t);
      if (t === "estagio") next.set("estagio", estagio); else next.delete("estagio");
      return next;
    }, { replace: true });
  };
  const setEstagio = (e: string) => {
    setEstagioState(e);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", "estagio");
      next.set("estagio", e);
      return next;
    }, { replace: true });
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = tab === "convertidos"
        ? await api.loadCadenciaConvertidos()
        : await api.loadCadencia(tab, tab === "estagio" ? estagio : undefined);
      setRows(data);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [tab, estagio]);
  useEffect(() => { api.loadProfiles().then(setProfiles).catch(() => setProfiles([])); }, []);

  const profileName = (id: string | null | undefined) => {
    if (!id) return "—";
    return profiles.find((p) => p.id === id)?.fullName ?? "—";
  };

  const doTouch = async (contact: Contact, gotResponse?: boolean) => {
    setTouchingId(contact.id);
    try {
      await api.markCadenceTouch(contact.id, gotResponse);
      toast.success("Toque registrado.");
      setConfirmD75For(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao registrar toque");
    } finally {
      setTouchingId(null);
    }
  };

  const showAction = tab !== "encerrados" && tab !== "convertidos";
  const sorted = useMemo(() => rows, [rows]);

  return (
    <>
      <AppHeader title="Cadência de Follow-up" subtitle="Classificação automática por tempo — execução sempre manual, nenhuma mensagem é enviada pelo sistema" />

      <div className="glass-card p-3 mb-4 flex flex-wrap items-center gap-2">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all
                ${tab === t.key ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
        {tab === "estagio" && (
          <div className="flex gap-1.5 ml-2 border-l border-border pl-3">
            {STAGES.map((s) => (
              <button
                key={s}
                onClick={() => setEstagio(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all
                  ${estagio === s ? "bg-primary/80 text-primary-foreground" : "bg-muted/30 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
              >{s}</button>
            ))}
          </div>
        )}
      </div>

      <div className="glass-card p-5 animate-fade-in">
        {loading ? (
          <div className="py-16 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">Nenhum contato nesta visão.</div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left py-2 px-2">Contato</th>
                  <th className="text-left py-2 px-2">Estágio</th>
                  <th className="text-left py-2 px-2">Responsável</th>
                  <th className="text-left py-2 px-2">Vencimento</th>
                  {showAction && <th></th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <tr key={c.id} className={`border-t border-border hover:bg-primary/5 transition-colors ${c.cadenceOverdue ? "bg-destructive/5" : ""}`}>
                    <td className="py-2.5 px-2">
                      <div className="font-medium">{c.nome}</div>
                      <div className="font-mono text-xs text-muted-foreground">{formatPhoneDisplay(c.telefone)}</div>
                    </td>
                    <td className="py-2.5 px-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.cadenceOverdue ? "bg-destructive/20 text-destructive" : "bg-primary/10 text-primary"}`}>
                        {c.cadenceStage}{c.cadenceOverdue ? " · atrasado" : ""}
                      </span>
                      {c.cadencePaused && <div className="text-[10px] text-primary mt-1">Lead respondeu — handoff humano</div>}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground">{profileName(c.responsavelId)}</td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground">
                      {c.cadenceDueAt ? new Date(c.cadenceDueAt).toLocaleDateString("pt-BR") : "—"}
                    </td>
                    {showAction && (
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {confirmD75For === c.id ? (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" disabled={touchingId === c.id} onClick={() => doTouch(c, true)}>Respondeu</Button>
                            <Button size="sm" variant="ghost" disabled={touchingId === c.id} onClick={() => doTouch(c, false)}>Não respondeu</Button>
                            <Button size="sm" variant="ghost" disabled={touchingId === c.id} onClick={() => setConfirmD75For(null)}>Cancelar</Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            className="btn-glow"
                            disabled={touchingId === c.id}
                            onClick={() => (c.cadenceStage === "D75" ? setConfirmD75For(c.id) : doTouch(c))}
                          >
                            Marcar como feito
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
