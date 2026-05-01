import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/appStore";
import { mockConnectWhatsApp, mockDisconnect, engineClient } from "@/lib/engine";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, RefreshCw, LogOut } from "lucide-react";

export default function Conexao() {
  const status = useAppStore((s) => s.status);
  const qr = useAppStore((s) => s.qr);
  const me = useAppStore((s) => s.me);
  const engineOnline = useAppStore((s) => s.engineOnline);

  const handleConnect = () => {
    if (engineOnline) engineClient.send({ type: "request-qr" });
    else mockConnectWhatsApp();
  };
  const handleDisconnect = () => {
    if (engineOnline) engineClient.send({ type: "logout" });
    else mockDisconnect();
  };

  return (
    <>
      <AppHeader title="Conexão WhatsApp" subtitle="Autentique sua sessão escaneando o QR Code" />

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="glass-card p-8 animate-scale-in flex flex-col items-center justify-center text-center min-h-[420px]">
          {status === "ready" ? (
            <>
              <div className="w-20 h-20 rounded-full bg-success/15 flex items-center justify-center mb-4 animate-pulse-glow">
                <CheckCircle2 className="w-10 h-10 text-success" />
              </div>
              <h3 className="text-xl font-semibold">Conectado com sucesso</h3>
              <p className="text-sm text-muted-foreground mt-1">{me}</p>
              <Button variant="outline" className="mt-6" onClick={handleDisconnect}>
                <LogOut className="w-4 h-4 mr-2" /> Desconectar
              </Button>
            </>
          ) : qr ? (
            <>
              <div className="bg-white p-4 rounded-xl shadow-elevated">
                <QRCodeSVG value={qr} size={240} level="M" />
              </div>
              <p className="text-sm text-muted-foreground mt-4 max-w-xs">
                Abra o WhatsApp no celular → <strong className="text-foreground">Aparelhos conectados</strong> → Conectar um aparelho.
              </p>
              <Button variant="ghost" className="mt-3 text-xs" onClick={handleConnect}>
                <RefreshCw className="w-3.5 h-3.5 mr-2" /> Atualizar QR
              </Button>
            </>
          ) : (
            <>
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-4">
                <LogOut className="w-10 h-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold">WhatsApp desconectado</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Clique abaixo para iniciar uma nova sessão. {!engineOnline && "(modo simulação ativo)"}
              </p>
              <Button className="btn-glow mt-6" onClick={handleConnect}>
                Iniciar conexão
              </Button>
            </>
          )}
        </div>

        <div className="space-y-4">
          <div className="glass-card p-6 animate-fade-in">
            <h3 className="font-semibold mb-3">Como funciona</h3>
            <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
              <li>Inicie o motor local: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-xs">npm start</code> dentro de <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-xs">whatsapp-engine/</code></li>
              <li>O painel se conecta automaticamente em <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-xs">ws://localhost:8787</code></li>
              <li>Escaneie o QR Code uma única vez — a sessão fica salva</li>
              <li>Importe contatos, configure mensagens e inicie disparos</li>
            </ol>
          </div>

          <div className="glass-card p-6 animate-fade-in">
            <h3 className="font-semibold mb-3">Status do motor</h3>
            <div className="flex items-center gap-3 text-sm">
              <span className={`status-dot ${engineOnline ? "bg-success text-success" : "bg-warning text-warning"}`} />
              <span>{engineOnline ? "Conectado em ws://localhost:8787" : "Motor offline — modo simulação ativo"}</span>
            </div>
            {!engineOnline && (
              <p className="text-xs text-muted-foreground mt-3">
                Você pode navegar e configurar tudo. Os disparos só atingem o WhatsApp real quando o motor local estiver rodando.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
