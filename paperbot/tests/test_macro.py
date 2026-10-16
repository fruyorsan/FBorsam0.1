"""Faz 6 testleri: Makro katmanı (4 bileşen, sağlayıcı, na/mock, gerekçe)."""
from __future__ import annotations

from paperbot.config import AppConfig
from paperbot.core.decision import RuleBasedDecider
from paperbot.core.macro import (
    MacroLayer, score_dominance, score_liquidity, score_market, score_usd,
)
from paperbot.core.scoring import LayerScore, MockLayer, build_default_registry
from paperbot.data.macro import MacroProvider, build_macro_provider

NOW = 1_700_000_000.0


# ------------------------------------------------------------------ sağlayıcı
class FakeMacroProvider:
    """Ağsız sahte sağlayıcı — kurgulanmış makro verisi."""

    name = "fake"

    def __init__(self, g=None, stable=None, usd=None):
        self._g = g
        self._stable = stable
        self._usd = usd
        self.calls = 0

    def global_data(self):
        self.calls += 1
        return self._g

    def stablecoins(self):
        self.calls += 1
        return self._stable

    def usd_trend(self):
        self.calls += 1
        return self._usd


def g_data(dom=58.25, mcap=2.9e12, c24=-0.89):
    return {"total_mcap": mcap, "mcap_change_24h": c24,
            "btc_dominance": dom}


def st_data(supply=210e9, c7=0.48, c30=6.06):
    return {"supply": supply, "change_7d": c7, "change_30d": c30}


def usd_data(c7=0.4, c30=2.6):
    return {"change_7d": c7, "change_30d": c30}


# ------------------------------------------------------------------ bileşenler
def test_component_weights_sum_to_one():
    w = MacroLayer.COMPONENT_WEIGHTS
    assert sum(w.values()) == 1.0
    assert w == {"liquidity": 0.40, "market": 0.25,
                 "dominance": 0.20, "usd": 0.15}


def test_liquidity_growth_beats_shrink():
    up = score_liquidity(st_data(c7=1.5, c30=4.0), "BTC", NOW)
    flat = score_liquidity(st_data(c7=0.0, c30=0.0), "BTC", NOW)
    down = score_liquidity(st_data(c7=-1.5, c30=-4.0), "BTC", NOW)
    assert all(c["source"] == "live" for c in (up, flat, down))
    assert up["score"] > flat["score"] > down["score"]
    assert flat["score"] == 50.0
    assert "Stablecoin arzı" in up["summary"] and "likidite giriyor" in up["summary"]
    assert "daralıyor" in down["summary"]
    # uç clamp: +50% 7g / +100% 30g → tavan 85
    extreme = score_liquidity(st_data(c7=50.0, c30=100.0), "BTC", NOW)
    assert extreme["score"] == 85.0
    shrink_ext = score_liquidity(st_data(c7=-50.0, c30=-100.0), "BTC", NOW)
    assert shrink_ext["score"] == 15.0


def test_liquidity_na_and_mock_policy():
    assert score_liquidity(None, "BTC", NOW)["source"] == "mock"
    na1 = score_liquidity({"supply": None}, "BTC", NOW)
    assert na1["source"] == "na" and na1["score"] == 50.0
    na2 = score_liquidity({"supply": 200e9, "change_7d": None,
                           "change_30d": None}, "BTC", NOW)
    assert na2["source"] == "na" and na2["score"] == 50.0
    # tek bileşen eksik diye na değil, kalan bileşenle live skor
    partial = score_liquidity(st_data(c7=None, c30=5.0), "BTC", NOW)
    assert partial["source"] == "live" and partial["score"] > 50.0


def test_market_direction_and_bounds():
    up = score_market(g_data(c24=4.0), "BTC", NOW)
    zero = score_market(g_data(c24=0.0), "BTC", NOW)
    down = score_market(g_data(c24=-4.0), "BTC", NOW)
    assert all(c["source"] == "live" for c in (up, zero, down))
    assert up["score"] > zero["score"] > down["score"]
    assert zero["score"] == 50.0
    assert "Toplam piyasa" in up["summary"] and "24s" in up["summary"]
    assert score_market(g_data(c24=99.0), "BTC", NOW)["score"] == 80.0
    assert score_market(g_data(c24=-99.0), "BTC", NOW)["score"] == 20.0
    assert score_market(None, "BTC", NOW)["source"] == "mock"
    na = score_market({"total_mcap": 2.9e12, "mcap_change_24h": None},
                      "BTC", NOW)
    assert na["source"] == "na" and na["score"] == 50.0


