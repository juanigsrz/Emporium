# syntax=docker/dockerfile:1

# --- Stage 1: build the Vite SPA ---
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_BASE=/api
RUN npm run build

# --- Stage 2: Python runtime ---
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DJANGO_SETTINGS_MODULE=bgtrade.settings
WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
# Bring in the built SPA so collectstatic gathers it.
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Collect static at build time (no DB needed; uses the default dev SECRET_KEY).
RUN python backend/manage.py collectstatic --noinput

EXPOSE 8000
CMD ["sh", "-c", "gunicorn bgtrade.wsgi --chdir backend --bind 0.0.0.0:${PORT:-8000}"]
