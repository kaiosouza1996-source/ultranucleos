import { AppHeader } from "@/components/AppHeader";
import { GradientDivider } from "@/components/GradientDivider";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useAppStore,
  type CustomField,
  type CustomFieldType,
  type LogEntry,
  type PipelineStage,
} from "@/store/appStore";
import { Save, Shield, Trash, Plus, X, GripVertical, Briefcase, QrCode, ScrollText, CheckCircle2, RefreshCw, LogOut, Filter, Download, Info, ShieldCheck, KeyRound } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { mockConnectWhatsApp, mockDisconnect, engineClient, ENGINE_HTTP, updateAntiBanSettings } from "@/lib/engine";
import { useAuthStore } from "@/store/authStore";
import { authClient } from "@/lib/authClient";
import { AuditoriaSection } from "@/components/AuditoriaSection";
import { ConnectionsManager } from "@/components/ConnectionsManager";

export default function Configuracoes() {
  const settings = useAppStore((s) => s.settings);
  const update   = updateAntiBanSettings;
  const location = useLocation();
  const [tab, setTab] = useState("anti-ban");

  useEffect(() => {
    if (location.hash === "#crm") setTab("crm");
    else if (location.pathname === "/conexao") setTab("conexao");
    else if (location.pathname === "/logs") setTab("logs");
    else if (location.hash === "#Sistema") setTab("Sistema");
    else if (location.hash === "#auditoria") setTab("auditoria");
  }, [location.hash, location.pathname]);

  return (
    <>
      <AppHeader title="Configurações" subtitle="Conexão, anti-ban, CRM, logs e Sistema" />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="bg-muted/30 flex-wrap h-auto">
          <TabsTrigger value="conexao"><QrCode className="w-3.5 h-3.5 mr-1.5" /> Conexão</TabsTrigger>
          <TabsTrigger value="anti-ban"><Shield className="w-3.5 h-3.5 mr-1.5" /> Anti-ban</TabsTrigger>
          <TabsTrigger value="crm"><Briefcase className="w-3.5 h-3.5 mr-1.5" /> CRM</TabsTrigger>
          <TabsTrigger value="logs"><ScrollText className="w-3.5 h-3.5 mr-1.5" /> Logs</TabsTrigger>
          <TabsTrigger value="Sistema">Sistema</TabsTrigger>
          <TabsTrigger value="seguranca"><ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Segurança</TabsTrigger>
          <TabsTrigger value="auditoria"><ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Auditoria</TabsTrigger>
        </TabsList>

        <TabsContent value="seguranca" className="space-y-4">
          <SegurancaSection />
        </TabsContent>

        <TabsContent value="conexao" className="space-y-4">
          <ConexaoSection />
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <LogsSection />
        </TabsContent>

        {/* ─────────── Anti-ban ─────────── */}
        <TabsContent value="anti-ban" className="space-y-4">
          <div className="glass-card p-6 animate-fade-in space-y-5">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Controle anti-ban</h3>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              O disparo é <strong className="text-foreground">sequencial</strong>: o sistema envia <strong className="text-foreground">todas as partes do template para um cliente</strong> e só então aguarda o intervalo abaixo antes de iniciar o próximo. Passe o mouse no <Info className="inline w-3 h-3" /> para entender cada parâmetro.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <NumField
                label="Delay mínimo entre clientes (s)"
                value={settings.minDelay}
                onChange={(v) => update({ minDelay: v })}
                info="Tempo MÍNIMO (em segundos) que o sistema espera depois de terminar TODAS as mensagens de um cliente, antes de começar o próximo. Quanto maior, mais seguro contra banimento. Recomendado: 5s ou mais."
              />
              <NumField
                label="Delay máximo entre clientes (s)"
                value={settings.maxDelay}
                onChange={(v) => update({ maxDelay: v })}
                info="Tempo MÁXIMO entre clientes. O sistema sorteia um valor aleatório entre o mínimo e o máximo a cada envio, para simular comportamento humano. Recomendado: 15s ou mais."
              />
              <NumField
                label="Limite por execução"
                value={settings.perRunLimit}
                onChange={(v) => update({ perRunLimit: v })}
                info="Quantidade MÁXIMA de contatos disparados em uma única campanha. Mesmo que você selecione mais contatos, o sistema só processa este número por vez. Evita que disparos enormes saiam de controle."
              />
              <NumField
                label="Limite diário"
                value={settings.perDayLimit}
                onChange={(v) => update({ perDayLimit: v })}
                info="Teto total de mensagens enviadas em um único dia (somando todas as campanhas). Para contas novas use 50–100/dia; contas aquecidas suportam 300+."
              />
              <NumField
                label="Pausa longa a cada N clientes"
                value={settings.longPauseEvery}
                onChange={(v) => update({ longPauseEvery: v })}
                info="A cada quantos clientes o sistema faz uma PAUSA LONGA de descanso (simula uma pausa para café). Ex.: 25 = depois de cada 25 clientes enviados, pausa por X segundos antes de continuar."
              />
              <NumField
                label="Duração da pausa longa (s)"
                value={settings.longPauseSeconds}
                onChange={(v) => update({ longPauseSeconds: v })}
                info="Quanto tempo dura a pausa longa, em segundos. Quanto maior, mais o WhatsApp entende que há uma pessoa real por trás. Recomendado: 60–120s."
              />
            </div>
            <GradientDivider className="mb-2" />
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-sm font-medium">Evitar duplicados</div>
                  <div className="text-xs text-muted-foreground">Não reenviar para o mesmo contato no mesmo dia</div>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-primary transition-colors">
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Quando ativo, se um contato já recebeu mensagem neste mesmo dia, ele é ignorado automaticamente em novas campanhas — protege contra spam e reduz risco de bloqueio.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Switch checked={settings.avoidDuplicates} onCheckedChange={(v) => update({ avoidDuplicates: v })} />
            </div>
            <Button className="btn-glow w-full" onClick={() => toast.success("Configurações salvas")}>
              <Save className="w-4 h-4 mr-2" /> Salvar
            </Button>
          </div>
        </TabsContent>

        {/* ─────────── CRM ─────────── */}
        <TabsContent value="crm" className="space-y-4">
          <PipelineEditor />
          <CustomFieldsEditor />
        </TabsContent>

        {/* ─────────── Sistema + reset ─────────── */}
        <TabsContent value="Sistema" className="space-y-4">
          <SistemaSection />

          <div className="glass-card p-6 animate-fade-in border-destructive/30">
            <h3 className="font-semibold mb-2 text-destructive flex items-center gap-2">
              <Trash className="w-4 h-4" /> Zona de risco
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Limpa todos os dados salvos no navegador (contatos, templates, CRM e configurações).
            </p>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => {
                localStorage.removeItem("wa-sender-state-v2");
                window.location.reload();
              }}
            >
              Resetar dados locais
            </Button>
          </div>
        </TabsContent>

        {/* ─────────── Auditoria — todo mundo vê Em aberto/Finalizadas (só
            as próprias), Arquivadas e o audit log continuam só Sócio ─────────── */}
        <TabsContent value="auditoria" className="space-y-4">
          <AuditoriaSection />
        </TabsContent>
      </Tabs>
    </>
  );
}

