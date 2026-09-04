/**
 * app/api/bot/cron/route.ts
 * ═══════════════════════════════════════════════════════
 * Vercel Cron tarafından her 1 dakikada çağrılan sunucu bot motoru.
 * Sekme kapalı olsa bile 7/24 piyasayı tarar, al-sat kararı verir.
 * ═══════════════════════════════════════════════════════
 */
import { NextRequest, NextResponse } from "next/server"
import { analyzeCandles, type Candle } from "@/lib/indicators"
import { WATCHED_CRYPTOS, validateTradeCommission, type Position } from "@/lib/bot/engine"
import {
  getServerPositions, setServerPositions,
  getServerBalance, setServerBalance,
  getServerStrategy,
  getServerActive,
  appendServerLog,
  appendServerHistory,
  getDailyLoss, setDailyLoss,
} from "@/lib/bot/server-state"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30 // Vercel max 30sn

// Güvenlik: Yetkisiz cron çağrısını engelle
function isAuthorized(request: NextRequest): boolean {
  // Vercel'in dahili cron sistemi bu başlığı otomatik ekler
  if (request.headers.get("x-vercel-cron") === "1") return true
  // Manuel test için gizli anahtar
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.BOT_CRON_SECRET
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true
  return false
}

function log(type: "INFO" | "BUY" | "SELL" | "ALERT", msg: string, symbol?: string) {
  console.log(`[BOT CRON] [${type}]${symbol ? " " + symbol : ""} ${msg}`)
  return appendServerLog({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toLocaleTimeString("tr-TR"),
    type,
    symbol,
    message: msg,
  })
}

