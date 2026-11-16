# syntax=docker/dockerfile:1

# --- 1. Web Console (static Vite SPA + Nginx) ---
FROM node:22-alpine AS web-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_PUBLISHABLE_KEY=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
RUN npm run build

FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /app/dist /usr/share/nginx/html
EXPOSE 80

# --- 2. Agent Harness Worker (Node + TypeScript) ---
FROM node:22-alpine AS agent-worker
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save tsx
COPY tsconfig.json tsconfig.worker.json ./
COPY src/contracts ./src/contracts
COPY adapters ./adapters
COPY workers/agent ./workers/agent
ENV NODE_ENV=production
CMD ["npx", "tsx", "workers/agent/main.ts"]

# --- 3. Video Studio Worker (Python + FFmpeg) ---
FROM python:3.12-slim AS video-worker
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY workers/video/requirements.txt ./workers/video/requirements.txt
RUN pip install --no-cache-dir -r ./workers/video/requirements.txt
COPY workers/video ./workers/video
ENV PYTHONUNBUFFERED=1
CMD ["python3", "workers/video/worker.py"]