// Paleta de cores prontas para as etapas do pipeline — o usuário nunca vê o
// código HSL bruto, só escolhe visualmente clicando na bolinha colorida.
const STAGE_COLOR_PALETTE = [
  "213 100% 60%", // azul
  "271 91% 65%",  // roxo
  "330 100% 70%", // rosa
  "142 71% 45%",  // verde
  "38 95% 55%",   // âmbar
  "0 84% 60%",    // vermelho
];

// ─────────────── Pipeline editor ───────────────
function PipelineEditor() {
  const stages       = useAppStore((s) => s.pipelineStages);
  const upsertStage  = useAppStore((s) => s.upsertStage);
  const removeStage  = useAppStore((s) => s.removeStage);
  const setStages    = useAppStore((s) => s.setPipelineStages);

  const [draft, setDraft] = useState({ label: "" });

  const cycleColor = (s: PipelineStage) => {
    const idx = STAGE_COLOR_PALETTE.indexOf(s.color);
    const next = STAGE_COLOR_PALETTE[(idx + 1) % STAGE_COLOR_PALETTE.length];
    upsertStage({ ...s, color: next });
  };

  const add = () => {
    const label = draft.label.trim();
    if (!label) return;
    const key = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "-");
    if (stages.some((s) => s.key === key)) {
      toast.error("Já existe uma etapa com esse nome.");
      return;
    }
    upsertStage({
      key, label, color: STAGE_COLOR_PALETTE[stages.length % STAGE_COLOR_PALETTE.length],
      order: stages.length,
    });
    setDraft({ label: "" });
    toast.success(`Etapa "${label}" criada`);
  };

  const move = (key: string, dir: -1 | 1) => {
    const idx = stages.findIndex((s) => s.key === key);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= stages.length) return;
    const next = [...stages];
    [next[idx].order, next[swap].order] = [next[swap].order, next[idx].order];
    setStages(next);
  };

  return (
    <div className="glass-card p-6 animate-fade-in">
      <div className="flex items-center gap-2 mb-3">
        <Briefcase className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">Etapas do pipeline</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Personalize as colunas que aparecem no Kanban do CRM.
      </p>

      <div className="space-y-2 mb-4">
        {stages.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border">
            <div className="flex flex-col">
              <button
                onClick={() => move(s.key, -1)}
                disabled={i === 0}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
              >▲</button>
              <button
                onClick={() => move(s.key, 1)}
                disabled={i === stages.length - 1}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
              >▼</button>
            </div>
            <GripVertical className="w-4 h-4 text-muted-foreground" />
            <button
              type="button"
              onClick={() => cycleColor(s)}
              title="Clique para trocar a cor"
              className="w-4 h-4 rounded-full shrink-0"
              style={{ background: `hsl(${s.color})`, boxShadow: `0 0 8px hsl(${s.color})` }}
            />
            <Input
              value={s.label}
              onChange={(e) => upsertStage({ ...s, label: e.target.value })}
              className="bg-input/60 flex-1"
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                if (stages.length <= 1) { toast.error("Deve haver pelo menos uma etapa."); return; }
                removeStage(s.key);
              }}
            >
              <X className="w-4 h-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      <GradientDivider className="mb-3" />
      <div className="flex items-center gap-2">
        <Input
          placeholder="Nome da nova etapa"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className="bg-input/60 flex-1"
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <Button className="btn-glow" onClick={add}>
          <Plus className="w-4 h-4 mr-1" /> Adicionar
        </Button>
      </div>
    </div>
  );
}

