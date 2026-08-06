# syntax=docker/dockerfile:1
#
# Ridy dispatch daemon (Node) — holds the Uber RAMEN stream and forwards offers
# to the backend. No external dependencies, so no install step is needed.

FROM node:22-alpine

WORKDIR /app

COPY dispatch-daemon/ ./

# Runs the long-lived stream supervisor.
CMD ["node", "src/index.js"]
