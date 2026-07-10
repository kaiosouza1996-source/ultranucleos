# Deploy — VPS Hostinger (KVM1)

Guia de referência para colocar o Ultra Nucleos (CRM) + whatsapp-engine no ar
numa VPS, sem Railway e sem GitHub. Os comandos abaixo assumem Ubuntu/Debian.

## 1. Preparar a VPS

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx apache2-utils certbot python3-certbot-nginx nodejs npm git
sudo npm install -g pm2
```

## 2. Copiar o projeto (sem Git/GitHub)

Direto da sua máquina local para a VPS via `rsync` (ou `scp`):

```bash
rsync -avz --exclude node_modules --exclude .git --exclude dist \
  "./" usuario@SEU_IP_VPS:/opt/aurea-crm/
```

## 3. Build do frontend — **fazer localmente, não na VPS** (ver seção de
   segurança/capacidade: VPS de 4GB some gargalo com Chromium + build ao
   mesmo tempo)

```bash
npm install
npm run build
rsync -avz dist/ usuario@SEU_IP_VPS:/var/www/aurea-crm/dist/
```

## 4. whatsapp-engine na VPS

```bash
cd /opt/aurea-crm/whatsapp-engine
npm install --omit=dev
cp .env.example .env   # preencher ENGINE_API_KEY, DATA_ENCRYPTION_KEY, PHONE_HASH_SECRET, SUPABASE_JWT_SECRET
pm2 start server.js --name aurea-engine
pm2 save
pm2 startup   # segue as instruções impressas para o serviço subir sozinho no boot
```

O Chromium do Puppeteer é baixado automaticamente no `npm install` (ambiente
sem Docker). Se faltar alguma lib de sistema, instale:

```bash
sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libx11-xcb1 \
  libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
  libcups2 libdrm2 libxkbcommon0 fonts-liberation
```

## 5. Nginx — Basic Auth + proxy (item 1a) e HTTPS (item 4)

Ver `deploy/nginx/aurea-crm.conf` — instruções completas nos comentários do
próprio arquivo (`htpasswd`, `sites-enabled`, depois `certbot --nginx`).

## 6. Variáveis de ambiente do frontend

Antes do `npm run build` (passo 3), criar `.env` na raiz do projeto:

```
VITE_ENGINE_URL=https://SEU_DOMINIO/engine
VITE_ENGINE_API_KEY=<mesma chave gerada para ENGINE_API_KEY>
VITE_SUPABASE_URL=<URL do projeto Supabase>
VITE_SUPABASE_ANON_KEY=<anon/public key do Supabase>
VITE_DISABLE_MOCK=true
```

## 7. Swap (recomendado, VPS 4GB com Chromium)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## Checklist final antes de conectar o WhatsApp real

- [ ] Basic Auth do Nginx ativo (item 1a)
- [ ] HTTPS válido (Let's Encrypt) (item 4)
- [ ] `ENGINE_API_KEY` configurada nos dois lados, rate limit ativo (item 2)
- [ ] Login Supabase funcionando com os 3 papéis (item 1b)
- [ ] Criptografia + hash + audit log + archive testados (item 3)
- [ ] `/security-review` rodado e limpo (item 5)

Só depois disso tudo escanear o QR com o número de produção.
