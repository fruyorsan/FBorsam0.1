"""Faz 3 testleri: DeFi metrikleri katmanı (bileşenler, na/mock, roatlama)."""
from __future__ import annotations

from paperbot.config import AppConfig
from paperbot.core.decision import RuleBasedDecider
from paperbot.core.defi import (
    DefiLayer, score_depth, score_fees, score_trend, score_yield,
)
from paperbot.core.scoring import LayerScore, build_default_registry, MockLayer
from paperbot.data.defi import (
    DefiProvider, build_defi_provider, history_changes,
)

NOW = 1_700_000_000.0


# ------------------------------------------------------------------ sağlayıcı
class FakeDefiProvider:
    """Ağsız sahte sağlayıcı — kurgulanmış DefiLlama metrikleri."""

    name = "fake"

    def __init__(self, metrics=None, yields=None):
        self._metrics = metrics
        self._yields = yields
        self.calls = 0

    def metrics(self, token, meta=None, category=""):
        self.calls += 1
        return self._metrics

    def yields(self, token):
        self.calls += 1
        return self._yields


def chain_metrics(tvl=53e9, c1=1.0, c7=4.0, fees=82.9e6, f1d=2.0):
    return {"matched": True, "kind": "chain", "name": "Ethereum",
            "category": "Chain", "tvl": tvl, "change_1d": c1,
            "change_7d": c7, "fees_24h": fees, "fees_change_1d": f1d,
            "slug": None, "protocol": None,
            "chain": {"name": "Ethereum", "tvl": tvl}}


def proto_metrics(tvl=1.66e9, c1=-0.5, c7=-3.0, fees=5.3e6, f1d=-2.5):
    return {"matched": True, "kind": "protocol", "name": "Uniswap",
            "category": "Dexes", "tvl": tvl, "change_1d": c1,
            "change_7d": c7, "fees_24h": fees, "fees_change_1d": f1d,
            "slug": "uniswap",
            "protocol": {"name": "Uniswap", "category": "Dexes",
                         "tvl": tvl, "slug": "uniswap"},
            "chain": None}


def yields_data(apy=3.2, pools=4, tvl=1.2e8):
    return {"matched": True, "apy": apy, "pools": pools, "tvl": tvl,
            "top": [{"project": "uniswap-v3", "chain": "Ethereum",
                     "apy": apy, "tvlUsd": tvl}]}


# ------------------------------------------------------------------ bileşenler
def test_component_weights_sum_to_one():
    assert sum(DefiLayer.COMPONENT_WEIGHTS.values()) == 1.0
    assert DefiLayer.COMPONENT_WEIGHTS["trend"] == 0.30


def test_trend_positive_change_beats_negative():
    up = score_trend(chain_metrics(c1=2.0, c7=9.0), "ETH", NOW)
    down = score_trend(chain_metrics(c1=-2.0, c7=-9.0), "ETH", NOW)
    assert up["source"] == down["source"] == "live"
    assert up["score"] > down["score"]
    assert up["score"] > 60 > down["score"]
    assert "7g" in up["summary"] and "%+" in up["summary"]


def test_trend_both_changes_missing_is_na_policy():
    res = score_trend(chain_metrics(c1=None, c7=None), "ETH", NOW)
    assert res["source"] == "na"
    assert res["score"] == 55.0


def test_trend_unmatched_is_mock_not_na():
    res = score_trend({"matched": False, "note": "yok"}, "ZZZ", NOW)
    assert res["source"] == "mock"
    res2 = score_trend(None, "ZZZ", NOW)
    assert res2["source"] == "mock"
    assert res2["score"] == res["score"], "mock deterministik olmalı"


def test_depth_log_scale_monotone():
    tiny = score_depth(chain_metrics(tvl=1e6), "X", NOW)
    mid = score_depth(chain_metrics(tvl=1e9), "X", NOW)
    big = score_depth(chain_metrics(tvl=1e11), "X", NOW)
    assert tiny["source"] == mid["source"] == "live"
    assert tiny["score"] < mid["score"] < big["score"]
    assert 15 <= tiny["score"] and mid["score"] <= 95


