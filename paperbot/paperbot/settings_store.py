"""Ayar deposu: .env varsayılanları + DB üzerindeki panel geçersiz kılmaları."""
from __future__ import annotations

import json
import logging
from dataclasses import fields

from .config import PROTECTED_KEYS, AppConfig, load_config

log = logging.getLogger("paperbot.settings")

# Bazı anahtarlar için makul aralıklar (kötü değerler motoru kilitlenmesin)
RANGES: dict[str, tuple[float, float]] = {
    "fee_rate": (0.0, 0.1), "slippage_rate": (0.0, 0.1),
    "gas_per_trade": (0.0, 1000.0), "min_notional": (1.0, 10_000.0),
    "max_position_pct": (0.01, 1.0), "max_open_positions": (1, 50),
    "daily_max_loss_pct": (0.005, 0.5), "stop_loss_pct": (0.01, 0.9),
    "take_profit_pct": (0.01, 5.0),
    "entry_threshold": (0.0, 100.0), "exit_threshold": (0.0, 100.0),
    "technical_min": (0.0, 100.0), "risk_min_score": (0.0, 100.0),
    "confirmation_score": (0.0, 100.0), "confirmations_required": (0, 6),
    "cycle_seconds": (30, 86_400), "start_balance": (100.0, 1_000_000_000.0),
    "summary_hour": (0, 23), "weekly_summary_weekday": (0, 6),
    "backtest_days": (1, 1825),
    "cache_ttl": (0, 86_400), "http_timeout": (1, 120), "max_retries": (1, 10),
}
for _w in ("technical", "onchain", "defi", "risk", "sentiment", "macro"):
    RANGES[f"w_{_w}"] = (0.0, 5.0)


def load_overrides(session_factory) -> dict:
    if session_factory is None:
        return {}
    from .models import Setting

    out = {}
    with session_factory() as s:
        for row in s.query(Setting).all():
            try:
                out[row.key] = json.loads(row.value)
            except (ValueError, TypeError):
                out[row.key] = row.value
    return out


def save_overrides(session_factory, updates: dict) -> tuple[dict, list[str]]:
    """Ayarları doğrula ve kaydet. (kaydedilenler, hatalar) döndürür."""
    valid_keys = {f.name for f in fields(AppConfig)}
    saved, errors = {}, []
    if session_factory is None:
        return {}, ["Oturum yok — ayar kaydedilemedi"]

    from .models import Setting
    from .config import _coerce

    with session_factory() as s:
        for key, value in (updates or {}).items():
            if key not in valid_keys:
                errors.append(f"bilinmeyen ayar: {key}")
                continue
            if key in PROTECTED_KEYS:
                errors.append(f"korumalı ayar değiştirilemez: {key}")
                continue
            try:
                coerced = _coerce(key, value)
            except (TypeError, ValueError) as e:
                errors.append(f"{key}: geçersiz değer ({e})")
                continue
            if key in RANGES:
                lo, hi = RANGES[key]
                try:
                    fv = float(coerced)
                except (TypeError, ValueError):
                    errors.append(f"{key}: sayısal değer bekleniyordu")
                    continue
                if not (lo <= fv <= hi):
                    errors.append(f"{key}: {fv} aralık dışı [{lo}, {hi}]")
                    continue
                if isinstance(coerced, int) and not isinstance(coerced, bool):
                    coerced = int(fv)
                elif not isinstance(coerced, bool):
                    coerced = float(fv)
            row = s.get(Setting, key)
            payload = json.dumps(coerced)
            if row is None:
                s.add(Setting(key=key, value=payload))
            else:
                row.value = payload
            saved[key] = coerced
        s.commit()
    log.info("Ayarlar güncellendi: %s", saved)
    return saved, errors


def effective_cfg(session_factory) -> AppConfig:
    return load_config(load_overrides(session_factory))


def settings_payload(session_factory) -> dict:
    """Panel için ayar listesi: değer + tip + korumalı mı + aralık."""
    cfg = effective_cfg(session_factory)
    overrides = load_overrides(session_factory)
    secret_keys = {"telegram_bot_token", "openai_api_key",
                   "binance_api_key", "binance_api_secret"}
    out = {}
    for f in fields(AppConfig):
        value = getattr(cfg, f.name)
        if f.name in secret_keys:
            value = "••••••" if value else ""
        out[f.name] = {
            "value": value,
            "type": f.type if isinstance(f.type, str) else "str",
            "protected": f.name in PROTECTED_KEYS or f.name in secret_keys,
            "override": f.name in overrides,
            "range": list(RANGES[f.name]) if f.name in RANGES else None,
        }
    return out
