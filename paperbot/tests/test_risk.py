"""Faz 4 testleri: Risk & Güvenlik katmanı (bileşenler, tavanlar, veto)."""
from __future__ import annotations

from paperbot.config import AppConfig
from paperbot.core.decision import RuleBasedDecider
from paperbot.core.risk import (
    CAP_HONEYPOT, CAP_RECENT_BIG_HACK, RiskLayer,
    score_audit, score_contract, score_exploit, score_maturity,
)
from paperbot.core.scoring import LayerScore
from paperbot.data.security import SecurityProvider, build_security_provider, _first_word

NOW = 1_700_000_000.0
YEAR = 31_557_600


class FakeProvider:
    """Ağsız sahte sağlayıcı — kurgulanmış DefiLlama/GoPlus verisi."""

    name = "fake"

    def __init__(self, proto=None, hacks=None, contract=None):
        self._proto = proto
        self._hacks = hacks
        self._contract = contract
        self.calls = 0

    def protocol(self, token, meta=None):
        self.calls += 1
        return self._proto

    def hacks(self, token, proto=None, meta=None):
        self.calls += 1
        return self._hacks

    def contract(self, token, proto=None):
        self.calls += 1
        return self._contract


def defi_proto(audits=2, listed=NOW - 4 * YEAR, address="0xabc"):
    return {"id": "1", "name": "Test Protocol", "symbol": "TST",
            "category": "Dexs", "audits": audits,
            "audit_links": ["https://x/openzeppelin-report.pdf"],
            "listed_at": listed, "address": address, "chains": ["Ethereum"],
            "tvl": 1e9, "gecko_id": "", "source": "defillama"}


def native_proto(name="Bitcoin", token="BTC"):
    return {"id": "9", "name": name, "symbol": token.upper(),
            "category": "Chain", "audits": 0, "audit_links": [],
            "listed_at": None, "address": "", "chains": [], "tvl": 0.0,
            "gecko_id": "", "source": "defillama"}


def clean_flags():
    return {"is_honeypot": "0", "is_open_source": "1", "is_mintable": "0",
            "can_take_back_ownership": "0", "is_blacklisted": "0",
            "sell_tax": "0", "buy_tax": "0", "owner_percent": "0.01",
            "holders": [{"percent": "0.05"}, {"percent": "0.04"}],
            "trust_list": "1"}


# ------------------------------------------------------------------ bileşenler
def test_component_weights_sum_to_one():
    assert sum(RiskLayer.COMPONENT_WEIGHTS.values()) == 1.0


def test_no_hacks_and_clean_contract_scores_high():
    layer = RiskLayer(FakeProvider(proto=defi_proto(), hacks=[],
                                   contract={"address": "0xabc",
                                             "chain": "ethereum",
                                             "flags": clean_flags()}))
    cfg = AppConfig(risk_source="live", price_source="auto")
    sc = layer.compute("TSTUSDT", None, cfg)
    assert sc.source == "live"
    assert sc.score >= 65, f"temiz protokol yüksek skor almalı: {sc.score}"
    assert sc.details["components"]["exploit"]["summary"].find("saldırı yok") >= 0
    assert sc.details["critical_cap"] is None


def test_honeypot_forces_critical_cap_and_veto():
    flags = clean_flags() | {"is_honeypot": "1"}
    layer = RiskLayer(FakeProvider(proto=defi_proto(), hacks=[],
                                   contract={"address": "0xabc",
                                             "chain": "ethereum",
                                             "flags": flags}))
    cfg = AppConfig(risk_source="live", price_source="auto")
    sc = layer.compute("SCAMUSDT", None, cfg)
    assert sc.details["critical_cap"] == CAP_HONEYPOT
    assert sc.score <= CAP_HONEYPOT, "honeypot skoru tavana vurmalı"

    # veto: diğer tüm katmanlar güçlü olsa bile giriş YOK
    decider = RuleBasedDecider(AppConfig())
    scores = {
        "technical": LayerScore("technical", 85, "live", {}),
        "onchain": LayerScore("onchain", 80, "mock", {}),
        "defi": LayerScore("defi", 75, "mock", {}),
        "risk": sc,
        "sentiment": LayerScore("sentiment", 70, "mock", {}),
        "macro": LayerScore("macro", 65, "mock", {}),
    }
    d = decider.decide("SCAMUSDT", scores)
    assert d.action == "risk_block"
    assert "Güvenlik kanıtı" in d.rationale
    assert "HONEYPOT" in d.rationale
    assert "RİSK FİLTRESİ" in d.rationale


