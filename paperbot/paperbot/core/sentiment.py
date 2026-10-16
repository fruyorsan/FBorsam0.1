"""Faz 5 — Duygu & haber katmanı (0-100, 3 bileşen).

Bileşen ağırları: korku/açgözlülük .40 | haber akışı .35 | dikkat .25

Tasarım kuralları (Faz 3/4 ile aynı):
- Kaynak hiç alınamadıysa bileşen deterministik **mock** skor üretir ve
  "mock" etiketi taşır.
- Kaynak çalıştı ama sonuç yoksa (trend listesinde değil, pencerede haber
  yok) bileşen gerçek **live** bilgisini işler — nötr/düşük skor.
- Canlı/etkin mod: SENTIMENT_SOURCE=mock/off ve PRICE_SOURCE=mock (test/offline)
  iken sağlayıcı hiç çağrılmaz → ağ trafiği sıfır.
"""
from __future__ import annotations

import logging
import re
import time

from .scoring import LayerScore, _hash_score

log = logging.getLogger("paperbot.sentiment")

# sözlük (lexicon) duygu — İngilizce haber başlıkları için
BULL_WORDS = (
    "rally", "rallies", "surge", "surges", "soar", "jump", "gains", "gain",
    "record", "approval", "approved", "adoption", "partnership", "launch",
    "launches", "upgrade", "burn", "inflow", "inflows", "breakout", "bull",
    "bullish", "profit", "listing", "integrates", "integration", "etf",
    "institutional", "accumulation", "recovery", "rebound", "outperform",
)
BEAR_WORDS = (
    "hack", "hacked", "exploit", "exploited", "lawsuit", "sues", "sued",
    "ban", "banned", "crash", "crashes", "plunge", "plunges", "dump",
    "dumps", "reject", "rejected", "delay", "delayed", "outage", "breach",
    "theft", "scam", "rug", "liquidation", "sell-off", "selloff", "warning",
    "fraud", "probe", "investigation", "delisting", "defaults", "fear",
)
_BULL_RE = re.compile(r"\b(?:" + "|".join(BULL_WORDS) + r")\b", re.I)
_BEAR_RE = re.compile(r"\b(?:" + "|".join(BEAR_WORDS) + r")\b", re.I)

# Alternative.me sınıflandırmaları → Türkçe
_FNG_TR = {
    "EXTREME FEAR": "aşırı korku", "FEAR": "korku", "NEUTRAL": "nötr",
    "GREED": "açgözlülük", "EXTREME GREED": "aşırı açgözlülük",
}


