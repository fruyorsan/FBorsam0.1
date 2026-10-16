"""Performans metrikleri (gereksinim §2).

- Toplam kâr/zarar, kazanma oranı, ortalama kâr/zarar
- Maksimum düşüş (max drawdown)
- Sharpe oranı (dönem getirilerinden, yıllıklandırılmış)
- İşlem sayısı
- Strateji bazında kırılım
- Sinyal katmanı bazında kırılım: "bu katman güçlüyken açılan işlemler"
  gerçekten kârlı mı? (katmanın katkısını veriyle görme)
"""
from __future__ import annotations

import math
from collections import defaultdict

from .scoring import LAYER_LABELS, LAYER_ORDER


# ------------------------------------------------------------------ yardımcılar
def _trade_dict(t) -> dict:
    if isinstance(t, dict):
        return t
    return {
        "symbol": t.symbol, "pnl": t.pnl, "strategy": t.strategy,
        "layer_scores": t.layer_scores or {}, "exit_reason": t.exit_reason,
        "opened_at": t.opened_at, "closed_at": t.closed_at,
        "final_score": t.final_score, "confidence": t.confidence,
        "cost_basis": t.cost_basis,
        "total_fees": (t.fees or 0) + (t.exit_fees or 0),
        "total_gas": (t.gas or 0) + (t.exit_gas or 0),
        "total_slippage": (t.slippage_cost or 0) + (t.exit_slippage or 0),
    }


