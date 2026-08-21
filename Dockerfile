FROM node:24-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src

RUN npx prisma generate \
  && npm run build \
  && npm prune --omit=dev \
  && npm install prisma@6.19.3 --omit=dev --no-save

FROM node:24-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system palai \
  && useradd --system --gid palai --home-dir /app palai

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
COPY docker-entrypoint.sh ./

RUN sed -i 's/\r$//' docker-entrypoint.sh \
  && chmod +x docker-entrypoint.sh \
  && chown -R palai:palai /app

USER palai

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
