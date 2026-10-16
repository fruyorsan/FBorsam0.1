"""Faz 10 — Binance canlı yürütme adaptörü (ağsız, sahte istemciyle)."""
from __future__ import annotations

import pytest

from paperbot.config import AppConfig
from paperbot.core import paper_engine
from paperbot.core.binance_exec import (
    BinanceExecutionProvider, _round_step, _step_precision,
)
from paperbot.core.paper_engine import (
    ExecutionDisabled, PaperExecutionProvider, PositionState,
    TradingEngine, _live_provider_cache, build_provider,
)
from helpers import FIXED_PRICES, make_engine
from datetime import datetime, timezone

PRICE = 65000.0


class FakeClient:
    """BinanceClient arayüzünü taklit eder — ağ yok."""

    def __init__(self, free_usdt: float = 5000.0, base_free_qty: float = 1.0,
                 fill_price: float = PRICE, fail_buy: bool = False):
        self.free_usdt = free_usdt
        self.base_free_qty = base_free_qty
        self.fill_price = fill_price
        self.fail_buy = fail_buy
        self.orders: list[tuple] = []
        self.filters = {"step": 0.0001, "min_qty": 0.0001, "min_notional": 5.0}

    def symbol_filters(self, symbol):
        return self.filters

    def usdt_free(self):
        return self.free_usdt

    def base_free(self, symbol):
        return self.base_free_qty

    def market_buy(self, symbol, quote_qty):
        if self.fail_buy:
            from paperbot.core.binance_exec import BinanceApiError
            raise BinanceApiError(-2010, "Account has insufficient balance.")
        self.orders.append(("buy", symbol, quote_qty))
        qty = quote_qty / self.fill_price
        return {"symbol": symbol, "executedQty": f"{qty:.8f}",
                "cummulativeQuoteQty": f"{quote_qty:.2f}",
                "fills": [{"commission": quote_qty * 0.001,
                           "commissionAsset": "USDT"}]}

    def market_sell(self, symbol, qty, step):
        self.orders.append(("sell", symbol, qty))
        proceeds = qty * self.fill_price
        return {"symbol": symbol, "executedQty": f"{qty:.8f}",
                "cummulativeQuoteQty": f"{proceeds:.8f}",
                "fills": [{"commission": proceeds * 0.001,
                           "commissionAsset": "USDT"}]}


def live_cfg(**kw) -> AppConfig:
    kw.setdefault("trading_mode", "live")
    kw.setdefault("live_trading_enabled", True)
    kw.setdefault("binance_api_key", "k")
    kw.setdefault("binance_api_secret", "s")
    return AppConfig(**kw)


# ------------------------------------------------------------------ yuvarlama
def test_step_rounding_never_exceeds_balance():
    assert _step_precision(0.001) == 3
    assert _step_precision(0.00000100) == 6
    assert _round_step(1.23456789, 0.0001) == pytest.approx(1.2345)
    assert _round_step(0.9999999, 0.0001) == pytest.approx(0.9999)
    assert _round_step(0.00005, 0.0001) == 0.0


# ---------------------------------------------------------------------- alım
def test_buy_fill_math_and_cash_delta():
    cfg = live_cfg()
    prov = BinanceExecutionProvider(FakeClient(fill_price=65100.0))
    fill = prov.execute("buy", "BTCUSDT", market_price=PRICE, qty=0.02, cfg=cfg)
    assert fill.accepted
    notional = 0.02 * PRICE                      # quoteOrderQty = floor(notional)
    quote = int(notional * 100) / 100
    assert fill.qty == pytest.approx(quote / 65100.0, rel=1e-6)
    assert fill.price == pytest.approx(65100.0)
    assert fill.fee == pytest.approx(quote * 0.001)
    assert fill.gas == 0.0                       # spotta gas yok
    assert fill.slippage_cost == pytest.approx((fill.price - PRICE) * fill.qty)
    assert fill.cash_delta == pytest.approx(-(quote + fill.fee))


def test_buy_below_min_notional_rejected():
    cfg = live_cfg()                              # min_notional = 10 USDT
    prov = BinanceExecutionProvider(FakeClient())
    fill = prov.execute("buy", "BTCUSDT", market_price=PRICE,
                        qty=0.00001, cfg=cfg)     # ~0.65 USDT
    assert not fill.accepted and "min tutar" in fill.reason


def test_buy_api_error_becomes_rejected_fill():
    cfg = live_cfg()
    prov = BinanceExecutionProvider(FakeClient(fail_buy=True))
    fill = prov.execute("buy", "BTCUSDT", market_price=PRICE, qty=0.02, cfg=cfg)
    assert not fill.accepted
    assert "insufficient" in fill.reason and "Binance" in fill.reason