def test_depth_zero_or_missing_tvl_is_na():
    res = score_depth(chain_metrics(tvl=0), "X", NOW)
    assert res["source"] == "na" and res["score"] == 50.0
    res2 = score_depth(chain_metrics(tvl=None), "X", NOW)
    assert res2["source"] == "na"
    res3 = score_depth({"matched": False}, "X", NOW)
    assert res3["source"] == "mock"


def test_fees_log_scale_and_change_adjustment():
    small = score_fees(chain_metrics(fees=5e4), "X", NOW)
    large = score_fees(chain_metrics(fees=5e7), "X", NOW)
    assert small["source"] == large["source"] == "live"
    assert small["score"] < large["score"]
    # 1 günlük değişim ±6 puanı aşmamalı
    up = score_fees(chain_metrics(fees=5e6, f1d=100.0), "X", NOW)
    base = score_fees(chain_metrics(fees=5e6, f1d=0.0), "X", NOW)
    assert 0 < up["score"] - base["score"] <= 6.0


def test_fees_missing_is_na_zero_is_live_low():
    res = score_fees(chain_metrics(fees=None), "X", NOW)
    assert res["source"] == "na" and res["score"] == 50.0
    zero = score_fees(chain_metrics(fees=0), "X", NOW)
    assert zero["source"] == "live"
    assert zero["score"] <= 25, "gerçek sıfır ücret düşük skor almalı"


def test_yield_normal_beats_inflationary():
    normal = score_yield(yields_data(apy=3.5), "UNI", NOW)
    crazy = score_yield(yields_data(apy=120.0), "SCAM", NOW)
    assert normal["source"] == crazy["source"] == "live"
    assert normal["score"] > crazy["score"]
    assert "sürdürülemez" in crazy["summary"]
    # tepe 5% civarı, aşırı düşük APY de cezalı
    peak = score_yield(yields_data(apy=5.0), "UNI", NOW)
    zero = score_yield(yields_data(apy=0.0), "UNI", NOW)
    assert peak["score"] >= normal["score"] > zero["score"]


def test_yield_no_pools_is_na_source_is_gone_is_mock():
    res = score_yield({"matched": False, "apy": None, "pools": 0}, "MKR", NOW)
    assert res["source"] == "na" and res["score"] == 55.0
    res2 = score_yield(None, "MKR", NOW)
    assert res2["source"] == "mock"
    assert res2["score"] != res["score"] or res2["source"] != res["source"]


# ---------------------------------------------------------------------- katman
def test_layer_live_computes_all_components():
    layer = DefiLayer(FakeDefiProvider(metrics=chain_metrics(),
                                       yields=yields_data()))
    cfg = AppConfig(defi_source="live", price_source="auto")
    sc = layer.compute("ETHUSDT", None, cfg)
    assert sc.source == "live"
    comps = sc.details["components"]
    assert set(comps) == {"trend", "depth", "fees", "yield"}
    assert all(c["source"] == "live" for c in comps.values())
    assert sc.details["weights"] == DefiLayer.COMPONENT_WEIGHTS
    assert sc.details["metrics"]["route"] == "chain"
    # ağırlıklı toplam gerçekten ağırlıklarla hesaplanıyor
    manual = sum(DefiLayer.COMPONENT_WEIGHTS[k] * comps[k]["score"]
                 for k in comps)
    assert abs(sc.score - manual) < 0.2


