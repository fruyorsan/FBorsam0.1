import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import time
from datetime import datetime, timezone
from paperbot.config import AppConfig
from paperbot.db import make_engine, make_session_factory, init_db
from paperbot.data.base import HttpFetcher
from paperbot.data.onchain import build_onchain_provider
from paperbot.core.onchain import OnchainPipeline
from paperbot.models import Wallet, WalletSnapshot

def test_onchain_live():
    print("=== ETHERSCAN CANLI BALINA CUZDAN TESTI ===")
    cfg = AppConfig()
    engine = make_engine(cfg)
    session_factory = make_session_factory(engine)
    init_db(engine, session_factory, cfg)
    
    fetcher = HttpFetcher(timeout=10, min_interval=0.35)
    provider = build_onchain_provider(cfg, fetcher)
    provider.price_fn = lambda token: 3400.0 if token == "ETH" else 1.0
    
    pipeline = OnchainPipeline(session_factory, provider)
    
    now = datetime.now(timezone.utc)
    summary = pipeline.refresh(now=now)
    print("Tazeleme Özeti:", summary)
    
    with session_factory() as s:
        wallets = s.query(Wallet).all()
        print("\n--- KAYITLI CÜZDANLAR VE VERİ KAYNAKLARI ---")
        for w in wallets:
            last_snap = s.query(WalletSnapshot).filter(WalletSnapshot.wallet_id == w.id).order_by(WalletSnapshot.ts.desc()).first()
            total_usd = last_snap.total_usd if last_snap else 0
            print(f"- {w.label} ({w.wallet_type})")
            print(f"  Adres:  {w.address}")
            print(f"  Kaynak: {w.data_source.upper()} {'(GERÇEK CANLI VERİ)' if w.data_source == 'etherscan' else ''}")
            print(f"  Bakiye: ${total_usd:,.2f}")
            
if __name__ == "__main__":
    test_onchain_live()
