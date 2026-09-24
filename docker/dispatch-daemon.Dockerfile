# syntax=docker/dockerfile:1
#
# Ridy dispatch daemon (Node) — holds the Uber RAMEN stream and forwards offers
# to the backend. Depends on undici (residential-proxy routing).

FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

# Install deps first for layer caching. `npm ci` installs exactly what
# package-lock.json pins (no caret ranges re-resolved on a cache miss), so a
# freshly published — possibly compromised — release can never slip into the
# process that holds every tenant's Uber session. --ignore-scripts: none of the
# deps need install scripts. If package.json changes, regenerate the lock with
# `npm install --package-lock-only` in dispatch-daemon/ (CI's `npm ci` fails on
# a mismatch before anything deploys).
COPY dispatch-daemon/package.json dispatch-daemon/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Only the source: a local .env or stray files never enter the image.
COPY dispatch-daemon/src ./src

# Unprivileged: the daemon only makes outbound HTTPS calls and writes nothing
# to disk.
USER node

# Runs the long-lived stream supervisor.
CMD ["node", "src/index.js"]