def test_recent_big_hack_caps_below_threshold():
    import time as _t
    hacks = [{"name": "Test Protocol", "date": int(_t.time() - 120 * 86400),
              "amount": 80_000_000.0, "technique": "exploit",
              "bridge_hack": False, "returned_funds": None, "chain": ["Ethereum"]}]
    layer = RiskLayer(FakeProvider(proto=defi_proto(), hacks=hacks,
                                   contract={"address": "0xabc",
                                             "chain": "ethereum",
                                             "flags": clean_flags()}))
    cfg = AppConfig(risk_source="live", price_source="auto")
    sk = layer.compute("TSTUSDT", None, cfg)
    assert sk.details["critical_cap"] == CAP_RECENT_BIG_HACK
    assert sk.score <= CAP_RECENT_BIG_HACK
    assert "80.0M" in sk.details["components"]["exploit"]["summary"]


def test_old_small_hack_gentler_than_recent_big_one():
    recent = [{"name": "P", "date": int(NOW - 90 * 86400), "amount": 5_000_000.0,
               "technique": "x", "bridge_hack": False, "returned_funds": None,
               "chain": []}]
    old = [{"name": "P", "date": int(NOW - 5 * YEAR), "amount": 5_000_000.0,
            "technique": "x", "bridge_hack": False, "returned_funds": None,
            "chain": []}]
    s_new = score_exploit(recent, "P", NOW)["score"]
    s_old = score_exploit(old, "P", NOW)["score"]
    assert s_old > s_new, "eski hack daha affedici olmalı"
    # fonlar iade edildiyse hafifletme
    ret = [dict(old[0], returned_funds=5_000_000.0)]
    assert score_exploit(ret, "P", NOW)["score"] > s_old


def test_audit_counts_rank():
    zero = score_audit(defi_proto(audits=0), "TST", NOW, True)
    two = score_audit(defi_proto(audits=2), "TST", NOW, True)
    three = score_audit(defi_proto(audits=3), "TST", NOW, True)
    assert zero["score"] < two["score"] < three["score"]
    assert zero["source"] == two["source"] == "live"
    assert "YOK" in zero["summary"]
    assert "openzeppelin" in two["summary"], "bilinen denetçi adı görünmeli"


def test_native_l1_is_policy_not_penalized():
    """Ana ağ (kontrat yok): denetim 'na', hack araması canlı, yaş genesis'ten."""
    layer = RiskLayer(FakeProvider(proto=native_proto(), hacks=[],
                                   contract={"na": "yerel/ana-ğ tokeni — "
                                                    "kontrat adresi yok"}))
    cfg = AppConfig(risk_source="live", price_source="auto")
    sc = layer.compute("BTCUSDT", None, cfg)
    comps = sc.details["components"]
    assert comps["contract"]["source"] == "na"
    assert comps["audit"]["source"] == "na"
    assert comps["exploit"]["source"] == "live"
    assert comps["maturity"]["source"] == "live"      # 2009 genesis
    assert 70 <= sc.score <= 90, f"L1 makul yüksek skorda kalmalı: {sc.score}"
    assert sc.source == "live"


def test_contract_flags_penalized():
    flags = clean_flags() | {"sell_tax": "0.25", "owner_percent": "0.50",
                             "is_mintable": "1"}
    flags["holders"] = [{"percent": "0.30"}, {"percent": "0.25"}]
    res = score_contract({"address": "0x1", "chain": "ethereum", "flags": flags},
                         "TST", NOW)
    assert res["source"] == "live"
    assert res["score"] < 60
    assert "işlem vergisi" in res["summary"]
    assert "sahip yoğunluğu" in res["summary"]
    assert "mint" in res["summary"]


def test_maturity_prefers_listed_then_genesis():
    listed = score_maturity(defi_proto(listed=NOW - 2 * YEAR), "TST", NOW)
    genesis = score_maturity(None, "BTC", NOW)
    no_data = score_maturity(None, "ZZZ", NOW)
    assert listed["source"] == "live" and genesis["source"] == "live"
    assert no_data["source"] == "mock"
    assert listed["score"] < 95
    assert genesis["score"] > listed["score"], "2009 BTC > 2 yıllık protokol"


