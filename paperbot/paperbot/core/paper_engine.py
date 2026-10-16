"""SANAL İŞLEM MOTORU (paper trading) — projenin ana önceliği.

Özellikler (gereksinim §2):
- Ayarlanabilir başlangıç bakiyesi (varsayılan 10.000 USDT)
- Otomatik sanal alım/satım + stop-loss + take-profit
- Gerçekçi maliyet modeli: komisyon, slippage, gas (hepsi ayarlanabilir,
  varsayılanlar kasten kötümser)
- Pozisyon büyüklüğü kuralları: varlık başına maks sermaye oranı,
  eşzamanlı maks açık pozisyon
- Günlük maksimum zarar limiti → yeni işlem açmaz + bildirim
- Kill switch → tek tuşla tüm sistemi durdurur, açık pozisyonları kapatır
- Aynı motor hem CANLI sanal döngüde hem BACKTEST'te çalışır
  (`run_cycle(...)` çağrısı ortak; sadece veri kaynağı ve kayıt modu değişir)

Gerçek para modu (Faz 10): `TRADING_MODE=live` + `LIVE_TRADING_ENABLED=true`
ve .env'deki Binance API anahtarları verilirse `BinanceExecutionProvider`
devreye girer, emirler Binance spot'a gider. Varsayılan: kapalı (paper).
Backtest her koşulda paper moduna zorlanır (çift emniyet kilidi).
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ..config import AppConfig
from .adaptive import adaptive_targets
from .decision import Decision, RuleBasedDecider
from .scoring import LayerRegistry, LayerScore

log = logging.getLogger("paperbot.engine")


class ExecutionDisabled(RuntimeError):
    """Gerçek işlem modu devre dışıyken fırlatılır."""


# ============================================================ ExecutionProvider
@dataclass
class Fill:
    accepted: bool
    price: float = 0.0            # slippage dahil gerçekleşen fiyat
    qty: float = 0.0
    notional: float = 0.0
    fee: float = 0.0
    gas: float = 0.0
    slippage_cost: float = 0.0
    cash_delta: float = 0.0       # alımda negatif, satışta pozitif
    reason: str = ""


class ExecutionProvider(ABC):
    """İşlem yürütme arayüzü.

    Şu an yalnızca sanal (paper) implementasyonu aktiftir. Gerçek borsa/cüzdan
    API'si bağlandığında yeni bir sınıf yazılır ve TRADING_MODE ile seçilir.
    """

    name: str = "abstract"

    @abstractmethod
    def execute(self, side: str, symbol: str, market_price: float,
                qty: float, cfg: AppConfig) -> Fill:
        """side: 'buy' | 'sell'"""


class PaperExecutionProvider(ExecutionProvider):
    """Sanal yürütme: slippage uygular, komisyon + gas'i nakitten düşer."""

    name = "paper"

    def execute(self, side: str, symbol: str, market_price: float,
                qty: float, cfg: AppConfig) -> Fill:
        if qty <= 0 or market_price <= 0:
            return Fill(False, reason="geçersiz miktar/fiyat")
        slip = max(0.0, cfg.slippage_rate)
        if side == "buy":
            exec_p = market_price * (1.0 + slip)
            notional = qty * exec_p
            fee = notional * cfg.fee_rate
            gas = cfg.gas_per_trade
            slippage_cost = qty * market_price * slip
            cash_delta = -(notional + fee + gas)
            return Fill(True, exec_p, qty, notional, fee, gas, slippage_cost, cash_delta)
        exec_p = market_price * (1.0 - slip)
        notional = qty * exec_p
        fee = notional * cfg.fee_rate
        gas = cfg.gas_per_trade
        slippage_cost = qty * market_price * slip
        cash_delta = notional - fee - gas
        return Fill(True, exec_p, qty, notional, fee, gas, slippage_cost, cash_delta)


class LiveExecutionProvider(ExecutionProvider):
    """Yer tutucu — gerçek adaptör `binance_exec.BinanceExecutionProvider`."""

    name = "live"

    def execute(self, side: str, symbol: str, market_price: float,
                qty: float, cfg: AppConfig) -> Fill:
        raise ExecutionDisabled(
            "Bu adaptör yer tutucudur; canlı modda "
            "BinanceExecutionProvider kullanılır.")


