"""Sanal işlem motoru testleri — maliyet modeli, SL/TP, limitler, kill switch."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from paperbot.config import AppConfig
from helpers import make_engine

NOW = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)


def base_cfg(**kw) -> AppConfig:
    defaults = dict(
        price_source="mock", start_balance=10000.0,
        fee_rate=0.0012, slippage_rate=0.0035, gas_per_trade=2.0,
        max_position_pct=0.10, max_open_positions=3,
        stop_loss_pct=0.08, take_profit_pct=0.15,
        daily_max_loss_pct=0.03, entry_threshold=65.0,
    )
    defaults.update(kw)
    return AppConfig(**defaults)


# ------------------------------------------------------------------ maliyet modeli
def test_buy_applies_fee_slippage_gas():
    cfg = base_cfg()
    eng = make_engine(cfg)
    r = eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000.0}, record=False)

    assert len(r.opened) == 1, f"beklenen 1 giriş, bulundu: {[d.action for d in r.decisions]}"
    fill_cost = r.opened[0]["cost"]
    qty = r.opened[0]["qty"]

    # giriş fiyatı slippage ile yukarı kaymış olmalı
    assert r.opened[0]["price"] == pytest.approx(65000 * (1 + cfg.slippage_rate))
    # maliyet = notional + fee + gas
    expected = (qty * 65000 * (1 + cfg.slippage_rate)
                * (1 + cfg.fee_rate) + cfg.gas_per_trade)
    assert fill_cost == pytest.approx(expected, rel=1e-9)
    # nakit gerçekten azaldı
    assert eng.cash == pytest.approx(cfg.start_balance - fill_cost)


def test_sell_reduces_proceeds_by_costs():
    cfg = base_cfg()
    eng = make_engine(cfg)
    eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000.0}, record=False)
    pos = eng.positions[0]
    cost_basis = pos.cost_basis
    qty = pos.qty
    exec_entry = pos.exec_entry_price

    # fiyat değişmeden kapat (SL değil — manuel kapatma)
    closed = eng._close_position(pos, 65000.0, "manual", cfg)
    # komisyon + slippage + gas nedeniyle zarar yazmalı (round-trip maliyet ~%0.94)
    assert closed["pnl"] < 0

    # muhasebe tutarlılığı: pnl = (çıkış exec - giriş exec)×miktar − ücret − gas
    expected = (qty * (closed["exit_price"] - exec_entry)
                - closed["total_fees"] - closed["total_gas"])
    assert closed["pnl"] == pytest.approx(expected, rel=1e-9)

    # iki yönde slippage: piyasa fiyatı sabitken bile maliyet farkı oluşmalı
    assert closed["exit_price"] == pytest.approx(65000 * (1 - cfg.slippage_rate))
    assert exec_entry == pytest.approx(65000 * (1 + cfg.slippage_rate))
    assert closed["pnl"] < -qty * 65000 * 2 * cfg.slippage_rate - 2 * cfg.gas_per_trade
    assert cost_basis > 0


# ------------------------------------------------------------------------ SL / TP
def test_stop_loss_triggers():
    cfg = base_cfg()
    eng = make_engine(cfg)
    eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000.0}, record=False)
    assert len(eng.positions) == 1

    r2 = eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000 * 0.90}, record=False)
    assert len(r2.closed) == 1
    assert r2.closed[0]["exit_reason"] == "stop_loss"
    assert r2.closed[0]["pnl"] < 0
    assert eng.positions == []


def test_take_profit_triggers():
    cfg = base_cfg()
    eng = make_engine(cfg)
    eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000.0}, record=False)

    r2 = eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000 * 1.20}, record=False)
    assert len(r2.closed) == 1
    assert r2.closed[0]["exit_reason"] == "take_profit"
    assert r2.closed[0]["pnl"] > 0


# ------------------------------------------------------------------ pozisyon limiti
def test_max_open_positions_respected():
    cfg = base_cfg(max_open_positions=2)
    eng = make_engine(cfg, scores={
        "technical": 90, "onchain": 90, "defi": 90,
        "risk": 90, "sentiment": 90, "macro": 90})
    prices = {"BTCUSDT": 65000.0, "ETHUSDT": 3200.0,
              "SOLUSDT": 150.0, "UNIUSDT": 7.5}
    r = eng.run_cycle(now=NOW, prices=prices, record=False)
    assert len(eng.positions) == 2
    skipped = [d for d in r.decisions if d.action == "open" and d.skip_reason]
    assert skipped, "aşılan girişler skip_reason almalı"
    assert all("maks açık pozisyon" in d.skip_reason for d in skipped)


def test_single_asset_cap():
    cfg = base_cfg(max_position_pct=0.10, start_balance=10000.0)
    eng = make_engine(cfg)
    eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000.0}, record=False)
    pos = eng.positions[0]
    # maliyet (fee+gas dahil) bütçeyi aşmamalı, ~%10 equity
    assert pos.cost_basis <= 10000.0 * 0.10 + 1.0
    assert pos.cost_basis > 10000.0 * 0.09


# ------------------------------------------------------------- günlük zarar limiti
def test_daily_loss_limit_halts_entries_and_notifies():
    # %30 maruz kalmayla %6 çöküş → ~%5.4 günlük zarar > %3 limit
    cfg = base_cfg(daily_max_loss_pct=0.03, max_open_positions=5,
                   max_position_pct=0.30)
    eng = make_engine(cfg, scores={
        "technical": 90, "onchain": 85, "defi": 80,
        "risk": 85, "sentiment": 70, "macro": 65})
    prices = {"BTCUSDT": 65000.0, "ETHUSDT": 3200.0, "SOLUSDT": 150.0}
    r1 = eng.run_cycle(now=NOW, prices=prices, record=False)
    assert len(r1.opened) >= 2
    assert eng.daily_halt is False

    # sert çöküş: %4 zarar → limit aşılmaz çünkü pozisyon değeri düşer
    crash = {k: v * 0.94 for k, v in prices.items()}
    r2 = eng.run_cycle(now=NOW, prices=crash, record=False)
    assert eng.daily_halt is True, "günlük limit aşılmalıydı"
    assert any(e.kind == "risk_halt" for e in r2.events), "bildirim üretilmeli"

    # ertesi gün girişler yeniden açılır
    r3 = eng.run_cycle(now=NOW.replace(day=25), prices=crash, record=False)
    assert eng.daily_halt is False
    assert any("yeni gün" in e.message.lower() for e in r3.events)


# -------------------------------------------------------------------- kill switch
def test_kill_switch_closes_all_and_blocks_new_entries():
    cfg = base_cfg(max_open_positions=5)
    eng = make_engine(cfg, scores={
        "technical": 90, "onchain": 85, "defi": 80,
        "risk": 85, "sentiment": 70, "macro": 65})
    prices = {"BTCUSDT": 65000.0, "ETHUSDT": 3200.0, "SOLUSDT": 150.0}
    eng.run_cycle(now=NOW, prices=prices, record=False)
    assert len(eng.positions) >= 2

    eng.kill_switch = True
    r = eng.run_cycle(now=NOW, prices=prices, record=False)
    assert eng.positions == [], "tüm pozisyonlar kapanmalı"
    assert len(r.closed) >= 2
    assert all(c["exit_reason"] == "kill_switch" for c in r.closed)
    assert any(e.kind == "kill_switch" for e in r.events)
    assert r.opened == [], "kill switch sırasında giriş olmamalı"
    assert r.notes, "kullanıcıya not düşülmeli"

    # kill switch açıkken yeni çevrim de giriş yapmaz
    r2 = eng.run_cycle(now=NOW, prices=prices, record=False)
    assert r2.opened == []


# --------------------------------------------------------------- risk filtresi
def test_risk_filter_blocks_entry_regardless_of_other_scores():
    cfg = base_cfg(risk_min_score=40.0)
    eng = make_engine(cfg, scores={
        "technical": 95, "onchain": 95, "defi": 95,
        "risk": 30, "sentiment": 95, "macro": 95})
    r = eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000.0}, record=False)
    assert eng.positions == [], "düşük güvenlik skorunda işlem açılmamalı"
    d = [x for x in r.decisions if x.symbol == "BTCUSDT"][0]
    assert d.action == "risk_block"
    assert d.risk_level == "KRİTİK"
    assert "RİSK FİLTRESİ" in d.rationale


# ------------------------------------------------------------- çıkış kararı (skor)
def test_score_exit_closes_position():
    cfg = base_cfg(exit_threshold=40.0, entry_threshold=65.0)
    eng = make_engine(cfg, scores={
        "technical": 75, "onchain": 70, "defi": 65,
        "risk": 80, "sentiment": 60, "macro": 55})
    eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000.0}, record=False)
    assert len(eng.positions) == 1

    # skorlar düşer → nihai skor < 40 → çıkış
    eng.registry = make_engine(cfg).registry.__class__({
        "technical": 20, "onchain": 15, "defi": 25,
        "risk": 80, "sentiment": 20, "macro": 30})
    r2 = eng.run_cycle(now=NOW, prices={"BTCUSDT": 65000.0}, record=False)
    assert len(r2.closed) == 1
    assert r2.closed[0]["exit_reason"] == "score_exit"
