"""Veritabanı oturumu ve başlangıç kurulumu (seed)."""
from __future__ import annotations

import json
import logging
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from .config import DEFAULT_ASSETS, AppConfig
from .models import Asset, Base, SystemState

log = logging.getLogger("paperbot.db")


def make_engine(cfg: AppConfig):
    url = cfg.database_url
    if url.startswith("sqlite:///"):
        db_path = Path(url.replace("sqlite:///", "", 1))
        if db_path != Path(":memory:"):
            db_path.parent.mkdir(parents=True, exist_ok=True)
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args, future=True)
    return engine


def make_session_factory(engine) -> sessionmaker:
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)


def init_db(engine, session_factory: sessionmaker, cfg: AppConfig) -> None:
    Base.metadata.create_all(engine)
    _migrate(engine)
    with Session(engine) as s:
        _seed_assets(s)
        _seed_state(s, cfg)
        _seed_wallets(s)
        s.commit()
    log.info("Veritabanı hazır: %s", cfg.database_url)


def _migrate(engine) -> None:
    """Var olan tablolara eksik kolonları ekler (Faz 1 → Faz 2 geçişi vb.)."""
    from sqlalchemy import inspect, text

    wanted = {
        "wallets": {
            "hit_rate": "FLOAT", "signals_hit": "INTEGER", "signals_miss": "INTEGER",
            "signals_total": "INTEGER", "data_source": "VARCHAR(24)",
            "last_snapshot_at": "TIMESTAMP",
        },
        "wallet_activities": {"evaluated": "BOOLEAN DEFAULT FALSE"},
    }
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for table, cols in wanted.items():
        if table not in existing_tables:
            continue
        have = {c["name"] for c in inspector.get_columns(table)}
        for name, ddl in cols.items():
            if name in have:
                continue
            try:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
                log.info("Migration: %s.%s eklendi", table, name)
            except Exception as e:  # noqa: BLE001 — kolon zaten varsa sessiz geç
                log.warning("Migration atlandı (%s.%s): %s", table, name, e)


def _seed_assets(s: Session) -> None:
    existing = {r.symbol for r in s.execute(select(Asset)).scalars()}
    for i, (sym, cg_id, name, cat) in enumerate(DEFAULT_ASSETS):
        if sym not in existing:
            s.add(Asset(symbol=sym, coingecko_id=cg_id, name=name,
                        category=cat, enabled=True, sort_order=i))


def _seed_state(s: Session, cfg: AppConfig) -> None:
    defaults = {
        "cash": str(cfg.start_balance),
        "kill_switch": "0",
        "daily_halt": "0",
        "day_key": "",
        "day_start_equity": str(cfg.start_balance),
        "last_cycle_at": "",
        "last_summary_key": "",
        "last_weekly_key": "",
        "last_hit_eval_key": "",
    }
    for k, v in defaults.items():
        if s.get(SystemState, k) is None:
            s.add(SystemState(key=k, value=v))


# Gerçek Takip Cüzdanları (Arkham Intelligence & Lookonchain onaylı Akıllı Para / Top Traders)
# Borsa cüzdanları ('exchange') sinyal üretmez; yalnızca borsa akış yönünü takip eder.
EXAMPLE_WALLETS = [
    ("0x3cD751E6b0078Be393132286c442345e5DC49699", "Smart Accumulator Whale 0x3cD", "smart_money",
     "Arkham etiketli yüksek kârlı swing trader balinası (52+ ETH)"),
    ("0x94845333028B1204Fbe14E1278Fd4Adde46B22ce", "Lookonchain Smart Trader 0x948", "smart_money",
     "Lookonchain tarafından tespit edilmiş yüksek isabetli akıllı para"),
    ("0xeB2629a2734e272Bcc07BDA959863f316F4bD4Cf", "Animoca Brands Smart Fund", "fund",
     "Kurumsal akıllı fon ve stratejik DeFi likidite sağlayıcısı"),
    ("0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B", "Gnosis Safe Multi-Sig Treasury", "smart_money",
     "Merkeziyetsiz hazine ve akıllı para sermaye havuzu"),
    ("0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a", "Arbitrum Multi-Sig Whale", "smart_money",
     "DeFi hazine ve ekosistem akıllı para rezervi"),
    ("0x28c6c06298d514db089934071355e5743bf21d60", "Binance 14 Borsa Akışı", "exchange",
     "Borsa cüzdanı — akıllı para SAYILMAZ; yalnızca borsa giriş/çıkış akışını ölçer"),
]

# Tüm cüzdanlar gerçek canlı adreslerdir
LIVE_SEED_ADDRESSES = {addr for addr, _, _, _ in EXAMPLE_WALLETS}


def _seed_wallets(s: Session) -> None:
    """Cüzdan listesi boşsa örnek takip listesi oluşturur (örnek etiketli)."""
    from .models import Wallet, WalletActivity, WalletSnapshot
    import time as _time
    if s.query(Wallet).count() > 0:
        return
    now = _time.time()
    for addr, label, wtype, note in EXAMPLE_WALLETS:
        w = Wallet(address=addr, label=label, wallet_type=wtype, notes=note,
                   is_active=True, data_source="mock")
        s.add(w)
        s.flush()
        # İlk fark tespiti hemen çalışsın diye "önceki bucket" anlık görüntüsü
        # eklenir — canlı seed adreslerde ilk tazeleme temiz başlasın diye ATILMAZ
        if addr in LIVE_SEED_ADDRESSES:
            continue
        from .data.onchain import mock_holdings
        prev = mock_holdings(addr, now - 6 * 3600)
        s.add(WalletSnapshot(wallet_id=w.id, ts=_dt_utcnow(),
                             holdings=prev, total_usd=sum(prev.values()),
                             source="mock"))
    log.info("Örnek cüzdan listesi eklendi (%d cüzdan)", len(EXAMPLE_WALLETS))


def _dt_utcnow():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)


def get_state(s: Session, key: str, default: str = "") -> str:
    row = s.get(SystemState, key)
    return row.value if row else default


def set_state(s: Session, key: str, value: str) -> None:
    row = s.get(SystemState, key)
    if row is None:
        s.add(SystemState(key=key, value=value))
    else:
        row.value = value


def get_state_json(s: Session, key: str, default):
    try:
        return json.loads(get_state(s, key, json.dumps(default)))
    except (ValueError, TypeError):
        return default