async function sendEmail(to: string, subject: string, message: string) {
  if (!to || !to.includes("@")) return
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    await fetch(`${baseUrl}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, message }),
    })
  } catch {}
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Yetkisiz istek" }, { status: 401 })
  }

  const startTime = Date.now()

  try {
    // ── 1. Bot durumunu oku ──────────────────────────────────
    const [strategy, isActive, currentBalance, positions] = await Promise.all([
      getServerStrategy(),
      getServerActive(),
      getServerBalance(),
      getServerPositions(),
    ])

    if (!isActive || !strategy.autoPilot) {
      return NextResponse.json({ ok: true, skipped: "Bot pasif veya otopilot kapalı" })
    }

    // ── 2. Günlük zarar limiti kontrolü ─────────────────────
    const today = new Date().toLocaleDateString("tr-TR")
    const dailyLoss = await getDailyLoss()
    if (!dailyLoss.date || dailyLoss.date !== today) {
      await setDailyLoss(currentBalance, today)
    }
    const dailyStartBal = dailyLoss.date === today && dailyLoss.startBalance > 0
      ? dailyLoss.startBalance
      : currentBalance
    const dailyLossPct = dailyStartBal > 0
      ? ((dailyStartBal - currentBalance) / dailyStartBal) * 100
      : 0
    if (dailyLossPct >= (strategy.dailyMaxLossPct ?? 5)) {
      await log("ALERT", `Günlük zarar limiti aşıldı (%${dailyLossPct.toFixed(2)}). Bot bugün için durduruldu.`)
      return NextResponse.json({ ok: true, skipped: "Günlük zarar limiti" })
    }

    // ── 3. USD/TRY kurunu al ─────────────────────────────────
    let usdTryRate = 38.30
    try {
      const fx = await fetch(
        "https://query1.finance.yahoo.com/v8/finance/chart/TRY=X?range=1d&interval=5m",
        { signal: AbortSignal.timeout(5000) }
      )
      if (fx.ok) {
        const d = await fx.json()
        const r = d?.chart?.result?.[0]?.meta?.regularMarketPrice
        if (r && Number.isFinite(r)) usdTryRate = r
      }
    } catch {}

    // ── 4. Tüm coinleri paralel tara ─────────────────────────
    const scanResults: Array<{
      symbol: string; name: string; binancePair: string; badge?: string
      price: number; limitPrice: number; takeProfitPrice: number; stopLossPrice: number
      rsi: number; sma: number; signal: string; confidence: number; change: number
      commissionSafe: boolean; commissionTry: number; commissionRatio: number; expectedProfitTry: number
    }> = []

    await Promise.allSettled(
      WATCHED_CRYPTOS.map(async (crypto) => {
        try {
          const res = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${crypto.yahoo || crypto.symbol + "-USD"}?range=1d&interval=5m`,
            { signal: AbortSignal.timeout(6000) }
          )
          if (!res.ok) return
          const d = await res.json()
          const result = d?.chart?.result?.[0]
          if (!result) return
          const meta = result.meta
          const quote = result.indicators?.quote?.[0]
          const timestamps: number[] = result.timestamp || []
          if (!quote || !timestamps.length) return

          const candles: Candle[] = []
          for (let i = 0; i < timestamps.length; i++) {
            const close = quote.close?.[i]
            if (close != null && Number.isFinite(close)) {
              candles.push({
                date: new Date(timestamps[i] * 1000).toISOString(),
                open: (quote.open?.[i] ?? close) * usdTryRate,
                high: (quote.high?.[i] ?? close) * usdTryRate,
                low: (quote.low?.[i] ?? close) * usdTryRate,
                close: close * usdTryRate,
                volume: quote.volume?.[i] ?? 0,
              })
            }
          }
          if (candles.length < 5) return

          const technical = analyzeCandles(candles)
          const price = (meta.regularMarketPrice ?? candles[candles.length - 1].close / usdTryRate) * usdTryRate
          const prevClose = (meta.chartPreviousClose ?? candles[candles.length - 2]?.close / usdTryRate ?? meta.regularMarketPrice) * usdTryRate
          const change = prevClose ? ((price - prevClose) / prevClose) * 100 : 0
          const rsi = technical.values.rsi ?? 50
          const sma = technical.values.sma20 ?? price
          const limitPrice = price * (1 - (strategy.limitDiscountPct ?? 0.25) / 100)
          const takeProfitPrice = limitPrice * (1 + (strategy.defaultTakeProfitPct ?? 2.5) / 100)
          const stopLossPrice = limitPrice * (1 - (strategy.defaultStopLossPct ?? 2.0) / 100)
          const tradeAmt = strategy.tradeAmountTry ?? 2500
          const commVal = validateTradeCommission(tradeAmt, strategy.defaultTakeProfitPct ?? 2.5, strategy.commissionRatePct ?? 0.1, strategy.maxCommissionProfitRatio ?? 10)

          scanResults.push({
            symbol: crypto.symbol, name: crypto.name, binancePair: crypto.binance, badge: crypto.badge,
            price, limitPrice, takeProfitPrice, stopLossPrice,
            rsi, sma, signal: technical.signal, confidence: technical.confidence, change,
            commissionSafe: commVal.ok,
            commissionTry: commVal.totalFeeTry,
            commissionRatio: commVal.feeRatio,
            expectedProfitTry: commVal.grossProfitTry,
          })
        } catch {}
      })
    )

    // ── 5. BTC Şelale Koruması ───────────────────────────────
    const btcItem = scanResults.find((r) => r.symbol === "BTC")
    const btcChange = btcItem?.change ?? 0
    const isBtcDropping = strategy.btcDropProtectionEnabled && btcChange <= -(strategy.btcDropThresholdPct ?? 2.0)
    if (isBtcDropping) {
      await log("ALERT", `BTC şelale tespit edildi (${btcChange.toFixed(2)}%). Yeni alımlar donduruldu.`)
    }

    // ── 6. Açık pozisyonları kontrol et (TP / SL / Stale) ───
    let updatedPositions = [...positions]
    let updatedBalance = currentBalance
    const closedPositions: Position[] = []

    for (const pos of updatedPositions) {
      const scanItem = scanResults.find((r) => r.symbol === pos.symbol)
      const currentPrice = scanItem?.price ?? pos.currentPrice

      // Fiyat güncelle
      pos.currentPrice = currentPrice
      pos.pnl = (currentPrice - pos.entryPrice) * (pos.totalTry / pos.entryPrice)
      pos.pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100

      // Breakeven kilidi
      if (strategy.breakevenEnabled && pos.pnlPercent >= (strategy.breakevenPct ?? 0.7)) {
        if (!pos.trailingStopPrice || pos.entryPrice > pos.stopLossPrice) {
          pos.stopLossPrice = pos.entryPrice * 1.001
        }
      }

      // Trailing stop güncelle
      if (pos.highestPrice === undefined || currentPrice > pos.highestPrice) {
        pos.highestPrice = currentPrice
        const trailDist = (strategy.trailingStopPct ?? 0.8) / 100
        pos.trailingStopPrice = pos.highestPrice * (1 - trailDist)
        if (pos.trailingStopPrice > pos.stopLossPrice) {
          pos.stopLossPrice = pos.trailingStopPrice
        }
      }

      let closeReason: string | null = null
      let closePrice = currentPrice

      // Take Profit
      if (currentPrice >= pos.takeProfitPrice) {
        closeReason = `🎯 Hedef kâr gerçekleşti: ${currentPrice.toFixed(4)} ₺`
        closePrice = pos.takeProfitPrice
      }
      // Stop Loss
      else if (currentPrice <= pos.stopLossPrice) {
        closeReason = `🛑 Stop-Loss tetiklendi: ${currentPrice.toFixed(4)} ₺`
        closePrice = pos.stopLossPrice
      }
      // Stale Position Timeout
      else if (strategy.stalePositionTimeoutEnabled && pos.openedTimestamp) {
        const hoursOpen = (Date.now() - pos.openedTimestamp) / (1000 * 60 * 60)
        const maxHours = strategy.stalePositionTimeoutHours ?? 4
        if (hoursOpen >= maxHours && Math.abs(pos.pnlPercent) < 0.8) {
          closeReason = `⏳ ${maxHours} saatte hedefe gidilemedi, pozisyon serbest bırakıldı.`
        }
      }

      if (closeReason) {
        const commission = pos.totalTry * (strategy.commissionRatePct ?? 0.1) / 100
        const sellVal = pos.totalTry * (closePrice / pos.entryPrice)
        const netPnl = sellVal - pos.totalTry - commission
        updatedBalance += pos.totalTry + netPnl

        const closedPos: Position = {
          ...pos,
          status: "CLOSED",
          closePrice,
          closeReason,
          closedAt: new Date().toLocaleString("tr-TR"),
          pnl: netPnl,
          pnlPercent: (netPnl / pos.totalTry) * 100,
          netPnlTry: netPnl,
        }
        closedPositions.push(closedPos)
        await appendServerHistory(closedPos)
        await log("SELL", `${pos.symbol}: ${closeReason} | Net PnL: ${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)} ₺`, pos.symbol)

        if (strategy.emailNotificationsEnabled && strategy.userNotificationEmail) {
          const emoji = netPnl >= 0 ? "🟢" : "🔴"
          await sendEmail(
            strategy.userNotificationEmail,
            `${emoji} Bot ${pos.symbol} Pozisyonu Kapattı | ${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)} ₺`,
            `${closeReason}\nGiriş: ${pos.entryPrice.toFixed(4)} ₺ → Çıkış: ${closePrice.toFixed(4)} ₺\nNet Kâr/Zarar: ${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)} ₺ (%${closedPos.pnlPercent.toFixed(2)})`
          )
        }
      }
    }

    // Kapanan pozisyonları listeden çıkar
    updatedPositions = updatedPositions.filter(
      (p) => !closedPositions.find((c) => c.id === p.id)
    )

    // ── 7. Yeni alım sinyallerini işle ──────────────────────
    const openCount = updatedPositions.length
    const maxSlots = strategy.maxConcurrentPositions ?? 3

    if (!isBtcDropping && openCount < maxSlots) {
      // Sinyal skoru hesapla ve sırala
      const candidates = scanResults
        .filter((r) => {
          if (updatedPositions.find((p) => p.symbol === r.symbol)) return false // Zaten açık
          if (!r.commissionSafe) return false
          const isDip = r.rsi <= (strategy.rsiBuyThreshold ?? 34)
          const isMomentum = r.rsi >= 45 && r.rsi <= 65 && r.price > r.sma && r.signal === "AL"
          return isDip || isMomentum
        })
        .map((r) => {
          let score = r.confidence
          if (r.rsi <= 30) score += 20
          else if (r.rsi <= 34) score += 12
          if (r.rsi >= 45 && r.rsi <= 65 && r.price > r.sma) score += 35
          if (r.change > 0 && r.change < 3) score += 10
          return { ...r, score }
        })
        .sort((a, b) => b.score - a.score)

      const slotsAvailable = maxSlots - openCount
      const toOpen = candidates.slice(0, slotsAvailable)

      for (const candidate of toOpen) {
        let tradeAmount = strategy.tradeAmountTry ?? 2500
        if (strategy.autoAllocateCapital) {
          tradeAmount = Math.floor(updatedBalance / maxSlots / 100) * 100
          tradeAmount = Math.max(tradeAmount, 500)
        }
        if (strategy.dynamicSizing) {
          if (candidate.score >= 90) tradeAmount = Math.round(tradeAmount * 1.5)
          else if (candidate.score >= 75) tradeAmount = Math.round(tradeAmount * 1.35)
        }
        if (tradeAmount > updatedBalance) tradeAmount = Math.floor(updatedBalance * 0.95 / 100) * 100
        if (tradeAmount < 500) {
          await log("INFO", `${candidate.symbol}: Yetersiz bakiye, alım atlandı.`, candidate.symbol)
          continue
        }

        updatedBalance -= tradeAmount
        const newPos: Position = {
          id: `pos-srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          symbol: candidate.symbol,
          name: candidate.name,
          side: "BUY",
          entryPrice: candidate.limitPrice,
          currentPrice: candidate.price,
          amount: tradeAmount / candidate.limitPrice,
          totalTry: tradeAmount,
          takeProfitPrice: candidate.takeProfitPrice,
          stopLossPrice: candidate.stopLossPrice,
          pnl: 0,
          pnlPercent: 0,
          openedAt: new Date().toLocaleString("tr-TR"),
          openedTimestamp: Date.now(),
          status: "OPEN",
          triggerType: "INDICATOR",
          orderType: "LIMIT",
          limitPrice: candidate.limitPrice,
        }
        updatedPositions.push(newPos)
        await log("BUY", `${candidate.symbol} @ ${candidate.limitPrice.toFixed(4)} ₺ | ${tradeAmount} ₺ | RSI:${candidate.rsi.toFixed(1)} Skor:${candidate.score}`, candidate.symbol)

        if (strategy.emailNotificationsEnabled && strategy.userNotificationEmail) {
          await sendEmail(
            strategy.userNotificationEmail,
            `🟢 Bot Yeni Pozisyon Açtı: ${candidate.symbol} @ ${candidate.limitPrice.toFixed(4)} ₺`,
            `Sinyal: RSI ${candidate.rsi.toFixed(1)} | Skor: ${candidate.score}\nGiriş: ${candidate.limitPrice.toFixed(4)} ₺ | Hedef: ${candidate.takeProfitPrice.toFixed(4)} ₺ | Stop: ${candidate.stopLossPrice.toFixed(4)} ₺\nTutar: ${tradeAmount} ₺`
          )
        }
      }
    }

    // ── 8. State'i kaydet ────────────────────────────────────
    await Promise.all([
      setServerPositions(updatedPositions),
      setServerBalance(updatedBalance),
    ])

    const duration = Date.now() - startTime
    await log("INFO", `Cron tamamlandı. Açık: ${updatedPositions.length} | Bakiye: ${updatedBalance.toFixed(0)} ₺ | Süre: ${duration}ms`)

    return NextResponse.json({
      ok: true,
      openPositions: updatedPositions.length,
      closedThisCycle: closedPositions.length,
      balance: updatedBalance,
      btcChange,
      isBtcDropping,
      duration,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[BOT CRON] Hata:", msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
