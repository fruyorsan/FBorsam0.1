"""Faz 2 — On-chain & Akıllı Para katmanı.

Akış (her çevrimde):
1. `OnchainPipeline.refresh()`   → tüm aktif cüzdanların portföyü çekilir,
   önceki anlık görüntüyle fark alınır → WalletActivity kaydı (alım/azaltım/satış)
2. `token_signal(token)`         → pencere içindeki hareketler cüzdan TÜRÜ ve
   İSABET ORANI ağırlıklarıyla birleştirilir; tek cüzdan = zayıf, ≥2 = güçlü
3. `OnchainLayer.compute()`      → sinyal + borsa akışları + ağ/metrik
   bileşenlerini 0-100 tek skora katman skoru olarak üretir

Kurallar (gereksinim §3.2):
- Borsa (exchange), ekip/vesting ve market maker cüzdanları "akıllı para
  alımı" SAYILMAZ (yalnız şeffaflık için ayrı gösterilir).
- Cüzdanların geçmiş isabet oranı ağırlığı belirler (0.6x - 1.4x).
- Tek cüzdan zayıf sinyal; birden fazla bağımsız cüzdan güçlü sinyal.
- Kaynak yoksa mock: sistem hata almaz, katman `mock` etiketi üretir.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from ..data.onchain import mock_holdings, build_onchain_provider
from ..db import get_state, set_state
from ..models import Asset, Wallet, WalletActivity, WalletSnapshot
from .scoring import LayerScore, _hash_score

log = logging.getLogger("paperbot.onchain")

QUALIFYING_TYPES = {"smart_money", "individual_whale", "fund"}
EXCLUDED_TYPES = {"exchange", "team_vesting", "market_maker"}

SIGNAL_LOOKBACK_DAYS = 7      # sinyal penceresi
HIT_WINDOW_DAYS = 7           # isabet değerlendirmesi penceresi
HIT_THRESHOLD = 0.03          # ±%3 eşik
MIN_DELTA_USD = 1000.0        # bundan küçük farklar hareket sayılmaz


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def classify_action(prev_usd: float, delta: float) -> str:
    """Portföy farkından hareket türü."""
    if delta > 0:
        return "buy" if prev_usd <= 1.0 else "increase"
    remaining = prev_usd + delta                    # delta negatif
    if remaining <= max(prev_usd * 0.05, 1.0):
        return "sell"                               # tam / neredeyse tam çıkış
    return "decrease"


def wallet_weight(wallet: Wallet) -> float:
    """İsabet oranına göre ağırlık: 0.0→0.6x, 0.5→1.0x, 1.0→1.4x."""
    if wallet.hit_rate is None:
        return 1.0
    return 0.6 + 0.8 * max(0.0, min(1.0, wallet.hit_rate))


class OnchainPipeline:
    """Cüzdan portföy tazeleme, fark tespiti, sinyal biriktirme, isabet takibi."""

    def __init__(self, session_factory, provider, feed=None):
        self.session_factory = session_factory
        self.provider = provider
        self.feed = feed
        self.last_refresh: datetime | None = None
        self.last_error: str = ""

    # ------------------------------------------------------------ portföy tazeleme
    def refresh(self, cfg=None, now: datetime | None = None) -> dict:
        now = now or _utcnow()
        summary = {"wallets": 0, "activities": 0, "source": getattr(self.provider, "name", "?"),
                   "errors": []}
        try:
            with self.session_factory() as s:
                wallets = s.execute(
                    select(Wallet).where(Wallet.is_active.is_(True))
                ).scalars().all()
                for w in wallets:
                    try:
                        holdings = self.provider.portfolio(w.address, now.timestamp())
                        source = getattr(self.provider, "name", "mock")
                        if not holdings:
                            holdings = mock_holdings(w.address, now.timestamp())
                            source = "mock"
                    except Exception as e:  # noqa: BLE001 — tek cüzdan hatası döngüyü indirmez
                        summary["errors"].append(f"{w.label or w.address[:10]}: {e}")
                        holdings = mock_holdings(w.address, now.timestamp())
                        source = "mock"

                    prev = s.execute(
                        select(WalletSnapshot)
                        .where(WalletSnapshot.wallet_id == w.id,
                               WalletSnapshot.ts <= now)
                        .order_by(WalletSnapshot.ts.desc()).limit(1)
                    ).scalars().first()

                    if prev is not None:
                        for token, cur_usd in holdings.items():
                            delta = cur_usd - float((prev.holdings or {}).get(token, 0.0))
                            if abs(delta) < MIN_DELTA_USD:
                                continue
                            action = classify_action(
                                float((prev.holdings or {}).get(token, 0.0)), delta)
                            s.add(WalletActivity(
                                wallet_id=w.id, ts=now, token=token, action=action,
                                qty_usd=round(delta, 2),
                                detail={"prev_usd": round(float((prev.holdings or {}).get(token, 0.0)), 2),
                                        "cur_usd": round(cur_usd, 2), "source": source},
                            ))
                            summary["activities"] += 1
                        # eksik kalan (çıkan) token'lar
                        for token, old_usd in (prev.holdings or {}).items():
                            if token in holdings or float(old_usd) < MIN_DELTA_USD:
                                continue
                            s.add(WalletActivity(
                                wallet_id=w.id, ts=now, token=token, action="sell",
                                qty_usd=round(-float(old_usd), 2),
                                detail={"prev_usd": round(float(old_usd), 2),
                                        "cur_usd": 0.0, "source": source},
                            ))
                            summary["activities"] += 1

                    s.add(WalletSnapshot(wallet_id=w.id, ts=now, holdings=holdings,
                                         total_usd=round(sum(holdings.values()), 2),
                                         source=source))
                    w.last_snapshot_at = now
                    w.data_source = source
                    summary["wallets"] += 1
                s.commit()
            self.last_refresh = now
            self.last_error = ""
        except Exception as e:  # noqa: BLE001
            self.last_error = str(e)
            log.exception("On-chain tazeleme hatası")
            summary["errors"].append(str(e))
        return summary

    # ---------------------------------------------------------------- sinyaller
    def _window_activities(self, token: str, now: datetime, session):
        start = now - timedelta(days=SIGNAL_LOOKBACK_DAYS)
        return session.execute(
            select(WalletActivity, Wallet)
            .join(Wallet, WalletActivity.wallet_id == Wallet.id)
            .where(WalletActivity.token == token,
                   WalletActivity.ts >= start,
                   WalletActivity.ts <= now,
                   Wallet.is_active.is_(True))
        ).all()

    def token_signal(self, token: str, now: datetime | None = None) -> dict:
        """Token bazında akıllı para sinyali (0-100) + kanıt listesi."""
        now = now or _utcnow()
        with self.session_factory() as s:
            rows = self._window_activities(token, now, s)
            per_wallet: dict[int, dict] = {}
            excluded: list[dict] = []
            source = "mock"
            for act, w in rows:
                if w.data_source == "etherscan":
                    source = "live"
                rec = per_wallet.setdefault(w.id, {
                    "wallet_id": w.id, "label": w.label or w.address[:10],
                    "type": w.wallet_type, "net_usd": 0.0,
                    "hit_rate": w.hit_rate, "actions": [],
                })
                rec["net_usd"] += float(act.qty_usd or 0.0)
                rec["actions"].append(act.action)

                if w.wallet_type in EXCLUDED_TYPES:
                    excluded.append({
                        "wallet_id": w.id, "label": w.label or w.address[:10],
                        "type": w.wallet_type, "net_usd": round(float(act.qty_usd or 0), 2),
                        "note": "borsa/ekip/MM — akıllı para sayılmaz",
                    })

            qualifying = [r for r in per_wallet.values()
                          if r["type"] in QUALIFYING_TYPES]
            accum = [r for r in qualifying if r["net_usd"] > 500]
            dist = [r for r in qualifying if r["net_usd"] < -500]

            net_total = sum(r["net_usd"] * wallet_weight(
                s.get(Wallet, r["wallet_id"])) for r in qualifying) \
                if qualifying else 0.0

            if not qualifying and not excluded:
                score = 50.0
                verdict = "no_data"
            elif net_total > 0:
                strength = math.tanh(net_total / 400_000.0)
                distinct = len(accum)
                distinct_factor = 0.35 + 0.65 * min(distinct, 4) / 4
                score = 50.0 + 45.0 * strength * distinct_factor
                verdict = "accumulation"
            elif net_total < 0:
                strength = math.tanh(abs(net_total) / 400_000.0)
                distinct = len(dist)
                distinct_factor = 0.40 + 0.60 * min(distinct, 4) / 4
                score = 50.0 - 40.0 * strength * distinct_factor
                verdict = "distribution"
            else:
                score, verdict = 50.0, "flat"

            # kanıt listesi: ağırlıkları da ekle
            for r in qualifying:
                w_obj = s.get(Wallet, r["wallet_id"])
                r["weight"] = round(wallet_weight(w_obj), 2)
                r["net_usd"] = round(r["net_usd"], 2)
            for r in excluded:
                r["net_usd"] = round(r["net_usd"], 2)

            distinct_accum = len(accum)
            return {
                "token": token, "score": round(max(0.0, min(100.0, score)), 1),
                "verdict": verdict,
                "strong": distinct_accum >= 2,
                "distinct_accumulators": distinct_accum,
                "net_usd": round(net_total, 2),
                "evidence": sorted(qualifying, key=lambda r: -r["net_usd"]),
                "excluded": excluded[:8],
                "lookback_days": SIGNAL_LOOKBACK_DAYS,
                "source": source,
                "wallets_checked": len(per_wallet),
            }

    def exchange_flow(self, token: str, now: datetime | None = None) -> dict:
        """Borsa cüzdanlarına net giriş/çıkış (giriş = satış baskısı)."""
        now = now or _utcnow()
        with self.session_factory() as s:
            rows = self._window_activities(token, now, s)
            net = 0.0
            n = 0
            for act, w in rows:
                if w.wallet_type == "exchange":
                    net += float(act.qty_usd or 0.0)
                    n += 1
            if n == 0:
                return {"score": 50.0, "net_usd": 0.0, "events": 0,
                        "note": "takip edilen borsa cüzdanı hareketi yok",
                        "source": "mock"}
            # borsaya giriş (pozitif delta) = satış baskısı → skor düşer
            score = 50.0 - 45.0 * math.tanh(net / 500_000.0)
            return {"score": round(max(0.0, min(100.0, score)), 1),
                    "net_usd": round(net, 2), "events": n,
                    "note": ("borsaya net GİRİŞ (satış baskısı)" if net > 0
                             else "borsadan net ÇEKİLİŞ (birikim)"),
                    "source": "mock"}

    def signals(self, now: datetime | None = None) -> list[dict]:
        """Panel için: izlenen varlıkların token'ları için sinyal özeti."""
        now = now or _utcnow()
        with self.session_factory() as s:
            symbols = s.execute(select(Asset.symbol).where(Asset.enabled.is_(True))).scalars().all()
        out = []
        for sym in symbols:
            token = sym[:-4] if sym.endswith("USDT") else sym
            sig = self.token_signal(token, now)
            ex = self.exchange_flow(token, now)
            if sig["wallets_checked"] == 0 and ex["events"] == 0:
                continue
            out.append({"symbol": sym, "token": token, **sig,
                        "exchange_flow": ex})
        return sorted(out, key=lambda x: -x["score"])

    # ------------------------------------------------------------ isabet oranı
    def evaluate_hits(self, now: datetime | None = None, force: bool = False,
                      feed=None) -> dict:
        """7 gün önceki ALIM sinyallerini fiyatla karşılaştırıp isabet oranı üretir."""
        now = now or _utcnow()
        feed = feed or self.feed
        day_key = now.strftime("%Y-%m-%d")
        with self.session_factory() as s:
            if not force and get_state(s, "last_hit_eval_key", "") == day_key:
                return {"skipped": True, "reason": "bugün zaten değerlendirildi"}

            known = {sym[:-4] if sym.endswith("USDT") else sym
                     for sym in s.execute(select(Asset.symbol)).scalars()}
            cutoff = now - timedelta(days=HIT_WINDOW_DAYS)
            pending = s.execute(
                select(WalletActivity).where(
                    WalletActivity.evaluated.is_(False),
                    WalletActivity.action.in_(["buy", "increase"]),
                    WalletActivity.ts <= cutoff,
                )
            ).scalars().all()

            results = {"hit": 0, "miss": 0, "neutral": 0, "no_data": 0}
            per_wallet: dict[int, list] = {}
            for act in pending:
                token = act.token
                res = {"result": "no_data"}
                if feed is not None and token in known:
                    res = self._evaluate_one(feed, act, now)
                act.evaluated = True
                act.detail = {**(act.detail or {}), "hit": res}
                results[res["result"]] = results.get(res["result"], 0) + 1
                if res["result"] in ("hit", "miss", "neutral"):
                    per_wallet.setdefault(act.wallet_id, []).append(res["result"])

            for wid, outcomes in per_wallet.items():
                w = s.get(Wallet, wid)
                if not w:
                    continue
                hits = outcomes.count("hit")
                miss = outcomes.count("miss")
                neutral = outcomes.count("neutral")
                denom = hits + miss + neutral
                if denom:
                    w.hit_rate = round((hits + 0.5 * neutral) / denom, 3)
                    w.signals_hit = hits + miss          # değerlendirilen (hit|miss) gösterimi
                    w.signals_miss = miss
            total_bull = s.execute(
                select(WalletActivity).where(
                    WalletActivity.action.in_(["buy", "increase"]))
            ).scalars().all()
            counts: dict[int, int] = {}
            for a in total_bull:
                counts[a.wallet_id] = counts.get(a.wallet_id, 0) + 1
            for wid, c in counts.items():
                w = s.get(Wallet, wid)
                if w:
                    w.signals_total = c

            set_state(s, "last_hit_eval_key", day_key)
            s.commit()
        return {"skipped": False, **results}

    @staticmethod
    def _evaluate_one(feed, act: WalletActivity, now: datetime) -> dict:
        """Aktivite anındaki fiyat ile +7 günlük fiyatı karşılaştır."""
        try:
            symbol = act.token + "USDT"
            bars = feed.historical_ohlcv(symbol, "1d", days=45)
            if not bars or len(bars) < 2:
                return {"result": "no_data"}
            ts = act.ts if act.ts.tzinfo else act.ts.replace(tzinfo=timezone.utc)
            t0 = ts.timestamp() * 1000
            t1 = (ts + timedelta(days=HIT_WINDOW_DAYS)).timestamp() * 1000

            def price_at(t):
                for b in bars:
                    if b[0] >= t:
                        return b[4]
                return bars[-1][4]

            p0, p1 = price_at(t0), price_at(min(t1, now.timestamp() * 1000))
            if not p0 or not p1:
                return {"result": "no_data"}
            ret = p1 / p0 - 1.0
            result = ("hit" if ret >= HIT_THRESHOLD else
                      "miss" if ret <= -HIT_THRESHOLD else "neutral")
            return {"result": result, "return_pct": round(ret * 100, 2),
                    "p0": p0, "p1": p1}
        except Exception as e:  # noqa: BLE001
            return {"result": "no_data", "error": str(e)}


