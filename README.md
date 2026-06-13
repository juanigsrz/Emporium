# Emporium

A modern web platform for board-game **math trades**, built for convention-scale events,
usability, transparency, and advanced trade flexibility.

Users run large **Trade Events** where they list physical copies of games they
own and define what they want; the system computes optimal trade cycles.
Browsing happens at the **canonical game level** (BoardGameGeek game), with
individual user copies grouped underneath.

## Tech stack

**Backend** — Django 5.2 + Django REST Framework, dj-rest-auth + django-allauth
(token auth, OAuth-ready), django-filter, drf-spectacular (OpenAPI 3), Celery
(eager mode without a broker), Channels-ready for WebSocket push. SQLite for v1,
swappable to Postgres via settings.

**Frontend** — React 18 + Vite + TypeScript, Tailwind CSS, React Router v6,
TanStack Query, axios, @dnd-kit (drag-and-drop want-list builder),
react-hook-form + zod, zustand.

## Getting started

### Backend

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

API docs (OpenAPI) are served by drf-spectacular once the server is running.

Seed a demo event:

```bash
python manage.py seed_test_event
```

Run the tests:

```bash
python manage.py test
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies to the Django API. Point it at your backend via the
configured API base URL.

## Layout

```
backend/          Django project (bgtrade) + apps:
  accounts/       users, profiles, BGG linking
  bgg/            BoardGameGeek sync + CSV import
  catalog/        canonical games
  copies/         per-user game copies (listings)
  events/         trade events + lifecycle
  matching/       solver integration + match results
  trades/         offer/want groups, wishes, cycles
  notifications/  user notifications
frontend/         React + Vite SPA
docs/             DESIGN.md (master design) + specs/plans
```