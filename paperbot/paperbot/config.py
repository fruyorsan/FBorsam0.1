"""Ortam değişkenlerinden (.env) uygulama yapılandırmasını okur.

Kurallar:
- Kod içinde API anahtarı tutulmaz; her şey .env / secret manager'dan gelir.
- Çalışma zamanında DB üzerindeki `settings` tablosu bu varsayılanların
  üzerine biner (panelden değiştirilebilir değerler).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, asdict, fields
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _env_str(key: str, default: str) -> str:
    v = os.getenv(key)
    return default if v is None or v == "" else v


def _env_float(key: str, default: float) -> float:
    v = os.getenv(key)
    try:
        return float(v) if v not in (None, "") else default
    except ValueError:
        return default


def _env_int(key: str, default: int) -> int:
    v = os.getenv(key)
    try:
        return int(float(v)) if v not in (None, "") else default
    except ValueError:
        return default


def _env_bool(key: str, default: bool) -> bool:
    v = os.getenv(key)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


# Varsayılan takip edilecek varlık seti: majörler + önde gelen DeFi tokenları (~20)
DEFAULT_ASSETS = [
    # (symbol, coingecko_id, ad, kategori)
    ("BTCUSDT", "bitcoin", "Bitcoin", "major"),
    ("ETHUSDT", "ethereum", "Ethereum", "major"),
    ("SOLUSDT", "solana", "Solana", "major"),
    ("BNBUSDT", "binancecoin", "BNB", "major"),
    ("XRPUSDT", "ripple", "XRP", "major"),
    ("ADAUSDT", "cardano", "Cardano", "major"),
    ("DOGEUSDT", "dogecoin", "Dogecoin", "major"),
    ("AVAXUSDT", "avalanche-2", "Avalanche", "major"),
    ("TRXUSDT", "tron", "TRON", "major"),
    ("LINKUSDT", "chainlink", "Chainlink", "major"),
    ("UNIUSDT", "uniswap", "Uniswap", "defi"),
    ("AAVEUSDT", "aave", "Aave", "defi"),
    ("MKRUSDT", "maker", "Maker", "defi"),
    ("LDOUSDT", "lido-dao", "Lido DAO", "defi"),
    ("CRVUSDT", "curve-dao-token", "Curve DAO", "defi"),
    ("COMPUSDT", "compound-governance-token", "Compound", "defi"),
    ("SNXUSDT", "havven", "Synthetix", "defi"),
    ("CAKEUSDT", "pancakeswap", "PancakeSwap", "defi"),
    ("RUNEUSDT", "thorchain", "THORChain", "defi"),
    ("PENDLEUSDT", "pendle", "Pendle", "defi"),
]

# Mock modda kullanılacak başlangıç fiyatları (yaklaşık, sadece simülasyon)
MOCK_BASE_PRICES = {
    "BTCUSDT": 65000.0, "ETHUSDT": 3200.0, "SOLUSDT": 150.0, "BNBUSDT": 580.0,
    "XRPUSDT": 0.55, "ADAUSDT": 0.45, "DOGEUSDT": 0.12, "AVAXUSDT": 28.0,
    "TRXUSDT": 0.13, "LINKUSDT": 14.0, "UNIUSDT": 7.5, "AAVEUSDT": 95.0,
    "MKRUSDT": 1500.0, "LDOUSDT": 1.8, "CRVUSDT": 0.30, "COMPUSDT": 45.0,
    "SNXUSDT": 2.2, "CAKEUSDT": 2.4, "RUNEUSDT": 4.0, "PENDLEUSDT": 4.5,
}


@dataclass
class AppConfig:
    """Uygulama yapılandırması. Alan adları = paneldeki ayar anahtarları."""

    # --- Uygulama ---
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    log_level: str = "INFO"
    database_url: str = "sqlite:///./data/paperbot.db"

    # --- Sanal işlem ---
    trading_mode: str = "paper"
    live_trading_enabled: bool = False          # KORUMALI: UI'dan değiştirilemez
    start_balance: float = 10000.0
    cycle_seconds: int = 300

    # --- Maliyetler (kötümser varsayılanlar) ---
    fee_rate: float = 0.0012
    slippage_rate: float = 0.0035
    gas_per_trade: float = 2.0
    min_notional: float = 10.0

    # --- Pozisyon/risk kuralları ---
    max_position_pct: float = 0.10
    max_open_positions: int = 5
    daily_max_loss_pct: float = 0.03
    stop_loss_pct: float = 0.08
    take_profit_pct: float = 0.15
    adaptive_tp: bool = True                     # Faz 8: varlığa göre dinamik TP/SL
    risk_min_score: float = 40.0

    # --- Katman ağırlıkları ---
    w_technical: float = 0.25
    w_onchain: float = 0.15
    w_defi: float = 0.10
    w_risk: float = 0.30
    w_sentiment: float = 0.10
    w_macro: float = 0.10

    # --- Karar eşikleri ---
    entry_threshold: float = 65.0
    exit_threshold: float = 40.0
    technical_min: float = 50.0
    confirmations_required: int = 2
    confirmation_score: float = 60.0

    # --- Veri kaynakları ---
    price_source: str = "auto"                  # auto | mock | binance | coingecko
    risk_source: str = "auto"                   # auto | live | mock (Faz 4 güvenlik verisi)
    defi_source: str = "auto"                   # auto | live | mock | off (Faz 3 DeFi metrikleri)
    sentiment_source: str = "auto"               # auto | live | mock | off (Faz 5 duygu/haber)
    macro_source: str = "auto"                   # auto | live | mock | off (Faz 6 makro)
    http_timeout: float = 10.0
    max_retries: int = 3
    cache_ttl: int = 60

    # --- Telegram (boşsa log/panel bildirimi) ---
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # --- Binance API — Faz 10 canlı (gerçek para) işlem ---
    # Anahtarlar YALNIZCA .env'den yönetilir (BINANCE_API_KEY/SECRET);
    # panelden girilirse .env dosyasına yazılır, DB'ye asla konmaz.
    binance_api_key: str = ""
    binance_api_secret: str = ""
    binance_testnet: bool = False               # true = testnet.binance.vision (kağıt para)

    # --- LLM (boşsa şablon gerekçe) ---
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # --- LLM köprüsü (Faz 11): OpenAI kredisi yerine yerel OpenCode API'si ---
    # llm_bridge = "" (sadece OpenAI anahtarı) | "opencode" (ücretsiz/sınırsız modeller)
    # opencode köprüsü başarısız olursa zincir OpenAI → şablon olarak devam eder.
    llm_bridge: str = ""
    llm_provider: str = "google"                # opencode API'sinde sağlayıcı (ör. google, opencode)
    llm_model: str = "gemini-3.8-flash"         # güçlü model (ücretsiz: opencode/*-free)
    llm_variant: str = "high"                   # düşünme/seviye varyantı (boş = yok)
    llm_fallbacks: str = "opencode/space-bunny-free"   # virgülle ayrılmış yedek modeller
    llm_timeout: float = 90.0                   # köprü çağrı azami süresi (sn)
    opencode_cmd: str = ""                      # boş = otomatik bul (npm opencode.cmd)

    # --- Backtest ---
    backtest_days: int = 365
    backtest_interval: str = "4h"

    # --- Özet raporlama (UTC) ---
    summary_hour: int = 21
    weekly_summary_weekday: int = 6


# Panelden değiştirilemesin istenilen anahtarlar (gizli anahtarlar yalnızca .env'den yönetilir)
PROTECTED_KEYS = {
    "live_trading_enabled", "database_url", "trading_mode",
    "telegram_bot_token", "openai_api_key",
    "binance_api_key", "binance_api_secret",
}

FIELD_TYPES = {f.name: f.type for f in fields(AppConfig)}


def load_config(overrides: dict | None = None) -> AppConfig:
    """Ortam değişkenlerinden + DB geçersiz kılmalarından config üretir."""
    cfg = AppConfig(
        app_host=_env_str("APP_HOST", AppConfig.app_host),
        app_port=_env_int("APP_PORT", AppConfig.app_port),
        log_level=_env_str("LOG_LEVEL", AppConfig.log_level),
        database_url=_env_str("DATABASE_URL", AppConfig.database_url),
        trading_mode=_env_str("TRADING_MODE", AppConfig.trading_mode),
        live_trading_enabled=_env_bool("LIVE_TRADING_ENABLED", False),
        start_balance=_env_float("START_BALANCE", AppConfig.start_balance),
        cycle_seconds=_env_int("CYCLE_SECONDS", AppConfig.cycle_seconds),
        fee_rate=_env_float("FEE_RATE", AppConfig.fee_rate),
        slippage_rate=_env_float("SLIPPAGE_RATE", AppConfig.slippage_rate),
        gas_per_trade=_env_float("GAS_PER_TRADE", AppConfig.gas_per_trade),
        min_notional=_env_float("MIN_NOTIONAL", AppConfig.min_notional),
        max_position_pct=_env_float("MAX_POSITION_PCT", AppConfig.max_position_pct),
        max_open_positions=_env_int("MAX_OPEN_POSITIONS", AppConfig.max_open_positions),
        daily_max_loss_pct=_env_float("DAILY_MAX_LOSS_PCT", AppConfig.daily_max_loss_pct),
        stop_loss_pct=_env_float("STOP_LOSS_PCT", AppConfig.stop_loss_pct),
        take_profit_pct=_env_float("TAKE_PROFIT_PCT", AppConfig.take_profit_pct),
        adaptive_tp=_env_bool("ADAPTIVE_TP", AppConfig.adaptive_tp),
        risk_min_score=_env_float("RISK_MIN_SCORE", AppConfig.risk_min_score),
        w_technical=_env_float("W_TECHNICAL", AppConfig.w_technical),
        w_onchain=_env_float("W_ONCHAIN", AppConfig.w_onchain),
        w_defi=_env_float("W_DEFI", AppConfig.w_defi),
        w_risk=_env_float("W_RISK", AppConfig.w_risk),
        w_sentiment=_env_float("W_SENTIMENT", AppConfig.w_sentiment),
        w_macro=_env_float("W_MACRO", AppConfig.w_macro),
        entry_threshold=_env_float("ENTRY_THRESHOLD", AppConfig.entry_threshold),
        exit_threshold=_env_float("EXIT_THRESHOLD", AppConfig.exit_threshold),
        technical_min=_env_float("TECHNICAL_MIN", AppConfig.technical_min),
        confirmations_required=_env_int("CONFIRMATIONS_REQUIRED", AppConfig.confirmations_required),
        confirmation_score=_env_float("CONFIRMATION_SCORE", AppConfig.confirmation_score),
        price_source=_env_str("PRICE_SOURCE", AppConfig.price_source),
        risk_source=_env_str("RISK_SOURCE", AppConfig.risk_source),
        defi_source=_env_str("DEFI_SOURCE", AppConfig.defi_source),
        sentiment_source=_env_str("SENTIMENT_SOURCE", AppConfig.sentiment_source),
        macro_source=_env_str("MACRO_SOURCE", AppConfig.macro_source),
        http_timeout=_env_float("HTTP_TIMEOUT", AppConfig.http_timeout),
        max_retries=_env_int("MAX_RETRIES", AppConfig.max_retries),
        cache_ttl=_env_int("CACHE_TTL", AppConfig.cache_ttl),
        telegram_bot_token=_env_str("TELEGRAM_BOT_TOKEN", ""),
        telegram_chat_id=_env_str("TELEGRAM_CHAT_ID", ""),
        binance_api_key=_env_str("BINANCE_API_KEY", ""),
        binance_api_secret=_env_str("BINANCE_API_SECRET", ""),
        binance_testnet=_env_bool("BINANCE_TESTNET", AppConfig.binance_testnet),
        openai_api_key=_env_str("OPENAI_API_KEY", ""),
        openai_model=_env_str("OPENAI_MODEL", AppConfig.openai_model),
        llm_bridge=_env_str("LLM_BRIDGE", AppConfig.llm_bridge),
        llm_provider=_env_str("LLM_PROVIDER", AppConfig.llm_provider),
        llm_model=_env_str("LLM_MODEL", AppConfig.llm_model),
        llm_variant=_env_str("LLM_VARIANT", AppConfig.llm_variant),
        llm_fallbacks=_env_str("LLM_FALLBACKS", AppConfig.llm_fallbacks),
        llm_timeout=_env_float("LLM_TIMEOUT", AppConfig.llm_timeout),
        opencode_cmd=_env_str("OPENCODE_CMD", AppConfig.opencode_cmd),
        backtest_days=_env_int("BACKTEST_DAYS", AppConfig.backtest_days),
        backtest_interval=_env_str("BACKTEST_INTERVAL", AppConfig.backtest_interval),
        summary_hour=_env_int("SUMMARY_HOUR", AppConfig.summary_hour),
        weekly_summary_weekday=_env_int("WEEKLY_SUMMARY_WEEKDAY", AppConfig.weekly_summary_weekday),
    )
    if overrides:
        for k, v in overrides.items():
            if hasattr(cfg, k) and k not in PROTECTED_KEYS:
                setattr(cfg, k, _coerce(k, v))
    return cfg


def _coerce(key: str, value):
    """DB'den gelen (str/json) değeri alan tipine çevirir."""
    t = FIELD_TYPES.get(key, "str")
    if t == "bool":
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ("1", "true", "yes", "on")
    if t == "int":
        return int(float(value))
    if t == "float":
        return float(value)
    return str(value)


def config_as_dict(cfg: AppConfig) -> dict:
    return asdict(cfg)


def write_env_vars(updates: dict[str, str],
                   path: Path | None = None) -> Path:
    """`.env` dosyasındaki anahtarları günceller/ekler + ortama anında uygular.

    Faz 10: Binance anahtarları panelden girildiğinde bile anahtarlar
    YALNIZCA .env'de yaşar (DB'ye yazılmaz). Mevcut satırlar korunur.
    """
    path = path or (BASE_DIR / ".env")
    lines: list[str] = []
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
    pending = dict(updates)
    for i, line in enumerate(lines):
        stripped = line.strip()
        for key in list(pending):
            if stripped.startswith(f"{key}=") or stripped.startswith(f"export {key}="):
                lines[i] = f"{key}={pending.pop(key)}"
                break
    for key, value in pending.items():
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    for key, value in updates.items():
        os.environ[key] = str(value)
    return path
