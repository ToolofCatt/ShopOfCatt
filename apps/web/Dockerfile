# syntax=docker/dockerfile:1
# ==========================================================================
#  @webcatt/web — Next.js 15 (standalone output)
#  Build context PHẢI là thư mục gốc của monorepo:
#     docker build -f apps/web/Dockerfile -t webcatt-web .
#
#  LƯU Ý: các biến NEXT_PUBLIC_* được nhúng vào bundle LÚC BUILD.
#  Khi đổi tên miền API, phải build lại image với --build-arg tương ứng.
# ==========================================================================

# ---------- base: node + pnpm ----------
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
# Cài pnpm qua corepack; nếu corepack lỗi (sự cố chữ ký registry) thì dùng npm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate \
 || npm install -g pnpm@9.15.9
WORKDIR /repo

# ---------- deps ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @webcatt/web...

# ---------- builder ----------
FROM deps AS builder
COPY tsconfig.base.json turbo.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# URL trình duyệt dùng để gọi API — phải là địa chỉ máy khách truy cập được
ARG NEXT_PUBLIC_API_URL="http://localhost:3001/api"
ARG NEXT_PUBLIC_SITE_NAME="Catt Store"
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME

RUN pnpm --filter @webcatt/shared build \
 && pnpm --filter @webcatt/web build

# ---------- runner ----------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# Bản standalone đã gói sẵn node_modules cần thiết (kể cả @webcatt/shared)
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" > /dev/null || exit 1

CMD ["node", "apps/web/server.js"]
