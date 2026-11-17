# HydroSight

AI-assisted flood risk intelligence and early warning platform, starting in Uganda and East Africa.

> **Status: PROTOTYPE (Phase 0 foundations).** No live data, sensors or forecasts are connected.
> Nothing here is validated or approved for operational decisions.

## Run it

```bash
cp .env.example .env
docker compose up --build
```

- Web: http://localhost:3000 (health: `/health`, readiness: `/ready`)
- API: http://localhost:8000 (health: `/health`, readiness: `/ready`, docs: `/docs`)

### Without Docker

```bash
pnpm install
pnpm dev:web                              # web on :3000
cd services/api && uv sync && uv run uvicorn hydrosight_api.main:app --reload
```

### Checks

```bash
pnpm check        # web lint + typecheck + tests, API ruff + mypy + pytest
```

See `CLAUDE.md` for conventions and `docs/PROGRESS.md` for current state.