# -------------------------------------------------------------------- satım
def test_sell_rounds_to_step_and_caps_at_balance():
    cfg = live_cfg()
    client = FakeClient(base_free_qty=1.0)
    prov = BinanceExecutionProvider(client)
    fill = prov.execute("sell", "BTCUSDT", market_price=PRICE,
                        qty=1.23456789, cfg=cfg)  # bakiyenin üstünde istek
    assert fill.accepted
    kind, _, sent_qty = client.orders[0]
    assert kind == "sell" and sent_qty == pytest.approx(1.0)  # bakiyeye kısıldı
    assert fill.qty == pytest.approx(1.0)
    assert fill.cash_delta == pytest.approx(PRICE - PRICE * 0.001)


def test_sell_insufficient_dust_rejected():
    cfg = live_cfg()
    prov = BinanceExecutionProvider(FakeClient(base_free_qty=0.00005))
    fill = prov.execute("sell", "BTCUSDT", market_price=PRICE,
                        qty=0.00005, cfg=cfg)     # step (0.0001) altı
    assert not fill.accepted and "yetersiz" in fill.reason


# ----------------------------------------------------------- emniyet kilitleri
def test_provider_refuses_when_mode_not_live():
    prov = BinanceExecutionProvider(FakeClient())
    cfg = AppConfig(trading_mode="paper", live_trading_enabled=False)
    with pytest.raises(ExecutionDisabled):
        prov.execute("buy", "BTCUSDT", PRICE, 0.02, cfg)


def test_from_cfg_requires_keys():
    cfg = AppConfig(trading_mode="live", live_trading_enabled=True)
    with pytest.raises(ExecutionDisabled):
        BinanceExecutionProvider.from_cfg(cfg)


def test_build_provider_selection():
    _live_provider_cache.clear()
    assert isinstance(build_provider(AppConfig()), PaperExecutionProvider)
    assert isinstance(build_provider(live_cfg()), BinanceExecutionProvider)
    _live_provider_cache.clear()
    with pytest.raises(ExecutionDisabled):
        build_provider(live_cfg(binance_api_key="", binance_api_secret=""))
    _live_provider_cache.clear()


def test_fee_fallback_for_unknown_asset():
    prov = BinanceExecutionProvider(FakeClient())
    fee = prov._fee_value([{"commission": 0.001, "commissionAsset": "BNB"}],
                          avg_price=65000.0, notional=1000.0,
                          fallback_rate=0.0012, base_asset="BTC")
    assert fee == pytest.approx(1.2)              # bilinmeyen varlıkta kötümser


# ------------------------------------------------------- motor dayanıklılığı
def test_engine_live_without_keys_never_crashes():
    cfg = AppConfig(price_source="mock", trading_mode="live",
                    live_trading_enabled=True)     # anahtar YOK
    eng = make_engine(cfg, prices=dict(FIXED_PRICES))
    r = eng.run_cycle(prices=dict(FIXED_PRICES))   # exception fırlatmamalı
    assert eng.mode == "live"
    assert any("CANLI MOD BAŞLADI" in e.message for e in r.events)
    assert r.notes, "bakiye senkron hatası nota düşmeli"
    opened = [d for d in r.decisions if d.action == "open"]
    assert opened and all(d.skip_reason for d in opened), \
        "senkron yokken yeni giriş yapılmamalı"
    assert eng.live_sync_ok is False


def test_mode_switch_closes_paper_positions_virtually():
    cfg = AppConfig(price_source="mock", trading_mode="live",
                    live_trading_enabled=True)     # anahtar yok → ağ yok
    eng = make_engine(cfg, prices=dict(FIXED_PRICES))
    pos = PositionState(
        symbol="BTCUSDT", qty=0.01, entry_price=60000.0,
        exec_entry_price=60000.0, cost_basis=600.0, fees=0.7, gas=2.0,
        slippage_cost=2.0, stop_loss=55200.0, take_profit=69000.0,
        opened_at=datetime.now(timezone.utc), strategy="multi_layer_v1",
        final_score=72.0, confidence=0.8,
        layer_scores={"technical": 75}, rationale="test",
    )
    eng.positions.append(pos)
    r = eng.run_cycle(prices=dict(FIXED_PRICES))
    closed = [c for c in r.closed if c["exit_reason"] == "mode_switch"]
    assert closed, "paper pozisyon mod geçişinde sanal kapanmalı"
    assert eng.positions == []
    assert eng.mode == "live"


def test_paper_mode_unchanged_by_live_code():
    """Varsayılan (paper) modda sağlayıcı hâlâ sanaldır — regresyon."""
    _live_provider_cache.clear()
    eng = make_engine(AppConfig(price_source="mock"))
    r = eng.run_cycle(prices=dict(FIXED_PRICES))
    assert eng.mode == "paper"
    assert eng.live_sync_ok is True
    assert not any("CANLI MOD" in e.message for e in r.events)