def trade_stats(trades: list) -> dict:
    """Kapanmış işlemlerden temel istatistikler."""
    trades = [_trade_dict(t) for t in trades]
    n = len(trades)
    if n == 0:
        return {
            "trade_count": 0, "win_rate": 0.0, "total_pnl": 0.0,
            "avg_pnl": 0.0, "avg_win": 0.0, "avg_loss": 0.0,
            "best_trade": 0.0, "worst_trade": 0.0, "profit_factor": 0.0,
            "total_fees": 0.0, "total_gas": 0.0, "total_slippage": 0.0,
        }
    pnls = [float(t["pnl"]) for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    return {
        "trade_count": n,
        "win_rate": round(len(wins) / n, 4),
        "total_pnl": round(sum(pnls), 2),
        "avg_pnl": round(sum(pnls) / n, 2),
        "avg_win": round(gross_win / len(wins), 2) if wins else 0.0,
        "avg_loss": round(gross_loss / len(losses), 2) if losses else 0.0,
        "best_trade": round(max(pnls), 2),
        "worst_trade": round(min(pnls), 2),
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else (999.99 if gross_win > 0 else 0.0),
        "total_fees": round(sum(float(t.get("total_fees") or 0) for t in trades), 2),
        "total_gas": round(sum(float(t.get("total_gas") or 0) for t in trades), 2),
        "total_slippage": round(sum(float(t.get("total_slippage") or 0) for t in trades), 2),
    }


def equity_stats(snapshots: list, period_seconds: int = 300) -> dict:
    """Zaman serisi (equity curve) üzerinden drawdown ve Sharpe."""
    eq = [float(s["equity"] if isinstance(s, dict) else s.equity) for s in snapshots]
    if len(eq) < 2:
        return {"max_drawdown": 0.0, "sharpe": 0.0, "start_equity": eq[0] if eq else 0.0,
                "end_equity": eq[0] if eq else 0.0, "return_pct": 0.0, "volatility_pct": 0.0}

    peak = eq[0]
    max_dd = 0.0
    for v in eq:
        peak = max(peak, v)
        if peak > 0:
            max_dd = max(max_dd, (peak - v) / peak)

    rets = [eq[i] / eq[i - 1] - 1.0 for i in range(1, len(eq)) if eq[i - 1] > 0]
    if len(rets) >= 2:
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        std = math.sqrt(var)
        periods_per_year = (365.0 * 86_400.0) / max(period_seconds, 1)
        sharpe = (mean / std) * math.sqrt(periods_per_year) if std > 0 else 0.0
        vol_annual_pct = std * math.sqrt(periods_per_year) * 100
    else:
        sharpe, vol_annual_pct = 0.0, 0.0

    return {
        "max_drawdown": round(max_dd, 4),
        "sharpe": round(sharpe, 3),
        "start_equity": round(eq[0], 2),
        "end_equity": round(eq[-1], 2),
        "return_pct": round((eq[-1] / eq[0] - 1.0) * 100, 2) if eq[0] else 0.0,
        "volatility_pct": round(vol_annual_pct, 2),
        "snapshots": len(eq),
    }


# ------------------------------------------------------------- katman karşılaştırma
def layer_comparison(closed_trades: list, layer: str,
                     threshold: float = 60.0) -> dict:
    """`layer` skoru güçlü (>=threshold)ken açılan işlemler vs diğerleri."""
    trades = [_trade_dict(t) for t in closed_trades]
    strong, weak = [], []
    for t in trades:
        score = (t.get("layer_scores") or {}).get(layer)
        if score is None:
            continue
        (strong if float(score) >= threshold else weak).append(t)
    s_stats, w_stats = trade_stats(strong), trade_stats(weak)
    edge_pnl = round(
        (s_stats["avg_pnl"] if s_stats["trade_count"] else 0.0)
        - (w_stats["avg_pnl"] if w_stats["trade_count"] else 0.0), 2)
    edge_win = round(
        ((s_stats["win_rate"] if s_stats["trade_count"] else 0.0)
         - (w_stats["win_rate"] if w_stats["trade_count"] else 0.0)) * 100, 2)
    # katman gerçekten katkı sağlıyor mu?
    if s_stats["trade_count"] > 0 and w_stats["trade_count"] > 0:
        contributes = edge_pnl > 0 and edge_win >= 0
    elif s_stats["trade_count"] == 0:
        contributes = None            # yeterli örnek yok
    else:
        contributes = s_stats["win_rate"] >= 0.5
    return {
        "layer": layer,
        "label": LAYER_LABELS.get(layer, layer),
        "threshold": threshold,
        "with_signal": s_stats,        # sinyali OLAN işlemler
        "without_signal": w_stats,     # sinyali OLMAYAN işlemler
        "edge_pnl_per_trade": edge_pnl,
        "edge_win_rate": edge_win,
        "contributes": contributes,
    }


def performance_report(closed_trades: list, snapshots: list,
                       period_seconds: int = 300,
                       confirmation_score: float = 60.0) -> dict:
    """Genel + strateji bazlı + katman bazlı performans raporu."""
    trades = [_trade_dict(t) for t in closed_trades]
    overall = trade_stats(trades)
    overall.update(equity_stats(snapshots, period_seconds))

    # strateji bazında
    by_strategy: dict[str, list] = defaultdict(list)
    for t in trades:
        by_strategy[t.get("strategy") or "bilinmiyor"].append(t)
    strategy_report = {}
    for strat, ts in by_strategy.items():
        strategy_report[strat] = trade_stats(ts)

    # katman bazında (katkısı var mı görünür olsun)
    layer_report = {}
    for layer in LAYER_ORDER:
        layer_report[layer] = layer_comparison(trades, layer, confirmation_score)

    # çıkış nedeni kırılımı
    by_exit = defaultdict(list)
    for t in trades:
        by_exit[t.get("exit_reason") or "?"].append(t)
    exit_report = {k: trade_stats(v) for k, v in by_exit.items()}

    return {
        "overall": overall,
        "by_strategy": strategy_report,
        "by_layer": layer_report,
        "by_exit_reason": exit_report,
        "period_seconds": period_seconds,
    }


def daily_summary(closed_trades: list, snapshots: list, day: str) -> dict:
    """Günlük özet rapor verisi."""
    trades = [_trade_dict(t) for t in closed_trades
              if str(t.get("closed_at") or "").startswith(day)]
    stats = trade_stats(trades)
    eq = [float(s["equity"] if isinstance(s, dict) else s.equity) for s in snapshots]
    day_eq = [float(s["equity"] if isinstance(s, dict) else s.equity)
              for s in snapshots
              if str(s["ts"] if isinstance(s, dict) else s.ts).startswith(day)]
    stats["day_start_equity"] = round(day_eq[0], 2) if day_eq else (round(eq[0], 2) if eq else 0.0)
    stats["day_end_equity"] = round(day_eq[-1], 2) if day_eq else (round(eq[-1], 2) if eq else 0.0)
    stats["day_pnl"] = round(stats["day_end_equity"] - stats["day_start_equity"], 2) \
        if day_eq and day_eq[0] else 0.0
    stats["day"] = day
    return stats
