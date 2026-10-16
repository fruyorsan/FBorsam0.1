"""Faz 11 testleri: OpenCode LLM köprüsü (ücretsiz/sınırsız model entegrasyonu)."""
from __future__ import annotations

import json
from types import SimpleNamespace

import httpx

from paperbot.config import AppConfig, load_config
from paperbot.core import llm as llm_mod
from paperbot.core.decision import RuleBasedDecider
from paperbot.core.scoring import LayerScore


def _decision(cfg):
    scores = {
        "technical": LayerScore("technical", 80, "live", {}),
        "onchain": LayerScore("onchain", 70, "mock", {}),
        "defi": LayerScore("defi", 65, "live", {"components": {}}),
        "risk": LayerScore("risk", 78, "live", {"components": {}}),
        "sentiment": LayerScore("sentiment", 60, "live", {"components": {}}),
        "macro": LayerScore("macro", 55, "live", {"components": {}}),
    }
    return RuleBasedDecider(cfg).decide("UNIUSDT", scores)


def _cfg(**kw) -> AppConfig:
    base = dict(llm_bridge="opencode", llm_provider="google",
                llm_model="gemini-3.8-flash", llm_variant="high",
                opencode_cmd="C:/fake/npm/opencode.cmd")
    base.update(kw)
    return AppConfig(**base)


def test_bridge_success_appends_llm_rationale(monkeypatch, tmp_path):
    cli = tmp_path / "opencode.cmd"
    cli.write_text("@echo off\r\n", encoding="utf-8")
    seen = {}

    def fake_run(args, **kw):
        seen["args"] = args
        seen["kw"] = kw
        seen["body"] = json.loads(args[args.index("--data") + 1])
        return SimpleNamespace(returncode=0, stderr="", stdout=json.dumps(
            {"data": {"text": "Sanal testte olasılık dahilinde bir giriş "
                              "değerlendirilebilir (yatırım tavsiyesi değildir)."}}))

    monkeypatch.setattr(llm_mod.subprocess, "run", fake_run)
    cfg = _cfg(opencode_cmd=str(cli))
    out = RuleBasedDecider(cfg).refine_with_llm(_decision(cfg))

    assert out.details.get("llm") is True
    assert out.details.get("llm_source") == "opencode/google/gemini-3.8-flash"
    assert "[LLM yorumu]" in out.rationale
    assert "olasılık dahilinde" in out.rationale
    # model referansı ve Türkçe prompt doğru gidiyor
    assert seen["body"]["model"] == {"providerID": "google", "id": "gemini-3.8-flash",
                                     "variant": "high"}
    assert "UNIUSDT" in seen["body"]["prompt"]
    assert "Yatırım tavsiyesi verme" in seen["body"]["prompt"]
    # Windows quoting güvenliği: arguman listesi olarak çağrılmalı
    assert isinstance(seen["args"], list)
    assert seen["args"][1:4] == ["api", "post", "/api/experimental/generate"]
    assert seen["kw"].get("shell") is False
    assert seen["kw"].get("timeout") == cfg.llm_timeout


def test_bridge_cli_missing_keeps_template(monkeypatch):
    """opencode.cmd yoksa subprocess asla çağrılmaz, şablon korunur."""
    called = {"n": 0}

    def boom(*a, **k):
        called["n"] += 1
        raise AssertionError("CLI yokken subprocess çağrılmamalı")

    monkeypatch.setattr(llm_mod.subprocess, "run", boom)
    cfg = _cfg(opencode_cmd="C:/does/not/exist/opencode.cmd")
    d = _decision(cfg)
    before = d.rationale
    out = RuleBasedDecider(cfg).refine_with_llm(d)

    assert called["n"] == 0
    assert out.rationale == before
    assert "llm" not in out.details


