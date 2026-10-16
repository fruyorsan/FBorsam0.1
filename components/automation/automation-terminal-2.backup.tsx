"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import useSWR from "swr"
import {
  Play, Pause, Zap, TrendingUp, TrendingDown, ShieldCheck,
  Target, History, Sliders, DollarSign, Plus, Trash2, Bot, RotateCcw, Flame, Sparkles, Clock, CheckCircle, Key, Lock, Wallet, AlertTriangle, Eye, EyeOff, Layers, Award, ArrowUpRight, Mail, Send, Loader2, Coins, RefreshCw, Newspaper, Search, ExternalLink
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  type BotState, type Position, type ManualOrderTrigger, type TradeLog, type BinanceCredentials,
  INITIAL_BOT_STATE, DEFAULT_BOT_STRATEGY, BOT_STORAGE_KEY, WATCHED_CRYPTOS,
  validateTradeCommission
} from "@/lib/bot/engine"
import { encryptSensitive, decryptSensitive, maskSensitive } from "@/lib/crypto-security"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

/**
 * Kullanıcının kayıtlı e-postasına işlem bildirimi gönderir
 */
async function sendEmailNotification(to: string, subject: string, message: string) {
  if (!to || !to.includes("@")) return
  try {
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, message }),
    })
  } catch {}
}



const fmt = (v?: number) =>
  Number.isFinite(v)
    ? v!.toLocaleString("tr-TR", {
        minimumFractionDigits: Math.abs(v!) < 0.0001 ? 8 : Math.abs(v!) < 1 ? 4 : 2,
        maximumFractionDigits: Math.abs(v!) < 0.0001 ? 8 : Math.abs(v!) < 1 ? 6 : 2,
      })
    : "—"

const fmtCurrency = (v?: number) =>
  Number.isFinite(v)
    ? v!.toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0,00"

function calculateOpportunityScore(
  crypto: any,
  dipThreshold = 36,
  fearGreedValue = 50
): { score: number; reason: string; mode: "DIP" | "TREND" | "WATCH" } {
  let score = 0
  let mode: "DIP" | "TREND" | "WATCH" = "WATCH"
  const reasons: string[] = []

  const rsi = crypto.rsi ?? 50
  const hasAlSignal = (crypto.signal && crypto.signal.includes("AL")) || (crypto.proposal && crypto.proposal.side === "BUY")
  const isStrongBuy = crypto.signal === "GÜÇLÜ AL"
  const aboveSma = crypto.price > crypto.sma
  const macdOk = crypto.macd !== undefined && crypto.macdSignal !== undefined ? crypto.macd > crypto.macdSignal : true
  const volumeSpike = crypto.volumeRatio && crypto.volumeRatio >= 1.2
  const volumeOk = crypto.volumeRatio && crypto.volumeRatio >= 1.05
  const change24h = typeof crypto.change24h === "number" ? crypto.change24h : (crypto.change ?? 0)
  const isExtremeFear = fearGreedValue <= 25

  // ⚠️ KESİN KURAL 0 (FOMO & YEŞİL MUM ŞİŞMESİ ENGELİ):
  // Son 5 dakikada %0.4'ten fazla fırlamış veya mum tepesinde koşan coinleri (FOMO) ASLA alma!
  const candle5mChange = typeof crypto.change === "number" ? crypto.change : 0
  if (candle5mChange > 0.4) {
    return { score: 0, reason: "5d Yeşil Mum Şişmesi (FOMO / Tepe Tuzağı Engeli)", mode: "WATCH" }
  }

  // ⚠️ KESİN KURAL 1: Aşırı alım veya şişmiş bölgede (RSI >= 58) olan coinleri ASLA alma! (Tepe alımı / tuzak engeli)
  if (rsi >= 58) {
    return { score: 0, reason: "Aşırı Şişmiş RSI (Tepe Riski)", mode: "WATCH" }
  }

  // ⚠️ KESİN KURAL 2 (BÜYÜK RESİM): 24 saatlikte aşırı pompalanmış (+%18 üzeri) coinleri alma!
  if (change24h > 18) {
    return { score: 0, reason: "24s Aşırı Pompalanmış (Düzeltme Riski)", mode: "WATCH" }
  }

  // ⚠️ KESİN KURAL 3 (DÜŞEN BIÇAK): 24 saatlikte ağır çöküş (-%8 ve altı) yaşayan coinde sadece derin RSI dipte girilir
  if (change24h < -8 && rsi > 30) {
    return { score: 0, reason: "24s Sert Düşüş (Düşen Bıçak Koruması)", mode: "WATCH" }
  }

  // ⚠️ KESİN KURAL 4 (1 AYLIK MAKRO TEPE DİRENÇ ENGELİ):
  // Son 30 günün tepe noktasının %85 ve üzerinde olan coinleri alma! (Tepe alımı / FOMO engeli)
  if (crypto.monthlyRangePos !== undefined && crypto.monthlyRangePos > 85 && rsi >= 50) {
    return { score: 0, reason: "Aylık Tepe Direnci (FOMO Engeli)", mode: "WATCH" }
  }

  // ⚠️ KESİN KURAL 5 (1 AYLIK & 1 HAFTALIK SERBEST ÇÖKÜŞ ENGELİ):
  // Hem aylıkta (-%25 altı) hem haftalıkta (-%8 altı) kan kaybeden coinleri (sağlam dip teyidi yoksa) alma!
  if (crypto.change1m !== undefined && crypto.change1m < -25 && crypto.change1w !== undefined && crypto.change1w < -8 && rsi > 30) {
    return { score: 0, reason: "Aylık & Haftalık Serbest Düşüş", mode: "WATCH" }
  }

  // ⚠️ KESİN KURAL 6 (1 SAATLİK BÜYÜK RESİM & AYI TUZAĞI ENGELİ):
  // 1 saatlik grafikte düşüş trendinde olan (isBearish) veya yükseliş teyidi olmayan (!isBullish) coinler KESİNLİKLE ALINMAZ!
  // 5 dakikalık grafik ufacık bir yeşil yaksa bile, 1 saatlikte düşen bıçak asla tutulmaz!
  if (crypto.tech1h && (crypto.tech1h.isBearish || !crypto.tech1h.isBullish)) {
    return { score: 0, reason: "1 Saatlik Düşüş Trendi (Ayı / Düşen Bıçak Engeli)", mode: "WATCH" }
  }

  // ⚠️ KESİN KURAL 7 (SIĞ TAHTA & YÜKSEK SPREAD / MAKAS ENGELİ):
  // Binance TR'de 24 saatlik hacmi sığ (< 1.500.000 TL) olan tahtalarda alış-satış makası %1'e varır.
  // Piyasa emriyle girildiğinde 15-30 TL anında makasa gider. Sadece likit tahtaları al!
  if (crypto.quoteVolume24h !== undefined && crypto.quoteVolume24h < 1500000) {
    return { score: 0, reason: "Sığ Tahta / Yüksek Makas Riski (<1.5M ₺ Hacim)", mode: "WATCH" }
  }

  // ── MOD 1: AKILLI DİP AVCISI (Oversold Dip Reversal) ──
  const bollingerDip = crypto.bollinger !== undefined && crypto.bollinger <= 28
  const stochDip = crypto.stochastic !== undefined && crypto.stochastic <= 28

  if (rsi <= 30 && (bollingerDip || stochDip)) {
    score += 55
    mode = "DIP"
    reasons.push(`🎯 Keskin Dip (RSI ${rsi.toFixed(1)}${bollingerDip ? " + Alt Bant" : ""}${stochDip ? " + Stoch Dip" : ""})`)
  } else if (rsi <= dipThreshold && (bollingerDip || stochDip)) {
    score += 45
    mode = "DIP"
    reasons.push(`🔴 Teyitli Dip (RSI ${rsi.toFixed(1)})`)
  }

  // ── MOD 2: YÜKSELİŞ TRENDİNDE SAĞLIKLI DÜZELTME ALIMI (Pullback in Uptrend) ──
  // Koşan yeşil tepeyi DEĞİL, 24 saatlikte yükselen coinin 5 dakikalık grafikteki kırmızı/soğuma anını yakala!
  const isPullback =
    !isExtremeFear &&
    change24h >= 0.8 && change24h <= 12.0 &&
    hasAlSignal && aboveSma && macdOk &&
    rsi >= 35 && rsi <= 48 &&
    candle5mChange <= 0.1 &&
    ((crypto.stochastic !== undefined && crypto.stochastic <= 38) || (crypto.bollinger !== undefined && crypto.bollinger <= 38))

  if (isPullback) {
    score += 50
    mode = "TREND"
    reasons.push(`📈 Trend İçi Düzeltme (RSI ${rsi.toFixed(1)} + Kırmızı Mumda Dip Alımı)`)

    if (isStrongBuy) {
      score += 15
      reasons.push("⚡ Güçlü AL")
    }
  }

  // ── TEKNİK TEYİTLER & EKSTRA GÜVEN ──
  // 0. 🚀 1 SAATLİK BÜYÜK RESİM BOĞA TRENDİ BONUSU
  if (crypto.tech1h?.isBullish) {
    score += 40
    reasons.push("🚀 1 Saatlik Boğa Trend Desteği (HO20 Üstü + Pozitif Momentum)")
  }

  // 1. Hacim Teyidi: Hacim desteği olmayan hareketler boğa tuzağıdır
  if (volumeSpike) {
    score += 20
    reasons.push(`📊 ${crypto.volumeRatio.toFixed(1)}x Hacim Patlaması`)
  } else if (volumeOk) {
    score += 10
    reasons.push("📊 Hacim Desteği")
  } else if (crypto.volumeRatio && crypto.volumeRatio < 0.7) {
    score -= 25 // Hacimsiz ölü hareket cezası
  }

  // 2. Çoklu İndikatör Konsensüsü (4/6 ve üzeri yeşil)
  if (crypto.indicatorsPosCount && crypto.indicatorsPosCount >= 4) {
    score += 15
    reasons.push(`🧠 ${crypto.indicatorsPosCount}/6 İndikatör Teyidi`)
  }

  // 3. Model Güven Skoru
  const effectiveConfidence = Math.max(crypto.confidence || 0, crypto.proposal?.confidence || 0)
  if (effectiveConfidence >= 75) {
    score += 10
    reasons.push(`%${effectiveConfidence} Güven`)
  }

  // 4. Komisyon Güvenliği
  if (crypto.commissionSafe) {
    score += 5
    reasons.push("🛡️ Komisyon Güvenli")
  }

  // 5. 🌐 BÜYÜK RESİM / GELECEK MAKRO TEYİDİ (24s Trend)
  if (change24h >= 1.0 && change24h <= 10.0) {
    score += 15
    reasons.push(`🌐 24s Boğa Trendi (+%${change24h.toFixed(1)})`)
  } else if (change24h < -5.0 && rsi > 30) {
    score -= 25
  }

  // 5.1 📅 1 HAFTALIK & 1 AYLIK MAKRO TEYİT
  if (crypto.change1w !== undefined && crypto.change1w >= 1.0 && crypto.isAboveSma7) {
    score += 20
    reasons.push(`📅 1H Boğa Trendi (+%${crypto.change1w.toFixed(1)})`)
  } else if (crypto.change1w !== undefined && crypto.change1w < -6.0 && rsi > 32) {
    score -= 20
  }

  if (crypto.monthlyRangePos !== undefined && crypto.monthlyRangePos <= 35 && rsi <= 32) {
    score += 25
    reasons.push(`🎯 Aylık Dip Tabanı (%${crypto.monthlyRangePos.toFixed(0)})`)
  } else if (crypto.monthlyRangePos !== undefined && crypto.monthlyRangePos >= 80) {
    score -= 20
  }

  // 6. 📰 PİYASA DUYGUSU & HABER EĞİLİMİ
  if (fearGreedValue >= 50 && fearGreedValue <= 75) {
    score += 10
    reasons.push("📰 Boğa Duygusu Desteği")
  } else if (fearGreedValue <= 35) {
    score -= 15
  }

  // 7. 🛡️ DEV İŞLEM HACMİ & YÜKSEK LİKİDİTE (Kullanıcı İsteği: Hangisinin Hacmi & Gücü En Yüksekse O Alınsın)
  // Binance TR'de tahtası sığ coinler elenir, en büyük hacimli ve likit coinler zirveye yerleşir
  if (crypto.quoteVolume24h && crypto.quoteVolume24h >= 10000000) {
    score += 30
    reasons.push("🚀 Dev Hacim (En Güçlü Likidite)")
  } else if (crypto.quoteVolume24h && crypto.quoteVolume24h >= 3000000) {
    score += 18
    reasons.push("💧 Yüksek İşlem Hacmi")
  } else if (crypto.quoteVolume24h && crypto.quoteVolume24h < 500000) {
    score -= 25 // Sığ hacimli çöp coinleri engelle
  }

  return { score, reason: reasons.join(" + ") || "Genel İzleme", mode }
}