# build_provider canlı sağlayıcısını anahtarlara göre önbellekler (her emirde
# yeni HTTP istemcisi açılmasın); anahtar değişirse yeniden kurulur.
_live_provider_cache: dict = {}


def build_provider(cfg: AppConfig) -> ExecutionProvider:
    if str(cfg.trading_mode).lower() == "live" and cfg.live_trading_enabled:
        sig = (cfg.binance_api_key, cfg.binance_api_secret,
               cfg.binance_testnet, cfg.http_timeout)
        cached = _live_provider_cache.get("provider")
        if cached is None or _live_provider_cache.get("sig") != sig:
            from .binance_exec import BinanceExecutionProvider
            provider = BinanceExecutionProvider.from_cfg(cfg)   # anahtar yoksa raise
            _live_provider_cache["provider"] = provider
            _live_provider_cache["sig"] = sig
        return _live_provider_cache["provider"]
    _live_provider_cache.clear()
    return PaperExecutionProvider()


# ================================================================== durum tipleri
@dataclass
class PositionState:
    """Bellekteki açık pozisyon (DB'ye `record=True` iken yazılır)."""
    symbol: str
    qty: float
    entry_price: float            # piyasa fiyatı (slippage hariç)
    exec_entry_price: float       # slippage dahil
    cost_basis: float             # giriş maliyeti (komisyon+gas dahil)
    fees: float
    gas: float
    slippage_cost: float
    stop_loss: float
    take_profit: float
    opened_at: datetime
    strategy: str
    final_score: float
    confidence: float
    layer_scores: dict
    rationale: str
    db_id: int | None = None

    def unrealized(self, price: float) -> float:
        return self.qty * price - self.cost_basis


@dataclass
class CycleEvent:
    kind: str
    symbol: str
    message: str


@dataclass
class CycleResult:
    now: datetime
    prices: dict = field(default_factory=dict)
    price_source: str = ""
    decisions: list = field(default_factory=list)      # Decision[]
    opened: list = field(default_factory=list)          # dict[]
    closed: list = field(default_factory=list)          # dict[]
    equity: float = 0.0
    cash: float = 0.0
    open_count: int = 0
    daily_halt: bool = False
    kill_switch: bool = False
    events: list = field(default_factory=list)          # CycleEvent[]
    notes: list = field(default_factory=list)


