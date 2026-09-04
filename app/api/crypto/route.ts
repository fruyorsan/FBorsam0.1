import { NextRequest, NextResponse } from "next/server"
import { analyzeCandles, horizonAdvice, type Candle } from "@/lib/indicators"
import { getClientIp, checkRateLimit, rateLimitResponse, sanitizeSymbol, sanitizeInterval, sanitizeSearchQuery } from "@/lib/security"
import { cacheGet, cacheSet } from "@/lib/cache"

export const runtime = "nodejs"

// Curated list of popular and meme cryptocurrencies with metadata
export interface CryptoMetadata {
  symbol: string        // e.g. "PEPEUSDT"
  displaySymbol: string // e.g. "PEPE"
  name: string          // e.g. "Pepe"
  category: "meme" | "l1" | "ai" | "defi"
  decimals: number
  badge?: string
}

export const CRYPTO_LIST: CryptoMetadata[] = [
  // 🐸 Hot Meme Coins (Requested by user: PEPE, PENGU, FLOKI...)
  { symbol: "PEPEUSDT", displaySymbol: "PEPE", name: "Pepe", category: "meme", decimals: 8, badge: "MEME 🐸" },
  { symbol: "PENGUUSDT", displaySymbol: "PENGU", name: "Pudgy Penguins", category: "meme", decimals: 6, badge: "MEME 🐧" },
  { symbol: "FLOKIUSDT", displaySymbol: "FLOKI", name: "Floki Inu", category: "meme", decimals: 8, badge: "MEME 🐕" },
  { symbol: "DOGEUSDT", displaySymbol: "DOGE", name: "Dogecoin", category: "meme", decimals: 4, badge: "MEME" },
  { symbol: "SHIBUSDT", displaySymbol: "SHIB", name: "Shiba Inu", category: "meme", decimals: 8, badge: "MEME" },
  { symbol: "BONKUSDT", displaySymbol: "BONK", name: "Bonk", category: "meme", decimals: 8, badge: "MEME" },
  { symbol: "WIFUSDT", displaySymbol: "WIF", name: "dogwifhat", category: "meme", decimals: 4, badge: "MEME" },
  { symbol: "BOMEUSDT", displaySymbol: "BOME", name: "Book of Meme", category: "meme", decimals: 6, badge: "MEME" },

  // 🌐 Major & Layer 1 Coins
  { symbol: "BTCUSDT", displaySymbol: "BTC", name: "Bitcoin", category: "l1", decimals: 2, badge: "KRAL 👑" },
  { symbol: "ETHUSDT", displaySymbol: "ETH", name: "Ethereum", category: "l1", decimals: 2, badge: "L1" },
  { symbol: "SOLUSDT", displaySymbol: "SOL", name: "Solana", category: "l1", decimals: 2, badge: "L1 ⚡" },
  { symbol: "BNBUSDT", displaySymbol: "BNB", name: "BNB", category: "l1", decimals: 2, badge: "L1" },
  { symbol: "XRPUSDT", displaySymbol: "XRP", name: "Ripple", category: "l1", decimals: 4, badge: "L1" },
  { symbol: "SUIUSDT", displaySymbol: "SUI", name: "Sui Network", category: "l1", decimals: 4, badge: "L1" },
  { symbol: "AVAXUSDT", displaySymbol: "AVAX", name: "Avalanche", category: "l1", decimals: 2, badge: "L1" },
  { symbol: "ADAUSDT", displaySymbol: "ADA", name: "Cardano", category: "l1", decimals: 4, badge: "L1" },

  // 🤖 AI & Big Data
  { symbol: "NEARUSDT", displaySymbol: "NEAR", name: "NEAR Protocol", category: "ai", decimals: 3, badge: "AI" },
  { symbol: "RENDERUSDT", displaySymbol: "RENDER", name: "Render Network", category: "ai", decimals: 3, badge: "AI" },
  { symbol: "FETUSDT", displaySymbol: "FET", name: "Artificial Superintelligence", category: "ai", decimals: 4, badge: "AI" },

  // 💎 DeFi & Infrastructure
  { symbol: "LINKUSDT", displaySymbol: "LINK", name: "Chainlink", category: "defi", decimals: 3, badge: "DEFI" },
]

const BINANCE_BASE = "https://api.binance.com/api/v3"

