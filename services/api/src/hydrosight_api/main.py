from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse

from hydrosight_api import __version__
from hydrosight_api.config import Settings, get_settings
from hydrosight_api.db import check_database

app = FastAPI(title="HydroSight API", version=__version__)

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
