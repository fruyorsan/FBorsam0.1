"""Faz 5 testleri: Duygu & haber katmanı (bileşenler, RSS, na/mock, gerekçe)."""
from __future__ import annotations

from paperbot.config import AppConfig
from paperbot.core.decision import RuleBasedDecider
from paperbot.core.scoring import LayerScore, MockLayer, build_default_registry
from paperbot.core.sentiment import (
    SentimentLayer, score_attention, score_fng, score_news,
)
from paperbot.data.sentiment import (
    SentimentProvider, build_sentiment_provider, parse_rss_titles,
)

NOW = 1_700_000_000.0


# ------------------------------------------------------------------ sağlayıcı
class FakeSentProvider:
    """Ağsız sahte sağlayıcı — kurgulanmış FNG/haber/trend verisi."""

    name = "fake"

    def __init__(self, fng=None, trending=None, news=None):
        self._fng = fng
        self._trending = trending
        self._news = news
        self.calls = 0
        self.queries = []

    def fng(self):
        self.calls += 1
        return self._fng

    def trending(self):
        self.calls += 1
        return self._trending

    def news(self, query):
        self.calls += 1
        self.queries.append(query)
        return self._news


def fng_data(value=71, avg=68.0, cls="Greed"):
    return {"value": value, "avg_7d": avg, "classification": cls, "days": 7}


# ------------------------------------------------------------------ bileşenler
def test_component_weights_sum_to_one():
    assert sum(SentimentLayer.COMPONENT_WEIGHTS.values()) == 1.0
    assert SentimentLayer.COMPONENT_WEIGHTS["fng"] == 0.40


def test_fng_non_monotone_extremes_penalized():
    calm = score_fng(fng_data(value=60, avg=60, cls="Neutral"), "BTC", NOW)
    fear = score_fng(fng_data(value=10, avg=15, cls="Extreme Fear"),
                     "BTC", NOW)
    eupho = score_fng(fng_data(value=95, avg=90, cls="Extreme Greed"),
                      "BTC", NOW)
    assert all(c["source"] == "live" for c in (calm, fear, eupho))
    assert fear["score"] < calm["score"], "aşırı korku cezalı"
    assert eupho["score"] < calm["score"], "aşırı açgözlülük (balon) cezalı"
    assert "korku" in fear["summary"] and "açgözlülük" in eupho["summary"]


def test_fng_momentum_adjustment_bounded():
    rising = score_fng(fng_data(value=70, avg=55), "BTC", NOW)
    flat = score_fng(fng_data(value=70, avg=70), "BTC", NOW)
    falling = score_fng(fng_data(value=70, avg=85), "BTC", NOW)
    assert rising["score"] > flat["score"] > falling["score"]
    assert rising["score"] - flat["score"] <= 6.0, "momentum ±6 puanı aşmamalı"
    assert "momentum" in rising["summary"]


def test_fng_none_is_mock_missing_value_is_na():
    res = score_fng(None, "BTC", NOW)
    assert res["source"] == "mock"
    res2 = score_fng({"value": None}, "BTC", NOW)
    assert res2["source"] == "na" and res2["score"] == 55.0


def test_news_none_is_mock_empty_is_live_calm():
    res = score_news(None, "BTC", NOW)
    assert res["source"] == "mock"
    calm = score_news([], "BTC", NOW)
    assert calm["source"] == "live" and calm["score"] == 45.0
    assert "sakin" in calm["summary"]