def test_dominance_non_monotone_regimes():
    healthy = score_dominance(g_data(dom=55.0), "BTC", NOW)
    alt_season = score_dominance(g_data(dom=35.0), "BTC", NOW)
    risk_off = score_dominance(g_data(dom=67.0), "BTC", NOW)
    btcd = score_dominance(g_data(dom=75.0), "BTC", NOW)
    assert all(c["source"] == "live"
               for c in (healthy, alt_season, risk_off, btcd))
    assert healthy["score"] > alt_season["score"], "aşırı alt-sezon cezalı"
    assert healthy["score"] > btcd["score"], "aşırı BTC kaçışı cezalı"
    assert healthy["data"]["regime"] == "sağlıklı rejim"
    assert alt_season["data"]["regime"] == "alt-sezon iyimserliği"
    assert risk_off["data"]["regime"] == "risk-off"
    assert btcd["data"]["regime"] == "BTC'ye kaçış"
    assert "dominans" in healthy["summary"]
    assert score_dominance(None, "BTC", NOW)["source"] == "mock"
    na = score_dominance({"btc_dominance": None}, "BTC", NOW)
    assert na["source"] == "na" and na["score"] == 55.0


def test_usd_strength_is_headwind():
    strong = score_usd(usd_data(c7=2.0, c30=3.0), "BTC", NOW)
    flat = score_usd(usd_data(c7=0.0, c30=0.0), "BTC", NOW)
    weak = score_usd(usd_data(c7=-2.0, c30=-3.0), "BTC", NOW)
    assert all(c["source"] == "live" for c in (strong, flat, weak))
    assert weak["score"] > flat["score"] > strong["score"]
    assert flat["score"] == 50.0
    assert "baskı" in strong["summary"], "USD güçlüyken baskı notu"
    assert "rüzgâr" in weak["summary"], "USD zayıfken rüzgâr notu"
    assert 25 <= strong["score"] <= 75
    assert score_usd(None, "BTC", NOW)["source"] == "mock"
    na = score_usd({"change_7d": None, "change_30d": None}, "BTC", NOW)
    assert na["source"] == "na" and na["score"] == 55.0


# ---------------------------------------------------------------------- katman
def test_layer_live_computes_all_components():
    layer = MacroLayer(FakeMacroProvider(g=g_data(), stable=st_data(),
                                         usd=usd_data()))
    cfg = AppConfig(macro_source="live", price_source="auto")
    sc = layer.compute("BTCUSDT", None, cfg)
    assert sc.source == "live"
    comps = sc.details["components"]
    assert set(comps) == {"liquidity", "market", "dominance", "usd"}
    assert all(c["source"] == "live" for c in comps.values())
    assert sc.details["weights"] == MacroLayer.COMPONENT_WEIGHTS
    assert sc.details["snapshot"]["btc_dominance"] == 58.25
    # ağırlıklı toplam gerçekten ağırlıklarla hesaplanıyor
    manual = sum(MacroLayer.COMPONENT_WEIGHTS[k] * comps[k]["score"]
                 for k in comps)
    assert abs(sc.score - manual) < 0.2


def test_layer_source_down_mix_live_and_mock():
    layer = MacroLayer(FakeMacroProvider(g=None, stable=st_data(), usd=None))
    cfg = AppConfig(macro_source="live", price_source="auto")
    sc = layer.compute("ETHUSDT", None, cfg)
    comps = sc.details["components"]
    assert comps["liquidity"]["source"] == "live"
    assert comps["market"]["source"] == "mock"
    assert comps["dominance"]["source"] == "mock"
    assert comps["usd"]["source"] == "mock"
    assert sc.source == "live", "canlı kaynak kullanıldıysa katman live"


