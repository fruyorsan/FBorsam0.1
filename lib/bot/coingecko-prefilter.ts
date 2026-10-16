/**
 * lib/bot/coingecko-prefilter.ts
 * CoinGecko MCP / REST API ile çalışan ön filtreleme ve puanlama modülü.
 *
 * Kurallar:
 * 1. İlk 100 coini piyasa değerine göre çek.
 * 2. Sert filtreler:
 *    - min piyasa değeri $500M
 *    - min 24s hacim $20M
 *    - stablecoin / RWA / altın tokenlarını ele
 *    - wrapped ve staked tokenları ele (WBTC, stETH, wstETH, weETH, cbBTC vb.)
 *    - 24s hacmi 7 günlük ortalamasının 3 katını aşanları ele
 *    - 7 günde %80'den fazla yükselenleri "aşırı ısınmış" diye ele
 *    - Yaşı genesis_date veya ilk fiyat geçmişinden hesapla (atl_date KULLANILMAZ). Yaş bilinmiyorsa eleme ("yaş bilinmiyor").
 * 3. Kalanları 0-100 puanla:
 *    - Likidite (hacim/piyasa değeri) %25
 *    - 7g momentum %25
 *    - 30g momentum %20
 *    - Volatilite %15
 *    - ATH uzaklığı %15
 * 4. Sadece borsada (Binance Futures) işlem gören coinlerle eşleştir.
 * 5. TTL: 6 saat. Liste boşsa veya 6 saatten eskiyse bot yeni pozisyon açmaz.
 */
import { getCachedCoinAge, setCachedCoinAge } from "./server-state"

export interface FilteredCandidate {
  id: string
  symbol: string
  name: string
  binanceSymbol: string // örn. BTCUSDT
  score: number
  marketCap: number
  totalVolume: number
  liquidityRatio: number
  mom7d: number
  mom30d: number
  volatility7d: number
  athDistance: number
  volumeSpikeRatio: number
  ageDescription: string
}

export interface CoinGeckoPrefilterState {
  updatedAt: number
  candidates: FilteredCandidate[]
  eliminated: Array<{ symbol: string; name: string; reason: string }>
}

const MEM_KEY = "bot:coingecko_prefilter"
const MAX_STALE_MS = 6 * 60 * 60 * 1000 // 6 saat

// Bilinen stablecoin, RWA ve sentetik varlıklar
const KNOWN_STABLES_AND_RWA = new Set([
  "tether", "usd-coin", "usds", "ethena-usde", "dai", "usd1-wlfi", "global-dollar",
  "paypal-usd", "ripple-usd", "hashnote-usyc", "ondo-us-dollar-yield",
  "blackrock-usd-institutional-digital-liquidity-fund", "falcon-finance", "usdd",
  "spiko-amundi-overnight-swap-fund-eur", "united-stables", "bfusd", "usdgo",
  "superstate-short-duration-us-government-securities-fund-ustb", "open-usd", "stable-2",
  "gho", "tether-gold", "pax-gold", "figure-heloc"
])

const STABLE_SYMBOLS = new Set([
  "usdt", "usdc", "usds", "usde", "dai", "usd1", "usdg", "pyusd", "rlusd", "usyc",
  "usdy", "buidl", "usdf", "usdd", "eursaf0", "u", "bfusd", "usdgo", "ustb", "ousd",
  "stable", "gho", "xaut", "paxg", "figr_heloc"
])

const WRAPPED_AND_STAKED_SYMBOLS = new Set([
  "wbtc", "weth", "wsteth", "steth", "weeth", "cbbtc", "wsol", "wbnb", "wmatic", "wavax"
])

export function isWrappedOrStaked(coin: { id: string; symbol: string; name: string }): boolean {
  const sym = coin.symbol.toLowerCase()
  const id = coin.id.toLowerCase()
  const name = coin.name.toLowerCase()
  if (WRAPPED_AND_STAKED_SYMBOLS.has(sym)) return true
  if (id.includes("wrapped") || id.includes("staked") || id.includes("lido-staked")) return true
  if (name.includes("wrapped") || name.includes("staked") || name.includes("lido")) return true
  if (sym.startsWith("w") && ["wbtc", "weth", "wsteth", "weeth"].includes(sym)) return true
  return false
}

