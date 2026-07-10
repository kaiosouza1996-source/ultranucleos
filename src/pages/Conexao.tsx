import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/appStore";
import { mockConnectWhatsApp, mockDisconnect, engineClient, MOCK_DISABLED } from "@/lib/engine";
import { ConnectionsManager } from "@/components/ConnectionsManager";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, RefreshCw, LogOut, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function Conexao() {
  const status = useAppStore((s) => s.status);
  const qr = useAppStore((s) => s.qr);
  const me = useAppStore((s) => s.me);
  const engineOnline = useAppStore((s) => s.engineOnline);
  const isSimulated = status === "ready" && !engineOnline;

  const handleConnect = () => {
    if (engineOnline) { engineClient.send({ type: "request-qr" }); return; }
    if (MOCK_DISABLED) { toast.error("Modo simulação desativado. Conecte o Sistema local (whatsapp-engine) para gerar um QR Code real."); return; }
    mockConnectWhatsApp();
  };
  const handleDisconnect = () => {
    if (engineOnline) engineClient.send({ type: "logout" });
    else mockDisconnect();
  };

  return (
    <>
      <AppHeader title="Conexão WhatsApp" subtitle="Autentique sua sessão escaneando o QR Code" />

      {engineOnline ? (
        <div className="space-y-6">
          <ConnectionsManager />
          <div className="glass-card p-6 animate-fade-in">
            <h3 className="font-semibold mb-3">Como funciona</h3>
            <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
              <li>Clique em "Conectar" (ou "Adicionar número", se for Sócio) para gerar um QR Code</li>
              <li>Escaneie no celular: WhatsApp → Aparelhos conectados → Conectar um aparelho</li>
              <li>A sessão fica salva — não é preciso escanear de novo a cada uso</li>
              <li>Em Disparos, escolha por qual número disparar cada campanha</li>
            </ol>
          </div>
        </div>
      ) : (
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="glass-card p-8 animate-scale-in flex flex-col items-center justify-center text-center min-h-[420px]">
          {status === "ready" ? (
            <>
              <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 ${isSimulated ? "bg-warning/15" : "bg-success/15 animate-pulse-glow"}`}>
                {isSimulated ? <AlertTriangle className="w-10 h-10 text-warning" /> : <CheckCircle2 className="w-10 h-10 text-success" />}
              </div>
              <h3 className="text-xl font-semibold">{isSimulated ? "Conexão SIMULADA (não é real)" : "Conectado com sucesso"}</h3>
              <p className="text-sm text-muted-foreground mt-1">{me}</p>
              {isSimulated && (
                <p className="text-xs text-warning mt-3 max-w-sm font-medium">
                  Nenhuma mensagem real está sendo enviada. Isso é apenas uma simulação da interface porque o Sistema local (whatsapp-engine) está
                  inacessível.
                </p>
              )}
              <Button variant="outline" className="mt-6" onClick={handleDisconnect}>
                <LogOut className="w-4 h-4 mr-2" /> Desconectar
              </Button>
            </>
          ) : qr ? (
            <>
              <div className="bg-white p-4 rounded-xl shadow-elevated">
                {/* O Sistema real manda o QR já pronto como imagem (data:image/png;base64,...).
                    O modo simulação manda um texto curto qualquer — nesse caso, gera o desenho
                    do QR no próprio navegador. Nunca tentar re-codificar a imagem como texto:
                    é gigante e estoura o limite de um QR code, quebrando a tela. */}
                {qr.startsWith("data:image") ? (
                  <img src={qr} alt="QR Code do WhatsApp" width={240} height={240} />
                ) : (
                  <QRCodeSVG value={qr} size={240} level="M" />
                )}
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
                Clique abaixo para iniciar uma nova sessão.
                {!engineOnline && (MOCK_DISABLED ? " Simulação desativada — conecte o Sistema local primeiro." : " (modo simulação ativo)")}
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
              <li>Inicie o Sistema local: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-xs">npm start</code> dentro de <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-xs">whatsapp-engine/</code></li>
              <li>O painel se conecta automaticamente em <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-xs">ws://localhost:8787</code></li>
              <li>Escaneie o QR Code uma única vez — a sessão fica salva</li>
              <li>Importe contatos, configure mensagens e inicie disparos</li>
            </ol>
          </div>

          <div className="glass-card p-6 animate-fade-in">
            <h3 className="font-semibold mb-3">Status do Sistema</h3>
            <div className="flex items-center gap-3 text-sm">
              <span className={`status-dot ${engineOnline ? "bg-success text-success" : "bg-warning text-warning"}`} />
              <span>{engineOnline ? "Sistema local conectado" : MOCK_DISABLED ? "Sistema offline — simulação desativada" : "Sistema offline — modo simulação ativo"}</span>
            </div>
            {!engineOnline && (
              <p className="text-xs text-muted-foreground mt-3">
                {MOCK_DISABLED
                  ? "VITE_DISABLE_MOCK está ativo: nenhuma conexão ou QR falso é gerado. Conecte o Sistema local (whatsapp-engine) para operar."
                  : "Você pode navegar e configurar tudo. Os disparos só atingem o WhatsApp real quando o Sistema local estiver rodando."}
              </p>
            )}
          </div>
        </div>
      </div>
      )}
    </>
  );
}
