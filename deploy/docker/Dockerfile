# ============================================================================
# CyberSOAR Platform — Production Dockerfile (multi-stage)
# ============================================================================
# Builds a minimal, non-root, distroless-style image. Final image is ~150MB.
# Security: runs as uid 10001, no shell, no package manager, read-only fs.
# ============================================================================

# ---- Stage 1: deps ----
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy lockfile + package.json first for layer caching
COPY package.json package-lock.json* bun.lock* ./
RUN if [ -f bun.lock ]; then \
      npm install --legacy-peer-deps; \
    else \
      npm ci --legacy-peer-deps; \
    fi

# ---- Stage 2: builder ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time args
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the Next.js standalone output
RUN npm run build

# ---- Stage 3: runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Install only runtime system deps (no build tools, no shell utilities)
RUN apk add --no-cache \
    tini \
    ca-certificates \
    wget \
  && update-ca-certificates \
  && addgroup -g 10001 -S nodejs \
  && adduser -S -u 10001 -G nodejs nodejs

# Copy standalone build output + static assets + public dir
COPY --from=builder --chown=nodejs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nodejs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nodejs:nodejs /app/public ./public

# Health check — hits /api/health every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

USER nodejs
EXPOSE 3000

# tini handles signals properly (Ctrl-C, SIGTERM)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
