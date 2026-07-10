import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GradientDivider } from "@/components/GradientDivider";
import { useAuthStore } from "@/store/authStore";
import { agendaApi, subscribeAgendaEvents, type CalendarEvent, type CalendarEventType } from "@/lib/notifications";
import { Plus, Trash2, Pencil, X, Users2, CalendarDays } from "lucide-react";
import { toast } from "sonner";

type Scope = "pessoal" | "corporativo";

export default function Agenda() {
  const profile = useAuthStore((s) => s.profile);
  const isSocio = profile?.role === "socio";

  const [scope, setScope] = useState<Scope>("pessoal");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = () => {
    agendaApi
      .listEvents({ scope })
      .then(setEvents)
      .catch(() => setEvents([]));
  };

  useEffect(() => { reload(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // Evento corporativo criado por qualquer usuário aparece na hora pra todo
  // mundo, sem precisar dar F5 — mesmo WebSocket da Comunicação Interna.
  useEffect(() => {
    return subscribeAgendaEvents((ev) => {
      if (scope === "corporativo" && ev.tipo === "CORPORATIVO") setEvents((prev) => [...prev, ev]);
    });
  }, [scope]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = new Date(ev.dataHoraInicio).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [events]);

  const daysWithEvents = useMemo(() => events.map((ev) => new Date(ev.dataHoraInicio)), [events]);
  const dayEvents = (eventsByDay.get(selectedDay.toDateString()) ?? []).sort(
    (a, b) => new Date(a.dataHoraInicio).getTime() - new Date(b.dataHoraInicio).getTime(),
  );

  const removeEvent = async (ev: CalendarEvent) => {
    try {
      await agendaApi.deleteEvent(ev.id);
      setEvents((prev) => prev.filter((e) => e.id !== ev.id));
      toast.success("Evento removido");
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <AppHeader title="Agenda" subtitle="Compromissos pessoais e corporativos" />

      <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <TabsList className="bg-muted/30">
            <TabsTrigger value="pessoal"><CalendarDays className="w-3.5 h-3.5 mr-1.5" /> Minha Agenda</TabsTrigger>
            <TabsTrigger value="corporativo"><Users2 className="w-3.5 h-3.5 mr-1.5" /> Corporativa</TabsTrigger>
          </TabsList>

          <Button className="btn-glow" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Novo evento
          </Button>
        </div>

        <TabsContent value={scope} className="mt-0">
          <div className="grid lg:grid-cols-[auto_1fr] gap-4">
            <div className="glass-card p-3 animate-fade-in">
              <Calendar
                mode="single"
                selected={selectedDay}
                onSelect={(d) => d && setSelectedDay(d)}
                modifiers={{ hasEvent: daysWithEvents }}
                modifiersClassNames={{ hasEvent: "font-bold text-primary underline decoration-2 underline-offset-4" }}
              />
            </div>

            <div className="glass-card p-5 animate-fade-in">
              <h3 className="font-semibold text-sm mb-3">
                {selectedDay.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
              </h3>
              <GradientDivider className="mb-3" />
              {dayEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Nenhum evento neste dia.</p>
              ) : (
                <div className="space-y-2">
                  {dayEvents.map((ev) => (
                    <div key={ev.id} className="flex items-start justify-between gap-2 p-3 rounded-lg bg-muted/20 border border-border">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{ev.titulo}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {new Date(ev.dataHoraInicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          {ev.dataHoraFim && ` — ${new Date(ev.dataHoraFim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
                        </div>
                        {ev.descricao && <p className="text-xs text-muted-foreground mt-1">{ev.descricao}</p>}
                      </div>
                      {(ev.criadoPor === profile?.id || isSocio) && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="icon" variant="ghost" onClick={() => setEditing(ev)}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => removeEvent(ev)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {(creating || editing) && (
        <EventDialog
          event={editing}
          defaultDate={selectedDay}
          defaultTipo={scope === "corporativo" ? "CORPORATIVO" : "PESSOAL"}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(ev) => {
            setEvents((prev) => {
              const exists = prev.some((e) => e.id === ev.id);
              return exists ? prev.map((e) => (e.id === ev.id ? ev : e)) : [...prev, ev];
            });
            setCreating(false); setEditing(null);
          }}
        />
      )}
    </>
  );
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EventDialog({
  event, defaultDate, defaultTipo, onClose, onSaved,
}: {
  event: CalendarEvent | null;
  defaultDate: Date;
  defaultTipo: CalendarEventType;
  onClose: () => void;
  onSaved: (ev: CalendarEvent) => void;
}) {
  const [titulo, setTitulo] = useState(event?.titulo ?? "");
  const [descricao, setDescricao] = useState(event?.descricao ?? "");
  const [inicio, setInicio] = useState(() => {
    const base = event ? new Date(event.dataHoraInicio) : new Date(defaultDate);
    if (!event) base.setHours(9, 0, 0, 0);
    return toLocalInputValue(base);
  });
  const [fim, setFim] = useState(event?.dataHoraFim ? toLocalInputValue(new Date(event.dataHoraFim)) : "");
  const [tipo, setTipo] = useState<CalendarEventType>(event?.tipo ?? defaultTipo);
  const [lembrete, setLembrete] = useState(event?.lembreteMinutosAntes ?? 15);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!titulo.trim() || !inicio) { toast.error("Título e início são obrigatórios"); return; }
    setSaving(true);
    try {
      const payload = {
        titulo: titulo.trim(),
        descricao: descricao.trim() || undefined,
        dataHoraInicio: new Date(inicio).toISOString(),
        dataHoraFim: fim ? new Date(fim).toISOString() : undefined,
        lembreteMinutosAntes: lembrete,
      };
      const saved = event
        ? await agendaApi.updateEvent(event.id, payload)
        : await agendaApi.createEvent({ ...payload, tipo });
      toast.success(event ? "Evento atualizado" : "Evento criado");
      onSaved(saved);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-card max-w-md w-full p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">{event ? "Editar evento" : "Novo evento"}</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Título</label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Descrição</label>
            <textarea
              rows={2}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="w-full bg-input rounded px-3 py-2 text-sm border border-border mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Início</label>
              <Input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Fim (opcional)</label>
              <Input type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} className="mt-1" />
            </div>
          </div>
          {!event && (
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Tipo</label>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setTipo("PESSOAL")}
                  className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${tipo === "PESSOAL" ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
                >Pessoal</button>
                <button
                  type="button"
                  onClick={() => setTipo("CORPORATIVO")}
                  className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${tipo === "CORPORATIVO" ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
                >Corporativo (visível a todos)</button>
              </div>
            </div>
          )}
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Lembrete (minutos antes)</label>
            <Input type="number" min={0} value={lembrete} onChange={(e) => setLembrete(Number(e.target.value) || 0)} className="mt-1" />
          </div>
        </div>

        <div className="flex gap-2 mt-5 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button className="btn-glow" onClick={save} disabled={saving}>Salvar</Button>
        </div>
      </div>
    </div>
  );
}