def test_maturity_hallmarks_fallback_and_na():
    """listedAt yok → hallmark (alt sınır) live; o da yoksa 'na' nötr."""
    hall = dict(defi_proto(listed=None), hallmarks_at=NOW - 3 * YEAR)
    assert hall.pop("listed_at") is None
    res = score_maturity(hall, "TST", NOW)
    assert res["source"] == "live"
    assert "alt sınır" in res["summary"]
    assert 70 <= res["score"] <= 80          # 40 + 3*12 = 76

    ageless = dict(defi_proto(listed=None))
    res2 = score_maturity(ageless, "TST", NOW)
    assert res2["source"] == "na"
    assert res2["score"] == 55.0, "yaş yoksa uydurma değil muhafazakâr nötr"


def test_hack_name_match_rules():
    from paperbot.data.security import hack_name_match
    # sıkı kural (protokol id'si var): farklı projeler sızmasın
    assert not hack_name_match("Bitcoin Gold", "bitcoin", loose=False)
    assert not hack_name_match("Bitcoinica", "bitcoin", loose=False)
    assert not hack_name_match("Compounder Finance", "compound", loose=False)
    # sıkı: tek kelime veya sürüm etiketi olan gerçek eşleşmeler
    assert hack_name_match("AAVE", "aave", loose=False)
    assert hack_name_match("Compound V2", "compound", loose=False)
    assert hack_name_match("Synthetix v1+v2", "synthetix", loose=False)
    assert hack_name_match("Uniswap V1", "uniswap", loose=False)
    assert not hack_name_match("Uniswap (Phishing Attack)", "uniswap", loose=False)
    # loose (protokol kaydı yok): kelime-eki genişlemesi
    assert hack_name_match("MakerDAO", "maker", loose=True)
    assert not hack_name_match("Starmaker", "maker", loose=True)
    assert not hack_name_match("DAO Maker Vesting", "maker", loose=True)


def test_proto_match_rejects_prefix_false_positive():
    """'XRP' → 'XRPL DEX' gibi kelime-sınırlığı olmayan uzantılar eşleşmez."""
    assert SecurityProvider._proto_match(
        {"gecko_id": "", "symbol": "-", "name": "XRPL DEX"},
        "XRP", {"name": "XRP"}) == 0
    assert SecurityProvider._proto_match(
        {"gecko_id": "", "symbol": "-", "name": "Aave V3"},
        "AAVE", {"name": "Aave"}) == 1


# ---------------------------------------------------------------------- mock
def test_offline_falls_back_to_deterministic_mock():
    layer = RiskLayer(None)                      # sağlayıcı yok
    cfg = AppConfig(risk_source="auto", price_source="binance")
    s1 = layer.compute("UNIUSDT", None, cfg)
    s2 = layer.compute("UNIUSDT", None, cfg)
    assert s1.source == "mock"
    assert s1.score == s2.score, "mock deterministik olmalı"
    assert s1.details["components"]["exploit"]["source"] == "mock"


def test_mock_config_never_calls_provider():
    p = FakeProvider(proto=defi_proto(), hacks=[], contract=None)
    layer = RiskLayer(provider=p)
    cfg = AppConfig(risk_source="mock", price_source="binance")
    sc = layer.compute("TSTUSDT", None, cfg)
    assert p.calls == 0, "RISK_SOURCE=mock iken sağlayıcı çağrılmamalı"
    assert sc.source == "mock"


def test_build_security_provider_switches():
    live_cfg = AppConfig(risk_source="auto", price_source="binance")
    mock_cfg = AppConfig(risk_source="mock", price_source="binance")
    offline_cfg = AppConfig(risk_source="auto", price_source="mock")
    assert isinstance(build_security_provider(live_cfg, None), SecurityProvider)
    assert build_security_provider(mock_cfg, None) is None
    assert build_security_provider(offline_cfg, None) is None


# ------------------------------------------------- GoPlus limit/düzgün adres
class StubFetcher:
    def __init__(self, payload):
        self.payload = payload
        self.calls = 0

    def get_json(self, url, params=None, use_cache=True):
        self.calls += 1
        return self.payload


