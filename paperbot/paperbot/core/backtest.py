"""Backtest — AYNI strateji/motor kodunu geçmiş veriyle çalıştırır.

Gerçek: Binance halka açık OHLCV (anahtarsız). Erişilemezse sentetik veri.
Çekirdek fark: yalnızca `run_cycle`'a geçmiş fiyat/skorlar verilir;
karar mantığı, maliyet modeli, risk kuralları birebir aynıdır.
"""
from __future__ import annotations

import bisect
import logging
import time
from datetime import datetime, timezone

from ..config import AppConfig
from .decision import RuleBasedDecider
from .metrics import performance_report
from .paper_engine import TradingEngine
from .scoring import LayerRegistry, LayerScore, LAYER_ORDER, MockLayer, TechnicalLayer, _hash_score

log = logging.getLogger("paperbot.backtest")

TF_MIN = {"1h": 60, "4h": 240, "1d": 1440, "1w": 10080, "1M": 43200}
TF_MS = {k: v * 60_000 for k, v in TF_MIN.items()}

# Faz 9 — canlı TechnicalLayer ile AYNI zaman dilimi ağırlıkları:
#   4h %45 (giriş zamanlaması), 1d %30 (ana teyit), 1w %15 + 1M %10 (genel yön)
TECH_TF_PLAN: dict[str, list[tuple[str, float]]] = {
    "short": [("4h", 0.45), ("1d", 0.30), ("1w", 0.15), ("1M", 0.10)],  # 1h/4h taban
    "day": [("1d", 0.75), ("1w", 0.15), ("1M", 0.10)],                  # 1d taban
}

# Backtest penceresinde yetersiz olan uzun TF'ler için minimum tarihçe (gün)
EXT_DAYS = {"1d": 45, "1w": 250, "1M": 960}


