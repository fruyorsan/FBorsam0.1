"""Faz 2 testleri: on-chain pipeline, akıllı para sinyalleri, isabet oranı, katman."""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import pytest

from paperbot.config import AppConfig
from paperbot.core.decision import RuleBasedDecider
from paperbot.core.onchain import (
    OnchainLayer, OnchainPipeline, classify_action, wallet_weight,
    EXCLUDED_TYPES, QUALIFYING_TYPES,
)
from paperbot.core.scoring import LayerScore
from paperbot.data.onchain import MockOnchainProvider, mock_holdings
from paperbot.db import init_db, make_engine, make_session_factory
from paperbot.models import Wallet, WalletActivity, WalletSnapshot

DB = "./data/test_onchain.db"


def _remove_db() -> None:
    """SQLite dosyasını sil (Windows'ta bağlantı açıkken PermissionError verir)."""
    import os
    for suffix in ("", "-journal", "-wal", "-shm"):
        p = DB + suffix
        for _ in range(10):
            if not os.path.exists(p):
                break
            try:
                os.remove(p)
                break
            except PermissionError:
                time.sleep(0.1)


@pytest.fixture()
def ctx(tmp_path):
    _remove_db()
    cfg = AppConfig(database_url=f"sqlite:///{DB}", price_source="mock")
    engine = make_engine(cfg)
    sf = make_session_factory(engine)
    init_db(engine, sf, cfg)
    pipeline = OnchainPipeline(sf, MockOnchainProvider())
    try:
        yield cfg, sf, pipeline
    finally:
        engine.dispose()  # bağlantı havuzunu kapat → dosya kilidi bırakılır
        _remove_db()


