"""Faz 8 — Akıllı TP/SL testleri: faktörler, sınırlar, R:R, motor entegrasyonu."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from helpers import make_engine
from paperbot.config import AppConfig
from paperbot.core.adaptive import (SL_MAX, SL_MIN, TP_MAX, TP_MIN,
                                    adaptive_targets)
from paperbot.core.decision import Decision

NOW = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)


def base_cfg(**kw) -> AppConfig:
    defaults = dict(price_source="mock", stop_loss_pct=0.08,
                    take_profit_pct=0.15, adaptive_tp=True)
    defaults.update(kw)
    return AppConfig(**defaults)


def dec(confidence=0.75, risk_level="DÜŞÜK", vol=2.5, sm=None) -> Decision:
    d = Decision(symbol="BTCUSDT", action="open")
    d.confidence = confidence
    d.risk_level = risk_level
    d.details = {"technical": {"vol_pct": vol}}
    if sm is not None:
        d.details["onchain"] = {"smart_money": sm}
    return d


# ------------------------------------------------------------------ kapalıyken
def test_disabled_returns_fixed_values():
    tgt = adaptive_targets(base_cfg(adaptive_tp=False), dec())
    assert tgt["enabled"] is False
    assert tgt["tp"] == pytest.approx(0.15)
    assert tgt["sl"] == pytest.approx(0.08)
    assert tgt["factors"] == {}
    assert "kapalı" in tgt["summary"]


# ------------------------------------------------------------------- faktörler
def test_vol_scales_tp_with_clamp():
    cfg = base_cfg()
    hi = adaptive_targets(cfg, dec(vol=5.0))      # 5/2.5=2.0 → kırp 1.6
    base = adaptive_targets(cfg, dec(vol=2.5))    # referans → 1.0
    lo = adaptive_targets(cfg, dec(vol=1.0))      # 0.4 → kırp 0.7
    assert hi["tp"] == pytest.approx(0.15 * 1.6)
    assert base["tp"] == pytest.approx(0.15)
    assert lo["tp"] == pytest.approx(0.15 * 0.7)
    assert base["sl"] == pytest.approx(0.08)


def test_confidence_scales_and_clamps():
    cfg = base_cfg()
    low = adaptive_targets(cfg, dec(confidence=0.5))    # 0.7 → kırp 0.9
    mid = adaptive_targets(cfg, dec(confidence=0.75))   # 1.0
    high = adaptive_targets(cfg, dec(confidence=1.0))   # 1.3 → kırp 1.15
    assert low["tp"] == pytest.approx(0.15 * 0.9)
    assert mid["tp"] == pytest.approx(0.15)
    assert high["tp"] == pytest.approx(0.15 * 1.15)
    assert low["tp"] < mid["tp"] < high["tp"]


def test_smart_money_moves_target():
    cfg = base_cfg()
    strong = adaptive_targets(cfg, dec(sm={"strong": True}))
    accum = adaptive_targets(cfg, dec(sm={"verdict": "accumulation"}))
    none_ = adaptive_targets(cfg, dec(sm={"verdict": "flat"}))
    dist = adaptive_targets(cfg, dec(sm={"verdict": "distribution"}))
    missing = adaptive_targets(cfg, dec())
    assert strong["tp"] == pytest.approx(0.15 * 1.15)   # balina birikimi ekstra
    assert accum["tp"] == pytest.approx(0.15 * 1.05)
    assert none_["tp"] == pytest.approx(0.15)
    assert dist["tp"] == pytest.approx(0.15 * 0.90)      # dağıtım → hedef aşağı
    assert missing["tp"] == pytest.approx(0.15)
    assert strong["tp"] > accum["tp"] > none_["tp"] > dist["tp"]


def test_risk_level_tightens_both():
    cfg = base_cfg()
    ok = adaptive_targets(cfg, dec(risk_level="DÜŞÜK"))
    mid = adaptive_targets(cfg, dec(risk_level="ORTA"))
    high = adaptive_targets(cfg, dec(risk_level="YÜKSEK"))
    crit = adaptive_targets(cfg, dec(risk_level="KRİTİK"))
    assert ok["tp"] == pytest.approx(0.15)
    assert mid["tp"] == pytest.approx(0.15 * 0.95)
    assert high["tp"] == pytest.approx(0.15 * 0.85)
    assert crit["tp"] == pytest.approx(0.15 * 0.80)
    # SL de riskle sıkılaşır (taban 0.08 × 1.0 > × 0.80)
    assert ok["sl"] > crit["sl"]
    assert crit["sl"] >= SL_MIN


# ---------------------------------------------------------- sınırlar + R:R disiplini
@pytest.mark.parametrize("vol,conf,risk,sm", [
    (0.5, 0.5, "KRİTİK", {"strong": True}),
    (12.0, 1.0, "DÜŞÜK", {"verdict": "accumulation"}),
    (2.5, 0.75, "ORTA", {"verdict": "distribution"}),
    (1.0, 0.9, "YÜKSEK", None),
])
def test_bounds_and_rr_discipline(vol, conf, risk, sm):
    tgt = adaptive_targets(base_cfg(),
                           dec(confidence=conf, risk_level=risk, vol=vol, sm=sm))
    tp, sl = tgt["tp"], tgt["sl"]
    assert TP_MIN <= tp <= TP_MAX
    assert SL_MIN <= sl <= SL_MAX
    # SL ne TP'nin %40'ından dar (aşırı sıkı stop) ne de %60'ından geniş
    # (R:R < 1.67); mutlak sınırlar (SL_MIN/SL_MAX) her koşulda geçerlidir.
    assert sl >= min(tp * 0.40, SL_MAX) - 1e-9
    assert sl <= max(tp * 0.60, SL_MIN) + 1e-9


def test_absolute_clamps_with_extreme_base():
    # taban TP çok yüksek → %35'e kırpılır; SL %12'ye
    hi = adaptive_targets(base_cfg(take_profit_pct=0.40, stop_loss_pct=0.50),
                          dec(vol=12.0, confidence=1.0, sm={"strong": True}))
    assert hi["tp"] == pytest.approx(TP_MAX)
    assert hi["sl"] == pytest.approx(SL_MAX)
    # taban TP çok düşük → %6 tabana; SL TP bandına uymuyorsa alt sınıra yaslanır
    lo = adaptive_targets(base_cfg(take_profit_pct=0.03),
                          dec(vol=1.0, confidence=0.5))
    assert lo["tp"] == pytest.approx(TP_MIN)
    assert SL_MIN <= lo["sl"] <= SL_MAX
    assert lo["sl"] >= lo["tp"] * 0.40 - 1e-9


def test_deterministic_and_summary():
    cfg = base_cfg()
    d = dec(confidence=0.8, risk_level="ORTA", vol=3.2,
            sm={"strong": True, "verdict": "accumulation"})
    a, b = adaptive_targets(cfg, d), adaptive_targets(cfg, d)
    assert a == b
    assert "Akıllı TP/SL" in a["summary"]
    assert "balina" in a["summary"] and "risk ORTA" in a["summary"]
    assert set(a["factors"]) == {"volatilite", "guven", "balina", "risk"}


# ------------------------------------------------------------ motor entegrasyonu
def test_engine_entry_uses_adaptive_targets():
    cfg = base_cfg()
    eng = make_engine(cfg)
    r = eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000.0}, record=False)
    assert len(eng.positions) == 1
    pos = eng.positions[0]
    d = next(x for x in r.decisions if x.symbol == "BTCUSDT")
    tgt = adaptive_targets(cfg, d)
    assert tgt["enabled"] is True
    assert pos.take_profit == pytest.approx(
        pos.exec_entry_price * (1 + tgt["tp"]))
    assert pos.stop_loss == pytest.approx(
        pos.exec_entry_price * (1 - tgt["sl"]))
    # giriş gerekçesine şeffaf akıllı TP satırı eklenmiş olmalı
    assert "Akıllı TP/SL" in pos.rationale
    # sabit 15% tabanından farklı (varlık bazlı)
    assert pos.take_profit != pytest.approx(pos.exec_entry_price * 1.15, rel=1e-6)


def test_engine_revision_only_raises_tp():
    cfg = base_cfg()
    eng = make_engine(cfg)
    eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000.0}, record=False)
    pos = eng.positions[0]
    original_tp = pos.take_profit

    # elle aşağı çekilmiş TP → motor bir sonraki döngüde yalnızca yukarı taşımali
    pos.take_profit = pos.exec_entry_price * 1.005
    r2 = eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000.0}, record=False)

    assert len(r2.closed) == 0, "revizyon anlık satış tetiklememeli"
    assert pos.take_profit == pytest.approx(original_tp)
    assert pos.take_profit > pos.exec_entry_price * 1.005


def test_engine_fixed_targets_when_disabled():
    cfg = base_cfg(adaptive_tp=False)
    eng = make_engine(cfg)
    eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000.0}, record=False)
    pos = eng.positions[0]
    assert pos.take_profit == pytest.approx(pos.exec_entry_price * 1.15)
    assert pos.stop_loss == pytest.approx(pos.exec_entry_price * 0.92)
    assert "Akıllı TP/SL" not in pos.rationale
