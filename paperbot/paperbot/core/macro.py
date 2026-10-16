"""Faz 6 — Makro katmanı (0-100, 4 bileşen).

Bileşen ağırları: likidite (stablecoin arzı) .40 | piyasa momentumu .25
                   | BTC dominansı rejimi .20 | dolar gücü .15

Tasarım kuralları (Faz 3/4/5 ile aynı):
- Kaynak hiç alınamadıysa bileşen deterministik **mock** skor üretir ve
  "mock" etiketi taşır.
- Kaynak çalıştı ama alan eksikse bileşen **na** politika skoru üretir
  (uydurma değil, nötr).
- Canlı/etkin mod: MACRO_SOURCE=mock/off ve PRICE_SOURCE=mock (test/offline)
  iken sağlayıcı hiç çağrılmaz → ağ trafiği sıfır.
- Makro pazar geneldir: her varlık aynı makro verisini alır (bileşenler
  pazar-wide sinyal taşır, varlık-özel ayrım yapmaz).
"""
from __future__ import annotations

import logging
import time

from .scoring import LayerScore, _hash_score

log = logging.getLogger("paperbot.macro")


def _day(now: float) -> int:
    return int(now // 86400)


def _money(v: float) -> str:
    """İnsan-okur USD biçimi: 2.9T$, 266.9B$, 120M$."""
    a = abs(v)
    if a >= 1e12:
        return f"{v/1e12:.1f}T$"
    if a >= 1e9:
        return f"{v/1e9:.1f}B$"
    if a >= 1e6:
        return f"{v/1e6:.0f}M$"
    if a >= 1e3:
        return f"{v/1e3:.0f}K$"
    return f"{v:.0f}$"


def _piecewise(x: float, anchors: list[tuple[float, float]]) -> float:
    """Çapa noktalar arasında doğrusal interpolasyon; dışarıda kenar değeri."""
    if x <= anchors[0][0]:
        return anchors[0][1]
    for (x0, y0), (x1, y1) in zip(anchors, anchors[1:]):
        if x <= x1:
            if x1 == x0:
                return y1
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return anchors[-1][1]


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# ================================================================== bileşenler
def score_liquidity(data: dict | None, token: str, now: float) -> dict:
    """Stablecoin arzı: piyasaya giren/çıkan makro likidite (7g + 30g)."""
    if data is None:
        base = _hash_score(token, "mac_liq", _day(now), lo=35, hi=85)
        return {"score": round(base, 1), "source": "mock",
                "summary": "mock: stablecoin arzı kaynağı alınamadı",
                "data": {"mock": True}}
    supply = data.get("supply")
    if supply is None or float(supply) <= 0:
        return {"score": 50.0, "source": "na",
                "summary": "stablecoin arzı verisi yok — nötr politika",
                "data": {"supply": None}}
    c7 = data.get("change_7d")
    c30 = data.get("change_30d")
    if c7 is None and c30 is None:
        return {"score": 50.0, "source": "na",
                "summary": "arz değişim verisi yok (7g/30g) — nötr politika",
                "data": {"supply": float(supply),
                         "change_7d": None, "change_30d": None}}
    score = 50.0
    if c7 is not None:
        score += _clamp(float(c7), -20.0, 20.0)
    if c30 is not None:
        score += _clamp(0.5 * float(c30), -15.0, 15.0)
    score = max(15.0, min(85.0, score))
    txt = f"Stablecoin arzı {_money(float(supply))}"
    bits = []
    if c7 is not None:
        bits.append(f"7g %{float(c7):+.1f}")
    if c30 is not None:
        bits.append(f"30g %{float(c30):+.1f}")
    if bits:
        txt += " · " + " · ".join(bits)
    if c7 is not None and c30 is not None:
        if float(c7) > 0.5 and float(c30) > 0:
            txt += " — arz büyüyor (likidite giriyor)"
        elif float(c7) < -0.5 and float(c30) < 0:
            txt += " — arz daralıyor (likidite çekiliyor)"
    return {"score": round(score, 1), "source": "live", "summary": txt,
            "data": {"supply": float(supply), "change_7d": c7,
                     "change_30d": c30}}


def score_market(data: dict | None, token: str, now: float) -> dict:
    """Toplam piyasa değeri momentumu (24s değişim)."""
    if data is None:
        base = _hash_score(token, "mac_mkt", _day(now), lo=30, hi=80)
        return {"score": round(base, 1), "source": "mock",
                "summary": "mock: piyasa (CoinGecko /global) kaynağı alınamadı",
                "data": {"mock": True}}
    mcap = data.get("total_mcap")
    c24 = data.get("mcap_change_24h")
    if c24 is None:
        return {"score": 50.0, "source": "na",
                "summary": "24s piyasa değişim verisi yok — nötr politika",
                "data": {"total_mcap": mcap, "mcap_change_24h": None}}
    score = 50.0 + _clamp(2.5 * float(c24), -30.0, 30.0)
    score = max(20.0, min(80.0, score))
    txt = f"Toplam piyasa {_money(float(mcap))} · 24s %{float(c24):+.1f}" \
        if mcap else f"Piyasa 24s %{float(c24):+.1f}"
    return {"score": round(score, 1), "source": "live", "summary": txt,
            "data": {"total_mcap": mcap, "mcap_change_24h": float(c24)}}


# dominans → skor: 48-62% sağlıklı rejim zirve; aşırı uçlar cezalı
DOMINANCE_ANCHORS = [
    (0.0, 55.0), (40.0, 58.0), (45.0, 60.0), (48.0, 75.0), (62.0, 75.0),
    (65.0, 66.0), (70.0, 55.0), (100.0, 40.0),
]


def _dominance_regime(d: float) -> str:
    if d < 45:
        return "alt-sezon iyimserliği"
    if d < 48:
        return "rejim geçişi"
    if d <= 62:
        return "sağlıklı rejim"
    if d <= 70:
        return "risk-off"
    return "BTC'ye kaçış"


def score_dominance(data: dict | None, token: str, now: float) -> dict:
    """BTC dominansı: risk iştahı rejimi — dengeli bant zirvede."""
    if data is None:
        base = _hash_score(token, "mac_dom", _day(now), lo=40, hi=80)
        return {"score": round(base, 1), "source": "mock",
                "summary": "mock: dominans (CoinGecko /global) kaynağı alınamadı",
                "data": {"mock": True}}
    d = data.get("btc_dominance")
    if d is None:
        return {"score": 55.0, "source": "na",
                "summary": "BTC dominans verisi yok — nötr politika",
                "data": {"btc_dominance": None}}
    d = float(d)
    score = max(30.0, min(90.0, _piecewise(d, DOMINANCE_ANCHORS)))
    regime = _dominance_regime(d)
    return {"score": round(score, 1), "source": "live",
            "summary": f"BTC dominansı %{d:.1f} ({regime})",
            "data": {"btc_dominance": d, "regime": regime}}


def score_usd(data: dict | None, token: str, now: float) -> dict:
    """Dolar gücü (ECB EUR/USD): USD güçleniyorsa kripto üzerinde baskı."""
    if data is None:
        base = _hash_score(token, "mac_usd", _day(now), lo=35, hi=80)
        return {"score": round(base, 1), "source": "mock",
                "summary": "mock: dolar (ECB) kaynağı alınamadı",
                "data": {"mock": True}}
    c7 = data.get("change_7d")
    c30 = data.get("change_30d")
    if c7 is None and c30 is None:
        return {"score": 55.0, "source": "na",
                "summary": "dolar gücü değişim verisi yok — nötr politika",
                "data": {"change_7d": None, "change_30d": None}}
    score = 50.0
    if c7 is not None:
        score -= _clamp(2.0 * float(c7), -15.0, 15.0)
    if c30 is not None:
        score -= _clamp(0.6 * float(c30), -10.0, 10.0)
    score = max(25.0, min(75.0, score))
    bits = []
    if c7 is not None:
        bits.append(f"7g %{float(c7):+.1f}")
    if c30 is not None:
        bits.append(f"30g %{float(c30):+.1f}")
    txt = "Dolar gücü " + " · ".join(bits)
    avg = sum(float(x) for x in (c7, c30) if x is not None) \
        / sum(1 for x in (c7, c30) if x is not None)
    if avg > 1.0:
        txt += " — USD güçleniyor (kripto rüzgârına baskı)"
    elif avg < -1.0:
        txt += " — USD zayıflıyor (kripto lehine rüzgâr)"
    return {"score": round(score, 1), "source": "live", "summary": txt,
            "data": {"change_7d": c7, "change_30d": c30}}


# ===================================================================== katman
class MacroLayer:
    """Makro katmanı — 4 bileşenli 0-100 skor (pazar geneli sinyal)."""

    name = "macro"
    COMPONENT_WEIGHTS = {
        "liquidity": 0.40, "market": 0.25, "dominance": 0.20, "usd": 0.15,
    }

    def __init__(self, provider=None):
        """provider: MacroProvider | None (None → tam mock)."""
        self.provider = provider

    def _enabled(self, cfg) -> bool:
        src = (getattr(cfg, "macro_source", "auto") or "auto").lower()
        if src in ("mock", "off"):
            return False
        if src == "live":
            return True
        return getattr(cfg, "price_source", "auto") != "mock"  # auto

    # -------------------------------------------------------------- skor
    def compute(self, symbol: str, feed, cfg) -> LayerScore:
        token = symbol[:-4] if symbol.endswith("USDT") else symbol
        now = time.time()
        use_live = self._enabled(cfg) and self.provider is not None

        g = self.provider.global_data() if use_live else None
        stable = self.provider.stablecoins() if use_live else None
        usd = self.provider.usd_trend() if use_live else None

        comps = {
            "liquidity": score_liquidity(stable, token, now),
            "market": score_market(g, token, now),
            "dominance": score_dominance(g, token, now),
            "usd": score_usd(usd, token, now),
        }
        total = sum(self.COMPONENT_WEIGHTS[k] * comps[k]["score"]
                    for k in self.COMPONENT_WEIGHTS)
        final = max(0.0, min(100.0, total))
        sources = {c["source"] for c in comps.values()}
        # katman etiketi: canlı kaynak gerçekten kullanıldıysa 'live'
        if use_live and any(c["source"] == "live" for c in comps.values()):
            layer_source = "live"
        else:
            layer_source = "mock"

        # pazar özeti ("snapshot"): eksik kaynakları güvenli hale getir —
        # anahtar "market" bileşeninin kendi verisini EZMESİN diye ayrı isim
        has_any = bool(g or stable or usd)
        g = g if isinstance(g, dict) else {}
        stable = stable if isinstance(stable, dict) else {}
        usd = usd if isinstance(usd, dict) else {}

        details = {
            "components": {k: {"score": v["score"], "source": v["source"],
                               "summary": v["summary"]}
                           for k, v in comps.items()},
            "weights": dict(self.COMPONENT_WEIGHTS),
            "snapshot": ({"total_mcap": g.get("total_mcap"),
                          "mcap_change_24h": g.get("mcap_change_24h"),
                          "btc_dominance": g.get("btc_dominance"),
                          "stablecoin_supply": stable.get("supply"),
                          "supply_change_7d": stable.get("change_7d"),
                          "usd_change_7d": usd.get("change_7d")}
                         if has_any else None),
            "data_sources": sorted(sources),
        }
        for k, v in comps.items():
            details[k] = v["data"]
        return LayerScore(self.name, final, layer_source, details)
