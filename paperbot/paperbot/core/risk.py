"""Faz 4 — Risk & Güvenlik katmanı (0-100, 4 bileşen).

Bileşen ağırları: saldırı geçmişi .30 | kontrat güvenliği .30
                   | denetim .25 | olgunluk .15

Tasarım kuralları:
- Kaynak yoksa bileşen deterministik **mock** skor üretir ve "mock" etiketi
  taşır (panelde/gerçekçede şeffaf).
- **Kritik tespit tavanları** (cap): honeypot/recent büyük hack vb. durumlarda
  nihai skor tavana vurur → ``risk_min_score`` eşiği (varsayılan 40) altında
  kalır → decision katmanındaki **risk veto'su** işlemi her koşulda kapatır.
- ``RISK_SOURCE=mock`` veya ``PRICE_SOURCE=mock`` (test/offline) iken
  sağlayıcı hiç çağrılmaz → ağ trafiği sıfır.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from ..data.security import FALLBACK_ADDRESSES
from .scoring import LayerScore, _hash_score

log = logging.getLogger("paperbot.risk")

YEAR = 31_557_600             # ortalama yıl (saniye)
BUCKET_6H = 21600

# Ağ doğuş yılları (bilinen majörler — yaş bileşeni için yedek)
GENESIS_YEAR = {
    "BTC": 2009, "ETH": 2015, "XRP": 2012, "ADA": 2017, "DOGE": 2013,
    "BNB": 2017, "SOL": 2020, "AVAX": 2020, "TRX": 2017, "LINK": 2017,
    "DOT": 2020, "MATIC": 2020, "ATOM": 2016, "LTC": 2011, "BCH": 2017,
}

KNOWN_AUDITORS = [
    "openzeppelin", "trail of bits", "quantstamp", "certik", "halborn",
    "spearbit", "zellic", "consensys", "mixbytes", "code4rena", "peckshield",
    "slowmist", "hacken", "pessimistic", "cure53", "dirmut", "statemind",
]

# Kritik tavanlar (bu değerlerin altı risk veto'sunu tetikler)
CAP_HONEYPOT = 10.0
CAP_RECENT_BIG_HACK = 35.0
CAP_UNVERIFIED = 30.0


def _day(now: float) -> int:
    return int(now // 86400)


# ============================================================== bileşenler
def score_exploit(hacks: list | None, token: str, now: float) -> dict:
    """Saldırı geçmişi: kayıt yok = yüksek skor; taze/büyük hack = tavan."""
    if hacks is None:  # kaynak alınamadı → deterministik mock
        base = _hash_score(token, "risk_exploit", _day(now), lo=45, hi=88)
        risky = _hash_score(token, "risk_flag", _day(now)) < 0.12
        if risky:
            base = min(base, 35.0)
        return {"score": round(base, 1), "source": "mock", "cap": 38.0 if risky else None,
                "summary": ("mock: olumsuz güvenlik sinyali simülasyonu" if risky
                            else "mock: DefiLlama hack verisi alınamadı"),
                "data": {"mock": True}}
    if not hacks:
        return {"score": 78.0, "source": "live", "cap": None,
                "summary": "DefiLlama hack kaydında saldırı yok", "data": {"count": 0}}

    def one(h: dict) -> tuple[float, float, dict]:
        amt = h.get("amount") or 0.0
        base = (15.0 if amt >= 1e8 else 25.0 if amt >= 5e7 else
                35.0 if amt >= 1e7 else 45.0 if amt >= 1e6 else 55.0)
        yrs = max(0.0, (now - (h.get("date") or now)) / YEAR)
        if yrs > 3:
            base += 8
        elif yrs > 1.5:
            base += 5
        if h.get("returned_funds"):
            base += 10          # fonlar iade edildiyiyle hafiflet
        if h.get("bridge_hack"):
            base -= 5           # köprü hackleri ekstra risk
        return max(3.0, min(95.0, base)), yrs, {
            "name": h.get("name"), "amount": amt, "year":
                datetime.fromtimestamp(h.get("date") or 0, tz=timezone.utc).year,
            "technique": h.get("technique"), "years_ago": round(yrs, 1),
        }

    scored = [one(h) for h in hacks]
    worst = min(scored, key=lambda x: x[0])
    extra = min(15.0, 5.0 * (len(hacks) - 1))
    score = max(3.0, worst[0] - extra)
    cap = None
    # 2 yıl içinde ≥50M$ hack → kritik tavan (veto)
    for sc, yrs, info in scored:
        if info["amount"] >= 5e7 and yrs < 2.0:
            cap = CAP_RECENT_BIG_HACK
            break
    info = worst[2]
    amt_txt = (f"{info['amount']/1e6:.1f}M$" if info["amount"] >= 1e6
               else "tutar belirsiz")
    return {
        "score": round(score, 1), "source": "live", "cap": cap,
        "summary": (f"{len(hacks)} saldırı kaydı; en kötüsü: {info['name']} "
                    f"{amt_txt} ({info['year']})"),
        "data": {"count": len(hacks), "events": [s[2] for s in scored][:5]},
    }


def score_contract(info: dict | None, token: str, now: float) -> dict:
    """GoPlus kontrat güvenliği: bayraklar → puanlama + kritik tavanlar."""
    if info is None:  # istek başarısız → mock
        base = _hash_score(token, "risk_contract", _day(now), lo=45, hi=90)
        return {"score": round(base, 1), "source": "mock", "cap": None,
                "summary": "mock: GoPlus verisi alınamadı", "data": {"mock": True}}
    if "na" in info:  # kontrat yok / ağ desteklenmiyor → politika skoru
        return {"score": 75.0, "source": "na", "cap": None,
                "summary": info["na"], "data": {"na": info["na"]}}

    f = info.get("flags") or {}
    issues: list[str] = []
    score = 85.0
    cap = None

    def yes(key: str) -> bool:
        return str(f.get(key, "0")) == "1"

    if yes("is_honeypot") or yes("honeypot_with_same_creator"):
        issues.append("HONEYPOT (satılamayan token)")
        score, cap = 0.0, CAP_HONEYPOT
    if yes("cannot_sell_all"):
        issues.append("tam satış engeli")
        score = min(score, 15.0)
        cap = min(cap or CAP_HONEYPOT, 15.0)
    if str(f.get("is_open_source", "1")) == "0":
        issues.append("kaynak kodu doğrulanamıyor")
        score = min(score, 30.0)
        cap = min(cap or CAP_UNVERIFIED, CAP_UNVERIFIED)
    if yes("is_mintable"):
        issues.append("sahip mint yetkisi")
        score -= 10
    if yes("can_take_back_ownership"):
        issues.append("sahiplik geri alınabilir")
        score -= 10
    if yes("hidden_owner"):
        issues.append("gizli sahip")
        score -= 10
    if yes("is_blacklisted"):
        issues.append("blacklist yetkisi")
        score -= 12
    if yes("transfer_pausable"):
        issues.append("transfer durdurulabilir")
        score -= 8
    if yes("selfdestruct"):
        issues.append("selfdestruct riski")
        score -= 15
    if yes("is_proxy"):
        issues.append("upgrade edilebilir proxy")
        score -= 5
    if yes("slippage_modifiable") or yes("personal_slippage_modifiable"):
        issues.append("slippage değiştirilebilir")
        score -= 6

    def _tax(key: str) -> float:
        try:
            return float(f.get(key) or 0)
        except (TypeError, ValueError):
            return 0.0
    tax = max(_tax("sell_tax"), _tax("buy_tax"))
    if tax > 0.10:
        issues.append(f"işlem vergisi %{tax*100:.0f}")
        score -= 15
    elif tax > 0.03:
        issues.append(f"düşük olmayan işlem vergisi %{tax*100:.1f}")
        score -= 8

    try:
        owner_pct = float(f.get("owner_percent") or 0)
    except (TypeError, ValueError):
        owner_pct = 0.0
    if owner_pct > 0.30:
        issues.append(f"sahip yoğunluğu %{owner_pct*100:.0f}")
        score -= 12
    elif owner_pct > 0.15:
        score -= 6

    try:
        top10 = sum(float(h.get("percent") or 0) for h in (f.get("holders") or [])[:10])
    except (TypeError, ValueError):
        top10 = 0.0
    if top10 > 0.40:
        issues.append(f"top-10 sahiplik yoğunluğu %{top10*100:.0f}")
        score -= 15
    elif top10 > 0.25:
        score -= 8

    if str(f.get("trust_list", "0")) == "1":
        score += 6
        issues.append("GoPlus güvenilir liste")

    score = max(0.0, min(95.0, score))
    summary = ("GoPlus: temiz — honeypot yok, sahip yetkileri sınırlı"
               if not issues else "GoPlus: " + "; ".join(issues[:5]))
    return {
        "score": round(score, 1), "source": "live", "cap": cap,
        "summary": summary,
        "data": {"address": info.get("address"), "chain": info.get("chain"),
                 "issues": issues, "top10_pct": round(top10 * 100, 1)},
    }


def score_audit(proto: dict | None, token: str, now: float,
                has_contract_token: bool = False) -> dict:
    """Denetim durumu (DefiLlama). Ana ağlar için politika skoru 'na'."""
    if proto is None:  # eşleşme yok → mock
        base = _hash_score(token, "risk_audit", _day(now), lo=40, hi=88)
        return {"score": round(base, 1), "source": "mock", "cap": None,
                "summary": "mock: DefiLlama protokol eşleşmesi yok",
                "data": {"mock": True}}
    addr = (proto.get("address") or "").strip()
    if not addr and not has_contract_token:
        return {"score": 75.0, "source": "na", "cap": None,
                "summary": "yerel ana ağı — kontrat denetimi kavramı geçerli değil",
                "data": {"native": True, "category": proto.get("category")}}

    n = int(proto.get("audits") or 0)
    score = 35.0 if n == 0 else 65.0 if n == 1 else 75.0 if n == 2 else 85.0
    links = list(proto.get("audit_links") or [])
    blob = " ".join(links).lower() + " " + (proto.get("name") or "").lower()
    found = [a for a in KNOWN_AUDITORS if a in blob]
    if found:
        score = min(92.0, score + 6)
    if n == 0:
        summary = f"{proto.get('name')}: DefiLlama'da denetim kaydı YOK"
    else:
        summary = f"{n} denetim" + \
            (f" ({', '.join(found[:2])})" if found else "") + \
            (f", {len(links)} rapor" if links else "")
    return {"score": round(score, 1), "source": "live", "cap": None,
            "summary": summary,
            "data": {"count": n, "links": links[:4], "auditors": found}}


def score_maturity(proto: dict | None, token: str, now: float) -> dict:
    """Protokol/ağ yaşı: eski = olgun = daha güvenli (üstel değil doğrusal).

    Sıra: DefiLlama listeleme → bilinen ağ doğuşu → ilk hallmark (yaşın
    ALT SINIRI) → protokol varsa muhafazakâr nötr ('na') → mock.
    """
    year = datetime.now(timezone.utc).year
    listed = (proto or {}).get("listed_at")
    if listed:
        years = max(0.0, (now - float(listed)) / YEAR)
        source, note = "live", f"DefiLlama listelemesi (~{years:.1f} yıl)"
    elif token in GENESIS_YEAR:
        years = max(0.0, year - GENESIS_YEAR[token])
        source, note = "live", f"bilinen ağ doğuşu (~{years:.0f} yıl)"
    elif (proto or {}).get("hallmarks_at"):
        years = max(0.0, (now - float(proto["hallmarks_at"])) / YEAR)
        source = "live"
        note = f"ilk önemli olay (~{years:.1f} yıl — yaş alt sınırı)"
    elif proto is not None:
        # kayıt var ama tarih yok: uydurma YAŞAMAZ, muhafazakâr nötr
        return {"score": 55.0, "source": "na", "cap": None,
                "summary": "yaş verisi yok — muhafazakâr nötr varsayım",
                "data": {"age_known": False}}
    else:
        base = _hash_score(token, "risk_age", _day(now) // 30, lo=35, hi=80)
        return {"score": round(base, 1), "source": "mock", "cap": None,
                "summary": "mock: yaş verisi bulunamadı", "data": {"mock": True}}
    score = min(95.0, 40.0 + years * 12.0)
    return {"score": round(score, 1), "source": source, "cap": None,
            "summary": note, "data": {"years": round(years, 1)}}


# ===================================================================== katman
class RiskLayer:
    """Risk & Güvenlik katmanı — 4 bileşenli 0-100 skor + kritik tavanlar."""

    name = "risk"
    COMPONENT_WEIGHTS = {
        "exploit": 0.30, "contract": 0.30, "audit": 0.25, "maturity": 0.15,
    }
    META_TTL = 300.0            # asset meta yenileme sıklığı (sn)

    def __init__(self, provider=None, asset_lookup=None):
        """provider: SecurityProvider | None (None → tam mock).

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
        src = (getattr(cfg, "risk_source", "auto") or "auto").lower()
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

        proto = self.provider.protocol(token, meta) if use_live else None
        hacks = self.provider.hacks(token, proto, meta) if use_live else None
        cinfo = self.provider.contract(token, proto) if use_live else None
        has_contract_token = bool((proto or {}).get("address")) or \
            token in FALLBACK_ADDRESSES

        comps = {
            "exploit": score_exploit(hacks, token, now),
            "contract": score_contract(cinfo, token, now),
            "audit": score_audit(proto, token, now, has_contract_token),
            "maturity": score_maturity(proto, token, now),
        }
        total = sum(self.COMPONENT_WEIGHTS[k] * comps[k]["score"]
                    for k in self.COMPONENT_WEIGHTS)
        caps = [c["cap"] for c in comps.values() if c.get("cap")]
        critical_cap = min(caps) if caps else None
        final = min(total, critical_cap) if critical_cap is not None else total
        final = max(0.0, min(100.0, final))
        sources = {c["source"] for c in comps.values()}
        # katman etiketi: yalnızca canlı kaynak gerçekten kullanıldıysa 'live'
        if use_live and any(comps[k]["source"] == "live"
                            for k in ("exploit", "contract", "audit")):
            layer_source = "live"
        else:
            layer_source = "mock"

        details = {
            "components": {k: {"score": v["score"], "source": v["source"],
                               "summary": v["summary"]}
                           for k, v in comps.items()},
            "weights": dict(self.COMPONENT_WEIGHTS),
            "critical_cap": critical_cap,
            "protocol": ({"name": proto["name"], "category": proto["category"],
                          "tvl": round(proto["tvl"], 0), "audits": proto["audits"]}
                         if proto else None),
            "data_sources": sorted(sources),
        }
        for k, v in comps.items():
            details[k] = v["data"]
        return LayerScore(self.name, final, layer_source, details)
