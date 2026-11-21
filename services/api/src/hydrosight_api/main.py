from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from hydrosight_api import __version__
from hydrosight_api.alerts_public import router as cap_router
from hydrosight_api.community import router as community_router
from hydrosight_api.config import Settings, get_settings
from hydrosight_api.db import check_database
from hydrosight_api.ingest import router as ingest_router

app = FastAPI(title="HydroSight API", version=__version__)
app.include_router(ingest_router)
app.include_router(cap_router)
app.include_router(community_router)

# Browsers may call the API only from the origins listed in CORS_ALLOW_ORIGINS (comma separated).
# No credentials are ever allowed: the community endpoints need no cookies or sign-in.
_origins = [o.strip() for o in get_settings().cors_allow_origins.split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
        allow_credentials=False,
    )

SettingsDep = Annotated[Settings, Depends(get_settings)]


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness: the process is up. Does not check dependencies."""
    return {"status": "ok", "service": "api", "version": __version__}


@app.get("/ready")
def ready(settings: SettingsDep) -> JSONResponse:
    """Readiness: dependencies are reachable. Failure is reported, never hidden (rule 6)."""
    db_ok, db_detail = check_database(settings.database_url)
    body = {
        "status": "ready" if db_ok else "not_ready",
        "service": "api",
        "checks": {"database": {"ok": db_ok, "detail": db_detail}},
    }
    return JSONResponse(body, status_code=200 if db_ok else 503)
