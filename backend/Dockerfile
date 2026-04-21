# syntax=docker/dockerfile:1.7

FROM node:22-bookworm AS backend-builder
WORKDIR /workspace/backend
COPY package*.json ./
RUN npm ci
COPY . ./
RUN npx playwright install --with-deps chromium
RUN npm run build:binary:linux

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  libnss3 \
  libnspr4 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libdbus-1-3 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libasound2 \
  libatspi2.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxext6 \
  libxshmfence1 \
  libxrender1 \
  libxtst6 \
  libglib2.0-0 \
  libgtk-3-0 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libcairo2 \
  fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

COPY --from=backend-builder /workspace/backend/bin/matrix-api /app/matrix-api
COPY --from=backend-builder /root/.cache/ms-playwright /ms-playwright
RUN chmod +x /app/matrix-api && mkdir -p /app/data

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["/app/matrix-api"]
