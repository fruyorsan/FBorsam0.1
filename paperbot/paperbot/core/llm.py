"""Faz 11 — OpenCode yerel API LLM köprüsü.

OpenAI kredisi tükenmeden, kullanıcının OpenCode hesabında zaten giriş yaptığı
sağlayıcılar üzerinden (ör. Google Gemini, ücretsiz Zen modelleri) tek seferlik
metin üretimi alınır. Çağrı, opencode CLI üzerinden yapılır; CLI arka plandaki
servise kendi kimlik bilgisiyle bağlanır — Python tarafında token/anahtar
saklanmaz. CLI liste argumanıyla çağrılır (Windows quoting güvenli).
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
from pathlib import Path

from paperbot.config import AppConfig

log = logging.getLogger("paperbot.llm")

GENERATE_PATH = "/api/experimental/generate"


def find_opencode_cmd(cfg: AppConfig) -> str | None:
    """opencode CLI yolunu bul (önce .env'deki OPENCODE_CMD, sonra bilinen yerler).

    NOT: `opencode.cmd` bir batch sarmalayıcıdır; cmd.exe içinden geçen JSON'daki
    `%`/`&`/`"` karakterlerini parçalar (HTTP 400 + "not recognized" hatası).
    Bu yüzden doğrudan `opencode.exe` tercih edilir, `.cmd` yalnızca son çaredir.
    """
    if cfg.opencode_cmd:
        return cfg.opencode_cmd if Path(cfg.opencode_cmd).exists() else None
    home = Path.home()
    npm = home / "AppData" / "Roaming" / "npm"
    for cand in (
        npm / "node_modules" / "@opencode" / "cli" / "bin" / "opencode.exe",
        npm / "opencode.cmd",                       # son çare (cmd quoting riski)
        home / ".cache" / "opencode" / "bin" / "opencode.exe",
    ):
        if cand.exists():
            return str(cand)
    return shutil.which("opencode")


def _candidates(cfg: AppConfig) -> list[tuple[str, str, str]]:
    """Deneme sırası: ana model (varyantla → varyantsız) → yedek modeller."""
    out: list[tuple[str, str, str]] = []
    if cfg.llm_provider and cfg.llm_model:
        if cfg.llm_variant:
            out.append((cfg.llm_provider, cfg.llm_model, cfg.llm_variant))
        out.append((cfg.llm_provider, cfg.llm_model, ""))
    for raw in (cfg.llm_fallbacks or "").split(","):
        raw = raw.strip()
        if not raw:
            continue
        prov, mid = raw.split("/", 1) if "/" in raw else (cfg.llm_provider, raw)
        out.append((prov, mid, ""))
    seen: set[tuple[str, str, str]] = set()
    uniq = []
    for c in out:
        if c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


def generate_text(prompt: str, cfg: AppConfig) -> str | None:
    """OpenCode API'si ile metin üret; başarısızlıkta None (asla raise etmez).

    Adaylar sırayla denenir (ana model → yedek model); hiçbirinden metin
    gelmezse zincir OpenAI/şablon'a devam eder — çağrı asla çökmez.
    """
    cmd = find_opencode_cmd(cfg)
    if not cmd:
        log.warning("opencode CLI bulunamadı — LLM köprüsü devre dışı (şablon kullanılacak)")
        return None

    def _call(payload: dict) -> str | None:
        try:
            proc = subprocess.run(                           # noqa: S603
                [cmd, "api", "post", GENERATE_PATH,
                 "--data", json.dumps(payload, ensure_ascii=False)],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=cfg.llm_timeout, shell=False)
        except subprocess.TimeoutExpired:
            log.warning("LLM köprüsü zaman aşımına uğradı (%ss)", cfg.llm_timeout)
            return None
        except OSError as e:
            log.warning("LLM köprüsü çalıştırılamadı: %s", e)
            return None
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "").strip()[:300]
            log.warning("LLM köprüsü hata döndürdü: %s", detail)
            return None
        try:
            data = json.loads(proc.stdout)
            text = (((data or {}).get("data") or {}).get("text") or "").strip()
        except json.JSONDecodeError:
            log.warning("LLM köprüsü yanıtı JSON değil: %s", (proc.stdout or "")[:200])
            return None
        return text or None

    for provider, model_id, variant in _candidates(cfg):
        model: dict = {"providerID": provider, "id": model_id}
        if variant:
            model["variant"] = variant
        text = _call({"prompt": prompt, "model": model})
        if text:
            return text
        log.warning("LLM adayı başarısız: %s/%s%s — sonraki aday denenir",
                    provider, model_id, f" ({variant})" if variant else "")
    return None
