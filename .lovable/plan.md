
# WhatsApp Sender — Painel SaaS + Motor Local

Sistema completo dividido em duas partes que conversam entre si:

1. **Painel Web (Lovable)** — interface moderna estilo dashboard executivo.
2. **Motor Local (Node.js)** — roda no seu PC, controla o WhatsApp Web via `whatsapp-web.js` (Puppeteer) e guarda tudo em SQLite. Entregue como pasta com `npm start`.

Os dois se comunicam por WebSocket em `ws://localhost:8787`. Sem nuvem, sem APIs pagas, sem custos recorrentes.

---

## Identidade visual

- Fundo: `linear-gradient(135deg, #0A0F1C, #0F2A44, #1B3F73)` com glow azul radial central e camada sutil de noise/blur.
- Paleta: azul profundo `#0F2A44`, destaque `#2D8CFF`, hover neon `#4DA3FF`, fundo `#0A0F1C`, texto `#EAF2FF` / secundário `#A8C1E8`.
- Tokens HSL no `index.css` + `tailwind.config.ts` (sem cores hardcoded nos componentes).
- Tipografia: Inter (Google Fonts), pesos 300/500/600.
- Cards com glass effect: `backdrop-blur`, borda 1px translúcida, raio 10px, sombra suave.
- Botões: gradiente azul, hover com `translateY(-2px)` + glow, transições 0.25s `ease-in-out`.
- Animações: fade-in/scale-in nos cards, hover-scale nos itens da sidebar, item ativo com barra lateral luminosa.

---

## Estrutura do painel (Lovable)

Sidebar fixa colapsável + área principal.

```text
┌────────────┬──────────────────────────────────────┐
│  LOGO      │  Header: status conexão • usuário    │
│            ├──────────────────────────────────────┤
│ Dashboard  │                                      │
│ Contatos   │            Conteúdo da rota          │
│ Disparos   │                                      │
│ Mensagens  │                                      │
│ Logs       │                                      │
│ Config.    │                                      │
└────────────┴──────────────────────────────────────┘
```

### Páginas

- **Dashboard** — cards com: status WhatsApp (verde/vermelho + ping), total de contatos, mensagens enviadas hoje, taxa de sucesso, fila atual. Mini gráfico de envios nos últimos 7 dias.
- **Conexão / QR Code** — card central que mostra o QR vindo do motor; troca para "Conectado como [nome]" quando autentica. Botão desconectar.
- **Importar Contatos** — dropzone CSV (`nome, telefone, tag`), preview em tabela com validação (duplicados marcados, números inválidos em vermelho), botão "Importar válidos".
- **Contatos** — tabela com busca, filtro por tag, edição inline, exclusão, criação de tags.
- **Mensagens (Templates)** — editor por tag, suporte a variáveis `{nome}`, preview ao vivo, salvar/duplicar/excluir.
- **Disparos** — seleciona tag(s) + template, mostra quantos contatos serão atingidos, configura: limite por execução, intervalo min/max (padrão 5–15s), limite diário, evitar repetidos. Botões Iniciar / Pausar / Retomar / Parar. Barra de progresso "23/100" + ETA.
- **Logs** — stream em tempo real (enviando / sucesso / erro) com cores, filtros, exportar CSV, histórico paginado.
- **Configurações** — porta do motor, tema, reset de sessão WhatsApp, limites globais anti-ban.

---

## Motor Local (entregue junto)

Pasta `whatsapp-engine/` contendo:

- `package.json` com `whatsapp-web.js`, `express`, `ws`, `better-sqlite3`.
- `server.js` — sobe HTTP + WebSocket na porta 8787, expõe eventos: `qr`, `ready`, `disconnected`, `progress`, `log`.
- `wa-client.js` — gerencia o cliente WhatsApp com `LocalAuth` (sessão persistente em `.wwebjs_auth/`).
- `queue.js` — fila sequencial com delay aleatório, jitter extra, simulação humana (digitando antes de enviar), pausa/retomada, controle diário.
- `db.js` — SQLite (`data.db`) com tabelas: `contacts`, `tags`, `templates`, `campaigns`, `messages`, `logs`, `settings`.
- `README.md` — passo a passo: instalar Node 20, `npm install`, `npm start`, abrir o painel.

### Anti-ban embutido

- Delay aleatório configurável (padrão 5–15s) com jitter adicional ±20%.
- Pausas longas a cada N envios (ex: 60–120s a cada 25).
- Limite diário por contato (não repete na mesma janela).
- Variação de "digitando..." antes de enviar.
- Para automaticamente se receber erro de rate/ban.

---

## Comunicação Painel ↔ Motor

- Painel tenta conectar em `ws://localhost:8787` ao abrir.
- Indicador no header: 🟢 Motor online / 🔴 Motor offline (com instrução para iniciar `npm start`).
- Mensagens WS tipadas: `{type: 'qr'|'ready'|'log'|'progress'|...}`.
- REST auxiliar: upload CSV, CRUD de contatos/templates, iniciar campanha.

---

## Detalhes técnicos

- React + Vite + Tailwind + shadcn/ui (já no template).
- React Router para as rotas; layout com `SidebarProvider` do shadcn.
- TanStack Query para chamadas REST ao motor; hook `useEngineSocket` para WS.
- Validação CSV com Zod; parse com `papaparse`.
- Validação de telefone: regex E.164 + normalização (remover espaços, parênteses, garantir DDI).
- Estado global leve com Zustand para status do motor e fila atual.
- Tema escuro fixo, todas as cores via tokens semânticos.

---

## Entregáveis

1. Painel completo rodando no preview do Lovable (com mock fallback quando o motor estiver offline, para você navegar a UI).
2. Pasta `whatsapp-engine/` no projeto, pronta para baixar e rodar com `npm install && npm start`.
3. CSV de exemplo + README com instruções passo a passo.

---

## Limitações honestas

- O preview do Lovable mostra a interface, mas o envio real só funciona depois que você rodar o motor local no seu PC (Node 20+).
- WhatsApp pode bloquear contas que disparam em massa — os controles anti-ban reduzem o risco mas não eliminam.
- `whatsapp-web.js` depende do WhatsApp Web; se o WhatsApp mudar a interface, pode quebrar e precisar atualizar a lib.
