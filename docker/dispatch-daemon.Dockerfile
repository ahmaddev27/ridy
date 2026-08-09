# syntax=docker/dockerfile:1
#
# Ridy dispatch daemon (Node) — holds the Uber RAMEN stream and forwards offers
# to the backend. Depends on undici (residential-proxy routing).

FROM node:22-alpine

WORKDIR /app

# Install deps first for layer caching.
COPY dispatch-daemon/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY dispatch-daemon/ ./

# Runs the long-lived stream supervisor.
CMD ["node", "src/index.js"]
