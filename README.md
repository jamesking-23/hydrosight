# HydroSight

AI-assisted flood risk intelligence and early warning platform, starting in Uganda and East Africa.

> **Status: in active development toward commercial launch.** Live data, sensors and forecasts
> are not connected yet (see `docs/PROGRESS.md`). Nothing is validated for operational
> decisions until a human admin promotes it with an evidence record.

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
