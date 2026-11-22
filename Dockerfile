# syntax=docker/dockerfile:1
# Yakyard on your own server: the Worker runs in workerd, the open-source runtime Cloudflare Workers is built on,
# with a local D1 database, R2 file storage and Durable Objects. Step by step: docs/DOCKER.md.
FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8787 \
    WRANGLER_SEND_METRICS=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    X_LOCAL_EXPLORER=false \
    X_LOCAL_OBSERVABILITY=false \
    CLOUDFLARE_CF_FETCH_ENABLED=false
WORKDIR /app

# Root certificates: workerd won't start without them, and outbound calls (phone notifications, transcripts) need them.
# Taken from the pinned Caddy image that docker-compose.yml also runs.
COPY --from=caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0 /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

COPY package.json package-lock.json ./
# The optional "ca" secret is only for building behind a proxy with its own certificate. Not needed otherwise.
RUN --mount=type=secret,id=ca,target=/run/secrets/ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/ca npm ci --include=dev --no-audit --no-fund \
 && npm cache clean --force \
 && rm -rf node_modules/@img/*musl* node_modules/@img/sharp-wasm32   # unused on this base image

COPY wrangler.jsonc schema.sql ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY docker/start.mjs ./docker/start.mjs

# Workers AI only runs on Cloudflare: drop its binding (transcripts use the REST API when a token is set).
# Stamp a version like npm run deploy does, so open apps offer the new version after an update.
RUN sed '/"ai":/d' wrangler.jsonc > wrangler.server.jsonc \
 && node -e "const fs=require('fs'),v=new Date().toISOString().replace(/\D/g,'').slice(0,12),f='public/index.html';fs.writeFileSync('public/version.json',JSON.stringify({v}));fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/(yakyard-version\" content=\")[^\"]+/,'\$1'+v).replace(/(app\.(css|js)\?v=)[^\"]+/g,'\$1'+v))" \
 && mkdir -p /data .wrangler && chown node:node /data && chmod 1777 .wrangler

USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/manifest.webmanifest').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "docker/start.mjs"]
