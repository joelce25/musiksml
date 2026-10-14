FROM node:24-bookworm-slim AS provider
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates python3 make g++ pkg-config libcairo2-dev libpango1.0-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 2.0.2 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /pot-provider \
    && test "$(git -C /pot-provider rev-parse HEAD)" = 26475e9d3665b972c4aeb83b4dbaafcf64b88438
WORKDIR /pot-provider/server
RUN npm ci --no-audit --no-fund && npx tsc && npm prune --omit=dev
RUN npm install --prefix /opt/deno deno@2.9.6 && /opt/deno/node_modules/.bin/deno --version

FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 libcairo2 libpango-1.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=provider /usr/local/bin/node /usr/local/bin/node
COPY --from=provider /opt/deno/node_modules/deno/deno /usr/local/bin/deno
COPY --from=provider /pot-provider/server /pot-provider/server
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install --with-deps chromium
COPY . .
RUN mkdir -p downloads
CMD ["python", "scripts/start.py"]
