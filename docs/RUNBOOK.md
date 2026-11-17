# Runbook

Stub. Expanded in Phase 10 (backups, restore drill, incident response).

## Local checks
- `curl localhost:3000/health` and `/ready`; `curl localhost:8000/health` and `/ready`.
- `/ready` returns HTTP 503 with an explicit reason when a dependency is down.
