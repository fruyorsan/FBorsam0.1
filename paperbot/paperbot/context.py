"""Uygulama bağlamı (AppContext) — tüm bileşenleri bağlar.

FastAPI iskeleti main.py'de bu nesneyi kullanır; testler de aynı
nesneyi (zamanlayıcısız) kurabilir.
"""
from __future__ import annotations

import logging
from pathlib import Path

from . import settings_store as ss
from .config import AppConfig
from .core.decision import build_decider
from .core.defi import DefiLayer
from .core.macro import MacroLayer
from .core.onchain import OnchainLayer, OnchainPipeline
from .core.paper_engine import TradingEngine, build_provider
from .core.risk import RiskLayer
from .core.scoring import build_default_registry
from .core.sentiment import SentimentLayer
from .data.base import HttpFetcher
from .data.defi import build_defi_provider
from .data.macro import build_macro_provider
from .data.onchain import build_onchain_provider
from .data.pricefeed import PriceFeed
from .data.security import build_security_provider
from .data.sentiment import build_sentiment_provider
from .db import init_db, make_engine, make_session_factory
from .notify.telegram import Notifier, push
from .scheduler import CycleScheduler

log = logging.getLogger("paperbot.context")

WEB_DIR = Path(__file__).resolve().parent / "web"


class AppContext:
    def __init__(self, database_url: str | None = None, start_scheduler: bool | None = None):
        import os
        if start_scheduler is None:
            start_scheduler = os.getenv("SCHEDULER_ENABLED", "true").lower() in ("1", "true", "yes", "on")
        self._cfg_override = database_url
        self.start_scheduler_flag = bool(start_scheduler)
        self.version = "0.1.0"
        self.last_backtest = None
        self.cfg: AppConfig | None = None
        self.session_factory = None
        self.engine: TradingEngine | None = None
        self.feed: PriceFeed | None = None
        self.pipeline: OnchainPipeline | None = None
        self.registry = None
        self.decider = None
        self.notifier: Notifier | None = None
        self.scheduler = CycleScheduler(self)

    # ------------------------------------------------------------- yaşam döngüsü
    def start(self) -> None:
        cfg = self.current_cfg()
        engine = make_engine(cfg)
        self.session_factory = make_session_factory(engine)
        init_db(engine, self.session_factory, cfg)

        fetcher = HttpFetcher(timeout=cfg.http_timeout, max_retries=cfg.max_retries,
                              cache_ttl=cfg.cache_ttl)
        self.feed = PriceFeed(cfg, fetcher=fetcher, session_factory=self.session_factory)

        # Faz 2: on-chain / akıllı para pipeline'ı (cüzdan portföyleri + sinyaller)
        provider = build_onchain_provider(cfg, fetcher)
        self.pipeline = OnchainPipeline(self.session_factory, provider, feed=self.feed)
        if hasattr(provider, "price_fn"):
            provider.price_fn = self._token_price          # Etherscan USD dönüşümü

        # Faz 4: Risk & Güvenlik katmanı (DefiLlama + GoPlus, anahtarsız)
        security_provider = build_security_provider(cfg, fetcher)
        risk_layer = RiskLayer(provider=security_provider,
                               asset_lookup=self._asset_meta)

        # Faz 3: DeFi metrikleri katmanı (DefiLlama TVL/ücret/APY, anahtarsız)
        defi_provider = build_defi_provider(cfg, fetcher)
        defi_layer = DefiLayer(provider=defi_provider,
                               asset_lookup=self._asset_meta)

        # Faz 5: Duygu & haber katmanı (Google News/FNG/trending, anahtarsız)
        sent_provider = build_sentiment_provider(cfg, fetcher)
        sent_layer = SentimentLayer(provider=sent_provider,
                                    asset_lookup=self._asset_meta)

        # Faz 6: Makro katmanı (CoinGecko/DefiLlama-stablecoin/ECB, anahtarsız)
        macro_provider = build_macro_provider(cfg, fetcher)
        macro_layer = MacroLayer(provider=macro_provider)

        self.registry = build_default_registry(
            onchain_layer=OnchainLayer(self.pipeline),
            risk_layer=risk_layer,
            defi_layer=defi_layer,
            sentiment_layer=sent_layer,
            macro_layer=macro_layer)
        self.decider = build_decider(cfg)
        self.notifier = Notifier(cfg)
        self.engine = TradingEngine(
            cfg=cfg, feed=self.feed, registry=self.registry,
            decider=self.decider, session_factory=self.session_factory,
            notifier=self.notifier,
        )
        log.info("PaperBot hazır — mod: %s, bakiye: %.2f USDT, on-chain kaynağı: %s",
                 cfg.trading_mode, self.engine.cash, getattr(provider, "name", "?"))

    def _token_price(self, token: str) -> float | None:
        """Etherscan adaptörü için token fiyatı (başarısızsa None → mock)."""
        try:
            prices, _src = self.feed.prices_for([token + "USDT"])
            return prices.get(token + "USDT")
        except Exception:  # noqa: BLE001
            return None

    def _asset_meta(self) -> dict:
        """Risk katmanı için token → {name, coingecko_id, category} eşlemesi."""
        from .models import Asset
        with self.session_factory() as s:
            out = {}
            for a in s.query(Asset).filter(Asset.enabled.is_(True)).all():
                token = a.symbol[:-4] if a.symbol.endswith("USDT") else a.symbol
                out[token] = {"name": a.name, "coingecko_id": a.coingecko_id,
                              "category": a.category}
            return out

    def stop(self) -> None:
        try:
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(self.scheduler.stop())
                else:
                    loop.run_until_complete(self.scheduler.stop())
            except RuntimeError:
                pass
        except Exception as e:  # noqa: BLE001
            log.warning("Zamanlayıcı durdurulamadı: %s", e)
        if self.feed and getattr(self.feed, "fetcher", None):
            self.feed.fetcher.close()

    # --------------------------------------------------------------- yardımcılar
    def current_cfg(self) -> AppConfig:
        if self.session_factory is None:
            cfg = ss.effective_cfg(None)
            if self._cfg_override:
                cfg.database_url = self._cfg_override
            self.cfg = cfg
            return cfg
        cfg = ss.effective_cfg(self.session_factory)
        if self._cfg_override:
            cfg.database_url = self._cfg_override
        self.cfg = cfg
        return cfg

    def notify(self, kind: str, message: str) -> None:
        push(self.session_factory, self.notifier, kind, message)
