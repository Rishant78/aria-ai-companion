# ==============================================================================
# Aria AI Companion — Multi-Stage Production Dockerfile
# Builds React 19 Frontend & Serves via FastAPI / Uvicorn as a Single Unified Service
# Compatible with Google Cloud Run, Railway, Render, Fly.io, and Docker Compose
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Frontend Build
# ------------------------------------------------------------------------------
FROM node:22-slim AS frontend-builder
WORKDIR /app/frontend

# Install dependencies first for layer caching
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Copy frontend source code
COPY frontend/ ./

# Build optimized production distribution into /app/frontend/dist
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Runtime Service
# ------------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

# System environment settings
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    APP_HOST=0.0.0.0 \
    APP_PORT=8000 \
    STATIC_DIR=/app/frontend/dist

WORKDIR /app/backend

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application source
COPY backend/ ./

# Copy built frontend static bundle from frontend-builder stage
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose default port (overridden at runtime by Cloud Run / Railway / Render via $PORT)
EXPOSE 8000

# Start Uvicorn, dynamically binding to $PORT with shell expansion
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

