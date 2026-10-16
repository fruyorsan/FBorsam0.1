import sys
import os
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from paperbot.config import AppConfig
from paperbot.data.pricefeed import PriceFeed
from paperbot.core.backtest import run_backtest
from paperbot.core.scoring import build_default_registry
from paperbot.core.decision import build_decider

def run_test(interval="4h", days=60, symbols=None):
    if symbols is None:
        symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "AVAXUSDT"]
        
    cfg = AppConfig(
        price_source="auto",
        start_balance=10000.0,
        max_open_positions=5,
        max_position_pct=0.15,
        adaptive_tp=True,
        stop_loss_pct=0.04,
        take_profit_pct=0.09,
        entry_threshold=64.0,
        exit_threshold=40.0
    )
    
    feed = PriceFeed(cfg)
    registry = build_default_registry()
    decider = build_decider(cfg)
    
    print(f"\n--- Backtest: {interval} periyot, {days} gün, {len(symbols)} coin ---")
    res = run_backtest(
        symbols=symbols,
        days=days,
        interval=interval,
        cfg=cfg,
        feed=feed,
        registry=registry,
        decider=decider
    )
    
    if "error" in res:
        print("Hata:", res["error"])
        return None
        
    overall = res["metrics"]["overall"]
    final_eq = res["equity_curve"][-1]["equity"] if res.get("equity_curve") else cfg.start_balance
    profit_dollar = final_eq - cfg.start_balance
    profit_pct = (profit_dollar / cfg.start_balance) * 100
    
    print(f"Bitiş Sermayesi:      ${final_eq:,.2f}")
    print(f"Net Kâr / Zarar:      ${profit_dollar:+,.2f} (%{profit_pct:+.2f})")
    print(f"Toplam İşlem Sayısı:  {overall.get('trade_count', 0)}")
    print(f"Kazanma Oranı (Win):  %{overall.get('win_rate', 0)*100:.1f}")
    print(f"Kâr Faktörü:          {overall.get('profit_factor', 0):.2f}")
    print(f"Sharpe Oranı:         {overall.get('sharpe', 0):.2f}")
    print(f"Maksimum Drawdown:    %{overall.get('max_drawdown', 0)*100:.2f}")
    print(f"Gerçek Binance Veri:  {'EVET' if not res.get('synthetic_data') else 'Sentetik'}")
    
    return {
        "interval": interval,
        "days": days,
        "start_balance": cfg.start_balance,
        "final_equity": round(final_eq, 2),
        "net_profit": round(profit_dollar, 2),
        "profit_pct": round(profit_pct, 2),
        "trade_count": overall.get("trade_count", 0),
        "win_rate": round(overall.get("win_rate", 0) * 100, 1),
        "profit_factor": round(overall.get("profit_factor", 0), 2),
        "sharpe": round(overall.get("sharpe", 0), 2),
        "max_drawdown": round(overall.get("max_drawdown", 0) * 100, 2),
        "is_real_binance": not res.get("synthetic_data", False),
        "trades": res.get("trades", [])[:15],
        "equity_curve": res.get("equity_curve", [])[-30:]
    }

if __name__ == "__main__":
    r1 = run_test(interval="4h", days=60)
    if r1:
        with open("backtest_result.json", "w", encoding="utf-8") as f:
            json.dump(r1, f, indent=2)
