# syntax=docker/dockerfile:1
#
# DASHCAM frontend image (Next.js 16 / React 19).
# Used by the `frontend` Compose service.
#
# Build context is the repository root; this Dockerfile lives in ./docker.

FROM node:22-alpine

WORKDIR /app

# Install dependencies first so this layer is cached unless the lockfile or
# manifest changes. `npm ci` requires package-lock.json and gives reproducible
# installs.
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

# The API base URL is baked into the client bundle at build time, so it must be
# provided as a build arg (defaults to same-origin in production).
# Empty default = same-origin: the client calls relative /api paths, so the
# dashboard works on any domain Caddy serves. Pass an absolute URL to override.
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_REVERB_KEY=
ENV NEXT_PUBLIC_REVERB_KEY=$NEXT_PUBLIC_REVERB_KEY

# Copy the rest of the application and produce the optimized production build.
COPY frontend/ ./
RUN npm run build

# `next start` serves the production build on port 3000.
EXPOSE 3000

CMD ["npm", "start"]