def test_news_positive_titles_beat_negative():
    pos = score_news(["Bitcoin rallies to record high as ETF inflows surge",
                      "Institutional adoption grows, price gains 10%",
                      "Layer-2 upgrade launches with burn mechanism"], "BTC", NOW)
    neg = score_news(["Bitcoin crash: exchange hacked, $100M stolen",
                      "SEC lawsuit delay sparks fear, liquidations pile up",
                      "Whale dump warning amid outage probe"], "BTC", NOW)
    mix = score_news(["Bitcoin price holds steady on Tuesday"], "BTC", NOW)
    assert pos["source"] == neg["source"] == mix["source"] == "live"
    assert pos["score"] > mix["score"] > neg["score"]
    assert pos["data"]["bull"] > 0 and neg["data"]["bear"] > 0
    assert "haber" in pos["summary"] and "net" in pos["summary"]
    # skor sınırları (clamp)
    assert 15 <= neg["score"] <= 85 and 15 <= pos["score"] <= 85


def test_attention_trending_rank_beats_not_trending():
    r1 = score_attention({"matched": True, "rank": 1, "symbol": "BTC"},
                         "BTC", NOW)
    r5 = score_attention({"matched": True, "rank": 5, "symbol": "BTC"},
                         "BTC", NOW)
    off = score_attention({"matched": False}, "BTC", NOW)
    none = score_attention(None, "BTC", NOW)
    assert r1["source"] == r5["source"] == off["source"] == "live"
    assert r1["score"] == 85.0 and r5["score"] == 75.0
    assert off["score"] == 45.0
    assert r1["score"] > r5["score"] > off["score"]
    assert none["source"] == "mock"
    assert "#5" in r5["summary"]


# ---------------------------------------------------------------------- katman
def test_layer_live_computes_all_components():
    layer = SentimentLayer(
        FakeSentProvider(
            fng=fng_data(),
            trending=[{"rank": 1, "symbol": "BTC", "name": "Bitcoin"}],
            news=["Bitcoin rallies on ETF inflows"]),
        asset_lookup=lambda: {"BTC": {"name": "Bitcoin",
                                      "coingecko_id": "bitcoin",
                                      "category": "major"}})
    cfg = AppConfig(sentiment_source="live", price_source="auto")
    sc = layer.compute("BTCUSDT", None, cfg)
    assert sc.source == "live"
    comps = sc.details["components"]
    assert set(comps) == {"fng", "news", "attention"}
    assert all(c["source"] == "live" for c in comps.values())
    assert sc.details["weights"] == SentimentLayer.COMPONENT_WEIGHTS
    # sorgu varlık ADI ile (sembol değil)
    assert layer.provider.queries == ["Bitcoin crypto when:1d"]
    # ağırlıklı toplam gerçekten ağırlıklarla hesaplanıyor
    manual = sum(SentimentLayer.COMPONENT_WEIGHTS[k] * comps[k]["score"]
                 for k in comps)
    assert abs(sc.score - manual) < 0.2


def test_layer_asset_lookup_names_query():
    layer = SentimentLayer(
        FakeSentProvider(fng=fng_data(), trending=[], news=[]),
        asset_lookup=lambda: {"UNI": {"name": "Uniswap",
                                      "coingecko_id": "uniswap",
                                      "category": "defi"}})
    cfg = AppConfig(sentiment_source="live", price_source="auto")
    layer.compute("UNIUSDT", None, cfg)
    assert layer.provider.queries == ["Uniswap crypto when:1d"]


def test_layer_source_down_mix_live_and_mock():
    layer = SentimentLayer(FakeSentProvider(
        fng=fng_data(), trending=None, news=None))
    cfg = AppConfig(sentiment_source="live", price_source="auto")
    sc = layer.compute("ETHUSDT", None, cfg)
    comps = sc.details["components"]
    assert comps["fng"]["source"] == "live"
    assert comps["news"]["source"] == "mock"
    assert comps["attention"]["source"] == "mock"
    assert sc.source == "live", "canlı kaynak kullanıldıysa katman live"


def test_layer_offline_falls_back_to_deterministic_mock():
    layer = SentimentLayer(None)
    cfg = AppConfig(sentiment_source="auto", price_source="binance")
    s1 = layer.compute("UNIUSDT", None, cfg)
    s2 = layer.compute("UNIUSDT", None, cfg)
    assert s1.source == "mock"
    assert s1.score == s2.score
    assert all(c["source"] == "mock"
               for c in s1.details["components"].values())


