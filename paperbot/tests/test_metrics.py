"""Performans metrikleri testleri: drawdown, Sharpe, kazanma oranı, katman karşılaştırma."""
from __future__ import annotations

import pytest

from paperbot.core.metrics import (
    equity_stats, layer_comparison, performance_report, trade_stats,
)


def test_trade_stats_basic():
    trades = [
        {"pnl": 100, "strategy": "s", "layer_scores": {"onchain": 70}},
        {"pnl": -50, "strategy": "s", "layer_scores": {"onchain": 30}},
        {"pnl": 50, "strategy": "s", "layer_scores": {"onchain": 75}},
        {"pnl": -100, "strategy": "s", "layer_scores": {"onchain": 40}},
    ]
    st = trade_stats(trades)
    assert st["trade_count"] == 4
    assert st["win_rate"] == pytest.approx(0.5)
    assert st["total_pnl"] == 0
    assert st["avg_win"] == pytest.approx(75)
    assert st["avg_loss"] == pytest.approx(75)
    assert st["worst_trade"] == -100
    assert st["best_trade"] == 100
    assert st["profit_factor"] == pytest.approx(1.0)


def test_max_drawdown():
    snaps = [{"equity": e} for e in [100, 120, 90, 110, 80]]
    st = equity_stats(snaps, period_seconds=3600)
    # zirve 120 → dip 80 = %33.33 (metrikler 4 haneye yuvarlanır)
    assert st["max_drawdown"] == pytest.approx((120 - 80) / 120, abs=1e-3)
    assert st["return_pct"] == pytest.approx(-20.0, abs=0.01)


def test_sharpe_positive_for_uptrend_negative_for_downtrend():
    up = [{"equity": 100 * (1.001 ** i)} for i in range(500)]
    down = [{"equity": 100 * (0.999 ** i)} for i in range(500)]
    assert equity_stats(up, 300)["sharpe"] > 1.0
    assert equity_stats(down, 300)["sharpe"] < -1.0


def test_sharpe_zero_for_flat():
    flat = [{"equity": 100.0}] * 50
    assert equity_stats(flat, 300)["sharpe"] == 0.0


def test_layer_comparison_shows_edge():
    trades = [
        {"pnl": 200, "strategy": "s", "layer_scores": {"onchain": 80}},
        {"pnl": 150, "strategy": "s", "layer_scores": {"onchain": 70}},
        {"pnl": -100, "strategy": "s", "layer_scores": {"onchain": 30}},
        {"pnl": -80, "strategy": "s", "layer_scores": {"onchain": 20}},
    ]
    c = layer_comparison(trades, "onchain", threshold=60)
    assert c["with_signal"]["trade_count"] == 2
    assert c["without_signal"]["trade_count"] == 2
    assert c["with_signal"]["win_rate"] == 1.0
    assert c["without_signal"]["win_rate"] == 0.0
    assert c["edge_pnl_per_trade"] > 0
    assert c["contributes"] is True


def test_performance_report_structure():
    trades = [
        {"pnl": 120, "strategy": "multi_layer_v1", "exit_reason": "take_profit",
         "layer_scores": {"technical": 75, "onchain": 65}},
        {"pnl": -60, "strategy": "multi_layer_v1", "exit_reason": "stop_loss",
         "layer_scores": {"technical": 70, "onchain": 40}},
    ]
    snaps = [{"equity": 10000}, {"equity": 10060}]
    rep = performance_report(trades, snaps, period_seconds=300)
    assert rep["overall"]["trade_count"] == 2
    assert rep["overall"]["win_rate"] == 0.5
    assert rep["overall"]["max_drawdown"] >= 0
    assert "multi_layer_v1" in rep["by_strategy"]
    assert "take_profit" in rep["by_exit_reason"]
    for layer in ("technical", "onchain", "defi", "risk", "sentiment", "macro"):
        assert layer in rep["by_layer"]
        assert "with_signal" in rep["by_layer"][layer]
        assert "without_signal" in rep["by_layer"][layer]
        assert "contributes" in rep["by_layer"][layer]