def _day(now: float) -> int:
    return int(now // 86400)


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


# FNG → skor: denge (45-60) iyi, aşırı korku panik, aşırı açgözlülük balon
FNG_ANCHORS = [
    (0.0, 30.0), (15.0, 40.0), (30.0, 55.0), (45.0, 68.0), (60.0, 78.0),
    (75.0, 75.0), (85.0, 60.0), (100.0, 40.0),
]


# ================================================================== bileşenler
def score_fng(data: dict | None, token: str, now: float) -> dict:
    """Korku & Açgözlülük endeksi — denge bölgesinde zirve yapan eğri."""
    if data is None:
        base = _hash_score(token, "sent_fng", _day(now), lo=35, hi=88)
        return {"score": round(base, 1), "source": "mock",
                "summary": "mock: korku/açgözlülük kaynağı alınamadı",
                "data": {"mock": True}}
    value = data.get("value")
    if value is None:
        return {"score": 55.0, "source": "na",
                "summary": "endeks değeri yok — nötr politika",
                "data": {"value": None}}
    value = float(value)
    score = _piecewise(value, FNG_ANCHORS)
    avg7 = data.get("avg_7d")
    adj = 0.0
    if avg7 is not None:
        adj = max(-6.0, min(6.0, (value - float(avg7)) * 0.8))
        score += adj
    score = max(10.0, min(95.0, score))
    cls = str(data.get("classification") or "").upper()
    cls_tr = _FNG_TR.get(cls, cls.lower() or "—")
    txt = f"Korku&Açgözlülük {value:.0f} ({cls_tr})"
    if avg7 is not None:
        txt += f" · 7g ort {float(avg7):.0f}"
        if adj:
            txt += f" ({adj:+.1f} momentum)"
    return {"score": round(score, 1), "source": "live", "summary": txt,
            "data": {"value": value, "avg_7d": avg7,
                     "classification": data.get("classification")}}


def score_news(titles: list[str] | None, token: str, now: float) -> dict:
    """Son 24-30s haber başlıklarının sözlük duygu dengesi."""
    if titles is None:
        base = _hash_score(token, "sent_news", _day(now), lo=35, hi=85)
        return {"score": round(base, 1), "source": "mock",
                "summary": "mock: haber kaynağı alınamadı",
                "data": {"mock": True}}
    if not titles:
        return {"score": 45.0, "source": "live",
                "summary": "pencerede haber yok — sakin akış (canlı)",
                "data": {"count": 0, "bull": 0, "bear": 0, "top": []}}
    text = "\n".join(titles)
    bull = len(_BULL_RE.findall(text))
    bear = len(_BEAR_RE.findall(text))
    net = bull - bear
    score = max(15.0, min(85.0, 50.0 + 7.0 * net))
    return {"score": round(score, 1), "source": "live",
            "summary": (f"{len(titles)} haber (30s) · pozitif sinyal {bull} / "
                        f"negatif {bear} → net {net:+d}"),
            "data": {"count": len(titles), "bull": bull, "bear": bear,
                     "top": titles[:3]}}


def score_attention(data: dict | None, token: str, now: float) -> dict:
    """CoinGecko trend listesi — varlık güncel dikkat (ilgi) odağı mı?"""
    if data is None:
        base = _hash_score(token, "sent_att", _day(now), lo=40, hi=85)
        return {"score": round(base, 1), "source": "mock",
                "summary": "mock: trend (dikkat) kaynağı alınamadı",
                "data": {"mock": True}}
    if not data.get("matched"):
        return {"score": 45.0, "source": "live",
                "summary": "CoinGecko trend listesinde yok — dikkat artışı yok",
                "data": {"matched": False}}
    rank = int(data.get("rank") or 15)
    score = 85.0 if rank <= 3 else (75.0 if rank <= 7 else 65.0)
    return {"score": score, "source": "live",
            "summary": f"CoinGecko trend listesinde #{rank} — dikkat yüksek",
            "data": {"matched": True, "rank": rank,
                     "symbol": data.get("symbol"), "name": data.get("name")}}


# ===================================================================== katman
class SentimentLayer:
    """Duygu & haber katmanı — 3 bileşenli 0-100 skor."""

    name = "sentiment"
    COMPONENT_WEIGHTS = {"fng": 0.40, "news": 0.35, "attention": 0.25}
    META_TTL = 300.0            # asset meta yenileme sıklığı (sn)

    def __init__(self, provider=None, asset_lookup=None):
        """provider: SentimentProvider | None (None → tam mock).

        asset_lookup: Callable[[], dict[token → {name, coingecko_id, category}]]
        """
        self.provider = provider
        self._asset_lookup = asset_lookup
        self._meta_map: dict | None = None
        self._meta_at = 0.0

    # ------------------------------------------------------------- meta
    def _meta(self, token: str) -> dict | None:
        if self._asset_lookup is None:
            return None
        now = time.time()
        if self._meta_map is None or (now - self._meta_at) > self.META_TTL:
            try:
                self._meta_map = self._asset_lookup() or {}
            except Exception as e:  # noqa: BLE001 — meta hatası katmanı indirmez
                log.warning("Varlık meta alınamadı: %s", e)
                self._meta_map = {}
            self._meta_at = now
        return self._meta_map.get(token)

    def _enabled(self, cfg) -> bool:
        src = (getattr(cfg, "sentiment_source", "auto") or "auto").lower()
        if src in ("mock", "off"):
            return False
        if src == "live":
            return True
        return getattr(cfg, "price_source", "auto") != "mock"  # auto

    # -------------------------------------------------------------- skor
    def compute(self, symbol: str, feed, cfg) -> LayerScore:
        token = symbol[:-4] if symbol.endswith("USDT") else symbol
        now = time.time()
        meta = self._meta(token)
        use_live = self._enabled(cfg) and self.provider is not None

        fng = self.provider.fng() if use_live else None
        trending = self.provider.trending() if use_live else None
        titles = None
        if use_live:
            # sorgu varlık ADI ile (sembol karışabilir: UNI ↔ university)
            qname = (meta or {}).get("name") or token
            titles = self.provider.news(f"{qname} crypto when:1d")

        # dikkat: liste var mı, token içinde mi?
        if trending is None:
            att: dict | None = None
        else:
            hit = next((t for t in trending
                        if t.get("symbol") == token.upper()), None)
            att = ({"matched": True, **hit} if hit
                   else {"matched": False})

        comps = {
            "fng": score_fng(fng, token, now),
            "news": score_news(titles, token, now),
            "attention": score_attention(att, token, now),
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

        details = {
            "components": {k: {"score": v["score"], "source": v["source"],
                               "summary": v["summary"]}
                           for k, v in comps.items()},
            "weights": dict(self.COMPONENT_WEIGHTS),
            "market": ({"fng_value": fng.get("value"),
                        "fng_avg_7d": fng.get("avg_7d"),
                        "fng_class": fng.get("classification")}
                       if isinstance(fng, dict) else None),
            "news_query": ((meta or {}).get("name") or token),
            "data_sources": sorted(sources),
        }
        for k, v in comps.items():
            details[k] = v["data"]
        return LayerScore(self.name, final, layer_source, details)