export function isStableOrRwa(coin: { id: string; symbol: string; name: string }): boolean {
  const sym = coin.symbol.toLowerCase()
  const id = coin.id.toLowerCase()
  const name = coin.name.toLowerCase()
  if (KNOWN_STABLES_AND_RWA.has(id) || STABLE_SYMBOLS.has(sym)) return true
  if (sym.startsWith("usd") || id.includes("usd") || name.includes("usd") || name.includes("dollar") || name.includes("fund") || name.includes("gold")) {
    return true
  }
  return false
}

export function calculateCoinScore(item: {
  normLiq: number
  normMom7d: number
  normMom30d: number
  normVol: number
  normAth: number
}): number {
  const score = (
    item.normLiq * 25 +
    item.normMom7d * 25 +
    item.normMom30d * 20 +
    item.normVol * 15 +
    item.normAth * 15
  )
  return Math.round(score * 10) / 10
}

function normalize(arr: number[]): number[] {
  const min = Math.min(...arr)
  const max = Math.max(...arr)
  if (max === min) return arr.map(() => 0.5)
  return arr.map(v => (v - min) / (max - min))
}

/**
 * Filtreleme ve puanlama motoru (bağımsız ve saf fonksiyon olarak test edilebilir)
 */
export function filterAndScoreCoins(params: {
  rawTop100: any[]
  volumeHistories: Record<string, number[][] | null>
  inceptionHistories: Record<string, { firstTimestamp?: number; firstDate?: string } | null>
  availableExchangePairs: Set<string>
  nowTs?: number
}): { candidates: FilteredCandidate[]; eliminated: Array<{ symbol: string; name: string; reason: string }> } {
  const now = params.nowTs || Date.now()
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

  const eliminated: Array<{ symbol: string; name: string; reason: string }> = []
  const validList: Array<{
    coin: any
    binanceSymbol: string
    liquidity: number
    mom7d: number
    mom30d: number
    volatility7d: number
    athDistance: number
    spikeRatio: number
    ageDescription: string
  }> = []

  for (const c of params.rawTop100) {
    const symUpper = c.symbol.toUpperCase()
    const pairCandidate = `${symUpper}USDT`

    // 1. Wrapped / Staked kontrolü
    if (isWrappedOrStaked(c)) {
      eliminated.push({ symbol: symUpper, name: c.name, reason: "Wrapped veya Staked token" })
      continue
    }

    // 2. Stablecoin / RWA kontrolü
    if (isStableOrRwa(c)) {
      eliminated.push({ symbol: symUpper, name: c.name, reason: "Stablecoin veya RWA / Fon / Emtia tokenı" })
      continue
    }

    // 3. Minimum Piyasa Değeri ($500M)
    if ((c.market_cap || 0) < 500_000_000) {
      eliminated.push({ symbol: symUpper, name: c.name, reason: `Piyasa değeri yetersiz ($${((c.market_cap || 0) / 1e6).toFixed(1)}M < $500M)` })
      continue
    }

    // 4. Minimum 24s Hacim ($20M)
    if ((c.total_volume || 0) < 20_000_000) {
      eliminated.push({ symbol: symUpper, name: c.name, reason: `24s hacim yetersiz ($${((c.total_volume || 0) / 1e6).toFixed(1)}M < $20M)` })
      continue
    }

    // 5. Yaş Kontrolü (genesis_date veya ilk fiyat tarihi) - atl_date KULLANILMAZ
    const hist = params.inceptionHistories[c.id]
    let ageDays: number | null = null
    let ageDesc = "Yaş Bilinmiyor"
    if (c.genesis_date) {
      const gTs = new Date(c.genesis_date).getTime()
      if (!isNaN(gTs)) {
        ageDays = Math.floor((now - gTs) / (24 * 60 * 60 * 1000))
        ageDesc = `${ageDays} gün (Genesis)`
      }
    } else if (hist?.firstTimestamp) {
      ageDays = Math.floor((now - hist.firstTimestamp) / (24 * 60 * 60 * 1000))
      ageDesc = `${ageDays} gün (İlk Fiyat: ${hist.firstDate ? hist.firstDate.split("T")[0] : ""})`
    }

    if (ageDays !== null && ageDays < 90) {
      eliminated.push({ symbol: symUpper, name: c.name, reason: `Listelenme süresi 90 günden az (${ageDays} gün)` })
      continue
    }

    // 6. Hacim Patlaması Kontrolü (24s hacim 7 günlük ortalamanın 3 katını aşıyor mu?)
    const volHistory = params.volumeHistories[c.id]
    let avg7dVol = c.total_volume || 1
    let spikeRatio = 1.0
    if (Array.isArray(volHistory) && volHistory.length >= 2) {
      const vols = volHistory.map(v => v[1])
      avg7dVol = vols.reduce((s, v) => s + v, 0) / vols.length
      spikeRatio = (c.total_volume || 0) / avg7dVol
    }

    if (spikeRatio > 3.0) {
      eliminated.push({ symbol: symUpper, name: c.name, reason: `24s hacim 7 günlük ortalamanın 3 katından fazla (${spikeRatio.toFixed(2)}x > 3.0x)` })
      continue
    }

    // 7. Aşırı Isınmış Kontrolü (7 günde %80'den fazla yükselen)
    const mom7d = c.price_change_percentage_7d_in_currency ?? 0
    if (mom7d > 80) {
      eliminated.push({ symbol: symUpper, name: c.name, reason: `Son 7 günde aşırı ısınmış (+%${mom7d.toFixed(1)} > +%80)` })
      continue
    }

    // 8. Borsa Eşleşme Kontrolü (Binance Futures tahtasında işlem görüyor mu?)
    if (params.availableExchangePairs.size > 0 && !params.availableExchangePairs.has(pairCandidate) && !params.availableExchangePairs.has(`1000${pairCandidate}`)) {
      eliminated.push({ symbol: symUpper, name: c.name, reason: `Binance Futures tahtasında işlem görmüyor (${pairCandidate})` })
      continue
    }

    // Hesaplanacak metrikler
    const liquidity = (c.total_volume || 0) / (c.market_cap || 1)
    const mom30d = c.price_change_percentage_30d_in_currency ?? 0

    // Volatilite (7 günlük sparkline)
    const prices: number[] = c.sparkline_in_7d?.price || []
    let volatility7d = 0
    if (prices.length > 1) {
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length
      const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length
      volatility7d = (Math.sqrt(variance) / mean) * 100
    }

    const athDistance = c.ath_change_percentage ?? -100

    validList.push({
      coin: c,
      binanceSymbol: params.availableExchangePairs.has(`1000${pairCandidate}`) ? `1000${pairCandidate}` : pairCandidate,
      liquidity,
      mom7d,
      mom30d,
      volatility7d,
      athDistance,
      spikeRatio,
      ageDescription: ageDesc,
    })
  }

  if (validList.length === 0) {
    return { candidates: [], eliminated }
  }

  // Normalizasyon ve puanlama
  const normLiq = normalize(validList.map(v => v.liquidity))
  const normMom7d = normalize(validList.map(v => v.mom7d))
  const normMom30d = normalize(validList.map(v => v.mom30d))
  const normVol = normalize(validList.map(v => v.volatility7d))
  const normAth = normalize(validList.map(v => v.athDistance))

  const scored: FilteredCandidate[] = validList.map((item, i) => {
    const score = calculateCoinScore({
      normLiq: normLiq[i],
      normMom7d: normMom7d[i],
      normMom30d: normMom30d[i],
      normVol: normVol[i],
      normAth: normAth[i],
    })

    return {
      id: item.coin.id,
      symbol: item.coin.symbol.toUpperCase(),
      name: item.coin.name,
      binanceSymbol: item.binanceSymbol,
      score,
      marketCap: item.coin.market_cap,
      totalVolume: item.coin.total_volume,
      liquidityRatio: item.liquidity,
      mom7d: item.mom7d,
      mom30d: item.mom30d,
      volatility7d: item.volatility7d,
      athDistance: item.athDistance,
      volumeSpikeRatio: item.spikeRatio,
      ageDescription: item.ageDescription,
    }
  })

  scored.sort((a, b) => b.score - a.score)
  return { candidates: scored.slice(0, 20), eliminated }
}

