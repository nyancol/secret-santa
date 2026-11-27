# ── Build stage ────────────────────────────────────────────────────────────────
# better-sqlite3 needs a compiler on slim images.
FROM node:26.12.1-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:26.12.1-slim AS runtime
WORKDIR /app

# Production defaults mirroring .env.dev / .env.sample variable names.
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/app.db \
    COOKIE_SECURE=true \
    DEV_LOGIN=false \
    TRUST_PROXY=true \
    APP_ORIGIN="" \
    OIDC_ISSUER="" \
    OIDC_CLIENT_ID="" \
    OIDC_CLIENT_SECRET="" \
    OIDC_REDIRECT_URI=""

RUN groupadd -r app && useradd -r -g app app \
  && mkdir -p /data /app/data && chown -R app:app /data /app
COPY package.json package-lock.json* ./
# better-sqlite3 ships no prebuilt binary for this Node major, so it compiles
# from source here too — same toolchain as the build stage, purged afterwards
# to keep the runtime image lean.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && (npm ci --omit=dev || npm install --omit=dev) \
  && apt-get purge -y --auto-remove python3 make g++ \
  && rm -rf /var/lib/apt/lists/* /root/.npm
COPY --from=build /app/dist ./dist
USER app
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
