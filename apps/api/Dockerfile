# syntax=docker/dockerfile:1
# ==========================================================================
#  @webcatt/api — NestJS + Prisma
#  Build context PHẢI là thư mục gốc của monorepo:
#     docker build -f apps/api/Dockerfile -t webcatt-api .
# ==========================================================================

# ---------- base: node + pnpm ----------
FROM node:22-alpine AS base
# openssl: bắt buộc cho Prisma query engine trên Alpine
RUN apk add --no-cache openssl
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true
# Cài pnpm qua corepack; nếu corepack lỗi (sự cố chữ ký registry) thì dùng npm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate \
 || npm install -g pnpm@9.15.9
WORKDIR /repo

# ---------- deps: cài đầy đủ dependencies để build ----------
FROM base AS deps
# Chỉ copy manifest trước để tận dụng cache layer khi source thay đổi
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# postinstall của api chạy `prisma generate` nên cần schema sẵn
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile --filter @webcatt/api...

# ---------- builder: biên dịch shared + api ----------
FROM deps AS builder
COPY tsconfig.base.json turbo.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @webcatt/shared build \
 && pnpm --filter @webcatt/api build
# Biên dịch riêng script seed sang JS thuần để image chạy được seed mà không cần tsx
RUN cd apps/api \
 && ./node_modules/.bin/tsc prisma/seed.ts \
      --outDir dist-seed \
      --module commonjs \
      --moduleResolution node \
      --target ES2022 \
      --esModuleInterop \
      --skipLibCheck

# ---------- prod-deps: chỉ dependencies chạy thật (bỏ nest-cli, tsx, embedded-postgres...) ----------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile --prod --filter @webcatt/api...

# ---------- runner: image cuối ----------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /repo

COPY --from=prod-deps --chown=node:node /repo /repo
COPY --from=builder --chown=node:node /repo/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /repo/apps/api/dist-seed ./apps/api/dist-seed
COPY --chown=node:node apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Chuẩn hóa line ending (phòng trường hợp clone trên Windows với CRLF)
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
WORKDIR /repo/apps/api
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
