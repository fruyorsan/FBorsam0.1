"""Binance spot — Faz 10 CANLI (gerçek para) yürütme adaptörü.

Kurallar:
- Anahtarlar yalnızca `.env`'dedir (BINANCE_API_KEY / BINANCE_API_SECRET);
  DB'ye asla yazılmaz. Panelden girilirse `.env` dosyasına yazılır.
- `trading_mode != live` veya `live_trading_enabled = false` ise asla emir
  göndermez (`ExecutionDisabled` fırlatır) — çift emniyet kilidi.
- Alım: MARKET + `quoteOrderQty` (miktar yuvarlama hatası olmaz).
- Satım: LOT_SIZE adımına yuvarlanır, bakiye asla aşılmaz.
- Ücretler emir dolusundan (`fills`) hesaplanır; bilinmeyen varlıkta
  (ör. BNB) kötümser `cfg.fee_rate` ile üst sınır uygulanır.
- Hiçbir hata çevrimi çökertmez; her şey `Fill(False, reason=...)` ile
  motorun mevcut "işlem reddedildi" akışına düşer.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import math
import time
from urllib.parse import urlencode

import httpx

from ..config import AppConfig
from .paper_engine import ExecutionDisabled, ExecutionProvider, Fill

log = logging.getLogger("paperbot.binance")

BASE_REAL = "https://api.binance.com"
BASE_TESTNET = "https://testnet.binance.vision"
QUOTE_ASSET = "USDT"


class BinanceApiError(RuntimeError):
    """Binance REST hatası (kod + mesaj)."""

    def __init__(self, code, msg: str):
        self.code = code
        super().__init__(f"[{code}] {msg}" if code is not None else str(msg))


class BinanceClient:
    """İmzalı/imasız Binance spot istemcisi (httpx)."""

    def __init__(self, api_key: str, api_secret: str,
                 testnet: bool = False, timeout: float = 10.0):
        self.key = (api_key or "").strip()
        self.secret = (api_secret or "").strip()
        self.testnet = bool(testnet)
        self.base = BASE_TESTNET if self.testnet else BASE_REAL
        self._http = httpx.Client(timeout=timeout)
        self._ts_offset = 0            # sunucu - yerel (ms)
        self._filters: dict[str, dict] = {}
        self._filters_ts: dict[str, float] = {}

    # ---------------------------------------------------------------- istek
    def close(self) -> None:
        try:
            self._http.close()
        except Exception:  # noqa: BLE001
            pass

    def _sync_time(self) -> None:
        try:
            r = self._http.get(f"{self.base}/api/v3/time")
            server = int(r.json()["serverTime"])
            self._ts_offset = server - int(time.time() * 1000)
            log.info("Binance zaman senkronu: %+d ms", self._ts_offset)
        except Exception as e:  # noqa: BLE001
            log.warning("Binance zaman senkronu başarısız: %s", e)

    def _request(self, method: str, path: str, params: dict | None = None,
                 signed: bool = False, _retry: bool = True):
        params = dict(params or {})
        headers = {"X-MBX-APIKEY": self.key} if self.key else {}
        if signed:
            if not self.key or not self.secret:
                raise ExecutionDisabled(
                    "Binance API anahtarı yok (.env: BINANCE_API_KEY / "
                    "BINANCE_API_SECRET)")
            params["timestamp"] = int(time.time() * 1000) + self._ts_offset
            params["recvWindow"] = 5000
            query = urlencode(params)
            params["signature"] = hmac.new(
                self.secret.encode(), query.encode(), hashlib.sha256
            ).hexdigest()
        try:
            r = self._http.request(method, f"{self.base}{path}",
                                   params=params, headers=headers)
        except httpx.HTTPError as e:
            raise BinanceApiError(None, f"bağlantı hatası: {e}") from e
        try:
            data = r.json() if r.content else {}
        except ValueError:
            data = {}
        if r.status_code >= 400:
            code = data.get("code") if isinstance(data, dict) else None
            msg = (data.get("msg") if isinstance(data, dict) else None) \
                or f"HTTP {r.status_code}"
            if code == -1021 and _retry:      # zaman damgası kayması → senkron + tekrar
                self._sync_time()
                clean = {k: v for k, v in params.items()
                         if k not in ("timestamp", "signature", "recvWindow")}
                return self._request(method, path, clean, signed=True, _retry=False)
            raise BinanceApiError(code, msg)
        return data

    # ------------------------------------------------------------- endpoointler
    def account(self) -> dict:
        return self._request("GET", "/api/v3/account", signed=True)

    def _balance(self, asset: str) -> float:
        data = self.account()
        for b in data.get("balances", []):
            if b.get("asset") == asset:
                return float(b.get("free", 0.0))
        return 0.0

    def usdt_free(self) -> float:
        """Kullanılabilir USDT (spot)."""
        return self._balance(QUOTE_ASSET)

    def base_free(self, symbol: str) -> float:
        return self._balance(symbol[:-4] if symbol.endswith(QUOTE_ASSET) else symbol)

    def symbol_filters(self, symbol: str) -> dict:
        """{step, min_qty, min_notional} — LOT_SIZE / MIN_NOTIONAL (24s cache)."""
        now = time.time()
        if symbol in self._filters and now - self._filters_ts.get(symbol, 0) < 86400:
            return self._filters[symbol]
        data = self._request("GET", "/api/v3/exchangeInfo", {"symbol": symbol})
        out = {"step": 0.0, "min_qty": 0.0, "min_notional": 0.0}
        for info in (data.get("symbols") or []):
            for f in info.get("filters", []):
                if f.get("filterType") == "LOT_SIZE":
                    out["step"] = float(f.get("stepSize", 0))
                    out["min_qty"] = float(f.get("minQty", 0))
                elif f.get("filterType") == "MARKET_LOT_SIZE":
                    step = float(f.get("stepSize", 0) or 0)
                    if step > 0:
                        out["step"] = step
                        out["min_qty"] = max(out["min_qty"],
                                             float(f.get("minQty", 0) or 0))
                elif f.get("filterType") in ("MIN_NOTIONAL", "NOTIONAL"):
                    out["min_notional"] = max(
                        out["min_notional"],
                        float(f.get("minNotional", 0) or f.get("notional", 0) or 0))
        self._filters[symbol] = out
        self._filters_ts[symbol] = now
        return out

    def market_buy(self, symbol: str, quote_qty: float) -> dict:
        return self._request("POST", "/api/v3/order", {
            "symbol": symbol, "side": "BUY", "type": "MARKET",
            "quoteOrderQty": f"{quote_qty:.2f}",
            "newClientOrderId": f"pb-{int(time.time() * 1000)}",
        }, signed=True)

    def market_sell(self, symbol: str, qty: float, step: float) -> dict:
        precision = _step_precision(step)
        return self._request("POST", "/api/v3/order", {
            "symbol": symbol, "side": "SELL", "type": "MARKET",
            "quantity": f"{qty:.{precision}f}",
            "newClientOrderId": f"pb-{int(time.time() * 1000)}",
        }, signed=True)


def _step_precision(step: float) -> int:
    """stepSize (ör. 0.00100000) → ondalık basamak sayısı."""
    if step <= 0:
        return 8
    s = f"{step:.8f}".rstrip("0")
    if "." in s:
        return min(8, len(s.split(".")[1]))
    return 0


def _round_step(qty: float, step: float) -> float:
    """Miktarı aşağı (asla bakiye aşılmasın) LOT_SIZE adımına yuvarlar."""
    if step <= 0:
        return qty
    precision = _step_precision(step)
    units = math.floor(qty / step + 1e-9)
    return round(units * step, precision)


# ======================================================== yürütme sağlayıcısı
class BinanceExecutionProvider(ExecutionProvider):
    """Gerçek Binance spot emirleri (piyasa emirleri)."""

    name = "binance"

    def __init__(self, client: BinanceClient):
        self.client = client

    @classmethod
    def from_cfg(cls, cfg: AppConfig) -> "BinanceExecutionProvider":
        if not cfg.binance_api_key or not cfg.binance_api_secret:
            raise ExecutionDisabled(
                "Binance API anahtarı eksik (.env: BINANCE_API_KEY / "
                "BINANCE_API_SECRET)")
        return cls(BinanceClient(cfg.binance_api_key, cfg.binance_api_secret,
                                 testnet=cfg.binance_testnet,
                                 timeout=cfg.http_timeout))

    # -------------------------------------------------------------- yardımcılar
    def quote_balance(self) -> float:
        """Kullanılabilir USDT — motor her çevrimde nakiti bununla eşitler."""
        return self.client.usdt_free()

    def _guard(self, cfg: AppConfig) -> None:
        """Çift emniyet kilidi: mod live değilse asla emir gitmez."""
        if str(cfg.trading_mode).lower() != "live" or not cfg.live_trading_enabled:
            raise ExecutionDisabled(
                "Canlı işlem modu kapalı (TRADING_MODE / LIVE_TRADING_ENABLED)")

    def execute(self, side: str, symbol: str, market_price: float,
                qty: float, cfg: AppConfig) -> Fill:
        try:
            self._guard(cfg)
            if market_price <= 0:
                return Fill(False, reason="geçersiz piyasa fiyatı")
            if side == "buy":
                return self._buy(symbol, market_price, qty, cfg)
            return self._sell(symbol, market_price, qty, cfg)
        except ExecutionDisabled:
            raise
        except BinanceApiError as e:
            log.warning("Binance emri başarısız %s %s: %s", side, symbol, e)
            return Fill(False, reason=f"Binance hatası: {e}")
        except Exception as e:  # noqa: BLE001 — asla çevrimi çökertme
            log.exception("Binance beklenmeyen hatası %s %s", side, symbol)
            return Fill(False, reason=f"beklenmeyen hata: {e}")

    # ---------------------------------------------------------------- alım/satım
    def _buy(self, symbol: str, price: float, qty: float, cfg: AppConfig) -> Fill:
        notional = qty * price
        filters = self.client.symbol_filters(symbol)
        min_notional = max(cfg.min_notional, filters["min_notional"])
        if notional < min_notional:
            return Fill(False, reason=f"min tutar altında ({notional:.2f} < {min_notional:.2f} USDT)")
        quote = math.floor(notional * 100) / 100          # cent hassasiyeti
        if quote < filters["min_notional"]:
            return Fill(False, reason=f"borsa min notional altında ({quote:.2f} USDT)")
        resp = self.client.market_buy(symbol, quote)
        return self._fill_from_order(resp, "buy", symbol, price, cfg)

    def _sell(self, symbol: str, price: float, qty: float, cfg: AppConfig) -> Fill:
        filters = self.client.symbol_filters(symbol)
        avail = self.client.base_free(symbol)
        target = min(qty, avail)
        qty_r = _round_step(target, filters["step"])
        if qty_r <= 0:
            return Fill(False, reason=f"bakiye/miktar yetersiz ({avail:.8g} mevcut)")
        if qty_r * price < max(cfg.min_notional, filters["min_notional"]):
            return Fill(False, reason=f"min tutar altında ({qty_r * price:.2f} USDT)")
        resp = self.client.market_sell(symbol, qty_r, filters["step"])
        return self._fill_from_order(resp, "sell", symbol, price, cfg)

    def _fill_from_order(self, resp: dict, side: str, symbol: str,
                         market_price: float, cfg: AppConfig) -> Fill:
        executed = float(resp.get("executedQty") or 0)
        cumulative = float(resp.get("cummulativeQuoteQty") or 0)
        if executed <= 0 or cumulative <= 0:
            return Fill(False, reason="emir dolmadı (executedQty=0)")
        avg = cumulative / executed
        base_asset = symbol[:-4] if symbol.endswith(QUOTE_ASSET) else symbol
        fee_value = self._fee_value(resp.get("fills") or [], avg, cumulative,
                                    cfg.fee_rate, base_asset=base_asset)
        if side == "buy":
            slip = max(0.0, avg - market_price) * executed
            return Fill(True, price=avg, qty=executed, notional=cumulative,
                        fee=fee_value, gas=0.0, slippage_cost=slip,
                        cash_delta=-(cumulative + fee_value))
        slip = max(0.0, market_price - avg) * executed
        return Fill(True, price=avg, qty=executed, notional=cumulative,
                    fee=fee_value, gas=0.0, slippage_cost=slip,
                    cash_delta=cumulative - fee_value)

    @staticmethod
    def _fee_value(fills: list, avg_price: float, notional: float,
                   fallback_rate: float, base_asset: str = "") -> float:
        """fills'ten ücretin USDT karşılığı; bilinmeyen varlıkta kötümser üst sınır."""
        total = 0.0
        unknown = False
        for f in fills:
            try:
                commission = float(f.get("commission") or 0)
            except (TypeError, ValueError):
                continue
            asset = f.get("commissionAsset")
            if asset == QUOTE_ASSET:
                total += commission
            elif asset and base_asset and asset == base_asset:
                total += commission * avg_price
            elif commission > 0:
                unknown = True                       # BNB vb. — değeri bilinmiyor
        if unknown:
            total = max(total, notional * fallback_rate)  # kötü senaryo (%0.12)
        return total
