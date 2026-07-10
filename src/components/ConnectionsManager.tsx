import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/appStore";
import { useAuthStore } from "@/store/authStore";
import { api } from "@/lib/engine";
import { CheckCircle2, LogOut, Plus, RefreshCw, Trash, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Gerencia N números de WhatsApp conectados (não só um) — cada um com sua
 * própria sessão/QR/status. Reutilizado em /conexao e em Configurações →
 * Conexão. Adicionar/remover número é restrito a Sócio no servidor; o botão
 * some pra quem não é Sócio para não convidar a tentativa.
 */
export function ConnectionsManager() {
  const connections = useAppStore((s) => s.connections);
  const isSocio = useAuthStore((s) => s.profile?.role === "socio");
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listConnections().catch(() => {});
    const t = window.setInterval(() => api.listConnections().catch(() => {}), 5000);
    return () => window.clearInterval(t);
  }, []);

  const connect = async (id: string) => {
    try { await api.requestQrForConnection(id); } catch (e) { toast.error((e as Error).message); }
  };
  const disconnect = async (id: string) => {
    try { await api.logoutConnection(id); toast.success("Sessão encerrada."); } catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Remover o número "${label}"? A sessão será encerrada e não poderá ser desfeita.`)) return;
    try { await api.deleteConnection(id); toast.success("Número removido."); } catch (e) { toast.error((e as Error).message); }
  };
  const addConnection = async () => {
    const id = newId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const label = newLabel.trim();
    if (!id || !label) { toast.error("Preencha um nome e um identificador."); return; }
    setBusy(true);
    try {
      await api.createConnection(id, label);
      toast.success("Número adicionado — aguarde o QR aparecer.");
      setAdding(false); setNewId(""); setNewLabel("");
      await api.listConnections();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        {connections.map((c) => (
          <div key={c.id} className="glass-card p-6 flex flex-col items-center text-center min-h-[280px]">
            <div className="w-full flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">{c.label}</span>
              {isSocio && c.id !== "default" && (
                <button onClick={() => remove(c.id, c.label)} className="text-muted-foreground hover:text-destructive" title="Remover número">
                  <Trash className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {c.status === "ready" ? (
              <>
                <div className="w-14 h-14 rounded-full bg-success/15 flex items-center justify-center mb-3 animate-pulse-glow">
                  <CheckCircle2 className="w-7 h-7 text-success" />
                </div>
                <p className="text-sm text-muted-foreground mb-4">{c.me}</p>
                <Button variant="outline" size="sm" onClick={() => disconnect(c.id)}>
                  <LogOut className="w-3.5 h-3.5 mr-2" /> Desconectar
                </Button>
              </>
            ) : c.qr ? (
              <>
                <div className="bg-white p-3 rounded-xl shadow-elevated mb-3">
                  <img src={c.qr} alt={`QR Code — ${c.label}`} width={160} height={160} />
                </div>
                <p className="text-[11px] text-muted-foreground mb-2 max-w-[220px]">
                  WhatsApp → <strong className="text-foreground">Aparelhos conectados</strong> → Conectar um aparelho.
                </p>
                <Button variant="ghost" size="sm" onClick={() => connect(c.id)}>
                  <RefreshCw className="w-3.5 h-3.5 mr-2" /> Atualizar QR
                </Button>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
                  <LogOut className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  {c.status === "connecting" ? "Conectando…" : "Desconectado"}
                </p>
                <Button className="btn-glow" size="sm" onClick={() => connect(c.id)}>Conectar</Button>
              </>
            )}
          </div>
        ))}

        {isSocio && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="glass-card p-6 min-h-[280px] flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors border-2 border-dashed border-border"
          >
            <Plus className="w-6 h-6" />
            <span className="text-sm font-medium">Adicionar número</span>
          </button>
        )}

        {isSocio && adding && (
          <div className="glass-card p-6 min-h-[280px] flex flex-col justify-center gap-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Novo número</h4>
              <button onClick={() => setAdding(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <Input placeholder="Nome (ex: Comercial 2)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <Input placeholder="Identificador (ex: comercial-2)" value={newId} onChange={(e) => setNewId(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              Cada número exige sua própria instância do motor (Chromium) rodando — mais RAM na VPS. Ver aviso na doc de deploy.
            </p>
            <Button className="btn-glow" disabled={busy} onClick={addConnection}>Adicionar</Button>
          </div>
        )}
      </div>
    </div>
  );
}
