# syntax=docker/dockerfile:1
# Agent Harness Worker (Node + TypeScript). Build context: repo root.
# Until R2 extracts core/, the worker imports sense-console/src/{harness,contracts} by relative path.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save tsx
COPY sense-console/src/harness ./sense-console/src/harness
COPY sense-console/src/contracts ./sense-console/src/contracts
COPY supabase/functions/_shared ./supabase/functions/_shared
COPY workers/agent ./workers/agent
ENV NODE_ENV=production
CMD ["npx", "tsx", "workers/agent/main.ts"]
