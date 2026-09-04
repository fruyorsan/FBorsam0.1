import { NextRequest } from "next/server"
import { analyzeCandles, horizonAdvice, type Candle } from "@/lib/indicators"
import { bistStocks } from "@/lib/bist-stocks"
import { getClientIp, checkRateLimit, rateLimitResponse, sanitizeSymbol, sanitizeInterval, sanitizeSearchQuery } from "@/lib/security"
import { cacheGet, cacheSet } from "@/lib/cache"

type Asset = { yahoo?: string; name: string; market: "BIST" | "ABD" | "MAKRO" | "Kripto"; binance?: string }

// Curated Cryptocurrencies with Binance Pairs
export const cryptoAssets: Record<string, { binance: string; name: string }> = {
  PEPE: { binance: "PEPEUSDT", name: "Pepe" },
  PENGU: { binance: "PENGUUSDT", name: "Pudgy Penguins" },
  FLOKI: { binance: "FLOKIUSDT", name: "Floki Inu" },
  DOGE: { binance: "DOGEUSDT", name: "Dogecoin" },
  SHIB: { binance: "SHIBUSDT", name: "Shiba Inu" },
  BONK: { binance: "BONKUSDT", name: "Bonk" },
  WIF: { binance: "WIFUSDT", name: "dogwifhat" },
  BOME: { binance: "BOMEUSDT", name: "Book of Meme" },
  BTC: { binance: "BTCUSDT", name: "Bitcoin" },
  ETH: { binance: "ETHUSDT", name: "Ethereum" },
  SOL: { binance: "SOLUSDT", name: "Solana" },
  BNB: { binance: "BNBUSDT", name: "BNB" },
  XRP: { binance: "XRPUSDT", name: "Ripple" },
  SUI: { binance: "SUIUSDT", name: "Sui Network" },
  AVAX: { binance: "AVAXUSDT", name: "Avalanche" },
  ADA: { binance: "ADAUSDT", name: "Cardano" },
  NEAR: { binance: "NEARUSDT", name: "NEAR Protocol" },
  RENDER: { binance: "RENDERUSDT", name: "Render" },
  FET: { binance: "FETUSDT", name: "Artificial Superintelligence" },
  LINK: { binance: "LINKUSDT", name: "Chainlink" },
}

const assets: Record<string, Asset> = {
  AAPL:{yahoo:"AAPL",name:"Apple",market:"ABD"},MSFT:{yahoo:"MSFT",name:"Microsoft",market:"ABD"},NVDA:{yahoo:"NVDA",name:"NVIDIA",market:"ABD"},GOOGL:{yahoo:"GOOGL",name:"Alphabet",market:"ABD"},AMZN:{yahoo:"AMZN",name:"Amazon",market:"ABD"},META:{yahoo:"META",name:"Meta",market:"ABD"},TSLA:{yahoo:"TSLA",name:"Tesla",market:"ABD"},
  XU100:{yahoo:"XU100.IS",name:"BIST 100",market:"MAKRO"},XU030:{yahoo:"XU030.IS",name:"BIST 30",market:"MAKRO"},SP500:{yahoo:"^GSPC",name:"S&P 500",market:"MAKRO"},NASDAQ:{yahoo:"^IXIC",name:"Nasdaq",market:"MAKRO"},DJI:{yahoo:"^DJI",name:"Dow Jones",market:"MAKRO"},USDTRY:{yahoo:"TRY=X",name:"Dolar / TL",market:"MAKRO"},EURTRY:{yahoo:"EURTRY=X",name:"Euro / TL",market:"MAKRO"},XAUUSD:{yahoo:"GC=F",name:"Ons Altın",market:"MAKRO"},BRENT:{yahoo:"BZ=F",name:"Brent Petrol",market:"MAKRO"},
}

// Merge BIST universe
for (const [ticker, name] of Object.entries(bistStocks)) {
  assets[ticker] = { yahoo: `${ticker}.IS`, name, market: "BIST" }
}

// Merge Crypto universe into catalog
for (const [sym, c] of Object.entries(cryptoAssets)) {
  assets[sym] = { binance: c.binance, name: c.name, market: "Kripto" }
}

const headers = { "User-Agent": "Mozilla/5.0 PiyasaIQ/1.0" }

