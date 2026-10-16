"""FastAPI uygulama girişi.

Çalıştırma:
    uvicorn paperbot.main:app --host 0.0.0.0 --port 8000
veya:
    python -m paperbot.main
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import settings_store as ss
from .api.routes import router as api_router
from .context import WEB_DIR, AppContext
from .logging_setup import setup_logging

log = logging.getLogger("paperbot.main")


def create_app() -> FastAPI:
    cfg = ss.effective_cfg(None)
    setup_logging(cfg.log_level)

    ctx = AppContext()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        ctx.start()
        if ctx.start_scheduler_flag:
            await ctx.scheduler.start()
        yield
        await ctx.scheduler.stop()
        ctx.stop()

    app = FastAPI(
        title="PaperBot — Sanal Kripto/DeFi İşlem Sistemi",
        description="AI destekli, tam otomatik SANAL İŞLEM (paper trading) sistemi. "
                    "Yatırım tavsiyesi değildir.",
        version=ctx.version,
        lifespan=lifespan,
    )
    app.state.ctx = ctx

    # Paneli kendi sitene gömürken farklı origin'lerden erişim için CORS açık.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix="/api")

    # Arayüz (statik dosyalar) — API'den sonra mount edilir ki /api/* öncelikli olsun
    if WEB_DIR.exists():
        app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
    else:
        log.warning("web dizini bulunamadı: %s", WEB_DIR)

    return app


app = create_app()


def run() -> None:
    import uvicorn

    cfg = ss.effective_cfg(None)
    uvicorn.run("paperbot.main:app", host=cfg.app_host, port=cfg.app_port,
                log_level=cfg.log_level.lower(), reload=False)


if __name__ == "__main__":
    run()
