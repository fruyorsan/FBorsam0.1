"""Faz 9 — Çok zaman dilimli analiz (4h + 1d + 1w + 1M)."""
from __future__ import annotations

import random

import pytest

from paperbot.config import AppConfig
from paperbot.core.backtest import _combined_technical_series, _tf_visibility
from paperbot.core.scoring import TechnicalLayer
from helpers import FixedFeed


def test_technical_layer_uses_four_timeframes():
    layer = TechnicalLayer()
    ls = layer.compute("BTCUSDT", FixedFeed(), AppConfig())
    assert ls.source == "live"
    assert 0.0 <= ls.score <= 100.0
    for key in ("4h", "1d", "1w", "1m", "agirliklar", "genel_yon", "multi_tf_teyit"):
        assert key in ls.details, f"detayda {key} yok"
    assert ls.details["agirliklar"] == {"4h": 0.45, "1d": 0.30, "1w": 0.15, "1M": 0.10}
    assert ls.details["genel_yon"]["yon"] in ("yukarı", "aşağı", "nötr")
    # tüm TF detayları nesne olarak gelir (panelde gösterilebilir)
    assert "rsi" in ls.details["4h"] and "rsi" in ls.details["1w"]


def test_tf_visibility_is_bar_close_time():
    week = 7 * 86_400_000
    t0 = 1_700_000_000_000
    bars = [(t0 + k * week, 1, 1, 1, 100.0 + k, 1.0) for k in range(4)]
    vis = _tf_visibility(bars, "1w")
    # her bar, sıradaki barın açılışında görünür olur (kapanış anı)
    assert vis == [t0 + week, t0 + 2 * week, t0 + 3 * week, t0 + 4 * week]


def test_tf_visibility_last_month_bar_never_early():
    month = 30 * 86_400_000
    t0 = 1_700_000_000_000
    bars = [(t0, 1, 1, 1, 100.0, 1.0), (t0 + month, 1, 1, 1, 101.0, 1.0)]
    vis = _tf_visibility(bars, "1M")
    # son bar için 31 günlük rezerv (asla gerçek kapanıştan erken değil)
    assert vis[1] == t0 + month + 2_678_400_000


def test_combined_series_with_extended_tf_bars_is_causal():
    rng = random.Random(11)
    closes, p = [], 100.0
    for _ in range(500):
        p *= 1 + rng.gauss(0, 0.01)
        closes.append(p)
    base_ms = 3_600_000
    t0 = 1_700_000_000_000
    base_ts = [t0 + i * base_ms for i in range(len(closes))]
    week, month = 7 * 86_400_000, 30 * 86_400_000
    tf_bars = {
        "1w": [(t0 - 4 * week + k * week, 1, 1, 1, closes[min(k * 168, 499)], 1.0)
               for k in range(17)],
        "1M": [(t0 - 2 * month + k * month, 1, 1, 1, closes[min(k * 720, 499)], 1.0)
               for k in range(4)],
    }
    full = _combined_technical_series(closes, "1h", base_ts=base_ts, tf_bars=tf_bars)
    assert len(full) == 500
    assert all(0.0 <= s <= 100.0 for s in full)
    # geçmişe sızma yok: aynı girdilerin kırpılmış hali ilk N değeri vermemeli değişmez
    cut = 250
    part = _combined_technical_series(closes[:cut], "1h",
                                      base_ts=base_ts[:cut], tf_bars=tf_bars)
    assert full[:cut] == pytest.approx(part)


def test_combined_series_without_tf_bars_still_works():
    """tf_bars verilmezse (offline test) toplama yolu devrede ve sınırlı."""
    closes = [100.0 * (1 + 0.001 * i) for i in range(400)]
    series = _combined_technical_series(closes, "4h")
    assert len(series) == 400
    assert all(0.0 <= s <= 100.0 for s in series)