def test_goplus_rate_limit_cooldown_skips_further_requests():
    import time as _t
    sf = StubFetcher({"code": 4029, "message": "too many requests"})
    p = SecurityProvider(fetcher=sf, min_interval=0.0, max_per_minute=8)
    assert p.contract("AAA", {"address": "0x" + "ab" * 20}) is None
    assert p._cooldown_until > _t.time(), "4029 soğuması kurulmalı"
    assert sf.calls == 1
    # soğuma sırasında farklı token → istek ATLANIR (fetch bile çağrılmaz)
    assert p.contract("BBB", {"address": "0x" + "cd" * 20}) is None
    assert sf.calls == 1, "soğumada ağ isteği yapılmamalı"


def test_goplus_minute_budget_defers_to_next_cycle():
    import time as _t
    sf = StubFetcher({"code": 1, "message": "OK", "result": {}})
    p = SecurityProvider(fetcher=sf, min_interval=0.0, max_per_minute=8)
    p._req_times = [_t.time()] * 8                 # dakika bütçesi dolu
    assert p.contract("CCC", {"address": "0x" + "ef" * 20}) is None
    assert sf.calls == 0, "bütçe doluyken istek atlanmalı"


def test_non_evm_address_is_na_without_request():
    sf = StubFetcher({"code": 1, "message": "OK", "result": {}})
    p = SecurityProvider(fetcher=sf, min_interval=0.0)
    # DefiLlama'ın AVAX için verdiği X-chain (base58) adresi
    res = p.contract("AVAX", {"address":
                              "FvwEAhmxKfeiG8SnEvq42hc6whRyY3EFYAvebMqDNDGCgxN5Z"})
    assert res is not None and "na" in res
    assert "EVM" in res["na"]
    assert sf.calls == 0, "EVM olmayan adres GoPlus'a sorulmamalı"


def test_cached_result_served_during_cooldown():
    import time as _t
    addr = "0x" + "11" * 20
    sf = StubFetcher({"code": 1, "message": "OK",
                      "result": {addr: {"is_honeypot": "0"}}})
    p = SecurityProvider(fetcher=sf, min_interval=0.0)
    r1 = p.contract("X", {"address": addr})
    assert r1 and "flags" in r1 and sf.calls == 1
    p._cooldown_until = _t.time() + 60             # 4029 soğuması aktifken
    r2 = p.contract("X", {"address": addr})
    assert r2 and "flags" in r2, "cache'li sonuç soğumada da dönmeli"
    assert sf.calls == 1


def test_protocol_name_matching_helpers():
    assert _first_word("Aave V3") == "aave"
    assert _first_word("PancakeSwap / Cream") == "pancakeswap"
    assert SecurityProvider._proto_match(
        {"gecko_id": "uniswap", "symbol": "UNI", "name": "Uniswap V3"},
        "UNI", {"coingecko_id": "uniswap"}) == 3
    assert SecurityProvider._proto_match(
        {"gecko_id": "", "symbol": "UNI", "name": "Uniswap V3"}, "UNI", None) == 2
    assert SecurityProvider._proto_match(
        {"gecko_id": "", "symbol": "x", "name": "Maker"},
        "MKR", {"name": "Maker"}) == 1


# ------------------------------------------------------------------- gerekçe
def test_rationale_contains_security_evidence():
    layer = RiskLayer(FakeProvider(proto=defi_proto(audits=3), hacks=[],
                                   contract={"address": "0xabc",
                                             "chain": "ethereum",
                                             "flags": clean_flags()}))
    cfg = AppConfig(risk_source="live", price_source="auto")
    risk_score = layer.compute("TSTUSDT", None, cfg)
    scores = {
        "technical": LayerScore("technical", 80, "live", {}),
        "onchain": LayerScore("onchain", 70, "mock", {}),
        "defi": LayerScore("defi", 65, "mock", {}),
        "risk": risk_score,
        "sentiment": LayerScore("sentiment", 60, "mock", {}),
        "macro": LayerScore("macro", 60, "mock", {}),
    }
    d = RuleBasedDecider(AppConfig()).decide("TSTUSDT", scores)
    r = d.rationale
    assert "Güvenlik kanıtı" in r
    assert "Saldırı geçmişi" in r
    assert "Denetim" in r
    assert "3 denetim" in r
    assert "Kontrat" in r
