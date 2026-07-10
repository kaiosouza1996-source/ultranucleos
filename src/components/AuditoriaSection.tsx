import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/engine";
import { useAuthStore } from "@/store/authStore";
import type { Conversation } from "@/store/appStore";
import { Search, ShieldCheck, Archive, Inbox, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface AuditLogEntry {
  id: string; ts: number; actor: string; actor_role: string;
  action: string; target_type: string; target_id: string; reason: string; details: string;
}

type AuditTab = "aberto" | "finalizadas" | "arquivadas";

/**
 * Auditoria — vive como aba dentro de Configurações. É a "somatória de tudo
 * que existe": em aberto, finalizadas e arquivadas, sempre em 3 sub-abas.
 * Sócio vê tudo (inclusive arquivadas); qualquer outro papel vê só as
 * próprias conversas (em aberto/finalizadas — arquivadas continua restrito
 * a Sócio, mesma regra de conteúdo de GET /conversations/:id/messages).
 */
export function AuditoriaSection() {
  const isSocio = useAuthStore((s) => s.profile?.role === "socio");
  const [name, setName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [archivedBy, setArchivedBy] = useState("");
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [log, setLog] = useState<AuditLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState<AuditTab>("aberto");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.auditSearchConversations({ name, keyword, archivedBy });
      setRows(data);
    } catch (e) {
      toast.error(`Falha na busca: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // Carrega assim que a aba abre — antes disso a lista só aparecia depois de
  // clicar em "Buscar", o que fazia parecer que finalizar/arquivar não
  // refletia aqui quando na verdade só faltava disparar a busca.
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLog = async () => {
    setLoading(true);
    try {
      setLog(await api.auditLog());
    } catch (e) {
      toast.error(`Falha ao carregar log: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const buckets = useMemo(() => {
    const all = rows ?? [];
    return {
      aberto: all.filter((r) => !r.archived && (r.status === "pendente" || r.status === "atendendo")),
      finalizadas: all.filter((r) => !r.archived && r.status === "finalizado"),
      arquivadas: all.filter((r) => !!r.archived),
    };
  }, [rows]);

  const current = buckets[subTab];

  const reabrir = async (id: string) => {
    setBusyId(id);
    try {
      await api.release(id);
      toast.success("Conversa reaberta — voltou para Pendentes no Atendimento.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const desarquivar = async (id: string) => {
    setBusyId(id);
    try {
      await api.unarchiveConversation(id);
      toast.success("Conversa desarquivada.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Search className="w-4 h-4 text-primary" />
            <h3 className="font-semibold">Conversas — em aberto, finalizadas e arquivadas</h3>
          </div>
          <div className="grid sm:grid-cols-3 gap-3 mb-3">
            <Input placeholder="Nome do contato" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Palavra-chave na mensagem" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            {isSocio && (
              <Input placeholder="Arquivado por" value={archivedBy} onChange={(e) => setArchivedBy(e.target.value)} />
            )}
          </div>
          <Button onClick={load} disabled={loading} className="btn-glow">
            <Search className="w-4 h-4 mr-2" /> Buscar
          </Button>

          <Tabs value={subTab} onValueChange={(v) => setSubTab(v as AuditTab)} className="mt-5">
            <TabsList className="bg-muted/30">
              <TabsTrigger value="aberto"><Inbox className="w-3.5 h-3.5 mr-1.5" /> Em aberto ({buckets.aberto.length})</TabsTrigger>
              <TabsTrigger value="finalizadas"><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Finalizadas ({buckets.finalizadas.length})</TabsTrigger>
              {isSocio && (
                <TabsTrigger value="arquivadas"><Archive className="w-3.5 h-3.5 mr-1.5" /> Arquivadas ({buckets.arquivadas.length})</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value={subTab} className="mt-4 space-y-2">
              {rows === null ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : current.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conversa nesta visão.</p>
              ) : (
                current.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.nome || r.telefone}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {!!r.archived && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">
                            <Archive className="w-3 h-3" /> Arquivada
                          </span>
                        )}
                        {subTab === "finalizadas" && (
                          <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => reabrir(r.id)}>
                            Reabrir
                          </Button>
                        )}
                        {subTab === "arquivadas" && isSocio && (
                          <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => desarquivar(r.id)}>
                            Desarquivar
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{r.last_message}</p>
                    {!!r.archived && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Arquivada por <strong className="text-foreground">{r.archived_by}</strong> — {r.archived_reason}
                      </p>
                    )}
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {isSocio && (
        <div className="space-y-4">
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Audit log (imutável)</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">Quem, quando e por quê de cada arquivamento. Nunca pode ser editado ou apagado.</p>
            <Button variant="outline" onClick={loadLog} disabled={loading} className="w-full mb-3">Carregar log</Button>
            <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
              {log?.map((l) => (
                <div key={l.id} className="text-xs border-b border-border pb-2">
                  <div className="font-medium">{l.action}</div>
                  <div className="text-muted-foreground">{new Date(l.ts).toLocaleString("pt-BR")} · {l.actor} ({l.actor_role})</div>
                  <div className="text-muted-foreground">{l.reason}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
