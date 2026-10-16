"""REST API entegrasyon testleri (TestClient, SQLite, ağ yok)."""
from __future__ import annotations

import os
import pytest

os.environ["DATABASE_URL"] = "sqlite:///./data/test_paperbot.db"
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["PRICE_SOURCE"] = "mock"

from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="module")
def client():
    db = "./data/test_paperbot.db"
    if os.path.exists(db):
        os.remove(db)
    from paperbot.main import create_app
    app = create_app()
    with TestClient(app) as c:
        yield c
    for suffix in ("", "-journal"):
        p = db + suffix
        if os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass


def test_status(client):
    r = client.get("/api/status")
    assert r.status_code == 200
    d = r.json()
    assert d["mode"] == "paper"
    assert d["live_trading_enabled"] is False
    assert d["paper_only"] is True
    assert "equity" in d and "kill_switch" in d


def test_assets_seeded(client):
    d = client.get("/api/assets").json()
    syms = [a["symbol"] for a in d["assets"]]
    assert "BTCUSDT" in syms and "ETHUSDT" in syms
    assert len(syms) >= 20


def test_manual_cycle_produces_decisions(client):
    r = client.post("/api/system/cycle")
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] and d["decisions"] > 0
    sig = client.get("/api/signals?limit=50").json()["signals"]
    assert len(sig) > 0
    assert all(s["rationale"] for s in sig), "her kararda gerekçe olmalı"
    assert any(s["layer_scores"] for s in sig)


def test_positions_and_equity_endpoints(client):
    assert client.get("/api/positions?status=open").status_code == 200
    assert client.get("/api/positions?status=closed").status_code == 200
    eq = client.get("/api/equity").json()
    assert eq["total"] >= 1, "equity snapshot üretilmeli"


def test_metrics_endpoint(client):
    m = client.get("/api/metrics").json()
    for key in ("overall", "by_strategy", "by_layer", "by_exit_reason"):
        assert key in m
    assert "with_signal" in m["by_layer"]["onchain"]


def test_settings_roundtrip(client):
    before = client.get("/api/settings").json()["settings"]
    assert before["start_balance"]["protected"] is False
    assert before["live_trading_enabled"]["protected"] is True

    r = client.put("/api/settings", json={"values": {"fee_rate": 0.002}})
    assert r.status_code == 200
    assert r.json()["saved"] == {"fee_rate": 0.002}

    after = client.get("/api/settings").json()["settings"]
    assert after["fee_rate"]["value"] == pytest.approx(0.002)

    # korumalı alan reddedilir
    r2 = client.put("/api/settings", json={"values": {"live_trading_enabled": True,
                                                      "fee_rate": 99}})
    errs = r2.json()["errors"]
    assert any("korumalı" in e for e in errs)
    assert any("fee_rate" in e for e in errs)


def test_kill_switch_and_resume(client):
    client.post("/api/system/cycle")
    r = client.post("/api/system/kill-switch", json={"enable": True})
    assert r.status_code == 200 and r.json()["kill_switch"] is True
    assert client.get("/api/status").json()["kill_switch"] is True
    # açık pozisyon kalmamalı
    assert client.get("/api/positions?status=open").json()["positions"] == []

    r2 = client.post("/api/system/resume")
    assert r2.status_code == 200
    assert client.get("/api/status").json()["kill_switch"] is False


def test_export_csv(client):
    r = client.get("/api/export/trades.csv?format=csv")
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]


def test_notifications_recorded(client):
    client.post("/api/system/kill-switch", json={"enable": True})
    client.post("/api/system/resume")
    d = client.get("/api/notifications").json()["notifications"]
    assert len(d) >= 1
    assert any(n["kind"] == "kill_switch" for n in d)


def test_wallet_crud(client):
    r = client.post("/api/wallets", json={"address": "0xabc123",
                                          "label": "Test Whale",
                                          "wallet_type": "smart_money"})
    assert r.status_code == 200
    wid = r.json()["id"]
    lst = client.get("/api/wallets").json()["wallets"]
    assert any(w["id"] == wid for w in lst)
    assert client.delete(f"/api/wallets/{wid}").json()["ok"] is True


def test_wallets_enriched_fields(client):
    """Faz 2: cüzdan listesi isabet/portföy/kaynak alanlarıyla zengin gelir."""
    lst = client.get("/api/wallets").json()["wallets"]
    assert lst, "örnek cüzdanlar tohumlanmış olmalı"
    w = lst[0]
    for key in ("wallet_type", "hit_rate", "signals_total", "signals_hit",
                "portfolio_usd", "data_source", "qualifying"):
        assert key in w, f"eksik alan: {key}"
    assert any(w2["qualifying"] for w2 in lst), \
        "smart_money/whale/fund cüzdanları qualifying görünmeli"


def test_wallet_refresh_and_portfolio(client):
    """Faz 2: manuel tazeleme → mock portföy snapshot'ları oluşur."""
    lst = client.get("/api/wallets").json()["wallets"]
    wid = next(w["id"] for w in lst if w["qualifying"])
    r = client.post("/api/wallets/refresh?evaluate_hits=true")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["wallets"] >= 1

    pf = client.get(f"/api/wallets/{wid}/portfolio").json()
    assert pf["holdings"], "mock portföy snapshot'ı oluşmalı"
    assert pf["total_usd"] > 0
    assert pf["snapshot_at"]

    w2 = next(w for w in client.get("/api/wallets").json()["wallets"]
              if w["id"] == wid)
    assert w2["portfolio_usd"] > 0, "liste portföy toplamı güncellenmeli"


