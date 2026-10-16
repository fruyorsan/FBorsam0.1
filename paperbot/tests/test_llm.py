"""Faz 7 testleri: LLM gerekçe zenginleştirme (anahtarsız şablon + mock LLM)."""
from __future__ import annotations

import httpx

from paperbot.config import AppConfig
from paperbot.core.decision import RuleBasedDecider
from paperbot.core.scoring import LayerScore


def _decision(cfg=None):
    scores = {
        "technical": LayerScore("technical", 80, "live", {}),
        "onchain": LayerScore("onchain", 70, "mock", {}),
        "defi": LayerScore("defi", 65, "live", {"components": {}}),
        "risk": LayerScore("risk", 78, "live", {"components": {}}),
        "sentiment": LayerScore("sentiment", 60, "live", {"components": {}}),
        "macro": LayerScore("macro", 55, "live", {"components": {}}),
    }
    return RuleBasedDecider(cfg or AppConfig()).decide("UNIUSDT", scores)


def test_llm_disabled_without_key_keeps_template():
    d = _decision()                       # openai_api_key = ""
    before = d.rationale
    out = RuleBasedDecider(AppConfig()).refine_with_llm(d)
    assert out.rationale == before, "anahtarsız LLM gerekçeyi değiştirmemeli"
    assert "llm" not in out.details
    assert "[LLM yorumu]" not in out.rationale


def test_llm_refines_when_key_present(monkeypatch):
    seen = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        seen["url"] = url
        seen["auth"] = (headers or {}).get("Authorization")
        seen["prompt"] = (json or {}).get("messages", [{}])[0].get("content", "")
        seen["model"] = (json or {}).get("model")
        class _Resp:
            status_code = 200
            def json(self):
                return {"choices": [{"message": {
                    "content": "Sanal test sonucunda teknik ve makro puanları "
                               "olağan aralıkta; olasılık dahilinde bir giriş "
                               "değerlendirilebilir (yatırım tavsiyesi değildir)."}}]}
        return _Resp()

    monkeypatch.setattr(httpx, "post", fake_post)
    cfg = AppConfig(openai_api_key="sk-test-123")
    d = _decision(cfg)
    out = RuleBasedDecider(cfg).refine_with_llm(d)
    assert out.details.get("llm") is True
    assert "[LLM yorumu]" in out.rationale
    assert "olağan aralıkta" in out.rationale
    assert "UNIUSDT" in seen["prompt"], "prompt varlığı içermeli"
    assert "Yatırım tavsiyesi verme" in seen["prompt"]
    assert seen["auth"] == "Bearer sk-test-123"
    assert seen["model"] == cfg.openai_model
    assert "api.openai.com" in seen["url"]


def test_llm_failure_keeps_template_without_crash(monkeypatch):
    def boom(*a, **k):
        raise httpx.HTTPError("bağlantı hatası")
    monkeypatch.setattr(httpx, "post", boom)
    cfg = AppConfig(openai_api_key="sk-test-123")
    d = _decision(cfg)
    before = d.rationale
    out = RuleBasedDecider(cfg).refine_with_llm(d)   # asla raise etmemeli
    assert out.rationale == before, "LLM hatası şablonu bozmamalı"
    assert "llm" not in out.details


def test_llm_non_200_keeps_template(monkeypatch):
    class _Resp:
        status_code = 401
        def json(self):
            return {"error": {"message": "invalid api key"}}
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    cfg = AppConfig(openai_api_key="sk-yanlis")
    d = _decision(cfg)
    before = d.rationale
    out = RuleBasedDecider(cfg).refine_with_llm(d)
    assert out.rationale == before
    assert "llm" not in out.details
