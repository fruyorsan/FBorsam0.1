"""Skorlama katmanı çerçevesi.

Her katman `LayerProvider` arayüzünü uygular ve 0-100 arası skor üretir.
Faz 1'de yalnızca teknik katman gerçek (halka açık) veriden hesaplanır;
diğerleri MOCK skor üretir. Faz 2-4'te aynı arayüz korunarak gerçek
adaptörler (on-chain, DeFi, risk, duygu, makro) tek tek takılır.
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field


@dataclass
class LayerScore:
    layer: str                      # technical | onchain | defi | risk | sentiment | macro
    score: float                    # 0..100
    source: str = "mock"            # live | mock
    details: dict = field(default_factory=dict)

    def clamped(self) -> "LayerScore":
        self.score = max(0.0, min(100.0, float(self.score)))
        return self


LAYER_ORDER = ["technical", "onchain", "defi", "risk", "sentiment", "macro"]
LAYER_LABELS = {
    "technical": "Piyasa & Teknik",
    "onchain": "On-chain & Akıllı Para",
    "defi": "DeFi Metrikleri",
    "risk": "Risk & Güvenlik",
    "sentiment": "Duygu & Haber",
    "macro": "Makro",
}


# --------------------------------------------------------------------- yardımcılar
def ema(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2.0 / (period + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i - 1]
        gains.append(max(ch, 0.0))
        losses.append(max(-ch, 0.0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def macd_hist(closes: list[float]) -> float:
    if len(closes) < 35:
        return 0.0
    e12 = ema(closes, 12)
    e26 = ema(closes, 26)
    macd_line = [a - b for a, b in zip(e12, e26)]
    signal = ema(macd_line, 9)
    return macd_line[-1] - signal[-1]


def volatility_pct(closes: list[float], period: int = 14) -> float:
    """Yaklaşık günlük volatilite (%) — ATR yerine kapanış tabanlı sürüm."""
    if len(closes) < period + 1:
        return 2.0
    rets = [math.log(closes[i] / closes[i - 1])
            for i in range(len(closes) - period, len(closes)) if closes[i - 1] > 0]
    if not rets:
        return 2.0
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / max(len(rets) - 1, 1)
    return math.sqrt(var) * 100.0


def bollinger_pctb(closes: list[float], period: int = 20) -> float:
    if len(closes) < period:
        return 0.5
    window = closes[-period:]
    mid = sum(window) / period
    var = sum((x - mid) ** 2 for x in window) / period
    sd = math.sqrt(var)
    if sd == 0:
        return 0.5
    upper, lower = mid + 2 * sd, mid - 2 * sd
    return (closes[-1] - lower) / (upper - lower)


def _hash_score(*parts, lo: float = 0.0, hi: float = 100.0) -> float:
    """Deterministik (tekrarlanabilir) sözde-rastgele skor üretir."""
    h = hashlib.md5(":".join(str(p) for p in parts).encode()).hexdigest()
    v = int(h[:10], 16) / 0xFFFFFFFFFF  # 0..1
    return lo + v * (hi - lo)


# ------------------------------------------------------------------- teknik katman
class TechnicalLayer:
    """Piyasa & teknik katman (halka açık fiyat/hacim verisiyle hesaplanır)."""

    name = "technical"
    source = "live"

    def compute(self, symbol: str, feed, cfg) -> LayerScore:
        # Faz 9 — çok zaman dilimi: 4h giriş zamanlaması, 1d ana teyit,
        # 1w + 1M genel yön (uzun vade trendi).
        c4 = feed.series(symbol, 200, "4h")
        c1d = feed.series(symbol, 120, "1d")
        c1w = feed.series(symbol, 100, "1w")
        c1m = feed.series(symbol, 60, "1M")
        s4, d4 = self._score_series(c4)[-1]
        s1, d1 = self._score_series(c1d)[-1]
        sw, dw = self._score_series(c1w)[-1]
        sm, dm = self._score_series(c1m)[-1]
        score = 0.45 * s4 + 0.30 * s1 + 0.15 * sw + 0.10 * sm
        vol = volatility_pct(c4[-30:] if len(c4) >= 30 else c4)
        long_avg = (s1 + sw + sm) / 3.0
        details = {
            "4h": d4, "1d": d1, "1w": dw, "1m": dm,
            "rsi_4h": round(d4.get("rsi", 50), 1),
            "vol_pct": round(vol, 2),
            "multi_tf_teyit": (s4 >= 55 and s1 >= 55) or (s4 <= 45 and s1 <= 45),
            "genel_yon": {"skor": round(long_avg, 1),
                          "yon": ("yukarı" if long_avg >= 55
                                  else ("aşağı" if long_avg <= 45 else "nötr"))},
            "agirliklar": {"4h": 0.45, "1d": 0.30, "1w": 0.15, "1M": 0.10},
        }
        score = max(0.0, min(100.0, score))
        return LayerScore(self.name, score, self.source, details)

    # ------------------------------------------------------------ tek seriden skor
    def _score_series(self, closes: list[float]) -> list[tuple[float, dict]]:
        """Her bar için (skor, detay) — geçmişe sızma yok (causal)."""
        out: list[tuple[float, dict]] = []
        n = len(closes)
        for i in range(n):
            start = max(0, i - 199)
            w = closes[start:i + 1]
            if len(w) < 30:
                out.append((50.0, {"note": "yeterli veri yok"}))
                continue
            r = rsi(w, 14)
            e20, e50 = ema(w, min(20, len(w)))[-1], ema(w, min(50, len(w)))[-1]
            mh = macd_hist(w)
            pctb = bollinger_pctb(w, 20)
            price = w[-1]

            pts = 50.0
            # trend
            if e20 > e50:
                pts += 14 * min((e20 / e50 - 1) * 100, 5.0) / 5.0
            else:
                pts -= 14 * min((1 - e20 / e50) * 100, 5.0) / 5.0
            # momentum (MACD)
            if price > 0:
                rel = mh / price * 100
                pts += max(-10, min(10, rel * 400))
            # RSI: 40-65 arası sağlıklı, 70+ aşırı alım cezası, <30 aşırı satım hafif fırsat
            if 40 <= r <= 65:
                pts += 8
            elif r > 75:
                pts -= 12
            elif r > 68:
                pts -= 5
            elif r < 30:
                pts += 4
            elif r < 40:
                pts -= 4
            # Bollinger %B: yükseliş trendi üst banda yakın = pozitif ama uç nokta ceza
            if 0.55 <= pctb <= 0.9:
                pts += 8
            elif pctb > 1.0:
                pts -= 6
            elif pctb < 0.15:
                pts -= 4

            out.append((max(0.0, min(100.0, pts)), {
                "rsi": round(r, 1),
                "ema_trend": "yukarı" if e20 > e50 else "aşağı",
                "macd_hist": round(mh, 5),
                "bollinger_pctb": round(pctb, 2),
            }))
        return out

    def series_score(self, closes: list[float]) -> tuple[float, dict]:
        s, d = self._score_series(closes)[-1]
        return s, d


# ---------------------------------------------------------------------- mock katman
class MockLayer:
    """Gerçek adaptör gelene kadar çalışan deterministik sahte katman.

    Skorlar (varlık, katman, 6 saatlik zaman dilimi) ile tohumlanır; gün içinde
    sabit, günler arasında değişir. Detaylarda "mock" etiketi taşır ki panelde
    hangi katmanın gerçek veri olduğu görünür olsun.
    """

    def __init__(self, name: str, lo: float = 35.0, hi: float = 90.0):
        self.name = name
        self.source = "mock"
        self.lo, self.hi = lo, hi

    def compute(self, symbol: str, feed, cfg) -> LayerScore:
        bucket = int(__import__("time").time() // (6 * 3600))
        score = _hash_score(symbol, self.name, bucket, lo=self.lo, hi=self.hi)
        details = {
            "mock": True,
            "note": "Örnek veri — bu katman henüz gerçek kaynaktan beslenmiyor",
            "bucket": bucket,
        }
        if self.name == "risk":
            # Rug pull/hack sinyali simülasyonu: bazı varlıklarda bilinçli olarak düşük
            risky = _hash_score(symbol, "risk_flag", bucket // 4) < 0.15
            if risky:
                score = min(score, 38.0)
                details["uyarı"] = "Mock: olumsuz güvenlik sinyali simülasyonu"
        if self.name == "onchain":
            details["mock_wallet_sinyali"] = "Faz 2'de whale/akıllı cüzdan birikimiyle değişecek"
        return LayerScore(self.name, max(0.0, min(100.0, score)), self.source, details)


class LayerRegistry:
    """Tüm katmanları toplar; ağırlıklar decision modülünde uygulanır."""

    def __init__(self, providers: list | None = None):
        self.providers = providers or []

    def register(self, provider) -> None:
        self.providers.append(p for p in [provider] if p)

    def get(self, name: str):
        for p in self.providers:
            if p.name == name:
                return p
        return None

    def compute_all(self, symbol: str, feed, cfg) -> dict[str, LayerScore]:
        result: dict[str, LayerScore] = {}
        for p in self.providers:
            try:
                result[p.name] = p.compute(symbol, feed, cfg)
            except Exception as e:  # noqa: BLE001 — katman patlaması döngüyü indirmez
                result[p.name] = LayerScore(
                    p.name, 50.0, "mock",
                    {"error": str(e), "note": "katman hesaplanamadı, nötr skor verildi"},
                )
        # eksik katmanları nötr tamamla (tasarım gereği 6 katman)
        for name in LAYER_ORDER:
            result.setdefault(name, LayerScore(name, 50.0, "mock",
                                               {"note": "katman kayıtlı değil, nötr"}))
        return result


def build_default_registry(onchain_layer=None, risk_layer=None,
                           defi_layer=None, sentiment_layer=None,
                           macro_layer=None) -> LayerRegistry:
    """Faz 1-6 kayıtları: teknik gerçek, on-chain (Faz 2), defi (Faz 3),
    risk (Faz 4), duygu (Faz 5), makro (Faz 6). Sağlayıcı verilmezse ilgili
    katman deterministik mock."""
    return LayerRegistry([
        TechnicalLayer(),
        onchain_layer or MockLayer("onchain"),
        defi_layer or MockLayer("defi"),
        risk_layer or MockLayer("risk"),
        sentiment_layer or MockLayer("sentiment"),
        macro_layer or MockLayer("macro"),
    ])
