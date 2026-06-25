# UltraNúcleos — Deploy no Railway

Sistema completo de WhatsApp Sender com CRM, atendimento e disparos em massa.

---

## Estrutura

```
ultranucleos/          ← Frontend React (este repositório)
whatsapp-engine/       ← Backend Node.js (engine WhatsApp)
```

---

## Deploy no Railway — Passo a Passo

### 1. Engine (Backend) — primeiro

1. Acesse railway.app → **New Project** → **Deploy from GitHub repo**
2. Escolha o repositório `ultranucleos`
3. Clique em **Configure** → mude o **Root Directory** para `whatsapp-engine`
4. Após o deploy, copie a URL gerada (ex: `https://ultranucleos-engine-prod.up.railway.app`)

**Variáveis de ambiente** (Settings → Variables):
```
PORT=8787
```

### 2. Frontend (Painel Web)

1. Railway → **New Project** → mesmo repositório, root directory = `/` (raiz)
2. **Variáveis de ambiente:**
```
VITE_ENGINE_URL=https://SUA-URL-DO-ENGINE.up.railway.app
```

### 3. Acesso

Após ambos estarem no ar, acesse a URL do frontend no navegador.

---

## Desenvolvimento local

```bash
# Engine
cd whatsapp-engine && npm install && npm start

# Frontend (em outro terminal)
cp .env.example .env  # deixe VITE_ENGINE_URL vazio
npm install && npm run dev
```

---

## Bugs corrigidos

- Rotas /conexao e /logs apontavam para página errada
- /send-media agora aceita JSON base64 além de multipart
- /labels/apply adicionada ao engine
- URL do engine via variável VITE_ENGINE_URL