def test_layer_na_and_mock_mix_keeps_policy_scores():
    # eşleşme yok → trend/depth/fees mock, havuz matched → apy live
    layer = DefiLayer(FakeDefiProvider(
        metrics={"matched": False, "note": "yok"},
        yields=yields_data(apy=2.5)))
    cfg = AppConfig(defi_source="live", price_source="auto")
    sc = layer.compute("ZZZUSDT", None, cfg)
    comps = sc.details["components"]
    assert comps["trend"]["source"] == "mock"
    assert comps["depth"]["source"] == "mock"
    assert comps["fees"]["source"] == "mock"
    assert comps["yield"]["source"] == "live"
    assert sc.source == "live", "canlı kaynak kullanıldıysa katman live"


def test_layer_offline_falls_back_to_deterministic_mock():
    layer = DefiLayer(None)
    cfg = AppConfig(defi_source="auto", price_source="binance")
    s1 = layer.compute("UNIUSDT", None, cfg)
    s2 = layer.compute("UNIUSDT", None, cfg)
    assert s1.source == "mock"
    assert s1.score == s2.score
    assert all(c["source"] == "mock"
               for c in s1.details["components"].values())


def test_mock_config_never_calls_provider():
    p = FakeDefiProvider(metrics=chain_metrics(), yields=yields_data())
    layer = DefiLayer(provider=p)
    cfg = AppConfig(defi_source="mock", price_source="binance")
    sc = layer.compute("ETHUSDT", None, cfg)
    assert p.calls == 0, "DEFI_SOURCE=mock iken sağlayıcı çağrılmamalı"
    assert sc.source == "mock"

    cfg_off = AppConfig(defi_source="off", price_source="binance")
    assert layer.compute("ETHUSDT", None, cfg_off).source == "mock"
    assert p.calls == 0


def test_auto_with_mock_prices_disables_provider():
    p = FakeDefiProvider(metrics=chain_metrics(), yields=yields_data())
    layer = DefiLayer(provider=p)
    cfg = AppConfig(defi_source="auto", price_source="mock")   # test modu
    sc = layer.compute("ETHUSDT", None, cfg)
    assert p.calls == 0, "PRICE_SOURCE=mock iken ağ isteği olmamalı"
    assert sc.source == "mock"


def test_build_defi_provider_switches():
    from paperbot.data.defi import DefiProvider as DP
    live_cfg = AppConfig(defi_source="auto", price_source="binance")
    mock_cfg = AppConfig(defi_source="mock", price_source="binance")
    off_cfg = AppConfig(defi_source="off", price_source="binance")
    offline_cfg = AppConfig(defi_source="auto", price_source="mock")
    assert isinstance(build_defi_provider(live_cfg, None), DP)
    assert build_defi_provider(mock_cfg, None) is None
    assert build_defi_provider(off_cfg, None) is None
    assert build_defi_provider(offline_cfg, None) is None


def test_registry_uses_defi_layer_when_provided():
    layer = DefiLayer(FakeDefiProvider(metrics=chain_metrics(),
                                       yields=yields_data()))
    reg = build_default_registry(defi_layer=layer)
    assert reg.get("defi") is layer
    reg2 = build_default_registry()
    assert isinstance(reg2.get("defi"), MockLayer)


# ------------------------------------------------------- sağlayıcı roatlama testleri
class RouteFetcher:
    """URL'ye göre farklı payload döndüren sahte fetcher."""

    def __init__(self, payload_by_rule):
        self.payload_by_rule = payload_by_rule   # [(matcher, payload)]
        self.urls = []

    def get_json(self, url, params=None, use_cache=True):
        self.urls.append((url, params))
        for matcher, payload in self.payload_by_rule:
            if matcher in url:
                return payload
        return None


def _provider(payloads):
    return DefiProvider(fetcher=RouteFetcher(payloads), min_interval=0.0)


