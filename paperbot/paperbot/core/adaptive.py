"""Faz 8 — Akıllı TP/SL: varlığa göre dinamik take-profit / stop-loss.

Taban değerler config'den gelir (STOP_LOSS_PCT / TAKE_PROFIT_PCT). `adaptive_tp`
açıkken karar anındaki verilere göre varlık bazında yeniden ölçeklenir:

* **volatilite** (teknik katman ``vol_pct``) — yüksek volatilite → geniş hedef
* **güven** (``decision.confidence``) — yüksek güven → biraz daha iddialı hedef
* **akıllı para/balina sinyali** (on-chain details) — birikim → hedef yukarı,
  dağıtım → hedef aşağı, ``strong`` → ekstra yukarı
* **risk seviyesi** — yüksek risk hem TP hem SL'i sıkılaştırır

Disiplin kuralları (asla aşılmaz):

* TP %6–%35 bandına kırpılır (round-trip maliyet ~%1'i aşmasın)
* SL mutlak %4–%12 arasında VE TP'nin %40–%60'ında tutulur → R:R ≥ ~1.5

Fonksiyon saf ve deterministir. Motor girişte çağırır; açık pozisyonda her
döngüde hedef **yalnızca yukarı** revize edilir (kazanç bırakma), aşağı
çekilmez — elle/ girişte belirlenen disiplin bozulmaz.
"""
from __future__ import annotations

TP_MIN, TP_MAX = 0.06, 0.35          # TP kırpma sınırları (fraction)
SL_MIN, SL_MAX = 0.04, 0.12          # SL mutlak sınırları
SL_OF_TP_LO, SL_OF_TP_HI = 0.40, 0.60  # SL = TP'nin %40-60'ı → R:R disiplini
VOL_REF = 2.5                        # referans günlük volatilite (%)

# Risk seviyesi → hedef sıkılaştırma çarpanı
RISK_TIGHTEN = {"DÜŞÜK": 1.00, "ORTA": 0.95, "YÜKSEK": 0.85, "KRİTİK": 0.80}


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def adaptive_targets(cfg, decision) -> dict:
    """Karar verisinden TP/SL üretir.

    Returns:
        ``{"enabled": bool, "tp": fraction, "sl": fraction,
        "factors": {...}, "summary": "..."}`` — ``tp``/``sl`` kesir biçiminde
        (0.15 = %15); doğrudan fiyat hesabında kullanılır.
    """
    base_tp = float(cfg.take_profit_pct)
    base_sl = float(cfg.stop_loss_pct)

    if not getattr(cfg, "adaptive_tp", True):
        return {
            "enabled": False, "tp": base_tp, "sl": base_sl, "factors": {},
            "summary": (f"Taban TP/SL (akıllı TP kapalı): "
                        f"TP %{base_tp * 100:.1f} / SL -%{base_sl * 100:.1f}"),
        }

    det = decision.details or {}
    vol = float((det.get("technical") or {}).get("vol_pct") or 2.0)
    conf = float(decision.confidence or 0.75)
    sm = (det.get("onchain") or {}).get("smart_money") or {}
    verdict = sm.get("verdict") or ("accumulation" if sm.get("strong") else "")
    level = decision.risk_level or "ORTA"

    # --- faktörler (her biri kendi bandında kırpılır) ---
    f_vol = _clamp(vol / VOL_REF, 0.70, 1.60)
    f_conf = _clamp(1.0 + (conf - 0.75) * 1.2, 0.90, 1.15)
    if sm.get("strong"):
        f_sm = 1.15
    elif verdict == "accumulation":
        f_sm = 1.05
    elif verdict == "distribution":
        f_sm = 0.90
    else:
        f_sm = 1.00
    f_risk = RISK_TIGHTEN.get(level, 1.00)

    tp = _clamp(base_tp * f_vol * f_conf * f_sm * f_risk, TP_MIN, TP_MAX)

    # --- SL: taban × volatilite × risk, sonra TP'ye bağlı disiplin bandı ---
    sl = _clamp(base_sl * f_vol * f_risk, SL_MIN, SL_MAX)
    lo = max(SL_MIN, tp * SL_OF_TP_LO)
    hi = min(SL_MAX, tp * SL_OF_TP_HI)
    if lo <= hi:
        sl = _clamp(sl, lo, hi)
    else:
        # bandın boşaldığı iki uç durum:
        # dar TP (tp*0.6 < SL_MIN) → mutlak alt sınır; geniş TP (tp*0.4 > SL_MAX)
        # → mutlak üst sınır. Ortak formül: TP'nin yarısı, mutlak sınırlarda.
        sl = _clamp(tp * 0.5, SL_MIN, SL_MAX)

    factors = {"volatilite": round(f_vol, 3), "guven": round(f_conf, 3),
               "balina": round(f_sm, 3), "risk": round(f_risk, 3)}
    summary = (
        f"Akıllı TP/SL: TP %{tp * 100:.1f} / SL -%{sl * 100:.1f} "
        f"(vol %{vol:.1f}/gün ×{f_vol:.2f} · güven ×{f_conf:.2f} · "
        f"balina ×{f_sm:.2f} · risk {level} ×{f_risk:.2f})"
    )
    return {"enabled": True, "tp": tp, "sl": sl,
            "factors": factors, "summary": summary}
