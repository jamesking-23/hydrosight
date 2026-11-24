# Performance and load measurements (Phase 10)

All figures are **measured on the build sandbox** and describe only that setup. They are not a service-level agreement and do not predict production behaviour.

## Setup
One uvicorn worker (FastAPI) and PostgreSQL 16 + PostGIS on the same small virtual machine as the load generator (so they compete for CPU); no network latency; every request opens a new database connection (no pool); database holds ~2.1M readings from the restore drill; 50 synthetic devices, 3 readings per request; each request also runs two rate-limit counter updates, QC and the rules engine. Script: `scripts/load-test.py`.

## HTTP ingestion (`POST /v1/ingest/readings`), 1,500 requests per level, rate limit set high
| Concurrency | Throughput | p50 | p95 | p99 | max | Errors |
|---|---|---|---|---|---|---|
| 1 | 27.3 req/s | 35.3 ms | 46.1 ms | 51.0 ms | 113 ms | 0 |
| 10 | 53.9 req/s | 183 ms | 258 ms | 307 ms | 342 ms | 0 |
| 40 | 50.2 req/s | 791 ms | 1,070 ms | 1,185 ms | 1,506 ms | 0 |

Throughput saturates near 50 requests per second (about 150 readings per second) on one worker in this setup; extra concurrency only adds queueing delay. That is enough for 50 devices reporting every 5 minutes (about 0.2 requests per second) by a wide margin, and **not measured** for thousands of devices.

## Rate limiter
With a 1 request per minute per key limit, 150 requests from 50 devices gave 50 accepted and 100 refused with `429` and `Retry-After: 60`. The two counter updates are included in the latencies above; their separate cost was not isolated.

## Earlier measurements (Phase 3b, database only)
CI runner: per-batch ingest p50 3.6 ms, p95 4.1 ms. Hosted Supabase, one 50-device round: ingest p50 45.9 ms, p95 51.7 ms.

## Not measured
Hosted API (Vercel) latency and cold starts; read paths (map, monitor, analytics, exports) under load; many concurrent browser sessions; large readings tables (partitioning is not built); realtime fan-out; the assistant (depends on the external model).

## Observations for later (no change made)
- A new connection per request is the likely dominant cost at low concurrency; use the Supabase connection pooler on the hosted API and consider a pool in the worker.
- Readings are one plain table; plan partitioning and retention before a large fleet (see `docs/OPEN_QUESTIONS.md`).
