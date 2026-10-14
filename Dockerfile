FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Dependencias del sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    nodejs \
    npm \
    git \
    curl \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Instalar Deno para los desafíos JavaScript de YouTube
ENV DENO_INSTALL=/opt/deno
ENV PATH="${DENO_INSTALL}/bin:${PATH}"

RUN curl -fsSL https://deno.land/install.sh -o /tmp/install-deno.sh \
    && sh /tmp/install-deno.sh \
    && rm /tmp/install-deno.sh \
    && deno --version

WORKDIR /app

# Servidor de PO Tokens
RUN git clone --single-branch --branch 1.2.2 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /pot-provider \
    && cd /pot-provider/server \
    && npm install \
    && npx tsc

# Dependencias Python y yt-dlp
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir -U --pre "yt-dlp[default]"

# Instalar Chromium para Playwright
RUN playwright install --with-deps chromium

# Copiar aplicación
COPY . .

RUN mkdir -p downloads

# Iniciar POT y FastAPI
CMD ["sh", "-c", "node /pot-provider/server/build/main.js --port 4416 & uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]