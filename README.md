# DASHCAM

DASHCAM is a fleet-compliance SaaS for German Uber/Bolt fleet operators. It correlates telematics trips (Samsara) with platform trips (Uber/Bolt) to detect personal/private vehicle use under a strict "detect, don't surveil" model, in line with DSGVO. The platform is a Laravel REST API with a Next.js dashboard, runs queued ingestion/matching jobs on Horizon + Redis, and is hosted on Hetzner (Germany) for EU data residency. See [`docs/`](./docs) for the full project analysis and technical plan.

## Monorepo layout

```
DASHCAM/
├─ backend/              # Laravel 13 (PHP 8.4 dev / 8.3 CI) REST API
├─ frontend/             # Next.js 16 (React 19) dashboard SPA
├─ docs/                 # Project analysis + technical plan
├─ mockup/               # UI mockups
├─ docker/               # Dockerfiles + nginx config
│  ├─ backend.Dockerfile
│  ├─ frontend.Dockerfile
│  └─ nginx/default.conf
├─ docker-compose.yml    # Full stack: mysql, redis, backend, nginx, horizon, scheduler, frontend
├─ .github/workflows/    # CI (lint + tests for both packages)
├─ .env.example          # Root env keys for docker-compose
└─ README.md
```

## Prerequisites

- PHP 8.3+
- Node.js 22+
- Composer 2
- (Optional) Docker + Docker Compose, to run the full stack

## Databases

- **Local development** uses **sqlite** (`backend/database/database.sqlite`) — zero setup.
- **Docker Compose** runs **MySQL 8**, the production target. The `backend` service is preconfigured with `DB_CONNECTION=mysql`.

## Running the backend

Local (sqlite):

```bash
cd backend
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate
php artisan serve            # http://localhost:8000
```

Tests and code style:

```bash
cd backend
vendor/bin/pint --test       # code style
php artisan test             # PHPUnit (uses sqlite :memory:)
```

## Running the frontend

```bash
cd frontend
npm install
npm run dev                  # http://localhost:3000
```

## Running the full stack (Docker Compose)

```bash
cp .env.example .env         # fill in DB_* / APP_KEY / NEXT_PUBLIC_API_URL
docker compose up --build
```

Once up:

- API (via nginx): http://localhost:8080
- Frontend: http://localhost:3000

Compose services: `mysql`, `redis`, `backend` (PHP-FPM), `nginx`, `horizon`, `scheduler`, `frontend`.

## Documentation

Full design and roadmap live in [`docs/`](./docs) — start with `docs/01-project-analysis.md` and `docs/02-technical-plan.md`.
