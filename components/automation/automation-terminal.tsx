"use client"

import { useState, useEffect, useMemo } from "react"
import useSWR from "swr"
import {
  Play, Pause, Zap, TrendingUp, TrendingDown, ShieldCheck,
  Target, History, Sliders, DollarSign, Plus, Trash2, Bot, RotateCcw, Flame, Sparkles, Clock, CheckCircle, Key, Lock, Wallet, AlertTriangle, Eye, EyeOff, Layers, Award, ArrowUpRight, Mail, Send
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  type BotState, type Position, type ManualOrderTrigger, type TradeLog, type BinanceCredentials,
  INITIAL_BOT_STATE, BOT_STORAGE_KEY, WATCHED_CRYPTOS,
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

function calculateOpportunityScore(crypto: any): { score: number; reason: string; mode: "DIP" | "TREND" | "WATCH" } {
  let score = 0
  let mode: "DIP" | "TREND" | "WATCH" = "WATCH"
  const reasons: string[] = []

  const rsi = crypto.rsi ?? 50
  const hasAlSignal = crypto.signal && crypto.signal.includes("AL")
  const aboveSma = crypto.price > crypto.sma

  // ── MOD 1: DİP ALIMI (RSI aşırı satım bölgesi) ────────────────────────
  if (rsi <= 30) {
    score += 40
    mode = "DIP"
    reasons.push("🔴 Aşırı Dip RSI " + rsi.toFixed(1))
  } else if (rsi <= 35) {
    score += 30
    mode = "DIP"
    reasons.push("🟠 Dip Bölgesi RSI " + rsi.toFixed(1))
  } else if (rsi <= 45) {
    score += 15
    mode = "DIP"
    reasons.push("🟡 Dip Yakını RSI " + rsi.toFixed(1))
  }

  // ── MOD 2: YÜKSELİŞ TRENDİ TAKIBI (RSI 50-65, ivme yukarı) ──────────
  // RSI 50-65 = trendin başında / ortasında, henüz aşırı alım değil
  if (rsi > 45 && rsi <= 65 && hasAlSignal && aboveSma) {
    score += 35   // Trend momentum — güçlü sinyal, daha fazla puan
    mode = "TREND"
    reasons.push("📈 Yükseliş Trendi RSI " + rsi.toFixed(1))
  } else if (rsi > 65 && rsi <= 75 && hasAlSignal && aboveSma) {
    // RSI 65-75: trendin geç fazı, ufak puan — dikkatli giriş
    score += 10
    reasons.push("⚡ Geç Trend RSI " + rsi.toFixed(1) + " (dikkatli)")
  }
  // RSI > 75: aşırı alım, bot girmez

  // ── ORTAK KRİTERLER & KÂR/POPÜLARİTE AVANTAJLARI ──────────────────────
  if (hasAlSignal && aboveSma) {
    score += 20
    reasons.push("HO 20 Üzeri İvme")
  }
  if (crypto.confidence && crypto.confidence >= 80) {
    score += 15
    reasons.push("%" + crypto.confidence + " Güven")
  }
  // Komisyon Güvenliği: Eğer komisyon beklenen kârın %10'undan azsa bonus puan
  if (crypto.commissionSafe) {
    score += 10
    reasons.push("🛡️ Düşük Komisyon (<%10)")
  }
  // Ucuz Fiyat Bonusu: Birim fiyatı düşük olan coinler küçük bakiyelerle çok adet alınabilir
  if (crypto.price < 100) {
    score += 10
    reasons.push("💰 Uygun Birim Fiyat")
  }
  // Pozitif Günlük İvme Bonusu: Günlük bazda yeşil yakan, kazandıran coinler
  if (crypto.change && crypto.change > 1.5) {
    score += 10
    reasons.push(`🔥 +%${crypto.change.toFixed(1)} Günlük İvme`)
  }

  return { score, reason: reasons.join(" + ") || "Genel İzleme", mode }
}


export function AutomationTerminal({ onBack }: { onBack: () => void }) {
  const [botState, setBotState] = useState<BotState>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(BOT_STORAGE_KEY)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (parsed && parsed.currency === "TRY") {
            return {
              ...parsed,
              strategy: {
                ...parsed.strategy,
                maxConcurrentPositions: parsed.strategy?.maxConcurrentPositions || 3,
                autoAllocateCapital: parsed.strategy?.autoAllocateCapital ?? true,
                aiOpportunityRanking: parsed.strategy?.aiOpportunityRanking ?? true,
                // Öneri 4 & 5 defaults (geriye dönük uyum)
                dynamicSizing: parsed.strategy?.dynamicSizing ?? true,
                dynamicSizingAggressiveness: parsed.strategy?.dynamicSizingAggressiveness ?? "balanced",
                dailyMaxLossPct: parsed.strategy?.dailyMaxLossPct ?? 5,
                memeCoinsOnly: parsed.strategy?.memeCoinsOnly ?? false,
                stalePositionTimeoutEnabled: parsed.strategy?.stalePositionTimeoutEnabled ?? true,
                stalePositionTimeoutHours: parsed.strategy?.stalePositionTimeoutHours ?? 4,
                btcDropProtectionEnabled: parsed.strategy?.btcDropProtectionEnabled ?? true,
                btcDropThresholdPct: parsed.strategy?.btcDropThresholdPct ?? -2.0,
                emailNotificationsEnabled: parsed.strategy?.emailNotificationsEnabled ?? true,
                userNotificationEmail: parsed.strategy?.userNotificationEmail || "",
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

  // ── Sunucu State Senkronizasyonu (Vercel Cron ile 7/24 çalışan bot için) ──
  // Her 30 saniyede /api/bot/state'i sorgular. Sekme kapalıyken Vercel'in
  // cron'u pozisyon açmış/kapatmışsa, kullanıcı siteye girince hepsini görebilir.
  const { data: serverState } = useSWR<{
    ok: boolean
    positions?: typeof botState.positions
    balance?: number
    initialBalance?: number
    logs?: typeof botState.logs
    history?: typeof botState.history
    active?: boolean
    fetchedAt?: number
  }>("/api/bot/state", fetcher, {
    refreshInterval: 30000,
    dedupingInterval: 25000,
    revalidateOnFocus: true,
  })

  // Sunucudan gelen state ile tarayıcı state'ini birleştir (sunucu öncelikli)
  useEffect(() => {
    if (!serverState?.ok) return
    const serverPos = serverState.positions ?? []
    const serverHistory = serverState.history ?? []
    const serverLogs = serverState.logs ?? []
    const serverBalance = serverState.balance

    setBotState((prev) => {
      const hasNewPositions = serverPos.length !== prev.positions.length
      const hasNewHistory = serverHistory.length > prev.history.length
      const hasNewLogs = serverLogs.length > prev.logs.length
      const balanceDiff = serverBalance && Math.abs(serverBalance - prev.balanceTry) > 1

      if (!hasNewPositions && !hasNewHistory && !hasNewLogs && !balanceDiff) return prev
      return {
        ...prev,
        positions: hasNewPositions ? serverPos : prev.positions,
        history: hasNewHistory ? serverHistory : prev.history,
        logs: hasNewLogs ? [...serverLogs.slice(0, 50), ...prev.logs].slice(0, 150) : prev.logs,
        balanceTry: balanceDiff ? serverBalance! : prev.balanceTry,
      }
    })
  }, [serverState])

  // Strateji değiştiğinde sunucuya da kaydet (cron botu yeni strateji ile çalışsın)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/bot/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy: botState.strategy, active: botState.active }),
      }).catch(() => {})
    }, 1500)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botState.strategy, botState.active])

  const [activeTab, setActiveTab] = useState<"slots" | "signals" | "positions" | "triggers" | "binance" | "strategy" | "logs">("slots")
  const [showApiModal, setShowApiModal] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  const [apiAccountName, setApiAccountName] = useState(botState.binance?.accountName || "Kişisel Binance Hesabım")
  const [apiKeyInput, setApiKeyInput] = useState(botState.binance?.apiKey || "")
  const [apiSecretInput, setApiSecretInput] = useState(botState.binance?.apiSecret || "")
  const [realBalanceInput, setRealBalanceInput] = useState(botState.binance?.realBalanceTry ? String(botState.binance.realBalanceTry) : "15000")
  const [accountTypeInput, setAccountTypeInput] = useState<"REAL" | "SIMULATION">(botState.binance?.accountType || "SIMULATION")

  const [trigSymbol, setTrigSymbol] = useState("PEPE")
  const [trigTarget, setTrigTarget] = useState("")
  const [trigDirection, setTrigDirection] = useState<"BELOW" | "ABOVE">("BELOW")
  const [trigAction, setTrigAction] = useState<"BUY" | "SELL">("BUY")
  const [trigAmount, setTrigAmount] = useState("1000")

  const { data: scanData, mutate: scanNow } = useSWR<{
    items: any[]
    usdTryRate: number
    currency: string
    timestamp: number
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

  async function handleSaveBinanceCredentials(e: React.FormEvent) {
    e.preventDefault()
    const balanceNum = parseFloat(realBalanceInput) || 0
    const isReal = accountTypeInput === "REAL"

    // 🛡️ Client-Side Web Crypto (AES-GCM 256-Bit) Şifreleme
    const encryptedKey = apiKeyInput.trim() ? await encryptSensitive(apiKeyInput.trim()) : ""
    const encryptedSecret = apiSecretInput.trim() ? await encryptSensitive(apiSecretInput.trim()) : ""

    const newCreds: BinanceCredentials = {
      accountName: apiAccountName || "Kişisel Binance Hesabı",
      apiKey: encryptedKey,
      apiSecret: encryptedSecret,
      accountType: accountTypeInput,
      connected: true,
      realBalanceTry: balanceNum,
      lastSyncTime: new Date().toLocaleTimeString("tr-TR"),
    }

    setBotState((prev) => ({
      ...prev,
      balanceTry: isReal && balanceNum > 0 ? balanceNum : prev.balanceTry,
      initialBalanceTry: isReal && balanceNum > 0 ? balanceNum : prev.initialBalanceTry,
      binance: newCreds,
    }))

    addLog(
      "ALERT",
      isReal
        ? "🟢 BİNANCE GERÇEK HESAP BAĞLANDI (AES-256 Şifreli Vault Aktif): " + newCreds.accountName + " (₺" + fmt(balanceNum) + " sermaye ayrıldı). Otonom 2-3 slot yöneticisi devrede. (YTD)"
        : "🧪 BİNANCE SİMÜLASYON MODU: " + newCreds.accountName + " bağlandı. 7/24 canlı piyasada risksiz test ediliyor."
    )
    setShowApiModal(false)
  }


  function openPosition(
    symbol: string,
    name: string,
    marketPrice: number,
    totalTry: number,
    triggerType: Position["triggerType"],
    reasonText?: string
  ) {
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
    const amount = totalTry / entryPrice
    const slPct = botState.strategy.defaultStopLossPct / 100
    const tpPct = botState.strategy.defaultTakeProfitPct / 100
    const stopLossPrice = entryPrice * (1 - slPct)
    const takeProfitPrice = entryPrice * (1 + tpPct)

    const newPosition: Position = {
      id: "pos-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      symbol,
      name,
      side: "BUY",
      entryPrice,
      currentPrice: entryPrice,
      highestPrice: entryPrice,
      trailingStopPrice: stopLossPrice,
      amount,
      totalTry,
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
    }

    setBotState((prev) => ({
      ...prev,
      balanceTry: prev.balanceTry - totalTry,
      positions: [newPosition, ...prev.positions],
    }))

    const isReal = botState.binance?.connected && botState.binance?.accountType === "REAL"
    addLog(
      "BUY",
      (isReal ? "🟢 [GERÇEK BİNANCE] " : "🧪 [SİMÜLASYON] ") + "LİMİT ALIM: " + symbol + " @ " + fmt(entryPrice) + " ₺ (" + fmt(totalTry) + " ₺). TP: " + fmt(takeProfitPrice) + " ₺ | SL: " + fmt(stopLossPrice) + " ₺ [Komisyon: " + commCheck.totalFeeTry.toFixed(2) + " ₺, Oran: %" + commCheck.feeRatio.toFixed(1) + "]",
      symbol
    )

    // 📧 E-posta Bildirimi Gönder
    if (botState.strategy.emailNotificationsEnabled && botState.strategy.userNotificationEmail) {
      sendEmailNotification(
        botState.strategy.userNotificationEmail,
        `🟢 Bot Yeni Pozisyon Açtı: ${symbol}`,
        `${symbol} için ${fmt(entryPrice)} ₺ fiyattan ${fmt(totalTry)} ₺ tutarında limit alış emri gerçekleşti.\nTake-Profit: ${fmt(takeProfitPrice)} ₺\nStop-Loss: ${fmt(stopLossPrice)} ₺`
      )
    }

    return true
  }


  function closePosition(positionId: string, currentPrice: number, reason: string) {
    const pos = botState.positions.find((p) => p.id === positionId)
    if (!pos) return
    const returnTry = pos.amount * currentPrice
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
      pnl: grossPnl,
      netPnlTry: netPnl,
      pnlPercent,
    }

    setBotState((prev) => ({
      ...prev,
      balanceTry: prev.balanceTry + returnTry,
      positions: prev.positions.filter((p) => p.id !== positionId),
      history: [closedPosition, ...prev.history.slice(0, 99)],
    }))

    const isReal = botState.binance?.connected && botState.binance?.accountType === "REAL"
    addLog(
      "SELL",
      (isReal ? "🟢 [GERÇEK BİNANCE] " : "🧪 [SİMÜLASYON] ") + "POZİSYON KAPATILDI: " + pos.symbol + " @ " + fmt(currentPrice) + " ₺ | NET: " + (isWin ? "+" : "") + fmt(netPnl) + " ₺ (%" + pnlPercent.toFixed(2) + ") [" + reason + "]",
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
  }


  const openPositionsValue = useMemo(() => {
    return botState.positions.reduce((acc, p) => acc + p.amount * p.currentPrice, 0)
  }, [botState.positions, marketItems])

  const totalPortfolioTry = botState.balanceTry + openPositionsValue
  const totalPnlTry = totalPortfolioTry - botState.initialBalanceTry
  const totalPnlPct = (totalPnlTry / botState.initialBalanceTry) * 100
  const winCount = botState.history.filter((h) => h.pnl > 0).length
  const winRate = botState.history.length ? Math.round((winCount / botState.history.length) * 100) : 0
  const isRealAccount = Boolean(botState.binance?.connected && botState.binance?.accountType === "REAL")

  const maxSlots = botState.strategy.maxConcurrentPositions || 3
  const currentOpenCount = botState.positions.length
  const availableSlots = Math.max(0, maxSlots - currentOpenCount)

  /** Temel slot miktarı (bakiyenin slot sayısına bölünmesi) */
  const baseSlotAmount = useMemo(() => {
    if (botState.strategy.autoAllocateCapital) {
      const base = totalPortfolioTry > 0 ? totalPortfolioTry : botState.balanceTry
      return Math.max(250, Math.floor(base / maxSlots))
    }
    return botState.strategy.tradeAmountTry || 1000
  }, [totalPortfolioTry, botState.balanceTry, maxSlots, botState.strategy.autoAllocateCapital, botState.strategy.tradeAmountTry])

  /**
   * Öneri 4 — Dinamik Pozisyon Boyutu
   * AI skoruna göre slot büyüklüğünü ayarla.
   * aggressiveness=conservative → skor 90+ %40, 75-89 %30, altı %20 artı
   * aggressiveness=balanced    → skor 90+ %50, 75-89 %35, altı %25 artı
   * aggressiveness=aggressive  → skor 90+ %70, 75-89 %50, altı %30 artı
   */
  function calcDynamicAmount(opportunityScore: number): number {
    if (!botState.strategy.dynamicSizing) return baseSlotAmount
    const agg = botState.strategy.dynamicSizingAggressiveness || "balanced"
    const bonusMap = {
      conservative: { high: 0.40, mid: 0.30, low: 0.20 },
      balanced:     { high: 0.50, mid: 0.35, low: 0.25 },
      aggressive:   { high: 0.70, mid: 0.50, low: 0.30 },
    }
    const bonus = bonusMap[agg]
    let multiplier: number
    if (opportunityScore >= 90) multiplier = 1 + bonus.high
    else if (opportunityScore >= 75) multiplier = 1 + bonus.mid
    else multiplier = 1 + bonus.low
    const available = botState.balanceTry
    const maxAllowed = available / Math.max(1, availableSlots)
    return Math.min(Math.floor(baseSlotAmount * multiplier), Math.floor(maxAllowed * 0.95))
  }

  // Geriye dönük uyum için eski adla da tut
  const dynamicSlotAmount = baseSlotAmount


  useEffect(() => {
    if (!botState.active || !marketItems.length) return

    botState.positions.forEach((pos) => {
      const liveItem = marketItems.find((m: any) => m.symbol === pos.symbol)
      if (!liveItem) return

      const curPrice = liveItem.price
      pos.currentPrice = curPrice
      pos.pnl = pos.amount * curPrice - pos.totalTry
      pos.pnlPercent = (pos.pnl / pos.totalTry) * 100
      const currentHighest = Math.max(pos.highestPrice || pos.entryPrice, curPrice)
      pos.highestPrice = currentHighest

      // 1. Sıfır Zarar (Breakeven) Kilidi: Kâr %0.7 üzerine çıktığında Stop giriş seviyesine çekilir
      if (botState.strategy.breakevenEnabled && pos.pnlPercent >= (botState.strategy.breakevenPct || 0.7) && pos.stopLossPrice < pos.entryPrice) {
        pos.stopLossPrice = pos.entryPrice * 1.002
        addLog("ALERT", "🛡️ SIFIR ZARAR KİLİDİ: " + pos.symbol + " stop seviyesi girişin üzerine çekildi (Zarar riski kalktı).", pos.symbol)
      }

      // 2. Trailing Stop Hesaplama
      const trailPct = (botState.strategy.trailingStopPct || 0.8) / 100
      const calculatedTrailStop = currentHighest * (1 - trailPct)
      if (!pos.trailingStopPrice || calculatedTrailStop > pos.trailingStopPrice) {
        pos.trailingStopPrice = calculatedTrailStop
      }

      // 3. Take-Profit Ulaşıldı (+%2.5)
      if (curPrice >= pos.takeProfitPrice) {
        closePosition(pos.id, curPrice, "Hedef Kâr Gerçekleşti (Take-Profit) 🎯")
        return
      }

      // 4. Akıllı Erken Kâr Kilitleme (Smart Early Exit)
      if (botState.strategy.smartEarlyExitEnabled) {
        const peakGainPct = ((currentHighest - pos.entryPrice) / pos.entryPrice) * 100
        if (peakGainPct >= 1.0 && curPrice <= pos.trailingStopPrice && curPrice > pos.entryPrice) {
          closePosition(pos.id, curPrice, "Akıllı Kâr Kilitleme: Zirveden düşüşte kâr cebe atıldı 🛡️")
          return
        }
        const isWeakening = (liveItem.rsi && liveItem.rsi < 44) || (liveItem.sma && curPrice < liveItem.sma)
        if (pos.pnlPercent >= 0.7 && isWeakening && curPrice < currentHighest * 0.992) {
          closePosition(pos.id, curPrice, "Akıllı Erken Çıkış: Yükseliş gücü tükendi, ufak kârla çıkıldı ⚡")
          return
        }
      }

      // 5. Normal Stop-Loss
      if (curPrice <= pos.stopLossPrice) {
        closePosition(pos.id, curPrice, "Zarar Kes (Stop-Loss) Tetiklendi 🛑")
        return
      }

      // ── Öneri 2: Yatay Pozisyon Kapatma (4 Saat Zaman Aşımı) ────────────
      if (botState.strategy.stalePositionTimeoutEnabled) {
        const timeoutMs = (botState.strategy.stalePositionTimeoutHours || 4) * 60 * 60 * 1000
        const openedAtMs = pos.openedTimestamp || 0
        const timeHeldMs = Date.now() - openedAtMs

        // Eğer 4 saat dolduysa ve kâr/zarar -%0.5 ile +%0.8 arasında yataya bağladıysa:
        if (openedAtMs > 0 && timeHeldMs >= timeoutMs && Math.abs(pos.pnlPercent) < 0.8) {
          closePosition(
            pos.id,
            curPrice,
            `⏳ Yatay Pozisyon Tahliyesi: ${botState.strategy.stalePositionTimeoutHours || 4} saatte hedefe gitmedi, sermaye yeni fırsat için serbest bırakıldı.`
          )
          return
        }
      }
    })

    botState.manualTriggers.forEach((trig) => {
      if (!trig.active) return
      const liveItem = marketItems.find((m: any) => m.symbol === trig.symbol)
      if (!liveItem) return
      const curPrice = liveItem.price
      let triggered = false
      if (trig.direction === "BELOW" && curPrice <= trig.targetPrice) triggered = true
      else if (trig.direction === "ABOVE" && curPrice >= trig.targetPrice) triggered = true
      if (triggered) {
        openPosition(trig.symbol, trig.name, curPrice, trig.amountTry, "MANUAL", "Özel Hedef: " + fmt(trig.targetPrice) + " ₺")
        setBotState((prev) => ({ ...prev, manualTriggers: prev.manualTriggers.map((t) => (t.id === trig.id ? { ...t, active: false } : t)) }))
        addLog("ALERT", "ÖZEL LİMİT EMİR TETİKLENDİ: " + trig.symbol + " hedef fiyata ulaştı (" + fmt(curPrice) + " ₺).", trig.symbol)
      }
    })

    // ── Öneri 3: BTC Şelale / Ani Çöküş Koruması (Market Panic Switch) ───────
    if (botState.strategy.btcDropProtectionEnabled && (isBtcDropping || btcChange <= (botState.strategy.btcDropThresholdPct || -2.0))) {
      addLog(
        "ALERT",
        `⚡ BTC ŞELALE KORUMASI AKTİF: Bitcoin son dönemde %${btcChange.toFixed(2)} düştü! Piyasa riskini önlemek için yeni alımlar donduruldu.`
      )
      return // BTC çökerken hiçbir yeni altcoin alımı yapma!
    }

    // ── Öneri 5: Günlük Maks. Zarar Limiti ──────────────────────────────────
    const todayStr = new Date().toISOString().slice(0, 10) // "2026-09-03"
    const isNewDay = botState.dailyLossDate !== todayStr
    if (isNewDay) {
      // Yeni gün: başlangıç bakiyesini güncelle
      setBotState((prev) => ({
        ...prev,
        dailyLossStartBalance: prev.balanceTry + openPositionsValue,
        dailyLossDate: todayStr,
      }))
    } else {
      const startBal = botState.dailyLossStartBalance ?? (botState.balanceTry + openPositionsValue)
      const currentPortfolio = botState.balanceTry + openPositionsValue
      const dailyLossPct = ((startBal - currentPortfolio) / startBal) * 100
      const maxLoss = botState.strategy.dailyMaxLossPct || 5
      if (dailyLossPct >= maxLoss) {
        if (botState.strategy.autoPilot) {
          setBotState((prev) => ({
            ...prev,
            strategy: { ...prev.strategy, autoPilot: false },
          }))
          addLog(
            "ALERT",
            `🛑 GÜNLÜK ZARAR LİMİTİ AŞILDI! Bugün -%${dailyLossPct.toFixed(2)} zarar oluştu (Limit: -%${maxLoss}). Otopilot DURDURULDU. Yarın yeniden başlayacak.`
          )
        }
        return // Bu güncelleme turunda yeni pozisyon açma
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    if (botState.strategy.autoPilot && availableSlots > 0 && botState.balanceTry >= baseSlotAmount) {
      const candidates = marketItems
        .filter((item: any) => {
          if (botState.strategy.memeCoinsOnly && !item.isMeme) return false
          const alreadyOpen = botState.positions.some((p) => p.symbol === item.symbol)
          return !alreadyOpen && item.commissionSafe
        })
        .map((item: any) => ({
          ...item,
          opp: calculateOpportunityScore(item)
        }))
        .filter((item: any) => item.opp.score >= 40)
        .sort((a: any, b: any) => b.opp.score - a.opp.score)

      if (candidates.length > 0) {
        const best = candidates[0]
        // Öneri 4: AI skora göre dinamik pozisyon boyutu
        const tradeAmount = calcDynamicAmount(best.opp.score)
        const modeEmoji = best.opp.mode === "TREND" ? "📈 TREND TAKİBİ" : best.opp.mode === "DIP" ? "🔴 DİP ALIMI" : "👁️ İZLEME"
        const aggLabel = botState.strategy.dynamicSizing
          ? ` [Dinamik: ${tradeAmount.toLocaleString("tr-TR")} ₺, Skor ${best.opp.score}/100]`
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
  }, [marketItems, botState.active, availableSlots, baseSlotAmount, openPositionsValue, btcChange, isBtcDropping])


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
    if (confirm("Sanal portföy ve işlem geçmişi sıfırlansın mı?")) {
      setBotState({
        ...INITIAL_BOT_STATE,
        balanceTry: 50000,
        initialBalanceTry: 50000,
        positions: [],
        history: [],
      })
      addLog("INFO", "Portföy ve bakiye 50.000 ₺ olarak sıfırlandı.")
    }
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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur">

        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Bot className="size-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">Binance TL Otonom Kripto Botu</h1>
              <Badge variant="outline" className={cn("font-mono text-[10px] font-bold", isRealAccount ? "border-positive bg-positive/10 text-positive" : "border-warning bg-warning/10 text-warning")}>{isRealAccount ? "🟢 GERÇEK HESAP" : "🧪 SİMÜLASYON TESTİ"}</Badge>
              <Badge variant="outline" className="border-primary/50 bg-primary/10 text-primary font-mono text-[10px] font-bold flex items-center gap-1"><Clock className="size-2.5" />7/24 KESİNTİSİZ</Badge>
            </div>
            <p className="text-xs text-muted-foreground">Sermayeyi otomatik 2-3 yere paylaştıran, en yüksek kârlı fırsatı seçip kendisi alıp satan akıllı oto-pilot</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={botState.binance?.connected ? "outline" : "default"} onClick={() => setShowApiModal(true)} className="gap-1.5 text-xs font-bold border-primary/40"><Key className="size-3.5 text-primary" />{botState.binance?.connected ? "Binance: " + (botState.binance.accountName || "Bağlı") : "Binance API / Para Bağla"}</Button>
          <Button size="sm" variant={botState.active ? "default" : "secondary"} onClick={() => {
            const next = !botState.active
            setBotState((p) => ({ ...p, active: next }))
            addLog("INFO", next ? "BOT 7/24 OTONOM ÇALIŞTIRILDI: Sermaye dağıtımı ve fırsat tarayıcısı devrede." : "BOT DURDURULDU.")
          }} className={cn("gap-1.5 font-bold transition-all shadow-md", botState.active ? "bg-positive hover:bg-positive/90 text-positive-foreground shadow-positive/20" : "border-border text-muted-foreground")}>
            {botState.active ? (<><span className="relative flex size-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75"></span><span className="relative inline-flex size-2 rounded-full bg-white"></span></span><Pause className="size-3.5" />OTONOM ÇALIŞIYOR (7/24)</>) : (<><Play className="size-3.5" />OTONOM BOT'U BAŞLAT</>)}
          </Button>
          <Button variant="outline" size="sm" onClick={onBack}>Terminale Dön</Button>
        </div>
      </div>

      <div className="rounded-xl border border-primary/40 bg-gradient-to-r from-primary/10 via-card to-background p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2.5">
            <Layers className="size-5 text-primary" />
            <div>
              <b className="text-sm text-foreground">Akıllı Sermaye Dağıtıcısı (Oto 2-3 Slot Koruması)</b>
              <p className="text-xs text-muted-foreground">Paran tüm tek bir coine basılmaz; bot sermayeni en fazla {maxSlots} eşit parçaya böler ve en kârlı coinlere dağıtır</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-[11px] text-muted-foreground">Yuva Başına Tutar:</span>
              <p className="font-mono text-xs font-bold text-foreground">{fmt(dynamicSlotAmount)} ₺ / İşlem</p>
            </div>
            <Badge variant="outline" className="border-primary/50 text-primary font-mono text-xs font-bold px-2 py-1">{currentOpenCount} / {maxSlots} YUVA DOLU</Badge>
          </div>
        </div>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          {Array.from({ length: maxSlots }).map((_, idx) => {
            const openPos = botState.positions[idx]
            if (openPos) {
              const isProfit = openPos.pnl >= 0
              return (
                <div key={openPos.id} className="rounded-lg border border-primary/40 bg-card p-3 text-xs space-y-1.5 shadow-sm">
                  <div className="flex items-center justify-between font-mono">
                    <span className="flex items-center gap-1.5 font-bold text-foreground"><span className="size-2 rounded-full bg-positive animate-pulse" />Yuva #{idx + 1}: {openPos.symbol}</span>
                    <span className={cn("font-bold", isProfit ? "text-positive" : "text-negative")}>{isProfit ? "+" : ""}{fmt(openPos.pnl)} ₺ ({isProfit ? "+" : ""}%{openPos.pnlPercent.toFixed(2)})</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Yatırılan: {fmt(openPos.totalTry)} ₺</span>
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
                <p className="text-[11px] text-muted-foreground leading-tight">Bot en yüksek kâr potansiyeline (RSI dip + Altın Oran) sahip coin bulduğunda <b>{fmt(dynamicSlotAmount)} ₺</b> ile otomatik alacak.</p>
                <div className="text-[10px] text-primary flex items-center gap-1 font-medium"><Sparkles className="size-3" />Oto-Pilot Hazırda Bekliyor</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card size="sm" className="border-border/60 bg-card/60">
          <CardHeader className="pb-1"><CardDescription className="text-xs">Toplam Portföy (TL)</CardDescription><CardTitle className="font-mono text-xl text-foreground font-bold">{fmt(totalPortfolioTry)} ₺</CardTitle></CardHeader>
          <CardContent className="pt-0 text-[11px] text-muted-foreground">Kullanılabilir Nakit: {fmt(botState.balanceTry)} ₺</CardContent>
        </Card>
        <Card size="sm" className={cn("border-border/60 bg-card/60", totalPnlTry >= 0 ? "border-positive/30 bg-positive/5" : "border-negative/30 bg-negative/5")}>
          <CardHeader className="pb-1"><CardDescription className="text-xs">Toplam Net Kâr / Zarar</CardDescription><CardTitle className={cn("font-mono text-xl font-bold flex items-center gap-1", totalPnlTry >= 0 ? "text-positive" : "text-negative")}>{totalPnlTry >= 0 ? <TrendingUp className="size-5" /> : <TrendingDown className="size-5" />}{totalPnlTry >= 0 ? "+" : ""}{fmt(totalPnlTry)} ₺</CardTitle></CardHeader>
          <CardContent className={cn("pt-0 font-mono text-[11px] font-semibold", totalPnlTry >= 0 ? "text-positive" : "text-negative")}>{totalPnlPct >= 0 ? "+" : ""}%{totalPnlPct.toFixed(2)} Toplam Getiri</CardContent>
        </Card>
        <Card size="sm" className="border-border/60 bg-card/60">
          <CardHeader className="pb-1"><CardDescription className="text-xs">Açık Pozisyonlar</CardDescription><CardTitle className="font-mono text-xl text-foreground font-bold">{botState.positions.length} / {maxSlots} Slot</CardTitle></CardHeader>
          <CardContent className="pt-0 text-[11px] text-muted-foreground">İşlemdeki Değer: {fmt(openPositionsValue)} ₺</CardContent>
        </Card>
        <Card size="sm" className="border-border/60 bg-card/60">
          <CardHeader className="pb-1"><CardDescription className="text-xs">Kazanma Oranı (Win Rate)</CardDescription><CardTitle className="font-mono text-xl text-foreground font-bold">%{winRate}</CardTitle></CardHeader>
          <CardContent className="pt-0 text-[11px] text-muted-foreground flex items-center justify-between"><span>{botState.history.length} işlem kapandı</span><span className="flex items-center gap-1 text-positive font-medium"><span className="size-1.5 rounded-full bg-positive animate-pulse" /> 7/24 Aktif</span></CardContent>
        </Card>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
        {([
          { id: "slots", label: "🤖 Otonom Slotlar & Genel Bakış", icon: Layers, badge: availableSlots },
          { id: "signals", label: "⚡ Canlı Kripto & Meme Radarı", icon: Flame, badge: marketItems.filter((m: any) => m.proposal).length },
          { id: "positions", label: "💼 Açık Pozisyonlar", icon: DollarSign, badge: botState.positions.length },
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
                const opp = calculateOpportunityScore(crypto)
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
                <div className="rounded-lg border border-border/70 p-2.5 space-y-1"><b className="text-foreground">1. En Fazla 2-3 Yere Dağıtma:</b><p className="text-[11px]">Tüm para asla tek bir coine basılmaz. Bakiye 3 eşit parçaya bölünür. Biri düşse bile diğerleri kâr yazarak riski dağıtır.</p></div>
                <div className="rounded-lg border border-border/70 p-2.5 space-y-1"><b className="text-foreground">2. En Yüksek Kârı Seçme:</b><p className="text-[11px]">RSI aşırı dipte olan veya yukarı ivmelenen, komisyonu kârın %10'unun altında kalan coini otomatik ilk sıraya alır.</p></div>
                <div className="rounded-lg border border-border/70 p-2.5 space-y-1"><b className="text-foreground">3. Eller Serbest Çıkış:</b><p className="text-[11px]">%0.7 kârda stop başabaşa çekilip risk 0 yapılır, %2.5 hedefte kâr realize edilip yuva boşaltılır.</p></div>
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
                      <span className={cn("font-mono text-xs font-semibold", crypto.change >= 0 ? "text-positive" : "text-negative")}>{crypto.change >= 0 ? "+" : ""}{crypto.change.toFixed(2)}%</span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="font-mono text-base font-bold text-foreground">{fmt(crypto.price)} ₺</span>
                      <span className={cn("rounded px-1.5 py-0.5 font-mono text-[10px] font-bold", crypto.rsi <= 32 ? "bg-positive/20 text-positive" : crypto.rsi >= 68 ? "bg-negative/20 text-negative" : "bg-muted text-muted-foreground")}>RSI: {crypto.rsi ? crypto.rsi.toFixed(1) : "—"}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0 text-[11px]">
                    <div className="flex items-center justify-between text-muted-foreground"><span>Limit Alış Seviyesi:</span><b className="font-mono text-foreground">{fmt(crypto.limitPrice)} ₺</b></div>
                    <div className="flex items-center justify-between text-muted-foreground"><span>Komisyon Kâr Oranı:</span><b className={cn("font-mono", crypto.commissionSafe ? "text-positive" : "text-negative")}>%{crypto.commissionRatio ? crypto.commissionRatio.toFixed(1) : "8.1"} (Max %10)</b></div>
                    {crypto.proposal && (
                      <div className="rounded-md border border-border/60 bg-background/80 p-2 text-[11px]"><div className="flex items-center justify-between font-bold"><span className={isBuying ? "text-positive flex items-center gap-1" : "text-warning"}><Sparkles className="size-3" />{isBuying ? "🟢 LİMİT AL SİNYALİ" : "🟡 KÂR REALİZASYONU"}</span><span className="font-mono text-[10px] text-muted-foreground">%{crypto.proposal.confidence} Güven</span></div><p className="mt-1 text-[10px] text-muted-foreground leading-tight">{crypto.proposal.reason}</p></div>
                    )}
                    <div className="pt-1">
                      {alreadyOpen ? (<div className="w-full rounded-md border border-primary/30 bg-primary/10 py-1 text-center font-mono text-[11px] font-bold text-primary">✓ POZİSYON AÇIK</div>) : (
                        <Button size="sm" className="w-full h-7 text-xs font-bold gap-1" variant={hasProposal && isBuying ? "default" : "outline"} onClick={() => {
                          openPosition(crypto.symbol, crypto.name, crypto.price, dynamicSlotAmount, "AI_SUGGESTION", crypto.proposal?.reason || "Kullanıcı limit alım onayı")
                        }}><Target className="size-3" />Limit Alış Emri Kur ({fmt(dynamicSlotAmount)} ₺)</Button>
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
          <CardHeader className="border-b"><CardTitle className="text-sm">Canlı Açık Pozisyonlar ({botState.positions.length})</CardTitle><CardDescription className="text-xs">Limit emirle açılan işlemler; %0.7 kârda Stop otomatik başabaşa çekilir (Sıfır Risk), %2.5 hedefte kâr cebe atılır.</CardDescription></CardHeader>
          <CardContent className="p-0">
            {botState.positions.length === 0 ? (<div className="py-12 text-center text-muted-foreground"><p className="text-sm">Şu an açık pozisyon bulunmuyor.</p><p className="text-xs mt-1">Bot sinyal bulduğunda veya "Canlı Meme Coin Radarı"ndan alım yaptığında burada listelenir.</p></div>) : (
              <div className="divide-y divide-border/60">
                {botState.positions.map((pos) => {
                  const isProfit = pos.pnl >= 0
                  return (
                    <div key={pos.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
                      <div className="flex items-center gap-3"><div className={cn("size-2 rounded-full", isProfit ? "bg-positive animate-pulse" : "bg-negative")} /><div><div className="flex items-center gap-2"><b className="font-mono text-sm text-foreground">{pos.symbol}</b><Badge variant="outline" className="text-[10px] py-0 font-mono font-bold bg-muted">{pos.orderType || "LİMİT"}</Badge></div><p className="text-[11px] text-muted-foreground">Açılış: {pos.openedAt} · Tutar: {fmt(pos.totalTry)} ₺</p></div></div>
                      <div className="grid grid-cols-2 gap-4 font-mono sm:grid-cols-4">
                        <div><p className="text-[10px] text-muted-foreground">Giriş Fiyatı</p><p className="font-semibold">{fmt(pos.entryPrice)} ₺</p></div>
                        <div><p className="text-[10px] text-muted-foreground">Güncel Fiyat</p><p className="font-semibold">{fmt(pos.currentPrice)} ₺</p></div>
                        <div><p className="text-[10px] text-muted-foreground">SL / TP / Trailing</p><p className="text-[11px]"><span className="text-negative">{fmt(pos.stopLossPrice)} ₺</span> / <span className="text-positive">{fmt(pos.takeProfitPrice)} ₺</span>{pos.trailingStopPrice && pos.trailingStopPrice > pos.stopLossPrice ? <span className="text-primary block font-bold">🛡️ Takip: {fmt(pos.trailingStopPrice)} ₺</span> : null}</p></div>
                        <div><p className="text-[10px] text-muted-foreground">Anlık Kâr / Zarar</p><p className={cn("font-bold", isProfit ? "text-positive" : "text-negative")}>{isProfit ? "+" : ""}{fmt(pos.pnl)} ₺ ({isProfit ? "+" : ""}%{pos.pnlPercent.toFixed(2)})</p>{pos.highestPrice && pos.highestPrice > pos.entryPrice ? <span className="text-[10px] text-muted-foreground block">Zirve: {fmt(pos.highestPrice)} ₺</span> : null}</div>
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
                    <Input value={apiAccountName} onChange={(e) => setApiAccountName(e.target.value)} placeholder="Örn: Furkan Binance TR Cüzdanı" className="mt-1 text-xs" required />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground">Bota Tahsis Edilen Gerçek Para Bakiyesi (TL ₺)</label>
                    <Input type="number" value={realBalanceInput} onChange={(e) => setRealBalanceInput(e.target.value)} placeholder="Örn: 15000" className="mt-1 font-mono text-xs font-bold text-positive" required />
                    <p className="text-[10px] text-muted-foreground mt-1">Bot bu tutarı otomatik olarak 3 eşit parçaya böler ({fmt(parseFloat(realBalanceInput || "0") / 3)} ₺ / işlem).</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground">Binance API Key (Opsiyonel / İsteğe Bağlı)</label>
                    <Input value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} placeholder="Binance API Anahtarı (vmPU...)" className="mt-1 font-mono text-xs" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground">Binance API Secret (Opsiyonel / İsteğe Bağlı)</label>
                    <div className="relative mt-1">
                      <Input type={showSecret ? "text" : "password"} value={apiSecretInput} onChange={(e) => setApiSecretInput(e.target.value)} placeholder="Binance Gizli Anahtarı (••••••••)" className="font-mono text-xs pr-8" />
                      <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
                    </div>
                  </div>
                  <Button type="submit" size="sm" className="w-full font-bold gap-1.5"><ShieldCheck className="size-4" />Bilgileri Kaydet & Hesabı Bağla</Button>
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
                <div className="flex items-center justify-between"><div><b className="text-xs text-foreground flex items-center gap-1.5"><Layers className="size-4 text-primary" />Maksimum Açık Pozisyon (Slot Sayısı)</b><p className="text-[11px] text-muted-foreground">Sermaye en fazla 2 veya 3 parçaya bölünür, tek bir coinde batma riski önlenir</p></div>
                <div className="flex items-center gap-1">
                  {[2, 3].map((slot) => (
                    <button key={slot} type="button" onClick={() => setBotState((p) => ({ ...p, strategy: { ...p.strategy, maxConcurrentPositions: slot } }))} className={cn("rounded px-3 py-1 font-mono text-xs font-bold transition-all", maxSlots === slot ? "bg-primary text-primary-foreground shadow" : "bg-muted text-muted-foreground hover:text-foreground")}>{slot} Slot</button>
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

              {/* ── Öneri 3: BTC Şelale Koruması (Market Panic Switch) ── */}
              <div className="rounded-lg border border-warning/50 bg-warning/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <b className="text-xs text-foreground flex items-center gap-1.5"><Zap className="size-4 text-warning" />BTC Şelale Koruması (Market Panic Switch)</b>
                    <p className="text-[11px] text-muted-foreground">Bitcoin aniden -%2'den fazla çakılırsa tüm yeni altcoin alımlarını anında dondurur</p>
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
                    {btcChange >= 0 ? "+" : ""}%{btcChange.toFixed(2)} {isBtcDropping ? "⚠️ ŞELALE RİSKİ" : "✓ Güvenli"}
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
              <div className="rounded-lg border border-negative/40 bg-negative/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <b className="text-xs text-foreground flex items-center gap-1.5"><AlertTriangle className="size-4 text-negative" />Günlük Maks. Zarar Limiti (Kapital Koruması)</b>
                    <p className="text-[11px] text-muted-foreground">Bu % zarara ulaşılırsa otopilot o gün durur, ertesi gün yeniden başlar</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Günlük Max Zarar:</span>
                  <Input
                    type="number"
                    step="0.5"
                    min="1"
                    max="20"
                    value={botState.strategy.dailyMaxLossPct ?? 5}
                    onChange={(e) => setBotState((p) => ({ ...p, strategy: { ...p.strategy, dailyMaxLossPct: Number(e.target.value) } }))}
                    className="w-20 font-mono text-xs text-negative font-bold"
                  />
                  <span className="text-xs font-bold text-negative">%</span>
                </div>
                {(() => {
                  const startBal = botState.dailyLossStartBalance ?? totalPortfolioTry
                  const currentPortfolio = totalPortfolioTry
                  const dailyLossPct = startBal > 0 ? Math.max(0, ((startBal - currentPortfolio) / startBal) * 100) : 0
                  const maxLoss = botState.strategy.dailyMaxLossPct ?? 5
                  const isAtRisk = dailyLossPct >= maxLoss * 0.7
                  const isStopped = dailyLossPct >= maxLoss
                  return (
                    <div className={cn("rounded border p-2 text-[10px] font-mono space-y-1", isStopped ? "border-negative/60 bg-negative/10" : isAtRisk ? "border-warning/60 bg-warning/10" : "border-border/60 bg-muted/20")}>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bugünün Zararı:</span>
                        <span className={cn("font-bold", isStopped ? "text-negative" : isAtRisk ? "text-warning" : "text-foreground")}>
                          {dailyLossPct === 0 ? "—" : `-%${dailyLossPct.toFixed(2)}`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Limit:</span>
                        <span className="text-foreground">-%{maxLoss}</span>
                      </div>
                      {isStopped && <p className="text-negative font-bold">🛑 GÜNLÜK ZARAR LİMİTİ AŞILDI — OTOPİLOT DURDURULDU</p>}
                      {isAtRisk && !isStopped && <p className="text-warning font-bold">⚠️ Limite yaklaşılıyor, dikkat!</p>}
                    </div>
                  )
                })()}
              </div>

              <div className="grid grid-cols-2 gap-2"><div><label className="text-xs font-semibold text-positive">Scalp Hedef Kâr (%)</label><Input type="number" step="0.1" value={botState.strategy.defaultTakeProfitPct} onChange={(e) => setBotState((p) => ({ ...p, strategy: { ...p.strategy, defaultTakeProfitPct: Number(e.target.value) } }))} className="mt-1 font-mono text-xs text-positive" /></div><div><label className="text-xs font-semibold text-negative">Zarar Kes Stop-Loss (%)</label><Input type="number" step="0.1" value={botState.strategy.defaultStopLossPct} onChange={(e) => setBotState((p) => ({ ...p, strategy: { ...p.strategy, defaultStopLossPct: Number(e.target.value) } }))} className="mt-1 font-mono text-xs text-negative" /></div></div>
              <div className="grid grid-cols-2 gap-2"><div><label className="text-xs font-semibold text-muted-foreground">Dip RSI Eşiği</label><Input type="number" value={botState.strategy.rsiBuyThreshold} onChange={(e) => setBotState((p) => ({ ...p, strategy: { ...p.strategy, rsiBuyThreshold: Number(e.target.value) } }))} className="mt-1 font-mono text-xs" /></div><div><label className="text-xs font-semibold text-muted-foreground">Trailing Takip Mesafesi (%)</label><Input type="number" step="0.1" value={botState.strategy.trailingStopPct} onChange={(e) => setBotState((p) => ({ ...p, strategy: { ...p.strategy, trailingStopPct: Number(e.target.value) } }))} className="mt-1 font-mono text-xs" /></div></div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-[11px] text-muted-foreground"><p className="flex items-center gap-1 font-semibold text-foreground"><CheckCircle className="size-3.5 text-positive" /> Otonom Slot Güvencesi</p><p className="mt-1 leading-relaxed">Bot bakiye ve kâr arttıkça slot büyüklüğünü otomatik günceller. Kâr eden pozisyon kapandığında slot boşalır ve anında en yüksek skorlu yeni coine tahsis edilir.</p></div>
              <div className="pt-2"><Button variant="outline" size="sm" onClick={handleResetPortfolio} className="w-full text-xs text-muted-foreground hover:text-negative"><RotateCcw className="size-3 mr-1.5" />Portföyü & Bakiyeyi Sıfırla (50.000 ₺)</Button></div>
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
            <CardHeader className="border-b pb-2"><CardTitle className="text-xs font-bold">Tamamlanan İşlem Geçmişi ({botState.history.length})</CardTitle></CardHeader>
            <CardContent className="p-0 max-h-[380px] overflow-y-auto divide-y divide-border/60 text-xs">
              {botState.history.length === 0 ? (<div className="p-8 text-center text-muted-foreground text-xs">Henüz kapanmış işlem yok.</div>) : (
                botState.history.map((h) => {
                  const isProfit = h.pnl >= 0
                  return (<div key={h.id} className="p-2.5 space-y-1"><div className="flex items-center justify-between"><b className="font-mono text-xs">{h.symbol}</b><span className={cn("font-mono font-bold text-xs", isProfit ? "text-positive" : "text-negative")}>{isProfit ? "+" : ""}{fmt(h.pnl)} ₺ ({isProfit ? "+" : ""}%{h.pnlPercent.toFixed(2)})</span></div><div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>Giriş: {fmt(h.entryPrice)} ₺ → Çıkış: {fmt(h.closePrice)} ₺</span><span>{h.closedAt}</span></div><p className="text-[10px] text-muted-foreground italic truncate">{h.closeReason}</p></div>)
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
                <Input value={apiAccountName} onChange={(e) => setApiAccountName(e.target.value)} placeholder="Örn: Furkan Binance TR" className="mt-1 text-xs" required />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground">Bota Tahsis Edilen Gerçek Para (TL ₺)</label>
                <Input type="number" value={realBalanceInput} onChange={(e) => setRealBalanceInput(e.target.value)} placeholder="15000" className="mt-1 font-mono text-xs font-bold text-positive" required />
                <p className="text-[10px] text-muted-foreground mt-1">Bot bu parayı en fazla 3 eşit parçaya böler ({fmt(parseFloat(realBalanceInput || "0") / 3)} ₺ / işlem).</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground">Binance API Key (İsteğe Bağlı)</label>
                <Input value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} placeholder="API Key" className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground">Binance API Secret (İsteğe Bağlı)</label>
                <Input type="password" value={apiSecretInput} onChange={(e) => setApiSecretInput(e.target.value)} placeholder="API Secret" className="mt-1 font-mono text-xs" />
              </div>
              <div className="pt-2 flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowApiModal(false)}>İptal</Button>
                <Button type="submit" size="sm" className="font-bold">Kaydet ve Bağla</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
