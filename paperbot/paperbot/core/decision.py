"""Karar motoru: katman skorlarını ağırlıklı birleştirir, gerekçe üretir.

Faz 1: kural tabanlı (deterministik, test edilebilir).
Faz 1.5+: aynı `Decider` arayüzüne LLM uygulaması bağlanabilir
(OPENAI_API_KEY girildiğinde gerekçe LLM ile zenginleştirilir).

Kurallar (gereksinim §4):
- Risk skoru eşiğin altındaysa diğer skorlar ne olursa olsun İŞLEM YOK.
- Akıllı para (onchain) sinyali tek başına giriş yaptıramaz; teknik ve
  en az `confirmations_required` sayıda katman teyidi gerekir.
- Her karar için gerekçe + güven + olasılık aralığı + riskler üretilir.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field, asdict

from ..config import AppConfig
from .scoring import LAYER_LABELS, LAYER_ORDER

log = logging.getLogger("paperbot.decision")

STRATEGY_NAME = "multi_layer_v1"

WEIGHT_KEYS = {
    "technical": "w_technical",
    "onchain": "w_onchain",
    "defi": "w_defi",
    "risk": "w_risk",
    "sentiment": "w_sentiment",
    "macro": "w_macro",
}

# Teyit sayılır katmanlar (risk hariç; teknik zaten ayrı şart)
CONFIRMATION_LAYERS = ["onchain", "defi", "sentiment", "macro", "technical"]


@dataclass
class Decision:
    symbol: str
    action: str                     # open | exit | hold | risk_block
    strategy: str = STRATEGY_NAME
    final_score: float = 0.0
    confidence: float = 0.0         # 0..1
    probability: float = 0.0        # girişin başarılı olma olasılığı (0..1)
    prob_low: float = 0.0
    prob_high: float = 0.0
    risk_level: str = ""
    layer_scores: dict = field(default_factory=dict)
    layer_contributions: dict = field(default_factory=dict)
    details: dict = field(default_factory=dict)
    confirmations: int = 0
    rationale: str = ""
    skip_reason: str = ""           # motor doldurur (ör. maks pozisyon)
    executed: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


def risk_level_of(risk_score: float) -> str:
    if risk_score < 40:
        return "KRİTİK"
    if risk_score < 60:
        return "YÜKSEK"
    if risk_score < 75:
        return "ORTA"
    return "DÜŞÜK"


def _route_tr(route: str) -> str:
    """DeFi rota etiketi → Türkçe."""
    return {"protocol": "protokol", "chain": "zincir"}.get(route, route)


class RuleBasedDecider:
    """Ağırlıklı skor birleştirmesi + şablon gerekçe."""

    def __init__(self, cfg: AppConfig):
        self.cfg = cfg

    # ---------------------------------------------------------------- karar
    def decide(self, symbol: str, scores: dict, context: dict | None = None) -> Decision:
        cfg = self.cfg
        context = context or {}
        # scores: dict[str, LayerScore | float | None]
        layer_scores: dict[str, float] = {}
        details = {}
        sources = {}
        for k in LAYER_ORDER:
            v = scores.get(k)
            if v is None:
                layer_scores[k] = 50.0
                details[k] = {"note": "veri yok, nötr"}
                sources[k] = "mock"
            elif isinstance(v, (int, float)):
                layer_scores[k] = float(v)
                details[k] = {}
                sources[k] = "unknown"
            else:
                layer_scores[k] = float(v.score)
                details[k] = getattr(v, "details", {}) or {}
                sources[k] = getattr(v, "source", "mock")

        risk_score = layer_scores["risk"]
        risk_level = risk_level_of(risk_score)

        # normalize ağırlıklar
        weights = {k: max(0.0, float(getattr(cfg, WEIGHT_KEYS[k]))) for k in LAYER_ORDER}
        wsum = sum(weights.values()) or 1.0
        weights = {k: v / wsum for k, v in weights.items()}

        contributions = {k: weights[k] * layer_scores[k] for k in LAYER_ORDER}
        final_score = sum(contributions.values())

        confirmations = sum(
            1 for k in CONFIRMATION_LAYERS if layer_scores[k] >= cfg.confirmation_score
        )
        technical_ok = layer_scores["technical"] >= cfg.technical_min
        risk_ok = risk_score >= cfg.risk_min_score

        # ---- ZORUNLU RİSK FİLTRESİ: diğer skorlar ne olursa olsun giriş yok
        if not risk_ok:
            action = "risk_block"
        elif final_score >= cfg.entry_threshold and technical_ok \
                and confirmations >= cfg.confirmations_required:
            action = "open"
        elif context.get("has_position") and final_score < cfg.exit_threshold:
            action = "exit"
        else:
            action = "hold"

        confidence = self._confidence(final_score, layer_scores, risk_score)
        probability, p_low, p_high = self._probability(final_score, confidence)
        vol = details.get("technical", {}).get("vol_pct", 2.0)

        d = Decision(
            symbol=symbol, action=action, final_score=round(final_score, 2),
            confidence=round(confidence, 3), probability=round(probability, 3),
            prob_low=round(p_low, 3), prob_high=round(p_high, 3),
            risk_level=risk_level, layer_scores=layer_scores,
            layer_contributions={k: round(v, 2) for k, v in contributions.items()},
            details=details, confirmations=confirmations,
        )
        d.rationale = self._rationale(d, weights, sources, vol, context)
        return d

    # -------------------------------------------------------------- yardımcı
    @staticmethod
    def _confidence(final: float, scores: dict, risk: float) -> float:
        agreement = 100.0 - _std(list(scores.values())) * 2.2   # skorlar ne kadar yakınsa o kadar yüksek
        agreement = max(0.0, min(100.0, agreement))
        base = max(0.0, min(100.0, final))
        raw = 0.45 * (base / 100.0) + 0.30 * (agreement / 100.0) + 0.25 * (risk / 100.0)
        return max(0.05, min(0.95, raw))

    @staticmethod
    def _probability(final: float, confidence: float) -> tuple[float, float, float]:
        # Skordan olasılığa sigmoid benzeri haritalama; kesinlik değil aralık verilir
        p = 1.0 / (1.0 + math.exp(-(final - 55.0) / 12.0))     # 0..1
        p = 0.5 * p + 0.5 * confidence                          # güvenle harmanla
        spread = 0.06 + 0.22 * (1.0 - confidence)               # güven düşükse aralık geniş
        return (round(p, 3), round(max(0.02, p - spread), 3),
                round(min(0.98, p + spread), 3))

    def _rationale(self, d: Decision, weights: dict, sources: dict,
                   vol: float, context: dict) -> str:
        cfg = self.cfg
        label = {"open": "GİRİŞ", "exit": "ÇIKIŞ", "risk_block": "RİSK BLOĞU",
                 "hold": "BEKLEME"}[d.action]
        ranked = sorted(d.layer_contributions.items(), key=lambda x: -x[1])
        top = ", ".join(
            f"{LAYER_LABELS[k]} {d.layer_scores[k]:.0f} (+{v:.1f} puan, %{weights[k]*100:.0f} ağırlık)"
            for k, v in ranked[:3]
        )
        layer_bits = " | ".join(
            f"{LAYER_LABELS[k]}: {d.layer_scores[k]:.0f}"
            f"{' [mock]' if sources.get(k) == 'mock' else ''}"
            f"{' [na]' if sources.get(k) == 'na' else ''}"
            for k in LAYER_ORDER
        )

        lines = [
            f"[{d.strategy}] {d.symbol} — NİHAİ SKOR {d.final_score:.1f}/100 ({label})",
            f"Risk seviyesi: {d.risk_level} · Güven: %{d.confidence*100:.0f} · "
            f"Başarı olasılığı: %{d.probability*100:.0f} (aralık %{d.prob_low*100:.0f}–%{d.prob_high*100:.0f})",
            f"Katmanlar: {layer_bits}",
            f"En çok katkı: {top}",
            f"Teyit: {d.confirmations}/{len(CONFIRMATION_LAYERS)} katman "
            f"{cfg.confirmation_score:.0f} üstü (giriş için en az {cfg.confirmations_required} gerekli); "
            f"teknik {d.layer_scores['technical']:.0f} ≥ {cfg.technical_min:.0f} şartı: "
            f"{'evet' if d.layer_scores['technical'] >= cfg.technical_min else 'hayır'}",
        ]

        if d.action == "risk_block":
            lines.append(
                f"GEREKÇE: Güvenlik skoru {d.layer_scores['risk']:.0f} < eşik "
                f"{cfg.risk_min_score:.0f} — RİSK FİLTRESİ uygulandı; diğer katmanlar "
                f"ne olursa olsun işlem AÇILMADI ve varlık 'riskli' işaretlendi."
            )
        elif d.action == "open":
            lines.append(
                f"GEREKÇE: Nihai skor {d.final_score:.0f} ≥ {cfg.entry_threshold:.0f}, "
                f"teknik teyit ve {d.confirmations} katman onayı sağlandı. "
                f"Akıllı para/on-chain sinyali tek başına yeterli değil; risk ve teknik "
                f"teyidiyle birleştiği için giriş üretildi."
            )
            sl_tp = (f"SL %{cfg.stop_loss_pct*100:.0f} / "
                     f"TP %{cfg.take_profit_pct*100:.0f}")
            if getattr(cfg, "adaptive_tp", False):
                sl_tp += (" (taban — girişte Akıllı TP/SL ile volatilite/güven/"
                          "balina/risk'e göre kesinleşir)")
            lines.append(
                f"Pozisyon: sermayenin %{cfg.max_position_pct*100:.0f}'i, "
                f"{sl_tp}; "
                f"maks {cfg.max_open_positions} eşzamanlı pozisyon."
            )
        elif d.action == "exit":
            lines.append(
                f"GEREKÇE: Nihai skor {d.final_score:.0f} < çıkış eşiği "
                f"{cfg.exit_threshold:.0f} — momentum zayıfladı, pozisyon kapatılıyor."
            )
        else:
            lines.append(
                f"GEREKÇE: Skor {d.final_score:.0f} giriş eşiğinin "
                f"{'üstünde' if d.final_score >= cfg.entry_threshold else 'altında'} "
                f"ama teyit/teknik şartları tamamlanmadı — işlem yok, izleniyor."
            )

        risks = [
            f"volatilite ~%{vol:.1f}/gün → pozisyon başına beklenen bant "
            f"±%{vol*2:.1f} (1σ, ~2 gün)",
            f"günlük zarar limiti %{cfg.daily_max_loss_pct*100:.0f} (aşılırsa yeni işlem durur)",
            f"işlem maliyeti round-trip ~%"
            f"{(cfg.fee_rate*2 + cfg.slippage_rate*2)*100 + cfg.gas_per_trade:.1f}"
            f" (komisyon+slippage+gas)",
        ]

        # --- Akıllı para kanıtı (Faz 2): hangi cüzdanlar etkili oldu?
        sm = (d.details.get("onchain") or {}).get("smart_money") or {}
        # verdict yoksa (eski kayıt/örnek) güçlü/birikim bilgisinden türet
        verdict = sm.get("verdict") or (
            "accumulation"
            if sm.get("strong") or sm.get("distinct_accumulators", 0) > 0
            else "flat")
        if sm.get("evidence"):
            bits = []
            for e in sm["evidence"][:4]:
                hr = (f"isabet %{e['hit_rate']*100:.0f}" if e.get("hit_rate") is not None
                      else "isabet verisi yok")
                yon = "birikim" if float(e.get("net_usd") or 0) >= 0 else "azaltım"
                bits.append(f"{e['label']} [{e['type']}] {e['net_usd']:+,.0f}$ ({yon}, "
                            f"{hr}, ağırlık {e.get('weight', 1.0):.1f}x)")
            window = sm.get("window_days", 7)
            distinct = int(sm.get("distinct_accumulators", 0))
            if verdict == "distribution":
                head = (f"DAĞITIM — nitelikli cüzdanlar son {window} günde net "
                        f"AZALTTI → negatif sinyal, temkinli yaklaş")
            elif verdict in ("no_data", "flat"):
                head = (f"pencerede (son {window} gün) anlamlı net hareket yok → "
                        f"skor diğer katmanlara dayanıyor")
            elif distinct >= 2:
                head = (f"{distinct} cüzdan son {window} günde net biriktirdi → "
                        f"GÜÇLÜ — birden fazla bağımsız cüzdan biriktiriyor")
            elif distinct == 1:
                head = ("1 cüzdan son {} günde net biriktirdi → ZAYIF — TEK cüzdan; "
                        "teknik+risk teyidi olmadan yetersiz".format(window))
            else:
                head = (f"toplam net birikim var ama tekil cüzdan eşiği aşılmadı "
                        f"(son {window} gün) → ZAYIF sinyal")
            lines.append(
                f"Akıllı para kanıtı: {head}: " + "; ".join(bits) + "."
            )
            if sm.get("excluded"):
                lines.append(
                    "Hariç tutulanlar (akıllı para sayılmadı): "
                    + "; ".join(f"{x['label']} [{x['type']}]" for x in sm["excluded"][:4])
                    + "."
                )
        elif d.details.get("onchain"):
            lines.append("Akıllı para kanıtı: sinyal penceresinde izlenen cüzdan "
                         "birikimi yok — skor ağırlıklı diğer katmanlara dayanıyor.")

        # --- Güvenlik kanıtı (Faz 4): risk katmanı bileşen özetleri
        rk = d.details.get("risk") or {}
        comps = rk.get("components") or {}
        if comps:
            order = [("exploit", "Saldırı geçmişi"), ("contract", "Kontrat"),
                     ("audit", "Denetim"), ("maturity", "Protokol yaşı")]
            bits = []
            for key, label in order:
                c = comps.get(key)
                if not c:
                    continue
                suffix = ("" if c.get("source") == "live"
                          else f" [{c.get('source', 'mock')}]")
                bits.append(f"{label}: {c.get('summary', '')}{suffix}")
            if bits:
                line = "Güvenlik kanıtı: " + " | ".join(bits) + "."
                cap = rk.get("critical_cap")
                if cap is not None:
                    line += (f" KRİTİK TESPİT → nihai skor {cap:.0f}'e "
                             f"tavanlandı (risk veto eşiği altında).")
                lines.append(line)

        # --- DeFi kanıtı (Faz 3): defi katmanı bileşen özetleri
        dv = d.details.get("defi") or {}
        dcomps = dv.get("components") or {}
        if dcomps:
            dorder = [("trend", "TVL trendi"), ("depth", "TVL derinliği"),
                      ("fees", "Ücret geliri"), ("yield", "APY getirisi")]
            dbits = []
            for key, dlabel in dorder:
                c = dcomps.get(key)
                if not c:
                    continue
                suffix = ("" if c.get("source") == "live"
                          else f" [{c.get('source', 'mock')}]")
                dbits.append(f"{dlabel}: {c.get('summary', '')}{suffix}")
            if dbits:
                dsummary = dv.get("metrics") or {}
                head = ""
                if dsummary.get("route"):
                    rname = (dsummary.get("name")
                             or dsummary.get("protocol") or "?")
                    head = (f"{_route_tr(dsummary['route'])} eşleşmesi: "
                            f"{rname}; ")
                lines.append("DeFi kanıtı: " + head + " | ".join(dbits) + ".")

        # --- Duygu kanıtı (Faz 5): duygu katmanı bileşen özetleri
        sv = d.details.get("sentiment") or {}
        scomps = sv.get("components") or {}
        if scomps:
            sorder = [("fng", "Piyasa korku/açgözlülük"), ("news", "Haber akışı"),
                      ("attention", "Dikkat (trend)")]
            sbits = []
            for key, slabel in sorder:
                c = scomps.get(key)
                if not c:
                    continue
                suffix = ("" if c.get("source") == "live"
                          else f" [{c.get('source', 'mock')}]")
                sbits.append(f"{slabel}: {c.get('summary', '')}{suffix}")
            if sbits:
                lines.append("Duygu kanıtı: " + " | ".join(sbits) + ".")

        # --- Makro kanıtı (Faz 6): makro katmanı bileşen özetleri
        mv = d.details.get("macro") or {}
        mcomps = mv.get("components") or {}
        if mcomps:
            morder = [("liquidity", "Likidite (stablecoin arzı)"),
                      ("market", "Piyasa momentumu"),
                      ("dominance", "BTC dominansı"), ("usd", "Dolar gücü")]
            mbits = []
            for key, mlabel in morder:
                c = mcomps.get(key)
                if not c:
                    continue
                suffix = ("" if c.get("source") == "live"
                          else f" [{c.get('source', 'mock')}]")
                mbits.append(f"{mlabel}: {c.get('summary', '')}{suffix}")
            if mbits:
                lines.append("Makro kanıtı: " + " | ".join(mbits) + ".")

        if sources.get("onchain") == "mock":
            risks.append("on-chain/akıllı para katmanı ŞİMDİLİK MOCK kaynakla "
                         "çalışıyor (ETHERSCAN_API_KEY girilince canlı cüzdan "
                         "verisine geçer)")
        if sources.get("risk") == "mock":
            risks.append("risk/güvenlik katmanı MOCK veri — RISK_SOURCE=auto ile "
                         "DefiLlama+GoPlus (anahtarsız) canlı veriye bağlanır")
        if sources.get("defi") == "mock":
            risks.append("DeFi metrikleri katmanı MOCK veri — DEFI_SOURCE=auto "
                         "ile DefiLlama (anahtarsız) canlı TVL/ücret/APY'ye "
                         "bağlanır")
        if sources.get("sentiment") == "mock":
            risks.append("duygu/haber katmanı MOCK veri — SENTIMENT_SOURCE=auto "
                         "ile Google News + Korku&Açgözlülük + CoinGecko trend "
                         "(tamamı anahtarsız) canlı veriye bağlanır")
        if sources.get("macro") == "mock":
            risks.append("makro katmanı MOCK veri — MACRO_SOURCE=auto ile "
                         "CoinGecko piyasa/dominans + stablecoin arzı + ECB "
                         "dolar gücü (tamamı anahtarsız) canlı veriye bağlanır")
        if d.action in ("open", "exit"):
            risks.append("bu sanal işlem sonucu gelecekteki garantisi değildir; "
                         "olasılıklar istatistiktir, kesin tahmin değildir")
        lines.append("Riskler: " + "; ".join(risks) + ".")
        return "\n".join(lines)

    # ----------------------------------------------------------------- LLM
    def refine_with_llm(self, d: Decision) -> Decision:
        """LLM ile gerekçe zenginleştirme.

        Zincir: OpenCode köprüsü (LLM_BRIDGE=opencode — ücretsiz/sınırsız
        sağlayıcılar) → OpenAI (anahtar varsa) → şablon. Hiçbiri çalışmazsa
        karar asla etkilenmez, şablon gerekçe kalır.
        """
        cfg = self.cfg
        use_bridge = (getattr(cfg, "llm_bridge", "") or "").strip().lower() == "opencode"
        use_openai = bool(getattr(cfg, "openai_api_key", ""))
        if not (use_bridge or use_openai):
            return d
        prompt = (
            "Sen kripto paper-trading karar açıklaması üreten bir assistantsın. "
            "Aşağıdaki verileri kullanarak 4-6 cümlelik, Türkçe, olasılık dilinde "
            "(kesinlik iddiası içermeyen) bir karar gerekçesi yaz. "
            "Yatırım tavsiyesi verme, sanal test olduğunu belirt.\n\n"
            f"Varlık: {d.symbol}\nAksiyon: {d.action}\nNihai skor: {d.final_score}\n"
            f"Risk skoru: {d.layer_scores.get('risk')}\nKatman skorları: {d.layer_scores}\n"
            f"Güven: {d.confidence}\nOlasılık aralığı: %{d.prob_low*100:.0f}-%{d.prob_high*100:.0f}\n"
            f"Şablon gerekçe:\n{d.rationale}"
        )

        if use_bridge:
            from paperbot.core.llm import generate_text
            text = generate_text(prompt, cfg)
            if text:
                d.rationale = d.rationale + "\n\n[LLM yorumu]\n" + text
                d.details["llm"] = True
                d.details["llm_source"] = f"opencode/{cfg.llm_provider}/{cfg.llm_model}"
                return d
            log.warning("OpenCode LLM köprüsü başarısız — %s",
                        "OpenAI'ye düşülüyor" if use_openai else "şablon kullanılacak")

        if use_openai:
            try:
                import httpx
                resp = httpx.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {cfg.openai_api_key}"},
                    json={
                        "model": cfg.openai_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.4, "max_tokens": 400,
                    },
                    timeout=20.0,
                )
                if resp.status_code == 200:
                    text = resp.json()["choices"][0]["message"]["content"].strip()
                    if text:
                        d.rationale = d.rationale + "\n\n[LLM yorumu]\n" + text
                        d.details["llm"] = True
                        d.details["llm_source"] = f"openai/{cfg.openai_model}"
            except Exception as e:  # noqa: BLE001 — LLM hatası kararı etkilemez
                log.warning("LLM gerekçe üretilemedi, şablon kullanılıyor: %s", e)
        return d


def _std(vals: list[float]) -> float:
    if len(vals) < 2:
        return 0.0
    m = sum(vals) / len(vals)
    var = sum((v - m) ** 2 for v in vals) / (len(vals) - 1)
    return math.sqrt(var)


def build_decider(cfg: AppConfig) -> RuleBasedDecider:
    return RuleBasedDecider(cfg)
