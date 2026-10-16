"""Faz 3 — DeFi metrikleri katmanı (0-100, 4 bileşen).

Bileşen ağırları: TVL trendi .30 | TVL derinliği .25
                   | ücret geliri .25 | havuz getirisi (APY) .20

Tasarım kuralları (Faz 4 ile aynı):
- Kaynak hiç alınamadıysa ya da DefiLlama'da kayıt yoksa bileşen
  deterministik **mock** skor üretir ve "mock" etiketi taşır.
- Kaynak çalıştı ama o varlık için veri yoksa (ücret adaptörü yok, havuz
  kaydı yok, TVL 0) bileşen **na** politika skoru üretir (uydurma değil, nötr).
- Canlı/etkin mod: DEFI_SOURCE=mock/off ve PRICE_SOURCE=mock (test/offline)
  iken sağlayıcı hiç çağrılmaz → ağ trafiği sıfır.
"""
from __future__ import annotations

import logging
import math
import time

from .scoring import LayerScore, _hash_score

log = logging.getLogger("paperbot.defi")


def _day(now: float) -> int:
    return int(now // 86400)


def _money(v: float) -> str:
    """İnsan-okur USD biçimi: 4.5B$, 120M$, 850K$."""
    a = abs(v)
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


# ================================================================== bileşenler
def score_trend(metrics: dict | None, token: str, now: float) -> dict:
    """TVL trendi: 7 günlük değişim ağırlıklı, 1 günlük ile tamamlayıcı."""
    if metrics is None or not metrics.get("matched"):
        base = _hash_score(token, "defi_trend", _day(now), lo=35, hi=88)
        note = ("mock: DeFi kaynağı alınamadı" if metrics is None
                else "mock: DefiLlama'da zincir/protokol eşleşmesi yok")
        return {"score": round(base, 1), "source": "mock",
                "summary": note, "data": {"mock": True}}
    c7 = metrics.get("change_7d")
    c1 = metrics.get("change_1d")
    if c7 is None and c1 is None:
        return {"score": 55.0, "source": "na",
                "summary": "TVL değişim verisi yok — nötr politika",
                "data": {"change_7d": None, "change_1d": None}}
    if c7 is None:
        score = 50.0 + 1.6 * float(c1)
        txt = f"1g %{c1:+.1f}"
    elif c1 is None:
        score = 50.0 + 1.1 * float(c7)
        txt = f"7g %{c7:+.1f}"
    else:
        score = 50.0 + 1.1 * float(c7) + 0.5 * float(c1)
        txt = f"7g %{c7:+.1f}, 1g %{c1:+.1f}"
    score = max(5.0, min(95.0, score))
    return {"score": round(score, 1), "source": "live",
            "summary": f"TVL trendi {txt}",
            "data": {"change_7d": c7, "change_1d": c1,
                     "tvl": metrics.get("tvl"), "route": metrics.get("kind")}}


def score_depth(metrics: dict | None, token: str, now: float) -> dict:
    """TVL derinliği: logaritmik ölçek (1M$ → 15, 1B$ → 63, 100B$ → 95)."""
    if metrics is None or not metrics.get("matched"):
        base = _hash_score(token, "defi_depth", _day(now), lo=40, hi=85)
        note = ("mock: DeFi kaynağı alınamadı" if metrics is None
                else "mock: DefiLlama'da zincir/protokol eşleşmesi yok")
        return {"score": round(base, 1), "source": "mock",
                "summary": note, "data": {"mock": True}}
    tvl = metrics.get("tvl")
    if tvl is None or tvl <= 0:
        return {"score": 50.0, "source": "na",
                "summary": "TVL verisi yok/0 — nötr politika",
                "data": {"tvl": tvl}}
    score = 15.0 + 16.0 * math.log10(tvl / 1e6)
    score = max(15.0, min(95.0, score))
    route = "zincir" if metrics.get("kind") == "chain" else "protokol"
    return {"score": round(score, 1), "source": "live",
            "summary": f"{route} TVL {_money(float(tvl))}",
            "data": {"tvl": float(tvl), "route": metrics.get("kind")}}


def score_fees(metrics: dict | None, token: str, now: float) -> dict:
    """Günlük ücret geliri: log ölçek + 1 günlük değişimle ±6 puan ayar."""
    if metrics is None or not metrics.get("matched"):
        base = _hash_score(token, "defi_fees", _day(now), lo=35, hi=85)
        note = ("mock: DeFi kaynağı alınamadı" if metrics is None
                else "mock: DefiLlama'da zincir/protokol eşleşmesi yok")
        return {"score": round(base, 1), "source": "mock",
                "summary": note, "data": {"mock": True}}
    fees = metrics.get("fees_24h")
    if fees is None:
        return {"score": 50.0, "source": "na",
                "summary": "24s ücret verisi yok — nötr politika",
                "data": {"fees_24h": None}}
    if fees <= 0:
        return {"score": 20.0, "source": "live",
                "summary": "24s ücret geliri yok — gerçek, düşük skor",
                "data": {"fees_24h": float(fees)}}
    f1d = metrics.get("fees_change_1d")
    score = 50.0 + 15.0 * math.log10(float(fees) / 5e5)
    adj = 0.0
    if f1d is not None:
        adj = max(-6.0, min(6.0, float(f1d) * 0.6))
        score += adj
    score = max(10.0, min(95.0, score))
    txt = f"24s ücret {_money(float(fees))}"
    if f1d is not None:
        txt += f" (1g %{f1d:+.1f}{' ayar ' + format(adj, '+.1f') if adj else ''})"
    return {"score": round(score, 1), "source": "live", "summary": txt,
            "data": {"fees_24h": float(fees), "fees_change_1d": f1d}}


# APY → skor: 5%'de zirve; >20% sürdürülemezlik/enflasyon riski sayılır
APY_ANCHORS = [
    (-50.0, 20.0), (0.0, 55.0), (0.5, 62.0), (2.0, 74.0), (5.0, 85.0),
    (10.0, 78.0), (15.0, 70.0), (20.0, 60.0), (30.0, 45.0), (50.0, 30.0),
    (100.0, 18.0),
]


def score_yield(yields: dict | None, token: str, now: float) -> dict:
    """Token havuz getirisi (TVL ağırlıklı APY) — aşırı APY cezalı eğri."""
    if yields is None:
        base = _hash_score(token, "defi_yield", _day(now), lo=45, hi=80)
        return {"score": round(base, 1), "source": "mock",
                "summary": "mock: havuz (yields) kaynağı alınamadı",
                "data": {"mock": True}}
    if not yields.get("matched"):
        return {"score": 55.0, "source": "na",
                "summary": "bu sembol için eşleşen APY havuzu yok — nötr",
                "data": {"matched": False}}
    apy = yields.get("apy")
    if apy is None:
        return {"score": 55.0, "source": "na",
                "summary": "havuz APY verisi yok — nötr politika",
                "data": {"matched": True, "apy": None}}
    apy = float(apy)
    score = max(15.0, min(95.0, _piecewise(apy, APY_ANCHORS)))
    pools = int(yields.get("pools") or 0)
    ptvl = float(yields.get("tvl") or 0.0)
    txt = f"TVL ağırlıklı APY %{apy:.1f} · {pools} havuz ({_money(ptvl)})"
    if apy > 20:
        txt += " — eşik üstü: sürdürülemezlik/enflasyon riski"
    return {"score": round(score, 1), "source": "live", "summary": txt,
            "data": {"apy": round(apy, 3), "pools": pools,
                     "top": yields.get("top") or []}}


# ===================================================================== katman
class DefiLayer:
    """DeFi metrikleri katmanı — 4 bileşenli 0-100 skor."""

    name = "defi"
    COMPONENT_WEIGHTS = {
        "trend": 0.30, "depth": 0.25, "fees": 0.25, "yield": 0.20,
    }
    META_TTL = 300.0            # asset meta yenileme sıklığı (sn)

    def __init__(self, provider=None, asset_lookup=None):
        """provider: DefiProvider | None (None → tam mock).

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
        src = (getattr(cfg, "defi_source", "auto") or "auto").lower()
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
        category = (meta or {}).get("category", "")
        use_live = self._enabled(cfg) and self.provider is not None

        metrics = (self.provider.metrics(token, meta, category)
                   if use_live else None)
        yields = self.provider.yields(token) if use_live else None

        comps = {
            "trend": score_trend(metrics, token, now),
            "depth": score_depth(metrics, token, now),
            "fees": score_fees(metrics, token, now),
            "yield": score_yield(yields, token, now),
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

        if metrics and metrics.get("matched"):
            m_summary = {
                "route": metrics.get("kind"),
                "name": metrics.get("name"),
                "category": metrics.get("category"),
                "tvl": metrics.get("tvl"),
                "change_1d": metrics.get("change_1d"),
                "change_7d": metrics.get("change_7d"),
                "fees_24h": metrics.get("fees_24h"),
                "protocol": metrics.get("protocol"),
                "chain": metrics.get("chain"),
            }
        else:
            m_summary = {"note": metrics.get("note") if metrics
                         else "kaynak kapalı veya alınamadı"}
        if yields and yields.get("matched"):
            m_summary["apy"] = yields.get("apy")
            m_summary["apy_pools"] = yields.get("pools")

        details = {
            "components": {k: {"score": v["score"], "source": v["source"],
                               "summary": v["summary"]}
                           for k, v in comps.items()},
            "weights": dict(self.COMPONENT_WEIGHTS),
            "metrics": m_summary,
            "data_sources": sorted(sources),
        }
        for k, v in comps.items():
            details[k] = v["data"]
        return LayerScore(self.name, final, layer_source, details)
