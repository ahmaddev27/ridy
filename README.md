<p align="center">
  <img src="docs/logo.svg" alt="Reidey — Fleet Management" width="320">
</p>

<h1 align="center">Reidey</h1>

**Reidey** is a multi-tenant SaaS for German **Uber fleet operators**. It captures each company's **live Uber dispatch offer stream** and driver roster, routes offers to the right driver, and gives managers a real-time dashboard — plus driver earnings/performance, vehicles, and online presence pulled straight from Uber. Built as a Laravel REST API + Next.js dashboard, a Node dispatch-daemon that holds the RAMEN stream 24/7 through per-company **residential proxies**, and an **MV3 browser extension** that captures the session and supplier data from the manager's own browser (Uber blocks datacenter IPs).

### Highlights

- 🛰️ **Live offer capture** — RAMEN dispatch stream per company, offers routed to drivers by Uber UUID, with a **~5s accept window**.
- 🔔 **Near real-time** — app-wide new-offer popup + sound, silent polling (stale-while-revalidate).
- 🗺️ **Rich offer detail** — free map, road distance & price-per-km (Nominatim + OSRM).
- 👤 **Drivers** — roster, **earnings/hours/trips/acceptance** (GetEarnerMetrics), **online/offline** presence (GetDriverLiveLocation).
- 🚗 **Vehicles** — fleet cars synced from Uber (SearchVehicles) with driver assignment.
- 🏢 **Super-admin panel** — companies CRUD, per-company proxy, platform settings (live SMTP), customizable email templates, cross-tenant monitoring.
- 🌍 **i18n** — English / German / Arabic (RTL), black & white identity.

## Monorepo layout

```
Reidey/
├─ backend/              # Laravel 13 (PHP 8.4) REST API — multi-tenant, Sanctum
├─ frontend/             # Next.js 16 (React 19) dashboard SPA (en/de/ar)
├─ dispatch-daemon/      # Node service holding the RAMEN streams 24/7 (residential proxy)
├─ extension/            # MV3 browser extension — captures session + supplier data
├─ docs/                 # Project docs + Uber-console capture scripts + logo
├─ docker/               # Dockerfiles + nginx config
├─ docker-compose.yml    # Full stack
├─ .github/workflows/    # CI (lint + tests)
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
