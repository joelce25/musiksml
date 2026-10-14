FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    nodejs \
    npm \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar el servidor generador de PO Tokens de YouTube para IPs de centros de datos (Railway)
RUN git clone --single-branch --branch 1.2.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /pot-provider && \
    cd /pot-provider/server && \
    npm install && \
    npx tsc

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -U --pre "yt-dlp[default]"

RUN playwright install --with-deps chromium

COPY . .
RUN mkdir -p downloads

# Iniciar en segundo plano el generador de PO Tokens (puerto 4416) y luego FastAPI
CMD ["sh", "-c", "node /pot-provider/server/build/main.js --port 4416 & uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]