def test_history_changes_strict_point_lookup():
    """Hedef günden YENİ nokta kullanılmaz; hedef öncesi yoksa None."""
    day = 86400
    base = 1_700_000_000
    hist = [{"date": base - 7 * day, "tvl": 100.0},
            {"date": base - 6 * day, "tvl": 104.0},
            {"date": base - 1 * day, "tvl": 115.0},
            {"date": base, "tvl": 120.0}]
    c1, c7 = history_changes(hist)
    assert c7 is not None
    assert abs(c7 - 20.0) < 1e-6                  # 7 gün öncesi 100 → 120 = +20%
    assert abs(c1 - (120.0 / 115.0 - 1) * 100) < 1e-6   # 1 gün öncesi 115

    # kısa seri: 7 gün öncesine ait nokta YOK → uydurma yok, None döner
    short = [{"date": base - 3 * day, "tvl": 100.0},
             {"date": base, "tvl": 110.0}]
    c1s, c7s = history_changes(short)
    assert c7s is None
    assert c1s is not None and abs(c1s - 10.0) < 1e-6   # 3 gün öncesi en yeni


def test_history_changes_short_series_returns_none():
    assert history_changes([{"date": 1, "tvl": 10}]) == (None, None)
    assert history_changes("bozuk") == (None, None)
    assert history_changes([{"date": 1, "tvl": None},
                            {"date": 2, "tvl": None}]) == (None, None)


def test_metrics_major_prefers_chain_route():
    p = _provider([
        (DEFI_CHAINS := "/v2/chains", [{"name": "Bitcoin", "tvl": 4.5e9,
                                        "tokenSymbol": "BTC",
                                        "gecko_id": "bitcoin"}]),
        ("/protocols", [{"name": "Wrapped BTC", "symbol": "WBTC",
                         "tvl": 1e9, "gecko_id": "", "slug": "wbtc"}]),
        ("historicalChainTvl/Bitcoin", [{"date": 1_700_000_000 - 7 * 86400,
                                         "tvl": 4.0e9},
                                        {"date": 1_700_000_000,
                                         "tvl": 4.5e9}]),
        # /overview/fees zincir filtresini yok sayar → Chain satırları indis
        ("overview/fees", {"protocols": [
            {"name": "Bitcoin", "category": "Chain",
             "total24h": 2_000_000.0, "change_1d": 5.0},
            {"name": "Ethereum", "category": "Chain",
             "total24h": 9_000_000.0, "change_1d": -1.0},
            {"name": "Uniswap", "category": "Dexes",
             "total24h": 5_000_000.0, "change_1d": 3.0}]}),
    ])
    m = p.metrics("BTC", {"coingecko_id": "bitcoin", "name": "Bitcoin"},
                  category="major")
    assert m and m["matched"] and m["kind"] == "chain"
    assert m["tvl"] == 4.5e9
    assert m["change_7d"] is not None and m["fees_24h"] == 2_000_000.0
    # zincir adı büyük/küçük harf duyarsız satırda bulunmalı (BSC/XRPL vb.)
    assert p._chain_fees("bsc") is None
    assert p._chain_fees("Bitcoin")["total24h"] == 2_000_000.0
    # indexte yalnızca Chain kategorisi (DEX satırı değil)
    assert p._chain_fees("uniswap") is None


def test_metrics_defi_token_prefers_protocol_route_with_fees():
    p = _provider([
        ("/v2/chains", [{"name": "Ethereum", "tvl": 5e10,
                         "tokenSymbol": "ETH", "gecko_id": "ethereum"}]),
        ("/protocols", [{"name": "Uniswap", "symbol": "UNI",
                         "category": "Dexes", "tvl": 1.66e9,
                         "change_1d": -0.5, "change_7d": -3.0,
                         "slug": "uniswap", "gecko_id": "uniswap"}]),
        ("summary/fees/uniswap", {"total24h": 5_300_000.0,
                                  "change_1d": -2.55}),
    ])
    m = p.metrics("UNI", {"coingecko_id": "uniswap", "name": "Uniswap"},
                  category="defi")
    assert m["kind"] == "protocol"
    assert m["slug"] == "uniswap"
    assert m["fees_24h"] == 5_300_000.0
    # zincir rotası çağrılmamalı (protokol tercih edildi)
    assert not any("historicalChainTvl" in u for u, _ in p.fetcher.urls)


