"""Test yardımcıları: ağ erişimi olmadan motoru sürdüren sahte bağımlılıklar."""
from __future__ import annotations

from paperbot.config import AppConfig
from paperbot.core.decision import RuleBasedDecider
from paperbot.core.paper_engine import PaperExecutionProvider, TradingEngine
from paperbot.core.scoring import LayerRegistry, LayerScore

FIXED_PRICES = {"BTCUSDT": 65000.0, "ETHUSDT": 3200.0, "SOLUSDT": 150.0,
                "UNIUSDT": 7.5}


class FixedFeed:
    """Sabit fiyatlı / sabit serili sahte fiyat kaynağı."""
    source = "mock"

    def __init__(self, prices: dict | None = None):
        self.prices = dict(prices or FIXED_PRICES)

    def prices_for(self, symbols):
        return {s: self.prices.get(s, 100.0) for s in symbols}, "mock"

    def series(self, symbol, n=200, interval="4h"):
        p = self.prices.get(symbol, 100.0)
        # hafif yükselen seri (teknik skor >50 üretsin)
        return [p * (1 + 0.001 * i) for i in range(n)]

    def historical_ohlcv(self, symbol, interval, days):
        from paperbot.data.pricefeed import synthetic_ohlcv
        return synthetic_ohlcv(symbol, interval, days)


class FixedRegistry(LayerRegistry):
    """Belirli skorları döndüren katman kaydı (test kontrolü)."""

    def __init__(self, scores: dict):
        super().__init__([])
        self.fixed = scores

    def compute_all(self, symbol, feed, cfg):
        return {k: (v if isinstance(v, LayerScore)
                    else LayerScore(k, float(v), "mock", {"test": True}))
                for k, v in self.fixed.items()}


def make_engine(cfg: AppConfig | None = None, scores: dict | None = None,
                prices: dict | None = None, session_factory=None) -> TradingEngine:
    cfg = cfg or AppConfig(price_source="mock")
    registry = FixedRegistry(scores or {
        "technical": 75, "onchain": 70, "defi": 65,
        "risk": 80, "sentiment": 60, "macro": 55,
    })
    return TradingEngine(
        cfg=cfg, feed=FixedFeed(prices), registry=registry,
        decider=RuleBasedDecider(cfg), session_factory=session_factory,
        notifier=None,
    )
