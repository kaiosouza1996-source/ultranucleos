import { AppHeader } from "@/components/AppHeader";
import { useAppStore } from "@/store/appStore";
import { Users, MessageSquare, CheckCircle2, Inbox, Timer, Zap, Briefcase, Tag, Snowflake, CalendarX2, Trophy, TrendingUp, Layers, Ban } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type MetricsResponse } from "@/lib/engine";
import { gradientSliceStyle } from "@/lib/gradient";
import { funis as funisApi, type Funil, DEFAULT_FUNIL_ID } from "@/lib/funis";

type Range = 1 | 7 | 30;

function Stat({
  icon: Icon, label, value, hint, accent, index, total, to,
}: {
  icon: React.ElementType; label: string; value: string | number; hint?: string;
  accent?: "primary" | "success" | "warning" | "destructive";
  /** Posição na fileira de KPIs — usada para fatiar o gradiente de marca continuamente em vez de repeti-lo inteiro em cada card. */
  index: number; total: number;
  /** Quando presente, o card inteiro navega — nunca abre modal (seção 11 da spec). */
  to?: string;
}) {
  const accentClass = accent === "success" ? "text-success" : accent === "warning" ? "text-warning" : accent === "destructive" ? "text-destructive" : "text-primary";
  const content = (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight whitespace-nowrap">{label}</div>
        <div className="text-xl font-semibold mt-0.5 tracking-tight truncate">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
      </div>
      <div className={`w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 ${accentClass}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
    </div>
  );
  const cls = `glass-card glass-card-hover glass-card-accent p-3 animate-scale-in block ${to ? "cursor-pointer" : ""}`;
  const style = gradientSliceStyle(index, total) as CSSProperties;
  return to ? <Link to={to} className={cls} style={style}>{content}</Link> : <div className={cls} style={style}>{content}</div>;
}

function MiniStat({ icon: Icon, label, value, hint, to, index, total }: {
  icon: React.ElementType; label: string; value: string | number; hint?: string; to?: string;
  index: number; total: number;
}) {
  const content = (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground leading-tight">{label}</div>
        <div className="text-base font-semibold mt-0.5 tracking-tight truncate">{value}</div>
        {hint && <div className="text-[9px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
      </div>
      <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-primary">
        <Icon className="w-3 h-3" />
      </div>
    </div>
  );
  const cls = `glass-card glass-card-hover glass-card-accent p-3 animate-scale-in block ${to ? "cursor-pointer" : ""}`;
  const style = gradientSliceStyle(index, total) as CSSProperties;
  return to ? <Link to={to} className={cls} style={style}>{content}</Link> : <div className={cls} style={style}>{content}</div>;
}

function fmtMs(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const contacts = useAppStore((s) => s.contacts);
  const campaign = useAppStore((s) => s.campaign);
  const logs = useAppStore((s) => s.logs);
  const conversations = useAppStore((s) => s.conversations);
  const engineOnline = useAppStore((s) => s.engineOnline);
  const pipelineStages = useAppStore((s) => s.pipelineStages);
  const tags = useAppStore((s) => s.tags);

  const [range, setRange] = useState<Range>(7);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);

  useEffect(() => {
    if (!engineOnline) { setMetrics(null); return; }
    let cancel = false;
    const load = () => api.fetchMetrics(range).then((m) => { if (!cancel) setMetrics(m); }).catch(() => {});
    load();
    const t = window.setInterval(load, 15000);
    return () => { cancel = true; window.clearInterval(t); };
  }, [range, engineOnline]);

  // Seletor de funil no widget "Funil do CRM" (Parte T4) — o Funil do CRM
  // padrão continua vindo de /metrics (por usuário); os customizados são
  // compartilhados (Postgres) e suas contagens são calculadas aqui mesmo a
  // partir do mapeamento contato→etapa, sem precisar de rota nova.
  const [customFunis, setCustomFunis] = useState<Funil[]>([]);
  useEffect(() => { funisApi.list().then(setCustomFunis).catch(() => {}); }, []);
  const [selectedFunilId, setSelectedFunilId] = useState(DEFAULT_FUNIL_ID);
  const [customFunilCounts, setCustomFunilCounts] = useState<{ key: string; label: string; color: string; count: number }[]>([]);
  useEffect(() => {
    if (selectedFunilId === DEFAULT_FUNIL_ID) return;
    const f = customFunis.find((x) => x.id === selectedFunilId);
    if (!f) return;
    let cancel = false;
    funisApi.contatos(selectedFunilId).then((rows) => {
      if (cancel) return;
      const countByEtapa = new Map<string, number>();
      for (const r of rows) countByEtapa.set(r.etapaId, (countByEtapa.get(r.etapaId) || 0) + 1);
      const sorted = f.etapas.slice().sort((a, b) => a.ordem - b.ordem);
      setCustomFunilCounts(sorted.map((et) => ({
        key: et.id, label: et.nome, color: et.cor || "213 90% 55%",
        count: countByEtapa.get(et.id) || 0,
      })));
    }).catch(() => setCustomFunilCounts([]));
    return () => { cancel = true; };
  }, [selectedFunilId, customFunis]);

  // Fallback: derivar do estado local quando offline
  const fallback = useMemo(() => {
    const tagSet = new Set<string>();
    for (const c of contacts) for (const t of c.tags) tagSet.add(t);
    const days: { day: string; envios: number }[] = [];
    const now = Date.now();
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const label = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const envios = logs.filter((l) => l.level === "success" && /mensagem enviada|via \/send/i.test(l.message) && new Date(l.ts).toDateString() === d.toDateString()).length;
      days.push({ day: label, envios });
    }
    const sentLogs = logs.filter((l) => l.level === "success" && /mensagem enviada|via \/send/i.test(l.message) && l.ts >= now - range * 86400000);
    const errorLogs = logs.filter((l) => l.level === "error" && l.ts >= now - range * 86400000);
    const funnel = pipelineStages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      color: stage.color,
      ord: stage.order,
      count: contacts.filter((c) => (c.status || pipelineStages[0]?.key || "novo") === stage.key).length,
    }));
    const tagColor = new Map(tags.map((t) => [t.nome, t.cor]));
    const topTags = Array.from(tagSet).map((nome) => ({
      nome,
      cor: tagColor.get(nome) || "#2D8CFF",
      count: contacts.filter((c) => c.tags.includes(nome)).length,
    })).sort((a, b) => b.count - a.count).slice(0, 8);

    // Cliente da Assessoria / Lead Frio + Cadência — fallback local (offline),
    // mesma regra de "elegível" do backend: atuaMercadoFinanceiro vazio ou SIM.
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const elegiveis = contacts.filter((c) => !c.atuaMercadoFinanceiro || c.atuaMercadoFinanceiro === "SIM");
    const clientesAssessoria = elegiveis.filter((c) => c.isClient).length;
    const leadsFrios = elegiveis.filter((c) => !c.isClient).length;
    const semContato30d = elegiveis.filter((c) => c.isClient && (!c.lastContactAt || (now - c.lastContactAt) >= THIRTY_DAYS_MS)).length;
    const cadenceCounts = { D1: 0, D3: 0, D7: 0, D15: 0, D75: 0, ENCERRADO_SEM_RESPOSTA: 0 };
    for (const c of elegiveis) {
      if (c.isClient) continue;
      const st = c.cadenceStage;
      if (st && st in cadenceCounts) cadenceCounts[st as keyof typeof cadenceCounts]++;
    }
    const cadenciaAtiva = cadenceCounts.D1 + cadenceCounts.D3 + cadenceCounts.D7 + cadenceCounts.D15 + cadenceCounts.D75;
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
    const convertidosEsteMes = elegiveis.filter((c) => c.isClient && c.isClientSince && c.isClientSince >= startOfMonth.getTime()).length;
    const comConversa = elegiveis.filter((c) => c.conversationStartedAt).length;
    const convertidosTotal = elegiveis.filter((c) => c.isClient && c.conversationStartedAt).length;
    const taxaConversao = comConversa ? Math.round((convertidosTotal / comConversa) * 100) : null;

    return {
      contacts: contacts.length,
      tags: tagSet.size,
      conversations: conversations.length,
      pendentes: conversations.filter((c) => c.status === "pendente").length,
      atendendo: conversations.filter((c) => c.status === "atendendo").length,
      finalizadas: conversations.filter((c) => c.status === "finalizado").length,
      sent: sentLogs.length || campaign.sent,
      errors: errorLogs.length || campaign.failed,
      successRate: (sentLogs.length + errorLogs.length) ? Math.round(sentLogs.length / (sentLogs.length + errorLogs.length) * 100) : null,
      avgFirstResponseMs: 0,
      clientesAssessoria, leadsFrios, semContato30d,
      cadenceD1: cadenceCounts.D1, cadenceD3: cadenceCounts.D3, cadenceD7: cadenceCounts.D7,
      cadenceD15: cadenceCounts.D15, cadenceD75: cadenceCounts.D75,
      cadenceEncerrado: cadenceCounts.ENCERRADO_SEM_RESPOSTA, cadenciaAtiva,
      convertidosEsteMes, taxaConversao,
      series: days,
      funnel,
      topTags,
    };
  }, [contacts, logs, conversations, campaign, range, pipelineStages, tags]);

  const totals = metrics?.totals
    ? { ...metrics.totals, contacts: Math.max(metrics.totals.contacts, fallback.contacts), tags: Math.max(metrics.totals.tags, fallback.tags) }
    : fallback;
  const series = metrics?.series?.some((d) => d.envios > 0) ? metrics.series.map((d) => ({ day: d.day, envios: d.envios })) : fallback.series;
  const funnel = selectedFunilId === DEFAULT_FUNIL_ID
    ? (metrics?.funnel?.some((f) => f.count > 0) ? metrics.funnel : fallback.funnel)
    : customFunilCounts;
  const topTags = metrics?.topTags?.some((t) => t.count > 0) ? metrics.topTags : fallback.topTags;

  const successRate = totals.successRate == null ? "—" : `${totals.successRate}%`;

  return (
    <>
      <AppHeader title="Dashboard" subtitle="Visão geral em tempo real da sua plataforma" />

      <div className="flex items-center justify-end mb-4 gap-1">
        {([1, 7, 30] as Range[]).map((r) => (
          <button key={r} onClick={() => setRange(r)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
              range === r ? "bg-primary text-primary-foreground border-primary shadow-glow"
                          : "bg-card/40 border-border hover:border-primary/40 text-muted-foreground"
            }`}>
            {r === 1 ? "Hoje" : `${r} dias`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
        <Stat index={0} total={8} icon={Users} label="Clientes Assessoria" value={totals.clientesAssessoria} hint="carteira ativa" to="/contatos?filtro=clientes" />
        <Stat index={1} total={8} icon={Snowflake} label="Leads Frios" value={totals.leadsFrios} hint="Esperando Contato" to="/contatos?filtro=leads_frios" />
        <Stat index={2} total={8} icon={CalendarX2} label="S/ contato 30+" value={totals.semContato30d} hint="clientes esfriando" accent="warning" to="/contatos?filtro=sem_contato_30d" />
        <Stat index={3} total={8} icon={Inbox} label="Pendentes" value={totals.pendentes} hint={`${totals.conversations} conversas`} accent={totals.pendentes > 0 ? "warning" : "primary"} to="/atendimento?tab=pendentes" />
        <Stat index={4} total={8} icon={CheckCircle2} label="Finalizados" value={totals.finalizadas} hint={`janela ${range === 1 ? "hoje" : `${range}d`}`} accent="success" to="/configuracoes#auditoria" />
        <Stat index={5} total={8} icon={Zap} label="Enviadas" value={totals.sent} hint={`${totals.errors} erros`} accent="primary" />
        <Stat index={6} total={8} icon={CheckCircle2} label="Sucesso" value={successRate} hint={`${totals.errors} erros`} accent="success" />
        <Stat index={7} total={8} icon={Timer} label="Resposta" value={fmtMs(totals.avgFirstResponseMs)} hint="após 1º contato" accent="primary" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="glass-card glass-card-accent p-5 lg:col-span-2 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold">Envios — últimos {range === 1 ? "1 dia" : `${range} dias`}</h3>
              <p className="text-xs text-muted-foreground">Mensagens enviadas com sucesso</p>
            </div>
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(213 100% 60%)" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="hsl(213 100% 60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(213 40% 30% / 0.2)" vertical={false} />
                <XAxis dataKey="day" stroke="hsl(213 50% 70%)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(213 50% 70%)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(218 55% 9%)", border: "1px solid hsl(213 40% 30% / 0.4)", borderRadius: 10, color: "hsl(213 100% 95%)" }} />
                <Area type="monotone" dataKey="envios" stroke="hsl(213 100% 60%)" strokeWidth={2} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card p-5 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">Cadência de Follow-up</h3>
            <Layers className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MiniStat index={0} total={9} icon={Zap} label="D1" value={totals.cadenceD1} hint="aguardando toque" to="/cadencia?tab=estagio&estagio=D1" />
            <MiniStat index={1} total={9} icon={Zap} label="D3" value={totals.cadenceD3} hint="aguardando toque" to="/cadencia?tab=estagio&estagio=D3" />
            <MiniStat index={2} total={9} icon={Zap} label="D7" value={totals.cadenceD7} hint="aguardando toque" to="/cadencia?tab=estagio&estagio=D7" />
            <MiniStat index={3} total={9} icon={Zap} label="D15" value={totals.cadenceD15} hint="aguardando toque" to="/cadencia?tab=estagio&estagio=D15" />
            <MiniStat index={4} total={9} icon={Zap} label="D75" value={totals.cadenceD75} hint="reativação" to="/cadencia?tab=estagio&estagio=D75" />
            <MiniStat index={5} total={9} icon={Trophy} label="Convertidos" value={totals.convertidosEsteMes} hint="este mês" to="/cadencia?tab=convertidos" />
            <MiniStat index={6} total={9} icon={TrendingUp} label="Taxa Conversão" value={totals.taxaConversao == null ? "—" : `${totals.taxaConversao}%`} hint="de quem respondeu" />
            <MiniStat index={7} total={9} icon={Layers} label="Cadência Ativa" value={totals.cadenciaAtiva} hint="D1 a D75" to="/cadencia" />
            <MiniStat index={8} total={9} icon={Ban} label="Encerrado s/ Resp." value={totals.cadenceEncerrado} hint="ciclo encerrado" to="/cadencia?tab=encerrados" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card p-5 animate-fade-in">
          <div className="flex items-center justify-between mb-4 gap-2">
            <div className="min-w-0">
              <select
                value={selectedFunilId}
                onChange={(e) => setSelectedFunilId(e.target.value)}
                className="text-base font-semibold bg-transparent border-none p-0 focus:outline-none cursor-pointer -ml-0.5"
                title="Trocar funil"
              >
                <option value={DEFAULT_FUNIL_ID}>Funil do CRM</option>
                {customFunis.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Contatos por etapa do pipeline</p>
            </div>
            <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
          {funnel.length === 0 || funnel.every((f) => f.count === 0) ? (
            <p className="text-xs text-muted-foreground py-12 text-center">Cadastre ou importe contatos para ver o funil.</p>
          ) : (
            (() => {
              const sorted = [...funnel].sort((a, b) => (b.count - a.count));
              const max = Math.max(...sorted.map((f) => f.count), 1);
              const total = sorted.reduce((s, f) => s + f.count, 0) || 1;
              return (
                <ul className="space-y-2.5">
                  {sorted.map((f, idx) => {
                    const widthTop = (f.count / max) * 100;
                    const pct = Math.round((f.count / total) * 100);
                    const color = `hsl(${f.color})`;
                    return (
                      <li key={f.key} className="group relative animate-slide-in" style={{ animationDelay: `${idx * 60}ms` }}>
                        <div className="flex items-center justify-between mb-1.5 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full shrink-0 transition-transform group-hover:scale-150"
                              style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
                            <span className="font-medium truncate">{f.label}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 tabular-nums">
                            <span className="font-semibold text-foreground">{f.count}</span>
                            <span className="text-muted-foreground text-[10px]">{pct}%</span>
                          </div>
                        </div>
                        <div className="relative h-3 rounded-full overflow-hidden bg-muted/30"
                          style={{ boxShadow: "inset 0 1px 2px rgba(0,0,0,0.3)" }}>
                          <div className="h-full rounded-full transition-all duration-700 ease-out group-hover:brightness-125"
                            style={{
                              width: `${widthTop}%`,
                              background: `linear-gradient(90deg, ${color} 0%, ${color}cc 60%, ${color}66 100%)`,
                              boxShadow: `0 0 12px ${color}80`,
                            }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              );
            })()
          )}
        </div>

        <div className="glass-card p-5 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold">Top tags</h3>
              <p className="text-xs text-muted-foreground">Segmentos com mais contatos</p>
            </div>
            <Tag className="w-4 h-4 text-muted-foreground" />
          </div>
          {topTags.length === 0 ? (
            <p className="text-xs text-muted-foreground py-12 text-center">Importe contatos com tags para ver aqui.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {topTags.map((t, idx) => {
                // Cores de tag são sempre hex (#RRGGBB — ver PALETTE em
                // Tags.tsx e randomColor() no backend), nunca HSL. Envolver em
                // hsl(#RRGGBB) gera uma cor CSS inválida, que o navegador
                // ignora silenciosamente — por isso a bolinha/fundo coloridos
                // não apareciam, mesmo com os dados certos vindo do backend.
                const color = t.cor;
                return (
                  <button key={t.nome}
                    onClick={() => navigate(`/tags?open=${encodeURIComponent(t.nome)}`)}
                    title={`Ver contatos com #${t.nome}`}
                    className="group inline-flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full text-xs font-medium transition-all duration-300 hover:-translate-y-0.5 animate-scale-in cursor-pointer"
                    style={{
                      background: `linear-gradient(135deg, ${color}26, ${color}0d)`,
                      border: `1px solid ${color}40`,
                      boxShadow: `0 2px 12px -4px ${color}55`,
                      animationDelay: `${idx * 50}ms`,
                    }}>
                    <span className="w-1.5 h-1.5 rounded-full"
                      style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                    <span className="text-foreground/90 group-hover:text-foreground">#{t.nome}</span>
                    <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[10px] font-semibold tabular-nums"
                      style={{ background: `${color}33`, color: color }}>
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