def test_mock_config_never_calls_provider():
    p = FakeSentProvider(fng=fng_data(), trending=[], news=[])
    layer = SentimentLayer(provider=p)
    cfg = AppConfig(sentiment_source="mock", price_source="binance")
    sc = layer.compute("BTCUSDT", None, cfg)
    assert p.calls == 0, "SENTIMENT_SOURCE=mock iken sağlayıcı çağrılmamalı"
    assert sc.source == "mock"
    assert layer.compute("BTCUSDT", None,
                         AppConfig(sentiment_source="off",
                                   price_source="binance")).source == "mock"
    assert p.calls == 0


def test_auto_with_mock_prices_disables_provider():
    p = FakeSentProvider(fng=fng_data(), trending=[], news=[])
    layer = SentimentLayer(provider=p)
    cfg = AppConfig(sentiment_source="auto", price_source="mock")   # test modu
    sc = layer.compute("BTCUSDT", None, cfg)
    assert p.calls == 0, "PRICE_SOURCE=mock iken ağ isteği olmamalı"
    assert sc.source == "mock"


def test_build_sentiment_provider_switches():
    live_cfg = AppConfig(sentiment_source="auto", price_source="binance")
    mock_cfg = AppConfig(sentiment_source="mock", price_source="binance")
    off_cfg = AppConfig(sentiment_source="off", price_source="binance")
    offline_cfg = AppConfig(sentiment_source="auto", price_source="mock")
    assert isinstance(build_sentiment_provider(live_cfg, None),
                      SentimentProvider)
    assert build_sentiment_provider(mock_cfg, None) is None
    assert build_sentiment_provider(off_cfg, None) is None
    assert build_sentiment_provider(offline_cfg, None) is None


def test_registry_uses_sentiment_layer_when_provided():
    layer = SentimentLayer(FakeSentProvider(fng=fng_data(),
                                            trending=[], news=[]))
    reg = build_default_registry(sentiment_layer=layer)
    assert reg.get("sentiment") is layer
    reg2 = build_default_registry()
    assert isinstance(reg2.get("sentiment"), MockLayer)


import email.utils
import time as _time

# ------------------------------------------------------------------ RSS/sağlayıcı
_now = _time.time()
_fresh1 = email.utils.formatdate(_now - 3600, usegmt=True)
_fresh2 = email.utils.formatdate(_now - 7200, usegmt=True)
_old = email.utils.formatdate(_now - 40 * 86400, usegmt=True)