def test_metrics_no_match_returns_matched_false_not_none():
    p = _provider([("/v2/chains", []), ("/protocols", [])])
    m = p.metrics("XRP", {"name": "XRP"}, category="major")
    assert m is not None and m["matched"] is False
    assert m["tvl"] is None and m["fees_24h"] is None


def test_metrics_source_down_returns_none():
    p = _provider([])                            # her URL → None
    assert p.metrics("BTC", None, "major") is None
    assert p.yields("UNI") is None


def test_yields_weighted_apys_and_filters():
    p = _provider([("pools", {"data": [
        {"symbol": "UNI", "apy": 2.0, "tvlUsd": 4e6},
        {"symbol": "UNI", "apy": 8.0, "tvlUsd": 1e6},
        {"symbol": "UNI", "apy": 50.0, "tvlUsd": 1e4},   # < 100K → gürültü
        {"symbol": "other", "apy": 99.0, "tvlUsd": 9e6},
    ]})])
    y = p.yields("UNI")
    assert y["matched"] and y["pools"] == 2
    # ağırlıklı: (2*4 + 8*1) / 5 = 3.2
    assert abs(y["apy"] - 3.2) < 1e-6
    assert y["top"][0]["apy"] == 2.0              # en büyük havuz önce


def test_yields_no_matching_symbol_is_matched_false():
    p = _provider([("pools", {"data": [
        {"symbol": "MKR-X", "apy": 3.0, "tvlUsd": 5e5}]})])
    y = p.yields("MKR")
    assert y["matched"] is False and y["apy"] is None


# ------------------------------------------------------------------- gerekçe
def test_rationale_contains_defi_evidence():
    layer = DefiLayer(FakeDefiProvider(metrics=proto_metrics(),
                                       yields=yields_data(apy=3.2)))
    cfg = AppConfig(defi_source="live", price_source="auto")
    defi_score = layer.compute("UNIUSDT", None, cfg)
    scores = {
        "technical": LayerScore("technical", 80, "live", {}),
        "onchain": LayerScore("onchain", 70, "mock", {}),
        "defi": defi_score,
        "risk": LayerScore("risk", 78, "live",
                           {"components": {
                               "exploit": {"summary": "saldırı yok",
                                           "source": "live"},
                               "contract": {"summary": "temiz",
                                            "source": "live"},
                               "audit": {"summary": "2 denetim",
                                         "source": "live"},
                               "maturity": {"summary": "4 yıl",
                                            "source": "live"}}}),
        "sentiment": LayerScore("sentiment", 60, "mock", {}),
        "macro": LayerScore("macro", 60, "mock", {}),
    }
    d = RuleBasedDecider(AppConfig()).decide("UNIUSDT", scores)
    r = d.rationale
    assert "DeFi kanıtı" in r
    assert "TVL trendi" in r
    assert "TVL derinliği" in r
    assert "Ücret geliri" in r
    assert "APY getirisi" in r
    assert "protokol eşleşmesi: Uniswap" in r


def test_rationale_marks_mock_defi_and_na_tag():
    layer = DefiLayer(None)                       # tam mock katman
    cfg = AppConfig(defi_source="auto", price_source="binance")
    defi_score = layer.compute("UNIUSDT", None, cfg)
    scores = {
        "technical": LayerScore("technical", 80, "live", {}),
        "onchain": LayerScore("onchain", 70, "live", {}),
        "defi": defi_score,
        "risk": LayerScore("risk", 78, "live", {"components": {}}),
        "sentiment": LayerScore("sentiment", 60, "mock", {}),
        "macro": LayerScore("macro", 60, "na", {}),
    }
    d = RuleBasedDecider(AppConfig()).decide("UNIUSDT", scores)
    assert "DeFi metrikleri katmanı MOCK veri" in d.rationale
    assert "[na]" in d.rationale, "na katmanı gerekçede etiketlenmeli"
    assert "[mock]" in d.rationale
