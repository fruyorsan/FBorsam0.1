import { NextRequest, NextResponse } from "next/server"
import { WATCHED_CRYPTOS } from "@/lib/bot/engine"
import { cacheGet, cacheSet } from "@/lib/cache"
import { getClientIp, checkRateLimit, rateLimitResponse } from "@/lib/security"
import { getBulkMultiTimeframeAnalysis, type MultiTimeframeAnalysis } from "@/lib/multi-timeframe"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = checkRateLimit(`automation:${ip}`, 60, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  const cacheKey = "bot:crypto_scanner_mtf_v6"
  const cached = cacheGet<{
    items: MultiTimeframeAnalysis[]
    usdTryRate: number
    currency: string
    timestamp: number
    fearGreed?: { value: number; classification: string }
    btcChange: number
    isBtcDropping: boolean
  }>(cacheKey)

  if (cached) {
    return NextResponse.json(cached)
  }

  // Canlı USD/TRY ve Piyasa Duygusu
  let usdTryRate = 38.30
  let fearGreed = { value: 50, classification: "Neutral" }

  await Promise.allSettled([
    (async () => {
      try {
        const bRes = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=USDTTRY", {
          signal: AbortSignal.timeout(2000),
          next: { revalidate: 15 },
        })
        if (bRes.ok) {
          const bData = await bRes.json()
          const p = parseFloat(bData?.price)
          if (p && Number.isFinite(p) && p > 0) {
            usdTryRate = p
            return
          }
        }
      } catch {}

      try {
        const usdTryRes = await fetch(
          "https://query1.finance.yahoo.com/v8/finance/chart/TRY=X?range=1d&interval=5m",
          { signal: AbortSignal.timeout(2500), next: { revalidate: 15 } }
        )
        if (usdTryRes.ok) {
          const data = await usdTryRes.json()
          const rate = data?.chart?.result?.[0]?.meta?.regularMarketPrice
          if (rate && Number.isFinite(rate)) usdTryRate = rate
        }
      } catch {}
    })(),
    (async () => {
      try {
        const fgRes = await fetch("https://api.alternative.me/fng/?limit=1", {
          signal: AbortSignal.timeout(3000),
        })
        if (fgRes.ok) {
          const fgData = await fgRes.json()
          if (fgData?.data?.[0]) {
            fearGreed = {
              value: parseInt(fgData.data[0].value, 10) || 50,
              classification: fgData.data[0].value_classification || "Neutral",
            }
          }
        }
      } catch {}
    })(),
  ])

  // 5 Zaman Dilimi (1m + 5m + 1h + 1w + 1M) & AI Sentezi
  const rawItems = await getBulkMultiTimeframeAnalysis(WATCHED_CRYPTOS)
  const items = rawItems.map((item) => ({
    ...item,
    price: item.currentPrice,
  }))

  const btcItem = items.find((r) => r.symbol === "BTC")
  const btcChange = btcItem?.tf1h?.changePct ?? 0
  const isBtcDropping = btcChange <= -2.5

  const payload = {
    items,
    usdTryRate,
    currency: "TRY",
    timestamp: Date.now(),
    source: "Binance TR Multi-Timeframe & AI Feed",
    fearGreed,
    btcChange,
    isBtcDropping,
  }

  cacheSet(cacheKey, payload, 10)

  return NextResponse.json(payload)
}