def test_bridge_failure_falls_back_to_openai(monkeypatch):
    """Köprü düşerse zincir OpenAI'ye geçer (eski davranış korunur)."""
    monkeypatch.setattr(llm_mod.subprocess, "run",
                        lambda *a, **k: SimpleNamespace(returncode=1, stdout="",
                                                        stderr="HTTP 503"))

    def fake_post(url, headers=None, json=None, timeout=None):
        class _Resp:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"content": "OpenAI gerekçesi "
                                                             "(sanal test)."}}]}

        return _Resp()

    monkeypatch.setattr(httpx, "post", fake_post)
    cfg = _cfg(openai_api_key="sk-test", opencode_cmd="C:/does/not/exist/opencode.cmd")
    out = RuleBasedDecider(cfg).refine_with_llm(_decision(cfg))

    assert out.details.get("llm") is True
    assert out.details.get("llm_source") == "openai/gpt-4o-mini"
    assert "OpenAI gerekçesi" in out.rationale


def test_bridge_timeout_keeps_template(monkeypatch, tmp_path):
    """Gerçek CLI yolu var ama çağrısı zaman aşımına uğarsa şablon korunur."""
    cli = tmp_path / "opencode.cmd"
    cli.write_text("@echo off\r\n", encoding="utf-8")

    def timeout(*a, **k):
        raise llm_mod.subprocess.TimeoutExpired(cmd=str(cli), timeout=1)

    monkeypatch.setattr(llm_mod.subprocess, "run", timeout)
    cfg = _cfg(opencode_cmd=str(cli))
    d = _decision(cfg)
    before = d.rationale
    out = RuleBasedDecider(cfg).refine_with_llm(d)
    assert out.rationale == before
    assert "llm" not in out.details


def test_bridge_falls_back_to_next_model(monkeypatch, tmp_path):
    """Ana model 503 verirse zincir yedek modeli dener ve başarır."""
    cli = tmp_path / "opencode.cmd"
    cli.write_text("@echo off\r\n", encoding="utf-8")
    calls = []

    def fake_run(args, **kw):
        body = json.loads(args[args.index("--data") + 1])
        calls.append(body)
        if body["model"]["id"] == "gemini-3.8-flash":
            return SimpleNamespace(returncode=1, stdout="",
                                   stderr="HTTP 503 Service Unavailable")
        return SimpleNamespace(returncode=0, stderr="", stdout=json.dumps(
            {"data": {"text": "Yedek model gerekçesi (sanal test, "
                              "yatırım tavsiyesi değildir)."}}))

    monkeypatch.setattr(llm_mod.subprocess, "run", fake_run)
    cfg = _cfg(opencode_cmd=str(cli))
    out = RuleBasedDecider(cfg).refine_with_llm(_decision(cfg))

    assert out.details.get("llm") is True
    assert "Yedek model gerekçesi" in out.rationale
    ids = [c["model"]["id"] for c in calls]
    assert ids[0] == "gemini-3.8-flash"          # ana model önce denenir
    assert "variant" in calls[0]["model"]        # varyantla başlar
    assert ids[-1] == "space-bunny-free"         # yedek devreye girer
    assert "variant" not in calls[-1]["model"]   # yedek varyantsız denenir


def test_bridge_disabled_by_default_keeps_template():
    """Varsayılan config (LLM_BRIDGE yok) → şablon, eski testlerle uyumlu."""
    cfg = AppConfig()
    assert cfg.llm_bridge == ""
    d = _decision(cfg)
    before = d.rationale
    out = RuleBasedDecider(cfg).refine_with_llm(d)
    assert out.rationale == before
    assert "llm" not in out.details


def test_load_config_reads_bridge_env(monkeypatch):
    monkeypatch.setenv("LLM_BRIDGE", "opencode")
    monkeypatch.setenv("LLM_PROVIDER", "opencode")
    monkeypatch.setenv("LLM_MODEL", "space-bunny-free")
    monkeypatch.setenv("LLM_VARIANT", "minimal")
    cfg = load_config()
    assert cfg.llm_bridge == "opencode"
    assert cfg.llm_provider == "opencode"
    assert cfg.llm_model == "space-bunny-free"
    assert cfg.llm_variant == "minimal"
    assert cfg.llm_timeout > 0