def _now_on_bucket_edge() -> datetime:
    """Bucket sınırında bir zaman seç ki iki bucket kesinlikle farklı olsun."""
    now_ts = time.time()
    bucket_len = 21600
    b = int(now_ts // bucket_len)
    return datetime.fromtimestamp((b + 1) * bucket_len + 30, tz=timezone.utc)


def _add_wallet(sf, label, wtype, address=None, hit_rate=None) -> int:
    with sf() as s:
        w = Wallet(address=address or f"0x{label.lower().replace(' ', '')[:38]:0<38}",
                   label=label, wallet_type=wtype, is_active=True,
                   hit_rate=hit_rate, data_source="mock")
        s.add(w)
        s.commit()
        return w.id


def _add_activity(sf, wallet_id, token, usd, ts=None, action="buy"):
    with sf() as s:
        s.add(WalletActivity(wallet_id=wallet_id, ts=ts or datetime.now(timezone.utc),
                             token=token, action=action, qty_usd=usd,
                             detail={"test": True}))
        s.commit()


# --------------------------------------------------------------- mock üretici
def test_mock_holdings_deterministic_and_evolve():
    a = "0xabc000000000000000000000000000000000001"
    t = time.time()
    h1, h2 = mock_holdings(a, t), mock_holdings(a, t)
    assert h1 == h2, "aynı an için deterministik olmalı"
    assert sum(h1.values()) > 0

    # bucket sınırını geçince portföy değişmeli (regim değişimi)
    b = int(t // 21600)
    ts_edge = (b + 1) * 21600 + 5
    assert mock_holdings(a, ts_edge) != h1


def test_classify_action():
    assert classify_action(0.0, 50_000) == "buy"          # yeni token
    assert classify_action(100_000, 30_000) == "increase"  # artırım
    assert classify_action(100_000, -30_000) == "decrease"  # azaltım
    assert classify_action(100_000, -100_000) == "sell"     # tam çıkış


# ------------------------------------------------------------------- pipeline
def test_refresh_creates_snapshot_and_detects_delta(ctx):
    cfg, sf, pipeline = ctx
    wid = _add_wallet(sf, "Delta Whale", "individual_whale", "0xdelta000000000000000000000000000000000001")
    now = _now_on_bucket_edge()
    with sf() as s:  # bilinen eski anlık görüntü koy
        s.add(WalletSnapshot(wallet_id=wid, ts=now - timedelta(hours=1),
                             holdings={"ETH": 100_000.0, "ZZZ": 50_000.0},
                             total_usd=150_000.0, source="mock"))
        s.commit()

    summary = pipeline.refresh(now=now)
    assert summary["wallets"] >= 1
    assert summary["errors"] == []
    assert summary["activities"] > 0, "portföy farkı → hareket kaydı oluşmalı"

    with sf() as s:
        acts = s.query(WalletActivity).filter(WalletActivity.wallet_id == wid).all()
        assert acts, "aktivite kaydı yok"
        tokens = {a.token for a in acts}
        assert "ZZZ" in tokens or any(a.action in ("buy", "increase", "decrease", "sell")
                                      for a in acts)
        # her aktivite işaretli delta taşır
        assert all(a.qty_usd != 0 for a in acts)
        # ikinci tazeleme aynı bucket içinde yeni hareket üretmemeli
        n_before = len(acts)
    summary2 = pipeline.refresh(now=now + timedelta(minutes=10))
    with sf() as s:
        n_after = s.query(WalletActivity).filter(WalletActivity.wallet_id == wid).count()
    assert n_after == n_before, "aynı bucket içinde tekrar tazeleme hareket üretmemeli"


def test_signal_single_wallet_is_weak_two_is_strong(ctx):
    _, sf, pipeline = ctx
    now = datetime.now(timezone.utc)
    w1 = _add_wallet(sf, "Smart Alpha", "smart_money")
    _add_activity(sf, w1, "UNI", 200_000, now - timedelta(days=1))

    sig1 = pipeline.token_signal("UNI", now)
    assert sig1["distinct_accumulators"] == 1
    assert sig1["strong"] is False, "tek cüzdan ZAYIF sinyal olmalı"
    assert sig1["score"] > 50

    w2 = _add_wallet(sf, "Whale Beta", "individual_whale")
    _add_activity(sf, w2, "UNI", 200_000, now - timedelta(days=2))
    sig2 = pipeline.token_signal("UNI", now)
    assert sig2["distinct_accumulators"] == 2
    assert sig2["strong"] is True, "iki bağımsız cüzdan GÜÇLÜ sinyal"
    assert sig2["score"] > sig1["score"], "çoklu cüzdan daha yüksek skor"
    assert len(sig2["evidence"]) == 2


def test_exchange_and_team_wallets_do_not_count(ctx):
    _, sf, pipeline = ctx
    now = datetime.now(timezone.utc)
    we = _add_wallet(sf, "Binance Cold", "exchange")
    wt = _add_wallet(sf, "Team Vesting", "team_vesting")
    wm = _add_wallet(sf, "MM One", "market_maker")
    _add_activity(sf, we, "AAVE", 500_000, now - timedelta(days=1))
    _add_activity(sf, wt, "AAVE", 500_000, now - timedelta(days=1))
    _add_activity(sf, wm, "AAVE", 500_000, now - timedelta(days=1))

    sig = pipeline.token_signal("AAVE", now)
    assert sig["distinct_accumulators"] == 0, "borsa/ekip/MM akıllı para sayılmaz"
    assert sig["verdict"] in ("no_data", "flat", "distribution")
    assert sig["score"] == pytest.approx(50.0)
    assert len(sig["excluded"]) >= 3, "hariç tutulanlar şeffafça listelenmeli"
    assert all(x["type"] in EXCLUDED_TYPES for x in sig["excluded"])


def test_hit_rate_weights_signal(ctx):
    """Başarılı cüzdanın sinyali daha ağır; başarısız olanın daha hafif."""
    _, sf, pipeline = ctx
    now = datetime.now(timezone.utc)
    w_good = _add_wallet(sf, "Genius", "smart_money", hit_rate=0.9)
    _add_activity(sf, w_good, "LINK", 200_000, now - timedelta(days=1))
    sig_good = pipeline.token_signal("LINK", now)

    # aynı net için düşük isabet oranlı cüzdan
    with sf() as s:
        w = s.get(Wallet, w_good)
        w.hit_rate = 0.1
        s.commit()
    sig_bad = pipeline.token_signal("LINK", now)

    assert sig_good["score"] > sig_bad["score"]
    assert wallet_weight(type("W", (), {"hit_rate": 0.9})()) == pytest.approx(1.32)
    assert wallet_weight(type("W", (), {"hit_rate": None})()) == 1.0


def test_exchange_flow_direction(ctx):
    _, sf, pipeline = ctx
    now = datetime.now(timezone.utc)
    we = _add_wallet(sf, "CEX", "exchange")
    _add_activity(sf, we, "MKR", 800_000, now - timedelta(days=1), action="increase")
    dep = pipeline.exchange_flow("MKR", now)
    assert dep["score"] < 50, "borsaya giriş (satış baskısı) skoru düşürmeli"

    with sf() as s:  # aynı pencerede net çekiliş yap
        for a in s.query(WalletActivity).filter(WalletActivity.token == "MKR").all():
            a.qty_usd = -800_000
        s.commit()
    wd = pipeline.exchange_flow("MKR", now)
    assert wd["score"] > 50, "borsadan çıkış (birikim) skoru yükseltmeli"

    assert pipeline.exchange_flow("NOEXISTCOIN", now)["score"] == 50.0


# ----------------------------------------------------------------------- katman
def test_onchain_layer_score_and_evidence(ctx):
    cfg, sf, pipeline = ctx
    now = datetime.now(timezone.utc)
    w1 = _add_wallet(sf, "Smart A", "smart_money")
    w2 = _add_wallet(sf, "Whale B", "individual_whale", hit_rate=0.8)
    _add_activity(sf, w1, "UNI", 300_000, now - timedelta(days=1))
    _add_activity(sf, w2, "UNI", 250_000, now - timedelta(days=2))

    layer = OnchainLayer(pipeline)
    score = layer.compute("UNIUSDT", feed=None, cfg=cfg)
    assert isinstance(score, LayerScore)
    assert score.layer == "onchain"
    assert 0 <= score.score <= 100
    sm = score.details["smart_money"]
    assert sm["strong"] is True
    assert len(sm["evidence"]) == 2
    assert sm["evidence"][0]["label"] in ("Smart A", "Whale B")
    # bileşenlerin ağırlıkları toplamı 1.0
    assert sum(score.details["weights"].values()) == pytest.approx(1.0)
    # her bileşenin kaynağı işaretli
    assert all("source" in v for v in score.details["components"].values())


def test_rationale_shows_wallet_evidence(ctx):
    cfg, *_ = ctx
    onchain_details = {
        "smart_money": {
            "strong": True, "distinct_accumulators": 2, "window_days": 7,
            "evidence": [
                {"label": "Smart Alpha", "type": "smart_money", "net_usd": 150000.0,
                 "hit_rate": 0.72, "weight": 1.18},
                {"label": "Blue Whale", "type": "individual_whale", "net_usd": 80000.0,
                 "hit_rate": None, "weight": 1.0},
            ],
            "excluded": [{"label": "Binance Cold", "type": "exchange"}],
        }
    }
    scores = {
        "technical": LayerScore("technical", 78, "live", {"vol_pct": 2.1}),
        "onchain": LayerScore("onchain", 82, "mock", onchain_details),
        "defi": LayerScore("defi", 62, "mock", {}),
        "risk": LayerScore("risk", 84, "mock", {}),
        "sentiment": LayerScore("sentiment", 60, "mock", {}),
        "macro": LayerScore("macro", 55, "mock", {}),
    }
    d = RuleBasedDecider(cfg).decide("UNIUSDT", scores)
    assert "Akıllı para kanıtı" in d.rationale
    assert "Smart Alpha" in d.rationale
    assert "Blue Whale" in d.rationale
    assert "GÜÇLÜ" in d.rationale
    assert "Binance Cold" in d.rationale, "hariç tutulan cüzdanlar gerekçede görünmeli"


def test_rationale_distribution_not_phrased_as_accumulation(ctx):
    """DAĞITIM sinyali '0 cüzdan biriktirdi → TEK cüzdan' gibi çelişkili olmamalı."""
    cfg, *_ = ctx
    onchain_details = {
        "smart_money": {
            "verdict": "distribution", "strong": False,
            "distinct_accumulators": 0, "window_days": 7,
            "evidence": [
                {"label": "Dumper", "type": "smart_money", "net_usd": -23012.0,
                 "hit_rate": None, "weight": 1.0},
            ],
            "excluded": [],
        }
    }
    scores = {k: LayerScore(k, 70, "mock", {}) for k in
              ("technical", "defi", "risk", "sentiment", "macro")}
    scores["onchain"] = LayerScore("onchain", 45, "mock", onchain_details)
    d = RuleBasedDecider(cfg).decide("PENDLEUSDT", scores)
    r = d.rationale
    assert "Akıllı para kanıtı" in r
    assert "DAĞITIM" in r, "dağıtım açıkça DAĞITIM olarak etiketlenmeli"
    assert "TEK cüzdan" not in r, "0 biriktiren cüzdan 'TEK cüzdan' denmemeli"
    assert "net biriktirdi" not in r, "negatif net 'biriktirdi' denmemeli"
    assert "azaltım" in r, "kanıt yönü (azaltım) görünür olmalı"
    assert "Dumper" in r


# --------------------------------------------------------------- isabet oranı
class RisingFeed:
    """Günlük %2 yükselen sahte geçmiş — sinyaller 'hit' olmalı."""
    source = "mock"

    def historical_ohlcv(self, symbol, interval, days):
        now_ms = time.time() * 1000
        start = now_ms - days * 86_400_000
        out, p = [], 100.0
        t = start
        while t <= now_ms:
            out.append((int(t), p, p * 1.01, p * 0.99, p, 10.0))
            p *= 1.02
            t += 86_400_000
        return out

    def prices_for(self, symbols):
        return {s: 100.0 for s in symbols}, "mock"


def test_evaluate_hits_updates_hit_rate(ctx):
    cfg, sf, pipeline = ctx
    wid = _add_wallet(sf, "Old Smart", "smart_money")
    act_ts = datetime.now(timezone.utc) - timedelta(days=10)
    _add_activity(sf, wid, "UNI", 200_000, act_ts, action="buy")

    res = pipeline.evaluate_hits(now=datetime.now(timezone.utc),
                                 force=True, feed=RisingFeed())
    assert res["skipped"] is False
    assert res["hit"] >= 1, "yükselen fiyatta sinyal 'isabetli' sayılmalı"

    with sf() as s:
        w = s.get(Wallet, wid)
        assert w.hit_rate is not None and w.hit_rate >= 0.5
        assert w.signals_total >= 1
        acts = s.query(WalletActivity).all()
        assert all(a.evaluated for a in acts)
        assert acts[0].detail.get("hit", {}).get("result") == "hit"


def test_evaluate_hits_throttled_once_per_day(ctx):
    _, sf, pipeline = ctx
    r1 = pipeline.evaluate_hits(force=True, feed=RisingFeed())
    r2 = pipeline.evaluate_hits(feed=RisingFeed())          # force yok → atlanır
    assert r1["skipped"] is False
    assert r2.get("skipped") is True
