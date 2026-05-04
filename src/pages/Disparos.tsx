import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppStore } from "@/store/appStore";
import { useEffect, useMemo, useState } from "react";
import { Play, Pause, Square, Send, Users, MessageSquareText } from "lucide-react";
import { startCampaign, pauseCampaign, resumeCampaign, stopCampaign } from "@/lib/engine";
import { toast } from "sonner";
import { useLocation } from "react-router-dom";
import Mensagens from "./Mensagens";

export default function Disparos() {
  const location = useLocation();
  const [tab, setTab] = useState<"campanha" | "mensagens">(location.pathname === "/mensagens" ? "mensagens" : "campanha");
  useEffect(() => {
    setTab(location.pathname === "/mensagens" ? "mensagens" : "campanha");
  }, [location.pathname]);

  const contacts = useAppStore((s) => s.contacts);
  const templates = useAppStore((s) => s.templates);
  const settings = useAppStore((s) => s.settings);
  const campaign = useAppStore((s) => s.campaign);
  // status removido — disparo é sempre tentado contra o motor local.

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) for (const t of c.tags) set.add(t);
    return Array.from(set).sort();
  }, [contacts]);

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [combineMode, setCombineMode] = useState<"or" | "and">("or");
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");

  const targets = useMemo(() => contacts.filter((c) => {
    if (selectedTags.length === 0) return true;
    return combineMode === "or"
      ? selectedTags.some((t) => c.tags.includes(t))
      : selectedTags.every((t) => c.tags.includes(t));
  }).slice(0, settings.perRunLimit), [contacts, selectedTags, combineMode, settings.perRunLimit]);

  const progressPct = campaign.total ? Math.round(((campaign.sent + campaign.failed) / campaign.total) * 100) : 0;
  const toggleTag = (t: string) => setSelectedTags((curr) => curr.includes(t) ? curr.filter((x) => x !== t) : [...curr, t]);

  const handleStart = () => {
    if (!templateId) return toast.error("Selecione um template.");
    if (targets.length === 0) return toast.error("Nenhum contato selecionado.");
    // Sem trava: o disparo é sempre tentado contra http://localhost:8787/send.
    startCampaign({ contactIds: targets.map((t) => t.id), templateId });
  };

  return (
    <>
      <AppHeader title="Disparos" subtitle="Campanhas e templates de mensagens" />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "campanha" | "mensagens")} className="space-y-4">
        <TabsList className="bg-muted/30">
          <TabsTrigger value="campanha"><Send className="w-3.5 h-3.5 mr-1.5" /> Campanha</TabsTrigger>
          <TabsTrigger value="mensagens"><MessageSquareText className="w-3.5 h-3.5 mr-1.5" /> Mensagens (templates)</TabsTrigger>
        </TabsList>

        <TabsContent value="mensagens"><Mensagens /></TabsContent>

        <TabsContent value="campanha">
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-card p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                <h3 className="font-semibold">1. Segmentação por tag</h3>
              </div>
              {selectedTags.length > 1 && (
                <div className="flex items-center gap-1 text-xs">
                  <button onClick={() => setCombineMode("or")} className={`px-2 py-1 rounded ${combineMode === "or" ? "bg-primary text-primary-foreground" : "bg-muted/40"}`}>OU</button>
                  <button onClick={() => setCombineMode("and")} className={`px-2 py-1 rounded ${combineMode === "and" ? "bg-primary text-primary-foreground" : "bg-muted/40"}`}>E</button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.length === 0 && <p className="text-sm text-muted-foreground">Importe contatos primeiro.</p>}
              {tags.map((t) => {
                const active = selectedTags.includes(t);
                const count = contacts.filter((c) => c.tags.includes(t)).length;
                return (
                  <button key={t} onClick={() => toggleTag(t)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all
                      ${active ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
                  >
                    {t} <span className={`text-xs px-1.5 py-0.5 rounded ${active ? "bg-primary-foreground/20" : "bg-foreground/5"}`}>{count}</span>
                  </button>
                );
              })}
            </div>
            {selectedTags.length === 0 && tags.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">Nenhuma tag = todos os contatos</p>
            )}
          </div>

          <div className="glass-card p-5 animate-fade-in">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquareText className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">2. Template</h3>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {templates.map((t) => (
                <button key={t.id} onClick={() => setTemplateId(t.id)}
                  className={`text-left p-3 rounded-lg border transition-all
                    ${templateId === t.id ? "border-primary bg-primary/10 shadow-glow" : "border-border/40 hover:border-primary/40"}`}
                >
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground truncate mt-1">{t.body}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="glass-card p-5 animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <Send className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">3. Execução</h3>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center mb-4">
              <div><div className="text-xl font-semibold">{targets.length}</div><div className="text-xs text-muted-foreground">Alvos</div></div>
              <div><div className="text-xl font-semibold">{settings.minDelay}–{settings.maxDelay}s</div><div className="text-xs text-muted-foreground">Intervalo</div></div>
              <div><div className="text-xl font-semibold">≈{Math.round((targets.length * (settings.minDelay + settings.maxDelay)) / 120)}min</div><div className="text-xs text-muted-foreground">Estimado</div></div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!campaign.running && (
                <Button className="btn-glow" onClick={handleStart}>
                  <Play className="w-4 h-4 mr-2" /> Iniciar disparo
                </Button>
              )}
              {campaign.running && !campaign.paused && (
                <Button variant="outline" onClick={pauseCampaign}><Pause className="w-4 h-4 mr-2" /> Pausar</Button>
              )}
              {campaign.running && campaign.paused && (
                <Button className="btn-glow" onClick={resumeCampaign}><Play className="w-4 h-4 mr-2" /> Retomar</Button>
              )}
              {campaign.running && (
                <Button variant="ghost" onClick={stopCampaign} className="text-destructive">
                  <Square className="w-4 h-4 mr-2" /> Parar
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass-card p-5 animate-fade-in">
            <h3 className="font-semibold mb-3">Progresso</h3>
            <div className="text-3xl font-semibold tracking-tight">{campaign.sent + campaign.failed}<span className="text-muted-foreground text-base">/{campaign.total || "—"}</span></div>
            <div className="text-xs text-muted-foreground mb-3">{progressPct}% concluído</div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-gradient-primary transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4 text-center">
              <div className="p-2 rounded-lg bg-success/10"><div className="text-success text-lg font-semibold">{campaign.sent}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Enviadas</div></div>
              <div className="p-2 rounded-lg bg-destructive/10"><div className="text-destructive text-lg font-semibold">{campaign.failed}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Falhas</div></div>
            </div>
            {campaign.currentContact && <div className="mt-3 text-xs text-muted-foreground truncate">Atual: {campaign.currentContact}</div>}
          </div>
          <div className="glass-card p-5 animate-fade-in text-xs text-muted-foreground space-y-2">
            <p>🛡️ <strong className="text-foreground">Anti-ban ativo:</strong> intervalos aleatórios, jitter automático e pausas longas a cada {settings.longPauseEvery} envios.</p>
            <p>📅 Limite diário: <strong className="text-foreground">{settings.perDayLimit}</strong> mensagens.</p>
          </div>
        </div>
      </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
