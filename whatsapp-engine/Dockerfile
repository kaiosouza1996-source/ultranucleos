# WhatsApp Sender — motor local (Puppeteer/whatsapp-web.js)
#
# Usa Dockerfile em vez de Nixpacks puro porque o Puppeteer/whatsapp-web.js
# precisa de um Chromium real + libs de sistema (libnss3, libatk, libgbm, fonts)
# para abrir headless. Nixpacks sozinho (só "npm install") não instala nada
# disso — o wa.initialize() falha silenciosamente ou trava e o QR nunca é gerado.
FROM node:20-bookworm-slim

# Chromium + dependências mínimas para rodar headless em produção.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libnss3 \
    libpango-1.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxkbcommon0 \
    libxrandr2 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Não baixar o Chromium embutido do Puppeteer — usar o do sistema (apt) acima.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 8787
CMD ["node", "server.js"]