/**
 * CoinGecko REST API Yapılandırması (COINGECKO_API_KEY ortam değişkenini destekler)
 */
function getCoinGeckoConfig() {
  const apiKey = (process.env.COINGECKO_API_KEY || "").trim()
  const isDemo = apiKey.startsWith("CG-")
  const baseUrl = isDemo || !apiKey
    ? "https://api.coingecko.com/api/v3"
    : "https://pro-api.coingecko.com/api/v3"

  const headers: Record<string, string> = {
    Accept: "application/json",
  }
  if (apiKey) {
    if (isDemo) {
      headers["x-cg-demo-api-key"] = apiKey
    } else {
      headers["x-cg-pro-api-key"] = apiKey
    }
  }
  return { baseUrl, headers }
}

// CoinGecko API geçici olarak kapalı veya hız sınırındayken devreye girecek güvenilir Binance Futures listesi
export const FALLBACK_TOP_PAIRS = [
  "SOLUSDT", "XRPUSDT", "DOGEUSDT", "SUIUSDT", "HYPEUSDT", "NEARUSDT",
  "AVAXUSDT", "LINKUSDT", "ENAUSDT", "INJUSDT", "APTUSDT", "ARBUSDT",
  "TAOUSDT", "WLDUSDT", "AAVEUSDT", "UNIUSDT", "1000PEPEUSDT", "RENDERUSDT",
  "FETUSDT", "TIAUSDT", "SEIUSDT", "OPUSDT", "ADAUSDT", "BNBUSDT"
]

