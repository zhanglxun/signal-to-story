# syntax=docker/dockerfile:1
# Agent Harness Worker (Node + TypeScript). Build context: repo root.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save tsx
COPY supabase/functions/_shared ./supabase/functions/_shared
COPY workers/agent ./workers/agent
ENV NODE_ENV=production
CMD ["npx", "tsx", "workers/agent/main.ts"]