let session: { cookie: string; crumb: string; expires: number } | null = null
async function getSession() {
  if (session && session.expires > Date.now()) return session
  try {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 8000)
    try {
      const cookieRes = await fetch("https://fc.yahoo.com", { headers, signal: c.signal })
      const raw = cookieRes.headers.get("set-cookie")
      if (!raw) return null
      const cookie = raw.split(";")[0]
      const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { ...headers, cookie }, signal: c.signal })
      if (!crumbRes.ok) return null
      const crumb = (await crumbRes.text()).trim()
      if (!crumb || crumb.includes("<")) return null
      session = { cookie, crumb, expires: Date.now() + 50 * 60 * 1000 }
      return session
    } finally {
      clearTimeout(t)
    }
  } catch {
    return null
  }
}

async function fetchBinanceCrypto(symbol: string, interval = "1d") {
  const c = cryptoAssets[symbol]
  if (!c) throw new Error("Desteklenmeyen kripto sembolü")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  const valid = ["1m", "5m", "15m", "1h", "1d"]
  const bInterval = valid.includes(interval) ? interval : "1d"
  const isIntra = ["1m", "5m", "15m"].includes(bInterval)
  const isHourly = bInterval === "1h"

  try {
    const [tickerRes, klinesRes] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${c.binance}`, {
        headers,
        signal: controller.signal,
        next: { revalidate: 3 },
      }),
      fetch(`https://api.binance.com/api/v3/klines?symbol=${c.binance}&interval=${bInterval}&limit=70`, {
        headers,
        signal: controller.signal,
        next: { revalidate: isIntra ? 3 : 30 },
      }),
    ])
    if (!tickerRes.ok || !kllinesResOk(klinesRes)) throw new Error("Binance canlı veri alınamadı")
    const ticker = await tickerRes.json()
    const klines = await klinesRes.json()
    const candles: Candle[] = (Array.isArray(klines) ? klines : []).map((k: any[]) => {
      const d = new Date(Number(k[0]))
      let dateStr: string
      if (isIntra) {
        dateStr = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(d)
      } else if (isHourly) {
        dateStr = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d)
      } else {
        dateStr = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(d)
      }
      return {
        date: dateStr,
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }
    }).filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite))

    if (candles.length < 10) throw new Error("Yetersiz kripto geçmişi")
    const technical = analyzeCandles(candles)
    const price = parseFloat(ticker.lastPrice)
    const change = parseFloat(ticker.priceChangePercent)

    return {
      symbol,
      name: c.name,
      market: "Kripto" as const,
      currency: "USD",
      updatedAt: new Date().toISOString(),
      price,
      change,
      technical,
      advice: horizonAdvice(candles),
      news: [],
      analyst: null,
      source: "Binance Canlı",
      delayed: false,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function kllinesResOk(res: Response) {
  return res.ok
}

async function fetchChart(symbol: string, intervalOrRange = "1d", explicitInterval?: string) {
  const item = assets[symbol]
  if (!item || !item.yahoo) throw new Error("Desteklenmeyen sembol")

  let range = "1y"
  let yInterval = "1d"

  if (explicitInterval) {
    range = intervalOrRange
    yInterval = explicitInterval
  } else {
    const interval = intervalOrRange
    if (interval === "1m") {
      range = "1d"
      yInterval = "1m"
    } else if (interval === "5m") {
      range = "5d"
      yInterval = "5m"
    } else if (interval === "15m") {
      range = "5d"
      yInterval = "15m"
    } else if (interval === "1h") {
      range = "1mo"
      yInterval = "1h"
    } else {
      range = "1y"
      yInterval = "1d"
    }
  }

  const isIntra = ["1m", "5m", "15m"].includes(yInterval)
  const isHourly = yInterval === "1h"

  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.yahoo)}?range=${range}&interval=${yInterval}&events=div%2Csplits`, { signal: controller.signal, headers, next: { revalidate: isIntra ? 5 : 300 } })
    if (!response.ok) throw new Error(`Yahoo ${response.status}`)
    const payload = await response.json()
    const result = payload?.chart?.result?.[0], quote = result?.indicators?.quote?.[0]
    if (!result?.timestamp || !quote) throw new Error("Eksik piyasa yanıtı")
    const candles: Candle[] = result.timestamp.flatMap((t: number, i: number) => {
      const open = quote.open?.[i], high = quote.high?.[i], low = quote.low?.[i], close = quote.close?.[i], volume = quote.volume?.[i] ?? 0
      if (![open, high, low, close].every(Number.isFinite)) return []
      const d = new Date(t * 1000)
      let dateStr: string
      if (isIntra) {
        dateStr = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(d)
      } else if (isHourly) {
        dateStr = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d)
      } else {
        dateStr = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(d)
      }
      return [{ date: dateStr, open, high, low, close, volume }]
    })
    return { item, meta: result.meta, candles }
  } finally {
    clearTimeout(timeout)
  }
}

async function analystData(item: Asset) {
  if (item.market === "MAKRO" || item.market === "Kripto" || !item.yahoo) return null
  try {
    const s = await getSession()
    if (!s) return null
    const r = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(item.yahoo)}?modules=financialData,recommendationTrend&crumb=${encodeURIComponent(s.crumb)}`, { headers: { ...headers, cookie: s.cookie }, next: { revalidate: 3600 } })
    if (!r.ok) return null
    const root = (await r.json())?.quoteSummary?.result?.[0]
    const f = root?.financialData
    const trend = root?.recommendationTrend?.trend?.find((t: { period?: string }) => t.period === "0m") ?? root?.recommendationTrend?.trend?.[0]
    const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0
    let distribution = null
    if (trend) {
      const strongBuy = num(trend.strongBuy), buy = num(trend.buy), hold = num(trend.hold), sell = num(trend.sell), strongSell = num(trend.strongSell)
      const total = strongBuy + buy + hold + sell + strongSell
      if (total > 0) distribution = { buy: strongBuy + buy, hold, sell: sell + strongSell, total }
    }
    if (!f && !distribution) return null
    return { rating: f?.recommendationKey ?? null, score: f?.recommendationMean?.raw ?? null, targetLow: f?.targetLowPrice?.raw ?? null, targetMean: f?.targetMeanPrice?.raw ?? null, targetHigh: f?.targetHighPrice?.raw ?? null, analystCount: f?.numberOfAnalystOpinions?.raw ?? distribution?.total ?? null, distribution }
  } catch {
    return null
  }
}