def test_smart_money_endpoint(client):
    """Faz 2: /api/smart-money token bazlı sinyaller döner."""
    client.post("/api/system/cycle")
    r = client.get("/api/smart-money")
    assert r.status_code == 200
    body = r.json()
    assert "signals" in body and "window_days" in body
    assert body["window_days"] == 7
    # sinyal varsa kanıt alanları zorunlu
    for sig in body["signals"][:5]:
        for key in ("token", "score", "strong", "distinct_accumulators", "evidence"):
            assert key in sig, f"eksik alan: {key}"


def test_risk_detail_endpoint(client):
    """Faz 4: /api/risk/{symbol} bileşen detayları + assets kanıt listesi."""
    client.post("/api/system/cycle")
    r = client.get("/api/risk/BTCUSDT")
    assert r.status_code == 200, r.text
    d = r.json()
    for key in ("score", "source", "components", "weights",
                "critical_cap", "data_sources", "evidence"):
        assert key in d, f"eksik alan: {key}"
    assert set(d["components"]) == {"exploit", "contract", "audit", "maturity"}
    assert sum(d["weights"].values()) == pytest.approx(1.0)
    # test ortamı PRICE_SOURCE=mock → risk verisi mock etiketli (ağ yok)
    assert d["source"] == "mock"
    assert all(c["summary"] for c in d["components"].values())

    # assets listesi panel tooltip'i için kanıt özetleri taşımalı
    assets = client.get("/api/assets").json()["assets"]
    btc = next(a for a in assets if a["symbol"] == "BTCUSDT")
    assert len(btc["risk_evidence"]) == 4

    # bilinmeyen sembol → 404
    assert client.get("/api/risk/OLMAYANUSDT").status_code == 404


def test_defi_detail_endpoint(client):
    """Faz 3: /api/defi/{symbol} bileşen detayları + assets kanıt listesi."""
    client.post("/api/system/cycle")
    r = client.get("/api/defi/BTCUSDT")
    assert r.status_code == 200, r.text
    d = r.json()
    for key in ("score", "source", "components", "weights", "metrics",
                "data_sources", "evidence"):
        assert key in d, f"eksik alan: {key}"
    assert set(d["components"]) == {"trend", "depth", "fees", "yield"}
    assert sum(d["weights"].values()) == pytest.approx(1.0)
    # test ortamı PRICE_SOURCE=mock → defi verisi mock etiketli (ağ yok)
    assert d["source"] == "mock"
    assert all(c["summary"] for c in d["components"].values())

    # assets listesi panel tooltip'i için kanıt özetleri taşımalı
    assets = client.get("/api/assets").json()["assets"]
    btc = next(a for a in assets if a["symbol"] == "BTCUSDT")
    assert len(btc["defi_evidence"]) == 4

    # bilinmeyen sembol → 404
    assert client.get("/api/defi/OLMAYANUSDT").status_code == 404


def test_sentiment_detail_endpoint(client):
    """Faz 5: /api/sentiment/{symbol} bileşen detayları + assets kanıt listesi."""
    client.post("/api/system/cycle")
    r = client.get("/api/sentiment/BTCUSDT")
    assert r.status_code == 200, r.text
    d = r.json()
    for key in ("score", "source", "components", "weights", "market",
                "data_sources", "evidence"):
        assert key in d, f"eksik alan: {key}"
    assert set(d["components"]) == {"fng", "news", "attention"}
    assert sum(d["weights"].values()) == pytest.approx(1.0)
    # test ortamı PRICE_SOURCE=mock → duygu verisi mock etiketli (ağ yok)
    assert d["source"] == "mock"
    assert all(c["summary"] for c in d["components"].values())

    # assets listesi panel tooltip'i için kanıt özetleri taşımalı
    assets = client.get("/api/assets").json()["assets"]
    btc = next(a for a in assets if a["symbol"] == "BTCUSDT")
    assert len(btc["sentiment_evidence"]) == 3

    # bilinmeyen sembol → 404
    assert client.get("/api/sentiment/OLMAYANUSDT").status_code == 404


def test_macro_detail_endpoint(client):
    """Faz 6: /api/macro/{symbol} bileşen detayları + assets kanıt listesi."""
    client.post("/api/system/cycle")
    r = client.get("/api/macro/BTCUSDT")
    assert r.status_code == 200, r.text
    d = r.json()
    for key in ("score", "source", "components", "weights", "market",
                "data_sources", "evidence"):
        assert key in d, f"eksik alan: {key}"
    assert set(d["components"]) == {"liquidity", "market", "dominance", "usd"}
    assert sum(d["weights"].values()) == pytest.approx(1.0)
    # test ortamı PRICE_SOURCE=mock → makro verisi mock etiketli (ağ yok)
    assert d["source"] == "mock"
    assert all(c["summary"] for c in d["components"].values())

    # assets listesi panel tooltip'i için kanıt özetleri taşımalı
    assets = client.get("/api/assets").json()["assets"]
    btc = next(a for a in assets if a["symbol"] == "BTCUSDT")
    assert len(btc["macro_evidence"]) == 4

    # bilinmeyen sembol → 404
    assert client.get("/api/macro/OLMAYANUSDT").status_code == 404


def test_asset_management(client):
    r = client.post("/api/assets", json={"symbol": "TESTUSDT", "category": "defi"})
    assert r.status_code == 200
    assert client.put("/api/assets", json={"symbol": "TESTUSDT",
                                           "enabled": False}).status_code == 200
    assert client.delete("/api/assets/TESTUSDT").json()["ok"] is True


def test_dashboard_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "SANAL TEST MODU" in r.text
