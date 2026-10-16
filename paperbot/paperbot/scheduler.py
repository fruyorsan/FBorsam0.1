"""Zamanlayıcı: belirli aralıklarla analiz+işlem çevrimini çalıştırır.

- Varsayılan her 5 dakikada bir (CYCLE_SECONDS).
- Hata olursa döngü ölmez; hata kaydedilir + bildirim gönderilir.
- Kill switch aktifken döngü çalışmaya devam eder ama motor işlem açmaz
  (panelde durum görünür); `resume` ile normal hayata dönülür.
- Günlük/haftalık özet raporlar burada tetiklenir.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

log = logging.getLogger("paperbot.scheduler")


class CycleScheduler:
    def __init__(self, ctx):
        self.ctx = ctx                    # AppContext (main.py)
        self.task: asyncio.Task | None = None
        self.running = False
        self.last_error: str = ""
        self._stop = asyncio.Event()

    async def start(self) -> None:
        self._stop.clear()
        self.task = asyncio.create_task(self._loop(), name="paperbot-cycle")
        log.info("Zamanlayıcı başlatıldı")

    async def stop(self) -> None:
        self._stop.set()
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self.running = False
        log.info("Zamanlayıcı durduruldu")

    async def _loop(self) -> None:
        while not self._stop.is_set():
            started = asyncio.get_event_loop().time()
            try:
                self.running = True
                await asyncio.to_thread(self.run_once)
                self.last_error = ""
            except Exception as e:  # noqa: BLE001 — döngü asla ölmez
                self.last_error = str(e)
                log.exception("Çevrim hatası")
                try:
                    self.ctx.notify("error", f"⚠ Sistem hatası: {e}")
                except Exception:  # noqa: BLE001
                    pass
            finally:
                self.running = False

            try:
                cfg = self.ctx.current_cfg()
                elapsed = asyncio.get_event_loop().time() - started
                delay = max(5.0, cfg.cycle_seconds - elapsed)
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    pass
            except Exception:  # noqa: BLE001
                await asyncio.sleep(30)

    def run_once(self) -> None:
        """Tek çevrim + özet rapor kontrolü (senkron; threadpool'da koşar)."""
        cfg = self.ctx.current_cfg()
        self.ctx.engine.cfg = cfg

        # Faz 2: cüzdan portföylerini tazele → farklar sinyale dönüşür
        pipe = getattr(self.ctx, "pipeline", None)
        if pipe is not None:
            try:
                pipe.refresh(cfg)
            except Exception as e:  # noqa: BLE001 — on-chain hatası döngüyü indirmez
                log.warning("On-chain tazeleme atlandı: %s", e)
            try:
                pipe.evaluate_hits(feed=self.ctx.feed)   # günde bir kez (throttle)
            except Exception as e:  # noqa: BLE001
                log.warning("İsabet değerlendirmesi atlandı: %s", e)

        result = self.ctx.engine.run_cycle()
        self._maybe_summaries(cfg, result)

    # ------------------------------------------------------------- özet raporlar
    def _maybe_summaries(self, cfg, result) -> None:
        from .db import get_state, set_state
        from .core.metrics import daily_summary, performance_report
        from .models import EquitySnapshot, Position
        from .notify import push
        from sqlalchemy import select

        now = datetime.now(timezone.utc)
        try:
            with self.ctx.session_factory() as s:
                if now.hour != cfg.summary_hour:
                    return
                today = now.strftime("%Y-%m-%d")
                if get_state(s, "last_summary_key", "") == today:
                    return
                trades = s.execute(
                    select(Position).where(Position.status == "closed")
                ).scalars().all()
                snaps = s.execute(select(EquitySnapshot)
                                  .order_by(EquitySnapshot.ts.desc()).limit(500)).scalars().all()
                snaps = list(reversed([
                    {"ts": x.ts.isoformat(), "equity": x.equity} for x in snaps
                ]))
                summ = daily_summary(
                    [{"pnl": t.pnl, "strategy": t.strategy, "layer_scores": t.layer_scores,
                      "exit_reason": t.exit_reason, "closed_at": str(t.closed_at),
                      "symbol": t.symbol,
                      "total_fees": (t.fees or 0) + (t.exit_fees or 0),
                      "total_gas": (t.gas or 0) + (t.exit_gas or 0),
                      "total_slippage": (t.slippage_cost or 0) + (t.exit_slippage or 0)}
                     for t in trades],
                    snaps, today,
                )
                set_state(s, "last_summary_key", today)
                # haftalık
                weekly_due = (now.weekday() == cfg.weekly_summary_weekday
                              and get_state(s, "last_weekly_key", "") != now.strftime("%G-W%V"))
                if weekly_due:
                    set_state(s, "last_weekly_key", now.strftime("%G-W%V"))
                s.commit()

            msg = (
                f"GÜNLÜK ÖZET {summ['day']}\n"
                f"• Gün PnL: {summ['day_pnl']:+.2f} USDT "
                f"({summ['day_start_equity']:.0f} → {summ['day_end_equity']:.0f})\n"
                f"• Kapanan işlem: {summ['trade_count']} | kazanma oranı: "
                f"%{summ['win_rate']*100:.0f}\n"
                f"• İşlem PnL toplam: {summ['total_pnl']:+.2f} USDT | "
                f"komisyon {summ['total_fees']:.2f}, gas {summ['total_gas']:.2f}"
            )
            push(self.ctx.session_factory, self.ctx.notifier, "daily_summary", msg)

            if weekly_due:
                rep = performance_report(trades, snaps, cfg.cycle_seconds)
                o = rep["overall"]
                push(self.ctx.session_factory, self.ctx.notifier, "weekly_summary",
                     f"HAFTALIK ÖZET\n• Toplam PnL: {o['total_pnl']:+.2f} USDT | "
                     f"isabet %{o['win_rate']*100:.0f} | işlem {o['trade_count']}\n"
                     f"• MaxDD %{o['max_drawdown']*100:.1f} | Sharpe {o['sharpe']}")
        except Exception as e:  # noqa: BLE001 — özet hatası çevrimi indirmez
            log.warning("Özet rapor hatası: %s", e)