/**
 * 429 Hız Sınırı (Rate Limit) ve Hata Durumlarında Hızlı Yeniden Deneme (Timeout Korumalı)
 */
async function fetchCoinGeckoWithRetry(url: string, headers: Record<string, string>, retries = 2): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      })
      if (res.status === 401 || res.status === 403) {
        throw new Error(`CoinGecko HTTP ${res.status}: Yetkisiz veya geçersiz API Key`)
      }
      if (res.status === 429) {
        if (attempt === retries) throw new Error("CoinGecko 429 Hız Sınırı")
        const delayMs = Math.min(attempt * 1000, 2000)
        console.warn(`[CoinGecko REST API] 429 Hız Sınırı! ${delayMs}ms bekleniyor...`)
        await new Promise(r => setTimeout(r, delayMs))
        continue
      }
      if (!res.ok) {
        throw new Error(`CoinGecko HTTP ${res.status}: ${res.statusText}`)
      }
      return await res.json()
    } catch (err: any) {
      if (attempt === retries) throw err
      const backoffMs = attempt * 1000
      await new Promise(r => setTimeout(r, backoffMs))
    }
  }
  throw new Error(`CoinGecko isteği başarısız oldu: ${url}`)
}

/**
 * CoinGecko REST API üzerinden ilk 100 coini çeker, Redis'te yaş önbelleğini kullanır,
 * sert filtreleri ve puanlamayı uygulayarak onaylı listeyi döner.
 */
