"""REST API — panel ve dış sistemler bu uçlardan konuşur.

Tüm uçlar `/api/` altında; arayüz tamamen bu API'yi kullanır,
böylece paneli kendi sitene gömebilir veya başka bir istemci yazabilirsin.
"""
from __future__ import annotations

import csv
import io
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel

from .. import settings_store as ss
from ..core.backtest import run_backtest
from ..core.metrics import layer_comparison, performance_report
from ..db import get_state, set_state
from ..models import Asset, Decision, EquitySnapshot, Notification, Position, Wallet, WalletActivity

log = logging.getLogger("paperbot.api")
router = APIRouter()


# ------------------------------------------------------------------ yardımcılar
def _ctx(request: Request):
    return request.app.state.ctx


def _pos_dict(p: Position) -> dict:
    return {
        "id": p.id, "symbol": p.symbol, "side": p.side, "qty": p.qty,
        "entry_price": p.entry_price, "exec_entry_price": p.exec_entry_price,
        "cost_basis": p.cost_basis, "stop_loss": p.stop_loss,
        "take_profit": p.take_profit, "status": p.status,
        "exit_price": p.exit_price, "exit_reason": p.exit_reason,
        "pnl": round(p.pnl or 0.0, 4), "strategy": p.strategy,
        "final_score": p.final_score, "confidence": p.confidence,
        "layer_scores": p.layer_scores or {}, "rationale": p.rationale,
        "opened_at": p.opened_at.isoformat() if p.opened_at else None,
        "closed_at": p.closed_at.isoformat() if p.closed_at else None,
        "fees": round((p.fees or 0) + (p.exit_fees or 0), 4),
        "gas": round((p.gas or 0) + (p.exit_gas or 0), 4),
        "slippage": round((p.slippage_cost or 0) + (p.exit_slippage or 0), 4),
    }


def _closed_trade_rows(ctx, limit: int = 5000) -> list[dict]:
    with ctx.session_factory() as s:
        rows = (s.query(Position).filter(Position.status == "closed")
                .order_by(Position.closed_at.desc()).limit(limit).all())
        return [_pos_dict(r) for r in rows]


def _snapshots(ctx, limit: int = 2000) -> list[dict]:
    with ctx.session_factory() as s:
        rows = (s.query(EquitySnapshot).order_by(EquitySnapshot.ts.desc())
                .limit(limit).all())
        rows = list(reversed(rows))
        return [{"ts": r.ts.isoformat(), "equity": round(r.equity, 2),
                 "cash": round(r.cash, 2), "open_count": r.open_count,
                 "open_value": round(r.open_value, 2)} for r in rows]