async function fetchNews(query: string, count = 6) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=${count}`, { headers, next: { revalidate: 300 } })
    if (!r.ok) return []
    const p = await r.json()
    return (p.news ?? []).slice(0, count).map((a: { title?: string; publisher?: string; providerPublishTime?: number; link?: string }) => ({
      title: a.title ?? "Başlık bulunamadı",
      source: a.publisher ?? "Yahoo Finance",
      url: a.link,
      publishedAt: a.providerPublishTime ? new Date(a.providerPublishTime * 1000).toISOString() : null,
    }))
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  // Rate limiting: 60 requests/minute per IP
  const ip = getClientIp(request)
  const rl = checkRateLimit(`market:${ip}`, 60, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  const rawSymbol = request.nextUrl.searchParams.get("symbol") ?? "TUPRS"
  const rawInterval = request.nextUrl.searchParams.get("interval")
  const symbol = sanitizeSymbol(rawSymbol) ?? "TUPRS"
  const interval = sanitizeInterval(rawInterval)

  // Cache TTL per interval
  const cacheTtl = interval === "1m" ? 8 : interval === "5m" ? 20 : interval === "15m" ? 45 : interval === "1h" ? 120 : 60

  // 1. Binance crypto
  if (cryptoAssets[symbol]) {
    const cacheKey = `crypto:${symbol}:${interval}`
    const cached = cacheGet<object>(cacheKey)
    if (cached) return Response.json(cached)
    try {
      const result = await fetchBinanceCrypto(symbol, interval)
      cacheSet(cacheKey, result, cacheTtl)
      return Response.json(result)
    } catch (error) {
      return Response.json(
        { error: "Kripto verisi alınamadı.", symbol, source: "Binance" },
        { status: 502 }
      )
    }
  }

  // 2. Catalog listing
  if (request.nextUrl.searchParams.get("catalog") === "1") {
    const cacheKey = "catalog:all"
    const cached = cacheGet<object>(cacheKey)
    if (cached) return Response.json(cached)
    const result = {
      assets: Object.entries(assets)
        .filter(([, a]) => a.market !== "MAKRO")
        .map(([sym, a]) => ({ symbol: sym, name: a.name, market: a.market })),
    }
    cacheSet(cacheKey, result, 300)
    return Response.json(result)
  }

  // 3. Crypto search
  const rawSearch = request.nextUrl.searchParams.get("cryptoSearch")
  if (rawSearch !== null) {
    const q = sanitizeSearchQuery(rawSearch)
    if (!q || q.length < 2) return Response.json({ results: [] })
    const cacheKey = `crypto-search:${q.toLowerCase()}`
    const cached = cacheGet<object>(cacheKey)
    if (cached) return Response.json(cached)
    try {
      const r = await fetch(
        `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`,
        { next: { revalidate: 120 } }
      )
      if (!r.ok) return Response.json({ results: [] })
      const p = await r.json()
      const results = (p.coins ?? []).slice(0, 20).map((c: { id: string; symbol: string; name: string; market_cap_rank?: number | null; large?: string | null; thumb?: string | null }) => ({
        id: c.id,
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        rank: c.market_cap_rank ?? null,
        image: c.large ?? c.thumb ?? null,
        market: "Kripto",
      }))
      const out = { results }
      cacheSet(cacheKey, out, 120)
      return Response.json(out)
    } catch {
      return Response.json({ results: [] })
    }
  }

  // 4. News
  if (request.nextUrl.searchParams.get("news") === "1") {
    const cacheKey = "news:global"
    const cached = cacheGet<object>(cacheKey)
    if (cached) return Response.json(cached)
    const groups = await Promise.all([
      fetchNews("Borsa Istanbul Turkey economy", 6),
      fetchNews("S&P 500 Nasdaq Federal Reserve markets", 6),
      fetchNews("gold oil markets", 4),
    ])
    const seen = new Set<string>()
    const news = groups.flat().filter(item => {
      const key = item.url ?? item.title
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")).slice(0, 12)
    const out = { news, source: "Yahoo Finance", topics: ["BIST", "ABD", "Emtia"] }
    cacheSet(cacheKey, out, 180)
    return Response.json(out)
  }

  // 5. Equity / Index chart via Yahoo
  const cacheKey = `equity:${symbol}:${interval}`
  const cached = cacheGet<object>(cacheKey)
  if (cached) return Response.json(cached)
  try {
    const { item, meta, candles } = await fetchChart(symbol, interval)
    const technical = analyzeCandles(candles)
    const previous = candles.at(-2)?.close || meta.chartPreviousClose || technical.price
    const result = {
      symbol,
      name: item.name,
      market: item.market,
      currency: meta.currency ?? "TRY",
      updatedAt: new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
      price: technical.price,
      change: previous ? ((technical.price - previous) / previous) * 100 : 0,
      technical,
      advice: horizonAdvice(candles),
      news: item.yahoo ? await fetchNews(item.yahoo) : [],
      analyst: await analystData(item),
      source: "Yahoo Finance",
      delayed: true,
    }
    cacheSet(cacheKey, result, cacheTtl)
    return Response.json(result)
  } catch {
    return Response.json(
      { error: "Piyasa verisi alınamadı", symbol, source: "Yahoo Finance" },
      { status: 502 }
    )
  }
}

export async function POST(request: Request) {
  // Rate limiting: 30 requests/minute per IP
  const ip = getClientIp(request)
  const rl = checkRateLimit(`market-post:${ip}`, 30, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  const body = await request.json().catch(() => ({}))
  const requested = Array.isArray(body.symbols) ? body.symbols.slice(0, 20) : []
  const data = await Promise.all(
    requested.map(async (s: string) => {
      const symbol = sanitizeSymbol(String(s)) ?? ""
      if (!symbol) return { symbol: String(s), name: String(s), ok: false }

      const cacheKey = `ticker:${symbol}`
      const cached = cacheGet<object>(cacheKey)
      if (cached) return cached

      if (cryptoAssets[symbol]) {
        try {
          const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${cryptoAssets[symbol].binance}`, { next: { revalidate: 5 } })
          if (res.ok) {
            const t = await res.json()
            const out = {
              symbol,
              name: cryptoAssets[symbol].name,
              price: parseFloat(t.lastPrice),
              change: parseFloat(t.priceChangePercent),
              ok: true,
            }
            cacheSet(cacheKey, out, 8)
            return out
          }
        } catch {}
      }
      try {
        const { item, meta, candles } = await fetchChart(symbol, "5d", "1d")
        const price = candles.at(-1)?.close ?? meta.regularMarketPrice
        const previous = candles.at(-2)?.close || meta.chartPreviousClose || price
        const out = { symbol, name: item.name, price, change: previous ? ((price - previous) / previous) * 100 : 0, ok: true }
        cacheSet(cacheKey, out, 30)
        return out
      } catch {
        return { symbol, name: assets[symbol]?.name ?? symbol, ok: false }
      }
    })
  )
  return Response.json({ data, source: "BysFurkan Live", delayed: true })
}

