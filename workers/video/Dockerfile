# syntax=docker/dockerfile:1
# Video Studio Worker (Python + FFmpeg). Build context: repo root.
# Only the worker's own (stdlib-level) requirements are installed, which covers the dry-run engine.
# For the real engine (--engine video-factory) also install workers/video/engine/requirements.txt.
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY workers/video/requirements.txt ./workers/video/requirements.txt
RUN pip install --no-cache-dir -r ./workers/video/requirements.txt
COPY workers/video ./workers/video
ENV PYTHONUNBUFFERED=1
CMD ["python3", "workers/video/worker.py"]