def test_layer_offline_falls_back_to_deterministic_mock():
    layer = MacroLayer(None)
    cfg = AppConfig(macro_source="auto", price_source="binance")
    s1 = layer.compute("UNIUSDT", None, cfg)
    s2 = layer.compute("UNIUSDT", None, cfg)
    assert s1.source == "mock"
    assert s1.score == s2.score
    assert all(c["source"] == "mock"
               for c in s1.details["components"].values())


def test_mock_config_never_calls_provider():
    p = FakeMacroProvider(g=g_data(), stable=st_data(), usd=usd_data())
    layer = MacroLayer(provider=p)
    cfg = AppConfig(macro_source="mock", price_source="binance")
    sc = layer.compute("BTCUSDT", None, cfg)
    assert p.calls == 0, "MACRO_SOURCE=mock iken sağlayıcı çağrılmamalı"
    assert sc.source == "mock"
    assert layer.compute("BTCUSDT", None,
                         AppConfig(macro_source="off",
                                  price_source="binance")).source == "mock"
    assert p.calls == 0


def test_auto_with_mock_prices_disables_provider():
    p = FakeMacroProvider(g=g_data(), stable=st_data(), usd=usd_data())
    layer = MacroLayer(provider=p)
    cfg = AppConfig(macro_source="auto", price_source="mock")   # test modu
    sc = layer.compute("BTCUSDT", None, cfg)
    assert p.calls == 0, "PRICE_SOURCE=mock iken ağ isteği olmamalı"
    assert sc.source == "mock"


def test_build_macro_provider_switches():
    live_cfg = AppConfig(macro_source="auto", price_source="binance")
    mock_cfg = AppConfig(macro_source="mock", price_source="binance")
    off_cfg = AppConfig(macro_source="off", price_source="binance")
    offline_cfg = AppConfig(macro_source="auto", price_source="mock")
    assert isinstance(build_macro_provider(live_cfg, None), MacroProvider)
    assert build_macro_provider(mock_cfg, None) is None
    assert build_macro_provider(off_cfg, None) is None
    assert build_macro_provider(offline_cfg, None) is None


def test_registry_uses_macro_layer_when_provided():
    layer = MacroLayer(FakeMacroProvider(g=g_data()))
    reg = build_default_registry(macro_layer=layer)
    assert reg.get("macro") is layer
    reg2 = build_default_registry()
    assert isinstance(reg2.get("macro"), MockLayer)


# ------------------------------------------------------------------ sağlayıcı
class StubFetcher:
    def __init__(self, payloads=None):
        self.payloads = payloads or {}
        self.urls = []

    def get_json(self, url, params=None, use_cache=True, cache_key=None):
        self.urls.append((url, params))
        for key, payload in self.payloads.items():
            if key in url:
                return payload
        return None

    def get_text(self, url, params=None, use_cache=True, cache_key=None):
        return None


GLOBAL_PAYLOAD = {"data": {
    "total_market_cap": {"usd": 2.9e12},
    "market_cap_change_percentage_24h_usd": -0.89,
    "market_cap_percentage": {"btc": 58.25, "eth": 11.4},
}}
STABLE_PAYLOAD = {"peggedAssets": [
    {"name": "Tether", "circulating": {"peggedUSD": 150e9},
     "circulatingPrevWeek": {"peggedUSD": 148e9},
     "circulatingPrevMonth": {"peggedUSD": 140e9}},
    {"name": "USDC", "circulating": {"peggedUSD": 60e9},
     "circulatingPrevWeek": {"peggedUSD": 61e9},
     "circulatingPrevMonth": {"peggedUSD": 58e9}},
]}
USD_PAYLOAD = {"rates": {
    "2026-08-25": {"EUR": 0.850},
    "2026-09-01": {"EUR": 0.860},
    "2026-09-15": {"EUR": 0.870},
    "2026-09-22": {"EUR": 0.880},
    "2026-09-24": {"EUR": 0.888},
}}


