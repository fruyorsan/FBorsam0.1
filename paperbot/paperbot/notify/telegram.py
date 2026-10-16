"""Bildirimler: Telegram (opsiyonel) + kalıcı bildirim kaydı.

Kural: TELEGRAM_BOT_TOKEN yoksa sistem HATA VERMEZ — bildirim log dosyasına
ve veritabanındaki bildirim listesine (panelden görünür) yazılır.
"""
from __future__ import annotations

import logging

log = logging.getLogger("paperbot.notify")

# Panelden/Telegram'dan iletilmek istenen olay türleri
TELEGRAM_KINDS = {
    "trade_open", "trade_close", "take_profit", "risk_halt",
    "kill_switch", "error", "smart_money", "daily_summary", "weekly_summary",
}


class Notifier:
    def __init__(self, cfg):
        self.cfg = cfg
        self.token = (getattr(cfg, "telegram_bot_token", "") or "").strip()
        self.chat_id = (getattr(cfg, "telegram_chat_id", "") or "").strip()
        self.enabled = bool(self.token and self.chat_id)
        if not self.enabled:
            log.info("Telegram yapılandırılmadı — bildirimler log/panel üzerinden "
                     "iletilecek (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID ekleyin).")

    def deliver(self, kind: str, message: str, log_fallback: bool = True) -> bool:
        """Telegram'a gönder; gönderilemezse logla. True = iletildi/simüle edildi."""
        if kind not in TELEGRAM_KINDS:
            return False
        if not self.enabled:
            if log_fallback:
                log.info("BİLDİRİM [%s]: %s", kind, message.replace("\n", " / "))
            return False
        try:
            import httpx
            text = f"*PaperBot [{kind}]*\n{message}"
            resp = httpx.post(
                f"https://api.telegram.org/bot{self.token}/sendMessage",
                json={"chat_id": self.chat_id, "text": text,
                      "parse_mode": "Markdown", "disable_web_page_preview": True},
                timeout=10.0,
            )
            ok = resp.status_code == 200
            if not ok:
                log.warning("Telegram hatası: HTTP %s %s", resp.status_code,
                            resp.text[:200])
            return ok
        except Exception as e:  # noqa: BLE001 — bildirim hatası sistemi indirmez
            log.warning("Telegram gönderilemedi: %s", e)
            return False


def store_notification(session_factory, kind: str, message: str,
                        delivered: bool = False) -> None:
    """Bildirimi kalıcı olarak kaydeder (panelde görünür)."""
    if session_factory is None:
        return
    from ..models import Notification
    try:
        with session_factory() as s:
            s.add(Notification(kind=kind, message=message, delivered=delivered))
            s.commit()
    except Exception as e:  # noqa: BLE001
        log.warning("Bildirim kaydedilemedi: %s", e)


def push(session_factory, notifier: Notifier | None, kind: str, message: str) -> None:
    """Kaydet + ilet (scheduler, hata, özet raporlar için)."""
    delivered = notifier.deliver(kind, message) if notifier else False
    store_notification(session_factory, kind, message, delivered=delivered)
