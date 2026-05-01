import { AppHeader } from "@/components/AppHeader";
import { useAppStore } from "@/store/appStore";
import { Users, MessageSquare, CheckCircle2, AlertTriangle, Activity, Inbox, Timer, Zap } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";
import { useEffect, useMemo, useState } from "react";
import { api, type MetricsResponse } from "@/lib/engine";

type Range = 1 | 7 | 30;

function Stat({ icon: Icon, label, value, hint, accent }: { icon: React.ElementType; label: string; value: string | number; hint?: string; accent?: "primary" | "success" | "warning" | "destructive"; }) {
  const accentClass = accent === "success" ? "text-success" : accent === "warning" ? "text-warning" : accent === "destructive" ? "text-destructive" : "text-primary";
  return (
    <div className="glass-card glass-card-hover p-3 animate-scale-in">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
          <div className="text-xl font-semibold mt-0.5 tracking-tight truncate">{value}</div>
          {hint && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
        </div>
        <div className={`w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 ${accentClass}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
    </div>
  );
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
  const contacts = useAppStore((s) => s.contacts);
  const campaign = useAppStore((s) => s.campaign);
  const logs = useAppStore((s) => s.logs);
  const status = useAppStore((s) => s.status);
  const conversations = useAppStore((s) => s.conversations);
  const engineOnline = useAppStore((s) => s.engineOnline);

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

  // Fallback: derivar do estado local quando offline
  const fallback = useMemo(() => {
    const tagSet = new Set<string>();
    for (const c of contacts) for (const t of c.tags) tagSet.add(t);
    const days: { day: string; envios: number }[] = [];
    const now = Date.now();
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const label = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const envios = logs.filter((l) => l.level === "success" && new Date(l.ts).toDateString() === d.toDateString()).length;
      days.push({ day: label, envios });
    }
    return {
      contacts: contacts.length,
      tags: tagSet.size,
      conversations: conversations.length,
      pendentes: conversations.filter((c) => c.status === "pendente").length,
      atendendo: conversations.filter((c) => c.status === "atendendo").length,
      finalizadas: conversations.filter((c) => c.status === "finalizado").length,
      sent: campaign.sent, errors: campaign.failed,
      successRate: (campaign.sent + campaign.failed) ? Math.round(campaign.sent / (campaign.sent + campaign.failed) * 100) : null,
      avgFirstResponseMs: 0,
      series: days,
      funnel: [] as { key: string; label: string; color: string; count: number }[],
      topTags: [] as { nome: string; cor: string; count: number }[],
    };
  }, [contacts, logs, conversations, campaign, range]);

  const totals = metrics?.totals ?? fallback;
  const series = metrics?.series.map((d) => ({ day: d.day, envios: d.envios })) ?? fallback.series;
  const funnel = metrics?.funnel ?? fallback.funnel;
  const topTags = metrics?.topTags ?? fallback.topTags;

  const successRate = totals.successRate == null ? "—" : `${totals.successRate}%`;

  return (
    <>
      <AppHeader title="Dashboard" subtitle="Visão geral em tempo real da sua plataforma" />

      <div className="flex items-center justify-end mb-4 gap-1">
        {([1, 7, 30] as Range[]).map((r) => (
          <button key={r} onClick={() => setRange(r)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
              range === r ? "bg-primary text-primary-foreground border-primary shadow-glow"
                          : "bg-card/40 border-border/30 hover:border-primary/40 text-muted-foreground"
            }`}>
            {r === 1 ? "Hoje" : `${r} dias`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
        <Stat icon={Users} label="Contatos" value={totals.contacts} hint={`${totals.tags} tags`} />
        <Stat icon={Inbox} label="Pendentes" value={totals.pendentes} hint={`${totals.conversations} convs`} accent={totals.pendentes > 0 ? "warning" : "primary"} />
        <Stat icon={CheckCircle2} label="Finalizados" value={totals.finalizadas} hint={`${totals.atendendo} ativos`} accent="success" />
        <Stat icon={Activity} label="WhatsApp" value={status === "ready" ? "Online" : status === "qr" ? "QR" : "Off"} hint="Sessão" accent={status === "ready" ? "success" : "warning"} />
        <Stat icon={Zap} label="Enviadas" value={totals.sent} hint={`${totals.errors} erros`} accent="primary" />
        <Stat icon={CheckCircle2} label="Sucesso" value={successRate} hint="dos envios" accent="success" />
        <Stat icon={Timer} label="Resposta" value={fmtMs(totals.avgFirstResponseMs)} hint="1ª resposta" accent="primary" />
        <Stat icon={MessageSquare} label="Janela" value={range === 1 ? "Hoje" : `${range}d`} hint="filtro" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="glass-card p-5 lg:col-span-2 animate-fade-in">
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
            <h3 className="text-base font-semibold">Atividade recente</h3>
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          </div>
          <ul className="space-y-3 max-h-64 overflow-y-auto scrollbar-thin pr-2">
            {logs.length === 0 && <li className="text-sm text-muted-foreground">Sem atividade ainda.</li>}
            {logs.slice(0, 12).map((l) => (
              <li key={l.id} className="flex items-start gap-2 text-xs animate-slide-in">
                <span className={`mt-1 status-dot ${
                  l.level === "success" ? "bg-success text-success" :
                  l.level === "error" ? "bg-destructive text-destructive" :
                  l.level === "warn" ? "bg-warning text-warning" : "bg-primary text-primary"
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-foreground">{l.message}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(l.ts).toLocaleTimeString("pt-BR")} {l.contact ? `• ${l.contact}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card p-5 animate-fade-in">
          <h3 className="text-base font-semibold mb-1">Funil do CRM</h3>
          <p className="text-xs text-muted-foreground mb-4">Contatos por etapa do pipeline</p>
          {funnel.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">Conecte o motor local para ver o funil.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnel.map((f) => ({ name: f.label, count: f.count, fill: `hsl(${f.color})` }))}>
                  <CartesianGrid stroke="hsl(213 40% 30% / 0.2)" vertical={false} />
                  <XAxis dataKey="name" stroke="hsl(213 50% 70%)" fontSize={10} tickLine={false} axisLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis stroke="hsl(213 50% 70%)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "hsl(218 55% 9%)", border: "1px solid hsl(213 40% 30% / 0.4)", borderRadius: 10, color: "hsl(213 100% 95%)" }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="glass-card p-5 animate-fade-in">
          <h3 className="text-base font-semibold mb-1">Top tags</h3>
          <p className="text-xs text-muted-foreground mb-4">Segmentos com mais contatos</p>
          {topTags.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">Importe contatos com tags para ver aqui.</p>
          ) : (
            <ul className="space-y-2">
              {topTags.map((t) => (
                <li key={t.nome} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20 border border-border/30">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.cor }} />
                  <span className="text-sm font-medium truncate flex-1">#{t.nome}</span>
                  <span className="text-xs text-muted-foreground">{t.count} contatos</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
