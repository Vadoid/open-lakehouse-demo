# syntax=docker/dockerfile:1.6
# Multi-stage Next.js build → minimal runtime via standalone output.
#
# Layer order is deliberate: dependency install is its own stage keyed only on
# package.json + package-lock.json, so the ~400MB node_modules layer is reused
# across deploys and only re-runs when the lockfile changes. Source edits bust
# the builder stage's `npm run build` but NOT the deps install.
#
# Built through the kreuzwerker/docker Terraform provider, which uses the
# CLASSIC Docker build API (not BuildKit) — so no `RUN --mount=type=cache`
# here; it would fail the provider build. Layer caching is the mechanism.

FROM node:20-alpine AS deps
WORKDIR /app
# Copy the lockfile too so `npm ci` installs it verbatim (deterministic, skips
# full dependency-tree re-resolution). `npm install` with only package.json
# re-resolved the whole tree on every build.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