RSS_FIXTURE = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Google News</title>
<item><title>Bitcoin rallies to record high as ETF inflows surge - Yahoo Finance</title>
<pubDate>{_fresh1}</pubDate></item>
<item><title>Exchange hacked in $50M theft, police probe - CoinDesk</title>
<pubDate>{_fresh2}</pubDate></item>
<item><title>Old news from last month - Reuters</title>
<pubDate>{_old}</pubDate></item>
</channel></rss>"""


def test_parse_rss_titles_filters_old_and_keeps_fresh():
    now_rss = _now
    titles = parse_rss_titles(RSS_FIXTURE, now_rss)
    assert titles is not None and len(titles) == 2, "eski başlık elenmeli"
    assert "rallies" in titles[0]
    assert parse_rss_titles("bozuk xml <<<", now_rss) is None
    assert parse_rss_titles(None, now_rss) is None
    assert parse_rss_titles("<rss><channel></channel></rss>", now_rss) == []


class StubFetcher:
    def __init__(self, json_payload=None, text_payload=None):
        self.json_payload = json_payload
        self.text_payload = text_payload
        self.json_urls = []
        self.text_urls = []

    def get_json(self, url, params=None, use_cache=True, cache_key=None):
        self.json_urls.append((url, params))
        return self.json_payload

    def get_text(self, url, params=None, use_cache=True, cache_key=None):
        self.text_urls.append((url, params))
        return self.text_payload


def test_provider_parses_fng_and_trending():
    sf = StubFetcher(json_payload={
        "data": [{"value": "71", "value_classification": "Greed"},
                 {"value": "65", "value_classification": "Greed"},
                 {"value": "60", "value_classification": "Neutral"}],
        "coins": [{"item": {"symbol": "LINK", "name": "Chainlink"}},
                  {"item": {"symbol": "BTC", "name": "Bitcoin"}}],
    })
    p = SentimentProvider(fetcher=sf, min_interval=0.0)
    f = p.fng()
    assert f["value"] == 71 and f["avg_7d"] == 65.3   # (71+65+60)/3
    t = p.trending()
    assert [x["symbol"] for x in t] == ["LINK", "BTC"]
    assert t[0]["rank"] == 1
    # tekrar çağrı cache'ten (ağ isteği artmaz)
    p.fng()
    assert len(sf.json_urls) == 2


def test_provider_news_builds_query_and_parses_rss():
    sf = StubFetcher(text_payload=RSS_FIXTURE)
    p = SentimentProvider(fetcher=sf, min_interval=0.0)
    titles = p.news("Uniswap crypto when:1d")
    assert titles and len(titles) == 2
    url, params = sf.text_urls[0]
    assert "news.google.com" in url
    assert params["q"] == "Uniswap crypto when:1d"
    assert p.news("") is None, "boş sorgu ağ isteği üretmemeli"
    assert len(sf.text_urls) == 1


def test_provider_failure_returns_none():
    sf = StubFetcher(json_payload=None, text_payload=None)
    p = SentimentProvider(fetcher=sf, min_interval=0.0)
    assert p.fng() is None
    assert p.trending() is None
    assert p.news("Bitcoin crypto when:1d") is None
    assert p.last_error != ""


# ------------------------------------------------------------------- gerekçe
def test_rationale_contains_sentiment_evidence():
    layer = SentimentLayer(FakeSentProvider(
        fng=fng_data(value=62, avg=55),
        trending=[{"rank": 2, "symbol": "UNI", "name": "Uniswap"}],
        news=["Uniswap governance approves upgrade as TVL inflows surge"]))
    cfg = AppConfig(sentiment_source="live", price_source="auto")
    sent_score = layer.compute("UNIUSDT", None, cfg)
    scores = {
        "technical": LayerScore("technical", 80, "live", {}),
        "onchain": LayerScore("onchain", 70, "mock", {}),
        "defi": LayerScore("defi", 65, "live", {"components": {}}),
        "risk": LayerScore("risk", 78, "live", {"components": {}}),
        "sentiment": sent_score,
        "macro": LayerScore("macro", 60, "mock", {}),
    }
    d = RuleBasedDecider(AppConfig()).decide("UNIUSDT", scores)
    r = d.rationale
    assert "Duygu kanıtı" in r
    assert "Korku&Açgözlülük" in r
    assert "Haber akışı" in r
    assert "Dikkat (trend)" in r
    assert "trend listesinde #2" in r


def test_rationale_marks_mock_sentiment():
    layer = SentimentLayer(None)                    # tam mock katman
    cfg = AppConfig(sentiment_source="auto", price_source="binance")
    sent_score = layer.compute("UNIUSDT", None, cfg)
    scores = {
        "technical": LayerScore("technical", 80, "live", {}),
        "onchain": LayerScore("onchain", 70, "live", {}),
        "defi": LayerScore("defi", 65, "live", {"components": {}}),
        "risk": LayerScore("risk", 78, "live", {"components": {}}),
        "sentiment": sent_score,
        "macro": LayerScore("macro", 60, "mock", {}),
    }
    d = RuleBasedDecider(AppConfig()).decide("UNIUSDT", scores)
    assert "duygu/haber katmanı MOCK veri" in d.rationale
    assert "SENTIMENT_SOURCE" in d.rationale