# =================================================================== sistem
@router.get("/status")
def status(request: Request):
    ctx = _ctx(request)
    cfg = ctx.current_cfg()
    eng = ctx.engine
    prices = eng.last_prices
    equity = eng.equity(prices) if prices else eng.cash
    day_start = eng.day_start_equity
    daily_pnl_pct = ((equity - day_start) / day_start * 100) if day_start else 0.0
    last_cycle = ""
    with ctx.session_factory() as s:
        last_cycle = get_state(s, "last_cycle_at", "")
    return {
        "mode": cfg.trading_mode,
        "live_trading_enabled": bool(cfg.live_trading_enabled),
        "paper_only": not cfg.live_trading_enabled,
        "kill_switch": eng.kill_switch,
        "daily_halt": eng.daily_halt,
        "cash": round(eng.cash, 2),
        "equity": round(equity, 2),
        "open_count": len(eng.positions),
        "day_start_equity": round(day_start, 2),
        "daily_pnl_pct": round(daily_pnl_pct, 3),
        "daily_loss_limit_pct": round(cfg.daily_max_loss_pct * 100, 2),
        "cycle_seconds": cfg.cycle_seconds,
        "last_cycle_at": last_cycle,
        "scheduler_running": bool(eng.session_factory is not None
                                  and ctx.scheduler.task and not ctx.scheduler.task.done()),
        "scheduler_error": ctx.scheduler.last_error,
        "price_source": cfg.price_source,
        "last_price_feed": (eng.last_result.price_source if eng.last_result else ""),
        "telegram_enabled": ctx.notifier.enabled,
        "llm_enabled": bool(cfg.openai_api_key) or cfg.llm_bridge == "opencode",
        "llm_model": (f"opencode/{cfg.llm_provider}/{cfg.llm_model}"
                      if cfg.llm_bridge == "opencode" else cfg.openai_model),
        "version": ctx.version,
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/assets")
def assets(request: Request):
    ctx = _ctx(request)
    eng = ctx.engine
    decisions = {}
    if eng.last_result:
        decisions = {d.symbol: d for d in eng.last_result.decisions}
    out = []
    with ctx.session_factory() as s:
        rows = s.query(Asset).order_by(Asset.sort_order).all()
        for a in rows:
            d = decisions.get(a.symbol)
            scores = eng.last_scores.get(a.symbol, {})
            score_dict = {k: (round(v.score, 1) if hasattr(v, "score") else round(float(v), 1))
                          for k, v in scores.items()}
            sources = {k: getattr(v, "source", "?") for k, v in scores.items()}
            out.append({
                "symbol": a.symbol, "name": a.name, "category": a.category,
                "enabled": a.enabled, "coingecko_id": a.coingecko_id,
                "price": eng.last_prices.get(a.symbol, a.last_price),
                "scores": score_dict, "sources": sources,
                "risk_evidence": _risk_evidence(scores.get("risk")),
                "defi_evidence": _defi_evidence(scores.get("defi")),
                "sentiment_evidence": _sentiment_evidence(scores.get("sentiment")),
                "macro_evidence": _macro_evidence(scores.get("macro")),
                "final_score": d.final_score if d else None,
                "risk_level": d.risk_level if d else "",
                "action": d.action if d else "",
                "confidence": d.confidence if d else None,
                "has_position": any(p.symbol == a.symbol for p in eng.positions),
            })
    return {"assets": out, "updated_at": (eng.last_result.now.isoformat()
                                          if eng.last_result else "")}


def _risk_evidence(risk_score) -> list[str]:
    """Risk katmanı bileşen özetleri (panel tooltip'i için)."""
    details = getattr(risk_score, "details", None) or {}
    comps = details.get("components") or {}
    return [comps[k]["summary"] for k in
            ("exploit", "contract", "audit", "maturity") if k in comps]


def _defi_evidence(defi_score) -> list[str]:
    """DeFi katmanı bileşen özetleri (panel tooltip'i için)."""
    details = getattr(defi_score, "details", None) or {}
    comps = details.get("components") or {}
    return [comps[k]["summary"] for k in
            ("trend", "depth", "fees", "yield") if k in comps]


def _sentiment_evidence(sent_score) -> list[str]:
    """Duygu katmanı bileşen özetleri (panel tooltip'i için)."""
    details = getattr(sent_score, "details", None) or {}
    comps = details.get("components") or {}
    return [comps[k]["summary"] for k in
            ("fng", "news", "attention") if k in comps]


def _macro_evidence(macro_score) -> list[str]:
    """Makro katmanı bileşen özetleri (panel tooltip'i için)."""
    details = getattr(macro_score, "details", None) or {}
    comps = details.get("components") or {}
    return [comps[k]["summary"] for k in
            ("liquidity", "market", "dominance", "usd") if k in comps]


# ============================================================== risk & güvenlik
@router.get("/risk/{symbol}")
def risk_detail(request: Request, symbol: str):
    """Faz 4: Risk & Güvenlik katmanının bileşen detayları (son çevrim)."""
    ctx = _ctx(request)
    eng = ctx.engine
    rs = (eng.last_scores or {}).get(symbol, {}).get("risk")
    details = getattr(rs, "details", None) or {}
    if not details:
        raise HTTPException(404, "risk detayı yok — önce bir çevrim çalıştırın")
    return {
        "symbol": symbol,
        "score": round(float(getattr(rs, "score", 0.0)), 1),
        "source": getattr(rs, "source", "mock"),
        "components": details.get("components", {}),
        "weights": details.get("weights", {}),
        "critical_cap": details.get("critical_cap"),
        "protocol": details.get("protocol"),
        "data_sources": details.get("data_sources", []),
        "evidence": {k: details.get(k) for k in
                     ("exploit", "audit", "contract", "maturity")},
    }


# ================================================================ DeFi (Faz 3)
@router.get("/defi/{symbol}")
def defi_detail(request: Request, symbol: str):
    """Faz 3: DeFi metrik katmanının bileşen detayları (son çevrim)."""
    ctx = _ctx(request)
    eng = ctx.engine
    rs = (eng.last_scores or {}).get(symbol, {}).get("defi")
    details = getattr(rs, "details", None) or {}
    if not details:
        raise HTTPException(404, "defi detayı yok — önce bir çevrim çalıştırın")
    return {
        "symbol": symbol,
        "score": round(float(getattr(rs, "score", 0.0)), 1),
        "source": getattr(rs, "source", "mock"),
        "components": details.get("components", {}),
        "weights": details.get("weights", {}),
        "metrics": details.get("metrics", {}),
        "data_sources": details.get("data_sources", []),
        "evidence": {k: details.get(k) for k in
                     ("trend", "depth", "fees", "yield")},
    }


# ============================================================== duygu (Faz 5)
@router.get("/sentiment/{symbol}")
def sentiment_detail(request: Request, symbol: str):
    """Faz 5: Duygu & haber katmanının bileşen detayları (son çevrim)."""
    ctx = _ctx(request)
    eng = ctx.engine
    rs = (eng.last_scores or {}).get(symbol, {}).get("sentiment")
    details = getattr(rs, "details", None) or {}
    if not details:
        raise HTTPException(404, "duygu detayı yok — önce bir çevrim çalıştırın")
    return {
        "symbol": symbol,
        "score": round(float(getattr(rs, "score", 0.0)), 1),
        "source": getattr(rs, "source", "mock"),
        "components": details.get("components", {}),
        "weights": details.get("weights", {}),
        "market": details.get("market"),
        "news_query": details.get("news_query"),
        "data_sources": details.get("data_sources", []),
        "evidence": {k: details.get(k) for k in
                     ("fng", "news", "attention")},
    }


# ================================================================ makro (Faz 6)
@router.get("/macro/{symbol}")
def macro_detail(request: Request, symbol: str):
    """Faz 6: Makro katmanının bileşen detayları (son çevrim)."""
    ctx = _ctx(request)
    eng = ctx.engine
    rs = (eng.last_scores or {}).get(symbol, {}).get("macro")
    details = getattr(rs, "details", None) or {}
    if not details:
        raise HTTPException(404, "makro detayı yok — önce bir çevrim çalıştırın")
    return {
        "symbol": symbol,
        "score": round(float(getattr(rs, "score", 0.0)), 1),
        "source": getattr(rs, "source", "mock"),
        "components": details.get("components", {}),
        "weights": details.get("weights", {}),
        "market": details.get("snapshot"),
        "data_sources": details.get("data_sources", []),
        "evidence": {k: details.get(k) for k in
                     ("liquidity", "market", "dominance", "usd")},
    }


# ================================================================ pozisyonlar
@router.get("/positions")
def positions(request: Request, status: str = Query("open"), limit: int = 200):
    ctx = _ctx(request)
    prices = ctx.engine.last_prices or {}
    with ctx.session_factory() as s:
        q = s.query(Position)
        if status in ("open", "closed"):
            q = q.filter(Position.status == status)
        rows = q.order_by(Position.opened_at.desc()).limit(limit).all()
        out = [_pos_dict(r) for r in rows]
    # açık pozisyonlara güncel fiyat + gerçekleşmemiş PnL ekle
    for d, r in zip(out, rows):
        if r.status == "open" and r.symbol in prices:
            lp = prices[r.symbol]
            upnl = r.qty * lp - r.cost_basis
            d["last_price"] = lp
            d["unrealized_pnl"] = round(upnl, 4)
            d["unrealized_pct"] = round(upnl / r.cost_basis * 100, 2) if r.cost_basis else 0.0
    return {"positions": out}


# ==================================================================== portföy
@router.get("/equity")
def equity_curve(request: Request, limit: int = 500):
    ctx = _ctx(request)
    snaps = _snapshots(ctx, limit)
    step = max(1, len(snaps) // 500)
    return {"curve": snaps[::step], "total": len(snaps)}


# ================================================================ performans
@router.get("/metrics")
def metrics(request: Request):
    ctx = _ctx(request)
    cfg = ctx.current_cfg()
    trades = _closed_trade_rows(ctx)
    snaps = _snapshots(ctx, 3000)
    report = performance_report(trades, snaps, period_seconds=cfg.cycle_seconds,
                                confirmation_score=cfg.confirmation_score)
    report["open_positions"] = len(ctx.engine.positions)
    report["cash"] = round(ctx.engine.cash, 2)
    return report


@router.get("/compare")
def compare(request: Request, layer: str = "onchain", threshold: float = 60.0):
    """Karşılaştırma raporu: sinyali olan işlemler vs olmayanlar."""
    ctx = _ctx(request)
    cfg = ctx.current_cfg()
    trades = _closed_trade_rows(ctx)
    if threshold <= 0:
        threshold = cfg.confirmation_score
    return layer_comparison(trades, layer, threshold)


# ==================================================================== sinyaller
@router.get("/signals")
def signals(request: Request, limit: int = 100, symbol: str = "",
            action: str = ""):
    ctx = _ctx(request)
    with ctx.session_factory() as s:
        q = s.query(Decision)
        if symbol:
            q = q.filter(Decision.symbol == symbol)
        if action:
            q = q.filter(Decision.action == action)
        rows = q.order_by(Decision.created_at.desc()).limit(limit).all()
        return {"signals": [{
            "id": r.id, "created_at": r.created_at.isoformat(),
            "symbol": r.symbol, "action": r.action, "strategy": r.strategy,
            "final_score": r.final_score, "confidence": r.confidence,
            "probability": r.probability, "risk_level": r.risk_level,
            "layer_scores": r.layer_scores or {}, "details": r.details or {},
            "rationale": r.rationale, "executed": r.executed,
            "skip_reason": r.skip_reason,
        } for r in rows]}


# ======================================================================= ayarlar
@router.get("/settings")
def get_settings(request: Request):
    ctx = _ctx(request)
    return {"settings": ss.settings_payload(ctx.session_factory)}


class SettingsUpdate(BaseModel):
    values: dict = {}


@router.put("/settings")
def put_settings(request: Request, body: SettingsUpdate):
    ctx = _ctx(request)
    saved, errors = ss.save_overrides(ctx.session_factory, body.values)
    # motor bir sonraki çevrimde taze cfg okur; manuel döngüde hemen uygula
    if saved:
        ctx.engine.cfg = ctx.current_cfg()
    return {"saved": saved, "errors": errors}


# ================================================================ Binance API
class BinanceSetupBody(BaseModel):
    api_key: str = ""
    api_secret: str = ""
    testnet: bool = False
    enable_live: bool = True


@router.get("/binance/status")
def binance_status(request: Request, check: bool = False):
    """Binance bağlantı durumu. `check=1` ile imzalı /account sorgusu yapar."""
    ctx = _ctx(request)
    cfg = ctx.current_cfg()
    out = {
        "key_present": bool(cfg.binance_api_key),
        "secret_present": bool(cfg.binance_api_secret),
        "testnet": bool(cfg.binance_testnet),
        "mode": cfg.trading_mode,
        "live_enabled": bool(cfg.live_trading_enabled),
        "connected": None, "usdt_free": None, "error": "",
    }
    if check and out["key_present"] and out["secret_present"]:
        from ..core.binance_exec import BinanceClient
        client = BinanceClient(cfg.binance_api_key, cfg.binance_api_secret,
                               testnet=cfg.binance_testnet,
                               timeout=cfg.http_timeout)
        try:
            out["usdt_free"] = round(client.usdt_free(), 2)
            out["connected"] = True
        except Exception as e:  # noqa: BLE001
            out["connected"] = False
            out["error"] = str(e)
        finally:
            client.close()
    return out


@router.post("/binance/setup")
def binance_setup(request: Request, body: BinanceSetupBody):
    """Anahtarları doğrula → .env'ye yaz → (opsiyonel) canlı modu aç.

    Anahtarlar YALNIZCA .env dosyasında yaşar; veritabanına yazılmaz.
    """
    from ..config import write_env_vars
    from ..core.binance_exec import BinanceClient

    ctx = _ctx(request)
    key, secret = body.api_key.strip(), body.api_secret.strip()
    if not key or not secret:
        raise HTTPException(400, "API key ve secret birlikte gerekli")

    client = BinanceClient(key, secret, testnet=body.testnet, timeout=10.0)
    try:
        usdt = client.usdt_free()               # imzalı → anahtarları doğrular
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Binance doğrulama başarısız: {e}")
    finally:
        client.close()

    updates = {
        "BINANCE_API_KEY": key,
        "BINANCE_API_SECRET": secret,
        "BINANCE_TESTNET": "true" if body.testnet else "false",
    }
    if body.enable_live:
        updates["LIVE_TRADING_ENABLED"] = "true"
        updates["TRADING_MODE"] = "live"
    env_path = write_env_vars(updates)
    ctx.engine.cfg = ctx.current_cfg()          # os.environ tazelendi → anında uygulanır

    if body.enable_live:
        log.warning("CANLI MOD AÇILDI (testnet=%s) — gerçek para riski var!",
                    body.testnet)
        ctx.notify("system",
                   f"🔴 Binance API doğrulandı (USDT: {usdt:.2f}) ve CANLI MOD "
                   f"açıldı ({'TESTNET' if body.testnet else 'GERÇEK BORSA'}). "
                   "Yeni işlemler GERÇEK PARAYLA yapılacaktır.")
    else:
        ctx.notify("system",
                   f"Binance API kaydedildi (USDT: {usdt:.2f}) — canlı mod "
                   "kapalı, işlemler sanal devam ediyor.")
    return {"ok": True, "live": body.enable_live, "testnet": body.testnet,
            "usdt_free": round(usdt, 2), "env_file": str(env_path),
            "mode": ctx.current_cfg().trading_mode}


@router.post("/binance/disable")
def binance_disable(request: Request):
    """Canlı modu kapat → kağıt mod; .env güncellenir, bir sonraki çevrimde
    açık pozisyonlar sanal olarak kapatılır (gerçek varlıklar satılmaz)."""
    from ..config import write_env_vars

    ctx = _ctx(request)
    write_env_vars({"LIVE_TRADING_ENABLED": "false", "TRADING_MODE": "paper"})
    ctx.engine.cfg = ctx.current_cfg()
    ctx.notify("system",
               "↩ CANLI MOD KAPATILDI — sistem kağıt moduna döndü. Açık "
               "pozisyonlar bir sonraki çevrimde sanal olarak kapatılacak; "
               "borsadaki gerçek varlıklar SATILMAZ.")
    return {"ok": True, "live": False, "mode": ctx.current_cfg().trading_mode}


# ============================================================ sistem kontrolleri
class KillBody(BaseModel):
    enable: bool = True


@router.post("/system/kill-switch")
def kill_switch(request: Request, body: KillBody):
    """Tek tuşla: tüm sistemi durdur + açık sanal pozisyonları kapat."""
    ctx = _ctx(request)
    eng = ctx.engine
    eng.kill_switch = bool(body.enable)
    with ctx.session_factory() as s:
        set_state(s, "kill_switch", "1" if eng.kill_switch else "0")
        s.commit()
    if body.enable:
        eng.cfg = ctx.current_cfg()
        result = eng.run_cycle()      # açık pozisyonları kapatır
        ctx.notify("kill_switch",
                   f"🛑 KILL SWITCH AKTİF. {len(result.closed)} pozisyon "
                   f"kapatıldı. Toplam bakiye: {result.equity:.2f} USDT. "
                   "Yeni işlem açılmayacak.")
        return {"ok": True, "kill_switch": True,
                "closed": len(result.closed), "equity": round(result.equity, 2)}
    ctx.notify("system", "✅ Kill switch kapatıldı — sistem normale döndü.")
    return {"ok": True, "kill_switch": False, "closed": 0}


@router.post("/system/resume")
def resume(request: Request):
    """Kill switch + günlük zarar duraklatmasını sıfırla."""
    ctx = _ctx(request)
    eng = ctx.engine
    eng.kill_switch = False
    eng.daily_halt = False
    with ctx.session_factory() as s:
        set_state(s, "kill_switch", "0")
        set_state(s, "daily_halt", "0")
        s.commit()
    ctx.notify("system", "▶ Sistem normale döndürüldü: kill switch ve günlük "
                         "zarar duraklatması sıfırlandı.")
    return {"ok": True, "kill_switch": False, "daily_halt": False}


@router.post("/system/cycle")
def manual_cycle(request: Request):
    """Manuel tek çevrim çalıştır (paneldeki 'Şimdi Analiz Et' butonu)."""
    ctx = _ctx(request)
    eng = ctx.engine
    eng.cfg = ctx.current_cfg()
    pipe = getattr(ctx, "pipeline", None)
    onchain = None
    if pipe is not None:
        try:
            onchain = pipe.refresh(ctx.current_cfg())
        except Exception as e:  # noqa: BLE001
            onchain = {"error": str(e)}
    result = eng.run_cycle()
    return {
        "ok": True, "equity": round(result.equity, 2), "cash": round(result.cash, 2),
        "opened": len(result.opened), "closed": len(result.closed),
        "decisions": len(result.decisions), "daily_halt": result.daily_halt,
        "kill_switch": result.kill_switch, "price_source": result.price_source,
        "onchain": onchain,
        "events": [{"kind": e.kind, "symbol": e.symbol, "message": e.message}
                   for e in result.events],
        "notes": result.notes,
    }


class ResetBody(BaseModel):
    balance: float | None = None


@router.post("/system/reset")
def reset_portfolio(request: Request, body: ResetBody):
    """Açık pozisyonları kapat, sanal bakiyeyi ayarla (geçmiş korunur)."""
    ctx = _ctx(request)
    cfg = ctx.current_cfg()
    eng = ctx.engine
    eng.cfg = cfg
    balance = float(body.balance or cfg.start_balance)
    closed = 0
    for p in list(eng.positions):
        price = eng.last_prices.get(p.symbol, p.entry_price)
        if eng._close_position(p, price, "manual", cfg):
            closed += 1
    eng.cash = balance
    eng.daily_halt = False
    eng.day_start_equity = balance
    with ctx.session_factory() as s:
        set_state(s, "cash", repr(balance))
        set_state(s, "daily_halt", "0")
        set_state(s, "day_start_equity", repr(balance))
        s.commit()
    ctx.notify("system", f"Portföy sıfırlandı: bakiye {balance:.2f} USDT, "
                         f"{closed} pozisyon kapatıldı.")
    return {"ok": True, "cash": round(balance, 2), "closed_positions": closed}


# ==================================================================== backtest
class BacktestBody(BaseModel):
    symbols: list[str] | None = None
    days: int | None = None
    interval: str | None = None


@router.post("/backtest")
def backtest(request: Request, body: BacktestBody):
    """Aynı strateji koduyla geçmiş veride test (senkron, birkaç saniye sürebilir)."""
    ctx = _ctx(request)
    cfg = ctx.current_cfg()
    with ctx.session_factory() as s:
        symbols = body.symbols or [r.symbol for r in
                                   s.query(Asset).filter(Asset.enabled.is_(True))
                                   .order_by(Asset.sort_order).all()]
    symbols = symbols[:25]
    days = int(body.days or cfg.backtest_days)
    interval = body.interval or cfg.backtest_interval
    result = run_backtest(symbols, days, interval, cfg, ctx.feed,
                          ctx.registry, ctx.decider)
    ctx.last_backtest = result
    return result


@router.get("/backtest/last")
def last_backtest(request: Request):
    return getattr(_ctx(request), "last_backtest", None) or {"error": "henüz backtest yok"}


# ==================================================================== dışa aktarım
@router.get("/export/{kind}")
def export(request: Request, kind: str):
    """CSV/JSON dışa aktarım: trades | decisions | equity (.csv/.json uzantısı da olur)"""
    ctx = _ctx(request)
    kind = kind.split(".")[0]
    if kind == "trades":
        data = _closed_trade_rows(ctx, 100_000)
    elif kind == "decisions":
        with ctx.session_factory() as s:
            rows = s.query(Decision).order_by(Decision.created_at.desc()).limit(50_000).all()
            data = [{
                "id": r.id, "created_at": r.created_at.isoformat(), "symbol": r.symbol,
                "action": r.action, "strategy": r.strategy, "final_score": r.final_score,
                "confidence": r.confidence, "probability": r.probability,
                "risk_level": r.risk_level, "layer_scores": json.dumps(r.layer_scores),
                "executed": r.executed, "skip_reason": r.skip_reason,
                "rationale": r.rationale,
            } for r in rows]
    elif kind == "equity":
        data = _snapshots(ctx, 100_000)
    else:
        raise HTTPException(404, "tür bulunamadı: trades | decisions | equity")

    fmt = request.query_params.get("format", "json")
    if fmt == "csv":
        if not data:
            return Response(content="", media_type="text/csv")
        buf = io.StringIO()
        # katman skorları dict olduğu için JSON'a çevir
        flat = []
        for row in data:
            r = dict(row)
            for k, v in list(r.items()):
                if isinstance(v, (dict, list)):
                    r[k] = json.dumps(v, ensure_ascii=False)
                elif isinstance(v, bool):
                    r[k] = int(v)
            flat.append(r)
        writer = csv.DictWriter(buf, fieldnames=list(flat[0].keys()))
        writer.writeheader()
        writer.writerows(flat)
        return Response(
            content=buf.getvalue().encode("utf-8-sig"),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=paperbot_{kind}.csv"},
        )
    return Response(
        content=json.dumps(data, ensure_ascii=False, default=str, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=paperbot_{kind}.json"},
    )


# ==================================================================== bildirimler
@router.get("/notifications")
def notifications(request: Request, limit: int = 100):
    ctx = _ctx(request)
    with ctx.session_factory() as s:
        rows = (s.query(Notification).order_by(Notification.ts.desc())
                .limit(limit).all())
        return {"notifications": [{
            "id": r.id, "ts": r.ts.isoformat(), "kind": r.kind,
            "message": r.message, "delivered": r.delivered,
        } for r in rows]}


# ==================================================================== cüzdanlar (Faz 2)
class WalletBody(BaseModel):
    address: str
    label: str = ""
    chain: str = "ethereum"
    wallet_type: str = "individual_whale"
    notes: str = ""


@router.get("/wallets")
def wallets_list(request: Request):
    ctx = _ctx(request)
    with ctx.session_factory() as s:
        rows = s.query(Wallet).order_by(Wallet.created_at.desc()).all()
        acts = (s.query(WalletActivity).order_by(WalletActivity.ts.desc())
                .limit(50).all())
        # her cüzdanın son portföy toplamı
        totals: dict[int, float] = {}
        from ..models import WalletSnapshot
        for w in rows:
            snap = (s.query(WalletSnapshot)
                    .filter(WalletSnapshot.wallet_id == w.id)
                    .order_by(WalletSnapshot.ts.desc()).first())
            totals[w.id] = snap.total_usd if snap else 0.0
        return {
            "wallets": [{
                "id": w.id, "address": w.address, "label": w.label,
                "chain": w.chain, "wallet_type": w.wallet_type,
                "is_active": w.is_active, "notes": w.notes,
                "hit_rate": w.hit_rate, "signals_total": w.signals_total,
                "signals_hit": w.signals_hit, "signals_miss": w.signals_miss,
                "data_source": w.data_source,
                "last_snapshot_at": (w.last_snapshot_at.isoformat()
                                     if w.last_snapshot_at else None),
                "portfolio_usd": round(totals.get(w.id, 0.0), 2),
                "qualifying": w.wallet_type in
                              ("smart_money", "individual_whale", "fund"),
            } for w in rows],
            "recent_activities": [{
                "id": a.id, "wallet_id": a.wallet_id, "ts": a.ts.isoformat(),
                "token": a.token, "action": a.action, "qty_usd": a.qty_usd,
                "detail": a.detail,
                "label": next((w.label for w in rows if w.id == a.wallet_id), "#?"),
            } for a in acts],
            "layer_status": _wallets_status(rows),
            "last_refresh": (pipe_last_refresh(ctx)),
        }


def _wallets_status(rows) -> str:
    """Cüzdan kaynak dağılımını dürüstçe özetler (canlı/demo karışık olabilir)."""
    counts: dict[str, int] = {}
    for w in rows:
        counts[w.data_source] = counts.get(w.data_source, 0) + 1
    bits = " · ".join(f"{k} ×{v}" for k, v in sorted(counts.items()))
    return ("Faz 2 aktif: cüzdan portföyleri + fark sinyalleri çalışıyor "
            f"(kaynaklar: {bits or 'yok'})")


def pipe_last_refresh(ctx):
    p = getattr(ctx, "pipeline", None)
    return p.last_refresh.isoformat() if (p and p.last_refresh) else None


@router.get("/wallets/{wallet_id}/portfolio")
def wallet_portfolio(request: Request, wallet_id: int, limit: int = 30):
    ctx = _ctx(request)
    with ctx.session_factory() as s:
        w = s.get(Wallet, wallet_id)
        if not w:
            raise HTTPException(404, "cüzdan bulunamadı")
        from ..models import WalletSnapshot
        snap = (s.query(WalletSnapshot)
                .filter(WalletSnapshot.wallet_id == wallet_id)
                .order_by(WalletSnapshot.ts.desc()).first())
        acts = (s.query(WalletActivity)
                .filter(WalletActivity.wallet_id == wallet_id)
                .order_by(WalletActivity.ts.desc()).limit(limit).all())
        return {
            "wallet": {"id": w.id, "label": w.label, "address": w.address,
                       "wallet_type": w.wallet_type, "hit_rate": w.hit_rate,
                       "data_source": w.data_source},
            "holdings": (snap.holdings if snap else {}),
            "total_usd": snap.total_usd if snap else 0.0,
            "snapshot_at": snap.ts.isoformat() if snap else None,
            "activities": [{
                "id": a.id, "ts": a.ts.isoformat(), "token": a.token,
                "action": a.action, "qty_usd": a.qty_usd,
                "detail": a.detail, "evaluated": a.evaluated,
            } for a in acts],
        }


@router.post("/wallets/refresh")
def wallets_refresh(request: Request, evaluate_hits: bool = False):
    """Cüzdan portföylerini hemen tazele (farklar → sinyal)."""
    ctx = _ctx(request)
    pipe = getattr(ctx, "pipeline", None)
    if pipe is None:
        raise HTTPException(503, "on-chain pipeline hazır değil")
    summary = pipe.refresh(ctx.current_cfg())
    if evaluate_hits:
        summary["hit_eval"] = pipe.evaluate_hits(feed=ctx.feed, force=True)
    return {"ok": True, **summary, "last_refresh": pipe_last_refresh(ctx)}


@router.get("/smart-money")
def smart_money_signals(request: Request):
    """Token bazlı akıllı para sinyalleri: güçlü/zayıf, kanıt cüzdanları."""
    ctx = _ctx(request)
    pipe = getattr(ctx, "pipeline", None)
    if pipe is None:
        return {"signals": [], "note": "pipeline hazır değil"}
    return {"signals": pipe.signals(),
            "window_days": 7,
            "note": "≥2 biriktiren cüzdan = güçlü sinyal; borsa/ekip cüzdanları hariç"}


@router.post("/wallets")
def wallets_add(request: Request, body: WalletBody):
    ctx = _ctx(request)
    with ctx.session_factory() as s:
        if s.query(Wallet).filter(Wallet.address == body.address).first():
            raise HTTPException(400, "bu adres zaten takip listesinde")
        w = Wallet(address=body.address, label=body.label, chain=body.chain,
                   wallet_type=body.wallet_type, notes=body.notes)
        s.add(w)
        s.commit()
        return {"ok": True, "id": w.id}


class WalletPatch(BaseModel):
    is_active: bool | None = None
    wallet_type: str | None = None
    label: str | None = None


@router.patch("/wallets/{wallet_id}")
def wallets_update(request: Request, wallet_id: int, body: WalletPatch):
    ctx = _ctx(request)
    with ctx.session_factory() as s:
        w = s.get(Wallet, wallet_id)
        if not w:
            raise HTTPException(404, "cüzdan bulunamadı")
        if body.is_active is not None:
            w.is_active = body.is_active
        if body.wallet_type:
            w.wallet_type = body.wallet_type
        if body.label is not None:
            w.label = body.label
        s.commit()
        return {"ok": True}


@router.delete("/wallets/{wallet_id}")
def wallets_delete(request: Request, wallet_id: int):
    ctx = _ctx(request)
    with ctx.session_factory() as s:
        w = s.get(Wallet, wallet_id)
        if not w:
            raise HTTPException(404, "cüzdan bulunamadı")
        s.delete(w)
        s.commit()
        return {"ok": True}


# ============================================================ varlık yönetimi
class AssetBody(BaseModel):
    symbol: str
    name: str = ""
    category: str = "other"
    coingecko_id: str = ""


@router.post("/assets")
def assets_add(request: Request, body: AssetBody):
    ctx = _ctx(request)
    sym = body.symbol.upper().strip()
    if not sym or len(sym) > 24:
        raise HTTPException(400, "geçersiz sembol")
    with ctx.session_factory() as s:
        if s.query(Asset).filter(Asset.symbol == sym).first():
            raise HTTPException(400, "bu varlık zaten listede")
        n = (s.query(Asset).count() or 0)
        s.add(Asset(symbol=sym, name=body.name or sym, category=body.category,
                    coingecko_id=body.coingecko_id, enabled=True, sort_order=n))
        s.commit()
    return {"ok": True, "symbol": sym}


class AssetPatch(BaseModel):
    symbol: str
    enabled: bool


@router.put("/assets")
def assets_update(request: Request, body: AssetPatch):
    ctx = _ctx(request)
    with ctx.session_factory() as s:
        a = s.query(Asset).filter(Asset.symbol == body.symbol.upper()).first()
        if not a:
            raise HTTPException(404, "varlık bulunamadı")
        a.enabled = body.enabled
        s.commit()
    return {"ok": True}


@router.delete("/assets/{symbol}")
def assets_delete(request: Request, symbol: str):
    ctx = _ctx(request)
    with ctx.session_factory() as s:
        a = s.query(Asset).filter(Asset.symbol == symbol.upper()).first()
        if not a:
            raise HTTPException(404, "varlık bulunamadı")
        open_pos = (s.query(Position).filter(Position.symbol == symbol.upper(),
                                             Position.status == "open").count())
        if open_pos:
            raise HTTPException(400, f"AÇIK pozisyon var ({open_pos}) — önce kapat")
        s.delete(a)
        s.commit()
    return {"ok": True}
