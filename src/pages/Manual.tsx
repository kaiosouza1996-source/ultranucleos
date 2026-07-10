import type { CSSProperties, ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { getGradientSlice, gradientSliceStyle } from "@/lib/gradient";
import {
  BrandBadge,
  ComplianceAlert,
  InfoBox,
  ManualCard,
  ManualSection,
  ObjectionBlock,
  QuoteBlock,
  ScriptBlock,
} from "@/components/manual/ManualBlocks";

/**
 * Manual Operacional — Áurea Investing
 * Conteúdo oficial integral, replicado sem cortes a partir do documento interno.
 * Somente leitura.
 */

const toc = [
  ["quem-somos", "01 · Quem Somos"],
  ["perfil", "02 · Perfil do Cliente"],
  ["valor", "03 · Proposta de Valor"],
  ["funcoes", "04 · Equipe & Fluxo"],
  ["rotina", "05 · Rotina Diária"],
  ["processos", "06 · Processos Internos"],
  ["abordagem", "07 · Como Abordar"],
  ["scripts", "08 · Scripts"],
  ["objecoes", "09 · Quebra de Objeções"],
  ["pos-conversao", "10 · Pós-Conversão"],
  ["frios", "11 · Leads Frios"],
  ["onboarding", "12 · Onboarding Genial"],
  ["compliance", "13 · Compliance"],
] as const;

function OrgNode({
  avatar,
  avatarClass,
  name,
  role,
  tasks,
  variant,
}: {
  avatar: string;
  avatarClass: string;
  name: string;
  role: string;
  tasks: string[];
  variant: "socio" | "colaborador";
}) {
  return (
    <div
      className={`rounded-2xl border p-6 flex-1 min-w-[200px] ${
        variant === "socio" ? "border-brandblue/40 bg-brandblue/5" : "border-brandpink/30 bg-brandpink/5"
      }`}
    >
      <div className={`w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center text-xl font-extrabold text-white ${avatarClass}`}>
        {avatar}
      </div>
      <div className="text-center font-bold text-[15px]">{name}</div>
      <div className="text-center text-brandblue-2 text-xs font-semibold tracking-wide mb-3">{role}</div>
      <div className="space-y-1">
        {tasks.map((t) => (
          <div key={t} className="text-xs text-muted-foreground flex gap-1.5 py-1 border-b border-border last:border-b-0">
            <span className="text-brandblue">›</span>{t}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="glass-card p-5 flex items-center gap-4">
      <div className="text-2xl shrink-0">{icon}</div>
      <div>
        <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
        <div className="text-[15px] font-bold">{value}</div>
      </div>
    </div>
  );
}

function ValorCard({
  icon, badge, title, children, extra, index, total,
}: {
  icon: string; badge: ReactNode; title: string; children: ReactNode; extra?: ReactNode;
  /** Posição na fileira de cards — fatia o gradiente de marca continuamente em vez de repeti-lo inteiro em cada card. */
  index: number; total: number;
}) {
  return (
    <div className="glass-card glass-card-hover p-7 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: getGradientSlice(index, total) }} />
      <div className="text-3xl mb-4">{icon}</div>
      <div className="mb-3">{badge}</div>
      <h3 className="text-[17px] font-bold mb-2.5">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
      {extra}
    </div>
  );
}

function ScenarioBox({ variant, label, children }: { variant: "a" | "b"; label: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-2xl p-5 text-sm leading-relaxed border ${
        variant === "a" ? "bg-brandblue/[0.07] border-brandblue/25" : "bg-success/5 border-success/20"
      }`}
    >
      <div className={`text-[11px] font-bold tracking-[2px] uppercase mb-2 ${variant === "a" ? "text-brandblue-2" : "text-success"}`}>{label}</div>
      {children}
    </div>
  );
}

function HandoffStep({ tone, title, children }: { tone: "blue" | "green" | "end"; title: string; children: ReactNode }) {
  const toneClass =
    tone === "blue" ? "border-l-brandblue bg-brandblue/5" : tone === "green" ? "border-l-success bg-success/5" : "border-l-brandblue/40 bg-gradient-to-br from-brandblue/8 to-card";
  return (
    <div className={`rounded-xl border border-border p-3.5 text-[13px] text-muted-foreground leading-relaxed border-l-[3px] ${toneClass}`}>
      <strong className="block text-foreground text-xs mb-1">{title}</strong>
      {children}
    </div>
  );
}

function RotinaBlock({ time, title, tag, children }: { time: string; title: string; tag?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="text-[11px] font-bold text-brandblue whitespace-nowrap min-w-[92px] pt-3.5 font-mono tracking-wide">{time}</div>
      <div className="rounded-lg border border-border bg-card p-3 flex-1 text-[13px] text-muted-foreground leading-relaxed">
        <strong className="block text-foreground text-xs mb-0.5">{title} {tag}</strong>
        {children}
      </div>
    </div>
  );
}

function ProcItem({ tone, title, children }: { tone: "blue" | "pink" | "green" | "warn"; title: string; children: ReactNode }) {
  const toneClass = { blue: "border-l-brandblue", pink: "border-l-brandpink", green: "border-l-success", warn: "border-l-warning" }[tone];
  return (
    <div className={`rounded-xl border border-border bg-card p-5 mb-2.5 border-l-[3px] ${toneClass}`}>
      <div className="text-sm font-bold mb-1.5">{title}</div>
      <div className="text-[13px] text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}

function ClassItem({ color, label, desc }: { color: string; label: string; desc: string }) {
  return (
    <div className="rounded-lg border border-border bg-card-2 p-3 text-center">
      <div className="w-2.5 h-2.5 rounded-full mx-auto mb-2" style={{ background: color }} />
      <div className="text-xs font-bold mb-1">{label}</div>
      <div className="text-[11px] text-muted-foreground leading-tight">{desc}</div>
    </div>
  );
}

function CadenciaItem({ day, children, index, total }: { day: string; children: ReactNode; index: number; total: number }) {
  return (
    <div className="rounded-xl border border-border bg-card-2 p-3.5 flex-1 min-w-[100px] text-center">
      <div className="text-[22px] font-extrabold text-gradient-brand mb-1.5" style={gradientSliceStyle(index, total) as CSSProperties}>{day}</div>
      <div className="text-[11px] text-muted-foreground leading-snug">{children}</div>
    </div>
  );
}

function SlaItem({ time, label, index, total }: { time: string; label: string; index: number; total: number }) {
  return (
    <div className="rounded-xl border border-border bg-card-2 p-4 text-center">
      <div className="text-2xl font-extrabold text-gradient-brand mb-1.5" style={gradientSliceStyle(index, total) as CSSProperties}>{time}</div>
      <div className="text-xs text-muted-foreground leading-snug">{label}</div>
    </div>
  );
}

export default function Manual() {
  return (
    <>
      <AppHeader title="Manual Operacional" subtitle="Documento interno · Confidencial · Áurea Investing" />

      <div className="flex flex-wrap gap-2 mb-8">
        {toc.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="text-xs font-medium px-3 py-1.5 rounded-full border border-border bg-card text-muted-foreground hover:text-foreground hover:border-brandblue/40 transition-colors"
          >
            {label}
          </a>
        ))}
      </div>

      <div className="glass-card p-8 sm:p-10">
        {/* 01 — Quem Somos */}
        <ManualSection id="quem-somos" index="01" title="Quem Somos">
          <div className="grid lg:grid-cols-2 gap-8 items-start">
            <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
              <p>
                A <strong className="text-foreground">Áurea Investing</strong> é um escritório de assessoria de investimentos credenciado à{" "}
                <strong className="text-foreground">Genial Investimentos</strong>, especializado em atender traders e investidores de renda variável.
              </p>
              <p>
                Somos uma empresa humanizada, com tecnologia de ponta, em crescimento acelerado — entregamos valor real ao cliente desde o primeiro contato.
              </p>
              <QuoteBlock>
                Mais do que orientar o seu patrimônio, nosso compromisso é traduzir o cenário econômico para a sua realidade. Sabemos que por trás de
                cada decisão existe um sonho, uma busca por segurança ou o futuro de uma família. Chegamos com a solidez da parceria com a Genial
                Investimentos e o olhar atento de quem acredita que investir com estratégia e clareza é o caminho para a liberdade. Nosso papel é estar
                ao seu lado, simplificando o caminho para que você tome as melhores decisões para a sua vida.
              </QuoteBlock>
            </div>
            <div className="space-y-4">
              <StatCard icon="📊" label="Especialidade" value="Traders · Renda Variável · B3" />
              <StatCard icon="🔗" label="Credenciada à" value="Genial Investimentos" />
              <StatCard icon="🛠️" label="Diferencial" value="Tecnologia + Humanização" />
              <StatCard icon="🎯" label="Foco" value="Mini índice · Mini dólar · Ações" />
            </div>
          </div>
        </ManualSection>

        {/* 02 — Perfil do Cliente */}
        <ManualSection id="perfil" index="02" title="Perfil do Cliente Ideal" subtitle="Entender o perfil é o primeiro passo para uma abordagem certeira.">
          <div className="grid md:grid-cols-3 gap-5 mb-6">
            <ValorCard index={0} total={3} icon="🔵" badge={<BrandBadge variant="blue" className="!bg-muted-foreground/10 !text-muted-foreground">Tier 1 · Entrada</BrandBadge>} title="A partir de R$1.000">
              Trader iniciante ou investidor em estruturação. Volume reduzido, alto potencial de crescimento. Atendimento padrão.
            </ValorCard>
            <ValorCard index={1} total={3} icon="⭐" badge={<BrandBadge variant="blue">Tier 2 · Ativo</BrandBadge>} title="A partir de R$5.000">
              Trader ativo em day trade ou swing trade. Opera WIN, WDO ou ações na B3. Busca resultado, consistência e suporte técnico.{" "}
              <span className="text-brandblue-2 font-semibold">Perfil principal da Áurea.</span>
            </ValorCard>
            <ValorCard index={2} total={3} icon="💎" badge={<BrandBadge variant="pink">Tier 3 · Alto Valor</BrandBadge>} title="Ticket elevado">
              Custódia relevante, múltiplos instrumentos ou perfil estratégico. Relacionamento direto com sócios.{" "}
              <span className="text-brandpink-2 font-semibold">Prioridade máxima.</span>
            </ValorCard>
          </div>
          <InfoBox>
            <strong>Como qualificar um lead:</strong> Opera ou quer operar renda variável? · Qual instrumento principal? · Já tem conta em alguma
            corretora? · Volume que opera? · Satisfeito com o suporte atual?
            <br />
            <br />
            <strong>Maior conversão:</strong> leads que já operam e estão insatisfeitos com a estrutura atual.
          </InfoBox>
        </ManualSection>

        {/* 03 — Proposta de Valor */}
        <ManualSection id="valor" index="03" title="Proposta de Valor" subtitle="Domine esses diferenciais. É o que separa a Áurea de qualquer outra assessoria.">
          <div className="grid md:grid-cols-2 gap-5">
            <ValorCard
              index={0} total={4}
              icon="📊"
              badge={<BrandBadge variant="green">Exclusivo · Gratuito</BrandBadge>}
              title="Dashboard Quantitativo Áurea"
              extra={
                <InfoBox className="mt-4 text-[13px]">
                  <strong>Como acessar:</strong> abrir conta na Genial sob nossa assessoria ou atualizar o código de assessor no app Genial. Gratuito
                  agora — futuramente será premium.
                </InfoBox>
              }
            >
              Ferramenta exclusiva disponível para todos os clientes da base. Análises quantitativas e dados que auxiliam nas decisões do trader —{" "}
              <span className="text-brandblue-2 font-semibold">algo que traders pagam caro para ter em outras plataformas.</span>
            </ValorCard>
            <ValorCard index={1} total={4} icon="🛠️" badge={<BrandBadge variant="blue">Tecnologia</BrandBadge>} title="Ecossistema de Ferramentas">
              Não entregamos apenas assessoria — entregamos um{" "}
              <span className="text-brandblue-2 font-semibold">ecossistema de ferramentas tecnológicas</span> desenvolvidas para o trader brasileiro.
              Recursos que facilitam a gestão das operações, o acompanhamento do mercado e a tomada de decisão.
            </ValorCard>
            <ValorCard index={2} total={4} icon="🤝" badge={<BrandBadge variant="orange">Diferencial</BrandBadge>} title="Suporte Humanizado">
              Não somos corretora. Somos assessores: acompanhamos, orientamos e estamos disponíveis. O cliente não é um número — é um parceiro.
              Relacionamento contínuo e presença ativa.
            </ValorCard>
            <ValorCard index={3} total={4} icon="📋" badge={<BrandBadge variant="pink">Via Genial Analisa</BrandBadge>} title="Carteiras Recomendadas">
              Recomendações fundamentadas dentro das normas regulatórias. Referenciamos as carteiras recomendadas da Genial Analisa para auxiliar o
              cliente nas suas decisões com responsabilidade e compliance.
            </ValorCard>
          </div>
        </ManualSection>

        {/* 04 — Equipe & Fluxo */}
        <ManualSection id="funcoes" index="04" title="Equipe & Fluxo" subtitle="Cada pessoa tem um papel claro e o fluxo entre elas é único e permanente.">
          <h3 className="text-[13px] font-bold text-brandblue-2 tracking-[2px] uppercase mb-5">Sócios</h3>
          <div className="flex flex-wrap gap-5 mb-8">
            <OrgNode variant="socio" avatar="K" avatarClass="bg-gradient-to-br from-brandblue to-[#6B60FF]" name="Kaio" role="IA & Automação"
              tasks={["Parcerias estratégicas", "Estratégia da empresa", "IA e automação de processos", "Captação direta"]} />
            <OrgNode variant="socio" avatar="J" avatarClass="bg-gradient-to-br from-[#4BFFA1] to-brandblue text-navy" name="Jociney" role="Tecnologia"
              tasks={["Parcerias estratégicas", "Estratégia da empresa", "Infraestrutura tecnológica", "Plataformas e sistemas"]} />
            <OrgNode variant="socio" avatar="Y" avatarClass="bg-gradient-to-br from-[#FFA04B] to-[#FF6B4B]" name="Yuri" role="Relacionamento Estratégico"
              tasks={["Parcerias estratégicas", "Estratégia da empresa", "Acesso a perfis específicos", "Networking de alto valor"]} />
          </div>

          <h3 className="text-[13px] font-bold text-brandpink-2 tracking-[2px] uppercase mb-5">Colaboradores</h3>
          <div className="flex flex-wrap gap-5 mb-8">
            <OrgNode variant="colaborador" avatar="N" avatarClass="bg-gradient-to-br from-brandpink to-brandpink-2" name="Nicolas" role="Comercial 2 · Relacionamento"
              tasks={[
                "Atende todos os prospects (quentes e frios)",
                "Qualifica, apresenta e converte",
                "Boleta e envia passos de ativação",
                "Prospecção ativa de frios",
                "Relacionamento mensal com a base",
                "Formação com Celene (1h/dia)",
              ]} />
            <OrgNode variant="colaborador" avatar="C" avatarClass="bg-gradient-to-br from-[#4BFFA1] to-brandblue text-navy" name="Celene" role="Back-office · Processos"
              tasks={[
                "Atendimento de todos que já estão na base",
                "Acompanha ativação de conta",
                "Confirma depósito e ativação de produtos",
                "Resolução de dúvidas e atualizações de dados",
                "Documentação e processos internos",
                "Formação de Nicolas (1h/dia)",
              ]} />
          </div>

          <div className="rounded-2xl border border-brandpink/25 bg-gradient-to-br from-brandpink/8 to-brandblue/6 p-8 text-center mb-10">
            <div className="text-[13px] font-bold tracking-[2px] uppercase text-brandpink mb-3">Princípio de Operação</div>
            <div className="text-lg font-bold leading-relaxed text-gradient-brand">
              "O que define o papel de cada um não é onde estão, mas o que priorizam dentro do atendimento."
            </div>
          </div>

          <h3 className="text-[15px] font-bold mb-2 mt-10">Como funciona o fluxo entre Nicolas e Celene</h3>
          <p className="text-muted-foreground text-[13px] mb-6">Dois cenários definem quem atende. Simples e sem sobreposição.</p>
          <div className="space-y-3 mb-8">
            <ScenarioBox variant="a" label="Cenário A — Prospect não está na base">
              Nicolas atende do início ao fim da conversão: qualifica, apresenta a proposta, fecha e boleta. Após a boletagem, envia os passos de
              ativação ao cliente e <strong className="text-brandblue-2">passa para Celene</strong>. A partir daí, Celene assume tudo.
            </ScenarioBox>
            <ScenarioBox variant="b" label="Cenário B — Cliente já está na base">
              Independentemente de quem recebeu o contato, qualquer cliente que já está na assessoria vai direto para Celene. Nicolas identifica e
              transfere imediatamente, sem criar atrito.
            </ScenarioBox>
          </div>

          <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 items-start mb-8">
            <div className="space-y-2">
              <div className="text-center pb-5">
                <div className="w-14 h-14 rounded-full mx-auto mb-2.5 flex items-center justify-center text-xl font-extrabold text-white bg-gradient-to-br from-brandpink to-brandpink-2">N</div>
                <div className="font-bold text-base">Nicolas</div>
                <div className="text-xs text-muted-foreground mt-0.5">Entrada · Conversão</div>
              </div>
              <HandoffStep tone="blue" title="1 · Contato inicial">Atende prospect: quente (veio pelo link) ou frio (prospecção ativa)</HandoffStep>
              <HandoffStep tone="blue" title="2 · Qualificação">Entende o cenário, o instrumento e o que o cliente precisa</HandoffStep>
              <HandoffStep tone="blue" title="3 · Apresentação">Proposta de valor, dashboard, diferencial da Áurea</HandoffStep>
              <HandoffStep tone="blue" title="4 · Conversão · Boleta">Fecha. Boleta (abertura de conta ou troca de assessoria). Envia os passos de ativação ao cliente</HandoffStep>
              <HandoffStep tone="end" title="✓ Handoff para Celene">Nicolas finaliza aqui. Celene assume o cliente a partir deste momento</HandoffStep>
            </div>
            <div className="flex md:flex-col items-center justify-center gap-1 md:pt-20 py-2">
              <div className="text-2xl text-brandblue leading-none">→</div>
              <div className="text-[10px] font-bold tracking-wide uppercase text-muted-foreground text-center max-w-[70px] leading-tight">após boleta</div>
            </div>
            <div className="space-y-2">
              <div className="text-center pb-5">
                <div className="w-14 h-14 rounded-full mx-auto mb-2.5 flex items-center justify-center text-xl font-extrabold text-navy bg-gradient-to-br from-[#4BFFA1] to-brandblue">C</div>
                <div className="font-bold text-base">Celene</div>
                <div className="text-xs text-muted-foreground mt-0.5">Permanência · Processos</div>
              </div>
              <HandoffStep tone="green" title="1 · Recebe o cliente boletado">Nicolas passa os dados. Celene entra em contato e assume o relacionamento</HandoffStep>
              <HandoffStep tone="green" title="2 · Acompanhamento da ativação">Garante que o cliente passou por todas as etapas que o próprio cliente precisa executar</HandoffStep>
              <HandoffStep tone="green" title="3 · Confirmação de depósito e produtos">Cliente depositou? Produtos essenciais ativados? Celene confirma</HandoffStep>
              <HandoffStep tone="green" title="4 · Atendimento contínuo + Sondagem">Suporte a qualquer demanda. Observa custódia em outros lugares. Registra e reporta</HandoffStep>
              <HandoffStep tone="green" title="5 · Relatório diário">Registra, organiza e envia nos canais internos</HandoffStep>
            </div>
          </div>

          <ComplianceAlert variant="warning" className="mb-4">
            ⚡ <strong>Nicolas pode acionar Celene para reforço na prospecção</strong> quando a carga estiver alta. Nesse caso Celene entra na lista e
            ajuda nas abordagens ativas.
          </ComplianceAlert>
          <InfoBox>
            <strong>Regra de ouro:</strong> o cliente não fica no limbo entre Nicolas e Celene. O handoff é único, acontece no momento da boletagem, e
            é permanente. A partir daí, qualquer demanda é com o back-office. Nicolas mantém relacionamento ativo (ligações mensais) mas não é ponto
            de suporte operacional.
          </InfoBox>
        </ManualSection>

        {/* 05 — Rotina Diária */}
        <ManualSection id="rotina" index="05" title="Rotina Diária" subtitle="Segunda a sexta · 09:00 às 18:00 · WhatsApp sempre aberto em paralelo em todos os blocos.">
          <InfoBox className="mb-3">
            <strong>Regra de prioridade (ambos):</strong> 1º quem chamou no dia anterior + quem respondeu após 18h · 2º quem chegou hoje — sem demorar,
            lead esfria rápido · 3º prospecção e demais tarefas
          </InfoBox>
          <div className="rounded-xl border border-brandpink/20 bg-brandpink/[0.07] px-5 py-4 text-[13px] text-brandpink-2 flex items-center gap-2.5 mb-8">
            <span className="font-extrabold">→</span> Para o detalhamento de como executar cada bloco, consulte a seção <strong>Processos Internos (06)</strong>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            <div className="space-y-2">
              <div className="flex items-center gap-3.5 mb-5 p-4 rounded-2xl bg-brandblue/10 border border-brandblue/30">
                <div className="w-12 h-12 rounded-full flex items-center justify-center font-extrabold bg-gradient-to-br from-brandpink to-brandpink-2 text-white">N</div>
                <div>
                  <div className="font-bold text-base">Nicolas</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Comercial 2 · Relacionamento</div>
                </div>
              </div>
              <RotinaBlock time="09:00–09:15" title="Classificação" tag={<BrandBadge variant="orange">Prioridade 1</BrandBadge>}>
                Lê todas as mensagens desde ontem. Classifica: quente ativo, quente pendente, aguardando follow-up
              </RotinaBlock>
              <RotinaBlock time="09:15–10:30" title="Atendimento prioritário" tag={<BrandBadge variant="pink">SLA 15 min</BrandBadge>}>
                Responde P1 (ontem + pós-18h) e P2 (chegou hoje). Sem deixar esfriar
              </RotinaBlock>
              <RotinaBlock time="10:30–12:00" title="Prospecção frios — 1º bloco" tag={<BrandBadge variant="blue">90 min</BrandBadge>}>
                Chama lista de frios. Primeiro contato, abertura e qualificação inicial. Registra cada contato
              </RotinaBlock>
              <RotinaBlock time="12:00–13:00" title="Almoço">Celene cobre o atendimento nesse período</RotinaBlock>
              <RotinaBlock time="13:00–14:00" title="Cobertura do atendimento">Celene no almoço — Nicolas cobre</RotinaBlock>
              <RotinaBlock time="14:00–15:00" title="Treinamento com Celene" tag={<BrandBadge variant="pink">1h</BrandBadge>}>
                Técnica comercial, tato com cliente, objeções e refinamento de abordagem
              </RotinaBlock>
              <RotinaBlock time="15:00–16:00" title="Conversão">Follow-up de negociações abertas. Fecha, boleta e passa para Celene</RotinaBlock>
              <RotinaBlock time="16:00–17:30" title="Prospecção frios — 2º bloco" tag={<BrandBadge variant="blue">90 min</BrandBadge>}>
                Segundo contato dos frios do bloco anterior + novos da lista
              </RotinaBlock>
              <RotinaBlock time="17:30–17:50" title="Última janela de conversão">Atende quem respondeu ao longo do dia</RotinaBlock>
              <RotinaBlock time="17:50–18:00" title="Organização" tag={<BrandBadge variant="green">Fechamento</BrandBadge>}>
                Atualiza status dos leads. Monta lista de prioridades para o dia seguinte
              </RotinaBlock>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-3.5 mb-5 p-4 rounded-2xl bg-brandpink/8 border border-brandpink/25">
                <div className="w-12 h-12 rounded-full flex items-center justify-center font-extrabold bg-gradient-to-br from-[#4BFFA1] to-brandblue text-navy">C</div>
                <div>
                  <div className="font-bold text-base">Celene</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Back-office · Processos</div>
                </div>
              </div>
              <RotinaBlock time="09:00–09:15" title="Checklist" tag={<BrandBadge variant="orange">Prioridade 1</BrandBadge>}>
                Pendências do dia anterior + pós-18h. Ativações em andamento, clientes que precisam de atenção
              </RotinaBlock>
              <RotinaBlock time="09:15–11:00" title="Atendimento prioritário + Sondagem" tag={<BrandBadge variant="pink">SLA 15 min</BrandBadge>}>
                Responde P1 e P2 da base. Observa: outra corretora, custódia externa — registra tudo
              </RotinaBlock>
              <RotinaBlock time="11:00–12:00" title="Acompanhamento de ativações">
                Clientes boletados por Nicolas: confirma que executaram os passos, resolvem dúvidas, valida depósito e produtos essenciais
              </RotinaBlock>
              <RotinaBlock time="12:00–13:00" title="Cobre Nicolas">Nicolas no almoço — Celene disponível para atendimento</RotinaBlock>
              <RotinaBlock time="13:00–14:00" title="Almoço">Nicolas cobre o atendimento nesse período</RotinaBlock>
              <RotinaBlock time="14:00–15:00" title="Treinamento com Nicolas" tag={<BrandBadge variant="pink">1h</BrandBadge>}>
                Repassa experiência de mercado, tato com cliente, o que falar, quando falar
              </RotinaBlock>
              <RotinaBlock time="15:00–16:00" title="Atendimento + Sondagem — 2ª janela">Segunda rodada de atendimento da base</RotinaBlock>
              <RotinaBlock time="16:00–17:00" title="Processos" tag={<BrandBadge variant="green">Documentação</BrandBadge>}>
                Atualização de registros, classificação de clientes, auditoria de fluxo
              </RotinaBlock>
              <RotinaBlock time="17:00–17:30" title="Atendimento — 3ª janela + Sondagem">Última rodada. Registra observações relevantes do dia</RotinaBlock>
              <RotinaBlock time="17:30–18:00" title="Relatório diário" tag={<BrandBadge variant="orange">Envio obrigatório</BrandBadge>}>
                Atendimentos, ativações, sondagens identificadas, gargalos e observações do dia — envia nos canais internos
              </RotinaBlock>
            </div>
          </div>
        </ManualSection>

        {/* 06 — Processos Internos */}
        <ManualSection id="processos" index="06" title="Processos Internos" subtitle="O detalhamento de como executar cada bloco da rotina. Consulte aqui sempre que tiver dúvida sobre o como fazer.">
          <div className="grid sm:grid-cols-3 gap-3 mb-8">
            <SlaItem index={0} total={3} time="15 min" label="Tempo máximo de resposta para lead que chega" />
            <SlaItem index={1} total={3} time="20 min" label="Limite se o atendimento em curso for extenso" />
            <SlaItem index={2} total={3} time="30 min" label="Teto para dúvida de cliente em processo de ativação" />
          </div>

          <div className="mb-10">
            <div className="text-base font-bold mb-4 flex items-center gap-2.5"><span>🔵</span> Nicolas — Como Executar</div>
            <ProcItem tone="blue" title="Abertura do dia">
              Abre o WhatsApp e lê todas as mensagens recebidas desde o dia anterior. Classifica antes de responder qualquer uma: quente ativo (respondeu
              e está em conversa), quente pendente (veio pelo link mas nunca iniciou), aguardando follow-up. Define a ordem de prioridade — do mais
              urgente ao menos urgente — e só então começa a responder.
            </ProcItem>
            <ProcItem tone="blue" title="Atendimento de quentes ativos">
              Retoma a conversa do ponto onde parou. Qualifica de forma natural se ainda não qualificou. Apresenta a proposta de valor e o dashboard
              antes de falar em qualquer processo. Conduz para a conversão sem pressão.
            </ProcItem>
            <ProcItem tone="blue" title="Ativação de quentes pendentes">
              O lead veio pelo link mas nunca iniciou contato. Nicolas vai até ele. Mensagem curta com gancho do dashboard. Se não responder, entra na
              cadência D1·D3·D7·D15. Registra cada tentativa.
            </ProcItem>
            <ProcItem tone="blue" title="Prospecção de frios">
              Trabalha a lista de contatos sem vínculo prévio. Usa o script de abertura fria. Após cada contato, registra o resultado. Controla os 4
              toques da cadência. Quando a carga estiver pesada, pode acionar Celene para reforço.
            </ProcItem>
            <ProcItem tone="blue" title="Identificação de cliente já na base">
              Se durante qualquer atendimento Nicolas identificar que a pessoa já é cliente da assessoria (já está na base), transfere imediatamente
              para Celene. Não cria atrito — apenas passa com contexto: quem é, o que precisa, status da conversa.
            </ProcItem>
            <ProcItem tone="blue" title="Boletagem e handoff">
              No momento da conversão: confirma os dados do cliente. Boleta (abertura de conta ou troca de assessoria). Envia ao cliente os passos de
              ativação. Aciona Celene com os dados do boletado: nome, perfil, instrumento que opera e urgência. A partir daí, Nicolas finaliza o
              atendimento deste cliente — Celene assume.
            </ProcItem>
            <ProcItem tone="blue" title="Relacionamento mensal com a base">
              Ligações ativas com toda a base. Roteiro: como estão as operações, satisfação com plataforma e ferramentas, sondagem sobre outras
              corretoras. Registra o relevante e repassa aos sócios quando identificar oportunidade de trazer mais volume ou patrimônio para a Genial.
            </ProcItem>
            <ProcItem tone="warn" title="Apoio ao back-office">
              Quando o volume de atendimentos de Celene estiver alto, Nicolas pode oferecer apoio pontual no atendimento geral. Isso é exceção — não
              rotina.
            </ProcItem>
          </div>

          <div>
            <div className="text-base font-bold mb-4 flex items-center gap-2.5"><span>🟢</span> Celene — Como Executar</div>
            <ProcItem tone="pink" title="Abertura do dia">
              Verifica pendências do dia anterior: ativações em andamento, clientes que pediram ajuda, sondagens que precisam ser reportadas.
              Classifica urgente do que pode correr no fluxo normal. Responde prioridade 1 e 2 antes de qualquer outra tarefa.
            </ProcItem>
            <ProcItem tone="pink" title="Recebimento do cliente boletado">
              Nicolas sinaliza a boletagem com os dados do cliente. Celene entra em contato, apresenta-se e informa o próximo passo. A partir daqui,
              ela é o ponto de contato definitivo deste cliente na Áurea.
            </ProcItem>
            <ProcItem tone="pink" title="Acompanhamento da ativação">
              Confirma que o cliente executou os passos enviados por Nicolas. Orienta onde tiver dúvida, auxilia em atualizações de dados se
              necessário. O cliente faz — Celene apoia. Quando houver problema técnico ou de cadastro, orienta ou aciona o suporte da Genial.
            </ProcItem>
            <ProcItem tone="pink" title="Confirmação de conta ativa">
              Valida que o cliente ativou a conta, realizou o primeiro depósito e ativou os produtos essenciais. Sem esses três pontos confirmados, o
              cliente não sai da fila de acompanhamento. Registra cada um ao confirmar.
            </ProcItem>
            <ProcItem tone="pink" title="Atendimento contínuo + Sondagem">
              Responde qualquer demanda dos clientes da base. Durante o atendimento, observa: mencionou outra corretora, outra plataforma, custódia
              fora? Pergunta natural: "Você concentra tudo na Genial ou divide em mais de uma plataforma?" Tudo relevante vai para o registro e para o
              relatório diário.
            </ProcItem>
            <ProcItem tone="pink" title="Classificação dos clientes">
              Mantém os clientes organizados por estágio para saber onde focar energia:
            </ProcItem>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mb-3">
              <ClassItem color="#4A8EFF" label="Novo" desc="Boletado, ativação em andamento" />
              <ClassItem color="#4BFFA1" label="Ativo" desc="Conta ativa, depositou, operando" />
              <ClassItem color="#8B9DC3" label="Dormido" desc="Sem sinal de vida há dias" />
              <ClassItem color="#FFB54B" label="Sondagem Pendente" desc="Ativo em outro lugar, aguarda ação dos sócios" />
              <ClassItem color="#FF6B6B" label="Em Risco" desc="Sinalizou insatisfação ou saída" />
            </div>
            <ProcItem tone="pink" title="Manutenção dos processos">
              Documenta e atualiza os fluxos internos. Quando perceber retrabalho ou gargalo, registra e leva aos sócios. É ela quem garante que o
              manual reflete a realidade operacional.
            </ProcItem>
            <ProcItem tone="warn" title="Apoio à prospecção">
              Quando Nicolas acionar, Celene entra na lista de prospecção e apoia as abordagens ativas.
            </ProcItem>
            <ProcItem tone="green" title="Relatório diário — envio obrigatório">
              17:30–18:00, Celene organiza e envia nos canais internos: atendimentos realizados, ativações (concluídas e pendentes), sondagens
              identificadas (cliente + o que tem fora + onde), gargalos operacionais e observações do dia. Esse reporte alimenta os sócios e o plano de
              relacionamento de Nicolas para o dia seguinte.
            </ProcItem>
          </div>
        </ManualSection>

        {/* 07 — Como Abordar */}
        <ManualSection id="abordagem" index="07" title="Como Abordar" subtitle="Tom, postura e o que nunca fazer. Somos assessores — não vendedores.">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-[15px] font-bold text-success mb-4">✓ O que fazer</h3>
              <div className="glass-card p-5 space-y-0.5">
                {[
                  "Cumprimentar pelo nome e identificar a origem",
                  "Qualificação natural, como conversa",
                  "Escutar mais do que falar nos primeiros 2 minutos",
                  "Ancorar valor antes de falar em processo ou taxa",
                  "Tom próximo, confiante, sem pressão",
                  "Dúvida de compliance → consultar sócios antes de responder",
                ].map((t) => (
                  <div key={t} className="text-sm text-muted-foreground py-2.5 border-b border-border last:border-b-0">{t}</div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-destructive mb-4">✗ O que nunca fazer</h3>
              <div className="glass-card p-5 space-y-0.5">
                {[
                  "Despejar informações antes de entender o perfil",
                  "Falar de taxas antes de estabelecer valor",
                  "Prometer retorno financeiro (vedado pela CVM)",
                  "Comparar negativamente corretoras concorrentes",
                  "Responder dúvidas de compliance sem checar com sócios",
                  "Recomendar compra ou venda direta de ativo",
                ].map((t) => (
                  <div key={t} className="text-sm text-muted-foreground py-2.5 border-b border-border last:border-b-0">{t}</div>
                ))}
              </div>
            </div>
          </div>
        </ManualSection>

        {/* 08 — Scripts */}
        <ManualSection id="scripts" index="08" title="Scripts" subtitle={<>Use como base. Adapte ao seu jeito. Substitua <em>[nome]</em> e <em>[seu nome]</em> ao utilizar.</>}>
          <div className="space-y-4">
            <ScriptBlock label="Abertura · Lead quente (veio pelo link)">
              "Olá [nome], tudo bem? Vi que você chegou pelo [parceiro/indicação]. Fico feliz que tenha chegado até a gente! Me conta um pouco — você
              já opera na bolsa ou está começando agora?"
            </ScriptBlock>
            <ScriptBlock label="Após qualificação · Apresentação">
              "Entendi bem o seu perfil. Aqui na Áurea Investing somos assessores credenciados à Genial Investimentos — uma das maiores corretoras do
              Brasil. O que nos diferencia não é só a plataforma, é o acompanhamento que damos e as ferramentas exclusivas que o nosso cliente tem
              acesso."
            </ScriptBlock>
            <ScriptBlock label="Ancoragem de valor · Dashboard">
              "Antes de te explicar como funciona a abertura de conta, quero que você entenda o que você vai ter acesso quando estiver na nossa base.
              Desenvolvemos um dashboard quantitativo exclusivo — isso é algo que traders pagam caro para ter em outras plataformas. Para os nossos
              clientes, é gratuito. Hoje."
            </ScriptBlock>
            <ScriptBlock label="Sondagem · Celene no atendimento">
              "Você concentra tudo na Genial ou divide em mais de uma plataforma?"
            </ScriptBlock>
            <ScriptBlock label="Pedido de indicação · Momento certo">
              "Você opera sozinho ou em grupo? Se puder nos indicar, será um prazer — isso ajuda muito nosso trabalho aqui. Pode contar comigo
              sempre."
            </ScriptBlock>
          </div>
        </ManualSection>

        {/* 09 — Quebra de Objeções */}
        <ManualSection id="objecoes" index="09" title="Quebra de Objeções" subtitle="Não é sobre rebater — é sobre entender e reencaminhar.">
          <div className="space-y-4">
            <ObjectionBlock question="Já tenho conta em outra corretora">
              Faz sentido. Muitos dos nossos clientes tinham conta em outros lugares antes de chegar até a gente. O que muda é o nível de suporte, as
              ferramentas e o acompanhamento que você passa a ter. Posso te mostrar a diferença?
            </ObjectionBlock>
            <ObjectionBlock question="Vou pensar">
              Claro, sem pressa. Posso te enviar mais informações para você avaliar com calma? O dashboard é gratuito agora, mas tem previsão de
              mudança — quem entra antes garante o benefício.
            </ObjectionBlock>
            <ObjectionBlock question="Não sei se é o momento">
              Entendo. Me fala o que te faria sentir que é o momento certo? Assim consigo te mostrar se a Áurea encaixa no que você precisa hoje.
            </ObjectionBlock>
            <ObjectionBlock question="Prefiro ficar onde estou">
              Sem problema. Mas me permite uma pergunta — você já tem acesso a ferramentas quantitativas para te ajudar nas operações? Porque isso é
              algo que a gente entrega gratuitamente para quem está na nossa base.
            </ObjectionBlock>
          </div>
        </ManualSection>

        {/* 10 — Pós-Conversão */}
        <ManualSection
          id="pos-conversao"
          index="10"
          title="Relacionamento Pós-Conversão"
          subtitle="O cliente convertido precisa sentir que tomou a decisão certa. Nicolas é responsável pelo relacionamento ativo da base."
        >
          <div className="grid md:grid-cols-2 gap-5 mb-8">
            <ManualCard>
              <div className="text-2xl mb-3">📅</div>
              <h3 className="font-bold mb-2">Primeiros 7 dias</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Check-in no dia seguinte ao onboarding. Garantir que está usando o dashboard. Compartilhar conteúdo relevante — sem pedir nada em troca.
              </p>
            </ManualCard>
            <ManualCard>
              <div className="text-2xl mb-3">📞</div>
              <h3 className="font-bold mb-2">Rotina Mensal · Ligações Ativas</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Contato por <strong className="text-foreground">ligação</strong>, não só mensagem. A ligação cria vínculo e abre conversas que
                mensagem não abre. Mínimo 1x/mês com toda a base.
              </p>
            </ManualCard>
          </div>

          <h3 className="text-[15px] font-bold text-brandblue-2 mb-4">O que sondar nas ligações</h3>
          <div className="glass-card p-5 mb-8 space-y-0.5">
            <div className="text-sm text-muted-foreground py-2.5 border-b border-border">Como estão as operações?</div>
            <div className="text-sm text-muted-foreground py-2.5 border-b border-border">Satisfeito com a plataforma e as ferramentas?</div>
            <div className="text-sm text-muted-foreground py-2.5 border-b border-border">
              <strong className="text-foreground">Está operando em alguma outra corretora também?</strong> — oportunidade de trazer mais volume para
              a Genial
            </div>
            <div className="text-sm text-muted-foreground py-2.5">Tem alguma dúvida ou dificuldade que podemos ajudar?</div>
          </div>

          <h3 className="text-[15px] font-bold text-brandblue-2 mb-4">Gatilhos de Contato Imediato</h3>
          <div className="grid sm:grid-cols-3 gap-5">
            <ManualCard>
              <div className="text-2xl mb-3">📉</div>
              <h3 className="font-bold mb-2">Volatilidade</h3>
              <p className="text-sm text-muted-foreground">Movimentos bruscos no IBOV ou dólar — momento de mostrar presença.</p>
            </ManualCard>
            <ManualCard>
              <div className="text-2xl mb-3">🏦</div>
              <h3 className="font-bold mb-2">COPOM / Banco Central</h3>
              <p className="text-sm text-muted-foreground">Decisão de juros ou comunicado relevante. Cliente quer saber o impacto.</p>
            </ManualCard>
            <ManualCard>
              <div className="text-2xl mb-3">📊</div>
              <h3 className="font-bold mb-2">Resultado de Empresa</h3>
              <p className="text-sm text-muted-foreground">Resultado relevante de ação que o cliente opera. Contexto antes de qualquer movimento.</p>
            </ManualCard>
          </div>
        </ManualSection>

        {/* 11 — Leads Frios */}
        <ManualSection id="frios" index="11" title="Leads Frios" subtitle="Lead frio = Nicolas vai buscar ativamente, sem vínculo prévio com a Áurea.">
          <ScriptBlock label="Abertura · Lead frio" className="mb-8">
            "Olá [nome], tudo bem? Aqui é [seu nome], da Áurea Investing. Somos assessores credenciados à Genial Investimentos, especializados em
            atender traders. Teria alguns minutos para eu te apresentar o que fazemos e as ferramentas que oferecemos gratuitamente para quem está na
            nossa base?"
          </ScriptBlock>
          <h3 className="text-[15px] font-bold text-brandblue-2 mb-5">Cadência de Follow-up</h3>
          <div className="flex flex-wrap gap-3">
            <CadenciaItem index={0} total={5} day="D1">Primeiro contato</CadenciaItem>
            <CadenciaItem index={1} total={5} day="D3">Toque leve — "fico à disposição"</CadenciaItem>
            <CadenciaItem index={2} total={5} day="D7">Conteúdo de valor — sem pitch</CadenciaItem>
            <CadenciaItem index={3} total={5} day="D15">Último toque — encerra o ciclo</CadenciaItem>
            <CadenciaItem index={4} total={5} day="D75">Reativação após 60 dias</CadenciaItem>
          </div>
        </ManualSection>

        {/* 12 — Onboarding Genial */}
        <ManualSection id="onboarding" index="12" title="Onboarding Genial" subtitle="Responsável: Back-office · Celene">
          <InfoBox className="mb-6">
            <strong>Importante:</strong> o cliente realiza os próprios cadastros e preenche sua própria documentação. O responsável pelo back-office
            não preenche nenhum campo pelo cliente — oferece apoio, esclarece dúvidas e orienta em cada etapa que gerar dificuldade.
          </InfoBox>
          <div className="grid md:grid-cols-2 gap-5 mb-5">
            <ManualCard>
              <div className="text-2xl mb-3">🔵</div>
              <h3 className="font-bold mb-2">Quando o cliente abre conta nova</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Nicolas boleta e envia ao cliente os passos de abertura de conta e atualização do código de assessoria na Genial — isso é parte do
                comercial e acontece antes do handoff.
                <br />
                <br />
                Celene entra em contato após o handoff para acompanhar se o cliente completou os passos, tirar dúvidas e validar o acesso.
              </p>
            </ManualCard>
            <ManualCard>
              <div className="text-2xl mb-3">🟢</div>
              <h3 className="font-bold mb-2">Quando o cliente já tem conta na Genial</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Nicolas orienta a atualização do código de assessoria via app — isso é comercial, acontece antes do handoff.
                <br />
                <br />
                Celene confirma que a atualização foi feita e que o cliente está vinculado corretamente à assessoria.
              </p>
            </ManualCard>
          </div>
          <div className="rounded-2xl border border-dashed border-brandblue/30 bg-brandblue/[0.04] p-6">
            <div className="text-xs font-bold text-brandblue-2 tracking-[2px] uppercase mb-3">A ser preenchido pelo responsável pelo back-office</div>
            <div className="space-y-2.5 text-[13px] text-muted-foreground leading-relaxed">
              <p>⚙️ <strong className="text-foreground">Etapas do cadastro onde o cliente tem mais dúvidas</strong></p>
              <p>⚙️ <strong className="text-foreground">Documentos exigidos e situações comuns (ex: CPF irregular)</strong></p>
              <p>⚙️ <strong className="text-foreground">Suitability: informar ao cliente que quanto mais disposto a riscos, mais arrojado o perfil — preenchimento é exclusivamente do cliente</strong></p>
              <p>⚙️ <strong className="text-foreground">Como validar que o acesso está ativo na plataforma</strong></p>
              <p>⚙️ <strong className="text-foreground">Como confirmar que o depósito foi realizado</strong></p>
              <p>⚙️ <strong className="text-foreground">Produtos essenciais a ativar após conta ativa</strong></p>
              <p>⚙️ <strong className="text-foreground">Prazos e SLA de cada etapa</strong></p>
            </div>
          </div>
        </ManualSection>

        {/* 13 — Compliance */}
        <ManualSection
          id="compliance"
          index="13"
          title="Compliance"
          subtitle="Regras inegociáveis. Qualquer violação pode comprometer a operação inteira — individual e coletivamente."
        >
          <h3 className="text-[13px] font-bold text-destructive tracking-[2px] uppercase mb-4">Proibições absolutas</h3>
          <div className="space-y-3 mb-8">
            <ComplianceAlert variant="danger"><strong>Rentabilidade:</strong> nunca prometer, sugerir ou insinuar retorno financeiro a clientes ou leads — verbal, por escrito ou em qualquer canal digital</ComplianceAlert>
            <ComplianceAlert variant="danger"><strong>Recomendação direta de ativo:</strong> nunca dizer "compra X" ou "vende Y" — referenciar sempre as carteiras recomendadas via Genial Analisa dentro das normas regulatórias</ComplianceAlert>
            <ComplianceAlert variant="danger"><strong>Denegrir concorrência:</strong> nunca falar negativamente de corretoras, assessorias ou profissionais do mercado pelo nome</ComplianceAlert>
            <ComplianceAlert variant="danger"><strong>Dados de clientes:</strong> nunca compartilhar, expor ou mencionar dados de clientes sem autorização expressa — incluindo em conversas internas por canais não seguros</ComplianceAlert>
            <ComplianceAlert variant="danger"><strong>Operações fora dos canais oficiais:</strong> nunca assinar, formalizar ou registrar qualquer operação fora dos sistemas e canais oficiais da Genial Investimentos</ComplianceAlert>
            <ComplianceAlert variant="danger"><strong>Informação privilegiada:</strong> nunca operar, orientar ou sugerir negociação com base em informações que ainda não são públicas (insider trading) — vedado pela CVM e sujeito a sanção penal</ComplianceAlert>
            <ComplianceAlert variant="danger"><strong>Publicidade com projeção:</strong> nunca publicar em redes sociais, grupos ou qualquer canal material que contenha promessa de ganho, projeção de retorno ou comparativos de rentabilidade sem aprovação prévia</ComplianceAlert>
          </div>

          <h3 className="text-[13px] font-bold text-warning tracking-[2px] uppercase mb-4">Atenção redobrada</h3>
          <div className="space-y-3 mb-8">
            <ComplianceAlert variant="warning"><strong>Suitability:</strong> o assessor não preenche nem induz o questionário de perfil do cliente. Pode apenas orientar: quanto mais disposto a correr riscos, mais arrojado será o perfil. O cliente pode refazer o suitability quantas vezes quiser — é decisão exclusivamente dele</ComplianceAlert>
            <ComplianceAlert variant="warning"><strong>Conflito de interesse:</strong> qualquer situação em que haja interesse próprio ou de terceiros envolvido em uma orientação ao cliente deve ser declarada e levada aos sócios imediatamente</ComplianceAlert>
            <ComplianceAlert variant="warning"><strong>Registro de comunicações:</strong> conversas com clientes que envolvam orientação, análise ou qualquer instrução devem ser mantidas e não deletadas — podem ser solicitadas por auditoria regulatória</ComplianceAlert>
            <ComplianceAlert variant="warning"><strong>Dúvida de compliance:</strong> parar. Não responder ao cliente. Consultar os sócios imediatamente. Uma resposta com 15 minutos de atraso não compromete o negócio. Uma resposta errada, pode.</ComplianceAlert>
          </div>

          <h3 className="text-[13px] font-bold text-success tracking-[2px] uppercase mb-4">Boas práticas obrigatórias</h3>
          <div className="space-y-3">
            <ComplianceAlert variant="success"><strong>Transparência total:</strong> sempre informar ao cliente que a Áurea é um escritório credenciado à Genial — não a própria corretora</ComplianceAlert>
            <ComplianceAlert variant="success"><strong>Identificação profissional:</strong> ao prospectar, sempre apresentar nome completo, empresa e o vínculo com a Genial Investimentos</ComplianceAlert>
            <ComplianceAlert variant="success"><strong>Esclarecimento de papel:</strong> quando questionado sobre regulação, licença ou autorização, explicar com clareza que a Áurea é assessoria credenciada e não gestora nem corretora</ComplianceAlert>
            <ComplianceAlert variant="success"><strong>Atualização regulatória:</strong> acompanhar comunicados da CVM, ANCORD e da Genial sobre mudanças regulatórias que afetem a operação. Qualquer dúvida sobre norma nova — consultar sócios antes de agir</ComplianceAlert>
          </div>
        </ManualSection>

        <div className="text-center text-xs text-muted-foreground pt-2">
          <strong className="text-foreground">Áurea Investing</strong> · Documento Interno · Confidencial · Credenciada à Genial Investimentos
        </div>
      </div>
    </>
  );
}