export async function refreshCoinGeckoPrefilter(options: {
  exchangePairs?: Set<string>
}): Promise<CoinGeckoPrefilterState> {
  const { baseUrl, headers } = getCoinGeckoConfig()
  let rawTop100: any[] = []
  const volumeHistories: Record<string, number[][] | null> = {}
  const inceptionHistories: Record<string, { firstTimestamp?: number; firstDate?: string } | null> = {}
  const exchangePairs = options.exchangePairs || new Set<string>()

  try {
    // 1. Piyasa Değerine Göre İlk 100 Coini Çek (REST API)
    const marketsUrl = `${baseUrl}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h,7d,30d`
    rawTop100 = await fetchCoinGeckoWithRetry(marketsUrl, headers, 2)
    if (!Array.isArray(rawTop100) || rawTop100.length === 0) {
      throw new Error("CoinGecko REST API boş liste döndürdü.")
    }
  } catch (err: any) {
    console.warn("[refreshCoinGeckoPrefilter] CoinGecko API erişilemedi, güvenilir yedek liste (FALLBACK_TOP_PAIRS) devreye alındı:", err.message)
    const validFallbackPairs = exchangePairs.size > 0
      ? FALLBACK_TOP_PAIRS.filter(p => exchangePairs.has(p))
      : FALLBACK_TOP_PAIRS
    const fallbackCandidates: FilteredCandidate[] = validFallbackPairs.map((pair, idx) => {
      const sym = pair.replace("USDT", "")
      return {
        id: sym.toLowerCase(),
        symbol: sym.toUpperCase(),
        name: sym.toUpperCase(),
        binanceSymbol: pair,
        score: 100 - idx * 2,
        marketCap: 1_000_000_000,
        totalVolume: 50_000_000,
        liquidityRatio: 0.05,
        mom7d: 0,
        mom30d: 0,
        volatility7d: 4.5,
        athDistance: -40,
        volumeSpikeRatio: 1.0,
        ageDescription: "Top Likit Binance Futures (Yedek Havuz)",
      }
    })
    return {
      updatedAt: Date.now(),
      candidates: fallbackCandidates,
      eliminated: [{ symbol: "INFO", name: "CoinGecko Fallback", reason: `API uyarısı (${err.message}), işlemlerin kesilmemesi için en likit vadeli çiftler yüklendi.` }],
    }
  }

  // Kota koruması: Sadece temel filtreleri geçen adaylar için detaylı veri (yaş ve hacim grafiği) çekilir.
  const viableCandidates = rawTop100.filter(c => {
    if (isWrappedOrStaked(c)) return false
    if (isStableOrRwa(c)) return false
    if ((c.market_cap || 0) < 500_000_000) return false
    if ((c.total_volume || 0) < 20_000_000) return false
    const symUpper = c.symbol.toUpperCase()
    const pair = `${symUpper}USDT`
    if (exchangePairs.size > 0 && !exchangePairs.has(pair) && !exchangePairs.has(`1000${pair}`)) {
      return false
    }
    return true
  })

  // 2. Yaş Kontrolü: Redis önbelleğinden kontrol et, yoksa hesapla (Hız ve kota koruması: ilk 5 coin)
  for (const c of viableCandidates.slice(0, 5)) {
    try {
      // a) Redis'te var mı?
      const cached = await getCachedCoinAge(c.id)
      if (cached && cached.firstTimestamp) {
        inceptionHistories[c.id] = cached
        continue
      }
    } catch {}

    // b) genesis_date var mı?
    if (c.genesis_date) {
      const gTs = new Date(c.genesis_date).getTime()
      if (!isNaN(gTs)) {
        const ageData = { firstTimestamp: gTs, firstDate: c.genesis_date }
        inceptionHistories[c.id] = ageData
        await setCachedCoinAge(c.id, ageData).catch(() => {})
        continue
      }
    }

    // c) Genesis yoksa ve Redis'te yoksa, tek seferlik market_chart?days=max sorgula
    try {
      const chartUrl = `${baseUrl}/coins/${c.id}/market_chart?vs_currency=usd&days=max&interval=daily`
      const chartData = await fetchCoinGeckoWithRetry(chartUrl, headers, 1)
      if (chartData?.prices && chartData.prices.length > 0) {
        const firstTs = chartData.prices[0][0]
        const ageData = { firstTimestamp: firstTs, firstDate: new Date(firstTs).toISOString() }
        inceptionHistories[c.id] = ageData
        await setCachedCoinAge(c.id, ageData).catch(() => {})
      }
    } catch (chartErr: any) {
      // Sessizce geç (zaman aşımı yaratmasın)
    }
  }

  // 3. 7 Günlük Hacim Geçmişi (Hacim Patlaması Filtresi İçin - ilk 5 coin)
  for (const c of viableCandidates.slice(0, 5)) {
    try {
      const volUrl = `${baseUrl}/coins/${c.id}/market_chart?vs_currency=usd&days=7&interval=daily`
      const volData = await fetchCoinGeckoWithRetry(volUrl, headers, 1)
      if (volData?.total_volumes) {
        volumeHistories[c.id] = volData.total_volumes
      }
    } catch (volErr: any) {
      // Sessizce geç
    }
  }

  const result = filterAndScoreCoins({
    rawTop100,
    volumeHistories,
    inceptionHistories,
    availableExchangePairs: exchangePairs,
  })

  return {
    updatedAt: Date.now(),
    candidates: result.candidates,
    eliminated: result.eliminated,
  }
}

/**
 * 6 saatlik geçerlilik süresi (staleness) kontrolü.
 */
export function isPrefilterFresh(state: CoinGeckoPrefilterState | null): boolean {
  if (!state || !state.updatedAt) return false
  if (state.candidates.length === 0) return false
  const age = Date.now() - state.updatedAt
  return age <= MAX_STALE_MS
}
