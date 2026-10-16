"""SQLAlchemy veri modeli — SQLite (varsayılan) ve PostgreSQL ile uyumlu."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    coingecko_id: Mapped[str] = mapped_column(String(80), default="")
    name: Mapped[str] = mapped_column(String(80), default="")
    category: Mapped[str] = mapped_column(String(24), default="major")  # major | defi | other
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_price: Mapped[float] = mapped_column(Float, default=0.0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Setting(Base):
    """Panelde değiştirilebilir ayar geçersiz kılmaları (JSON string değer)."""
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Position(Base):
    """Sanal pozisyon. Kapandığında performans metriklerine girer."""
    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    side: Mapped[str] = mapped_column(String(8), default="long")  # spot: long-only
    qty: Mapped[float] = mapped_column(Float)
    entry_price: Mapped[float] = mapped_column(Float)             # piyasa fiyatı
    exec_entry_price: Mapped[float] = mapped_column(Float)        # slippage dahil gerçek giriş
    cost_basis: Mapped[float] = mapped_column(Float)              # komisyon+gas dahil toplam maliyet
    fees: Mapped[float] = mapped_column(Float, default=0.0)
    gas: Mapped[float] = mapped_column(Float, default=0.0)
    slippage_cost: Mapped[float] = mapped_column(Float, default=0.0)

    stop_loss: Mapped[float] = mapped_column(Float, default=0.0)
    take_profit: Mapped[float] = mapped_column(Float, default=0.0)

    status: Mapped[str] = mapped_column(String(8), default="open", index=True)  # open|closed
    exit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    exit_reason: Mapped[str] = mapped_column(String(32), default="")   # stop_loss|take_profit|score_exit|kill_switch|manual
    pnl: Mapped[float] = mapped_column(Float, default=0.0)
    exit_fees: Mapped[float] = mapped_column(Float, default=0.0)
    exit_gas: Mapped[float] = mapped_column(Float, default=0.0)
    exit_slippage: Mapped[float] = mapped_column(Float, default=0.0)

    strategy: Mapped[str] = mapped_column(String(48), default="multi_layer_v1")
    final_score: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    layer_scores: Mapped[dict] = mapped_column(JSON, default=dict)
    rationale: Mapped[str] = mapped_column(Text, default="")

    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Decision(Base):
    """Her varlık-çevrim için üretilen sinyal/karar kaydı (gerekçesiyle)."""
    __tablename__ = "decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(16), index=True)  # open|exit|hold|risk_block|skip
    strategy: Mapped[str] = mapped_column(String(48), default="multi_layer_v1")
    final_score: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    probability: Mapped[float] = mapped_column(Float, default=0.0)
    risk_level: Mapped[str] = mapped_column(String(16), default="")
    layer_scores: Mapped[dict] = mapped_column(JSON, default=dict)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    rationale: Mapped[str] = mapped_column(Text, default="")
    executed: Mapped[bool] = mapped_column(Boolean, default=False)
    skip_reason: Mapped[str] = mapped_column(String(120), default="")


class EquitySnapshot(Base):
    __tablename__ = "equity_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    equity: Mapped[float] = mapped_column(Float)
    cash: Mapped[float] = mapped_column(Float)
    open_count: Mapped[int] = mapped_column(Integer, default=0)
    open_value: Mapped[float] = mapped_column(Float, default=0.0)


class SystemState(Base):
    """Kill-switch, nakit, günlük durum gibi sistem durumları."""
    __tablename__ = "system_state"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    message: Mapped[str] = mapped_column(Text, default="")
    delivered: Mapped[bool] = mapped_column(Boolean, default=False)  # Telegram'a gitti mi


class Wallet(Base):
    """Takip edilen cüzdanlar (Faz 2: on-chain/akıllı para katmanı)."""
    __tablename__ = "wallets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    address: Mapped[str] = mapped_column(String(120), unique=True)
    label: Mapped[str] = mapped_column(String(120), default="")
    chain: Mapped[str] = mapped_column(String(24), default="ethereum")
    # exchange | market_maker | team_vesting | individual_whale | smart_money | fund
    wallet_type: Mapped[str] = mapped_column(String(32), default="individual_whale")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    # geçmiş isabet oranı — başarılı cüzdanların sinyali daha ağır ağırlıklandırılır
    hit_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    signals_hit: Mapped[int] = mapped_column(Integer, default=0)
    signals_miss: Mapped[int] = mapped_column(Integer, default=0)
    signals_total: Mapped[int] = mapped_column(Integer, default=0)
    data_source: Mapped[str] = mapped_column(String(24), default="mock")  # mock|etherscan
    last_snapshot_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)

    activities: Mapped[list["WalletActivity"]] = relationship(
        back_populates="wallet", cascade="all, delete-orphan"
    )


class WalletSnapshot(Base):
    """Cüzdan portföy anlık görüntüsü — değişiklik (delta) tespiti için."""
    __tablename__ = "wallet_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wallet_id: Mapped[int] = mapped_column(ForeignKey("wallets.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    holdings: Mapped[dict] = mapped_column(JSON, default=dict)   # token -> USD değeri
    total_usd: Mapped[float] = mapped_column(Float, default=0.0)
    source: Mapped[str] = mapped_column(String(24), default="mock")


class WalletActivity(Base):
    __tablename__ = "wallet_activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wallet_id: Mapped[int] = mapped_column(ForeignKey("wallets.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    token: Mapped[str] = mapped_column(String(32), default="", index=True)
    action: Mapped[str] = mapped_column(String(32), default="")  # buy|increase|decrease|sell
    qty_usd: Mapped[float] = mapped_column(Float, default=0.0)   # İŞARETLİ delta (+alım/-satım)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    evaluated: Mapped[bool] = mapped_column(Boolean, default=False)  # isabet kontrolü yapıldı mı

    wallet: Mapped[Wallet] = relationship(back_populates="activities")
