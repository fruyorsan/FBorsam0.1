import json

def simulate_compound():
    with open('paperbot/backtest_result.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    trades = data.get('trades', [])
    # 60 days total in backtest (36 trades total), so ~1 month (30 days) is 18 trades
    one_month_trades = trades[-18:] if len(trades) >= 18 else trades
    
    print("=" * 70)
    print("60 TL (VEYA 60$) BAŞLANGIÇ İLE 1 AYLIK BİLEŞİK GETİRİ (ÜSTÜNE KATARAK) RAPORU")
    print("=" * 70)
    print(f"Toplam 1 Aylık Kapanan İşlem: {len(one_month_trades)}")
    
    # 1. Senaryo: Tek Slot (Tüm sermayeyi tek işleme yatırıp kârı ana paraya katarak / Full Compounding)
    bal_single = 60.0
    
    # 2. Senaryo: 2 Slot (Sermayeyi 2'ye bölüp kârı ana paraya katarak / Balanced Compounding)
    bal_split = 60.0
    
    wins = 0
    losses = 0
    
    for i, t in enumerate(one_month_trades, 1):
        entry = t.get('entry_price', 1.0)
        exit_p = t.get('exit_price', 1.0)
        pnl_pct = ((exit_p - entry) / entry) * 100.0
        
        sym = t.get('symbol', 'CRYPTO')
        reason = t.get('exit_reason', 'close')
        
        # 1 slot compound (100% sermaye işleme girer, kâr/zarar kasaya eklenir)
        gain_single = bal_single * (pnl_pct / 100.0)
        bal_single += gain_single
        
        # 2 slots compound (kasanın %50'si ile işleme girilir, kâr/zarar kasaya eklenir)
        gain_split = (bal_split * 0.5) * (pnl_pct / 100.0)
        bal_split += gain_split
        
        if pnl_pct > 0:
            wins += 1
            res_str = f"+%{pnl_pct:.2f} ({reason})"
        else:
            losses += 1
            res_str = f"%{pnl_pct:.2f} ({reason})"
            
        print(f"İşlem #{i:02d} | {sym:8s} | {res_str:22s} | Tek Slot: {bal_single:7.2f} TL | 2 Slot: {bal_split:7.2f} TL")
        
    win_rate = (wins / len(one_month_trades)) * 100 if one_month_trades else 0
    profit_single = bal_single - 60.0
    profit_pct_single = (profit_single / 60.0) * 100.0
    
    profit_split = bal_split - 60.0
    profit_pct_split = (profit_split / 60.0) * 100.0

    print("=" * 70)
    print(f"KAZANMA ORANI: %{win_rate:.1f} ({wins} Kârlı / {losses} Stop)")
    print(f"1) TEK SLOT (Full Bileşik):   60.00 TL  --->  {bal_single:.2f} TL  (Net Kâr: +{profit_single:.2f} TL, %{profit_pct_single:+.1f})")
    print(f"2) 2 SLOT (Dengeli Kasa):     60.00 TL  --->  {bal_split:.2f} TL  (Net Kâr: +{profit_split:.2f} TL, %{profit_pct_split:+.1f})")
    print("=" * 70)

if __name__ == '__main__':
    simulate_compound()
