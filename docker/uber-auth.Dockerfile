# Persistent per-company Uber session browser (uber-auth service).
#
# Runs a real headless Chromium per company via Playwright, so Uber keeps
# reissuing the signed tokens the dispatch daemon cannot refresh. Chromium is
# installed to match whatever Playwright version resolves, with its OS deps.
#
# NOTE: deploy is profile-gated in docker-compose.prod.yml ("browser"); it is NOT
# started by a normal deploy. Validate live on ONE consenting company first
# (chromium-in-container flags, the interactive login, the keep-warm) — see
# docs/23. Resource: each live context is heavy; size MAX_SESSIONS to the box RAM.
FROM node:20-bookworm

WORKDIR /app

# Install deps first for layer caching.
COPY uber-auth/package.json ./
RUN npm install --omit=dev

# Chromium + its system libraries, matched to the installed Playwright.
RUN npx playwright install --with-deps chromium

COPY uber-auth/src ./src

ENV STATE_DIR=/state
# Chromium's sandbox needs either kernel support or --no-sandbox in a container;
# the launcher honours NO_SANDBOX so the image stays simple. Harden later.
ENV NO_SANDBOX=1
VOLUME ["/state"]

# node --env-file is not used here: the environment comes from docker-compose.
CMD ["node", "src/server.js"]