def test_provider_parses_global_and_caches():
    sf = StubFetcher({"global": GLOBAL_PAYLOAD})
    p = MacroProvider(fetcher=sf, min_interval=0.0)
    g = p.global_data()
    assert g["total_mcap"] == 2.9e12
    assert g["btc_dominance"] == 58.25
    assert g["mcap_change_24h"] == -0.89
    p.global_data()                                # cache: istek artmaz
    assert len(sf.urls) == 1


def test_provider_sums_stablecoin_supply():
    sf = StubFetcher({"stablecoins": STABLE_PAYLOAD})
    p = MacroProvider(fetcher=sf, min_interval=0.0)
    s = p.stablecoins()
    assert s["supply"] == 210e9
    assert abs(s["change_7d"] - (210e9 / 209e9 - 1) * 100) < 1e-6
    assert abs(s["change_30d"] - (210e9 / 198e9 - 1) * 100) < 1e-6
    url, params = sf.urls[0]
    assert "stablecoins.llama.fi" in url
    assert params["includePrices"] == "true"


def test_provider_usd_trend_computes_changes():
    sf = StubFetcher({"frankfurter": USD_PAYLOAD})
    p = MacroProvider(fetcher=sf, min_interval=0.0)
    u = p.usd_trend()
    assert u["rate"] == 0.888
    # hedef gün: son tarih - 7g = 2026-09-17 → en yeni <= o gün: 09-15 (0.870)
    assert abs(u["change_7d"] - (0.888 / 0.870 - 1) * 100) < 1e-6
    # 30g hedef = 2026-08-25 → 0.850
    assert abs(u["change_30d"] - (0.888 / 0.850 - 1) * 100) < 1e-6
    url, params = sf.urls[0]
    assert "frankfurter.dev" in url and params["base"] == "USD"
    # kısa/bozuk seri → None (uydurma yok)
    sf2 = StubFetcher({"frankfurter": {"rates": {"2026-09-24": {"EUR": 0.88}}}})
    p2 = MacroProvider(fetcher=sf2, min_interval=0.0)
    assert p2.usd_trend() is None


def test_provider_failure_returns_none():
    sf = StubFetcher({})
    p = MacroProvider(fetcher=sf, min_interval=0.0)
    assert p.global_data() is None
    assert p.stablecoins() is None
    assert p.usd_trend() is None
    assert p.last_error != ""


# ------------------------------------------------------------------- gerekçe
def test_rationale_contains_macro_evidence():
    layer = MacroLayer(FakeMacroProvider(g=g_data(), stable=st_data(),
                                         usd=usd_data()))
    cfg = AppConfig(macro_source="live", price_source="auto")
    macro_score = layer.compute("UNIUSDT", None, cfg)
    scores = {
        "technical": LayerScore("technical", 80, "live", {}),
        "onchain": LayerScore("onchain", 70, "mock", {}),
        "defi": LayerScore("defi", 65, "live", {"components": {}}),
        "risk": LayerScore("risk", 78, "live", {"components": {}}),
        "sentiment": LayerScore("sentiment", 60, "live", {"components": {}}),
        "macro": macro_score,
    }
    d = RuleBasedDecider(AppConfig()).decide("UNIUSDT", scores)
    r = d.rationale
    assert "Makro kanıtı" in r
    assert "Likidite (stablecoin arzı)" in r
    assert "Piyasa momentumu" in r
    assert "BTC dominansı" in r
    assert "Dolar gücü" in r
    assert "sağlıklı rejim" in r


def test_rationale_marks_mock_macro():
    layer = MacroLayer(None)                      # tam mock katman
    cfg = AppConfig(macro_source="auto", price_source="binance")
    macro_score = layer.compute("UNIUSDT", None, cfg)
    scores = {
        "technical": LayerScore("technical", 80, "live", {}),
        "onchain": LayerScore("onchain", 70, "live", {}),
        "defi": LayerScore("defi", 65, "live", {"components": {}}),
        "risk": LayerScore("risk", 78, "live", {"components": {}}),
        "sentiment": LayerScore("sentiment", 60, "live", {"components": {}}),
        "macro": macro_score,
    }
    d = RuleBasedDecider(AppConfig()).decide("UNIUSDT", scores)
    assert "makro katmanı MOCK veri" in d.rationale
    assert "MACRO_SOURCE" in d.rationale
