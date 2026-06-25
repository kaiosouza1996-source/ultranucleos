# WhatsApp Sender — Motor Local v2

Plataforma local: **disparo + atendimento + CRM + mídias**, controlada pelo painel web.

> ⚠️ Use com responsabilidade. Disparos em massa violam os Termos do WhatsApp e podem resultar em banimento. Os controles anti-ban reduzem o risco mas não eliminam.

## Pré-requisitos

- **Node.js 20+** ([download](https://nodejs.org))
- WhatsApp instalado no celular

## Instalação

```bash
cd whatsapp-engine
npm install
```

A primeira instalação baixa o Chromium do Puppeteer (~150 MB).

## Iniciar

```bash
npm start
```

```
  ╔══════════════════════════════════════════════╗
  ║   WhatsApp Sender — motor v2 ATIVO           ║
  ║   ws://localhost:8787/ws                     ║
  ║   http://localhost:8787/status               ║
  ╚══════════════════════════════════════════════╝
```

Abra o painel → **Conexão** → escaneie o QR Code (Configurações do WhatsApp → Aparelhos conectados → Conectar um aparelho). A sessão fica salva em `.wwebjs_auth/`.

## O que o motor faz

| Recurso | Descrição |
|---|---|
| **Disparo em massa** | Fila com delays aleatórios, jitter, pausas longas, anti-duplicado |
| **Recebimento de mensagens** | Toda mensagem nova entra automaticamente na inbox como `pendente` |
| **Mídias completas** | Imagem, áudio, vídeo, documentos — salvos em `./media/` |
| **CRM + Tags** | Contatos, pipeline, múltiplas tags por contato |
| **Reconexão automática** | Detecta queda do WhatsApp e reconecta com backoff |
| **Heartbeat WebSocket** | Ping/pong + cleanup de conexões mortas a cada 30s |
| **Endpoint `/status`** | Retorna `ready | qr | connecting | disconnected` |

## Estrutura de dados

- `data.db` — SQLite (contatos, tags, conversas, mensagens, templates, logs)
- `.wwebjs_auth/` — sessão persistente do WhatsApp
- `media/` — arquivos enviados/recebidos

Para resetar tudo:

```bash
rm -rf .wwebjs_auth data.db media
```

## Solução de problemas

| Problema | Solução |
|---|---|
| Erro `libnss3` no Linux | `sudo apt install -y libnss3 libatk1.0-0 libgbm1 libasound2` |
| Porta 8787 ocupada | `PORT=9090 npm start` |
| Sessão expirou | Apague `.wwebjs_auth/` e escaneie novo QR |
| WhatsApp não recebe mídia | Verifique se a pasta `media/` tem permissão de escrita |

## Endpoints REST principais

```
GET  /status                          → estado atual
GET  /conversations[?status=pendente] → lista de conversas
GET  /conversations/:id/messages      → histórico
POST /conversations/:id/send          → enviar texto
POST /conversations/:id/send-media    → enviar arquivo (multipart)
POST /conversations/:id/assume        → assumir atendimento
GET  /contacts | POST /contacts       → CRM
GET  /tags     | POST /tags           → tags

# CRM Kanban (novo)
GET    /pipeline/stages               → etapas do pipeline
POST   /pipeline/stages               → criar/atualizar etapa
DELETE /pipeline/stages/:key          → remover etapa
POST   /contacts/:id/stage            → mover contato {to, user}
GET    /pipeline/history[?contactId=] → histórico de movimentações

# Campos personalizados (novo)
GET    /custom-fields                 → campos do contato
POST   /custom-fields                 → criar/atualizar campo
DELETE /custom-fields/:id             → remover campo
PUT    /contacts/:id/custom-data      → salvar valores
```