# ======================================================================= motor
class TradingEngine:
    """Sanal işlem motoru. Backtest ve canlı sanal mod aynı sınıftır."""

    def __init__(
        self,
        cfg: AppConfig,
        feed,
        registry: LayerRegistry,
        decider: RuleBasedDecider,
        session_factory=None,
        notifier=None,
    ):
        self.cfg = cfg
        self.feed = feed
        self.registry = registry
        self.decider = decider
        self.session_factory = session_factory
        self.notifier = notifier

        # durum
        self.cash: float = cfg.start_balance
        self.positions: list[PositionState] = []
        self.closed_archive: list[dict] = []
        self.kill_switch: bool = False
        self.daily_halt: bool = False
        self.day_key: str = ""
        self.day_start_equity: float = cfg.start_balance
        self.mode: str = "paper"              # son aktif mod (Faz 10 geçiş takibi)
        self.live_sync_ok: bool = True        # canlı bakiye senkronu başarılı mı

        # panel için son çevrim önbelleği
        self.last_result: CycleResult | None = None
        self.last_scores: dict[str, dict] = {}
        self.last_prices: dict[str, float] = {}

        if self.session_factory is not None:
            self._load_state()

    # ----------------------------------------------------------- kalıcılık
    def _load_state(self) -> None:
        from ..db import get_state
        from ..models import Position
        from sqlalchemy import select

        with self.session_factory() as s:
            self.cash = float(get_state(s, "cash", str(self.cfg.start_balance)))
            self.kill_switch = get_state(s, "kill_switch", "0") == "1"
            self.daily_halt = get_state(s, "daily_halt", "0") == "1"
            self.day_key = get_state(s, "day_key", "")
            self.day_start_equity = float(get_state(s, "day_start_equity", str(self.cash)))
            self.mode = get_state(s, "engine_mode", "paper")
            rows = s.execute(select(Position).where(Position.status == "open")).scalars().all()
            self.positions = [
                PositionState(
                    symbol=r.symbol, qty=r.qty, entry_price=r.entry_price,
                    exec_entry_price=r.exec_entry_price, cost_basis=r.cost_basis,
                    fees=r.fees, gas=r.gas, slippage_cost=r.slippage_cost,
                    stop_loss=r.stop_loss, take_profit=r.take_profit,
                    opened_at=r.opened_at, strategy=r.strategy,
                    final_score=r.final_score, confidence=r.confidence,
                    layer_scores=r.layer_scores or {}, rationale=r.rationale,
                    db_id=r.id,
                )
                for r in rows
            ]

    def _save_state(self, result: CycleResult) -> None:
        """Çevrim sonunda değişiklikleri DB'ye yazar."""
        from ..db import set_state
        from ..models import (
            Decision, EquitySnapshot, Notification, Position,
        )

        with self.session_factory() as s:
            set_state(s, "cash", repr(self.cash))
            set_state(s, "kill_switch", "1" if self.kill_switch else "0")
            set_state(s, "daily_halt", "1" if self.daily_halt else "0")
            set_state(s, "day_key", self.day_key)
            set_state(s, "day_start_equity", repr(self.day_start_equity))
            set_state(s, "engine_mode", self.mode)
            set_state(s, "last_cycle_at", result.now.isoformat())

            # pozisyonlar
            for p in self.positions:
                if p.db_id is None:
                    row = Position(
                        symbol=p.symbol, side="long", qty=p.qty,
                        entry_price=p.entry_price, exec_entry_price=p.exec_entry_price,
                        cost_basis=p.cost_basis, fees=p.fees, gas=p.gas,
                        slippage_cost=p.slippage_cost, stop_loss=p.stop_loss,
                        take_profit=p.take_profit, status="open",
                        strategy=p.strategy, final_score=p.final_score,
                        confidence=p.confidence, layer_scores=p.layer_scores,
                        rationale=p.rationale, opened_at=p.opened_at,
                    )
                    s.add(row)
                    s.flush()
                    p.db_id = row.id
                else:
                    row = s.get(Position, p.db_id)
                    if row:
                        row.qty, row.entry_price = p.qty, p.entry_price
                        row.stop_loss, row.take_profit = p.stop_loss, p.take_profit

            for c in result.closed:
                if c.get("db_id"):
                    row = s.get(Position, c["db_id"])
                    if row:
                        row.status = "closed"
                        row.exit_price = c["exit_price"]
                        row.exit_reason = c["exit_reason"]
                        row.pnl = c["pnl"]
                        row.exit_fees = c["exit_fees"]
                        row.exit_gas = c["exit_gas"]
                        row.exit_slippage = c["exit_slippage"]
                        row.closed_at = c["closed_at"]

            for d in result.decisions:
                s.add(Decision(
                    created_at=result.now, symbol=d.symbol, action=d.action,
                    strategy=d.strategy, final_score=d.final_score,
                    confidence=d.confidence, probability=d.probability,
                    risk_level=d.risk_level, layer_scores=d.layer_scores,
                    details=d.details, rationale=d.rationale,
                    executed=d.executed, skip_reason=d.skip_reason,
                ))

            open_value = sum(
                p.qty * result.prices.get(p.symbol, p.entry_price)
                for p in self.positions
            )
            s.add(EquitySnapshot(
                ts=result.now, equity=result.equity, cash=self.cash,
                open_count=len(self.positions), open_value=open_value,
            ))

            for ev in result.events:
                s.add(Notification(ts=result.now, kind=ev.kind, message=ev.message,
                                   delivered=False))
            s.commit()

    # ------------------------------------------------------------- yardımcılar
    @property
    def open_positions(self) -> list[PositionState]:
        return self.positions

    @property
    def _mod(self) -> str:
        """Olay metinlerinde kullanılacak mod etiketi."""
        return "CANLI" if self.mode == "live" else "sanal"

    def _provider(self, cfg: AppConfig):
        """Sağlayıcı kur; devre/dispozisyon hatalarında None (çevrim ölmez)."""
        try:
            return build_provider(cfg)
        except ExecutionDisabled as e:
            log.warning("İşlem sağlayıcı devre dışı: %s", e)
            return None
        except Exception:  # noqa: BLE001 — sağlayıcı hatası çevrimi indirmez
            log.exception("İşlem sağlayıcı kurulamadı")
            return None

    @staticmethod
    def _execute(provider, side: str, symbol: str, price: float,
                 qty: float, cfg: AppConfig) -> Fill:
        if provider is None:
            return Fill(False, reason="işlem sağlayıcı yok (canlı mod anahtarları eksik?)")
        try:
            return provider.execute(side, symbol, price, qty, cfg)
        except ExecutionDisabled as e:
            return Fill(False, reason=str(e))

    def equity(self, prices: dict) -> float:
        return self.cash + sum(
            p.qty * prices.get(p.symbol, p.entry_price) for p in self.positions
        )

    def _enabled_symbols(self) -> list[str]:
        from sqlalchemy import select
        from ..models import Asset

        with self.session_factory() as s:
            rows = s.execute(
                select(Asset.symbol).where(Asset.enabled.is_(True)).order_by(Asset.sort_order)
            ).scalars().all()
        return list(rows)

    def _entry_qty(self, budget: float, price: float, cfg: AppConfig) -> float:
        """Bütçe içinden slippage+komisyon+gas sonrası kalan miktar."""
        if budget <= cfg.gas_per_trade + cfg.min_notional:
            return 0.0
        exec_p = price * (1.0 + cfg.slippage_rate)
        qty = (budget - cfg.gas_per_trade) / (exec_p * (1.0 + cfg.fee_rate))
        if qty <= 0 or qty * exec_p < cfg.min_notional:
            return 0.0
        return qty

    # -------------------------------------------------------------- ana çevrim
    def run_cycle(self, now: datetime | None = None, prices: dict | None = None,
                  scores: dict | None = None, symbols: list[str] | None = None,
                  record: bool | None = None) -> CycleResult:
        """Bir analiz+işlem çevrimi.

        Canlı sanal mod: run_cycle() — fiyatlar/skorlar çekilir, DB'ye yazılır.
        Backtest: run_cycle(now=..., prices=..., scores=..., record=False)
        """
        cfg = self.cfg
        now = now or datetime.now(timezone.utc)
        record = (self.session_factory is not None) if record is None else record
        if symbols is None:
            if prices is not None:
                symbols = list(prices.keys())          # backtest/test: verilen fiyatlar
            elif record:
                symbols = self._enabled_symbols()
            else:
                symbols = list(self.last_prices)

        result = CycleResult(now=now)

        # 1) fiyatlar
        price_source = ""
        if prices is None:
            prices, price_source = self.feed.prices_for(symbols)
        result.prices = dict(prices)
        result.price_source = price_source
        self.last_prices = dict(prices)

        # 2) skorlar
        if scores is None:
            scores = {}
            for sym in symbols:
                scores[sym] = self.registry.compute_all(sym, self.feed, cfg)
        self.last_scores = scores

        # 2b) Faz 10 — mod geçişi (paper <-> live) + canlı bakiye senkronu
        active_mode = ("live" if (str(cfg.trading_mode).lower() == "live"
                                  and cfg.live_trading_enabled) else "paper")
        if active_mode != self.mode:
            self._transition_mode(active_mode, prices, cfg, result)
        self.live_sync_ok = True
        if active_mode == "live":
            provider = self._provider(cfg)
            try:
                if provider is None or not hasattr(provider, "quote_balance"):
                    raise ExecutionDisabled("canlı sağlayıcı kurulamadı")
                self.cash = float(provider.quote_balance())
                log.info("Canlı bakiye senkronize: %.2f USDT", self.cash)
            except Exception as e:  # noqa: BLE001 — senkron hatası çevrimi indirmez
                self.live_sync_ok = False
                note = (f"Borsa bakiyesi alınamadı ({e}) — yeni girişler bu "
                        "çevrimde durduruldu")
                result.notes.append(note)
                log.warning(note)

        equity = self.equity(prices)
        self.combined_equity = equity
        result.equity = equity
        result.cash = self.cash
        result.kill_switch = self.kill_switch

        # 3) KILL SWITCH: tüm pozisyonları kapat, yeni işlem yok
        if self.kill_switch:
            for p in list(self.positions):
                price = prices.get(p.symbol, p.entry_price)
                closed = self._close_position(p, price, "kill_switch", cfg)
                if closed:
                    result.closed.append(closed)
                    result.events.append(CycleEvent(
                        "kill_switch", p.symbol,
                        f"Kill switch: {p.symbol} {self._mod} pozisyonu kapatıldı "
                        f"(PnL {closed['pnl']:+.2f} USDT)"))
            equity = self.equity(prices)
            result.equity, result.cash = equity, self.cash
            result.open_count = len(self.positions)
            result.notes.append("KILL SWITCH aktif — yeni işlem açılmıyor")
            self.last_result = result
            if record:
                self._save_state(result)
                self._deliver_events(result)
            return result

        # 4) kararlar (tüm varlıklar için sinyal üret)
        open_symbols = {p.symbol for p in self.positions}
        decisions: list[Decision] = []
        for sym in symbols:
            if sym not in scores:
                continue
            d = self.decider.decide(sym, scores[sym],
                                    context={"has_position": sym in open_symbols,
                                             "prices": prices})
            decisions.append(d)
        result.decisions = decisions
        dec_by_symbol = {d.symbol: d for d in decisions}

        # 5) ÇIKIŞLAR: stop-loss / take-profit / skor düşüşü
        for p in list(self.positions):
            price = prices.get(p.symbol)
            if price is None:
                log.warning("Fiyat yok, SL/TP kontrolü atlandı: %s", p.symbol)
                continue
            d = dec_by_symbol.get(p.symbol)

            # Faz 8 — Akıllı TP revizyonu: hedef yalnızca YUKARI taşınabilir
            # (kazanç bırakma); aşağı çekilmez ki girişteki disiplin bozulmasın.
            if d is not None and cfg.adaptive_tp:
                tgt = adaptive_targets(cfg, d)
                if tgt["enabled"]:
                    tp_abs = p.exec_entry_price * (1.0 + tgt["tp"])
                    if tp_abs > p.take_profit:
                        if tp_abs > price:
                            log.info(
                                "Akilli TP revizyonu: %s TP %.2f -> %.2f "
                                "(hedef +%.1f%%, fiyat %.4f)",
                                p.symbol, p.take_profit, tp_abs,
                                tgt["tp"] * 100, price)
                            p.take_profit = tp_abs
                        else:
                            log.info(
                                "Akilli TP revizyonu bekliyor: %s hedef %.2f "
                                "<= fiyat %.4f (yukari tasinamaz)",
                                p.symbol, tp_abs, price)

            reason = None
            if price <= p.stop_loss:
                reason = "stop_loss"
            elif price >= p.take_profit:
                reason = "take_profit"
            elif d and d.action == "exit":
                reason = "score_exit"
                d.executed = True
            if reason:
                closed = self._close_position(p, price, reason, cfg)
                if closed:
                    result.closed.append(closed)
                    ev_kind = "take_profit" if reason == "take_profit" else "trade_close"
                    result.events.append(CycleEvent(
                        ev_kind, p.symbol,
                        f"{self._mod.capitalize()} pozisyon kapatıldı: {p.symbol} — {reason}, "
                        f"PnL {closed['pnl']:+.2f} USDT "
                        f"(giriş {closed['entry_price']:.6g} → çıkış {closed['exit_price']:.6g})"))

        # 6) günlük zarar limiti kontrolü (kapanışlar sonrası gerçek bakiyeyle)
        equity = self.equity(prices)
        self._check_daily_loss(equity, result, cfg)

        # 7) GİRİŞLER
        if not self.daily_halt:
            entries = sorted(
                (d for d in decisions if d.action == "open" and d.symbol not in open_symbols),
                key=lambda d: -d.final_score,
            )
            for d in entries:
                price = prices.get(d.symbol)
                if price is None:
                    d.skip_reason = "fiyat verisi yok"
                    continue
                if not self.live_sync_ok:
                    d.skip_reason = "borsa bakiyesi alınamadı — giriş durduruldu"
                    continue
                if len(self.positions) >= cfg.max_open_positions:
                    d.skip_reason = f"maks açık pozisyon ({cfg.max_open_positions})"
                    continue
                if any(p.symbol == d.symbol for p in self.positions):
                    d.skip_reason = "zaten açık pozisyon var"
                    continue
                equity = self.equity(prices)
                budget = min(equity * cfg.max_position_pct, self.cash)
                qty = self._entry_qty(budget, price, cfg)
                if qty <= 0:
                    d.skip_reason = "bütçe/miktar yetersiz"
                    continue

                fill = self._buy(d.symbol, price, qty, cfg)
                if not fill.accepted:
                    d.skip_reason = fill.reason or "işlem reddedildi"
                    continue

                # Faz 8 — Akıllı TP/SL: hedef varlığın volatilitesine, güvene,
                # balina sinyaline ve risk seviyesine göre girişte kesinleşir.
                tgt = adaptive_targets(cfg, d)
                if tgt["enabled"]:
                    d.rationale = f"{d.rationale}\n{tgt['summary']}"

                pos = PositionState(
                    symbol=d.symbol, qty=fill.qty, entry_price=price,
                    exec_entry_price=fill.price, cost_basis=-fill.cash_delta,
                    fees=fill.fee, gas=fill.gas, slippage_cost=fill.slippage_cost,
                    stop_loss=fill.price * (1.0 - tgt["sl"]),
                    take_profit=fill.price * (1.0 + tgt["tp"]),
                    opened_at=now, strategy=d.strategy, final_score=d.final_score,
                    confidence=d.confidence, layer_scores=d.layer_scores,
                    rationale=d.rationale,
                )
                self.positions.append(pos)
                d.executed = True
                result.opened.append({
                    "symbol": d.symbol, "qty": fill.qty, "price": fill.price,
                    "cost": -fill.cash_delta, "fee": fill.fee, "gas": fill.gas,
                    "slippage": fill.slippage_cost, "opened_at": now.isoformat(),
                    "final_score": d.final_score, "rationale": d.rationale,
                })
                result.events.append(CycleEvent(
                    "trade_open", d.symbol,
                    f"Yeni {self._mod} işlem AÇILDI: {d.symbol} × {fill.qty:.6g} @ "
                    f"{fill.price:.6g} (maliyet {-fill.cash_delta:.2f} USDT, "
                    f"skor {d.final_score:.1f}, güven %{d.confidence*100:.0f})"))
        else:
            for d in decisions:
                if d.action == "open" and d.symbol not in open_symbols:
                    d.skip_reason = "GÜNLÜK ZARAR LİMİTİ AŞILDI — girişler durduruldu"

        # 8) LLM zenginleştirme (varsa) — yalnızca aksiyon üreten kararlarda
        for d in decisions:
            if d.action in ("open", "exit", "risk_block"):
                self.decider.refine_with_llm(d)

        # 9) özet
        equity = self.equity(prices)
        result.equity = equity
        result.cash = self.cash
        result.open_count = len(self.positions)
        result.daily_halt = self.daily_halt
        self.last_result = result

        if record:
            self._save_state(result)
            self._deliver_events(result)
        return result

    # ---------------------------------------------------------------- işlemler
    def _buy(self, symbol: str, price: float, qty: float, cfg: AppConfig) -> Fill:
        fill = self._execute(self._provider(cfg), "buy", symbol, price, qty, cfg)
        if fill.accepted:
            self.cash += fill.cash_delta          # negatif
        return fill

    def _close_position(self, p: PositionState, price: float,
                        reason: str, cfg: AppConfig, provider=None) -> dict | None:
        if provider is None:
            provider = self._provider(cfg)
        fill = self._execute(provider, "sell", p.symbol, price, p.qty, cfg)
        if not fill.accepted:
            log.warning("Kapatma reddedildi %s: %s", p.symbol, fill.reason)
            return None
        self.cash += fill.cash_delta
        pnl = fill.cash_delta - p.cost_basis       # net PnL (tüm maliyetler dahil)
        self.positions.remove(p)
        record = {
            "db_id": p.db_id, "symbol": p.symbol, "qty": p.qty,
            "entry_price": p.entry_price, "exec_entry_price": p.exec_entry_price,
            "exit_price": fill.price, "exit_reason": reason, "pnl": pnl,
            "cost_basis": p.cost_basis, "exit_fees": fill.fee, "exit_gas": fill.gas,
            "exit_slippage": fill.slippage_cost, "closed_at": datetime.now(timezone.utc),
            "strategy": p.strategy, "final_score": p.final_score,
            "confidence": p.confidence, "layer_scores": p.layer_scores,
            "opened_at": p.opened_at, "rationale": p.rationale,
            "total_fees": p.fees + fill.fee, "total_gas": p.gas + fill.gas,
            "total_slippage": p.slippage_cost + fill.slippage_cost,
        }
        self.closed_archive.append(record)
        return record

    def _check_daily_loss(self, equity: float, result: CycleResult, cfg: AppConfig) -> None:
        day_key = result.now.strftime("%Y-%m-%d")
        if day_key != self.day_key:
            # yeni gün: limiti sıfırla (günü kapanan Zarar varsa özet bildir)
            self.day_key = day_key
            self.day_start_equity = equity
            if self.daily_halt:
                self.daily_halt = False
                result.events.append(CycleEvent(
                    "system", "-",
                    f"Yeni gün ({day_key}) — günlük zarar limiti sıfırlandı, "
                    "girişler tekrar açıldı"))
        if self.day_start_equity <= 0:
            return
        loss = self.day_start_equity - equity
        if loss / self.day_start_equity >= cfg.daily_max_loss_pct and not self.daily_halt:
            self.daily_halt = True
            pct = loss / self.day_start_equity * 100
            result.events.append(CycleEvent(
                "risk_halt", "-",
                f"⚠ GÜNLÜK MAKS ZARAR LİMİTİ AŞILDI: %{pct:.2f} "
                f"(limit %{cfg.daily_max_loss_pct*100:.0f}, gün başı bakiye "
                f"{self.day_start_equity:.2f} → {equity:.2f} USDT). "
                "Yeni işlem açmaları DURDURULDU. Mevcut pozisyonlar "
                "SL/TP ile yönetilmeye devam eder."))

    def _transition_mode(self, new_mode: str, prices: dict,
                         cfg: AppConfig, result: CycleResult) -> None:
        """paper ↔ live geçişi (Faz 10).

        Açık pozisyonlar SADECE sanal (paper) sağlayıcıyla kapatılır; mod
        değişiminde karşı tarafta yanlışlıkla gerçek emir gitmez.
        """
        prev = self.mode
        paper = PaperExecutionProvider()
        for p in list(self.positions):
            price = prices.get(p.symbol, p.entry_price)
            closed = self._close_position(p, price, "mode_switch", cfg,
                                          provider=paper)
            if closed:
                result.closed.append(closed)
                result.events.append(CycleEvent(
                    "system", p.symbol,
                    f"Mod geçişi ({prev} → {new_mode}): {p.symbol} pozisyonu "
                    f"sanal kayıtla kapatıldı (PnL {closed['pnl']:+.2f} USDT)"))
        if new_mode == "live":
            msg = ("🔴 CANLI MOD BAŞLADI — GERÇEK PARAYLA İŞLEM. Bundan "
                   "sonraki alış/satışlar Binance'te gerçek emirle yapılır.")
        else:
            msg = ("↩ Kağıt moda dönüldü. Önceki CANLI pozisyonlar sanal "
                   "olarak kapatıldı; GERÇEK VARLIKLAR SATILMADI — borsada "
                   "kalan varlıkları manuel yönet (tam kapatma için kill "
                   "switch'i canlı moddayken kullan).")
        result.events.append(CycleEvent("system", "-", msg))
        result.notes.append(msg)
        log.warning("Mod geçişi: %s -> %s", prev, new_mode)
        self.mode = new_mode

    def _deliver_events(self, result: CycleResult) -> None:
        if not self.notifier:
            return
        for ev in result.events:
            try:
                self.notifier.deliver(ev.kind, ev.message)
            except Exception as e:  # noqa: BLE001 — bildirim hatası çevrimi indirmez
                log.warning("Bildirim gönderilemedi (%s): %s", ev.kind, e)