def _aggregate(closes: list[float], base_tf: str, target_tf: str) -> tuple[list[float], int]:
    """Base mumlardan hedef zaman dilimi kapanışları üretir (grup sonu kapanış).

    Returns: (tf_closes, ratio) — ratio = hedef/base çarpanı (1 = aynı dilim).
    """
    ratio = max(1, TF_MIN[target_tf] // max(TF_MIN[base_tf], 1))
    if ratio == 1:
        return list(closes), 1
    out = [closes[i] for i in range(ratio - 1, len(closes), ratio)]
    return (out or closes[-1:]), ratio


def _tf_visibility(bars: list, tf: str) -> list[int]:
    """Bar k'nın skorunun görünür olduğu zaman damgası = barın kapandığı an.

    Son bar için nominal TF süresi kullanılır; 1M'de 31 gün (asla erken
    görünmez → lookahead yok).
    """
    fallback = 2_678_400_000 if tf == "1M" else TF_MS.get(tf, 3_600_000)
    return [bars[k + 1][0] if k + 1 < len(bars) else bars[k][0] + fallback
            for k in range(len(bars))]


def _combined_technical_series(closes: list[float], interval: str,
                               base_ts: list[int] | None = None,
                               tf_bars: dict[str, list] | None = None) -> list[float]:
    """Çoklu zaman dilimi teyitli teknik skor serisi (backtest için).

    Canlı `TechnicalLayer` ile aynı ağırlıklar kullanılır (Faz 9):
    4h %45 + 1d %30 + 1w %15 + 1M %10 (1h tabanında 4h'ye çekilir).

    Bar i'nin skoru yalnızca o ana kadar verilerle hesaplanır (causal):
    higher-TF skoru yalnızca ilgili bar KAPANDIKTAN sonra görünür.
    `tf_bars` (genişletilmiş uzun TF tarihçesi) + `base_ts` verilirse gerçek
    zaman damgasıyla hizalanır; verilmezse taban seriden toplanır (offline test).
    """
    tech = TechnicalLayer()
    if base_ts is None:
        tf_bars = None                       # hizalama için zaman damgası şart
    if interval in ("1h", "4h"):
        plan = TECH_TF_PLAN["short"]
    elif interval == "1d":
        plan = TECH_TF_PLAN["day"]
    else:
        plan = [(interval, 1.0)]

    base_ms = TF_MIN.get(interval, 60) * 60_000
    parts: list[tuple[list[int] | None, list, float, int]] = []
    for tf, w in plan:
        if tf == interval:
            parts.append((None, tech._score_series(closes), w, 1))
            continue
        bars = (tf_bars or {}).get(tf)
        if bars:
            scores = tech._score_series([b[4] for b in bars])
            parts.append((_tf_visibility(bars, tf), scores, w, 0))
            continue
        tf_closes, ratio = _aggregate(closes, interval, tf)
        parts.append((None, tech._score_series(tf_closes), w, ratio))

    out = []
    for i in range(len(closes)):
        decision_ts = base_ts[i] + base_ms if base_ts else None
        acc = 0.0
        for vis, scores, w, ratio in parts:
            if ratio == 1:
                idx = i
            elif vis is not None:
                idx = bisect.bisect_right(vis, decision_ts) - 1 if decision_ts is not None else -1
                if idx < 0:
                    acc += w * 50.0           # uzun tarihçe henüz yok → nötr (canlı gibi)
                    continue
            else:
                idx = i // ratio - 1          # grup kapanınca görünür (lookahead yok)
            idx = max(0, min(idx, len(scores) - 1))
            acc += w * scores[idx][0]
        out.append(acc)
    return out


def _mock_score_at(symbol: str, layer: str, ts_seconds: float,
                   lo: float = 35.0, hi: float = 90.0) -> LayerScore:
    """Mock katmanların geçmişe dönük deterministik skoru."""
    bucket = int(ts_seconds // (6 * 3600))
    score = _hash_score(symbol, layer, bucket, lo=lo, hi=hi)
    details = {"mock": True, "note": "Backtest: örnek/mock katman verisi", "bucket": bucket}
    if layer == "risk":
        if _hash_score(symbol, "risk_flag", bucket // 4) < 0.15:
            score = min(score, 38.0)
            details["uyarı"] = "Mock: olumsuz güvenlik sinyali simülasyonu"
    if layer == "onchain":
        details["mock_wallet_sinyali"] = "Faz 2'de gerçek cüzdan verisiyle değişecek"
    return LayerScore(layer, max(0.0, min(100.0, score)), "mock", details)


def run_backtest(symbols: list[str], days: int, interval: str,
                 cfg: AppConfig, feed, registry: LayerRegistry,
                 decider: RuleBasedDecider) -> dict:
    """Backtest'i çalıştırır; metrik + eğri + işlemler döndürür."""
    t0 = time.time()
    interval = interval if interval in TF_MIN else "1h"
    days = max(1, min(days, 1825))

    # 1) geçmiş veri
    history: dict[str, list] = {}
    synthetic_used = []
    for sym in symbols:
        bars = feed.historical_ohlcv(sym, interval, days)
        if not bars or len(bars) < 60:
            continue
        history[sym] = bars
    if not history:
        return {"error": "Backtest için yeterli geçmiş veri bulunamadı",
                "symbols": symbols}

    # hizalama: en kısa seri üzerinden
    n = min(len(b) for b in history.values())
    if n < 60:
        return {"error": f"Yeterli bar yok (en kısa seri: {n})", "symbols": list(history)}

    closes = {sym: [b[4] for b in bars[-n:]] for sym, bars in history.items()}
    timestamps = [b[0] for b in list(history.values())[0][-n:]]
    used_symbols = sorted(history.keys())

    # sentetik veri tespiti: feed mock'a düştüyse uyar
    if (getattr(feed, "source", "auto") == "mock"):
        synthetic_used = used_symbols

    # 2) teknik skor serileri (bir kez hesaplanır — O(N))
    # Faz 9: uzun zaman dilimleri (1w/1M) için pencere ötesi tarihçe çekilir ki
    # backtest, canlıyla AYNI 4 zaman dilimi ağırlığını kullansın.
    tf_bars: dict[str, dict[str, list]] = {}
    for sym in used_symbols:
        got: dict[str, list] = {}
        for tf, need in EXT_DAYS.items():
            if tf == interval or (tf == "1d" and days >= need):
                continue                      # yeterli pencere varsa taban toplama kullanılır
            bars = feed.historical_ohlcv(sym, tf, max(days, need))
            if bars and len(bars) >= 5:
                got[tf] = bars
        tf_bars[sym] = got

    tech_series = {sym: _combined_technical_series(
        closes[sym], interval, base_ts=timestamps, tf_bars=tf_bars.get(sym))
        for sym in used_symbols}

    # 3) motoru geçmişe bağla (aynı kod, farklı veri)
    bt_cfg = AppConfig(**{**cfg.__dict__})   # kopya — canlı ayarlardan bağımsız kalmasın
    # GÜVENLİK: backtest ASLA gerçek emir göndermez
    bt_cfg.trading_mode = "paper"
    bt_cfg.live_trading_enabled = False
    engine = TradingEngine(cfg=bt_cfg, feed=feed, registry=registry,
                           decider=decider, session_factory=None, notifier=None)

    snapshots: list[dict] = []
    action_counts = {"open": 0, "exit": 0, "hold": 0, "risk_block": 0}
    score_sum = {k: 0.0 for k in LAYER_ORDER}
    decisions_n = 0

    for i in range(n):
        now = datetime.fromtimestamp(timestamps[i] / 1000, tz=timezone.utc)
        prices = {sym: closes[sym][i] for sym in used_symbols}
        scores: dict[str, dict[str, LayerScore]] = {}
        for sym in used_symbols:
            t_score = tech_series[sym][i]
            scores[sym] = {
                "technical": LayerScore("technical", t_score, "live",
                                        {"backtest": True, "multi_tf": True}),
            }
            for layer in ("onchain", "defi", "risk", "sentiment", "macro"):
                scores[sym][layer] = _mock_score_at(sym, layer, timestamps[i] / 1000)

        result = engine.run_cycle(now=now, prices=prices, scores=scores,
                                  symbols=used_symbols, record=False)
        snapshots.append({"ts": now.isoformat(), "equity": result.equity,
                          "cash": result.cash, "open_count": result.open_count})
        for d in result.decisions:
            action_counts[d.action] = action_counts.get(d.action, 0) + 1
            decisions_n += 1
            for k in LAYER_ORDER:
                score_sum[k] += d.layer_scores.get(k, 50.0)

    # 4) açık pozisyonları son fiyattan kapat (gerçekçi rapor için)
    last_prices = {sym: closes[sym][-1] for sym in used_symbols}
    for p in list(engine.positions):
        engine._close_position(p, last_prices.get(p.symbol, p.entry_price),
                               "backtest_end", bt_cfg)
    final_equity = engine.equity(last_prices)
    snapshots.append({
        "ts": datetime.fromtimestamp(timestamps[-1] / 1000, tz=timezone.utc).isoformat(),
        "equity": final_equity, "cash": engine.cash, "open_count": 0,
    })

    # 5) rapor
    period_seconds = TF_MIN[interval] * 60
    report = performance_report(engine.closed_archive, snapshots,
                                period_seconds=period_seconds,
                                confirmation_score=bt_cfg.confirmation_score)

    # eğriyi seyrelt (grafik için)
    step = max(1, len(snapshots) // 500)
    curve = [{"t": s["ts"], "equity": s["equity"]}
             for s in snapshots[::step]]

    trades = [
        {
            "symbol": t["symbol"], "pnl": round(t["pnl"], 2),
            "opened_at": str(t["opened_at"]), "closed_at": str(t["closed_at"]),
            "exit_reason": t["exit_reason"], "entry_price": t["entry_price"],
            "exit_price": t["exit_price"], "final_score": t["final_score"],
            "layer_scores": t["layer_scores"], "strategy": t["strategy"],
        }
        for t in engine.closed_archive
    ]

    return {
        "ok": True,
        "config": {
            "symbols": used_symbols, "days": days, "interval": interval,
            "start_balance": bt_cfg.start_balance,
            "fee_rate": bt_cfg.fee_rate, "slippage_rate": bt_cfg.slippage_rate,
            "gas_per_trade": bt_cfg.gas_per_trade,
            "max_position_pct": bt_cfg.max_position_pct,
            "max_open_positions": bt_cfg.max_open_positions,
            "stop_loss_pct": bt_cfg.stop_loss_pct,
            "take_profit_pct": bt_cfg.take_profit_pct,
            "adaptive_tp": bt_cfg.adaptive_tp,
            "entry_threshold": bt_cfg.entry_threshold,
            "strategy": "multi_layer_v1",
        },
        "bars": n,
        "metrics": report,
        "decision_counts": action_counts,
        "avg_scores": {k: round(v / max(decisions_n, 1), 1) for k, v in score_sum.items()},
        "equity_curve": curve,
        "trades": trades,
        "synthetic_data": bool(synthetic_used),
        "warnings": (
            ["Geçmiş fiyat verisi alınamadı; SENTETİK veri kullanıldı — "
             "sonuçlar gerçek piyasa koşullarını yansıtmaz."]
            if synthetic_used else []
            + ["On-chain/DeFi/risk/duygu/makro katmanları backtest'te MOCK skor "
               "kullanır (geçmiş bu kaynakların anlık verisi saklanmadığı için; "
               "canlı çevrimde Faz 2-4 katmanları gerçek veriyle çalışır)."]
        ),
        "duration_seconds": round(time.time() - t0, 2),
    }
