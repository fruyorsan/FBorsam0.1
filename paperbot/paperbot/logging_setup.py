"""Detaylı loglama kurulumu: konsol + dönen dosya."""
from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path


def setup_logging(level: str = "INFO", log_dir: str = "logs") -> None:
    # Windows konsolu (cp1252/1254) emoji/UTF-8 karakterleri encode edemeyip
    # log'un çökmesine engel ol: stdout'u UTF-8 + 'replace' yap.
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    Path(log_dir).mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Tekrarlayan handler kurulumunu engelle (testlerde çağrı tekrarlanabilir)
    root.handlers.clear()

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    sh._name = "stream"
    root.addHandler(sh)

    fh = RotatingFileHandler(
        Path(log_dir) / "paperbot.log", maxBytes=5 * 1024 * 1024,
        backupCount=5, encoding="utf-8",
    )
    fh.setFormatter(fmt)
    root.addHandler(fh)

    # Konsol loglama hatası log'un kendisini indirmesin
    logging.raiseExceptions = False
    logging.getLogger("httpx").setLevel(logging.WARNING)