export async function GET(request: NextRequest) {
  // Rate limiting: 60 requests/minute per IP
  const ip = getClientIp(request)
  const rl = checkRateLimit(`crypto:${ip}`, 60, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  const { searchParams } = request.nextUrl
  const symbolParam = sanitizeSymbol(searchParams.get("symbol")) ?? undefined
  const listParam = searchParams.get("list")
  const categoryParam = searchParams.get("category")
  const interval = sanitizeInterval(searchParams.get("interval"))
  const searchParam = sanitizeSearchQuery(searchParams.get("search"))?.toUpperCase() || undefined

  // 1. LIST VIEW: Return all ticker summaries
  if (listParam || (!symbolParam && !searchParam)) {
    try {
      const symbolsToFetch = CRYPTO_LIST.map((c) => c.symbol)
      const res = await fetch(
        `${BINANCE_BASE}/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbolsToFetch))}`,
        { next: { revalidate: 3 } } // Fast 3s cache
      )

      if (!res.ok) {
        throw new Error(`Binance returned ${res.status}`)
      }

      const tickerList: Array<{
        symbol: string
        lastPrice: string
        priceChangePercent: string
        highPrice: string
        lowPrice: string
        volume: string
        quoteVolume: string
      }> = await res.json()

      const tickerMap = new Map(tickerList.map((t) => [t.symbol, t]))

      let results = CRYPTO_LIST.map((meta) => {
        const ticker = tickerMap.get(meta.symbol)
        const priceNum = ticker ? parseFloat(ticker.lastPrice) : 0
        const changeNum = ticker ? parseFloat(ticker.priceChangePercent) : 0
        const quoteVolNum = ticker ? parseFloat(ticker.quoteVolume) : 0

        return {
          ...meta,
          price: priceNum,
          priceFormatted: priceNum.toLocaleString("en-US", {
            minimumFractionDigits: meta.decimals > 4 ? 6 : 2,
            maximumFractionDigits: meta.decimals,
          }),
          change: changeNum,
          isUp: changeNum >= 0,
          high: ticker ? parseFloat(ticker.highPrice) : 0,
          low: ticker ? parseFloat(ticker.lowPrice) : 0,
          volumeUsdt: quoteVolNum,
          volumeFormatted: formatVolume(quoteVolNum),
        }
      })

      if (categoryParam && categoryParam !== "all") {
        results = results.filter((c) => c.category === categoryParam)
      }

      return NextResponse.json({
        data: results,
        timestamp: Date.now(),
        source: "Binance Live",
      })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Kripto verileri alınamadı." },
        { status: 502 }
      )
    }
  }

  // 2. SEARCH VIEW
  if (searchParam) {
    const matched = CRYPTO_LIST.filter(
      (c) =>
        c.symbol.includes(searchParam) ||
        c.displaySymbol.includes(searchParam) ||
        c.name.toUpperCase().includes(searchParam)
    )
    return NextResponse.json({ data: matched })
  }

  // 3. DETAIL VIEW FOR A SPECIFIC CRYPTO
  const selectedMeta =
    CRYPTO_LIST.find((c) => c.symbol === symbolParam || c.displaySymbol === symbolParam) || {
      symbol: symbolParam || "PEPEUSDT",
      displaySymbol: (symbolParam || "PEPEUSDT").replace("USDT", ""),
      name: (symbolParam || "PEPEUSDT").replace("USDT", ""),
      category: "meme" as const,
      decimals: 8,
      badge: "CANLI",
    }

  const cleanSymbol = selectedMeta.symbol

  try {
    const [tickerRes, depthRes, tradesRes, klinesRes] = await Promise.all([
      fetch(`${BINANCE_BASE}/ticker/24hr?symbol=${cleanSymbol}`, { next: { revalidate: 2 } }),
      fetch(`${BINANCE_BASE}/depth?symbol=${cleanSymbol}&limit=12`, { next: { revalidate: 2 } }),
      fetch(`${BINANCE_BASE}/trades?symbol=${cleanSymbol}&limit=20`, { next: { revalidate: 2 } }),
      fetch(`${BINANCE_BASE}/klines?symbol=${cleanSymbol}&interval=${interval}&limit=60`, {
        next: { revalidate: 30 },
      }),
    ])

    if (!tickerRes.ok) throw new Error("Binance ticker alınamadı.")

    const ticker = await tickerRes.json()
    const depth = depthRes.ok ? await depthRes.json() : { bids: [], asks: [] }
    const trades = tradesRes.ok ? await tradesRes.json() : []
    const klinesRaw = klinesRes.ok ? await klinesRes.json() : []

    // Map klines to Candle format
    const candles: Candle[] = (Array.isArray(klinesRaw) ? klinesRaw : []).map((k: (number | string)[]) => {
      const openTime = Number(k[0])
      const dateStr = new Intl.DateTimeFormat("tr-TR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(openTime))

      return {
        date: dateStr,
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
      }
    })

    // Technical Analysis with safe fallback
    let technical = null
    let advice: ReturnType<typeof horizonAdvice> = []
    if (candles.length >= 30) {
      try {
        technical = analyzeCandles(candles)
        advice = horizonAdvice(candles)
      } catch {
        // Safe fallback
      }
    }

    // Process order book depth
    const bids = (depth.bids || []).slice(0, 8).map(([price, qty]: [string, string]) => ({
      price: parseFloat(price),
      qty: parseFloat(qty),
      total: parseFloat(price) * parseFloat(qty),
    }))

    const asks = (depth.asks || []).slice(0, 8).map(([price, qty]: [string, string]) => ({
      price: parseFloat(price),
      qty: parseFloat(qty),
      total: parseFloat(price) * parseFloat(qty),
    }))

    // Process recent trades
    const recentTrades = (Array.isArray(trades) ? trades : []).map(
      (t: { id: number; price: string; qty: string; time: number; isBuyerMaker: boolean }) => ({
        id: t.id,
        price: parseFloat(t.price),
        qty: parseFloat(t.qty),
        time: new Intl.DateTimeFormat("tr-TR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date(t.time)),
        isBuy: !t.isBuyerMaker,
      })
    )

    const currentPrice = parseFloat(ticker.lastPrice)
    const priceChange = parseFloat(ticker.priceChangePercent)

    return NextResponse.json({
      meta: selectedMeta,
      symbol: cleanSymbol,
      price: currentPrice,
      priceFormatted: currentPrice.toLocaleString("en-US", {
        minimumFractionDigits: selectedMeta.decimals > 4 ? 6 : 2,
        maximumFractionDigits: selectedMeta.decimals,
      }),
      change: priceChange,
      isUp: priceChange >= 0,
      high: parseFloat(ticker.highPrice),
      low: parseFloat(ticker.lowPrice),
      volume: parseFloat(ticker.volume),
      volumeUsdt: parseFloat(ticker.quoteVolume),
      tradesCount: Number(ticker.count || 0),
      orderBook: { bids, asks },
      recentTrades,
      candles,
      technical,
      advice,
      source: "Binance Live V3",
      timestamp: Date.now(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kripto detayları alınamadı." },
      { status: 502 }
    )
  }
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(2)}B $`
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M $`
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K $`
  return `${vol.toFixed(0)} $`
}