// ─────────────── Custom fields editor ───────────────
function CustomFieldsEditor() {
  const fields  = useAppStore((s) => s.customFields);
  const upsert  = useAppStore((s) => s.upsertCustomField);
  const remove  = useAppStore((s) => s.removeCustomField);

  const [draft, setDraft] = useState<{ label: string; type: CustomFieldType; options: string }>({
    label: "", type: "text", options: "",
  });

  const add = () => {
    const label = draft.label.trim();
    if (!label) return;
    const key = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "_");
    if (fields.some((f) => f.key === key)) {
      toast.error("Já existe um campo com esse nome.");
      return;
    }
    const f: CustomField = {
      id: crypto.randomUUID(),
      key, label,
      type: draft.type,
      options: draft.type === "select"
        ? draft.options.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
    };
    upsert(f);
    setDraft({ label: "", type: "text", options: "" });
    toast.success(`Campo "${label}" criado`);
  };

  return (
    <div className="glass-card p-6 animate-fade-in">
      <h3 className="font-semibold mb-1">Campos personalizados</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Adicione campos extras à ficha do contato (texto, número, data, seleção, checkbox).
      </p>

      <div className="space-y-2 mb-4">
        {fields.length === 0 && (
          <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg">
            Nenhum campo personalizado ainda.
          </div>
        )}
        {fields.map((f) => (
          <div key={f.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border">
            <Input
              value={f.label}
              onChange={(e) => upsert({ ...f, label: e.target.value })}
              className="bg-input/60 flex-1"
            />
            <select
              value={f.type}
              onChange={(e) => upsert({ ...f, type: e.target.value as CustomFieldType })}
              className="bg-input rounded px-3 py-2 text-sm border border-border w-32"
            >
              <option value="text">Texto</option>
              <option value="number">Número</option>
              <option value="date">Data</option>
              <option value="select">Seleção</option>
              <option value="checkbox">Checkbox</option>
            </select>
            {f.type === "select" && (
              <Input
                value={(f.options || []).join(", ")}
                onChange={(e) => upsert({
                  ...f,
                  options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })}
                placeholder="opção 1, opção 2"
                className="bg-input/60 flex-1"
              />
            )}
            <Button size="icon" variant="ghost" onClick={() => remove(f.id)}>
              <X className="w-4 h-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      <GradientDivider className="mb-3" />
      <div className="flex items-center gap-2">
        <Input
          placeholder="Nome do campo (ex: Aniversário)"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className="bg-input/60 flex-1"
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <select
          value={draft.type}
          onChange={(e) => setDraft({ ...draft, type: e.target.value as CustomFieldType })}
          className="bg-input rounded px-3 py-2 text-sm border border-border w-32"
        >
          <option value="text">Texto</option>
          <option value="number">Número</option>
          <option value="date">Data</option>
          <option value="select">Seleção</option>
          <option value="checkbox">Checkbox</option>
        </select>
        {draft.type === "select" && (
          <Input
            placeholder="opção 1, opção 2"
            value={draft.options}
            onChange={(e) => setDraft({ ...draft, options: e.target.value })}
            className="bg-input/60 flex-1"
          />
        )}
        <Button className="btn-glow" onClick={add}>
          <Plus className="w-4 h-4 mr-1" /> Adicionar
        </Button>
      </div>
    </div>
  );
}

// ─────────────── helpers ───────────────
function NumField({ label, value, onChange, info }: { label: string; value: number; onChange: (v: number) => void; info?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
        {info && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-primary transition-colors">
                <Info className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-relaxed">
              {info}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <Input
        type="number"
        min={0}
        className="bg-input/60 mt-1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}

// ─────────────── Conexão ───────────────
function ConexaoSection() {
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

  if (engineOnline) return <ConnectionsManager />;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="glass-card p-6 animate-scale-in flex flex-col items-center justify-center text-center min-h-[360px]">
        {status === "ready" ? (
          <>
            <div className="w-16 h-16 rounded-full bg-success/15 flex items-center justify-center mb-3 animate-pulse-glow">
              <CheckCircle2 className="w-8 h-8 text-success" />
            </div>
            <h3 className="text-lg font-semibold">Conectado</h3>
            <p className="text-sm text-muted-foreground mt-1">{me}</p>
            <Button variant="outline" className="mt-5" onClick={handleDisconnect}>
              <LogOut className="w-4 h-4 mr-2" /> Desconectar
            </Button>
          </>
        ) : qr ? (
          <>
            <div className="bg-white p-4 rounded-xl shadow-elevated">
              {/* QR real do Sistema já vem pronto como imagem — nunca re-codificar como texto (estoura o limite do QR e quebra a tela). Mock manda um texto curto, aí sim gera o desenho aqui. */}
              {qr.startsWith("data:image") ? (
                <img src={qr} alt="QR Code do WhatsApp" width={200} height={200} />
              ) : (
                <QRCodeSVG value={qr} size={200} level="M" />
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-3 max-w-xs">
              WhatsApp → <strong className="text-foreground">Aparelhos conectados</strong> → Conectar um aparelho.
            </p>
            <Button variant="ghost" className="mt-2 text-xs" onClick={handleConnect}>
              <RefreshCw className="w-3.5 h-3.5 mr-2" /> Atualizar QR
            </Button>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
              <LogOut className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">Desconectado</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {!engineOnline && "(modo simulação ativo)"}
            </p>
            <Button className="btn-glow mt-5" onClick={handleConnect}>Iniciar conexão</Button>
          </>
        )}
      </div>

      <div className="glass-card p-5 animate-fade-in">
        <h3 className="font-semibold mb-3">Status do Sistema</h3>
        <div className="flex items-center gap-3 text-sm mb-4">
          <span className={`status-dot ${engineOnline ? "bg-success text-success" : "bg-warning text-warning"}`} />
          <span>{engineOnline ? "Sistema conectado" : "Sistema offline — modo simulação"}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Escaneie o QR code uma única vez — a sessão do WhatsApp fica salva e sobrevive a reinícios do Sistema.
        </p>
      </div>
    </div>
  );
}

// ─────────────── Trocar senha (usuário logado define a própria senha) ───────────────
function TrocarSenhaCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!currentPassword || !newPassword) { toast.error("Preencha a senha atual e a nova senha."); return; }
    if (newPassword.length < 8) { toast.error("A nova senha precisa ter pelo menos 8 caracteres."); return; }
    if (newPassword !== confirmPassword) { toast.error("A confirmação não bate com a nova senha."); return; }
    setBusy(true);
    try {
      await authClient.changePassword(currentPassword, newPassword);
      toast.success("Senha alterada com sucesso.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (e) {
      toast.error((e as Error).message || "Não foi possível trocar a senha.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-card p-6 animate-fade-in">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">Alterar senha</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Defina uma senha pessoal só sua — ninguém mais no CRM tem acesso a ela.
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Senha atual</label>
          <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="bg-input/60" autoComplete="current-password" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Nova senha</label>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="bg-input/60" autoComplete="new-password" placeholder="Mínimo 8 caracteres" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Confirmar nova senha</label>
          <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="bg-input/60" autoComplete="new-password" />
        </div>
      </div>
      <Button className="btn-glow mt-4" disabled={busy} onClick={submit}>
        {busy ? "Salvando…" : "Salvar nova senha"}
      </Button>
    </div>
  );
}

// ─────────────── Segurança (MFA) ───────────────
function SegurancaSection() {
  const isSocio = useAuthStore((s) => s.profile?.role === "socio");
  const [enabled, setEnabled] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const { verified } = await authClient.mfaFactors();
    setEnabled(verified);
  };

  useEffect(() => { refresh(); }, []);

  const startEnroll = async () => {
    setBusy(true);
    try {
      const { qrCodeDataUrl, secret } = await authClient.mfaEnroll();
      setQrCode(qrCodeDataUrl);
      setSecret(secret);
      setEnrolling(true);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const confirmEnroll = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    try {
      await authClient.mfaEnrollConfirm(code);
      toast.success("Autenticação em duas etapas ativada.");
      setEnrolling(false); setQrCode(null); setSecret(null); setCode("");
      await refresh();
    } catch {
      toast.error("Código inválido — confira o app autenticador e tente de novo.");
    } finally { setBusy(false); }
  };

  const disable = async () => {
    if (!enabled) return;
    if (!window.confirm("Desativar a verificação em duas etapas?")) return;
    setBusy(true);
    try {
      await authClient.mfaUnenroll();
      toast.success("Verificação em duas etapas desativada.");
      await refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <TrocarSenhaCard />
      {isSocio && !enabled && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 text-warning text-xs px-3 py-2.5">
          Recomendado para o papel Sócio: ative a verificação em duas etapas para proteger o acesso a dados de clientes.
        </div>
      )}
      <div className="glass-card p-6 animate-fade-in">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Verificação em duas etapas (TOTP)</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Além da senha, exige um código de 6 dígitos gerado por um app autenticador (Google Authenticator, Authy, 1Password…) a cada login.
        </p>

        {!enrolling && (
          <div className="flex items-center gap-3">
            <span className={`status-dot ${enabled ? "bg-success text-success" : "bg-muted-foreground text-muted-foreground"}`} />
            <span className="text-sm">{enabled ? "Ativada" : "Desativada"}</span>
            <div className="ml-auto">
              {enabled ? (
                <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" disabled={busy} onClick={disable}>Desativar</Button>
              ) : (
                <Button className="btn-glow" disabled={busy} onClick={startEnroll}>Ativar</Button>
              )}
            </div>
          </div>
        )}

        {enrolling && qrCode && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="bg-white p-3 rounded-xl shadow-elevated shrink-0">
                <img src={qrCode} alt="QR Code MFA" width={160} height={160} />
              </div>
              <div className="text-xs text-muted-foreground space-y-2">
                <p>1. Escaneie este QR com seu app autenticador (ou digite a chave manualmente).</p>
                {secret && <p className="font-mono text-[11px] bg-muted/30 px-2 py-1 rounded break-all">{secret}</p>}
                <p>2. Digite abaixo o código de 6 dígitos gerado pelo app.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="bg-input/60 max-w-[140px] text-center tracking-[0.3em] font-mono"
              />
              <Button className="btn-glow" disabled={busy || code.length !== 6} onClick={confirmEnroll}>Confirmar</Button>
              <Button variant="ghost" onClick={() => { setEnrolling(false); setQrCode(null); setCode(""); }}>Cancelar</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────── Sistema ───────────────
function SistemaSection() {
  const engineOnline = useAppStore((s) => s.engineOnline);
  const status = useAppStore((s) => s.status);
  const me = useAppStore((s) => s.me);

  const statusLabel = status === "ready" && engineOnline ? `Conectado${me ? ` — ${me}` : ""}`
    : status === "qr" ? "Aguardando escaneio do QR"
    : status === "connecting" ? "Conectando…"
    : "Desconectado";

  return (
    <div className="space-y-4">
      <div className="glass-card p-6 animate-fade-in">
        <h3 className="font-semibold mb-4">Sistema</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Status</div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className={`status-dot ${engineOnline ? "bg-success text-success" : "bg-warning text-warning"}`} />
              {engineOnline ? "Conectado" : "Offline — modo simulação"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">WhatsApp</div>
            <div className="text-sm font-medium">{statusLabel}</div>
          </div>
        </div>
        <GradientDivider className="mt-4 mb-4" />
        <div>
          <div className="text-xs text-muted-foreground mb-1">Endereço do Sistema</div>
          <code className="text-xs px-2 py-1 rounded bg-muted text-foreground break-all">{ENGINE_HTTP}</code>
        </div>
      </div>
    </div>
  );
}

// ─────────────── Logs ───────────────
const levelStyles: Record<LogEntry["level"], string> = {
  success: "bg-success/15 text-success border-success/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
  warn: "bg-warning/15 text-warning border-warning/30",
  info: "bg-primary/15 text-primary border-primary/30",
};

function LogsSection() {
  const allLogs = useAppStore((s) => s.logs);
  const clear = useAppStore((s) => s.clearLogs);
  const profile = useAuthStore((s) => s.profile);
  const [filter, setFilter] = useState<"all" | LogEntry["level"]>("all");

  // Mesmo critério do Dashboard: feed por login, não compartilhado — Sócio
  // vê tudo (visão de equipe), os demais só o que fizeram + eventos de sistema.
  const logs = useMemo(() => {
    if (!profile || profile.role === "socio") return allLogs;
    return allLogs.filter((l) => !l.actorId || l.actorId === profile.id);
  }, [allLogs, profile]);

  const filtered = useMemo(() => filter === "all" ? logs : logs.filter((l) => l.level === filter), [logs, filter]);

  const exportCsv = () => {
    const header = "data,nivel,mensagem,contato\n";
    const rows = logs.map((l) => `"${new Date(l.ts).toISOString()}","${l.level}","${(l.message ?? "").replace(/"/g, '""')}","${l.contact ?? ""}"`).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `logs-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const filters: ("all" | LogEntry["level"])[] = ["all", "info", "success", "warn", "error"];
  const labels: Record<string, string> = { all: "Todos", info: "Info", success: "Sucesso", warn: "Aviso", error: "Erro" };

  return (
    <div className="glass-card p-5 animate-fade-in">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Filter className="w-4 h-4 text-muted-foreground" />
        {filters.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200
              ${filter === f ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`}
          >{labels[f]}</button>
        ))}
        <span className="text-xs text-muted-foreground ml-2">{logs.length} eventos</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv}><Download className="w-3.5 h-3.5 mr-2" /> CSV</Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={clear}><Trash className="w-3.5 h-3.5 mr-2" /> Limpar</Button>
        </div>
      </div>

      <div className="max-h-[600px] overflow-y-auto scrollbar-thin space-y-1.5">
        {filtered.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">Sem eventos para exibir.</div>
        ) : filtered.map((l) => (
          <div key={l.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-primary/5 transition-colors animate-slide-in">
            <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border ${levelStyles[l.level]} shrink-0`}>{l.level}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm">{l.message}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {new Date(l.ts).toLocaleString("pt-BR")} {l.contact && `• +${l.contact}`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