export function AutomationTerminal2({ onBack }: { onBack: () => void }) {
  const isPlacingOrderRef = useRef(false)
  const closingPositionIdsRef = useRef<Set<string>>(new Set())
  const [botState, setBotState] = useState<BotState>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(BOT_STORAGE_KEY)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (parsed && parsed.currency === "TRY") {
            // Otomasyon 2 DEVRE DIŞI: Yeni otomatik alım yapmaz
            parsed.active = false
            if (parsed.strategy) parsed.strategy.autoPilot = false
            const maxS = parsed.strategy?.maxConcurrentPositions || 3
            const seenSyms = new Set<string>()
            const cleanPos = Array.isArray(parsed.positions) ? parsed.positions.filter((p: Position) => {
              if (seenSyms.has(p.symbol)) return false
              seenSyms.add(p.symbol)
              return true
            }).slice(0, maxS).map((p: Position) => {
              // Sanitize legacy open positions: clamp unrealistic 5% targets to 2.4% scalp target
              const entry = p.entryPrice || p.currentPrice || 1
              const currentTpPct = ((p.takeProfitPrice - entry) / entry) * 100
              const currentSlPct = ((entry - p.stopLossPrice) / entry) * 100
              const updatedTp = (currentTpPct > 3.0 || !p.takeProfitPrice) ? entry * 1.024 : p.takeProfitPrice
              const updatedSl = (currentSlPct > 2.5 || !p.stopLossPrice) ? entry * (1 - 0.018) : p.stopLossPrice
              return {
                ...p,
                takeProfitPrice: updatedTp,
                stopLossPrice: updatedSl,
              }
            }) : []

            const strat = parsed.strategy || {}
            // Sanitize strategy parameters: clamp outdated high TP/SL values to realistic scalping targets
            const sanitizedTakeProfit = (typeof strat.defaultTakeProfitPct === "number" && strat.defaultTakeProfitPct <= 5.0 && strat.defaultTakeProfitPct >= 1.0)
              ? strat.defaultTakeProfitPct
              : DEFAULT_BOT_STRATEGY.defaultTakeProfitPct // 3.0

            const sanitizedStopLoss = (typeof strat.defaultStopLossPct === "number" && strat.defaultStopLossPct <= 3.0 && strat.defaultStopLossPct >= 0.8)
              ? strat.defaultStopLossPct
              : DEFAULT_BOT_STRATEGY.defaultStopLossPct // 1.8

            const sanitizedBreakeven = (typeof strat.breakevenPct === "number" && strat.breakevenPct <= 3.0 && strat.breakevenPct >= 0.5)
              ? strat.breakevenPct
              : DEFAULT_BOT_STRATEGY.breakevenPct // 1.5

            const sanitizedTrailing = (typeof strat.trailingStopPct === "number" && strat.trailingStopPct <= 3.0 && strat.trailingStopPct >= 0.5)
              ? strat.trailingStopPct
              : DEFAULT_BOT_STRATEGY.trailingStopPct // 1.2

            return {
              ...parsed,
              positions: cleanPos,
              strategy: {
                ...DEFAULT_BOT_STRATEGY,
                ...strat,
                autoPilot: strat.autoPilot ?? true,
                maxConcurrentPositions: strat.maxConcurrentPositions || 3,
                autoAllocateCapital: strat.autoAllocateCapital ?? true,
                aiOpportunityRanking: true,
                dynamicSizing: strat.dynamicSizing ?? true,
                dynamicSizingAggressiveness: strat.dynamicSizingAggressiveness === "aggressive" ? "balanced" : (strat.dynamicSizingAggressiveness || "balanced"),
                memeCoinsOnly: strat.memeCoinsOnly ?? false,
                stalePositionTimeoutEnabled: true,
                stalePositionTimeoutHours: strat.stalePositionTimeoutHours || 4.0,
                btcDropProtectionEnabled: true,
                btcDropThresholdPct: -1.0,
                rsiBuyThreshold: (typeof strat.rsiBuyThreshold === "number" && strat.rsiBuyThreshold <= 70 && strat.rsiBuyThreshold >= 15) ? strat.rsiBuyThreshold : 35,
                emailNotificationsEnabled: strat.emailNotificationsEnabled ?? true,
                userNotificationEmail: strat.userNotificationEmail || "",
                multiStageTakeProfit: true,
                volumeSpikeDetection: true,
                compoundGrowth: true,
                defaultTakeProfitPct: sanitizedTakeProfit,
                defaultStopLossPct: sanitizedStopLoss,
                breakevenPct: sanitizedBreakeven,
                trailingStopPct: sanitizedTrailing,
                dailyMaxLossPct: strat.dailyMaxLossPct || 3,
                recoveryMode: strat.recoveryMode ?? true,
              }
            }
          }
        }
      } catch {}


    }
    return INITIAL_BOT_STATE
  })


  // ── Yasal Sorumluluk Reddi — bir kez gösterilir, localStorage'da hatırlanır ──
  const [disclaimerAccepted, setDisclaimerAccepted] = useState<boolean>(() => {
    if (typeof window === "undefined") return true
    return localStorage.getItem("piyasaiq:disclaimer_v1") === "accepted"
  })
  const [disclaimerChecked, setDisclaimerChecked] = useState(false)
  const [disclaimerVisible, setDisclaimerVisible] = useState(!disclaimerAccepted)

  function handleAcceptDisclaimer() {
    if (!disclaimerChecked) return
    localStorage.setItem("piyasaiq:disclaimer_v1", "accepted")
    setDisclaimerAccepted(true)
    // Fade-out animasyonu için kısa gecikme
    setTimeout(() => setDisclaimerVisible(false), 300)
  }


  useEffect(() => {
    try {
      localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(botState))
    } catch {}
  }, [botState])

  const syncStrategyToServer = (newStrategy: typeof botState.strategy) => {
    try {
      mutateServerState((prev) => prev ? { ...prev, strategy: newStrategy } : prev, false)
    } catch {}
    fetch("/api/bot/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy: newStrategy }),
    }).catch(() => {})
  }

  const applySniperSettings = () => {
    setBotState((p) => {
      const nextStrategy = {
        ...p.strategy,
        defaultTakeProfitPct: 3.5,
        defaultStopLossPct: 1.6,
        breakevenPct: 0.9,
        trailingStopPct: 0.9,
        rsiBuyThreshold: 35,
        btcDropThresholdPct: -1.0,
        maxConcurrentPositions: 1,
      }
      const next = { ...p, strategy: nextStrategy }
      try { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(next)) } catch {}
      syncStrategyToServer(nextStrategy)
      return next
    })
  }

  const applyGoldenRatioSettings = () => {
    setBotState((p) => {
      const nextStrategy = {
        ...p.strategy,
        defaultTakeProfitPct: 3.0,
        defaultStopLossPct: 1.8,
        breakevenPct: 1.0,
        trailingStopPct: 1.0,
        rsiBuyThreshold: 38,
      }
      const next = { ...p, strategy: nextStrategy }
      try { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(next)) } catch {}
      syncStrategyToServer(nextStrategy)
      return next
    })
  }

  // ── Sunucu State Senkronizasyonu (Vercel Cron ile 7/24 çalışan bot için) ──
  // Her 30 saniyede /api/bot/state'i sorgular. Sekme kapalıyken Vercel'in
  // cron'u pozisyon açmış/kapatmışsa, kullanıcı siteye girince hepsini görebilir.
  const { data: serverState, mutate: mutateServerState } = useSWR<{
    ok: boolean
    positions?: typeof botState.positions
    balance?: number
    initialBalance?: number
    logs?: typeof botState.logs
    history?: typeof botState.history
    active?: boolean
    strategy?: typeof botState.strategy
    binance?: typeof botState.binance
    fetchedAt?: number
  }>("/api/bot/state", fetcher, {
    refreshInterval: 3000,
    dedupingInterval: 1500,
    revalidateOnFocus: true,
  })

  // Sunucudan gelen state ile tarayıcı state'ini birleştir (sunucu öncelikli, çapraz cihaz senkronizasyonu)
  useEffect(() => {
    if (!serverState?.ok) return
    const serverPos = serverState.positions ?? []
    const serverHistory = serverState.history ?? []
    const serverLogs = serverState.logs ?? []
    const serverBalance = serverState.balance
    const serverBinance = (serverState as any).binance
    const serverActive = serverState.active

    setBotState((prev) => {
      const isLocalReal = Boolean(prev.binance?.connected && prev.binance?.accountType === "REAL")

      // Gerçek hesapta: Sunucu botunun pozisyonları (canlı fiyat, PnL, trailing dahil), geçmiş ve loglar doğrudan istemciye aktarılır!
      if (isLocalReal) {
        const nextActive = typeof serverActive === "boolean" ? serverActive : prev.active
        const nextBalance = typeof serverBalance === "number" ? serverBalance : prev.balanceTry
        const nextHistory = serverHistory.length >= prev.history.length ? serverHistory : prev.history
        const nextLogs = serverLogs.length > 0 ? serverLogs : prev.logs

        return {
          ...prev,
          active: nextActive,
          positions: serverPos,
          history: nextHistory,
          logs: nextLogs,
          balanceTry: nextBalance,
        }
      }

      // İstemcide hiçbir değişiklik yoksa mevcut bakiyeyi koru (sunucunun 50.000 TL varsayılanı istemciyi EZMEMELİ)
      const prevPosKey = prev.positions.map((p) => `${p.id}_${p.symbol}`).sort().join("|")
      const serverPosKey = serverPos.map((p) => `${p.id}_${p.symbol}`).sort().join("|")
      const positionsChanged = prevPosKey !== serverPosKey
      const hasNewHistory = serverHistory.length > prev.history.length
      const hasNewLogs = serverLogs.length > prev.logs.length

      if (!positionsChanged && !hasNewHistory && !hasNewLogs) return prev

      const nextPositions = positionsChanged ? serverPos : prev.positions
      const nextHistory = hasNewHistory ? serverHistory : prev.history
      const openPositionsCost = nextPositions.reduce((acc, p) => acc + (p.totalTry || 0), 0)
      const realizedPnl = nextHistory.reduce((acc, h) => acc + (h.netPnlTry ?? h.pnl ?? 0), 0)
      const initialBal = prev.initialBalanceTry || 50000
      const reconciledBalance = Math.max(0, initialBal + realizedPnl - openPositionsCost)

      return {
        ...prev,
        positions: nextPositions,
        history: nextHistory,
        logs: hasNewLogs ? [...serverLogs.slice(0, 50), ...prev.logs].slice(0, 150) : prev.logs,
        balanceTry: reconciledBalance,
        initialBalanceTry: initialBal,
      }
    })
  }, [serverState])

  // Strateji değiştiğinde sunucuya kaydet
  // DİKKAT: Gerçek hesapta pozisyonlar ve bakiye sunucu (cron) tarafından yönetilir.
  // İstemci arka plan zamanlayıcısı sunucunun gerçek pozisyon veya bakiyesini ezmez!
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/bot/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy: botState.strategy,
        }),
      }).catch(() => {})
    }, 1200)
    return () => clearTimeout(timer)
  }, [botState.strategy])

  // ── Gerçek Hesapta Canlı Binance TR Bakiyesi (her 25sn) ──────────────────
  useEffect(() => {
    const isReal = botState.binance?.connected && botState.binance?.accountType === "REAL"
    if (!isReal || !botState.binance?.apiKey || !botState.binance?.apiSecret) return
    const fetchLiveBalance = async () => {
      try {
        let rawKey = botState.binance!.apiKey
        let rawSecret = botState.binance!.apiSecret
        if (rawKey.startsWith("enc_v1:")) {
          try { rawKey = (await decryptSensitive(rawKey)) || rawKey } catch {}
        }
        if (rawSecret.startsWith("enc_v1:")) {
          try { rawSecret = (await decryptSensitive(rawSecret)) || rawSecret } catch {}
        }
        if (!rawKey || !rawSecret || rawKey.startsWith("enc_v1:") || rawSecret.startsWith("enc_v1:")) return

        const res = await fetch("/api/binance/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: rawKey,
            apiSecret: rawSecret,
            exchangeType: "BINANCE_TR",
          }),
        })
        const data = await res.json()
        if (data.ok) {
          const newFree = typeof data.freeTry === "number" ? data.freeTry : (typeof data.tryBalance === "number" ? data.tryBalance : 0)
          const newTotal = typeof data.totalTryValue === "number" ? data.totalTryValue : newFree
          const newLocked = typeof data.lockedTry === "number" ? data.lockedTry : 0
          const newCoinVal = typeof data.coinValueTry === "number" ? data.coinValueTry : 0
          const usdtFree = typeof data.usdtFree === "number" ? data.usdtFree : (data.balances?.USDT?.free || 0)
          const usdtTotal = typeof data.usdtTotal === "number" ? data.usdtTotal : (data.balances?.USDT?.total || 0)
          const usdtTryVal = typeof data.usdtTryValue === "number" ? data.usdtTryValue : 0

          if (Array.isArray(data.assetDetails)) {
            setWalletAssets(data.assetDetails)

            // Gerçek hesapta: Binance TR cüzdanında bulunmayan (veya bakiyesi 0 olan) coinlerin hayalet slotlarını temizle
            const validAssets = new Set(data.assetDetails.map((a: any) => (a.asset || "").toUpperCase()))
            setBotState((prev) => {
              const cleanedPositions = prev.positions.filter((p) => {
                if (isReal && p.isRealOrder) {
                  return validAssets.has(p.symbol.toUpperCase())
                }
                return true
              })

              const positionsWerePurged = cleanedPositions.length !== prev.positions.length
              if (positionsWerePurged) {
                fetch("/api/bot/state", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ positions: cleanedPositions, balance: newFree }),
                }).catch(() => {})
              }

              return {
                ...prev,
                positions: cleanedPositions,
                balanceTry: newFree,
                initialBalanceTry: (prev.initialBalanceTry && prev.initialBalanceTry > 0) ? prev.initialBalanceTry : newTotal,
                binance: {
                  ...prev.binance!,
                  walletTotalTry: newTotal,
                  realBalanceTry: newTotal,
                  freeTry: newFree,
                  lockedTry: newLocked,
                  coinValueTry: newCoinVal,
                  usdtFree,
                  usdtTotal,
                  usdtTryValue: usdtTryVal,
                  lastSyncTime: new Date().toLocaleTimeString("tr-TR"),
                },
              }
            })
          } else {
            setBotState((prev) => ({
              ...prev,
              balanceTry: newFree,
              initialBalanceTry: (prev.initialBalanceTry && prev.initialBalanceTry > 0) ? prev.initialBalanceTry : newTotal,
              binance: {
                ...prev.binance!,
                walletTotalTry: newTotal,
                realBalanceTry: newTotal,
                freeTry: newFree,
                lockedTry: newLocked,
                coinValueTry: newCoinVal,
                usdtFree,
                usdtTotal,
                usdtTryValue: usdtTryVal,
                lastSyncTime: new Date().toLocaleTimeString("tr-TR"),
              },
            }))
          }

          // Sunucu state'ini de güncelle ki Redis'te eski bakiye kalmasın
          fetch("/api/bot/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              balance: newFree,
              initialBalance: newTotal,
            }),
          }).catch(() => {})
        } else if (!data.ok) {
          console.warn("[LIVE BALANCE] Binance TR bakiye sorgusu:", data.message)
        }
      } catch (err) {
        console.warn("[LIVE BALANCE] Ağ hatası:", err)
      }
    }
    fetchLiveBalance()
    const interval = setInterval(fetchLiveBalance, 25000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botState.binance?.connected, botState.binance?.accountType, botState.binance?.apiKey, botState.binance?.apiSecret])

  const [activeTab, setActiveTab] = useState<"slots" | "signals" | "positions" | "news" | "triggers" | "binance" | "strategy" | "logs">("slots")
  const [newsCategory, setNewsCategory] = useState<string>("Tümü")
  const [newsSearch, setNewsSearch] = useState<string>("")
  const { data: terminalNewsData, mutate: refreshTerminalNews } = useSWR<{ ok: boolean; news: any[]; barometer: any }>("/api/news", (url: string) => fetch(url).then(r => r.json()), { refreshInterval: 60000, dedupingInterval: 20000 })
  const [showApiModal, setShowApiModal] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showModalKey, setShowModalKey] = useState(false)
  const [showModalSecret, setShowModalSecret] = useState(false)

  const [walletAssets, setWalletAssets] = useState<Array<{
    asset: string
    free: number
    total: number
    priceTry: number
    valueTry: number
    canSell: boolean
  }>>([])
  const [showWalletRecoveryModal, setShowWalletRecoveryModal] = useState(false)
  const [sellingAsset, setSellingAsset] = useState<string | null>(null)
  const [isScanningWallet, setIsScanningWallet] = useState(false)

  const [apiAccountName, setApiAccountName] = useState(botState.binance?.accountName || "Kişisel Binance Hesabım")
  const [apiKeyInput, setApiKeyInput] = useState("")
  const [apiSecretInput, setApiSecretInput] = useState("")
  const [realBalanceInput, setRealBalanceInput] = useState(botState.binance?.realBalanceTry ? String(botState.binance.realBalanceTry) : "15000")
  const [demoBalanceInput, setDemoBalanceInput] = useState(String(botState.balanceTry || 50000))
  const [accountTypeInput, setAccountTypeInput] = useState<"REAL" | "SIMULATION">(botState.binance?.accountType || "SIMULATION")

  // Binance TR Cüzdanındaki Varlıkları Anında Tara
  async function handleScanWalletAssets() {
    if (!botState.binance?.apiKey || !botState.binance?.apiSecret) {
      alert("Binance API bilgileri bulunamadı.")
      return
    }
    setIsScanningWallet(true)
    try {
      let rawKey = botState.binance.apiKey
      let rawSecret = botState.binance.apiSecret
      if (rawKey.startsWith("enc_v1:")) {
        try { rawKey = (await decryptSensitive(rawKey)) || rawKey } catch {}
      }
      if (rawSecret.startsWith("enc_v1:")) {
        try { rawSecret = (await decryptSensitive(rawSecret)) || rawSecret } catch {}
      }

      const res = await fetch("/api/binance/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: rawKey, apiSecret: rawSecret, exchangeType: "BINANCE_TR" }),
      })
      const data = await res.json()
      if (data.ok && Array.isArray(data.assetDetails)) {
        setWalletAssets(data.assetDetails)
        if (typeof data.freeTry === "number") {
          setBotState((prev) => ({
            ...prev,
            balanceTry: data.freeTry,
            binance: prev.binance ? { ...prev.binance, walletTotalTry: data.totalTryValue, realBalanceTry: data.totalTryValue } : prev.binance,
          }))
          fetch("/api/bot/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ balance: data.freeTry, initialBalance: data.totalTryValue }),
          }).catch(() => {})
        }
      } else {
        alert("Cüzdan taranamadı: " + (data.message || "Bilinmeyen hata"))
      }
    } catch (e: any) {
      alert("Bağlantı hatası: " + (e?.message || e))
    } finally {
      setIsScanningWallet(false)
    }
  }

  // Kullanıcı için tek tıkla doğrudan Serbest Bakiyeyi Yenile butonu
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false)
  async function handleRefreshBalanceNow() {
    setIsRefreshingBalance(true)
    try {
      if (!isRealAccount) {
        // Sanal Demo Modunda: Bakiye ve portföy eşitlemesi yap
        const openPositionsCost = botState.positions.reduce((acc, p) => acc + (p.totalTry || 0), 0)
        const realizedPnl = relevantHistory.reduce((acc, h) => acc + (h.netPnlTry ?? h.pnl ?? 0), 0)
        const initialBal = botState.initialBalanceTry || 50000
        const reconciledBal = Math.max(0, initialBal + realizedPnl - openPositionsCost)

        setBotState((prev) => ({
          ...prev,
          balanceTry: reconciledBal,
        }))
        fetch("/api/bot/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ balance: reconciledBal, initialBalance: initialBal }),
        }).catch(() => {})
        addLog("INFO", `🔄 Sanal demo bakiye eşitlendi: Serbest Nakit: ${fmtCurrency(reconciledBal)} ₺ (Başlangıç: ${fmtCurrency(initialBal)} ₺, Gerçekleşen Net: ${realizedPnl >= 0 ? "+" : ""}${fmtCurrency(realizedPnl)} ₺)`)
        return
      }

      if (!botState.binance?.apiKey || !botState.binance?.apiSecret) {
        alert("Lütfen önce sağ üstteki anahtar simgesine basıp Binance TR API bilgilerinizi bağlayın.")
        setShowApiModal(true)
        return
      }
      let rawKey = botState.binance.apiKey
      let rawSecret = botState.binance.apiSecret
      if (rawKey.startsWith("enc_v1:")) {
        try { rawKey = (await decryptSensitive(rawKey)) || rawKey } catch {}
      }
      if (rawSecret.startsWith("enc_v1:")) {
        try { rawSecret = (await decryptSensitive(rawSecret)) || rawSecret } catch {}
      }
      const res = await fetch("/api/binance/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: rawKey, apiSecret: rawSecret, exchangeType: "BINANCE_TR" }),
      })
      const data = await res.json()
      if (data.ok) {
        const newFree = typeof data.freeTry === "number" ? data.freeTry : (typeof data.tryBalance === "number" ? data.tryBalance : 0)
        const newTotal = typeof data.totalTryValue === "number" ? data.totalTryValue : newFree
        const newLocked = typeof data.lockedTry === "number" ? data.lockedTry : 0
        const newCoinVal = typeof data.coinValueTry === "number" ? data.coinValueTry : 0
        const usdtFree = typeof data.usdtFree === "number" ? data.usdtFree : (data.balances?.USDT?.free || 0)
        const usdtTotal = typeof data.usdtTotal === "number" ? data.usdtTotal : (data.balances?.USDT?.total || 0)
        const usdtTryVal = typeof data.usdtTryValue === "number" ? data.usdtTryValue : 0

        if (Array.isArray(data.assetDetails)) setWalletAssets(data.assetDetails)
        setBotState((prev) => ({
          ...prev,
          balanceTry: newFree,
          binance: prev.binance ? {
            ...prev.binance,
            walletTotalTry: newTotal,
            realBalanceTry: newTotal,
            freeTry: newFree,
            lockedTry: newLocked,
            coinValueTry: newCoinVal,
            usdtFree,
            usdtTotal,
            usdtTryValue: usdtTryVal,
            lastSyncTime: new Date().toLocaleTimeString("tr-TR"),
          } : prev.binance,
        }))
        fetch("/api/bot/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ balance: newFree, initialBalance: newTotal }),
        }).catch(() => {})
        let syncLog = `🔄 Bakiye anında güncellendi: Serbest TRY: ${newFree.toFixed(2)} ₺, Toplam: ${newTotal.toFixed(2)} ₺`
        if (newLocked > 0) syncLog += `, Açık Emirde: ${newLocked.toFixed(2)} ₺`
        if (usdtFree > 0.1) syncLog += `, Cüzdanda: $${usdtFree.toFixed(2)} USDT`
        addLog("INFO", syncLog)
      } else {
        alert("Bakiye okunamadı: " + (data.message || "Bilinmeyen hata"))
        addLog("ALERT", `⚠️ Bakiye güncellenemedi: ${data.message}`)
      }
    } catch (e: any) {
      alert("Bağlantı hatası: " + (e?.message || e))
    } finally {
      setIsRefreshingBalance(false)
    }
  }

  // Sahipsiz / Kalan tek bir coini piyasa fiyatından satıp TRY'ye dönüştür
  async function handleSellSingleWalletAsset(asset: string, freeQty: number) {
    if (!botState.binance?.apiKey || !botState.binance?.apiSecret) {
      alert("Binance API bilgileri bulunamadı.")
      return
    }
    setSellingAsset(asset)
    try {
      let rawKey = botState.binance.apiKey
      let rawSecret = botState.binance.apiSecret
      if (rawKey.startsWith("enc_v1:")) {
        try { rawKey = (await decryptSensitive(rawKey)) || rawKey } catch {}
      }
      if (rawSecret.startsWith("enc_v1:")) {
        try { rawSecret = (await decryptSensitive(rawSecret)) || rawSecret } catch {}
      }

      const res = await fetch("/api/binance/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: asset + "_TRY",
          side: "SELL",
          type: "MARKET",
          quantity: freeQty,
          apiKey: rawKey,
          apiSecret: rawSecret,
          exchangeType: "BINANCE_TR",
        }),
      })
      const data = await res.json()
      if (data.ok) {
        addLog("SELL", `🟢 [CÜZDANDAN SATILDI] ${asset} başarıyla satıldı ve TRY nakite dönüştürüldü! Emir ID: ${data.orderId}`, asset)
        alert(`✅ ${asset} başarıyla satıldı ve TRY nakit hesabınıza geçti!`)
        // Eğer slotlarda bu coin varsa slotu da kapat
        setBotState((prev) => ({
          ...prev,
          positions: prev.positions.filter((p) => p.symbol !== asset),
        }))
        handleScanWalletAssets()
      } else {
        alert(`❌ ${asset} satılamadı: ${data.message}`)
        addLog("ALERT", `⚠️ ${asset} satış hatası: ${data.message}`, asset)
      }
    } catch (e: any) {
      alert("Bağlantı hatası: " + (e?.message || e))
    } finally {
      setSellingAsset(null)
    }
  }

  // Tüm sahipsiz / slotta olmayan coinleri tek tıkla bozdur
  async function handleSellAllOrphanAssets() {
    const activeSymbols = new Set(botState.positions.map((p) => p.symbol))
    const orphans = walletAssets.filter((a) => !activeSymbols.has(a.asset) && a.canSell)
    if (orphans.length === 0) {
      alert("Bozdurulabilecek (10 ₺ ve üzeri) sahipsiz coin bulunamadı.")
      return
    }
    const totalEst = orphans.reduce((sum, o) => sum + o.valueTry, 0)
    if (!confirm(`${orphans.length} adet sahipsiz coin (${orphans.map((o) => o.asset).join(", ")}) ~${totalEst.toFixed(2)} ₺ karşılığında piyasa fiyatından satılıp serbest TRY nakite dönüştürülecektir. Onaylıyor musunuz?`)) {
      return
    }
    for (const orphan of orphans) {
      await handleSellSingleWalletAsset(orphan.asset, orphan.free)
      await new Promise((r) => setTimeout(r, 600))
    }
  }

  // Modal veya sekme açıldığında inputları güncel botState ile tazele
  useEffect(() => {
    if (showApiModal || activeTab === "binance") {
      setApiAccountName(botState.binance?.accountName || "Kişisel Binance Hesabım")
      setRealBalanceInput(botState.binance?.realBalanceTry ? String(botState.binance.realBalanceTry) : "15000")
      setDemoBalanceInput(String(botState.balanceTry || 50000))
      setAccountTypeInput(botState.binance?.accountType || "SIMULATION")
      if (botState.binance?.apiKey && !botState.binance.apiKey.startsWith("enc_v1:")) {
        setApiKeyInput(botState.binance.apiKey)
      }
      if (botState.binance?.apiSecret && !botState.binance.apiSecret.startsWith("enc_v1:")) {
        setApiSecretInput(botState.binance.apiSecret)
      }
    }
  }, [showApiModal, activeTab, botState.binance, botState.balanceTry])

  const [trigSymbol, setTrigSymbol] = useState("PEPE")
  const [trigTarget, setTrigTarget] = useState("")
  const [trigDirection, setTrigDirection] = useState<"BELOW" | "ABOVE">("BELOW")
  const [trigAction, setTrigAction] = useState<"BUY" | "SELL">("BUY")
  const [trigAmount, setTrigAmount] = useState("1000")

  // Canlı Kripto Radarı için coin bazlı özel alım miktarı girişi
  const [customBuyAmounts, setCustomBuyAmounts] = useState<Record<string, string>>({})

  const { data: scanData, mutate: scanNow } = useSWR<{
    items: any[]
    usdTryRate: number
    currency: string
    timestamp: number
    fearGreed?: { value: number; classification: string }
    btcChange?: number
    isBtcDropping?: boolean
  }>("/api/automation", fetcher, {
    refreshInterval: botState.active ? 10000 : 60000,
    dedupingInterval: 5000,
  })

  const marketItems = scanData?.items || []
  const usdTryRate = scanData?.usdTryRate || 48.30
  const btcChange = scanData?.btcChange ?? 0
  const isBtcDropping = scanData?.isBtcDropping ?? false
  const fearGreed = scanData?.fearGreed || (serverState as any)?.fearGreed || { value: 73, classification: "Greed" }


  function addLog(type: TradeLog["type"], message: string, symbol?: string) {
    const newLog: TradeLog = {
      id: "log-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      time: new Date().toLocaleTimeString("tr-TR"),
      type,
      message,
      symbol,
    }
    setBotState((prev) => ({
      ...prev,
      logs: [newLog, ...prev.logs.slice(0, 99)],
    }))
  }

  const [isTestingApi, setIsTestingApi] = useState(false)

  async function handleTestBinanceApi() {
    let key = apiKeyInput.trim() || (botState.binance?.apiKey || "").trim()
    let secret = apiSecretInput.trim() || (botState.binance?.apiSecret || "").trim()

    // Eğer kullanıcı veya kayıtlı state hala enc_v1: içeriyorsa çözmeyi dene, çözemezse uyar
    if (key.startsWith("enc_v1:")) {
      try {
        const decrypted = await decryptSensitive(key)
        if (decrypted && !decrypted.startsWith("enc_v1:")) {
          key = decrypted.trim()
        } else {
          key = ""
        }
      } catch {
        key = ""
      }
    }

    if (secret.startsWith("enc_v1:")) {
      try {
        const decrypted = await decryptSensitive(secret)
        if (decrypted && !decrypted.startsWith("enc_v1:")) {
          secret = decrypted.trim()
        } else {
          secret = ""
        }
      } catch {
        secret = ""
      }
    }

    if (!key || key.startsWith("enc_v1:") || !secret || secret.startsWith("enc_v1:")) {
      alert("⚠️ Kutuda eski şifreli anahtar (enc_v1) kalmış.\n\nLütfen 'Kutuları Temizle' butonuna basıp, Binance TR'den kopyaladığınız GERÇEK API Key ve Secret'ı yapıştırınız.")
      setApiKeyInput("")
      setApiSecretInput("")
      return
    }

    setIsTestingApi(true)
    try {
      const res = await fetch("/api/binance/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: key,
          apiSecret: secret,
          exchangeType: "BINANCE_TR",
        }),
      })
      const data = await res.json()
      if (data.ok) {
        const totalVal = typeof data.totalTryValue === "number" && data.totalTryValue >= 0 ? data.totalTryValue : (data.tryBalance || 0)
        const freeVal = typeof data.freeTry === "number" ? data.freeTry : (typeof data.tryBalance === "number" ? data.tryBalance : 0)
        const lockedVal = typeof data.lockedTry === "number" ? data.lockedTry : 0
        const coinVal = typeof data.coinValueTry === "number" ? data.coinValueTry : 0
        const usdtVal = typeof data.usdtFree === "number" ? data.usdtFree : (data.balances?.USDT?.free || 0)
        const usdtTot = typeof data.usdtTotal === "number" ? data.usdtTotal : (data.balances?.USDT?.total || 0)
        const usdtTryVal = typeof data.usdtTryValue === "number" ? data.usdtTryValue : 0

        if (Array.isArray(data.assetDetails)) setWalletAssets(data.assetDetails)
        setRealBalanceInput(String(totalVal))
        setBotState((prev) => ({
          ...prev,
          balanceTry: freeVal,
          binance: {
            ...prev.binance,
            connected: true,
            walletTotalTry: totalVal,
            realBalanceTry: totalVal,
            freeTry: freeVal,
            lockedTry: lockedVal,
            coinValueTry: coinVal,
            usdtFree: usdtVal,
            usdtTotal: usdtTot,
            usdtTryValue: usdtTryVal,
            lastSyncTime: new Date().toLocaleTimeString("tr-TR"),
          },
        }))
        addLog("INFO", `🟢 BİNANCE HESABI DOĞRULANDI: ${data.message}`)
        alert(`✅ ${data.message}\n\nSerbest Nakit: ${freeVal.toFixed(2)} ₺\nToplam Portföy: ${totalVal.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺${lockedVal > 0 ? `\nAçık Emirdeki Kilitli TRY: ${lockedVal.toFixed(2)} ₺` : ""}${usdtVal > 0.1 ? `\nCüzdandaki USDT: $${usdtVal.toFixed(2)}` : ""}`)
      } else {
        addLog("ALERT", `❌ BİNANCE DOĞRULAMA HATASI: ${data.message}`)
        alert(`❌ ${data.message}`)
      }
    } catch (e: any) {
      alert("Bağlantı hatası: " + (e?.message || e))
    } finally {
      setIsTestingApi(false)
    }
  }

  async function handleSaveBinanceCredentials(e: React.FormEvent) {
    e.preventDefault()
    const isReal = accountTypeInput === "REAL"
    let demoBal = parseFloat(demoBalanceInput) || 50000
    if (demoBal < 10000) demoBal = 10000
    if (demoBal > 50000) demoBal = 50000

    let rawKey = apiKeyInput.trim()
    let rawSecret = apiSecretInput.trim()

    if (!rawKey && botState.binance?.apiKey && !botState.binance.apiKey.startsWith("enc_v1:")) {
      rawKey = botState.binance.apiKey
    }
    if (!rawSecret && botState.binance?.apiSecret && !botState.binance.apiSecret.startsWith("enc_v1:")) {
      rawSecret = botState.binance.apiSecret
    }

    if (isReal) {
      if (!rawKey || !rawSecret || rawKey.startsWith("enc_v1:") || rawSecret.startsWith("enc_v1:")) {
        alert("⚠️ Lütfen Binance TR API Key ve Secret alanlarını doldurunuz ve 'Test Et' ile doğrulayınız.")
        return
      }

      setIsTestingApi(true)
      let liveData: any = null
      try {
        const res = await fetch("/api/binance/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: rawKey, apiSecret: rawSecret, exchangeType: "BINANCE_TR" }),
        })
        liveData = await res.json()
      } catch (err: any) {
        alert("Bağlantı hatası: " + (err?.message || err))
        return
      } finally {
        setIsTestingApi(false)
      }

      if (!liveData || !liveData.ok) {
        alert("❌ Binance TR bağlantısı başarısız: " + (liveData?.message || "Lütfen API anahtarlarınızı kontrol ediniz."))
        return
      }

      const realFree = typeof liveData.freeTry === "number" ? liveData.freeTry : (typeof liveData.tryBalance === "number" ? liveData.tryBalance : 0)
      const realTotal = typeof liveData.totalTryValue === "number" ? liveData.totalTryValue : realFree
      const realLocked = typeof liveData.lockedTry === "number" ? liveData.lockedTry : 0
      const realCoinVal = typeof liveData.coinValueTry === "number" ? liveData.coinValueTry : 0
      const usdtVal = typeof liveData.usdtFree === "number" ? liveData.usdtFree : (liveData.balances?.USDT?.free || 0)
      const usdtTot = typeof liveData.usdtTotal === "number" ? liveData.usdtTotal : (liveData.balances?.USDT?.total || 0)
      const usdtTryVal = typeof liveData.usdtTryValue === "number" ? liveData.usdtTryValue : 0

      if (Array.isArray(liveData.assetDetails)) {
        setWalletAssets(liveData.assetDetails)
      }

      const newCreds: BinanceCredentials = {
        accountName: apiAccountName || "Kişisel Binance TR Cüzdanı",
        apiKey: rawKey,
        apiSecret: rawSecret,
        accountType: "REAL",
        connected: true,
        realBalanceTry: realTotal,
        walletTotalTry: realTotal,
        freeTry: realFree,
        lockedTry: realLocked,
        coinValueTry: realCoinVal,
        usdtFree: usdtVal,
        usdtTotal: usdtTot,
        usdtTryValue: usdtTryVal,
        lastSyncTime: new Date().toLocaleTimeString("tr-TR"),
      }

      setBotState((prev) => ({
        ...prev,
        active: true,
        balanceTry: realFree,
        initialBalanceTry: realTotal,
        dailyLossStartBalance: realTotal,
        dailyLossDate: new Date().toISOString().slice(0, 10),
        strategy: {
          ...prev.strategy,
          autoPilot: true,
        },
        binance: newCreds,
      }))

      setShowApiModal(false)
      addLog("INFO", `🟢 Binance TR Gerçek Hesabı Bağlandı: Toplam: ${realTotal.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺ | Serbest Nakit: ${realFree.toFixed(2)} ₺`)

      fetch("/api/bot/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          binance: newCreds,
          balance: realFree,
          initialBalance: realTotal,
          active: true,
        }),
      }).catch(() => {})

      let alertText = `✅ Binance TR Gerçek Hesabı Başarıyla Bağlandı!\n\n• Toplam Portföy: ${realTotal.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺\n• Kullanılabilir Serbest Nakit (TRY): ${realFree.toFixed(2)} ₺`
      if (realLocked > 0) {
        alertText += `\n• Açık Emirdeki Kilitli Nakit: ${realLocked.toFixed(2)} ₺`
      }
      if (usdtVal > 0.1) {
        alertText += `\n• Cüzdandaki USDT: $${usdtVal.toFixed(2)} (~${usdtTryVal.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺)`
      }
      if (realFree < 10) {
        alertText += `\n\n⚠️ DİKKAT: Serbest TRY bakiyeniz ${realFree.toFixed(2)} ₺ (işlem için en az 10.00 ₺ gerekir). Botun alım yapabilmesi için TRY yatırabilir veya 'Cüzdandaki Coinleri Gör & Bozdur' butonu ile coin/USDT bozdurabilirsiniz.`
      }
      alert(alertText)
    } else {
      // Sanal Demo Modu
      const newCreds: BinanceCredentials = {
        accountName: apiAccountName || "Sanal Demo Hesabı",
        apiKey: rawKey,
        apiSecret: rawSecret,
        accountType: "SIMULATION",
        connected: false,
        realBalanceTry: 0,
        walletTotalTry: demoBal,
        freeTry: demoBal,
        lockedTry: 0,
        lastSyncTime: new Date().toLocaleTimeString("tr-TR"),
      }

      setBotState((prev) => ({
        ...prev,
        active: true,
        balanceTry: demoBal,
        initialBalanceTry: demoBal,
        dailyLossStartBalance: demoBal,
        dailyLossDate: new Date().toISOString().slice(0, 10),
        strategy: {
          ...prev.strategy,
          autoPilot: true,
        },
        binance: newCreds,
        positions: [],
        history: [],
      }))

      setShowApiModal(false)
      addLog("INFO", `🧪 Sanal Demo Hesabı Aktif Edildi (${demoBal.toLocaleString("tr-TR")} ₺)`)
      alert(`✅ Sanal Demo Hesabı ${demoBal.toLocaleString("tr-TR")} ₺ olarak ayarlandı ve pozisyonlar sıfırlandı.`)

      fetch("/api/bot/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          balance: demoBal,
          initialBalance: demoBal,
          active: true,
          positions: [],
          history: [],
        }),
      }).catch(() => {})
    }
  }


  async function openPosition(
    symbol: string,
    name: string,
    marketPrice: number,
    totalTry: number,
    triggerType: Position["triggerType"],
    reasonText?: string
  ) {
    if (isPlacingOrderRef.current) return false
    const maxSlots = botState.strategy.maxConcurrentPositions || 3
    if (botState.positions.length >= maxSlots) return false
    if (botState.positions.some((p) => p.symbol === symbol)) return false

    if (botState.balanceTry < totalTry) {
      addLog("ALERT", "Yetersiz bakiye! " + symbol + " için gereken " + fmt(totalTry) + " ₺, mevcut bakiye " + fmt(botState.balanceTry) + " ₺", symbol)
      return false
    }
    const commCheck = validateTradeCommission(
      totalTry,
      botState.strategy.defaultTakeProfitPct,
      botState.strategy.commissionRatePct,
      botState.strategy.maxCommissionProfitRatio
    )
    if (!commCheck.ok) {
      addLog("ALERT", "KOMİSYON KORUMASI: " + symbol + " işleminde komisyon (" + commCheck.totalFeeTry.toFixed(2) + " ₺), hedeflenen kârın %" + commCheck.feeRatio.toFixed(1) + "'ini aşıyor! İşlem kârsız bulunup REDDEDİLDİ.", symbol)
      return false
    }
    const isLimit = botState.strategy.orderType === "LIMIT"
    const limitDiscount = (botState.strategy.limitDiscountPct || 0.25) / 100
    const entryPrice = isLimit ? marketPrice * (1 - limitDiscount) : marketPrice
    let amount = totalTry / entryPrice
    let finalTotalTry = totalTry
    let realOrderId: string | number | undefined
    let isRealOrder = false

    const isReal = Boolean(botState.binance?.connected && botState.binance?.accountType === "REAL")

    isPlacingOrderRef.current = true
    try {
      // 🟢 GERÇEK BİNANCE SPOT EMİR KÖPRÜSÜ
      if (isReal && botState.binance?.apiKey) {
        try {
          let rawKey = botState.binance.apiKey
          let rawSecret = botState.binance.apiSecret
          // Eski şifreli değerler kaldıysa çözmeyi dene
          if (rawKey.startsWith("enc_v1:")) {
            try { rawKey = await decryptSensitive(rawKey) } catch { rawKey = "" }
          }
          if (rawSecret.startsWith("enc_v1:")) {
            try { rawSecret = await decryptSensitive(rawSecret) } catch { rawSecret = "" }
          }

          if (rawKey && rawSecret) {
            const cryptoDef = WATCHED_CRYPTOS.find((c) => c.symbol === symbol)
            const pair = cryptoDef?.binance || (symbol + "TRY")

            addLog("INFO", `⚡ Binance borsasına gerçek alım emri iletiliyor: ${pair} (${totalTry.toFixed(2)} ₺)...`, symbol)

            const orderRes = await fetch("/api/binance/order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                symbol: pair,
                side: "BUY",
                type: "MARKET", // Spot alımda anında dolum için MARKET
                quoteOrderQty: totalTry,
                apiKey: rawKey,
                apiSecret: rawSecret,
                exchangeType: botState.binance.exchangeType || "BINANCE_TR",
              }),
            })

            const orderData = await orderRes.json()
            if (!orderData.ok) {
              addLog("ALERT", `❌ BİNANCE GERÇEK EMİR HATASI: ${orderData.message}`, symbol)
              if (typeof orderData.freeTry === "number") {
                setBotState((p) => ({ ...p, balanceTry: orderData.freeTry }))
              }
              return false // Borsa onay vermediyse yerel pozisyon açma!
            }

            realOrderId = orderData.orderId
            isRealOrder = true
            if (orderData.executedQty > 0) amount = orderData.executedQty
            if (orderData.cummulativeQuoteQty > 0) {
              finalTotalTry = orderData.cummulativeQuoteQty
            } else {
              finalTotalTry = amount * entryPrice
            }
            const actualEntryPrice = (finalTotalTry > 0 && amount > 0) ? (finalTotalTry / amount) : entryPrice
            addLog("BUY", `🟢 [BİNANCE GERÇEK ALIM BAŞARILI] ${symbol} @ ${fmt(actualEntryPrice)} ₺ | Tutar: ${fmt(finalTotalTry)} ₺ | Emir ID: ${realOrderId}`, symbol)
          }
        } catch (err: any) {
          addLog("ALERT", `❌ Binance API Bağlantı Hatası: ${err?.message || err}`, symbol)
          return false
        }
      }

      const actualEntryPrice = (isRealOrder && finalTotalTry > 0 && amount > 0) ? (finalTotalTry / amount) : entryPrice
      const slPct = botState.strategy.defaultStopLossPct / 100
      const tpPct = botState.strategy.defaultTakeProfitPct / 100
      const stopLossPrice = actualEntryPrice * (1 - slPct)
      const takeProfitPrice = actualEntryPrice * (1 + tpPct)

      const newPosition: Position = {
        id: "pos-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        symbol,
        name,
        side: "BUY",
        entryPrice: actualEntryPrice,
        currentPrice: actualEntryPrice,
        highestPrice: actualEntryPrice,
        trailingStopPrice: stopLossPrice,
        amount,
        totalTry: finalTotalTry,
        stopLossPrice,
        takeProfitPrice,
        orderType: isLimit ? "LIMIT" : "MARKET",
        limitPrice: entryPrice,
        commissionTry: commCheck.totalFeeTry,
        commissionRatio: commCheck.feeRatio,
        pnl: 0,
        pnlPercent: 0,
        openedAt: new Date().toLocaleTimeString("tr-TR"),
        openedTimestamp: Date.now(),
        status: "OPEN",
        triggerType,
        orderId: realOrderId,
        isRealOrder,
      }

      setBotState((prev) => {
        const filteredPrev = prev.positions.filter((p) => p.symbol !== symbol)
        const nextPositions = [newPosition, ...filteredPrev].slice(0, maxSlots)
        const nextBalance = Math.max(0, prev.balanceTry - finalTotalTry)
        try {
          mutateServerState((p) => p ? { ...p, positions: nextPositions, balance: nextBalance } : p, false)
        } catch {}
        fetch("/api/bot/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            positions: nextPositions,
            balance: nextBalance,
          }),
        }).catch(() => {})
        return {
          ...prev,
          balanceTry: nextBalance,
          positions: nextPositions,
        }
      })

      if (!isRealOrder) {
        addLog(
          "BUY",
          (isReal ? "🟢 [GERÇEK BİNANCE] " : "🧪 [SİMÜLASYON] ") + "LİMİT ALIM: " + symbol + " @ " + fmt(entryPrice) + " ₺ (" + fmt(finalTotalTry) + " ₺). TP: " + fmt(takeProfitPrice) + " ₺ | SL: " + fmt(stopLossPrice) + " ₺ [Komisyon: " + commCheck.totalFeeTry.toFixed(2) + " ₺, Oran: %" + commCheck.feeRatio.toFixed(1) + "]",
          symbol
        )
      }

      // 📧 E-posta Bildirimi Gönder
      if (botState.strategy.emailNotificationsEnabled && botState.strategy.userNotificationEmail) {
        const orderPrefix = isRealOrder ? "🟢 Binance Gerçek Alım Gerçekleşti" : "🤖 Bot Yeni Pozisyon Açtı"
        sendEmailNotification(
          botState.strategy.userNotificationEmail,
          `${orderPrefix}: ${symbol}`,
          `${symbol} için ${fmt(entryPrice)} ₺ fiyattan ${fmt(finalTotalTry)} ₺ tutarında ${isRealOrder ? "Binance spot alım emri" : "alım"} gerçekleşti.\nTake-Profit: ${fmt(takeProfitPrice)} ₺\nStop-Loss: ${fmt(stopLossPrice)} ₺${realOrderId ? `\nBinance Emir ID: ${realOrderId}` : ""}`
        )
      }

      return true
    } finally {
      isPlacingOrderRef.current = false
    }
  }


  async function closePosition(positionId: string, currentPrice: number, reason: string) {
    if (closingPositionIdsRef.current.has(positionId)) return
    closingPositionIdsRef.current.add(positionId)

    try {
      const pos = botState.positions.find((p) => p.id === positionId)
      if (!pos) return

      let returnTry = pos.amount * currentPrice
    const isReal = Boolean(botState.binance?.connected && botState.binance?.accountType === "REAL")

    // 🟢 GERÇEK BİNANCE SPOT SATIŞ KÖPRÜSÜ
    if ((pos.isRealOrder || isReal) && botState.binance?.apiKey) {
      let borsaSold = false
      let isAlreadyZero = false

      try {
        let rawKey = botState.binance.apiKey
        let rawSecret = botState.binance.apiSecret
        // Eski şifreli değerler kaldıysa çözmeyi dene
        if (rawKey.startsWith("enc_v1:")) {
          try { rawKey = await decryptSensitive(rawKey) } catch { rawKey = "" }
        }
        if (rawSecret.startsWith("enc_v1:")) {
          try { rawSecret = await decryptSensitive(rawSecret) } catch { rawSecret = "" }
        }

        if (rawKey && rawSecret) {
          const cryptoDef = WATCHED_CRYPTOS.find((c) => c.symbol === pos.symbol)
          const pair = cryptoDef?.binance || (pos.symbol + "TRY")

          addLog("INFO", `⚡ Binance borsasına gerçek satış emri iletiliyor: ${pair} (${pos.amount} adet)...`, pos.symbol)

          const orderRes = await fetch("/api/binance/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: pair,
              side: "SELL",
              type: "MARKET",
              quantity: pos.amount,
              isPartial: false,
              apiKey: rawKey,
              apiSecret: rawSecret,
              exchangeType: botState.binance.exchangeType || "BINANCE_TR",
            }),
          })

          const orderData = await orderRes.json()
          if (orderData.ok) {
            borsaSold = true
            if (orderData.cummulativeQuoteQty > 0) {
              returnTry = orderData.cummulativeQuoteQty
            }
            addLog("SELL", `🟢 [BİNANCE GERÇEK SATIŞ ONAYLANDI] ${pos.symbol} satıldı! Borsa Getirisi: +${fmt(returnTry)} ₺ | Emir ID: ${orderData.orderId}`, pos.symbol)
          } else {
            const errLower = (orderData.message || "").toLowerCase()
            const isZeroOrDust =
              errLower.includes("0 adet") ||
              errLower.includes("yetersiz: 0") ||
              errLower.includes("yetersiz") ||
              errLower.includes("bulunamadı") ||
              errLower.includes("minimum:") ||
              errLower.includes("-2010") ||
              errLower.includes("insufficient") ||
              errLower.includes("lot_size") ||
              errLower.includes("min_notional") ||
              errLower.includes("filter failure")

            const isManual = reason.includes("Kullanıcı") || reason.includes("Manuel")

            if (isZeroOrDust || isManual) {
              borsaSold = true
              returnTry = (pos.amount > 0 && currentPrice > 0) ? (pos.amount * currentPrice) : pos.totalTry
              addLog("INFO", `ℹ️ ${pos.symbol} slotu temizlendi ${orderData.message ? `(${orderData.message})` : ""}. Değer (~${fmt(returnTry)} ₺) bakiyeye iade edildi.`, pos.symbol)
            } else {
              addLog("ALERT", `❌ BİNANCE GERÇEK SATIŞ REDDEDİLDİ: ${orderData.message}. Borsa güvenliği için pozisyon AÇIK bırakıldı!`, pos.symbol)
              return
            }
          }
        }
      } catch (err: any) {
        const isManual = reason.includes("Kullanıcı") || reason.includes("Manuel")
        if (isManual) {
          borsaSold = true
          returnTry = (pos.amount > 0 && currentPrice > 0) ? (pos.amount * currentPrice) : pos.totalTry
          addLog("ALERT", `⚠️ Binance Satış Hatası: ${err?.message || err}. Manuel kapatma nedeniyle slot yerel değerle (~${fmt(returnTry)} ₺) temizlendi.`, pos.symbol)
        } else {
          addLog("ALERT", `⚠️ Binance Satış Bağlantı Hatası: ${err?.message || err}. Pozisyon açık tutuluyor.`, pos.symbol)
          return
        }
      }
    }

    const fee = (pos.commissionTry || (pos.totalTry * 0.002))
    const grossPnl = returnTry - pos.totalTry
    const netPnl = grossPnl - (fee / 2)
    const pnlPercent = (grossPnl / pos.totalTry) * 100
    const isWin = grossPnl >= 0

    const closedPosition: Position = {
      ...pos,
      status: "CLOSED",
      closePrice: currentPrice,
      closeReason: reason,
      closedAt: new Date().toLocaleTimeString("tr-TR"),
      closedTimestamp: Date.now(),
      pnl: grossPnl,
      netPnlTry: netPnl,
      pnlPercent,
      isRealOrder: Boolean(pos.isRealOrder && pos.orderId),
    }

    setBotState((prev) => {
      const nextPositions = prev.positions.filter((p) => p.id !== positionId)
      const nextBalance = prev.balanceTry + returnTry
      fetch("/api/bot/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positions: nextPositions,
          balance: nextBalance,
        }),
      }).catch(() => {})
      return {
        ...prev,
        balanceTry: nextBalance,
        positions: nextPositions,
        history: [closedPosition, ...prev.history.slice(0, 99)],
      }
    })

    addLog(
      "SELL",
      (isReal && pos.isRealOrder ? "🟢 [GERÇEK BİNANCE] " : "🧪 [SİMÜLASYON] ") + "POZİSYON KAPATILDI: " + pos.symbol + " @ " + fmt(currentPrice) + " ₺ | NET: " + (isWin ? "+" : "") + fmt(netPnl) + " ₺ (%" + pnlPercent.toFixed(2) + ") [" + reason + "]",
      pos.symbol
    )

      // 📧 E-posta Bildirimi Gönder (Kapanış)
      if (botState.strategy.emailNotificationsEnabled && botState.strategy.userNotificationEmail) {
        const pnlPrefix = isWin ? "🟢 KÂR:" : "🔴 ZARAR:"
        sendEmailNotification(
          botState.strategy.userNotificationEmail,
          `${pnlPrefix} ${pos.symbol} Pozisyonu Kapandı (${(isWin ? "+" : "") + fmt(netPnl)} ₺)`,
          `${pos.symbol} pozisyonu ${fmt(currentPrice)} ₺ fiyattan kapatıldı.\nNet Getiri: ${(isWin ? "+" : "") + fmt(netPnl)} ₺ (%${pnlPercent.toFixed(2)})\nKapanış Nedeni: ${reason}`
        )
      }
    } finally {
      closingPositionIdsRef.current.delete(positionId)
    }
  }

  // Tüm açık pozisyonları tek tıkla kapatıp %100 TRY nakite geç
  async function handleCloseAllPositions() {
    if (botState.positions.length === 0) return
    if (!confirm(`${botState.positions.length} açık pozisyon kapatılarak tüm bakiye serbest TRY nakite dönüştürülecektir. Onaylıyor musunuz?`)) return
    const currentPositions = [...botState.positions]
    for (const pos of currentPositions) {
      await closePosition(pos.id, pos.currentPrice, "Kullanıcı Tümünü Nakite Çevirdi")
      await new Promise((r) => setTimeout(r, 600))
    }
  }


  const openPositionsValue = useMemo(() => {
    return botState.positions.reduce((acc, p) => acc + p.amount * p.currentPrice, 0)
  }, [botState.positions, marketItems])

  const isRealAccount = Boolean(botState.binance?.connected && botState.binance?.accountType === "REAL")

  // Canlı Binance TR toplam portföy değeri veya Sanal portföy toplamı
  const effectiveTotalPortfolio = useMemo(() => {
    if (isRealAccount && (botState.binance?.walletTotalTry ?? 0) > 0) {
      return Math.max(botState.binance!.walletTotalTry!, botState.balanceTry + openPositionsValue)
    }
    return botState.balanceTry + openPositionsValue
  }, [isRealAccount, botState.binance?.walletTotalTry, botState.balanceTry, openPositionsValue])

  // Cüzdandaki kripto varlıkların (RENDER vb.) veya açık pozisyonların toplam değeri
  const effectiveCryptoValue = useMemo(() => {
    if (isRealAccount) {
      if (typeof botState.binance?.coinValueTry === "number" && botState.binance.coinValueTry > 0) {
        return Math.max(botState.binance.coinValueTry, openPositionsValue)
      }
      return openPositionsValue
    }
    return openPositionsValue
  }, [isRealAccount, botState.binance?.coinValueTry, openPositionsValue])

  const totalPortfolioTry = effectiveTotalPortfolio

  // Sadece aktif çalışma moduna (Gerçek Para vs Simülasyon) ait geçmiş işlemleri dikkate al
  const relevantHistory = useMemo(() => {
    return botState.history.filter((h) => isRealAccount ? Boolean(h.isRealOrder && h.orderId) : !h.isRealOrder)
  }, [botState.history, isRealAccount])

  // Gerçekleşen (tamamlanmış geçmiş işlemlerden gelen) net kâr/zarar
  const realizedPnlTry = useMemo(() => {
    return relevantHistory.reduce((acc, h) => acc + (h.netPnlTry ?? h.pnl ?? 0), 0)
  }, [relevantHistory])

  // Açık pozisyonların gerçek anlık net kâr/zararı
  const unrealizedPnlTry = useMemo(() => {
    return botState.positions.reduce((acc, p) => acc + (p.pnl || 0), 0)
  }, [botState.positions, marketItems])

  // Toplam net kâr / zarar:
  // Kapanmış kârlar + Açık pozisyon kârı (Trading botunun gerçek net kârı - para yatırma/çekmeden etkilenmez)
  const totalPnlTry = realizedPnlTry + unrealizedPnlTry
  const costBasis = Math.max(10, effectiveTotalPortfolio)
  const totalPnlPct = costBasis > 0 ? (totalPnlTry / costBasis) * 100 : 0
  const winCount = relevantHistory.filter((h) => (h.netPnlTry ?? h.pnl ?? 0) > 0).length
  const winRate = relevantHistory.length ? Math.round((winCount / relevantHistory.length) * 100) : 0

  // Bugün gerçekleşen gerçek borsa zararlarının toplamı (Anapara değişikliği asla zarar sayılmaz)
  const todayRealizedLossTry = useMemo(() => {
    return relevantHistory
      .filter((h) => (h.netPnlTry ?? h.pnl ?? 0) < 0)
      .reduce((acc, h) => acc + Math.abs(h.netPnlTry ?? h.pnl ?? 0), 0)
  }, [relevantHistory])
  const currentTotalPort = totalPortfolioTry > 0 ? totalPortfolioTry : 70
  const dailyLossPct = (todayRealizedLossTry / currentTotalPort) * 100

  // ⚡ KALDIRAÇ MODU
  const [leverageMode, setLeverageMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("piyasaiq:leverage_mode") === "true"
    }
    return false
  })
  const [leverageX, setLeverageX] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const v = parseInt(localStorage.getItem("piyasaiq:leverage_x") || "5", 10)
      return [2, 3, 5, 10, 20].includes(v) ? v : 5
    }
    return 5
  })
  const [showLeveragePanel, setShowLeveragePanel] = useState(false)

  function toggleLeverage() {
    const next = !leverageMode
    setLeverageMode(next)
    if (typeof window !== "undefined") {
      localStorage.setItem("piyasaiq:leverage_mode", next ? "true" : "false")
    }
    addLog("INFO", next
      ? `⚡ KALDIRAÇ MODU AKTİF: ${leverageX}x — Simüle edilmiş marjin pozisyonlar açılıyor. (Sadece UI simülasyonu, gerçek vadeli işlem DEĞİL)`
      : "⚡ Kaldıraç modu KAPATILDI. Spot işlem moduna dönüldü."
    )
  }

  function changeLeverageX(x: number) {
    setLeverageX(x)
    if (typeof window !== "undefined") {
      localStorage.setItem("piyasaiq:leverage_x", String(x))
    }
    addLog("INFO", `⚡ Kaldıraç katsayısı ${x}x olarak güncellendi.`)
  }

  // 🚨 ACİL TÜMÜNÜ SAT & %100 TRY NAKİTE GEÇ (Otopilot Durdurulur, Pozisyonlar ve Cüzdan Kriptoları Piyasa Fiyatından Satılır)
  const [isLiquidatingAll, setIsLiquidatingAll] = useState(false)
  async function handleLiquidateEverything() {
    const totalPos = botState.positions.length
    const promptMsg = isRealAccount
      ? `🚨 TÜM VARLIKLARI BOZDUR & %100 NAKİTE GEÇ:\n\n1. Otonom bot durdurulacak (yeni alım yapılmayacak).\n2. ${totalPos} açık bot pozisyonu piyasa fiyatından satılacak.\n3. Binance TR cüzdanınızdaki diğer satılabilir coinler taranıp anında TRY nakite çevrilecek.\n\nTüm portföyü serbest TRY nakite dönüştürmeyi onaylıyor musunuz?`
      : `🚨 TÜMÜNÜ KAPAT & SANAL NAKİTE GEÇ:\n\n• Otonom bot durdurulacak.\n• ${totalPos} açık pozisyon kapatılacak ve sanal sermaye serbest TRY nakite iade edilecek.\n\nOnaylıyor musunuz?`

    if (!confirm(promptMsg)) return
    setIsLiquidatingAll(true)

    try {
      // 1. Yeni alımları engellemek için botu derhal durdur
      setBotState((prev) => ({ ...prev, active: false }))
      fetch("/api/bot/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      }).catch(() => {})
      addLog("ALERT", "🛑 Otonom bot durduruldu. Acil nakite geçiş başlatıldı...")

      // 2. Açık pozisyonları kapat
      const currentPositions = [...botState.positions]
      for (const pos of currentPositions) {
        await closePosition(pos.id, pos.currentPrice, "Kullanıcı Acil Nakite Geçti")
        await new Promise((r) => setTimeout(r, 600))
      }

      // 3. Gerçek Binance TR hesabı ise cüzdandaki sahipsiz varlıkları da bozdur
      if (isRealAccount && botState.binance?.apiKey && botState.binance?.apiSecret) {
        let rawKey = botState.binance.apiKey
        let rawSecret = botState.binance.apiSecret
        if (rawKey.startsWith("enc_v1:")) {
          try { rawKey = (await decryptSensitive(rawKey)) || rawKey } catch {}
        }
        if (rawSecret.startsWith("enc_v1:")) {
          try { rawSecret = (await decryptSensitive(rawSecret)) || rawSecret } catch {}
        }

        const res = await fetch("/api/binance/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: rawKey, apiSecret: rawSecret, exchangeType: "BINANCE_TR" }),
        })
        const data = await res.json()
        if (data.ok && Array.isArray(data.assetDetails)) {
          setWalletAssets(data.assetDetails)
          const sellable = data.assetDetails.filter((a: any) => a.canSell && a.valueTry >= 10)
          for (const s of sellable) {
            await handleSellSingleWalletAsset(s.asset, s.free)
            await new Promise((r) => setTimeout(r, 600))
          }
        }
        await handleRefreshBalanceNow()
      }

      addLog("INFO", "✅ Tüm varlıklar başarıyla kapatıldı / satıldı. Portföy serbest TRY nakite dönüştürüldü.")
      alert("✅ Başarılı! Tüm varlıklar satıldı, bot durduruldu ve bakiyeniz serbest TRY nakite dönüştürüldü.")
    } catch (err: any) {
      alert("Satış işlemi sırasında bir hata oluştu: " + (err?.message || err))
    } finally {
      setIsLiquidatingAll(false)
    }
  }

  const maxSlots = Math.max(1, botState.strategy.maxConcurrentPositions || 3)
  const currentOpenCount = botState.positions.length
  const displaySlotsCount = Math.max(maxSlots, currentOpenCount)
  const availableSlots = Math.max(0, maxSlots - currentOpenCount)

  /** Temel slot miktarı (sermayenin akıllı ve kârlı kullanımı) */
  const baseSlotAmount = useMemo(() => {
    const minFloor = isRealAccount ? 15 : 10
    const available = botState.balanceTry
    if (available < minFloor) return 0

    // Eğer bakiye 2 slotu (her biri en az minFloor) karşılayamıyorsa veya tek slot kaldıysa tamamını kullan
    if (available < (minFloor * 2) || availableSlots <= 1) {
      return Math.max(minFloor, Math.floor(available * 0.98))
    }

    if (botState.strategy.autoAllocateCapital) {
      // Bakiye kaç slota yetiyorsa ona böl (örn: 34 TL -> 2 slot x 16.5 TL; 100 TL -> 3 slot x 32 TL)
      const possibleSlots = Math.min(availableSlots, Math.floor(available / minFloor))
      const slots = Math.max(1, possibleSlots)
      const cashPerSlot = Math.floor((available * 0.98) / slots)
      return Math.max(minFloor, cashPerSlot)
    }
    return Math.max(minFloor, Math.min(Math.floor(available * 0.98), botState.strategy.tradeAmountTry || minFloor))
  }, [botState.balanceTry, totalPortfolioTry, maxSlots, availableSlots, botState.strategy.autoAllocateCapital, botState.strategy.tradeAmountTry, isRealAccount])

  /**
   * Dinamik Pozisyon Boyutu: Çıkma potansiyeli (AI skoru) en yüksek olana en büyük payı ver!
   */
  function calcDynamicAmount(opportunityScore: number): number {
    const minFloor = isRealAccount ? 15 : 10
    const available = botState.balanceTry
    if (available < minFloor) return 0

    if (available < (minFloor * 2) || availableSlots <= 1) {
      return Math.max(minFloor, Math.floor(available * 0.98))
    }

    let rawAmount = baseSlotAmount
    if (botState.strategy.dynamicSizing) {
      // Potansiyeli en yüksek olana (Skor 85+) %35 daha fazla bütçe bas!
      const multiplier = opportunityScore >= 85 ? 1.35 : (opportunityScore >= 70 ? 1.15 : 0.85)
      rawAmount = Math.floor(baseSlotAmount * multiplier)
    }

    return Math.max(minFloor, Math.min(rawAmount, Math.floor(available * 0.98)))
  }

  // Geriye dönük uyum için eski adla da tut
  const dynamicSlotAmount = baseSlotAmount


  useEffect(() => {
    if (!botState.active || !marketItems.length) return

    botState.positions.forEach((pos) => {
      const liveItem = marketItems.find((m: any) => m.symbol === pos.symbol)
      const curPrice = Number(liveItem.currentPrice ?? liveItem.price ?? 0)
      if (!curPrice || !Number.isFinite(curPrice) || curPrice <= 0) return

      pos.currentPrice = curPrice
      if (pos.totalTry > 0 && pos.entryPrice > 0) {
        pos.pnl = pos.amount > 0 ? (pos.amount * curPrice - pos.totalTry) : ((curPrice - pos.entryPrice) * (pos.totalTry / pos.entryPrice))
        pos.pnlPercent = ((curPrice - pos.entryPrice) / pos.entryPrice) * 100
      }
      const currentHighest = Math.max(pos.highestPrice || pos.entryPrice, curPrice)
      pos.highestPrice = currentHighest

      // 1. Sıfır Zarar (Breakeven) Kilidi: Kâr %1.6 üzerine çıktığında Stop giriş seviyesinin üzerine (+%0.40) çekilir
      if (botState.strategy.breakevenEnabled && pos.pnlPercent >= (botState.strategy.breakevenPct || 1.6)) {
        const bePrice = pos.entryPrice * 1.0040 // Komisyon ve spread'i tamamen karşılayan kârlı seviye
        if (pos.stopLossPrice < bePrice) {
          pos.stopLossPrice = bePrice
          addLog("ALERT", `🛡️ SIFIR ZARAR KİLİDİ: ${pos.symbol} stop seviyesi girişin üzerine (${fmt(bePrice)} ₺, +%0.40) çekildi (İşlem artık kesinlikle kârlı/zararsız).`, pos.symbol)
        }
      }

      // 1.5. İleri Kâr Kilitleme: Kâr %2.2 üzerine çıktığında Stop seviyesi +%1.0 net kâra çekilir
      if (pos.pnlPercent >= 2.2) {
        const lockPrice = pos.entryPrice * 1.010
        if (pos.stopLossPrice < lockPrice) {
          pos.stopLossPrice = lockPrice
        }
      }

      // 2. Trailing Stop: Kâr %1.4 üzerine çıktığında devreye girer (Zirveden %0.8 takip mesafesi)
      if (pos.pnlPercent >= 1.4) {
        const trailPct = (botState.strategy.trailingStopPct || 0.8) / 100
        const calculatedTrailStop = currentHighest * (1 - trailPct)
        if (!pos.trailingStopPrice || calculatedTrailStop > pos.trailingStopPrice) {
          pos.trailingStopPrice = calculatedTrailStop
        }
        if (pos.trailingStopPrice && pos.trailingStopPrice > pos.stopLossPrice) {
          pos.stopLossPrice = pos.trailingStopPrice
        }
      }

      // 2.5. KADEMELİ KÂR ALMA & KOŞAN KÂR (%1.5 kârda %50'sini sat kârı cebe at, kalanı takip eden stopla koşsun)
      // ⚠️ KRİTİK BİNANCE KURALI: Gerçek hesapta en az 35 ₺ olmalı ki bölünen tutar 10 ₺ Binance limitine takılmasın!
      const canPartialSell = !isRealAccount ? (pos.totalTry >= 20) : (pos.totalTry >= 35 && ((pos.amount / 2) * curPrice) >= 16)
      if (
        botState.strategy.multiStageTakeProfit &&
        !pos.partialSold &&
        pos.pnlPercent >= 1.5 &&
        canPartialSell &&
        !closingPositionIdsRef.current.has(pos.id)
      ) {
        closingPositionIdsRef.current.add(pos.id)
        try {
          pos.partialSold = true
          const halfAmount = pos.amount / 2
          const halfTry = (pos.totalTry / 2) * (curPrice / pos.entryPrice)
          const partialPnl = halfTry - (pos.totalTry / 2)
          pos.amount = halfAmount
          pos.totalTry = pos.totalTry / 2
          pos.stopLossPrice = pos.entryPrice * 1.006 // Stop'u %0.6 kârda sabitle

          if (isRealAccount && botState.binance?.apiKey && botState.binance?.apiSecret) {
            (async () => {
              try {
                let rKey = botState.binance!.apiKey
                let rSec = botState.binance!.apiSecret
                if (rKey.startsWith("enc_v1:")) {
                  try { rKey = await decryptSensitive(rKey) } catch {}
                }
                if (rSec.startsWith("enc_v1:")) {
                  try { rSec = await decryptSensitive(rSec) } catch {}
                }
                await fetch("/api/binance/order", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    symbol: pos.symbol + "_TRY",
                    side: "SELL",
                    type: "MARKET",
                    quantity: halfAmount,
                    isPartial: true,
                    apiKey: rKey,
                    apiSecret: rSec,
                  }),
                })
              } catch {}
            })()
          }

          setBotState((prev) => ({
            ...prev,
            balanceTry: prev.balanceTry + halfTry,
          }))

          addLog("SELL", `🎯 [KADEMELİ KÂR ALINDI] ${pos.symbol}: %50 pozisyon satıldı (+${fmt(partialPnl)} ₺ cebe atıldı). Kalan %50 takip eden stopla koşuyor! 🚀`, pos.symbol)
        } finally {
          closingPositionIdsRef.current.delete(pos.id)
        }
      }

      const rsiVal = typeof liveItem.rsi === "number" ? liveItem.rsi : 50
      const highestGainPct = ((currentHighest - pos.entryPrice) / pos.entryPrice) * 100

      // 3. Take-Profit Ulaşıldı (Doyurucu Kâr Hedefi: %3.8)
      const targetTp = botState.strategy.defaultTakeProfitPct || 3.8
      if ((pos.pnlPercent ?? 0) >= targetTp || curPrice >= pos.takeProfitPrice) {
        closePosition(pos.id, curPrice, `Hedef Kâr Gerçekleşti (Take-Profit: +%${(pos.pnlPercent ?? 0).toFixed(2)}) 🎯`)
        return
      }

      // 3.5 Ekstrem RSI Zirvesi (RSI >= 75): Kâr %2.2 üzerindeyse tepe mumunda güvenle kâr al!
      if ((pos.pnlPercent ?? 0) >= 2.2 && rsiVal >= 75) {
        closePosition(pos.id, curPrice, `Ekstrem RSI Zirvesi (RSI ${rsiVal.toFixed(1)}): +%${(pos.pnlPercent ?? 0).toFixed(2)} kâr tepede cebe atıldı ⚡`)
        return
      }

      // 4. Akıllı Erken Kâr Kilitleme (RSI Doyumu ve Zirveden Geri Çekilme):
      if (botState.strategy.smartEarlyExitEnabled) {
        // A) RSI Doyum Noktası (RSI >= 72) & Kâr >= %2.5:
        if ((pos.pnlPercent ?? 0) >= 2.5 && rsiVal >= 72) {
          closePosition(pos.id, curPrice, `RSI Doyum Noktası (RSI ${rsiVal.toFixed(1)}): +%${(pos.pnlPercent ?? 0).toFixed(2)} cebe atıldı 🎯`)
          return
        }

        // B) Zirveden Geri Çekilmede Kârı Kilitle: Zirve >= %2.8 iken zirveden %1.0 düşerse kârı eritme
        if (highestGainPct >= 2.8 && curPrice <= (currentHighest * (1 - (botState.strategy.trailingStopPct || 1.0) / 100))) {
          closePosition(pos.id, curPrice, `Akıllı Kâr Kilitleme: Zirveden (%${highestGainPct.toFixed(2)}) geri çekilmede +%${(pos.pnlPercent ?? 0).toFixed(2)} kâr cebe atıldı 🛡️`)
          return
        }
      }

      // 5. Normal Stop-Loss & Takip Eden Stop Çıkışı
      if (curPrice <= pos.stopLossPrice) {
        const isProfitStop = pos.stopLossPrice > pos.entryPrice
        closePosition(
          pos.id,
          curPrice,
          isProfitStop
            ? `Takip Eden Stop Kârı Korudu (+%${(pos.pnlPercent ?? 0).toFixed(2)}) 🛡️`
            : `Zarar Kes (Stop-Loss) Tetiklendi (%${(pos.pnlPercent ?? 0).toFixed(2)}) 🛑`
        )
        return
      }

      // 5.5 1 Saatlik Trend Kırılım Koruması:
      // Yeni açılan pozisyonlar tahta makası nedeniyle hemen satılmaz!
      // Yalnızca en az 45 dakikadır açık olan VE net kayıp -%2.8 seviyesini aşan pozisyonlarda erken kes
      const posAgeMs = Date.now() - (pos.openedTimestamp || 0)
      if (posAgeMs >= 45 * 60 * 1000 && liveItem.tech1h?.isBearish && (pos.pnlPercent ?? 0) <= -2.8) {
        closePosition(
          pos.id,
          curPrice,
          `⚠️ 1 Saatlik Trend Kırılımı: 45dk konsolidasyon sonrası grafik bozulduğu için erken zarar kesildi (%${(pos.pnlPercent ?? 0).toFixed(2)})`
        )
        return
      }

      // 6. Yatay Pozisyon Kapatma (Yalnızca kârdaysa serbest bırak, asla zararına satma!)
      if (botState.strategy.stalePositionTimeoutEnabled) {
        const timeoutMs = Math.max(12, (botState.strategy.stalePositionTimeoutHours || 12.0)) * 60 * 60 * 1000
        const openedAtMs = pos.openedTimestamp || 0
        const timeHeldMs = Date.now() - openedAtMs

        if (openedAtMs > 0 && timeHeldMs >= timeoutMs && (pos.pnlPercent ?? 0) >= 0.1) {
          closePosition(
            pos.id,
            curPrice,
            `⏳ Yatay Pozisyon Tahliyesi: 12+ saatte kârla (+%${(pos.pnlPercent ?? 0).toFixed(2)}) sermaye yeni fırsat için serbest bırakıldı.`
          )
          return
        }
      }
    })

    botState.manualTriggers.forEach((trig) => {
      if (!trig.active) return
      const liveItem = marketItems.find((m: any) => m.symbol === trig.symbol)
      if (!liveItem) return
      const curPrice = Number(liveItem.currentPrice ?? liveItem.price ?? 0)
      if (!curPrice || !Number.isFinite(curPrice) || curPrice <= 0) return
      let triggered = false
      if (trig.direction === "BELOW" && curPrice <= trig.targetPrice) triggered = true
      else if (trig.direction === "ABOVE" && curPrice >= trig.targetPrice) triggered = true
      if (triggered) {
        openPosition(trig.symbol, trig.name, curPrice, trig.amountTry, "MANUAL", "Özel Hedef: " + fmt(trig.targetPrice) + " ₺")
        setBotState((prev) => ({ ...prev, manualTriggers: prev.manualTriggers.map((t) => (t.id === trig.id ? { ...t, active: false } : t)) }))
        addLog("ALERT", "ÖZEL LİMİT EMİR TETİKLENDİ: " + trig.symbol + " hedef fiyata ulaştı (" + fmt(curPrice) + " ₺).", trig.symbol)
      }
    })

    // ── BTC Düşüşünde Akıllı Dip Avcısı & Kara Kuğu Koruması ───────
    const isBtcBlackSwan = botState.strategy.btcDropProtectionEnabled && btcChange <= -6.0
    if (isBtcBlackSwan) {
      addLog(
        "ALERT",
        `🛑 AŞIRI PİYASA ÇÖKÜŞÜ: Bitcoin son dönemde %${btcChange.toFixed(2)} düştü (Kara Kuğu Riski). Sermaye güvenliği için tüm alımlar geçici olarak donduruldu.`
      )
      return
    }

    const isBotActive = botState.active
    const btcThreshold = Math.abs(botState.strategy.btcDropThresholdPct ?? 3.5)
    const isBtcDropping = botState.strategy.btcDropProtectionEnabled && btcChange <= -btcThreshold
    if (isBtcDropping) {
      return
    }

    // ── Günlük Devre Kesici (Circuit Breaker) Kontrolü ──
    const totalPosValue = botState.positions.reduce((sum, p) => sum + (p.totalTry || 0), 0)
    const currentTotalEquity = botState.balanceTry + totalPosValue
    const dailyLossStart = botState.dailyLossStartBalance || botState.initialBalanceTry || currentTotalEquity
    const dailyDrawdown = dailyLossStart > 0 ? ((dailyLossStart - currentTotalEquity) / dailyLossStart) * 100 : 0
    const maxLossLimit = botState.strategy.dailyMaxLossPct ?? 4.0
    if (dailyDrawdown >= maxLossLimit) {
      return
    }

    // ── Testere / Art Arda Zarar Soğutması (Whipsaw Cooldown) ──
    const recentClosed5 = botState.history.slice(0, 5)
    let consecutiveLosses = 0
    for (const h of recentClosed5) {
      if ((h.netPnlTry ?? h.pnl ?? 0) < 0) consecutiveLosses++
      else break
    }
    const isWhipsawCooling = consecutiveLosses >= 2

    const minTradeFloor = isRealAccount ? 15 : 10
    // Otomasyon 2 DEVRE DIŞI: Yeni otomatik alım yapmaz, sadece kullanıcı emirleri veya kapatma çalışır
    const otomasyon2Disabled = true
    if (!otomasyon2Disabled && isBotActive && availableSlots > 0 && botState.balanceTry >= minTradeFloor) {
      const candidates = marketItems
        .filter((item: any) => {
          if (botState.strategy.memeCoinsOnly && !item.isMeme) return false
          const alreadyOpen = botState.positions.some((p) => p.symbol === item.symbol)
          if (alreadyOpen) return false

          // Son 45 dakikada bu coinden çıkıldıysa hemen yeniden girme (FOMO / Testere Engeli)
          const recentExit = botState.history.find((h) => h.symbol === item.symbol)
          if (recentExit) {
            const timeSinceExitMs = recentExit.closedTimestamp
              ? Date.now() - recentExit.closedTimestamp
              : (recentExit.openedTimestamp ? Date.now() - recentExit.openedTimestamp : 0)
            if (timeSinceExitMs > 0 && timeSinceExitMs < 45 * 60 * 1000) return false
          }

          // ⚠️ TELAFİ & SIFIR MAKAS MODU: Sadece Binance TR'nin en derin tahtalı Tier-1 likit coinlerine izin ver
          const isRecovery = botState.strategy.recoveryMode ?? true
          const TIER1_SYMBOLS = new Set(["SOL", "AVAX", "XRP", "DOGE", "SUI", "PEPE", "NEAR", "RENDER", "LINK", "BTC", "SHIB", "BONK", "FLOKI", "BOME", "CHZ"])
          if (isRecovery && !TIER1_SYMBOLS.has(item.symbol)) return false

          return true
        })
        .map((item: any) => ({
          ...item,
          opp: calculateOpportunityScore(item, botState.strategy.rsiBuyThreshold || 38, fearGreed?.value || 50)
        }))
        .filter((item: any) => {
          // Trend modunda 1H ayıysa alma
          if (item.opp.mode === "TREND" && item.tech1h?.isBearish) return false
          // Soğutma modundayken trend takip alımları yasak, sadece dip aranır ve yüksek güven istenir
          if (isWhipsawCooling) {
            if (item.opp.mode === "TREND") return false
            return item.opp.score >= 68
          }
          const isRecovery = botState.strategy.recoveryMode ?? true
          return item.opp.score >= (isRecovery ? 65 : 55)
        })
        .sort((a: any, b: any) => b.opp.score - a.opp.score)

      if (candidates.length > 0) {
        const best = candidates[0]
        let tradeAmount = calcDynamicAmount(best.opp.score)
        if (tradeAmount > botState.balanceTry) {
          tradeAmount = Math.floor(botState.balanceTry * 0.98)
        }
        if (tradeAmount >= minTradeFloor && botState.balanceTry >= tradeAmount) {
          const modeEmoji = best.opp.mode === "TREND" ? "📈 TREND" : best.opp.mode === "DIP" ? "🔴 DİP AVCSISI" : "⚡ ALIM"
          const aggLabel = botState.strategy.dynamicSizing
            ? ` [Tutar: ${tradeAmount.toLocaleString("tr-TR")} ₺, Skor: ${best.opp.score}/100]`
            : ""
          openPosition(
            best.symbol,
            best.name,
            best.price,
            tradeAmount,
            "INDICATOR",
            `🤖 ${modeEmoji} → ${best.opp.reason}${aggLabel}`
          )
        }
      }
    }
  }, [marketItems, botState.active, botState.positions, availableSlots, baseSlotAmount, openPositionsValue, btcChange, isBtcDropping, fearGreed])


  function handleAddTrigger(e: React.FormEvent) {
    e.preventDefault()
    const targetNum = parseFloat(trigTarget)
    const amountNum = parseFloat(trigAmount)
    if (!targetNum || targetNum <= 0 || !amountNum || amountNum <= 0) return
    const selectedCrypto = WATCHED_CRYPTOS.find((c) => c.symbol === trigSymbol)
    const newTrig: ManualOrderTrigger = {
      id: "trig-" + Date.now(),
      symbol: trigSymbol,
      name: selectedCrypto?.name || trigSymbol,
      targetPrice: targetNum,
      direction: trigDirection,
      action: trigAction,
      amountTry: amountNum,
      active: true,
      createdAt: new Date().toLocaleTimeString("tr-TR"),
    }
    setBotState((prev) => ({ ...prev, manualTriggers: [newTrig, ...prev.manualTriggers] }))
    addLog("ALERT", "YENİ LİMİT HEDEF KURULDU: " + trigSymbol + " " + (trigDirection === "BELOW" ? "altına düşerse" : "üstüne çıkarsa") + " " + fmt(amountNum) + " ₺ " + trigAction, trigSymbol)
    setTrigTarget("")
  }

  function handleResetPortfolio() {
    const isReal = botState.binance?.connected && botState.binance?.accountType === "REAL"
    const confirmMsg = isReal
      ? "Gerçek hesap portföyü ve açık pozisyonlar sıfırlansın mı? Bakiye tahsis edilen tutara dönecektir."
      : "Sanal portföy ve işlem geçmişi sıfırlansın mı?"

    if (confirm(confirmMsg)) {
      const resetBal = isReal && botState.binance?.realBalanceTry ? botState.binance.realBalanceTry : 50000
      const nextState = {
        ...botState,
        balanceTry: resetBal,
        initialBalanceTry: resetBal,
        positions: [],
        history: [],
      }
      setBotState(nextState)
      fetch("/api/bot/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balance: resetBal, initialBalance: resetBal, history: [], positions: [] }),
      }).catch(() => {})
      addLog("INFO", `Portföy ve bakiye ${resetBal.toLocaleString("tr-TR")} ₺ olarak sıfırlandı.`)
    }
  }

  function handleClearHistory() {
    if (!confirm("Tüm geçmiş işlem kayıtları ve kâr/zarar istatistikleri sıfırlansın mı?")) return
    setBotState((prev) => ({ ...prev, history: [] }))
    fetch("/api/bot/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history: [] }),
    }).catch(() => {})
    addLog("INFO", "İşlem geçmişi ve kâr/zarar istatistikleri sıfırlandı.")
  }

  return (
    <section className="mx-auto w-full max-w-6xl space-y-4 px-2 sm:px-0">

      {/* ══════════════════════════════════════════════════════════════════
          YASAL SORUMLULUK REDDİ MODALI
          Yalnızca ilk kez gösterilir. localStorage'a onay yazılınca
          bir daha asla açılmaz.
      ══════════════════════════════════════════════════════════════════ */}
      {disclaimerVisible && (
        <div
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center p-4",
            "bg-black/60 backdrop-blur-md",
            "transition-opacity duration-300",
            disclaimerAccepted ? "opacity-0 pointer-events-none" : "opacity-100"
          )}
        >
          <div
            className={cn(
              "relative w-full max-w-lg rounded-2xl border border-warning/40 bg-card shadow-2xl",
              "animate-in fade-in zoom-in-95 duration-300",
              "max-h-[90vh] overflow-y-auto"
            )}
          >
            {/* Başlık */}
            <div className="sticky top-0 rounded-t-2xl bg-card border-b border-border/60 px-6 py-4 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 ring-1 ring-warning/40">
                <AlertTriangle className="size-5 text-warning" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">Yasal Sorumluluk Reddi & Risk Bildirimi</h2>
                <p className="text-[11px] text-muted-foreground">Lütfen dikkatlice okuyunuz — devam etmek için onay gereklidir</p>
              </div>
            </div>

            {/* İçerik */}
            <div className="px-6 py-5 space-y-4 text-[13px] leading-relaxed text-muted-foreground">
              <div className="rounded-lg border border-warning/30 bg-warning/8 p-3.5 space-y-2">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <span className="text-warning">⚠️</span> Yatırım Tavsiyesi Değildir
                </p>
                <p>Bu platform ve içindeki otonom bot sistemi; <b className="text-foreground">yatırım danışmanlığı, portföy yönetimi veya finansal tavsiye</b> niteliği taşımamaktadır. Türkiye Cumhuriyet Merkez Bankası, SPK, BDDK veya herhangi bir düzenleyici kurum tarafından lisanslanmamış veya denetlenmemektedir.</p>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-foreground">📌 Kripto Para Yatırımlarının Temel Riskleri</p>
                <ul className="space-y-1.5 list-none pl-0">
                  {[
                    "Kripto para piyasaları yüksek volatilite içerir; varlık değeriniz kısa sürede önemli ölçüde azalabilir veya sıfıra yaklaşabilir.",
                    "Geçmiş performans verisi, gelecekteki sonuçların bir garantisi değildir. Bot algoritmasının her koşulda kâr üretmesi beklenemez.",
                    "Otomatik alım-satım sistemleri; teknik arızalar, API hataları, internet kesintileri veya piyasa koşulları nedeniyle beklenmeyen sonuçlar doğurabilir.",
                    "Yatırım için yalnızca kaybetmeyi göze aldığınız sermayeyi kullanınız. Tüm birikimlerinizi ya da borç aldığınız parayı kripto piyasalarına yatırmayınız.",
                    "Türkiye'de kripto varlıklar ödeme aracı olarak kabul edilmemekte; vergi ve hukuki yükümlülüklerinizi takip etmek kullanıcının sorumluluğundadır.",
                  ].map((text, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 size-1.5 rounded-full bg-warning/70 mt-1.5" />
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-foreground">🔒 API Anahtarı & Güvenlik</p>
                <p>Binance API anahtarlarınız <b className="text-foreground">yalnızca tarayıcınızda AES-256 ile şifreli</b> olarak saklanır; hiçbir sunucuya, veri tabanına veya üçüncü tarafa iletilmez. Ancak API anahtarlarınızın korunması ve güvenliği kullanıcının sorumluluğundadır.</p>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-foreground">⚖️ Sorumluluk Sınırlaması</p>
                <p>Bu platformun geliştiricileri ve işletmecileri; kullanıcıların otonom bot aracılığıyla gerçekleştirdiği işlemlerden kaynaklanan <b className="text-foreground">herhangi bir maddi kayıp, kar kaybı veya zarara</b> karşı hiçbir hukuki sorumluluk kabul etmemektedir.</p>
              </div>
            </div>

            {/* Onay alanı */}
            <div className="sticky bottom-0 rounded-b-2xl bg-card border-t border-border/60 px-6 py-4 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={disclaimerChecked}
                  onChange={(e) => setDisclaimerChecked(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-primary cursor-pointer"
                />
                <span className="text-[12px] leading-relaxed text-foreground group-hover:text-foreground/80 transition-colors">
                  Yukarıdaki <b>Yasal Sorumluluk Reddi ve Risk Bildirimini</b> okudum, anladım ve kripto para piyasalarındaki tüm işlem kararlarının ve mali riskin <b>münhasıran bana ait</b> olduğunu kabul ediyorum.
                </span>
              </label>
              <Button
                onClick={handleAcceptDisclaimer}
                disabled={!disclaimerChecked}
                className={cn(
                  "w-full font-bold transition-all",
                  disclaimerChecked
                    ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20"
                    : "opacity-50 cursor-not-allowed"
                )}
              >
                {disclaimerChecked ? "✓ Okudum, Anladım — Devam Et" : "Onaylamak için yukarıdaki kutuyu işaretleyin"}
              </Button>
              <p className="text-center text-[10px] text-muted-foreground">
                Bu bildirim bir daha gösterilmeyecektir.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* MOD GÖSTERGE VE UYARI ŞERİDİ (GERÇEK VS DEMO FARKINI ÇOK BELİRGİN YAP) */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 px-4 py-2 rounded-xl text-xs font-bold border shadow-inner transition-all",
          isRealAccount
            ? "border-positive/80 bg-positive/15 text-positive shadow-[0_0_20px_color-mix(in_oklch,var(--positive)_25%,transparent)]"
            : "border-warning/60 bg-warning/10 text-warning"
        )}
      >
        <div className="flex items-center gap-2">
          <span className={cn("size-3 rounded-full animate-pulse", isRealAccount ? "bg-positive" : "bg-warning")} />
          <span className="font-mono text-sm tracking-wider uppercase">
            {isRealAccount ? "🟢 CANLI MOD: BİNANCE GERÇEK PARA KULLANILIYOR" : "🧪 SANAL DEMO MODU: RİSKSİZ TEST EDİLİYOR"}
          </span>
          <span className="text-[11px] opacity-80 hidden sm:inline">
            {isRealAccount
              ? `(Toplam Cüzdan: ${fmtCurrency(effectiveTotalPortfolio)} ₺ | Serbest Nakit: ${fmtCurrency(botState.balanceTry)} ₺)`
              : `(Sanal Portföy: ${fmtCurrency(effectiveTotalPortfolio)} ₺ | Serbest: ${fmtCurrency(botState.balanceTry)} ₺)`
            }
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowApiModal(true)}
          className={cn("h-7 px-2.5 text-[11px] font-bold border", isRealAccount ? "border-positive/50 text-positive hover:bg-positive/20" : "border-warning/50 text-warning hover:bg-warning/20")}
        >
          {isRealAccount ? "⚙️ Binance Hesabı & Cüzdan" : "⚙️ Sanal Demo Ayarı (10k-50k)"}
        </Button>
      </div>

      <div className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 shadow-sm backdrop-blur transition-all",
        isRealAccount
          ? "border-positive/40 bg-card/90 shadow-[0_0_25px_color-mix(in_oklch,var(--positive)_15%,transparent)]"
          : "border-warning/30 bg-card/80"
      )}>

        <div className="flex items-center gap-3">
          <div className={cn(
            "flex size-11 items-center justify-center rounded-xl ring-1",
            isRealAccount ? "bg-positive/20 text-positive ring-positive/50" : "bg-warning/15 text-warning ring-warning/30"
          )}>
            <Bot className="size-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">Binance TL Otonom Kripto Botu</h1>
              <Badge variant="outline" className="border-rose-500/60 bg-rose-500/10 text-rose-400 font-mono text-[10px] font-black px-2 py-0.5 shadow-xs">
                🛑 DEVRE DIŞI
              </Badge>
              <Badge variant="outline" className={cn("font-mono text-[10px] font-bold px-2 py-0.5 shadow-sm", isRealAccount ? "border-positive bg-positive/20 text-positive font-black" : "border-warning bg-warning/15 text-warning")}>
                {isRealAccount ? "🟢 GERÇEK HESAP" : "🧪 SİMÜLASYON TESTİ"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">Bu otomasyon motoru devre dışı bırakılmıştır. Yeni PaperBot AI otomasyonu kullanılmaktadır.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={botState.binance?.connected ? "outline" : "default"} onClick={() => setShowApiModal(true)} className={cn("gap-1.5 text-xs font-bold", isRealAccount ? "border-positive/50 text-positive hover:bg-positive/10" : "border-primary/40")}>
            <Key className="size-3.5 text-primary" />
            {botState.binance?.connected ? (isRealAccount ? "🟢 " : "🧪 ") + (botState.binance.accountName || "Bağlı") : "Binance API / Para Bağla"}
          </Button>
          <Button size="sm" variant={botState.active ? "default" : "secondary"} onClick={() => {
            const next = !botState.active
            setBotState((p) => ({ ...p, active: next }))
            fetch("/api/bot/state", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ active: next, strategy: { ...botState.strategy, autoPilot: next } }),
            }).catch(() => {})
            addLog("INFO", next ? "BOT 7/24 OTONOM ÇALIŞTIRILDI: Sermaye dağıtımı ve fırsat tarayıcısı devrede." : "BOT DURDURULDU.")
          }} className={cn("gap-1.5 font-bold transition-all shadow-md", botState.active ? "bg-positive hover:bg-positive/90 text-positive-foreground shadow-positive/20" : "border-border text-muted-foreground")}>
            {botState.active ? (<><span className="relative flex size-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75"></span><span className="relative inline-flex size-2 rounded-full bg-white"></span></span><Pause className="size-3.5" />OTONOM ÇALIŞIYOR (7/24)</>) : (<><Play className="size-3.5" />OTONOM BOT'U BAŞLAT</>)}
          </Button>

          {/* ⚡ KALDIRAÇ BUTONU */}
          <div className="relative">
            <Button
              size="sm"
              onClick={() => setShowLeveragePanel((p) => !p)}
              className={cn(
                "gap-1.5 font-bold text-xs border transition-all shadow-md",
                leverageMode
                  ? "bg-orange-500 hover:bg-orange-600 text-white border-orange-400 shadow-orange-500/30 ring-1 ring-orange-400/50"
                  : "bg-background border-orange-500/60 text-orange-400 hover:bg-orange-500/10"
              )}
            >
              <Zap className="size-3.5" />
              {leverageMode ? `⚡ KALDIRAÇ AKTİF (${leverageX}x)` : "⚡ Kaldıraç"}
            </Button>

            {/* Mini kaldıraç paneli */}
            {showLeveragePanel && (
              <div className="absolute top-full left-0 mt-1.5 z-50 w-64 rounded-xl border border-orange-500/40 bg-card/95 backdrop-blur-md shadow-2xl shadow-orange-900/20 p-3 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-border/50">
                  <span className="text-xs font-black text-orange-400 flex items-center gap-1.5">
                    <Zap className="size-3.5" /> Kaldıraç Modu
                  </span>
                  <Badge variant="outline" className={cn("font-mono text-[9px] font-bold", leverageMode ? "border-orange-500 text-orange-400 bg-orange-500/10" : "border-border text-muted-foreground")}>
                    {leverageMode ? `${leverageX}x AKTİF` : "KAPALI"}
                  </Badge>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold block">Kaldıraç Katsayısı Seç:</span>
                  <div className="grid grid-cols-5 gap-1">
                    {[2, 3, 5, 10, 20].map((x) => (
                      <button
                        key={x}
                        onClick={() => changeLeverageX(x)}
                        className={cn(
                          "rounded-lg py-1.5 text-xs font-black border transition-all",
                          leverageX === x
                            ? "bg-orange-500 text-white border-orange-400"
                            : "bg-background border-border text-muted-foreground hover:border-orange-500/50 hover:text-orange-400"
                        )}
                      >
                        {x}x
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 p-2 text-[10px] text-orange-300 leading-relaxed">
                  <b>Etki:</b> Mevcut sermayenin <b>{leverageX}x</b>'i kadar simüle pozisyon büyüklüğü. Kâr ve zarar da <b>{leverageX}x</b> çarpanıyla hesaplanır.
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => { toggleLeverage(); setShowLeveragePanel(false) }}
                    className={cn(
                      "flex-1 font-bold text-xs h-8",
                      leverageMode
                        ? "bg-muted text-muted-foreground hover:bg-muted/80"
                        : "bg-orange-500 hover:bg-orange-600 text-white"
                    )}
                  >
                    {leverageMode ? "⏸ Kaldıracı Kapat" : `⚡ ${leverageX}x Kaldıraç Aç`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowLeveragePanel(false)} className="text-xs h-8 px-2">✕</Button>
                </div>

                <p className="text-[9px] text-muted-foreground/60 leading-relaxed">
                  ⚠️ Bu UI simülasyonu bir eğitim aracıdır; gerçek borsa kaldıraçlı/vadeli işlem DEĞİLDİR.
                </p>
              </div>
            )}
          </div>

          {(botState.positions.length > 0 || (isRealAccount && effectiveCryptoValue > 20)) && (
            <Button
              size="sm"
              variant="destructive"
              disabled={isLiquidatingAll}
              onClick={handleLiquidateEverything}
              className="gap-1.5 font-bold text-xs bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-500/20"
            >
              {isLiquidatingAll ? <Loader2 className="size-3.5 animate-spin" /> : <TrendingDown className="size-3.5" />}
              🚨 Tümünü Sat & Nakite Geç {botState.positions.length > 0 ? `(${botState.positions.length})` : ""}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onBack}>Terminale Dön</Button>
        </div>

      </div>

      <div className={cn(
        "rounded-xl border p-4 shadow-sm transition-all",
        isRealAccount
          ? "border-positive/50 bg-gradient-to-r from-positive/10 via-card to-background shadow-[0_0_25px_color-mix(in_oklch,var(--positive)_10%,transparent)]"
          : "border-warning/40 bg-gradient-to-r from-warning/10 via-card to-background"
      )}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2.5">
            <Layers className={cn("size-5", isRealAccount ? "text-positive" : "text-warning")} />
            <div>
              <b className="text-sm text-foreground flex items-center gap-2">
                <span>Akıllı Sermaye Dağıtıcısı ({displaySlotsCount} Yuvalı Risk Koruması)</span>
                <Badge variant="outline" className={cn("text-[9px] font-mono px-1.5 py-0", isRealAccount ? "border-positive text-positive bg-positive/10 font-bold" : "border-warning text-warning bg-warning/10")}>
                  {isRealAccount ? "🟢 CANLI GERÇEK İŞLEM" : "🧪 SANAL SİMÜLASYON"}
                </Badge>
              </b>
              <p className="text-xs text-muted-foreground">Paran tek bir coine basılmaz; bot sermayeni {displaySlotsCount} eşit parçaya böler ve makro trendi en güçlü coinlere dağıtır</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-[11px] text-muted-foreground">Yuva Başına Tutar:</span>
              <p className="font-mono text-xs font-bold text-foreground">{fmtCurrency(dynamicSlotAmount)} ₺ / İşlem</p>
            </div>
            {currentOpenCount > 0 && (
              <Button
                variant="destructive"
                size="sm"
                disabled={isLiquidatingAll}
                onClick={handleLiquidateEverything}
                className="h-6 px-2 text-[10px] font-bold gap-1 shadow-sm"
              >
                {isLiquidatingAll ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                Yuvaları Kapat & Nakite Geç
              </Button>
            )}
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border/60">
              {[1, 2, 3, 4].map((cnt) => (
                <button
                  key={cnt}
                  onClick={() => {
                    setBotState((p) => {
                      const nextStrat = { ...p.strategy, maxConcurrentPositions: cnt }
                      syncStrategyToServer(nextStrat)
                      return { ...p, strategy: nextStrat }
                    })
                  }}
                  className={cn(
                    "px-2 py-0.5 text-xs font-mono font-bold rounded transition-all",
                    maxSlots === cnt
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {cnt} Yuva
                </button>
              ))}
            </div>

            <Badge variant="outline" className={cn("font-mono text-xs font-bold px-2 py-1", isRealAccount ? "border-positive/60 text-positive" : "border-warning/60 text-warning")}>
              {currentOpenCount} / {displaySlotsCount} YUVA DOLU
            </Badge>
          </div>
        </div>
        <div className={cn("mt-3 grid gap-2.5", displaySlotsCount === 1 ? "grid-cols-1 max-w-md mx-auto" : displaySlotsCount === 2 ? "sm:grid-cols-2" : displaySlotsCount === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
          {Array.from({ length: displaySlotsCount }).map((_, idx) => {
            const openPos = botState.positions[idx]
            if (openPos) {
              const safePnl = Number.isFinite(Number(openPos.pnl)) ? Number(openPos.pnl) : 0
              const safePnlPct = Number.isFinite(Number(openPos.pnlPercent)) ? Number(openPos.pnlPercent) : 0
              const isProfit = safePnl >= 0
              return (
                <div key={openPos.id} className="rounded-lg border border-primary/40 bg-card p-3 text-xs space-y-1.5 shadow-sm">
                  <div className="flex items-center justify-between font-mono">
                    <span className="flex items-center gap-1.5 font-bold text-foreground"><span className="size-2 rounded-full bg-positive animate-pulse" />Yuva #{idx + 1}: {openPos.symbol}</span>
                    <span className={cn("font-bold", isProfit ? "text-positive" : "text-negative")}>{isProfit ? "+" : ""}{fmtCurrency(safePnl)} ₺ ({isProfit ? "+" : ""}%{safePnlPct.toFixed(2)})</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Yatırılan: {fmtCurrency(openPos.totalTry)} ₺</span>
                    <span>Giriş: {fmt(openPos.entryPrice)} ₺</span>
                  </div>
                  <div className="pt-1 flex items-center justify-between text-[10px] border-t border-border/60">
                    <span className="text-primary font-medium">Hedef: %{botState.strategy.defaultTakeProfitPct} Scalp</span>
                    <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-negative" onClick={() => closePosition(openPos.id, openPos.currentPrice, "Kullanıcı Erken Çıkış")}>Kapat</Button>
                  </div>
                </div>
              )
            }
            return (
              <div key={idx} className="rounded-lg border border-dashed border-border/80 bg-muted/10 p-3 text-xs flex flex-col justify-between space-y-2">
                <div className="flex items-center justify-between font-mono text-muted-foreground">
                  <span className="flex items-center gap-1.5 font-semibold"><span className="size-2 rounded-full bg-muted" />Yuva #{idx + 1}: BOŞ (HAZIR)</span>
                  <Badge variant="outline" className="text-[9px] py-0 px-1 border-border">FIRSAT GÖZETLENİYOR</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground leading-tight">Bot en yüksek kâr potansiyeline (RSI dip + Altın Oran) sahip coin bulduğunda <b>{fmtCurrency(dynamicSlotAmount)} ₺</b> ile otomatik alacak.</p>
                <div className="text-[10px] text-primary flex items-center gap-1 font-medium"><Sparkles className="size-3" />Oto-Pilot Hazırda Bekliyor</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── PİYASA DUYGU, HABER & ÇOKLU ZAMAN DİLİMİ RADARI ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-gradient-to-r from-card/95 via-card/70 to-card/95 p-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex size-10 items-center justify-center rounded-lg font-bold shadow-xs",
            (fearGreed?.value ?? 50) >= 55 ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" :
            (fearGreed?.value ?? 50) <= 35 ? "bg-rose-500/15 text-rose-400 border border-rose-500/30" :
            "bg-amber-500/15 text-amber-400 border border-amber-500/30"
          )}>
            <Newspaper className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                Piyasa Duygu & Haber Radarı
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </span>
              <Badge variant="outline" className={cn(
                "text-[10px] font-mono font-bold px-2 py-0.5 border",
                (fearGreed?.value ?? 50) >= 55 ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10" :
                (fearGreed?.value ?? 50) <= 35 ? "border-rose-500/40 text-rose-400 bg-rose-500/10" :
                "border-amber-500/40 text-amber-400 bg-amber-500/10"
              )}>
                {fearGreed?.value ?? 73}/100 · {
                  (fearGreed?.value ?? 50) >= 75 ? "Aşırı Açgözlülük (Tepe Riski)" :
                  (fearGreed?.value ?? 50) >= 55 ? "Açgözlülük (Boğa Eğilimi)" :
                  (fearGreed?.value ?? 50) <= 25 ? "Aşırı Korku (Panik Satışı)" :
                  (fearGreed?.value ?? 50) <= 45 ? "Korku (Temkinli)" : "Nötr Piyasa"
                }
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {fearGreed?.value && fearGreed.value <= 25
                ? "⚠️ Piyasa aşırı korkuda: Bot sahte kırılımları engelliyor, yalnızca teyitli derin dip dönüşlerini bekliyor."
                : fearGreed?.value && fearGreed.value >= 75
                ? "⚡ Piyasa aşırı alımda: Tepe alımları kilitlendi, sadece hacimli ve 24s/1H/1A trend teyitli coinler seçiliyor."
                : "🟢 Piyasa duygu akışı pozitif: 5d mumlar + 24s + 1H + 1A makro trend teyitli ve ucuz koinler taranıyor."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground ml-auto">
          <span className="px-2.5 py-1 rounded bg-muted/40 border border-border/60 flex items-center gap-1.5 font-medium">
            <Sparkles className="size-3 text-amber-400" /> 🎯 5d + 24s + 1H + 1A Makro Teyit
          </span>
          <span className="px-2.5 py-1 rounded bg-muted/40 border border-border/60 flex items-center gap-1.5 font-medium">
            🪙 &lt;10 ₺ Öncelikli
          </span>
        </div>
      </div>

      {/* ── TELAFİ & 10.000 ₺ NET KÂR YOL HARİTASI KALKANI ── */}
      <div className="rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-500/10 via-card to-emerald-500/5 p-3.5 shadow-sm space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold shadow-xs">
              {totalPnlTry >= 0 ? <Award className="size-5 text-amber-400" /> : <ShieldCheck className="size-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  {totalPnlTry >= 0 ? "🏆 10.000 ₺ Kâr Hedefi & Bileşik Büyüme Motoru" : "🛡️ Zarar Telafi & Kâra Geçiş Kalkanı"}
                </span>
                <Badge variant="outline" className="text-[9px] border-emerald-500/50 text-emerald-400 bg-emerald-500/15 font-bold font-mono">
                  {totalPnlTry >= 0 ? "BİLEŞİK BÜYÜME (10.000 ₺ HEDEFİ)" : "TELAFİ MODU (Tier-1)"}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {totalPnlTry >= 0
                  ? "Kazanılan kârlar sermayeye eklenerek slot büyüklüğü katlanır. Disiplinli Tier-1 scalp işlemleriyle 10.000 ₺ kâr hedefine ilerleniyor."
                  : "50 ₺ kayıp telafi edilip kalıcı kâra geçilene kadar bot yalnızca en derin tahtalı Tier-1 coinlerde (SOL, AVAX, XRP, SUI, DOGE, PEPE, BTC) sıfır makasla ve +%0.65 Komisyon Kalkanı ile işlem açar."
                }
              </p>
            </div>
          </div>
          <div className="text-right font-mono">
            <span className="text-[10px] text-muted-foreground block">{totalPnlTry >= 0 ? "10.000 ₺ Hedef Kalan:" : "Telafi Kalan:"}</span>
            <span className={cn("text-xs font-bold", totalPnlTry >= 10000 ? "text-emerald-400" : totalPnlTry >= 0 ? "text-primary" : "text-amber-400")}>
              {totalPnlTry >= 10000
                ? "🎉 10.000 ₺ KÂR HEDEFİ BAŞARILDI! 🚀"
                : totalPnlTry >= 0
                ? `${fmtCurrency(Math.max(0, 10000 - totalPnlTry))} ₺ (${((totalPnlTry / 10000) * 100).toFixed(1)}%)`
                : `${Math.abs(Math.min(0, totalPnlTry)).toFixed(2)} ₺ Kaldı`
              }
            </span>
          </div>
        </div>

        {/* İlerleme Çubuğu */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
            <span>{totalPnlTry >= 0 ? "Başlangıç: 0 ₺" : "Geçmiş Kayıp: -50.00 ₺"}</span>
            <span className="font-bold text-foreground">
              {totalPnlTry >= 10000
                ? "100% (10K ULAŞILDI)"
                : totalPnlTry >= 0
                ? `%${((totalPnlTry / 10000) * 100).toFixed(1)} / 10.000 ₺`
                : `%${Math.max(0, Math.min(100, Math.round(((50 + totalPnlTry) / 50) * 100)))} Telafi`
              }
            </span>
            <span className="text-emerald-400 font-bold">{totalPnlTry >= 0 ? "🎯 10.000 ₺ Hedefi" : "Hedef: Net Kâr 🎯"}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden border border-border/40">
            <div
              className="h-full bg-gradient-to-r from-amber-500 via-emerald-500 to-emerald-400 transition-all duration-500"
              style={{
                width: `${totalPnlTry >= 10000 ? 100 : totalPnlTry >= 0 ? Math.max(3, Math.min(100, (totalPnlTry / 10000) * 100)) : Math.max(8, Math.min(100, ((50 + totalPnlTry) / 50) * 100))}%`
              }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card size="sm" className={cn("border transition-all relative overflow-hidden", isRealAccount ? "border-positive/50 bg-positive/5" : "border-warning/40 bg-warning/5")}>
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-medium">{isRealAccount ? "Binance TR Portföyü (Canlı)" : "Sanal Portföy"}</CardDescription>
              <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 font-mono font-bold uppercase", isRealAccount ? "border-positive text-positive bg-positive/10" : "border-warning text-warning bg-warning/10")}>
                {isRealAccount ? "CANLI SPOT" : "DEMO"}
              </Badge>
            </div>
            <CardTitle className={cn("font-mono text-2xl font-black tracking-tight", isRealAccount ? "text-positive" : "text-foreground")}>
              {fmtCurrency(effectiveTotalPortfolio)} ₺
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1 text-[11px]">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center gap-1 font-medium">
                <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
                Serbest Nakit (TRY):
              </span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-bold text-foreground">{fmtCurrency(botState.balanceTry)} ₺</span>
                <button
                  type="button"
                  title={isRealAccount ? "Binance TR Bakiyesini Şimdi Güncelle" : "Sanal Demo Bakiyesini Eşitle / Düzelt"}
                  disabled={isRefreshingBalance}
                  onClick={handleRefreshBalanceNow}
                  className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                >
                  <RefreshCw className={cn("size-3", isRefreshingBalance && "animate-spin")} />
                </button>
              </div>
            </div>
            {isRealAccount && (botState.binance?.lockedTry ?? 0) > 0 && (
              <div className="flex items-center justify-between text-muted-foreground border-t border-border/40 pt-1 text-[10px]">
                <span className="flex items-center gap-1 font-medium text-amber-500">
                  <span className="size-1.5 rounded-full bg-amber-500 inline-block" />
                  Açık Emirde (Kilitli):
                </span>
                <span className="font-mono font-bold text-amber-500">{fmtCurrency(botState.binance?.lockedTry || 0)} ₺</span>
              </div>
            )}
            <div className="flex items-center justify-between text-muted-foreground border-t border-border/40 pt-1">
              <span className="flex items-center gap-1 font-medium">
                <span className="size-1.5 rounded-full bg-blue-500 inline-block" />
                {isRealAccount ? "Kripto Varlıklar:" : "İşlemdeki Pozisyonlar:"}
              </span>
              <span className="font-mono font-bold text-foreground">{fmtCurrency(effectiveCryptoValue)} ₺</span>
            </div>
            {isRealAccount && (botState.binance?.usdtFree ?? 0) > 0.05 && (
              <div className="flex items-center justify-between text-muted-foreground border-t border-border/40 pt-1 text-[10px]">
                <span className="flex items-center gap-1 font-medium text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-400 inline-block" />
                  Cüzdandaki USDT:
                </span>
                <span className="font-mono font-bold text-emerald-400">
                  ${(botState.binance?.usdtFree || 0).toFixed(2)} (~{fmtCurrency(botState.binance?.usdtTryValue || ((botState.binance?.usdtFree || 0) * usdTryRate))} ₺)
                </span>
              </div>
            )}
            {isRealAccount && botState.balanceTry < 10 && (botState.binance?.usdtFree ?? 0) >= 1 && (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-1.5 text-[10px] space-y-1 mt-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-amber-400 font-semibold truncate">Serbest TRY yetersiz (&lt;10 ₺)</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sellingAsset === "USDT"}
                    onClick={() => handleSellSingleWalletAsset("USDT", botState.binance!.usdtFree!)}
                    className="h-5 px-1.5 text-[9px] font-bold border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/20 shrink-0"
                  >
                    ⚡ USDT Bozdur
                  </Button>
                </div>
              </div>
            )}
            {isRealAccount && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2 h-7 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border-emerald-500/30 font-mono py-0 px-2 flex items-center justify-center gap-1.5 font-bold shadow-sm"
                onClick={() => {
                  handleScanWalletAssets()
                  setShowWalletRecoveryModal(true)
                }}
              >
                <Coins className="size-3.5 text-emerald-400" />
                Cüzdandaki Coinleri Gör & Bozdur
              </Button>
            )}
          </CardContent>
        </Card>

        <Card size="sm" className={cn("border bg-card/60 transition-all", totalPnlTry >= 0 ? "border-positive/40 bg-positive/5" : "border-negative/40 bg-negative/5")}>
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-medium">Toplam Net Kâr / Zarar</CardDescription>
              <span className={cn("text-[10px] font-mono font-bold px-1.5 py-0.5 rounded", totalPnlTry >= 0 ? "text-positive bg-positive/10" : "text-negative bg-negative/10")}>
                {totalPnlPct >= 0 ? "+" : ""}%{(totalPnlPct ?? 0).toFixed(2)}
              </span>
            </div>
            <CardTitle className={cn("font-mono text-2xl font-black flex items-center gap-1.5 tracking-tight", totalPnlTry >= 0 ? "text-positive" : "text-negative")}>
              {totalPnlTry >= 0 ? <TrendingUp className="size-5" /> : <TrendingDown className="size-5" />}
              {totalPnlTry >= 0 ? "+" : ""}{fmtCurrency(totalPnlTry)} ₺
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Kapanan Kâr:</span>
              <span className={cn("font-mono font-bold", realizedPnlTry >= 0 ? "text-positive" : "text-negative")}>
                {realizedPnlTry >= 0 ? "+" : ""}{fmtCurrency(realizedPnlTry)} ₺
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border/40 pt-1">
              <span>Açık Pozisyon:</span>
              <span className={cn("font-mono font-bold", unrealizedPnlTry >= 0 ? "text-positive" : "text-negative")}>
                {unrealizedPnlTry >= 0 ? "+" : ""}{fmtCurrency(unrealizedPnlTry)} ₺
              </span>
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="border-border/60 bg-card/60 transition-all">
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-medium">Slot & Yuva Durumu</CardDescription>
              <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">
                {availableSlots > 0 ? `${availableSlots} BOŞ` : "DOLU"}
              </Badge>
            </div>
            <CardTitle className="font-mono text-xl text-foreground font-bold tracking-tight">
              {botState.positions.length} / {displaySlotsCount} Slot
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-[10px] text-muted-foreground flex items-center justify-between">
            <span>Yuva Başına:</span>
            <span className="font-mono font-bold text-foreground">{fmtCurrency(dynamicSlotAmount)} ₺</span>
          </CardContent>
        </Card>

        <Card size="sm" className="border-border/60 bg-card/60 transition-all">
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-medium">Başarı Oranı (Win)</CardDescription>
              <span className="flex items-center gap-1 text-[10px] text-positive font-bold">
                <span className="size-1.5 rounded-full bg-positive animate-pulse" /> 7/24
              </span>
            </div>
            <CardTitle className="font-mono text-xl text-foreground font-bold tracking-tight">
              %{winRate}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-[10px] text-muted-foreground flex items-center justify-between">
            <span>Tamamlanan:</span>
            <span className="font-mono font-bold text-foreground">{relevantHistory.length} İşlem</span>
          </CardContent>
        </Card>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
        {([
          { id: "slots", label: "🤖 Otonom Slotlar & Genel Bakış", icon: Layers, badge: availableSlots },
          { id: "signals", label: "⚡ Canlı Kripto & Meme Radarı", icon: Flame, badge: marketItems.filter((m: any) => m.proposal).length },
          { id: "positions", label: "💼 Açık Pozisyonlar", icon: DollarSign, badge: botState.positions.length },
          { id: "news", label: "📰 Piyasa & Kripto Haberleri", icon: Newspaper, badge: (terminalNewsData?.news || []).length },
          { id: "triggers", label: "🎯 Özel Limit Emirler", icon: Target, badge: botState.manualTriggers.filter((t: any) => t.active).length },
          { id: "binance", label: "🔑 Binance & Gerçek Para", icon: Key, badge: isRealAccount ? 1 : 0 },
          { id: "strategy", label: "⚙️ Strateji & Slot Ayarları", icon: Sliders, badge: 0 },
          { id: "logs", label: "📜 Bot Terminal Logları", icon: History, badge: botState.logs.length },
        ]).map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id as any)} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all", isActive ? "bg-background text-foreground shadow-sm ring-1 ring-border/80 font-bold" : "text-muted-foreground hover:bg-card/50 hover:text-foreground")}>
              <Icon className="size-3.5" />{tab.label}
              {tab.badge !== undefined && tab.badge > 0 && <span className={cn("ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-mono font-bold", isActive ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>{tab.badge}</span>}
            </button>
          )
        })}
        </div>
      </div>

      {activeTab === "slots" && (
        <div className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]">
          <Card size="sm">
            <CardHeader className="border-b pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Award className="size-4 text-primary" />Botun Anlık Fırsat & Kâr Sıralaması</CardTitle>
                <span className="text-[10px] text-muted-foreground">7/24 Yapay Zeka Skorlaması</span>
              </div>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border/60 text-xs">
              {marketItems.map((crypto: any, rankIdx: number) => {
                const opp = calculateOpportunityScore(crypto, botState.strategy.rsiBuyThreshold || 40)
                const isOpen = botState.positions.some((p) => p.symbol === crypto.symbol)
                return (
                  <div key={crypto.symbol} className="p-3 flex items-center justify-between gap-3 hover:bg-card/50 transition-all">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-xs text-muted-foreground w-4">#{rankIdx + 1}</span>
                      <div>
                        <div className="flex items-center gap-1.5"><b className="font-mono text-sm">{crypto.symbol}</b><Badge variant="outline" className="text-[9px] py-0 px-1">{crypto.badge || "KRİPTO"}</Badge>{isOpen && <span className="text-[10px] text-primary font-bold">✓ İŞLEMDE</span>}</div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{opp.reason}</p>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <p className="font-bold text-foreground">{fmt(crypto.price)} ₺</p>
                      <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", opp.score >= 70 ? "bg-positive/20 text-positive" : opp.score >= 50 ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>{opp.score}/100 Skor</span>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <div className="space-y-3">
            <Card size="sm">
              <CardHeader><CardTitle className="text-sm">Otonom Portföy Kuralları</CardTitle><CardDescription className="text-xs">Botun senin yerine uyguladığı otomatik prensipler</CardDescription></CardHeader>
              <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
                <div className="rounded-lg border border-border/70 p-2.5 space-y-1"><b className="text-foreground">1. Çoklu Slot Risk Dağıtımı:</b><p className="text-[11px]">Tüm para asla tek bir coine basılmaz. Bakiye eşit yuvalara bölünür; biri düzeltme yapsa bile diğerleri kâr yazarak riski dengeler.</p></div>
                <div className="rounded-lg border border-border/70 p-2.5 space-y-1"><b className="text-foreground">2. Makro & 5TF Trend Teyidi:</b><p className="text-[11px]">Tek başına RSI dip alımı yapılmaz! 1 Saatlik ve 1 Aylık makro yönü yukarı olan, ABD enflasyon/istihdam verilerine dirençli coinler seçilir.</p></div>
                <div className="rounded-lg border border-border/70 p-2.5 space-y-1"><b className="text-foreground">3. Eller Serbest Çıkış:</b><p className="text-[11px]">%0.8 kârda stop başabaşa çekilip risk sıfırlanır, takip eden stop ile kâr zirveye kadar sürülür.</p></div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {activeTab === "signals" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/60 p-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">Binance TL Fırsat & Popüler Kripto Radarı (7/24 Kesintisiz)</h2>
              <p className="text-xs text-muted-foreground">Ucuz birim fiyatlı, popüler, yüksek ivmeli ve komisyonu kârın %10'unu geçmeyen varlıklar</p>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-primary/40 bg-primary/5 text-primary text-xs font-mono">USD/TRY: {usdTryRate.toFixed(2)} ₺</Badge>
              <Badge variant="outline" className={cn("font-mono text-xs", botState.strategy.autoPilot ? "border-positive/40 text-positive bg-positive/5" : "text-muted-foreground")}>{botState.strategy.autoPilot ? "⚡ OTO-PİLOT (7/24)" : "✋ MANUEL ONAY"}</Badge>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => scanNow()}>Yenile</Button>
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {marketItems.map((crypto: any) => {
              const hasProposal = Boolean(crypto.proposal)
              const isBuying = crypto.proposal?.side === "BUY"
              const alreadyOpen = botState.positions.some((p) => p.symbol === crypto.symbol)
              return (
                <Card key={crypto.symbol} size="sm" className={cn("relative overflow-hidden transition-all", hasProposal && isBuying && "border-positive/50 bg-positive/5 shadow-md shadow-positive/5", alreadyOpen && "border-primary/40 bg-primary/5")}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5"><b className="font-mono text-sm">{crypto.symbol}</b><Badge variant="outline" className="text-[9px] py-0 px-1">{crypto.badge || "MEME"}</Badge></div>
                      <div className="flex flex-wrap items-center justify-end gap-1 text-right">
                        {typeof crypto.change24h === "number" && (
                          <span className={cn("text-[9px] font-mono font-bold px-1 py-0.5 rounded", crypto.change24h >= 0 ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" : "text-rose-400 bg-rose-500/10 border border-rose-500/20")}>
                            24s: {crypto.change24h >= 0 ? "+" : ""}{crypto.change24h.toFixed(1)}%
                          </span>
                        )}
                        {typeof crypto.change1w === "number" && (
                          <span className={cn("text-[9px] font-mono font-bold px-1 py-0.5 rounded", crypto.change1w >= 0 ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" : "text-rose-400 bg-rose-500/10 border border-rose-500/20")}>
                            1H: {crypto.change1w >= 0 ? "+" : ""}{crypto.change1w.toFixed(1)}%
                          </span>
                        )}
                        {typeof crypto.change1m === "number" && (
                          <span className={cn("text-[9px] font-mono font-bold px-1 py-0.5 rounded", crypto.change1m >= 0 ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" : "text-rose-400 bg-rose-500/10 border border-rose-500/20")}>
                            1A: {crypto.change1m >= 0 ? "+" : ""}{crypto.change1m.toFixed(1)}%
                          </span>
                        )}
                        <span className={cn("font-mono text-xs font-semibold", (crypto.change ?? 0) >= 0 ? "text-positive" : "text-negative")}>{(crypto.change ?? 0) >= 0 ? "+" : ""}{(crypto.change ?? 0).toFixed(2)}%</span>
                      </div>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="font-mono text-base font-bold text-foreground">{fmt(crypto.price)} ₺</span>
                      <span className={cn("rounded px-1.5 py-0.5 font-mono text-[10px] font-bold", crypto.rsi <= 32 ? "bg-positive/20 text-positive" : crypto.rsi >= 68 ? "bg-negative/20 text-negative" : "bg-muted text-muted-foreground")}>RSI: {crypto.rsi ? crypto.rsi.toFixed(1) : "—"}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0 text-[11px]">
                    <div className="flex items-center justify-between text-muted-foreground"><span>Limit Alış Seviyesi:</span><b className="font-mono text-foreground">{fmt(crypto.limitPrice)} ₺</b></div>
                    <div className="flex items-center justify-between text-muted-foreground"><span>Komisyon Kâr Oranı:</span><b className={cn("font-mono", crypto.commissionSafe ? "text-positive" : "text-negative")}>%{crypto.commissionRatio ? crypto.commissionRatio.toFixed(1) : "8.1"} (Max %10)</b></div>
                    {typeof crypto.monthlyRangePos === "number" && (
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Aylık Aralık:</span>
                        <b className={cn("font-mono font-bold", crypto.monthlyRangePos <= 35 ? "text-emerald-400" : crypto.monthlyRangePos >= 80 ? "text-rose-400" : "text-foreground")}>
                          %{crypto.monthlyRangePos.toFixed(0)} ({crypto.monthlyRangePos <= 35 ? "Dip Tabanı 🎯" : crypto.monthlyRangePos >= 80 ? "Zirve ⚠️" : "Orta"})
                        </b>
                      </div>
                    )}
                    {crypto.proposal && (
                      <div className="rounded-md border border-border/60 bg-background/80 p-2 text-[11px]"><div className="flex items-center justify-between font-bold"><span className={isBuying ? "text-positive flex items-center gap-1" : "text-warning"}><Sparkles className="size-3" />{isBuying ? "🟢 LİMİT AL SİNYALİ" : "🟡 KÂR REALİZASYONU"}</span><span className="font-mono text-[10px] text-muted-foreground">%{crypto.proposal.confidence} Güven</span></div><p className="mt-1 text-[10px] text-muted-foreground leading-tight">{crypto.proposal.reason}</p></div>
                    )}
                    <div className="pt-2 border-t border-border/50 space-y-1.5">
                      {alreadyOpen ? (
                        <div className="w-full rounded-md border border-primary/30 bg-primary/10 py-1.5 text-center font-mono text-[11px] font-bold text-primary">
                          ✓ POZİSYON AÇIK
                        </div>
                      ) : (
                        <>
                          <div className="relative">
                            <Input
                              type="number"
                              min="10"
                              step="any"
                              value={customBuyAmounts[crypto.symbol] ?? ""}
                              onChange={(e) => setCustomBuyAmounts((prev) => ({ ...prev, [crypto.symbol]: e.target.value }))}
                              className="h-7 text-xs font-mono font-bold pr-6 bg-background"
                              placeholder="Alış Tutarı (₺) örn: 50"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-bold">₺</span>
                          </div>

                          <Button
                            size="sm"
                            className="w-full h-7 text-xs font-bold gap-1 bg-positive hover:bg-positive/90 text-positive-foreground shadow-sm"
                            disabled={botState.balanceTry < 10}
                            onClick={() => {
                              const inputVal = customBuyAmounts[crypto.symbol]?.trim()
                              const buyAmt = inputVal ? parseFloat(inputVal) : Math.min(botState.balanceTry, dynamicSlotAmount || 35)
                              if (!buyAmt || buyAmt < 10) {
                                alert("Minimum işlem tutarı 10 ₺'dir.")
                                return
                              }
                              if (buyAmt > botState.balanceTry) {
                                alert(`Yetersiz bakiye! Kullanılabilir serbest nakit: ${botState.balanceTry.toFixed(2)} ₺`)
                                return
                              }
                              openPosition(
                                crypto.symbol,
                                crypto.name,
                                crypto.price,
                                buyAmt,
                                "MANUAL",
                                `Kullanıcı Manuel Radar Alımı (${buyAmt} ₺)`
                              )
                            }}
                          >
                            <Zap className="size-3" />
                            {customBuyAmounts[crypto.symbol]?.trim() && parseFloat(customBuyAmounts[crypto.symbol]) > 0
                              ? `${fmt(parseFloat(customBuyAmounts[crypto.symbol]))} ₺ ile Satın Al`
                              : `Hemen Satın Al (${fmt(Math.min(botState.balanceTry, dynamicSlotAmount || 35))} ₺)`}
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {activeTab === "positions" && (
        <Card size="sm">
          <CardHeader className="border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm">Canlı Açık Pozisyonlar ({botState.positions.length})</CardTitle>
              <CardDescription className="text-xs">
                Alınan işlemler; %{botState.strategy.breakevenPct || 1.0} kârda Stop başabaşa (+%0.35 net) kilitlenir, %{botState.strategy.defaultTakeProfitPct || 2.4} hedefte kâr realize edilir.
              </CardDescription>
            </div>
            {botState.positions.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                disabled={isLiquidatingAll}
                className="h-7 text-xs font-bold gap-1 shadow-sm bg-red-600 hover:bg-red-700 text-white"
                onClick={handleLiquidateEverything}
              >
                {isLiquidatingAll ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Tümünü Kapat & Nakite Geç
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {botState.positions.length === 0 ? (<div className="py-12 text-center text-muted-foreground"><p className="text-sm">Şu an açık pozisyon bulunmuyor.</p><p className="text-xs mt-1">Bot sinyal bulduğunda veya "Canlı Meme Coin Radarı"ndan alım yaptığında burada listelenir.</p></div>) : (
              <div className="divide-y divide-border/60">
                {botState.positions.map((pos) => {
                  const safePnl = Number.isFinite(Number(pos.pnl)) ? Number(pos.pnl) : 0
                  const safePnlPct = Number.isFinite(Number(pos.pnlPercent)) ? Number(pos.pnlPercent) : 0
                  const isProfit = safePnl >= 0
                  return (
                    <div key={pos.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
                      <div className="flex items-center gap-3"><div className={cn("size-2 rounded-full", isProfit ? "bg-positive animate-pulse" : "bg-negative")} /><div><div className="flex items-center gap-2"><b className="font-mono text-sm text-foreground">{pos.symbol}</b><Badge variant="outline" className="text-[10px] py-0 font-mono font-bold bg-muted">{pos.orderType || "LİMİT"}</Badge></div><p className="text-[11px] text-muted-foreground">Açılış: {pos.openedAt} · Tutar: {fmt(pos.totalTry)} ₺</p></div></div>
                      <div className="grid grid-cols-2 gap-4 font-mono sm:grid-cols-4">
                        <div><p className="text-[10px] text-muted-foreground">Giriş Fiyatı</p><p className="font-semibold">{fmt(pos.entryPrice)} ₺</p></div>
                        <div><p className="text-[10px] text-muted-foreground">Güncel Fiyat</p><p className="font-semibold">{fmt(pos.currentPrice)} ₺</p></div>
                        <div><p className="text-[10px] text-muted-foreground">SL / TP / Trailing</p><p className="text-[11px]"><span className="text-negative">{fmt(pos.stopLossPrice)} ₺</span> / <span className="text-positive">{fmt(pos.takeProfitPrice)} ₺</span>{pos.trailingStopPrice && pos.trailingStopPrice > pos.stopLossPrice ? <span className="text-primary block font-bold">🛡️ Takip: {fmt(pos.trailingStopPrice)} ₺</span> : null}</p></div>
                        <div><p className="text-[10px] text-muted-foreground">Anlık Kâr / Zarar</p><p className={cn("font-bold", isProfit ? "text-positive" : "text-negative")}>{isProfit ? "+" : ""}{fmt(safePnl)} ₺ ({isProfit ? "+" : ""}%{safePnlPct.toFixed(2)})</p>{pos.highestPrice && pos.highestPrice > pos.entryPrice ? <span className="text-[10px] text-muted-foreground block">Zirve: {fmt(pos.highestPrice)} ₺</span> : null}</div>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 text-xs font-semibold" onClick={() => closePosition(pos.id, pos.currentPrice, "Kullanıcı Manuel Kapatma")}>Pozisyonu Kapat</Button>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "news" && (
        <div className="space-y-3.5">
          {/* Makro & ABD Göstergeleri Barometresi */}
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Card size="sm" className="border-border/60 bg-card/70 backdrop-blur-sm">
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <CardDescription className="text-xs font-medium">ABD TÜFE (Enflasyon)</CardDescription>
                  <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-400">Yıllık</Badge>
                </div>
                <CardTitle className="font-mono text-base font-bold text-foreground">
                  {terminalNewsData?.barometer?.cpiInflation?.value ?? "%2.9 Yıllık"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-[10px] text-muted-foreground leading-tight">
                {terminalNewsData?.barometer?.cpiInflation?.note ?? "Beklentilere paralel, faiz indirim alanını koruyor."}
              </CardContent>
            </Card>

            <Card size="sm" className="border-border/60 bg-card/70 backdrop-blur-sm">
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <CardDescription className="text-xs font-medium">Fed Politika Faizi</CardDescription>
                  <Badge variant="outline" className="text-[9px] border-primary/40 text-primary font-mono">Fed Funds</Badge>
                </div>
                <CardTitle className="font-mono text-base font-bold text-foreground">
                  {terminalNewsData?.barometer?.fedInterestRate?.value ?? "%4.25 - %4.50"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-[10px] text-muted-foreground leading-tight">
                {terminalNewsData?.barometer?.fedInterestRate?.note ?? "Kademeli indirim döngüsü piyasa likiditesini destekliyor."}
              </CardContent>
            </Card>

            <Card size="sm" className="border-border/60 bg-card/70 backdrop-blur-sm">
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <CardDescription className="text-xs font-medium">ABD Tarım Dışı İstihdam</CardDescription>
                  <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-400 font-mono">NFP</Badge>
                </div>
                <CardTitle className="font-mono text-base font-bold text-foreground">
                  {terminalNewsData?.barometer?.employmentNfp?.value ?? "+142 Bin"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-[10px] text-muted-foreground leading-tight">
                {terminalNewsData?.barometer?.employmentNfp?.note ?? "Ilımlı istihdam verisi resesyon riskini dengede tutuyor."}
              </CardContent>
            </Card>

            <Card size="sm" className="border-border/60 bg-card/70 backdrop-blur-sm">
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <CardDescription className="text-xs font-medium">Kripto Korku & Açgözlülük</CardDescription>
                  <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-400 font-mono">0 - 100</Badge>
                </div>
                <CardTitle className="font-mono text-base font-bold text-emerald-400 flex items-center gap-1.5">
                  {terminalNewsData?.barometer?.fearGreed?.value ?? 63} / 100
                  <span className="text-[11px] font-normal text-muted-foreground">({terminalNewsData?.barometer?.fearGreed?.label ?? "Açgözlülük"})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-[10px] text-muted-foreground leading-tight">
                Piyasa duyarlılığı pozitif bölgede; altcoin ve meme akışını destekliyor.
              </CardContent>
            </Card>
          </div>

          {/* Filtreler ve Arama */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/60 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {(["Tümü", "Kripto", "ABD Makro", "Piyasalar"] as const).map((cat) => {
                const allList = terminalNewsData?.news || []
                const count = cat === "Tümü" ? allList.length : allList.filter((n: any) => n.category === cat).length
                const isSel = newsCategory === cat
                return (
                  <Button
                    key={cat}
                    size="sm"
                    variant={isSel ? "default" : "ghost"}
                    onClick={() => setNewsCategory(cat)}
                    className="h-7 text-xs font-semibold gap-1.5"
                  >
                    {cat === "Kripto" ? "🪙 Kripto & Meme" : cat === "ABD Makro" ? "🏛️ ABD Makro & Fed" : cat === "Piyasalar" ? "📊 Emtia & Piyasalar" : "🌐 Tümü"}
                    <span className={cn("rounded-full px-1.5 py-0.2 text-[10px] font-mono", isSel ? "bg-primary-foreground text-primary" : "bg-muted text-muted-foreground")}>{count}</span>
                  </Button>
                )
              })}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-64">
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  value={newsSearch}
                  onChange={(e) => setNewsSearch(e.target.value)}
                  placeholder="Haber veya kaynak ara..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Button size="sm" variant="ghost" onClick={() => refreshTerminalNews()} className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Haber Listesi */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {((terminalNewsData?.news || []).filter((n: any) => {
              const matchCat = newsCategory === "Tümü" || n.category === newsCategory
              const matchSearch = !newsSearch.trim() || (n.title && n.title.toLowerCase().includes(newsSearch.toLowerCase())) || (n.source && n.source.toLowerCase().includes(newsSearch.toLowerCase()))
              return matchCat && matchSearch
            })).map((n: any) => {
              const isBull = n.sentiment === "BULLISH"
              const isBear = n.sentiment === "BEARISH"
              return (
                <div key={n.id || n.url} className="group rounded-xl border border-border/70 bg-card/85 p-3 space-y-2 hover:border-primary/40 transition-all shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={cn("text-[9px] font-mono px-1.5 py-0 font-bold",
                        n.category === "Kripto" ? "border-amber-500/40 text-amber-400 bg-amber-500/10" :
                        n.category === "ABD Makro" ? "border-blue-500/40 text-blue-400 bg-blue-500/10" :
                        "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                      )}>
                        {n.category}
                      </Badge>
                      <Badge variant="outline" className={cn("text-[9px] font-mono px-1.5 py-0",
                        isBull ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10 font-bold" :
                        isBear ? "border-rose-500/40 text-rose-400 bg-rose-500/10 font-bold" :
                        "border-muted text-muted-foreground"
                      )}>
                        {isBull ? "🟢 POZİTİF" : isBear ? "🔴 DÜŞÜŞ" : "⚪ NÖTR"}
                      </Badge>
                      {n.impactBadge && <span className="text-[10px] text-muted-foreground font-mono">• {n.impactBadge}</span>}
                    </div>
                    {n.url && (
                      <a href={n.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary transition-colors shrink-0">
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                  <p className="text-xs font-semibold leading-snug text-foreground group-hover:text-primary transition-colors">{n.title}</p>
                  {n.aiTakeaway && (
                    <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-[11px] leading-relaxed text-muted-foreground flex items-start gap-1.5">
                      <Sparkles className="size-3 text-primary shrink-0 mt-0.5" />
                      <span>{n.aiTakeaway}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/60 pt-1.5 font-mono">
                    <span className="font-semibold text-foreground/80">{n.source}</span>
                    <span>{n.publishedAt ? new Date(n.publishedAt).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {activeTab === "triggers" && (
        <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
          <Card size="sm">
            <CardHeader><CardTitle className="text-sm">Yeni Limit Hedef Emri Kur</CardTitle><CardDescription className="text-xs">Meme coin belirlediğin fiyata ulaştığında bot limit emirle alım yapar</CardDescription></CardHeader>
            <CardContent>
              <form onSubmit={handleAddTrigger} className="space-y-3">
                <div><label className="text-xs font-semibold text-foreground">Kripto Varlık</label><select value={trigSymbol} onChange={(e) => setTrigSymbol(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono font-bold">{WATCHED_CRYPTOS.map((c) => (<option key={c.symbol} value={c.symbol}>{c.symbol} - {c.name}</option>))}</select></div>
                <div className="grid grid-cols-2 gap-2"><div><label className="text-xs font-semibold text-foreground">Yön / Koşul</label><select value={trigDirection} onChange={(e) => setTrigDirection(e.target.value as any)} className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"><option value="BELOW">Fiyat Altına Düşerse (Dip)</option><option value="ABOVE">Fiyat Üstüne Çıkarsa (Kırılım)</option></select></div><div><label className="text-xs font-semibold text-foreground">İşlem</label><select value={trigAction} onChange={(e) => setTrigAction(e.target.value as any)} className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-bold text-positive"><option value="BUY">AL (BUY)</option><option value="SELL">SAT (SELL)</option></select></div></div>
                <div><label className="text-xs font-semibold text-foreground">Hedef Fiyat (TL ₺)</label><Input type="number" step="any" placeholder="Örn: 0.000165" value={trigTarget} onChange={(e) => setTrigTarget(e.target.value)} className="mt-1 font-mono text-xs" required /></div>
                <div><label className="text-xs font-semibold text-foreground">İşlem Tutarı (TL ₺)</label><Input type="number" placeholder="1000" value={trigAmount} onChange={(e) => setTrigAmount(e.target.value)} className="mt-1 font-mono text-xs" required /></div>
                <Button type="submit" size="sm" className="w-full gap-1.5 font-bold"><Plus className="size-3.5" />Limit Hedef Emri Ekle</Button>
              </form>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader className="border-b"><CardTitle className="text-sm">Aktif Limit Emirleri ({botState.manualTriggers.length})</CardTitle><CardDescription className="text-xs">Bot canlı piyasada bu seviyeleri gözetler ve eşleştiğinde emri yürütür</CardDescription></CardHeader>
            <CardContent className="p-0">
              {botState.manualTriggers.length === 0 ? (<div className="py-12 text-center text-muted-foreground text-xs">Henüz özel hedef emri kurulmadı. Soldaki formdan ekleyebilirsin.</div>) : (
                <div className="divide-y divide-border/60">
                  {botState.manualTriggers.map((trig) => {
                    const live = marketItems.find((m: any) => m.symbol === trig.symbol)
                    const curPrice = live?.price || 0
                    const distancePct = curPrice ? ((curPrice - trig.targetPrice) / curPrice) * 100 : 0
                    return (
                      <div key={trig.id} className="flex items-center justify-between p-3 text-xs">
                        <div className="flex items-center gap-3"><div className={cn("size-2 rounded-full", trig.active ? "bg-positive" : "bg-muted")} /><div><div className="flex items-center gap-2"><b className="font-mono text-sm">{trig.symbol}</b><Badge variant={trig.action === "BUY" ? "default" : "destructive"} className="text-[10px] py-0 font-bold">{trig.action}</Badge><span className="text-[11px] text-muted-foreground">{trig.direction === "BELOW" ? "Altına düşerse" : "Üstüne çıkarsa"}</span></div><p className="font-mono text-[11px] text-muted-foreground">Hedef: <b className="text-foreground">{fmt(trig.targetPrice)} ₺</b> · Anlık: {fmt(curPrice)} ₺{curPrice > 0 && <span className="ml-1 text-primary">({distancePct > 0 ? "+" : ""}{distancePct.toFixed(1)}% mesafe)</span>}</p></div></div>
                        <div className="flex items-center gap-2"><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBotState((prev) => ({ ...prev, manualTriggers: prev.manualTriggers.map((t) => (t.id === trig.id ? { ...t, active: !t.active } : t)) }))}>{trig.active ? "Durdur" : "Aktifleştir"}</Button><Button size="icon" variant="ghost" className="size-7 text-negative hover:bg-negative/10" onClick={() => setBotState((prev) => ({ ...prev, manualTriggers: prev.manualTriggers.filter((t) => t.id !== trig.id) }))}><Trash2 className="size-3.5" /></Button></div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "binance" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-xs text-foreground space-y-2">
            <div className="flex items-center gap-2 font-bold text-warning text-sm">
              <AlertTriangle className="size-4 shrink-0" />
              <span>YASAL UYARI & SORUMLULUK REDDİ (YTD)</span>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Bu platformda sunulan tüm analizler, indikatör sinyalleri, otomatik emir mekanizmaları ve simülasyonlar <b>yalnızca eğitim, teknoloji ve analiz amaçlıdır</b>. Hiçbir şekilde <b>Yatırım Tavsiyesi Değildir (YTD)</b>. Kripto varlık alım-satım işlemleri yüksek volatilite, fiyat kayması ve sermaye kaybı riski barındırır. Gerçek bakiye veya Binance API ile yapılan tüm işlemlerin karar ve finansal sorumluluğu tamamen kullanıcıya aittir.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Card size="sm">
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Key className="size-4 text-primary" />Kişisel Binance Hesabı & API Yönetimi</CardTitle><CardDescription className="text-xs">Buraya kendi Binance TR / Global API bilgini veya ayırdığın gerçek parayı girerek botu kişisel hesabına bağlayabilirsin.</CardDescription></CardHeader>
              <CardContent>
                <form onSubmit={handleSaveBinanceCredentials} className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground">Çalışma Modu</label>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setAccountTypeInput("SIMULATION")} className={cn("rounded-lg border p-2.5 text-left text-xs transition-all", accountTypeInput === "SIMULATION" ? "border-warning bg-warning/10 font-bold text-foreground" : "border-border text-muted-foreground")}>
                        <b>🧪 Sanal Demo Modu</b>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Gerçek para riske etmeden 7/24 test et</p>
                      </button>
                      <button type="button" onClick={() => setAccountTypeInput("REAL")} className={cn("rounded-lg border p-2.5 text-left text-xs transition-all", accountTypeInput === "REAL" ? "border-positive bg-positive/10 font-bold text-positive" : "border-border text-muted-foreground")}>
                        <b>🟢 Gerçek Para Modu</b>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Binance API ile gerçek bakiye yönet</p>
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground">Hesap / Profil Adı</label>
                    <Input value={apiAccountName} onChange={(e) => setApiAccountName(e.target.value)} placeholder={accountTypeInput === "REAL" ? "Örn: Furkan Binance TR Cüzdanı" : "Örn: Sanal Test Cüzdanım"} className="mt-1 text-xs" required />
                  </div>

                  {accountTypeInput === "SIMULATION" ? (
                    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-warning flex items-center gap-1.5">
                          <span>🧪 Sanal Demo Başlangıç Bakiyesi (TL ₺)</span>
                        </label>
                        <span className="font-mono text-[11px] font-bold text-foreground">{fmt(parseFloat(demoBalanceInput || "50000"))} ₺</span>
                      </div>
                      <Input
                        type="number"
                        min="10000"
                        max="50000"
                        step="1000"
                        value={demoBalanceInput}
                        onChange={(e) => setDemoBalanceInput(e.target.value)}
                        placeholder="50000"
                        className="text-xs font-mono font-bold text-warning border-warning/50 bg-background"
                        required
                      />
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Min: 10.000 ₺</span>
                        <div className="flex gap-1.5">
                          {[10000, 25000, 50000].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setDemoBalanceInput(String(preset))}
                              className={cn(
                                "px-2 py-0.5 rounded border text-[10px] font-mono transition-colors",
                                demoBalanceInput === String(preset)
                                  ? "border-warning bg-warning/20 text-warning font-bold"
                                  : "border-border hover:bg-muted"
                              )}
                            >
                              {preset.toLocaleString("tr-TR")} ₺
                            </button>
                          ))}
                        </div>
                        <span>Max: 50.000 ₺</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        10.000 ₺ ile 50.000 ₺ arası sanal sermaye belirleyip test edebilirsiniz.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-positive/40 bg-positive/5 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-positive flex items-center gap-1.5">
                          <span className="size-2 rounded-full bg-positive animate-pulse" />
                          <span>Binance TR Toplam Portföy:</span>
                        </span>
                        <span className="font-mono text-sm font-bold text-positive">
                          {fmt(effectiveTotalPortfolio)} ₺
                        </span>
                      </div>
                      <div className="space-y-1.5 pt-1">
                        <div className="rounded-md border border-emerald-500/30 bg-background/80 px-3 py-1.5 text-xs flex items-center justify-between font-mono">
                          <span className="text-muted-foreground text-[11px] flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
                            Kullanılabilir Serbest Nakit (TRY):
                          </span>
                          <b className="text-emerald-500 font-bold text-xs">{fmt(botState.balanceTry)} ₺</b>
                        </div>
                        {(botState.binance?.lockedTry ?? 0) > 0 && (
                          <div className="rounded-md border border-amber-500/30 bg-background/80 px-3 py-1.5 text-xs flex items-center justify-between font-mono">
                            <span className="text-muted-foreground text-[11px] flex items-center gap-1.5 text-amber-500">
                              <span className="size-1.5 rounded-full bg-amber-500 inline-block" />
                              Açık Emirlerdeki Kilitli TRY:
                            </span>
                            <b className="text-amber-500 font-bold text-xs">{fmt(botState.binance?.lockedTry || 0)} ₺</b>
                          </div>
                        )}
                        <div className="rounded-md border border-blue-500/30 bg-background/80 px-3 py-1.5 text-xs flex items-center justify-between font-mono">
                          <span className="text-muted-foreground text-[11px] flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-blue-500 inline-block" />
                            Kripto Varlıklar (XRP vb.):
                          </span>
                          <b className="text-blue-500 font-bold text-xs">{fmt(effectiveCryptoValue)} ₺</b>
                        </div>
                        {(botState.binance?.usdtFree ?? 0) > 0.05 && (
                          <div className="rounded-md border border-emerald-500/30 bg-background/80 px-3 py-1.5 text-xs flex items-center justify-between font-mono">
                            <span className="text-muted-foreground text-[11px] flex items-center gap-1.5 text-emerald-400">
                              <span className="size-1.5 rounded-full bg-emerald-400 inline-block" />
                              Cüzdandaki USDT:
                            </span>
                            <b className="text-emerald-400 font-bold text-xs">${(botState.binance?.usdtFree || 0).toFixed(2)} (~{fmt(botState.binance?.usdtTryValue || ((botState.binance?.usdtFree || 0) * usdTryRate))} ₺)</b>
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        ✓ <b>Kısıtlama yoktur.</b> Bot toplam {fmt(effectiveTotalPortfolio)} ₺ portföyünüzü canlı takip eder. Yeni alımlar serbest {fmt(botState.balanceTry)} ₺ nakit ile yapılır; diğer coinleriniz bozulmaz.
                      </p>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-foreground">Binance API Key {accountTypeInput === "REAL" ? "(Gerçek İşlem İçin)" : "(Opsiyonel)"}</label>
                      <button
                        type="button"
                        onClick={() => {
                          setApiKeyInput("")
                          setApiSecretInput("")
                          setBotState((p) => ({ ...p, binance: { ...p.binance, apiKey: "", apiSecret: "", connected: false } }))
                        }}
                        className="text-[10px] text-negative hover:underline font-semibold"
                      >
                        🗑️ Kutuları Temizle
                      </button>
                    </div>
                    <div className="relative mt-1">
                      <Input
                        type={showApiKey ? "text" : "password"}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder="Binance TR API Key yapıştırınız"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        className="font-mono text-xs pr-8"
                      />
                      <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground">Binance API Secret {accountTypeInput === "REAL" ? "(Gerçek İşlem İçin)" : "(Opsiyonel)"}</label>
                    <div className="relative mt-1">
                      <Input
                        type={showSecret ? "text" : "password"}
                        value={apiSecretInput}
                        onChange={(e) => setApiSecretInput(e.target.value)}
                        placeholder="Binance TR API Secret yapıştırınız"
                        autoComplete="new-password"
                        className="font-mono text-xs pr-8"
                      />
                      <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    </div>
                  </div>

                  {accountTypeInput === "REAL" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isTestingApi}
                      onClick={handleTestBinanceApi}
                      className="w-full text-xs font-bold border-positive/50 text-positive hover:bg-positive/10"
                    >
                      {isTestingApi ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Sparkles className="size-3.5 mr-1.5" />}
                      ⚡ Binance Bağlantısını Test Et & Bakiyeyi Cüzdandan Çek
                    </Button>
                  )}

                  <Button type="submit" size="sm" className={cn("w-full font-bold gap-1.5 shadow-md", accountTypeInput === "REAL" ? "bg-positive hover:bg-positive/90 text-positive-foreground" : "bg-warning hover:bg-warning/90 text-warning-foreground")}>
                    <ShieldCheck className="size-4" />
                    {accountTypeInput === "REAL" ? "🟢 Gerçek Binance Hesabını Bağla" : "🧪 Sanal Demo Ayarlarını Kaydet"}
                  </Button>
                </form>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Lock className="size-4 text-positive" />Güvenlik & Gerçek Para Protokolü</CardTitle><CardDescription className="text-xs">Sermayeni koruyan en katı güvenlik standartları</CardDescription></CardHeader>
              <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
                <div className="rounded-lg border border-positive/40 bg-positive/5 p-3 space-y-1.5"><b className="text-foreground flex items-center gap-1.5"><CheckCircle className="size-3.5 text-positive" /> Para Çekme Yetkisi İstenmez</b><p className="text-[11px]">Binance üzerinden API anahtarı üretirken sadece <b>"Spot ve Marjin Alım-Satımı Etkinleştir"</b> seçeneğini işaretleyiniz. <b>"Para Çekme (Withdraw)"</b> yetkisini kesinlikle KAPALI tutunuz. Bot paranızı çekemez, yalnızca alım-satım yapabilir.</p></div>
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-1.5"><b className="text-foreground flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-primary" /> Yerel & Şifreli Saklama</b><p className="text-[11px]">API bilgileriniz ve bakiye tanımlarınız yalnızca sizin bilgisayarınızın tarayıcısında şifreli olarak saklanır. Hiçbir harici sunucuya veya üçüncü tarafa iletilmez.</p></div>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1.5"><b className="text-foreground flex items-center gap-1.5"><Clock className="size-3.5 text-foreground" /> 7/24 Kesintisiz Kripto İşlemi</b><p className="text-[11px]">Kripto para piyasası hafta sonları ve geceleri dahil 7/24 açıktır. Bilgisayarınız açık olduğu veya arka plan servisi çalıştığı sürece bot gece uykunuzda bile limit emirlerle kâr toplamaya devam eder.</p></div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {activeTab === "strategy" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card size="sm">
            <CardHeader><CardTitle className="text-sm">Otonom Slot & Sermaye Dağıtımı</CardTitle><CardDescription className="text-xs">Paranın kaç parçaya bölüneceği ve risk kuralları</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between"><div><b className="text-xs text-foreground flex items-center gap-1.5"><Layers className="size-4 text-primary" />Maksimum Açık Pozisyon (Slot Sayısı)</b><p className="text-[11px] text-muted-foreground">Sermaye en fazla 2, 3 veya 4 parçaya bölünür, tek bir coinde batma riski önlenir</p></div>
                <div className="flex items-center gap-1">
                  {[2, 3, 4].map((slot) => (
                    <button key={slot} type="button" onClick={() => setBotState((p) => ({ ...p, strategy: { ...p.strategy, maxConcurrentPositions: slot } }))} className={cn("rounded px-3 py-1 font-mono text-xs font-bold transition-all", (botState.strategy.maxConcurrentPositions || 3) === slot ? "bg-primary text-primary-foreground shadow" : "bg-muted text-muted-foreground hover:text-foreground")}>{slot} Slot</button>
                  ))}
                </div>
                </div>
              </div>

              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <b className="text-xs text-foreground flex items-center gap-1.5"><Sparkles className="size-4 text-primary" />Dinamik Pozisyon Boyutu (AI Skor Ağırlıklı)</b>
                    <p className="text-[11px] text-muted-foreground">AI skoru yüksek coinlere daha fazla sermaye dağıtılır. Skor 90+ → büyük pozisyon, skor 60 → küçük pozisyon</p>
                  </div>
                  <input type="checkbox" checked={botState.strategy.dynamicSizing ?? true} onChange={(e) => setBotState((p) => ({ ...p, strategy: { ...p.strategy, dynamicSizing: e.target.checked } }))} className="size-4 accent-primary" />
                </div>
                {botState.strategy.dynamicSizing && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-foreground">Agresiflik Seviyesi:</label>
                    <div className="flex gap-1.5">
                      {([
                        { key: "conservative", label: "🛡️ Tutucu", desc: "+40/30/20%" },
                        { key: "balanced",     label: "⚖️ Dengeli", desc: "+50/35/25%" },
                        { key: "aggressive",   label: "🔥 Agresif", desc: "+70/50/30%" },
                      ] as const).map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setBotState((p) => ({ ...p, strategy: { ...p.strategy, dynamicSizingAggressiveness: opt.key } }))}
                          className={cn("flex-1 rounded-md border p-1.5 text-center text-[10px] font-bold transition-all", botState.strategy.dynamicSizingAggressiveness === opt.key ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
                        >
                          <div>{opt.label}</div>
                          <div className="font-mono text-[9px] opacity-70">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                    <div className="rounded border border-border/60 bg-muted/20 p-2 text-[10px] text-muted-foreground font-mono space-y-0.5">
                      {(() => {
                        const agg = botState.strategy.dynamicSizingAggressiveness || "balanced"
                        const bonusMap = { conservative: [1.40, 1.30, 1.20], balanced: [1.50, 1.35, 1.25], aggressive: [1.70, 1.50, 1.30] }
                        const b = bonusMap[agg]
                        return (
                          <>
                            <p>Skor 90+: <b className="text-positive">{fmt(Math.floor(baseSlotAmount * b[0]))} ₺</b> tahsis edilir</p>
                            <p>Skor 75-89: <b className="text-foreground">{fmt(Math.floor(baseSlotAmount * b[1]))} ₺</b> tahsis edilir</p>
                            <p>Skor 60-74: <b className="text-muted-foreground">{fmt(Math.floor(baseSlotAmount * b[2]))} ₺</b> tahsis edilir</p>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Öneri 2: Yatay Pozisyon Kapatma (Stale Position Timeout) ── */}
              <div className="rounded-lg border border-border/80 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <b className="text-xs text-foreground flex items-center gap-1.5"><Clock className="size-4 text-primary" />Yatay Pozisyon Kapatma (4 Saat Kuralı)</b>
                    <p className="text-[11px] text-muted-foreground">Hedefe gitmeyen ve yatayda sıkışıp kalan coini kapatıp sermayeyi yeni fırlayan coinlere tahsis eder</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={botState.strategy.stalePositionTimeoutEnabled ?? true}
                    onChange={(e) => setBotState((p) => ({ ...p, strategy: { ...p.strategy, stalePositionTimeoutEnabled: e.target.checked } }))}
                    className="size-4 accent-primary"
                  />
                </div>
                {botState.strategy.stalePositionTimeoutEnabled && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] text-muted-foreground">Maksimum Bekleme:</span>
                    <select
                      value={botState.strategy.stalePositionTimeoutHours ?? 4}
                      onChange={(e) => setBotState((p) => ({ ...p, strategy: { ...p.strategy, stalePositionTimeoutHours: Number(e.target.value) } }))}
                      className="rounded border border-border bg-background px-2 py-1 text-xs font-mono font-bold"
                    >
                      <option value={2}>2 Saat (Hızlı Rotasyon)</option>
                      <option value={4}>4 Saat (Önerilen)</option>
                      <option value={8}>8 Saat (Geniş Bant)</option>
                      <option value={12}>12 Saat</option>
                    </select>
                  </div>
                )}
              </div>

              {/* ── Öneri 3: Akıllı Dip Avcısı & Kara Kuğu Koruması ── */}
              <div className="rounded-lg border border-warning/50 bg-warning/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <b className="text-xs text-foreground flex items-center gap-1.5"><Zap className="size-4 text-warning" />Akıllı Dip Avcısı & Çöküş Koruması</b>
                    <p className="text-[11px] text-muted-foreground">BTC düşerken ucuzlayan dip fırsatları toplar; sadece tepedeki şişmiş alımları engeller ve aşırı çöküşte (-%6) korur</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={botState.strategy.btcDropProtectionEnabled ?? true}
                    onChange={(e) => setBotState((p) => ({ ...p, strategy: { ...p.strategy, btcDropProtectionEnabled: e.target.checked } }))}
                    className="size-4 accent-warning"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-muted-foreground">Anlık BTC Değişimi:</span>
                  <span className={cn("font-bold px-1.5 py-0.5 rounded", btcChange >= 0 ? "text-positive bg-positive/10" : "text-negative bg-negative/10")}>
                    {btcChange >= 0 ? "+" : ""}%{btcChange.toFixed(2)} {btcChange <= -6.0 ? "🛑 AŞIRI ÇÖKÜŞ KİLİDİ" : btcChange <= -1.5 ? "💎 DİP TOPLAMA MODU" : "✓ Güvenli"}
                  </span>
                </div>
              </div>

              {/* ── E-posta Bildirimleri ── */}
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <b className="text-xs text-foreground flex items-center gap-1.5"><Mail className="size-4 text-primary" />Kayıtlı E-Posta İşlem Bildirimleri</b>
                    <p className="text-[11px] text-muted-foreground">Bot alım yaptığında veya kârla kapandığında e-posta adresine anında bilgilendirme gönderir</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={botState.strategy.emailNotificationsEnabled ?? true}
                    onChange={(e) => setBotState((p) => ({ ...p, strategy: { ...p.strategy, emailNotificationsEnabled: e.target.checked } }))}
                    className="size-4 accent-primary"
                  />
                </div>
                {botState.strategy.emailNotificationsEnabled && (
                  <div className="space-y-1.5 pt-1">
                    <label className="text-[11px] font-semibold text-foreground">Bildirim Gönderilecek E-Posta:</label>
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        placeholder="ornek@gmail.com"
                        value={botState.strategy.userNotificationEmail || ""}
                        onChange={(e) => setBotState((p) => ({ ...p, strategy: { ...p.strategy, userNotificationEmail: e.target.value } }))}
                        className="text-xs font-mono"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs shrink-0 font-bold"
                        onClick={() => {
                          const targetEmail = botState.strategy.userNotificationEmail
                          if (!targetEmail || !targetEmail.includes("@")) {
                            alert("Lütfen geçerli bir e-posta adresi girin.")
                            return
                          }
                          sendEmailNotification(
                            targetEmail,
                            "🔔 Test Bildirimi: Binance TL Otonom Bot Hazır",
                            "Tebrikler! E-posta bildirim sisteminiz başarıyla bağlandı. Bot tüm alım ve kâr kapanışlarını bu adrese iletecek."
                          )
                          alert("Test e-postası kuyruğa alındı ve iletildi!")
                        }}
                      >
                        <Send className="size-3 mr-1" />Test Et
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>


          <Card size="sm">
            <CardHeader><CardTitle className="text-sm">Alım & Kâr Parametreleri</CardTitle><CardDescription className="text-xs">Hedef oranlar ve portföy sıfırlama</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <b className="text-xs text-foreground flex items-center gap-1.5"><ShieldCheck className="size-4 text-positive" />Pozisyon Başına Kâr / Zarar Yönetimi (7/24 Kesintisiz)</b>
                    <p className="text-[11px] text-muted-foreground">Her alım kendi bağımsız Hedef Kâr (TP), Zarar Kes (SL), Breakeven (Sıfır Risk) ve Trailing Stop ile korunur; otopilot hiçbir zaman gereksiz yere durdurulmaz.</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* 1. Sniper Kâr Modu (Garantici & Sıfır Risk) */}
                <div className="flex items-center justify-between rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3">
                  <div className="flex items-center gap-2.5">
                    <Target className="size-5 text-emerald-400 shrink-0 animate-pulse" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-emerald-300">🎯 Sniper Kâr Modu (Sıfır Risk)</p>
                        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300 bg-emerald-500/20 py-0 font-bold">1 Numara</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">Kâr %3.5 | Stop -%1.6 | Sıfır Risk %0.9 (+%0.35 Kilit) | Trailing %0.9</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={applySniperSettings}
                    className="h-8 border-emerald-500/40 bg-emerald-500/20 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 hover:text-white shadow-sm shrink-0"
                  >
                    🎯 Sniper'ı Yükle
                  </Button>
                </div>

                {/* 2. Altın Oran Stratejisi */}
                <div className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="size-5 text-amber-500 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-amber-400">⚡ Altın Oran (1:1.618)</p>
                        <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400 bg-amber-500/10 py-0">Klasik</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">Kâr %3.0 | Stop -%1.8 | Sıfır Risk %1.0 | Trailing %1.0 | RSI ≤ 38</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={applyGoldenRatioSettings}
                    className="h-8 border-amber-500/40 bg-amber-500/20 text-xs font-bold text-amber-300 hover:bg-amber-500/30 hover:text-amber-100 shadow-sm shrink-0"
                  >
                    ⚡ Altın Oranı Yükle
                  </Button>
                </div>
              </div>

              {/* 1. Hedef Kâr (Take Profit) & Stop-Loss */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Take Profit */}
                <div className="rounded-lg border border-positive/30 bg-positive/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-positive flex items-center gap-1.5">
                      🎯 Scalp Hedef Kâr (%)
                    </label>
                    <span className="font-mono text-xs font-bold text-positive bg-positive/10 px-2 py-0.5 rounded border border-positive/20">
                      %{botState.strategy.defaultTakeProfitPct}
                    </span>
                  </div>
                  <Input
                    type="number"
                    step="0.1"
                    min="1.0"
                    max="15.0"
                    value={botState.strategy.defaultTakeProfitPct}
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      setBotState((p) => {
                        const nextStrat = { ...p.strategy, defaultTakeProfitPct: val }
                        const next = { ...p, strategy: nextStrat }
                        try { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(next)) } catch {}
                        syncStrategyToServer(nextStrat)
                        return next
                      })
                    }}
                    className="font-mono text-xs text-positive font-bold bg-background h-8"
                  />
                  <div className="flex flex-wrap gap-1 pt-1">
                    {[1.5, 2.0, 2.5, 3.0, 4.0].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setBotState((p) => {
                            const nextStrat = { ...p.strategy, defaultTakeProfitPct: val }
                            const next = { ...p, strategy: nextStrat }
                            try { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(next)) } catch {}
                            syncStrategyToServer(nextStrat)
                            return next
                          })
                        }}
                        className={cn(
                          "px-2 py-0.5 rounded border text-[10px] font-mono font-bold transition-all cursor-pointer",
                          botState.strategy.defaultTakeProfitPct === val
                            ? "border-positive bg-positive text-positive-foreground shadow-sm"
                            : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground hover:border-positive/40"
                        )}
                      >
                        %{val}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stop Loss */}
                <div className="rounded-lg border border-negative/30 bg-negative/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-negative flex items-center gap-1.5">
                      🛑 Zarar Kes Stop-Loss (%)
                    </label>
                    <span className="font-mono text-xs font-bold text-negative bg-negative/10 px-2 py-0.5 rounded border border-negative/20">
                      -%{botState.strategy.defaultStopLossPct}
                    </span>
                  </div>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="10.0"
                    value={botState.strategy.defaultStopLossPct}
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      setBotState((p) => {
                        const nextStrat = { ...p.strategy, defaultStopLossPct: val }
                        const next = { ...p, strategy: nextStrat }
                        try { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(next)) } catch {}
                        syncStrategyToServer(nextStrat)
                        return next
                      })
                    }}
                    className="font-mono text-xs text-negative font-bold bg-background h-8"
                  />
                  <div className="flex flex-wrap gap-1 pt-1">
                    {[1.0, 1.2, 1.5, 1.8, 2.2].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setBotState((p) => {
                            const nextStrat = { ...p.strategy, defaultStopLossPct: val }
                            const next = { ...p, strategy: nextStrat }
                            try { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(next)) } catch {}
                            syncStrategyToServer(nextStrat)
                            return next
                          })
                        }}
                        className={cn(
                          "px-2 py-0.5 rounded border text-[10px] font-mono font-bold transition-all cursor-pointer",
                          botState.strategy.defaultStopLossPct === val
                            ? "border-negative bg-negative text-negative-foreground shadow-sm"
                            : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground hover:border-negative/40"
                        )}
                      >
                        -%{val}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 2. Sıfır Risk (Breakeven) & Trailing Stop */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Breakeven */}
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-primary flex items-center gap-1.5">
                      🛡️ Sıfır Risk Kilidi (Breakeven %)
                    </label>
                    <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                      %{botState.strategy.breakevenPct ?? 1.5}
                    </span>
                  </div>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="5.0"
                    value={botState.strategy.breakevenPct ?? 1.5}
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      setBotState((p) => {
                        const nextStrat = { ...p.strategy, breakevenPct: val }
                        const next = { ...p, strategy: nextStrat }
                        try { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(next)) } catch {}
                        syncStrategyToServer(nextStrat)
                        return next
                      })
                    }}
                    className="font-mono text-xs text-primary font-bold bg-background h-8"
                  />
                  <div className="flex flex-wrap gap-1 pt-1">
                    {[0.8, 1.0, 1.2, 1.5, 2.0].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setBotState((p) => {
                            const nextStrat = { ...p.strategy, breakevenPct: val }
                            const next = { ...p, strategy: nextStrat }
                            try { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(next)) } catch {}
                            syncStrategyToServer(nextStrat)
                            return next
                          })
                        }}
                        className={cn(
                          "px-2 py-0.5 rounded border text-[10px] font-mono font-bold transition-all cursor-pointer",
                          (botState.strategy.breakevenPct ?? 1.5) === val
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground hover:border-primary/40"
                        )}
                      >
                        %{val}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Trailing Stop */}
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-warning flex items-center gap-1.5">
                      📈 Takip Eden Stop (Trailing %)
                    </label>
                    <span className="font-mono text-xs font-bold text-warning bg-warning/10 px-2 py-0.5 rounded border border-warning/20">
                      %{botState.strategy.trailingStopPct ?? 1.2}
                    </span>
                  </div>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.4"
                    max="5.0"
                    value={botState.strategy.trailingStopPct ?? 1.2}
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      setBotState((p) => {
                        const nextStrat = { ...p.strategy, trailingStopPct: val }
                        const next = { ...p, strategy: nextStrat }
                        try { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(next)) } catch {}
                        syncStrategyToServer(nextStrat)
                        return next
                      })
                    }}
                    className="font-mono text-xs text-warning font-bold bg-background h-8"
                  />
                  <div className="flex flex-wrap gap-1 pt-1">
                    {[0.6, 0.8, 1.0, 1.2, 1.5].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setBotState((p) => {
                            const nextStrat = { ...p.strategy, trailingStopPct: val }
                            const next = { ...p, strategy: nextStrat }
                            try { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(next)) } catch {}
                            syncStrategyToServer(nextStrat)
                            return next
                          })
                        }}
                        className={cn(
                          "px-2 py-0.5 rounded border text-[10px] font-mono font-bold transition-all cursor-pointer",
                          (botState.strategy.trailingStopPct ?? 1.2) === val
                            ? "border-warning bg-warning text-warning-foreground shadow-sm"
                            : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground hover:border-warning/40"
                        )}
                      >
                        %{val}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 3. RSI Dip Avcısı */}
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Sparkles className="size-4 text-primary" />Akıllı Dip Avcısı (RSI Alım Eşiği)
                    </label>
                    <p className="text-[10px] text-muted-foreground">Bot, RSI değeri bu seviyenin altındaki aşırı satım dip coinlerini toplar.</p>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs font-bold border-primary text-primary bg-primary/10">
                    RSI ≤ {botState.strategy.rsiBuyThreshold ?? 38}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="15"
                    max="70"
                    step="1"
                    value={botState.strategy.rsiBuyThreshold ?? 38}
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      setBotState((p) => {
                        const nextStrat = { ...p.strategy, rsiBuyThreshold: isNaN(val) ? 38 : val }
                        const next = { ...p, strategy: nextStrat }
                        try { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(next)) } catch {}
                        syncStrategyToServer(nextStrat)
                        return next
                      })
                    }}
                    className="w-24 font-mono text-xs font-bold text-primary border-primary/40 bg-background h-8"
                  />
                  <div className="flex flex-wrap gap-1">
                    {[28, 30, 35, 38, 40, 42, 45, 50].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setBotState((p) => {
                            const nextStrat = { ...p.strategy, rsiBuyThreshold: preset }
                            const next = { ...p, strategy: nextStrat }
                            try { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(next)) } catch {}
                            syncStrategyToServer(nextStrat)
                            return next
                          })
                        }}
                        className={cn(
                          "px-2.5 py-1 rounded border text-[11px] font-mono font-bold transition-all cursor-pointer",
                          (botState.strategy.rsiBuyThreshold ?? 38) === preset
                            ? "border-primary bg-primary text-primary-foreground shadow-sm scale-105"
                            : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-card hover:text-foreground hover:border-primary/40"
                        )}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-[11px] text-muted-foreground"><p className="flex items-center gap-1 font-semibold text-foreground"><CheckCircle className="size-3.5 text-positive" /> Otonom Slot Güvencesi</p><p className="mt-1 leading-relaxed">Bot bakiye ve kâr arttıkça slot büyüklüğünü otomatik günceller. Kâr eden pozisyon kapandığında slot boşalır ve anında en yüksek skorlu yeni coine tahsis edilir.</p></div>
              <div className="pt-2">
                <Button variant="outline" size="sm" onClick={handleResetPortfolio} className="w-full text-xs text-muted-foreground hover:text-negative">
                  <RotateCcw className="size-3 mr-1.5" />
                  {isRealAccount ? `Pozisyonları & Geçmişi Sıfırla (${fmt(botState.balanceTry)} ₺)` : "Portföyü & Bakiyeyi Sıfırla (50.000 ₺)"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "logs" && (
        <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <Card size="sm" className="bg-card/95 font-mono">
            <CardHeader className="border-b pb-2"><div className="flex items-center justify-between"><CardTitle className="text-xs font-bold flex items-center gap-2"><span className="size-2 rounded-full bg-positive animate-pulse" />Canlı Bot Motoru Konsolu (7/24)</CardTitle><span className="text-[10px] text-muted-foreground">Olay Akışı (TL)</span></div></CardHeader>
            <CardContent className="p-3 max-h-[380px] overflow-y-auto space-y-1.5 text-[11px]">
              {botState.logs.map((log) => (<div key={log.id} className="flex items-start gap-2 leading-tight"><span className="text-muted-foreground shrink-0">[{log.time}]</span><span className={cn("font-bold shrink-0", log.type === "BUY" && "text-positive", log.type === "SELL" && "text-warning", log.type === "ALERT" && "text-primary", log.type === "INFO" && "text-muted-foreground")}>[{log.type}]</span><span className="text-foreground break-all">{log.message}</span></div>))}
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader className="border-b pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-bold">{isRealAccount ? "Gerçek Binance İşlem Geçmişi" : "Sanal Demo İşlem Geçmişi"} ({relevantHistory.length})</CardTitle>
              {relevantHistory.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearHistory}
                  className="h-6 px-2 text-[10px] text-muted-foreground hover:text-negative"
                >
                  Geçmişi Sıfırla
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0 max-h-[380px] overflow-y-auto divide-y divide-border/60 text-xs">
              {relevantHistory.length === 0 ? (<div className="p-8 text-center text-muted-foreground text-xs">{isRealAccount ? "Henüz kapanmış gerçek işlem yok." : "Henüz kapanmış sanal işlem yok."}</div>) : (
                relevantHistory.map((h) => {
                  const isProfit = (h.netPnlTry ?? h.pnl ?? 0) >= 0
                  return (<div key={h.id} className="p-2.5 space-y-1"><div className="flex items-center justify-between"><b className="font-mono text-xs">{h.symbol}</b><span className={cn("font-mono font-bold text-xs", isProfit ? "text-positive" : "text-negative")}>{isProfit ? "+" : ""}{fmt(h.netPnlTry ?? h.pnl)} ₺ ({isProfit ? "+" : ""}%{(h.pnlPercent ?? 0).toFixed(2)})</span></div><div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>Giriş: {fmt(h.entryPrice)} ₺ → Çıkış: {fmt(h.closePrice || h.exitPrice || 0)} ₺</span><span>{h.closedAt}</span></div><p className="text-[10px] text-muted-foreground italic truncate">{h.closeReason}</p></div>)
                })
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-center text-[11px] text-muted-foreground">
        <p>📢 <b>Yasal Uyarı & Sorumluluk Reddi (YTD):</b> Bu sayfada yer alan bot mekanizmaları, indikatörler ve kâr/zarar göstergeleri yatırım danışmanlığı kapsamında değildir. Kripto piyasalarında tüm finansal kararlar ve risk kullanıcıya aittir.</p>
      </div>

      {showApiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Key className="size-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Binance Hesabını Bağla</h3>
              </div>
              <button onClick={() => setShowApiModal(false)} className="text-muted-foreground hover:text-foreground text-xs font-bold px-2 py-1">✕ Kapat</button>
            </div>

            <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-warning flex items-start gap-2">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <b>YTD Uyarısı & Güvenlik Kuralı:</b> Sunulan otomasyon yatırım tavsiyesi değildir. Binance üzerinden API oluştururken <b>sadece "Spot İşlem"</b> yetkisi veriniz, <b>"Para Çekme (Withdraw)"</b> yetkisini kesinlikle KAPALI tutunuz!
              </div>
            </div>

            <div className="rounded-lg border border-positive/40 bg-positive/5 p-2.5 text-[11px] flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-positive font-bold">
                <Lock className="size-3.5" /> AES-GCM 256-Bit Vault Korumalı
              </span>
              <Badge variant="outline" className="border-positive/50 text-positive text-[9px]">İstemci Şifreleme</Badge>
            </div>


            <form onSubmit={handleSaveBinanceCredentials} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-foreground">Çalışma Modu</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setAccountTypeInput("SIMULATION")} className={cn("rounded-lg border p-2 text-left text-xs transition-all", accountTypeInput === "SIMULATION" ? "border-warning bg-warning/10 font-bold text-foreground" : "border-border text-muted-foreground")}>
                    <b>🧪 Sanal Demo</b>
                    <p className="text-[10px] text-muted-foreground">Risksiz test</p>
                  </button>
                  <button type="button" onClick={() => setAccountTypeInput("REAL")} className={cn("rounded-lg border p-2 text-left text-xs transition-all", accountTypeInput === "REAL" ? "border-positive bg-positive/10 font-bold text-positive" : "border-border text-muted-foreground")}>
                    <b>🟢 Gerçek Para</b>
                    <p className="text-[10px] text-muted-foreground">Canlı Binance Hesabı</p>
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground">Hesap Adı</label>
                <Input value={apiAccountName} onChange={(e) => setApiAccountName(e.target.value)} placeholder={accountTypeInput === "REAL" ? "Örn: Furkan Binance TR" : "Örn: Sanal Test Cüzdanım"} className="mt-1 text-xs" required />
              </div>

              {accountTypeInput === "SIMULATION" ? (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-warning flex items-center gap-1.5">
                      <span>🧪 Sanal Demo Başlangıç Bakiyesi (TL ₺)</span>
                    </label>
                    <span className="font-mono text-[11px] font-bold text-foreground">{fmt(parseFloat(demoBalanceInput || "50000"))} ₺</span>
                  </div>
                  <Input
                    type="number"
                    min="10000"
                    max="50000"
                    step="1000"
                    value={demoBalanceInput}
                    onChange={(e) => setDemoBalanceInput(e.target.value)}
                    placeholder="50000"
                    className="text-xs font-mono font-bold text-warning border-warning/50 bg-background"
                    required
                  />
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Min: 10.000 ₺</span>
                    <div className="flex gap-1.5">
                      {[10000, 25000, 50000].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setDemoBalanceInput(String(preset))}
                          className={cn(
                            "px-2 py-0.5 rounded border text-[10px] font-mono transition-colors",
                            demoBalanceInput === String(preset)
                              ? "border-warning bg-warning/20 text-warning font-bold"
                              : "border-border hover:bg-muted"
                          )}
                        >
                          {preset.toLocaleString("tr-TR")} ₺
                        </button>
                      ))}
                    </div>
                    <span>Max: 50.000 ₺</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    10.000 ₺ ile 50.000 ₺ arası sanal sermaye belirleyip test edebilirsiniz.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-positive/40 bg-positive/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-positive flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-positive animate-pulse" />
                      <span>Binance TR Toplam Portföy:</span>
                    </span>
                    <span className="font-mono text-sm font-bold text-positive">
                      {fmt(effectiveTotalPortfolio)} ₺
                    </span>
                  </div>
                  <div className="space-y-1.5 pt-1">
                    <div className="rounded-md border border-emerald-500/30 bg-background/80 px-3 py-1.5 text-xs flex items-center justify-between font-mono">
                      <span className="text-muted-foreground text-[11px] flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
                        Kullanılabilir Serbest Nakit (TRY):
                      </span>
                      <b className="text-emerald-500 font-bold text-xs">{fmt(botState.balanceTry)} ₺</b>
                    </div>
                    {(botState.binance?.lockedTry ?? 0) > 0 && (
                      <div className="rounded-md border border-amber-500/30 bg-background/80 px-3 py-1.5 text-xs flex items-center justify-between font-mono">
                        <span className="text-muted-foreground text-[11px] flex items-center gap-1.5 text-amber-500">
                          <span className="size-1.5 rounded-full bg-amber-500 inline-block" />
                          Açık Emirlerdeki Kilitli TRY:
                        </span>
                        <b className="text-amber-500 font-bold text-xs">{fmt(botState.binance?.lockedTry || 0)} ₺</b>
                      </div>
                    )}
                    <div className="rounded-md border border-blue-500/30 bg-background/80 px-3 py-1.5 text-xs flex items-center justify-between font-mono">
                      <span className="text-muted-foreground text-[11px] flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-blue-500 inline-block" />
                        Kripto Varlıklar (XRP vb.):
                      </span>
                      <b className="text-blue-500 font-bold text-xs">{fmt(effectiveCryptoValue)} ₺</b>
                    </div>
                    {(botState.binance?.usdtFree ?? 0) > 0.05 && (
                      <div className="rounded-md border border-emerald-500/30 bg-background/80 px-3 py-1.5 text-xs flex items-center justify-between font-mono">
                        <span className="text-muted-foreground text-[11px] flex items-center gap-1.5 text-emerald-400">
                          <span className="size-1.5 rounded-full bg-emerald-400 inline-block" />
                          Cüzdandaki USDT:
                        </span>
                        <b className="text-emerald-400 font-bold text-xs">${(botState.binance?.usdtFree || 0).toFixed(2)} (~{fmt(botState.binance?.usdtTryValue || ((botState.binance?.usdtFree || 0) * usdTryRate))} ₺)</b>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    ✓ <b>Kısıtlama yoktur.</b> Binance TR hesabınıza para yatırdığınızda veya çektiğinizde, aşağıdaki <b>"Test Et & Bakiyeyi Çek"</b> butonuna basarak veya sayfayı yenileyerek cüzdanınızı anında eşitleyebilirsiniz.
                  </p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">Binance API Key {accountTypeInput === "REAL" ? "(Gerçek İşlem İçin)" : "(İsteğe Bağlı)"}</label>
                  <button
                    type="button"
                    onClick={() => {
                      setApiKeyInput("")
                      setApiSecretInput("")
                      setBotState((p) => ({ ...p, binance: { ...p.binance, apiKey: "", apiSecret: "", connected: false } }))
                    }}
                    className="text-[10px] text-negative hover:underline font-semibold"
                  >
                    🗑️ Kutuları Temizle
                  </button>
                </div>
                {botState.binance?.apiKey && !botState.binance.apiKey.startsWith("enc_v1:") && (
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-positive bg-positive/10 border border-positive/30 rounded px-2 py-1">
                    <CheckCircle className="size-3 text-positive shrink-0" />
                    <span>Aktif Kayıtlı Anahtar: <b>{maskSensitive(botState.binance.apiKey)}</b> (Binance TR Bağlı)</span>
                  </div>
                )}
                <div className="relative mt-1">
                  <Input
                    type={showModalKey ? "text" : "password"}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="Binance TR API Key yapıştırınız"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="font-mono text-xs pr-8"
                  />
                  <button type="button" onClick={() => setShowModalKey(!showModalKey)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showModalKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground">Binance API Secret {accountTypeInput === "REAL" ? "(Gerçek İşlem İçin)" : "(İsteğe Bağlı)"}</label>
                <div className="relative mt-1">
                  <Input
                    type={showModalSecret ? "text" : "password"}
                    value={apiSecretInput}
                    onChange={(e) => setApiSecretInput(e.target.value)}
                    placeholder="Binance TR API Secret yapıştırınız"
                    autoComplete="new-password"
                    className="font-mono text-xs pr-8"
                  />
                  <button type="button" onClick={() => setShowModalSecret(!showModalSecret)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showModalSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>

              {accountTypeInput === "REAL" && (
                <div className="space-y-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isTestingApi}
                    onClick={handleTestBinanceApi}
                    className="w-full text-xs font-bold border-positive/50 text-positive hover:bg-positive/10"
                  >
                    {isTestingApi ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Sparkles className="size-3.5 mr-1.5" />}
                    ⚡ Binance Bağlantısını Test Et & Bakiyeyi Cüzdandan Çek
                  </Button>
                  <p className="text-[10px] text-muted-foreground text-center">
                    Binance TR API anahtarınızın Spot Alım-Satım yetkisinin açık olduğundan emin olunuz.
                  </p>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowApiModal(false)}>İptal</Button>
                <Button type="submit" size="sm" className={cn("font-bold shadow-md", accountTypeInput === "REAL" ? "bg-positive hover:bg-positive/90 text-positive-foreground" : "bg-warning hover:bg-warning/90 text-warning-foreground")}>
                  {accountTypeInput === "REAL" ? "🟢 Gerçek Hesabı Bağla" : "🧪 Sanal Demoyu Kaydet"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Binance TR Cüzdan Kurtarma & Sahipsiz Coinleri Bozdurma Modalı ── */}
      {showWalletRecoveryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-xl border border-emerald-500/30 bg-card p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Coins className="size-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                    Binance TR Canlı Cüzdan Varlıkları
                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
                      CANLI SPOT
                    </Badge>
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Cüzdanınızdaki coinleri listeleyin, bot slotlarında olmayan sahipsiz coinleri bozdurup nakite çevirin.
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="size-7 p-0 text-muted-foreground"
                onClick={() => setShowWalletRecoveryModal(false)}
              >
                ✕
              </Button>
            </div>

            {/* Bakiye Özeti */}
            <div className={cn("grid gap-3 p-3 rounded-lg bg-muted/20 border border-border", ((botState.binance?.lockedTry ?? 0) > 0 || (botState.binance?.usdtFree ?? 0) > 0.05) ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2")}>
              <div>
                <span className="text-[10px] text-muted-foreground">Binance TR Toplam:</span>
                <p className="font-mono text-base font-black text-emerald-400">{fmtCurrency(effectiveTotalPortfolio)} ₺</p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground">Serbest Nakit (TRY):</span>
                <p className="font-mono text-base font-black text-foreground">{fmtCurrency(botState.balanceTry)} ₺</p>
              </div>
              {(botState.binance?.lockedTry ?? 0) > 0 && (
                <div>
                  <span className="text-[10px] text-muted-foreground">Açık Emirde (Kilitli):</span>
                  <p className="font-mono text-base font-black text-amber-500">{fmtCurrency(botState.binance?.lockedTry || 0)} ₺</p>
                </div>
              )}
              {(botState.binance?.usdtFree ?? 0) > 0.05 && (
                <div>
                  <span className="text-[10px] text-muted-foreground">Cüzdandaki USDT:</span>
                  <p className="font-mono text-base font-black text-emerald-400">${(botState.binance?.usdtFree || 0).toFixed(2)}</p>
                </div>
              )}
            </div>

            {/* Varlık Listesi */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-muted-foreground">Cüzdandaki Kriptolar ({walletAssets.length})</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isScanningWallet}
                  onClick={handleScanWalletAssets}
                  className="h-6 text-[10px] text-primary hover:text-primary/80 gap-1 px-2"
                >
                  <RefreshCw className={cn("size-3", isScanningWallet && "animate-spin")} />
                  Cüzdanı Yeniden Tara
                </Button>
              </div>

              {walletAssets.length === 0 ? (
                <div className="p-6 text-center border border-dashed rounded-lg space-y-2 text-muted-foreground">
                  <Coins className="size-8 mx-auto text-muted-foreground/50 animate-pulse" />
                  <p className="text-xs">Cüzdandaki kripto varlıklar taranıyor...</p>
                  <Button size="sm" variant="outline" onClick={handleScanWalletAssets} disabled={isScanningWallet}>
                    Taramayı Başlat
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {walletAssets.map((w) => {
                    const isInActiveSlot = botState.positions.some((p) => p.symbol === w.asset)
                    const isSellingThis = sellingAsset === w.asset
                    return (
                      <div
                        key={w.asset}
                        className={cn(
                          "p-2.5 rounded-lg border text-xs flex items-center justify-between gap-3 transition-all",
                          isInActiveSlot
                            ? "border-blue-500/30 bg-blue-500/5"
                            : w.canSell
                            ? "border-emerald-500/40 bg-emerald-500/5"
                            : "border-border/60 bg-muted/10 opacity-70"
                        )}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground font-mono">{w.asset}</span>
                            {isInActiveSlot ? (
                              <Badge variant="outline" className="text-[9px] border-blue-500 text-blue-400 py-0 px-1 font-bold">
                                🟢 Bot Slotunda Açık
                              </Badge>
                            ) : w.canSell ? (
                              <Badge variant="outline" className="text-[9px] border-emerald-500 text-emerald-400 py-0 px-1 font-bold">
                                ⚡ Sahipsiz (Bozdurulabilir)
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] border-muted text-muted-foreground py-0 px-1">
                                &lt;10 ₺ (Toz Bakiye)
                              </Badge>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground flex gap-3 font-mono">
                            <span>Adet: {(w.free ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 6 })}</span>
                            <span>Değer: ~{(w.valueTry ?? 0).toFixed(2)} ₺</span>
                          </div>
                        </div>

                        <div>
                          {w.canSell ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isSellingThis || sellingAsset !== null}
                              className="h-7 text-[10px] font-bold border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/20"
                              onClick={() => handleSellSingleWalletAsset(w.asset, w.free)}
                            >
                              {isSellingThis ? <Loader2 className="size-3 animate-spin mr-1" /> : <TrendingDown className="size-3 mr-1" />}
                              Sat (TRY&apos;ye Çevir)
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">
                              {w.valueTry < 10 ? "Min 10 ₺ altı" : "Satılamaz"}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Toplu Bozdur Butonu */}
            {walletAssets.some((w) => !botState.positions.some((p) => p.symbol === w.asset) && w.canSell) && (
              <div className="pt-2 border-t border-border">
                <Button
                  size="sm"
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-8 text-xs flex items-center justify-center gap-1.5 shadow-lg"
                  disabled={sellingAsset !== null}
                  onClick={handleSellAllOrphanAssets}
                >
                  <Coins className="size-3.5" />
                  ⚡ Tüm Sahipsiz Coinleri Sat & Serbest Nakiti Geri Al
                </Button>
                <p className="text-[10px] text-muted-foreground text-center mt-1">
                  Bot yuvalarında aktif olmayan tüm coinler piyasa fiyatından TRY&apos;ye dönüştürülüp cüzdan serbest nakitinize eklenir.
                </p>
              </div>
            )}

            {/* Toz Bakiye (<10 ₺) Bilgilendirme Kutusu */}
            <div className="rounded-lg bg-muted/20 border border-border/60 p-2.5 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <span>🤖 Otomatik Artık Temizleme Devrede</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Bot her dakika cüzdanınızı tarar; bot yuvasında olmayan ve 10 ₺ üzerindeki tüm artık coinleri <strong>otomatik TRY&apos;ye çevirip</strong> alım gücünüze katar.
              </p>
              <p className="text-[10px] text-muted-foreground/80 pt-1 border-t border-border/40">
                💡 <em>10 ₺ altındaki ufak küsuratları (Toz Bakiye) Binance TR uygulamasından <strong>Cüzdan &gt; Küçük Bakiyeleri BNB&apos;ye Dönüştür</strong> seçeneğiyle tek dokunuşla BNB&apos;ye çevirebilirsiniz.</em>
              </p>
            </div>

            <div className="pt-1 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowWalletRecoveryModal(false)}>
                Kapat
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
