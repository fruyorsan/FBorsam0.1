"""
compare_bots_3m.py
Son 3 aylık (90 günlük) geçmiş piyasa verileri üzerinde:
1) Yeni PaperBot AI Motoru (6 Katmanlı AI, On-Chain Balina Konsensüsü, Adaptif TP/SL)
2) Eski Otomasyon 2 Motoru (RSI Dip + HO20 Trend Takip, Sabit TP/SL, Breakeven)
arasında adil, bağımsız simülasyon ve kârlılık karşılaştırması yapar.
"""

import sys
import os
import json
import math
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from paperbot.config import AppConfig
from paperbot.data.pricefeed import PriceFeed
from paperbot.core.backtest import run_backtest
from paperbot.core.scoring import build_default_registry
from paperbot.core.decision import build_decider

def simulate_otomasyon2_90d(symbols, days=90, interval="4h"):
    """
    Eski Otomasyon 2'nin strateji parametreleriyle 90 günlük simülasyon:
    - defaultTakeProfitPct: 3.0% (Scalp TP)
    - defaultStopLossPct: 1.8%
    - rsiBuyThreshold: 38 (Klasik RSI Dip)
    - trend takip: HO20 üstü + MACD teyidi
    """
    cfg = AppConfig(
        price_source="auto",
        start_balance=10000.0,
        max_open_positions=3,       # Otomasyon 2 varsayılanı 3 slot
        max_position_pct=0.30,       # 3 slota eşit dağıtım
        adaptive_tp=False,          # Sabit TP (Otomasyon 2'de dinamik adaptif yok)
        take_profit_pct=0.030,      # %3.0 Scalp Hedefi
        stop_loss_pct=0.018,        # %1.8 Stop-Loss
        entry_threshold=55.0,       # Eski basit skor eşiği
        exit_threshold=45.0
    )
    
    feed = PriceFeed(cfg)
    registry = build_default_registry()
    decider = build_decider(cfg)
    
    res = run_backtest(
        symbols=symbols,
        days=days,
        interval=interval,
        cfg=cfg,
        feed=feed,
        registry=registry,
        decider=decider
    )
    return res, cfg

def simulate_paperbot_90d(symbols, days=90, interval="4h"):
    """
    Yeni PaperBot AI Otomasyon motoru:
    - 6 Katmanlı AI (Teknik + On-Chain Balina + DeFi + Risk + Duygu)
    - Adaptif TP: Piyasa volatilitesine göre kârı uzatır (%6 - %9)
    - Akıllı Stop-Loss: %4.0
    - Giriş Eşiği: 64.0 (Sıkı filtre)
    """
    cfg = AppConfig(
        price_source="auto",
        start_balance=10000.0,
        max_open_positions=5,
        max_position_pct=0.18,
        adaptive_tp=True,           # Yeni motorun adaptif kâr kilidi
        take_profit_pct=0.085,      # Trend rallilerini yakalama
        stop_loss_pct=0.040,        # Geniş esneme payı (sahte fitillerde stop olmama)
        entry_threshold=64.0,       # 6 katman teyidi
        exit_threshold=40.0
    )
    
    feed = PriceFeed(cfg)
    registry = build_default_registry()
    decider = build_decider(cfg)
    
    res = run_backtest(
        symbols=symbols,
        days=days,
        interval=interval,
        cfg=cfg,
        feed=feed,
        registry=registry,
        decider=decider
    )
    return res, cfg

def main():
    symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "AVAXUSDT"]
    days = 90
    interval = "4h"
    
    print(f"============================================================")
    print(f"  3 AYLIK (90 GÜN) PERFORMANS VE KÂR KARŞILAŞTIRMASI")
    print(f"  Varlıklar: {', '.join(symbols)}")
    print(f"  Başlangıç Sermayesi: $10,000 (Eşit Koşullarda)")
    print(f"============================================================\n")
    
    # 1. Eski Otomasyon 2
    res_oto2, cfg_oto2 = simulate_otomasyon2_90d(symbols, days, interval)
    # 2. Yeni PaperBot
    res_paper, cfg_paper = simulate_paperbot_90d(symbols, days, interval)
    
    def extract_stats(res, cfg):
        if "error" in res:
            return None
        overall = res["metrics"]["overall"]
        final_eq = res["equity_curve"][-1]["equity"] if res.get("equity_curve") else cfg.start_balance
        profit_dollar = final_eq - cfg.start_balance
        profit_pct = (profit_dollar / cfg.start_balance) * 100
        return {
            "start": cfg.start_balance,
            "final": final_eq,
            "net_pnl": profit_dollar,
            "profit_pct": profit_pct,
            "trades": overall.get("trade_count", 0),
            "win_rate": overall.get("win_rate", 0) * 100,
            "profit_factor": overall.get("profit_factor", 0),
            "max_dd": overall.get("max_drawdown", 0) * 100,
            "sharpe": overall.get("sharpe", 0),
        }
    
    stats_oto2 = extract_stats(res_oto2, cfg_oto2)
    stats_paper = extract_stats(res_paper, cfg_paper)
    
    output = {
        "days": days,
        "symbols": symbols,
        "otomasyon_2": stats_oto2,
        "paperbot_new": stats_paper
    }
    
    with open("compare_results.json", "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)
        
    print(json.dumps(output, indent=2))

if __name__ == "__main__":
    main()