# ======================================================================= katman
class OnchainLayer:
    """On-chain & Akıllı Para katmanı — 6 bileşenli 0-100 skor.

    Bileşen ağırlıkları: akıllı para .45 | borsa akışı .15 | ağ aktivitesi .12
                         | stablecoin .08 | unlock .10 | dağılım .10
    """

    name = "onchain"
    COMPONENT_WEIGHTS = {
        "smart_money": 0.45, "exchange_flow": 0.15, "network": 0.12,
        "stablecoin": 0.08, "unlock": 0.10, "distribution": 0.10,
    }

    def __init__(self, pipeline: OnchainPipeline):
        self.pipeline = pipeline
        self.source = getattr(pipeline.provider, "name", "mock")

    def compute(self, symbol: str, feed, cfg) -> LayerScore:
        token = symbol[:-4] if symbol.endswith("USDT") else symbol
        now = datetime.now(timezone.utc)
        sig = self.pipeline.token_signal(token, now)
        ex = self.pipeline.exchange_flow(token, now)

        day = int(now.timestamp() // 86_400)
        week = int(now.timestamp() // 604_800)

        network_score = _hash_score(symbol, "network", day, lo=40, hi=85)
        stable_score = _hash_score(symbol, "stablecoin", day, lo=35, hi=90)

        unlock_r = _hash_score(token, "unlock", week, lo=0, hi=1)
        has_unlock = unlock_r < 0.30
        unlock_score = (30 + unlock_r * 15) if has_unlock else (72 + unlock_r * 25)

        conc = _hash_score(token, "distribution", week // 4, lo=15, hi=75)
        dist_score = max(25.0, min(95.0, 105 - conc * 0.9))

        components = {
            "smart_money": {"score": sig["score"], "source": sig["source"],
                            "data": sig},
            "exchange_flow": {"score": ex["score"], "source": "mock", "data": ex},
            "network": {"score": round(network_score, 1), "source": "mock",
                        "data": {"note": "aktif adres/işlem sayısı — mock "
                                         "(Dune/Glassnode adaptörü Faz 2.5)"}},
            "stablecoin": {"score": round(stable_score, 1), "source": "mock",
                           "data": {"note": "stablecoin arzı ve akışı — mock "
                                            "(Faz 2.5 adaptörü bekliyor)"}},
            "unlock": {"score": round(unlock_score, 1), "source": "mock",
                       "data": {"upcoming_unlock": has_unlock,
                                "note": "token unlock takvimi — mock "
                                        "(TokenUnlocks adaptörü Faz 2.5)"}},
            "distribution": {"score": round(dist_score, 1), "source": "mock",
                             "data": {"top10_concentration_pct": round(conc, 1),
                                      "note": "token dağılım yoğunluğu — mock"}},
        }
        total = sum(self.COMPONENT_WEIGHTS[k] * components[k]["score"]
                    for k in self.COMPONENT_WEIGHTS)

        details = {
            "components": {k: {"score": v["score"], "source": v["source"]}
                           for k, v in components.items()},
            "weights": dict(self.COMPONENT_WEIGHTS),
            "smart_money": {
                "score": sig["score"], "verdict": sig["verdict"],
                "strong": sig["strong"],
                "distinct_accumulators": sig["distinct_accumulators"],
                "net_usd": sig["net_usd"], "source": sig["source"],
                "evidence": sig["evidence"][:6],
                "excluded": sig["excluded"],
                "window_days": sig["lookback_days"],
            },
            "exchange_flow": ex,
            "unlock": components["unlock"]["data"],
            "distribution": components["distribution"]["data"],
        }
        return LayerScore(self.name, max(0.0, min(100.0, total)),
                          sig["source"], details)
