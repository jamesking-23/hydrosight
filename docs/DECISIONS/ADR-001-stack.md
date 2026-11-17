# ADR-001: Initial stack and architecture

Status: accepted (Phase 0). Date: 2026-11-17.

## Decision
Modular monolith, two deployables:

| Layer | Choice | Main alternative rejected for now |
|---|---|---|
| Web | Next.js (App Router), strict TypeScript, Tailwind v4 | Remix, SvelteKit |
| API / science / workers | Python 3.12, FastAPI, uv | Node-only (weaker science ecosystem) |
| Database | PostgreSQL + PostGIS (Supabase planned for Auth/RLS/Storage/Realtime in Phase 1) | Self-hosted Postgres + Keycloak |
| Time series | Native Postgres range partitions; TimescaleDB not required | InfluxDB, TimescaleDB |
| Maps | MapLibre GL JS + OSM-based tiles | Mapbox GL (fees, lock-in) |
| Device transport | HTTPS POST first; MQTT/LoRaWAN webhook in the IoT phase | MQTT from day one |
| Local dev / CI | Docker Compose, GitHub Actions, pnpm | n/a |

## Why
Lowest operational burden for a small team with limited budget, standard open formats (PostGIS, GeoJSON, OpenAPI, CAP 1.2) to avoid lock-in, and Python where the hydrology/ML ecosystem lives.

## Deliberately not used yet
Kubernetes, Kafka, Redis, microservices. Each needs a measured need and its own ADR.

## Deviations from the build prompt in Phase 0
- shadcn/ui is not initialised yet; it will be added with the first real UI screens (Phase 1) so components are added as needed rather than speculatively.
- `typescript` pinned to 5.9.x (not 7.x) because Next.js tooling support for the 7.x line is unverified.
