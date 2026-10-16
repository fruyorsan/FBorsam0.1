"""Backtest: aynı motor kodu geçmiş veride döner, sentetik yedek çalışır."""
from __future__ import annotations

import pytest

from paperbot.config import AppConfig
from paperbot.core.backtest import _aggregate, _combined_technical_series, run_backtest
from paperbot.core.decision import build_decider
from paperbot.core.scoring import build_default_registry
from helpers import FixedFeed


def test_aggregate_1h_to_1d():
    closes = list(range(1, 50))          # 49 bar
    tf, ratio = _aggregate(closes, "1h", "1d")
    assert ratio == 24
    assert tf[0] == 24                   # günün son kapanışı
    assert len(tf) == len(closes) // 24


def test_technical_series_is_causal_and_bounded():
    import random
    rng = random.Random(7)
    closes, p = [], 100.0
    for _ in range(400):
        p *= 1 + rng.gauss(0, 0.01)
        closes.append(p)
    series = _combined_technical_series(closes, "1h")
    assert len(series) == len(closes)
    assert all(0 <= s <= 100 for s in series)
    # geçmişe sızma yok: aynı başlangıç, farklı sondan kırpma → ilk N değer aynı
    series2 = _combined_technical_series(closes[:200], "1h")
    assert series[:200] == pytest.approx(series2)


def test_backtest_runs_offline_with_synthetic_fallback():
    cfg = AppConfig(price_source="mock", start_balance=10000.0)
    feed = FixedFeed()
    res = run_backtest(
        symbols=["BTCUSDT", "ETHUSDT"], days=30, interval="1h",
        cfg=cfg, feed=feed, registry=build_default_registry(),
        decider=build_decider(cfg),
    )
    assert res.get("ok") is True
    assert res["bars"] > 500
    assert res["metrics"]["overall"] is not None
    assert res["metrics"]["overall"]["trade_count"] >= 0
    assert len(res["equity_curve"]) > 10
    assert res["config"]["strategy"] == "multi_layer_v1"
    assert res["synthetic_data"] is True
    # aynı strateji kodu kullanıldı
    assert set(res["decision_counts"]) == {"open", "exit", "hold", "risk_block"}
    # sonuç raporunda katman karşılaştirmaları da var
    assert "by_layer" in res["metrics"]


def test_backtest_costs_are_charged():
    """Backtest de canlı gibi ücret/slippage/gas keser."""
    cfg = AppConfig(price_source="mock", start_balance=10000.0,
                    entry_threshold=65.0, exit_threshold=40.0)
    feed = FixedFeed()
    res = run_backtest(symbols=["BTCUSDT"], days=60, interval="1h",
                       cfg=cfg, feed=feed,
                       registry=build_default_registry(),
                       decider=build_decider(cfg))
    o = res["metrics"]["overall"]
    if o["trade_count"] > 0:
        assert o["total_fees"] > 0
        assert o["total_gas"] > 0
        assert o["total_slippage"] > 0


def test_backtest_rejects_bad_symbol():
    cfg = AppConfig(price_source="mock")

    class EmptyFeed(FixedFeed):
        def historical_ohlcv(self, symbol, interval, days):
            return []

    res = run_backtest(symbols=["NOSUCH"], days=10, interval="1h",
                       cfg=cfg, feed=EmptyFeed(),
                       registry=build_default_registry(),
                       decider=build_decider(cfg))
    assert "error" in res
