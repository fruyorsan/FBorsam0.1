import { NextRequest, NextResponse } from "next/server"
import { analyzeCandles, type Candle } from "@/lib/indicators"
import { WATCHED_CRYPTOS } from "@/lib/bot/engine"
import { cacheGet, cacheSet } from "@/lib/cache"
import { getClientIp, checkRateLimit, rateLimitResponse } from "@/lib/security"

export const runtime = "nodejs"

interface CryptoAnalysis {
  symbol: string
  name: string
  binancePair: string
  isMeme: boolean
  badge?: string
  price: number
  limitPrice: number
  takeProfitPrice: number
  stopLossPrice: number
  expectedProfitTry: number
  commissionTry: number
  commissionRatio: number
  commissionSafe: boolean
  change: number
  high: number
  low: number
  rsi: number
  sma: number
  signal: string
  confidence: number
  proposal?: {
    side: "BUY" | "SELL"
    orderType: "LIMIT"
    limitPrice: number
    reason: string
    confidence: number
    commissionSafe: boolean
  }
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = checkRateLimit(`automation:${ip}`, 60, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  const cacheKey = "bot:crypto_scanner_try_v3"
  const cached = cacheGet<{ items: CryptoAnalysis[]; usdTryRate: number; currency: string; timestamp: number }>(cacheKey)
  if (cached) {
    return NextResponse.json(cached)
  }

  // 1. Fetch live USD/TRY rate
  let usdTryRate = 48.30
  try {
    const usdTryRes = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/TRY=X?range=1d&interval=5m",
      { next: { revalidate: 15 } }
    )
    if (usdTryRes.ok) {
      const data = await usdTryRes.json()
      const rate = data?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (rate && Number.isFinite(rate)) usdTryRate = rate
    }
  } catch {}

  const results: CryptoAnalysis[] = []

  // 2. Fetch parallel candles and prices for watched cryptos
  await Promise.all(
    WATCHED_CRYPTOS.map(async (crypto) => {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 6000)

        const yahooSymbol = crypto.yahoo || `${crypto.symbol}-USD`
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?range=1d&interval=5m`,
          { next: { revalidate: 8 }, signal: controller.signal }
        ).finally(() => clearTimeout(timeoutId))


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
          const open = quote.open?.[i] ?? close
          const high = quote.high?.[i] ?? close
          const low = quote.low?.[i] ?? close
          const volume = quote.volume?.[i] ?? 0
          if (close !== null && close !== undefined && Number.isFinite(close)) {
            candles.push({
              date: new Date(timestamps[i] * 1000).toISOString(),
              open: Number(open) * usdTryRate,
              high: Number(high) * usdTryRate,
              low: Number(low) * usdTryRate,
              close: Number(close) * usdTryRate,
              volume: Number(volume),
            })
          }
        }

        if (candles.length < 5) return

        const technical = analyzeCandles(candles)
        const rawPriceUsd = meta.regularMarketPrice || candles[candles.length - 1].close / usdTryRate
        const price = rawPriceUsd * usdTryRate
        const prevCloseVal = meta.chartPreviousClose || (candles.length >= 2 ? candles[candles.length - 2].close / usdTryRate : rawPriceUsd)
        const prevClose = prevCloseVal * usdTryRate
        const change = prevClose ? ((price - prevClose) / prevClose) * 100 : 0
        const high = (meta.regularMarketDayHigh || Math.max(...candles.map((c) => c.high / usdTryRate))) * usdTryRate
        const low = (meta.regularMarketDayLow || Math.min(...candles.map((c) => c.low / usdTryRate))) * usdTryRate
        const rsi = technical.values.rsi ?? 50
        // candles zaten TRY cinsinden olduğu için technical.values.sma20 doğrudan TRY cinsindendir!
        const sma = technical.values.sma20 ?? price

        // Limit Order Calculations (%0.25 iskonto ile limit alış)
        const limitPrice = price * (1 - 0.0025)
        const takeProfitPrice = limitPrice * 1.025
        const stopLossPrice = limitPrice * 0.98

        // Commission Gatekeeper Calculation (2500 TL bazında)
        const tradeAmount = 2500
        const buyFee = tradeAmount * 0.001
        const sellVal = tradeAmount * 1.025
        const sellFee = sellVal * 0.001
        const commissionTry = buyFee + sellFee
        const expectedProfitTry = sellVal - tradeAmount
        const commissionRatio = expectedProfitTry > 0 ? (commissionTry / expectedProfitTry) * 100 : 999
        const commissionSafe = commissionRatio <= 10.0 // Komisyon kârın max %10'u olabilir

        let proposal: CryptoAnalysis["proposal"] | undefined

        // Decision logic with Reversal Confirmation
        const isDipping = rsi <= 34
        const isBouncing = candles[candles.length - 1]?.close >= candles[candles.length - 2]?.close

        if (isDipping && commissionSafe) {
          proposal = {
            side: "BUY",
            orderType: "LIMIT",
            limitPrice,
            reason: `Limit Alış: RSI ${rsi.toFixed(1)} dip seviyesinde. Komisyon (${commissionTry.toFixed(2)} ₺) kârın %${commissionRatio.toFixed(1)}'i (Güvenli).`,
            confidence: Math.min(95, Math.round(82 + (34 - rsi) * 1.2)),
            commissionSafe: true,
          }
        } else if (rsi >= 68) {
          proposal = {
            side: "SELL",
            orderType: "LIMIT",
            limitPrice: price * 1.002,
            reason: `Limit Satış: RSI ${rsi.toFixed(1)} aşırı alım bölgesinde. Kâr realizasyonu.`,
            confidence: Math.min(95, Math.round(80 + (rsi - 68) * 1.5)),
            commissionSafe: true,
          }
        } else if (price > sma && isBouncing && commissionSafe) {
          proposal = {
            side: "BUY",
            orderType: "LIMIT",
            limitPrice,
            reason: `Limit Alış: Fiyat HO 20 üzerine kırdı (Dönüş teyidi). Komisyon oranı %${commissionRatio.toFixed(1)} (Uygun).`,
            confidence: 85,
            commissionSafe: true,
          }
        }

        results.push({
          symbol: crypto.symbol,
          name: crypto.name,
          binancePair: crypto.binance,
          isMeme: crypto.badge?.includes("MEME") ?? false,
          badge: crypto.badge,
          price,
          limitPrice,
          takeProfitPrice,
          stopLossPrice,
          expectedProfitTry,
          commissionTry,
          commissionRatio,
          commissionSafe,
          change,
          high,
          low,
          rsi,
          sma,
          signal: technical.signal,
          confidence: technical.confidence,
          proposal,
        })
      } catch (err) {}
    })
  )

  const btcItem = results.find((r) => r.symbol === "BTC")
  const btcChange = btcItem ? btcItem.change : 0
  const isBtcDropping = btcChange <= -2.0 // BTC şelale tespiti

  const payload = {
    items: results,
    usdTryRate,
    currency: "TRY",
    timestamp: Date.now(),
    source: "Binance TR Crypto Feed",
    btcChange,
    isBtcDropping,
  }


  cacheSet(cacheKey, payload, 8)

  return NextResponse.json(payload)
}
