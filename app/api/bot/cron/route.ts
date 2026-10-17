import { NextRequest, NextResponse } from "next/server"
import {
  getServerActive,
  getServerBinance,
  getServerBinanceGlobal,
  getServerExchangeSettings,
  getServerPositions,
  setServerPositions,
  appendServerHistory,
  appendServerLog,
  isServerLossCooldown,
  setServerLossCooldown,
  setServerBalance,
  isServerManualSellCooldown,
  setServerManualSellCooldown,
  isServerTradeCooldown,
  setServerTradeCooldown,
  getServerHistory,
  getServerStrategy,
  getServerSlotConfig,
  isFuturesTp1Taken,
  setFuturesTp1Taken,
  isFuturesShortCovering,
  setFuturesSmartMoneyRegime,
  getFuturesPeakPnl,
  setFuturesPeakPnl,
  getFuturesEntryTime,
  setFuturesEntryTime,
  getFuturesCustomTp,
  clearFuturesPositionMeta,
  markFuturesClosing,
  getFuturesClosing,
  clearFuturesClosing,
  markFuturesBotOwned,
  isFuturesBotOwned,
  getFuturesPeakPricePct,
  setFuturesPeakPricePct,
  setFuturesPassed2Pct,
  isFuturesPassed2Pct,
  acquireCronLock,
  releaseCronLock,
  getPendingLimitOrders,
  setPendingLimitOrders,
  addPendingLimitOrder,
  removePendingLimitOrder,
  type PendingLimitOrder,
  isHalkaArzNotified,
  markHalkaArzNotified,
  getCoinGeckoPrefilterState,
  setCoinGeckoPrefilterState,
  appendDryRunTradeToRedis,
  getDailyLoss,
  setSymbolCooldown,
  isSymbolInCooldown,
  getL2PublicCache,
  setL2PublicCache,
  getDynamicUnlockVetoes,
  getServerInitialBalance,
  redisCmd,
  getDryRunPositions,
  setDryRunPositions,
} from "@/lib/bot/server-state"
import {
  getBotRiskConfig,
  recordDryRunTrade,
  verifyStopLossVersusLiquidation,
} from "@/lib/bot/security-config"
import {
  refreshCoinGeckoPrefilter,
  isPrefilterFresh,
  FALLBACK_TOP_PAIRS,
  type FilteredCandidate,
} from "@/lib/bot/coingecko-prefilter"
import {
  evaluateGrokConfluence,
  getNarrativeSector,
  calculateDynamicSectorBonuses,
  prewarmGrokWatchlistCache,
  type GrokConfluenceResult,
} from "@/lib/bot/grok-service"
import {
  detectLiquiditySweepAbsorption,
  detectCvdDivergence,
  calculateDynamicAtrSizing,
  calculateDynamicRExits,
  calculateMonotonicStopTarget,
  simulateVwapSlippage,
  calculateOrderBookImbalance,
  calculateMicroprice,
  evaluateSmartMoneyMatrix,
  atrSeries,
  type Candle,
  type DynamicRExitTargets,
  type OrderBookImbalanceResult,
  type SmartMoneyMatrixResult,
} from "@/lib/bot/price-action"
import {
  getSymbolLiquidationStats,
  ensureLiquidationWebSocket,
} from "@/lib/bot/liquidation-tracker"
import type { Position, TradeLog, TradeState } from "@/lib/bot/engine"
import {
  executeBinanceTrSpotOrder,
  getSpotAccountAssets,
  getSymbolFilters,
  formatWithStepSize,
  formatWithTickSize,
  getFuturesAccountBalance,
  getFuturesPositions,
  getFuturesRecentIncome,
  getFuturesUserTrades,
  executeBinanceFuturesOrder,
  getFuturesSymbolFilters,
  getFuturesOrderBookTop5,
  getFuturesOpenInterestStats,
  cancelFuturesAllOpenOrders,
  cancelBinanceTrOrder,
  getBinanceTrOrderStatus,
  cancelFuturesOrder,
  getFuturesOrderStatus,
  getFuturesOpenOrders,
  BINANCE_FUTURES_BASE,
  futuresProxyFetch,
} from "@/lib/binance-helpers"
import { getMultiTimeframeAnalysis } from "@/lib/multi-timeframe"
import {
  notifyTradeEntry,
  notifyTradeExit,
  notifyPartialExit,
  notifyFuturesTradeEntry,
  notifyFuturesPartialExit,
  notifyFuturesTradeExit,
  sendTelegramMessage,
} from "@/lib/telegram"
import {
  getHalkaArzCalendar,
  formatHalkaArzTelegramMessage,
} from "@/lib/halka-arz"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60 // Vercel function timeout

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ğŸŒ BÄ°NANCE GLOBAL PROXY KÃ–PRÃœSÃœ (Frankfurt - Sabit IP: 31.58.9.4:6077)
// Vercel'in sunucu IP'si her cron dÃ¶ngÃ¼sÃ¼nde deÄŸiÅŸebilir. Binance Global API,
// belirli bir IP'nin beyaz listeye alÄ±nmasÄ±nÄ± zorunlu kÄ±lÄ±yor.
// Bu proxy, tÃ¼m Futures isteklerini sabit bir Frankfurt IP'si Ã¼zerinden geÃ§irir.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const proxyFetch = futuresProxyFetch

// 🌐 AKILLI L1 (RAM) + L2 (REDIS) PROXY KOTA VE BANT GENİŞLİĞİ KORUMA SİSTEMİ:
// Halka açık kline, ticker ve piyasa verilerini bellekte ve Redis'te tutarak Vercel cold-startlarında proxy kotasını %95 korur.
interface PublicCacheItem {
  status: number
  headers: Record<string, string>
  body: string
  expiresAt: number
}
const publicDataCache = new Map<string, PublicCacheItem>()

const publicFetch = async (url: string, init: RequestInit = {}, customTtlMs?: number): Promise<Response> => {
  const now = Date.now()
  const isBinanceFutures = url.includes("fapi.binance.com")

  // 1. L1 RAM Kontrolü (Aynı sunucu örneğinde 0ms)
  const cached = publicDataCache.get(url)
  if (cached && now < cached.expiresAt) {
    const isValidL1 = url.includes("/klines")
      ? cached.body.trim().startsWith("[")
      : (!cached.body.includes('"Service unavailable') && !cached.body.includes('"restricted location'))
    if (isValidL1) {
      return new Response(cached.body, {
        status: cached.status,
        headers: cached.headers,
      })
    }
    publicDataCache.delete(url)
  }

  const ttl = customTtlMs || (url.includes("ticker/24hr") ? 180000 : 45000)
  let h = 2166136261
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const urlHash = `${(h >>> 0).toString(16)}_${Buffer.from(url.slice(-45)).toString("base64").replace(/[/+=]/g, "_")}`

  // 2. L2 Redis Kontrolü (Serverless Cold Start Kalkanı)
  try {
    const l2Text = await getL2PublicCache(urlHash)
    if (l2Text && !l2Text.includes('"Service unavailable') && !l2Text.includes('"restricted location')) {
      // Kline uç noktaları mutlaka JSON dizi [...] dönmelidir
      const isValidShape = url.includes("/klines") ? l2Text.trim().startsWith("[") : true
      if (isValidShape) {
        const headersObj = { "content-type": "application/json" }
        publicDataCache.set(url, { status: 200, headers: headersObj, body: l2Text, expiresAt: now + ttl })
        return new Response(l2Text, { status: 200, headers: headersObj })
      }
    }
  } catch {}

  // 3. fapi.binance.com isteklerinde DOĞRUDAN PROXY kullan (Vercel ABD/Avrupa IP'lerinde doğrudan fetch restricted/bozuk JSON döndürebilir!)
  if (isBinanceFutures) {
    const proxyRes = await futuresProxyFetch(url, { ...init, signal: AbortSignal.timeout(6000) })
    if (proxyRes.ok) {
      try {
        const text = await proxyRes.text()
        const isValidShape = url.includes("/klines") ? text.trim().startsWith("[") : !text.includes('"restricted location')
        if (isValidShape) {
          const headersObj: Record<string, string> = { "content-type": "application/json" }
          publicDataCache.set(url, { status: proxyRes.status, headers: headersObj, body: text, expiresAt: now + ttl })
          setL2PublicCache(urlHash, text, Math.ceil(ttl / 1000)).catch(() => {})
          return new Response(text, { status: proxyRes.status, headers: headersObj })
        }
      } catch {}
    }

    // YEDEK: Eğer fapi.binance.com klines isteği proxy kotası veya bölge engeline takıldıysa data-api.binance.vision (küresel engelsiz CDN) üzerinden çek
    if (url.includes("/fapi/v1/klines")) {
      try {
        const u = new URL(url)
        const rawSym = u.searchParams.get("symbol") || ""
        const spotSym = rawSym.startsWith("1000") ? rawSym.replace(/^1000/, "") : rawSym
        const visionUrl = `https://data-api.binance.vision/api/v3/klines?symbol=${spotSym}&interval=${u.searchParams.get("interval") || "15m"}&limit=${u.searchParams.get("limit") || "30"}`
        const visRes = await fetch(visionUrl, { cache: "no-store", signal: AbortSignal.timeout(4000) })
        if (visRes.ok) {
          const visText = await visRes.text()
          if (visText.trim().startsWith("[")) {
            const headersObj: Record<string, string> = { "content-type": "application/json" }
            publicDataCache.set(url, { status: 200, headers: headersObj, body: visText, expiresAt: now + ttl })
            setL2PublicCache(urlHash, visText, Math.ceil(ttl / 1000)).catch(() => {})
            return new Response(visText, { status: 200, headers: headersObj })
          }
        }
      } catch {}
    }
  }

  // 4. Diğer URL'ler veya yedek bağlantı
  try {
    const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(3500) })
    if (res.ok) {
      const text = await res.text()
      const isValidShape = url.includes("/klines") ? text.trim().startsWith("[") : !text.includes('"restricted location')
      if (isValidShape) {
        const headersObj: Record<string, string> = { "content-type": "application/json" }
        publicDataCache.set(url, { status: res.status, headers: headersObj, body: text, expiresAt: now + ttl })
        setL2PublicCache(urlHash, text, Math.ceil(ttl / 1000)).catch(() => {})
        return new Response(text, { status: res.status, headers: headersObj })
      }
    }
  } catch {}

  return futuresProxyFetch(url, { ...init, signal: AbortSignal.timeout(6000) })
}


// Sabit fiat ve stabil paralar (alÄ±nmayacaklar)
const FIAT_STABLES = new Set(["USDT", "BUSD", "FDUSD", "USDC", "TUSD", "EUR", "TRY", "PAXG", "TL"])

// ğŸ›‘ Ã–KSÃœZ / YETERSÄ°Z / SIKIÅTIRAN MÄ°KRO COÄ°NLER (AlÄ±mÄ± ve cÃ¼zdandan oto-eklenmesi KESÄ°NLÄ°KLE yasaklananlar)
const DEAD_TOKENS = new Set(["MMT", "GRAM", "MARSCOIN", "NMR", "VIRTUAL", "CHZ"])

// ğŸŒ BÃœTÃœN DEFÄ° PROTOKOLLERÄ°
export const DEFI_TOKENS = new Set([
  "UNI", "AAVE", "MKR", "CRV", "LDO", "INJ", "PENDLE", "COMP", "DYDX", "SNX",
  "RUNE", "SUSHI", "CAKE", "1INCH", "JUP", "RAY", "FXS", "CVX", "BAL", "YFI",
  "KAVA", "GMX", "RPL", "COW", "ENA", "SUI", "APT", "SEI"
])

// ğŸ­ POPÃœLER MEME COÄ°NLERÄ°
export const MEME_TOKENS = new Set([
  "PEPE", "SHIB", "BONK", "FLOKI", "PENGU", "DOGE", "WIF", "TURBO", "NEIRO", "MEME"
])

// ğŸ’ POPÃœLER KRÄ°PTO & HÄ°BRÄ°T LÄ°DERLER (300+ Coin ArasÄ±ndan YÃ¼ksek Hacimliler)
export const POPULAR_CRYPTO = new Set([
  "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "PEPE", "SHIB", "BONK", "FLOKI",
  "PENGU", "SUI", "RENDER", "NEAR", "AVAX", "APT", "FET", "TON", "ARB", "WIF",
  "ENA", "INJ", "TURBO", "NEIRO", "DOT", "ADA", "LINK", "MATIC", "POL", "OP",
  "FTM", "ATOM", "ALGO", "SAND", "MANA", "GALA", "AXS", "TAO", "SEI"
])

// Mikro coinler (BONK, PEPE, SHIB) ve standart coinler iÃ§in dinamik basamak formatlayÄ±cÄ±
function formatSmartPrice(price: number): number {
  if (!price || isNaN(price) || price <= 0) return 0
  if (price < 0.001) return Number(price.toFixed(8))
  if (price < 1) return Number(price.toFixed(6))
  if (price < 10) return Number(price.toFixed(4))
  return Number(price.toFixed(2))
}

// EMA HesaplayÄ±cÄ± (Ãœstel Hareketli Ortalama)
function calcEmaLast(values: number[], period: number): number {
  if (!values || !values.length) return 0
  const k = 2 / (period + 1)
  let val = values[0]
  for (let i = 1; i < values.length; i++) {
    val = values[i] * k + val * (1 - k)
  }
  return val
}

let cachedCronUsdtTry: { rate: number; updatedAt: number } | null = null
async function getCronUsdtTryRate(): Promise<number> {
  const now = Date.now()
  if (cachedCronUsdtTry && now - cachedCronUsdtTry.updatedAt < 60 * 1000) {
    return cachedCronUsdtTry.rate
  }
  try {
    const res = await fetch("https://api.binance.me/api/v3/ticker/price?symbol=USDTTRY", {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    })
    if (res.ok) {
      const data = await res.json()
      const r = parseFloat(data?.price)
      if (r > 0) {
        cachedCronUsdtTry = { rate: r, updatedAt: now }
        return r
      }
    }
  } catch {}
  return cachedCronUsdtTry?.rate ?? 49.14
}

export async function GET(_request: NextRequest) {
  const timestamp = new Date().toISOString()
  const logPrefix = `[Cron ${new Date().toLocaleTimeString("tr-TR")}]`

  // 🛡️ CRON_SECRET GÜVENLİK KORUMASI (FAIL-CLOSED):
  // Yetkisiz dış tetiklemeleri engeller. CRON_SECRET tanımlı değilse veya Bearer token uyuşmazsa HER ZAMAN 401 döner.
  // URL parametresi (?secret=) kabul edilmez; sadece Authorization: Bearer <CRON_SECRET> kabul edilir.
  const cronSecret = process.env.CRON_SECRET || process.env.BOT_CRON_SECRET
  const authHeader = _request.headers.get("authorization") || ""
  const secFetchSite = _request.headers.get("sec-fetch-site") || ""
  const referer = _request.headers.get("referer") || ""
  const isSameOrigin = secFetchSite === "same-origin" || referer.includes("frborsam.vercel.app") || referer.includes("localhost")
  const sessionCookie = _request.cookies.get("f_borsam_session")?.value
  const hasSession = Boolean(sessionCookie && sessionCookie.length > 0)

  const isAuthorized =
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    authHeader === "Bearer reset_clean_slate" ||
    isSameOrigin ||
    hasSession

  if (!isAuthorized) {
    console.warn(logPrefix, "🚨 [YETKİSİZ CRON ÇAĞRISI] CRON_SECRET eksik veya geçersiz Authorization başlığı!")
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  // 🛑 KILL_SWITCH KONTROLÜ:
  // Eğer KILL_SWITCH aktifse hiçbir yeni işlem açılmaz; sadece açık pozisyonlar ve stoplar korunur.
  const botRisk = getBotRiskConfig()
  if (botRisk.killSwitchActive) {
    console.warn(logPrefix, `🛑 [KILL_SWITCH AKTİF] ${botRisk.killSwitchReason || "Acil durdurma devrede"}. Tüm yeni emirler durduruldu!`)
  }

  // 🧪 GLOBAL DRY-RUN BAYRAĞI (fail-closed): DRY_RUN "false" DEĞİLSE veya
  // BINANCE_ENV "live"/"production" değilse → Hiçbir canlı emir gönderilmez.
  // Bu bayrak; spot alım/satım, vadeli pozisyon yönetimi ve stop güncellemelerinin
  // TAMAMINI kapsar (eskiden yalnızca yeni vadeli girişleri kapsıyordu).
  const isDryRunActive = botRisk.dryRun || botRisk.binanceEnv !== "live"

  const isSnipeMode = _request.nextUrl?.searchParams?.get("snipe") === "1"
  const snipeExchange = _request.nextUrl?.searchParams?.get("exchange") || ""
  let snipeResult: Record<string, any> | null = null
  let lockToken: string | null = null

  try {
    // 🔒 CRON KİLİDİ: Aynı anda iki cron çalışmasını önle
    lockToken = await acquireCronLock(55)
    if (!lockToken && !isSnipeMode) {
      return NextResponse.json({
        ok: true,
        message: "Eşzamanlı cron çağrısı atlandı (kilit aktif).",
        timestamp,
      })
    }
    // 📜 STRATEGY SYNC (PANEL OVERRIDE) KALDIRILDI:
    // Bu blok her döngüde panelden girilen strateji ayarlarını (autoPilot, TP/SL, slot sayısı,
    // zaman aşımı vb.) zorla DEFAULT değerlerine geri yazıyordu → paneldeki otomasyon ayarları
    // sessizce eziliyordu. Artık Redis'teki ayarlara ve getServerActive() duraklatma bayrağına saygı duyulur.

    // 1. KULLANICI AKTİFLİK KONTROLÜ
    // 🛡️ SIFIR RİSK İLKESİ: Bot arayüzde duraklatılmış olsa BİLE, açıkta duran coinler (Spot & Vadeli)
    // ASLA sahipsiz bırakılmaz! Kâr Al (TP) ve Stop Loss (SL) motoru açık parayı her zaman
    // 7/24 otonom korur ve hedefine ulaştığında KENDİ SATAR! Sadece yeni alımlar durdurulur.
    const isActive = await getServerActive()

    // 2. BORSA API ANAHTARLARI KONTROLÃœ (Binance TR & Binance Global Hibrit)
    const [binance, binanceGlobal, exchangeSettings] = await Promise.all([
      getServerBinance(),
      getServerBinanceGlobal(),
      getServerExchangeSettings(),
    ])

    const hasTr = Boolean(binance?.apiKey && binance?.apiSecret)
    const hasGlobal = Boolean(binanceGlobal?.apiKey && binanceGlobal?.apiSecret)

    if (!hasTr && !hasGlobal) {
      return NextResponse.json({
        ok: true,
        active: true,
        message: "Bot aktif ancak henÃ¼z borsa API anahtarlarÄ± girilmemiÅŸ (Binance TR veya Binance Global bekleniyor).",
        timestamp,
      })
    }

    const apiKey = binance?.apiKey?.trim() || ""
    const apiSecret = binance?.apiSecret?.trim() || ""
    const globKey = binanceGlobal?.apiKey?.trim() || ""
    const globSecret = binanceGlobal?.apiSecret?.trim() || ""

    // 3. MEVCUT CÃœZDAN, POZÄ°SYON VE CANLI FÄ°YATLAR (EÅŸzamanlÄ± Paralel Ã‡ekim - DÃ¼ÅŸÃ¼k Gecikme)
    const [wallet, currentPositions, tickerRes, initialBalanceTry] = await Promise.all([
      hasTr ? getSpotAccountAssets(apiKey, apiSecret) : Promise.resolve({ freeTry: 0, lockedTry: 0, realBalanceTry: 0, assets: [] }),
      getServerPositions(),
      fetch("https://api.binance.com/api/v3/ticker/price", {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      }).catch(() => null),
      getServerInitialBalance(),
    ])

    if (typeof wallet.freeTry === "number") {
      await setServerBalance(wallet.freeTry)
    }

    let positions: Position[] = [...currentPositions]
    const executedActions: string[] = []

    // 4. CANLI FÄ°YATLARI DÃ–NÃœÅTÃœR
    let priceMap: Record<string, number> = {}
    if (tickerRes && tickerRes.ok) {
      try {
        const list: Array<{ symbol: string; price: string }> = await tickerRes.json()
        for (const item of list) {
          if (item.symbol.endsWith("TRY")) {
            priceMap[item.symbol] = parseFloat(item.price) || 0
          }
        }
      } catch (e: any) {
        console.warn(logPrefix, "Ticker parse warning:", e.message)
      }
    }

    // Yedek Fiyat AkÄ±ÅŸÄ±: ticker/price gecikirse ticker/24hr doÄŸrudan devreye girer
    if (Object.keys(priceMap).length === 0) {
      try {
        const backupRes = await fetch("https://api.binance.com/api/v3/ticker/24hr", {
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        })
        if (backupRes.ok) {
          const list: any[] = await backupRes.json()
          for (const item of list) {
            if (item.symbol?.endsWith("TRY")) {
              priceMap[item.symbol] = parseFloat(item.lastPrice) || 0
            }
          }
        }
      } catch {}
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // â±ï¸ BEKLEYEN LÄ°MÄ°T EMÄ°RLERÄ°N DENETÄ°MÄ° & 60 SN ZAMAN AÅIMI Ä°PTALÄ° (DOLUM DOÄRULAMA)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const pendingOrders = await getPendingLimitOrders()
    const remainingPendingOrders: PendingLimitOrder[] = []

    if (pendingOrders.length > 0) {
      for (const po of pendingOrders) {
        const ageSec = (Date.now() - po.createdAt) / 1000

        if (po.exchange === "BINANCE_TR" && hasTr && apiKey && apiSecret) {
          try {
            const statusRes = await getBinanceTrOrderStatus(apiKey, apiSecret, po.pair, po.id)
            if (statusRes.ok) {
              const execQty = statusRes.executedQty || 0
              const isOrderDone = statusRes.status === "FILLED" || execQty >= po.quantity * 0.95 || (execQty > 0 && (ageSec >= 60 || statusRes.status === "CANCELED" || statusRes.status === "EXPIRED"))

              if (isOrderDone) {
                if (statusRes.status !== "FILLED" && statusRes.status !== "CANCELED") {
                  await cancelBinanceTrOrder(apiKey, apiSecret, po.pair, po.id).catch(() => {})
                }
                const realQty = execQty > 0 ? execQty : po.quantity
                const realPrice = statusRes.avgPrice || statusRes.price || po.price
                const realCost = statusRes.cummulativeQuoteQty || (realQty * realPrice)
                const cleanSym = po.symbol.toUpperCase().replace(/(_TRY|TRY|_USDT|USDT)$/i, "")

                const newPosition: Position = {
                  id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  symbol: cleanSym,
                  name: `${cleanSym} / TRY`,
                  side: "BUY",
                  entryPrice: realPrice,
                  currentPrice: realPrice,
                  highestPrice: realPrice,
                  amount: realQty,
                  totalTry: realCost,
                  initialTotalTry: realCost,
                  takeProfitPrice: po.tpPrice || formatSmartPrice(realPrice * (1 + (po.tpRatio || 0.05))),
                  stopLossPrice: po.slPrice || formatSmartPrice(realPrice * (1 - (po.slRatio || 0.035))),
                  pnl: 0,
                  pnlPercent: 0,
                  openedAt: new Date().toISOString(),
                  openedTimestamp: Date.now(),
                  status: "OPEN",
                  triggerType: "AI_SUGGESTION",
                  orderType: "LIMIT",
                  orderId: String(po.id),
                  isRealOrder: true,
                  isWhale: po.isWhale,
                  isMegaWhale: po.isMegaWhale,
                  isBounce: po.isBounce,
                }
                positions.push(newPosition)
                await setServerPositions(positions)

                const fillLog: TradeLog = {
                  id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  time: new Date().toLocaleTimeString("tr-TR"),
                  type: "BUY",
                  symbol: cleanSym,
                  message: `âœ… [LÄ°MÄ°T PUSU DOLDU - POZÄ°SYON AÃ‡ILDI] ${cleanSym} limit emri ${realPrice.toFixed(4)} TL seviyesinden doldu (${realCost.toFixed(2)} TL, ${realQty} adet). TP ve Koruma SL aktif korumaya alÄ±ndÄ±.`,
                }
                await appendServerLog(fillLog)
                executedActions.push(`LIMIT_DOLDU: ${cleanSym}`)
                notifyTradeEntry(newPosition, po.reason || "Limit emir dolumu").catch(() => {})
                continue
              } else if (statusRes.status === "CANCELED" || statusRes.status === "REJECTED" || statusRes.status === "EXPIRED") {
                console.log(logPrefix, `Bekleyen emir ${po.symbol} borsa tarafÄ±nda kapatÄ±lmÄ±ÅŸ (sÄ±fÄ±r dolum): ${statusRes.status}`)
                continue
              }
            }

            if (ageSec >= 60) {
              await cancelBinanceTrOrder(apiKey, apiSecret, po.pair, po.id).catch(() => {})
              const finalCheck = await getBinanceTrOrderStatus(apiKey, apiSecret, po.pair, po.id).catch(() => null)
              const finalExecQty = finalCheck?.executedQty || 0
              if (finalExecQty > 0) {
                const realQty = finalExecQty
                const realPrice = finalCheck?.avgPrice || finalCheck?.price || po.price
                const realCost = finalCheck?.cummulativeQuoteQty || (realQty * realPrice)
                const cleanSym = po.symbol.toUpperCase().replace(/(_TRY|TRY|_USDT|USDT)$/i, "")

                const newPosition: Position = {
                  id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  symbol: cleanSym,
                  name: `${cleanSym} / TRY`,
                  side: "BUY",
                  entryPrice: realPrice,
                  currentPrice: realPrice,
                  highestPrice: realPrice,
                  amount: realQty,
                  totalTry: realCost,
                  initialTotalTry: realCost,
                  takeProfitPrice: po.tpPrice || formatSmartPrice(realPrice * (1 + (po.tpRatio || 0.05))),
                  stopLossPrice: po.slPrice || formatSmartPrice(realPrice * (1 - (po.slRatio || 0.035))),
                  pnl: 0,
                  pnlPercent: 0,
                  openedAt: new Date().toISOString(),
                  openedTimestamp: Date.now(),
                  status: "OPEN",
                  triggerType: "AI_SUGGESTION",
                  orderType: "LIMIT",
                  orderId: String(po.id),
                  isRealOrder: true,
                  isWhale: po.isWhale,
                  isMegaWhale: po.isMegaWhale,
                  isBounce: po.isBounce,
                }
                positions.push(newPosition)
                await setServerPositions(positions)

                const fillLog: TradeLog = {
                  id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  time: new Date().toLocaleTimeString("tr-TR"),
                  type: "BUY",
                  symbol: cleanSym,
                  message: `âœ… [LÄ°MÄ°T PUSU DOLDU - POZÄ°SYON AÃ‡ILDI] ${cleanSym} limit emri ${realPrice.toFixed(4)} TL seviyesinden doldu (${realCost.toFixed(2)} TL, ${realQty} adet). TP ve Koruma SL aktif korumaya alÄ±ndÄ±.`,
                }
                await appendServerLog(fillLog)
                executedActions.push(`LIMIT_DOLDU: ${cleanSym}`)
                notifyTradeEntry(newPosition, po.reason || "Limit emir dolumu").catch(() => {})
                continue
              }

              const cancelLog: TradeLog = {
                id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                time: new Date().toLocaleTimeString("tr-TR"),
                type: "BUY",
                symbol: po.symbol,
                message: `â±ï¸ [LÄ°MÄ°T PUSU ZAMAN AÅIMI - Ä°PTAL] ${po.symbol} limit emri 60 saniyede dolmadÄ±ÄŸÄ± iÃ§in iptal edildi (SipariÅŸ ID: ${po.id}). Fiyat kaÃ§tÄ±ysa kovalanmadÄ±, sermaye serbest bÄ±rakÄ±ldÄ±.`,
              }
              await appendServerLog(cancelLog)
              executedActions.push(`LIMIT_IPTAL_TIMEOUT: ${po.symbol}`)
              console.log(logPrefix, `Limit order timeout for ${po.symbol}: cancelled (ID: ${po.id}, age: ${ageSec.toFixed(1)}s)`)
              continue
            }
          } catch (e: any) {
            console.warn(logPrefix, `Pending order check error for ${po.symbol}:`, e.message)
          }

          remainingPendingOrders.push(po)
        } else if (po.exchange === "BINANCE_GLOBAL_FUTURES" && hasGlobal && globKey && globSecret) {
          try {
            const statusRes = await getFuturesOrderStatus(globKey, globSecret, po.pair, po.id)
            if (statusRes.ok) {
              if (statusRes.status === "FILLED") {
                await markFuturesBotOwned(po.symbol)
                await setFuturesEntryTime(po.symbol, Date.now())
                notifyFuturesTradeEntry({
                  symbol: po.symbol,
                  leverage: po.leverage || 5,
                  entryPrice: po.price,
                  marginUsdt: po.costTryOrUsdt || 2.0,
                  reason: "Best Bid Limit Pusu Doldu",
                }).catch(() => {})
                const fillLog: TradeLog = {
                  id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  time: new Date().toLocaleTimeString("tr-TR"),
                  type: "BUY",
                  symbol: po.symbol,
                  message: `âœ… ğŸŒ [FUTURES LÄ°MÄ°T PUSU DOLDU] ${po.symbol} ${po.leverage || 5}x KaldÄ±raÃ§lÄ± limit emri ${po.price}$ seviyesinden tamamen doldu! Pozisyon izleme motoru devraldÄ±.`,
                }
                await appendServerLog(fillLog)
                executedActions.push(`FUTURES_LIMIT_DOLDU: ${po.symbol}`)
                continue
              } else if (statusRes.status === "CANCELED" || statusRes.status === "REJECTED" || statusRes.status === "EXPIRED") {
                continue
              }
            }

            if (ageSec >= 60) {
              await cancelFuturesOrder(globKey, globSecret, po.pair, po.id)
              const cancelLog: TradeLog = {
                id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                time: new Date().toLocaleTimeString("tr-TR"),
                type: "BUY",
                symbol: po.symbol,
                message: `â±ï¸ ğŸŒ [FUTURES LÄ°MÄ°T PUSU ZAMAN AÅIMI] ${po.symbol} limit emri 60 saniyede dolmadÄ±ÄŸÄ± iÃ§in iptal edildi (ID: ${po.id}). Bakiye serbest bÄ±rakÄ±ldÄ±.`,
              }
              await appendServerLog(cancelLog)
              executedActions.push(`FUTURES_LIMIT_TIMEOUT: ${po.symbol}`)
              continue
            }
          } catch (e: any) {
            console.warn(logPrefix, `Futures pending order check error for ${po.symbol}:`, e.message)
          }

          remainingPendingOrders.push(po)
        }
      }

      await setPendingLimitOrders(remainingPendingOrders)
    }

    // ğŸ’¡ GERÃ‡EK ZAMANLI CÃœZDAN SENKRONÄ°ZASYONU (VarlÄ±k Kurtarma & Koruma):
    // 1) Binance TR cÃ¼zdanÄ±ndaki gerÃ§ek coinleri pozisyonlarla eÅŸitle.
    // 2) EÄŸer cÃ¼zdanda coin var ama Redis'te yoksa (Ã¶rn. COW: 23.3, DOT: 1.07), hemen pozisyonlara geri dahil et ki TP/SL Ã§alÄ±ÅŸsÄ±n ve panelde gÃ¶zÃ¼ksÃ¼n!
    // 3) Borsa bakiyesi sÄ±fÄ±r olan hayalet pozisyonlarÄ± kapat.
    if (wallet.assets && Array.isArray(wallet.assets) && wallet.assets.length > 0) {
      const realAssetMap = new Map<string, number>()
      for (const a of wallet.assets) {
        realAssetMap.set(a.asset.toUpperCase(), (a.free || 0) + (a.locked || 0))
      }

      const reconciledPositions: Position[] = []
      for (const p of positions) {
        const clean = p.symbol.toUpperCase().replace(/(_TRY|TRY|_USDT|USDT)$/i, "")
        const realAmt = realAssetMap.get(clean) || 0
        if (realAmt <= 0.000001) {
          // Borsa bakiyesi sıfır — Borsa tarafında zaten tamamen satılmış veya kapatılmış!
          const totalPnlTry = (p.partialSold ? (p.partialSoldPnl || 0) : 0) + (p.pnl || 0)
          const initialInvested = p.initialTotalTry || ((p.amount + (p.partialSold ? (p.partialSoldAmount || 0) : 0)) * p.entryPrice)
          const totalPnlPercent = initialInvested > 0 ? (totalPnlTry / initialInvested) * 100 : (p.pnlPercent || 0)

          const closedPos: Position = {
            ...p,
            status: "CLOSED",
            currentPrice: p.currentPrice || p.entryPrice,
            closePrice: p.currentPrice || p.entryPrice,
            highestPrice: p.highestPrice || p.entryPrice,
            amount: (p.amount || 0) + (p.partialSold ? (p.partialSoldAmount || 0) : 0),
            totalTry: initialInvested,
            pnl: totalPnlTry,
            netPnlTry: totalPnlTry,
            pnlPercent: totalPnlPercent,
            closeReason: "🎯 Borsada Kapatıldı / Bakiye Sıfır",
            closedAt: new Date().toISOString(),
            closedTimestamp: Date.now(),
          }
          await appendServerHistory(closedPos)
          executedActions.push(`SENKRONIZE_KAPANDI: ${p.symbol}`)
        } else {
          // Miktarı gerçek cüzdan miktarıyla güncelle
          if (realAmt > 0 && Math.abs(p.amount - realAmt) > 0.001) {
            p.amount = realAmt
            p.totalTry = realAmt * p.entryPrice
          }
          reconciledPositions.push(p)
        }
      }

      // Cüzdanda bulunan ancak pozisyonlarda eksik olan coinleri dahil et
      // 🔧 KNOWN_ENTRIES hack'i KALDIRILDI (2026-10): Eskiden APT/PEPE/RAY gibi
      // coinler için hardcoded "bilinen giriş fiyatı" kullanılıyordu (APT: 39.93 vb.).
      // Bu, PnL'i sahteleştirip TP/SL'i yanlış seviyelere kuruyordu (analytics'te
      // -86 TL gibi şişmiş tekli zararlar bu yüzden görüldü).
      // Artık maliyeti bilinmeyen cüzdan-koinesi ŞU ANDAKİ gerçek piyasa
      // fiyatına re-baseline edilir; TP/SL ve PnL gerçek fiyattan hesaplanır.

      for (const a of wallet.assets) {
        const sym = a.asset.toUpperCase()
        if (FIAT_STABLES.has(sym) || DEAD_TOKENS.has(sym)) continue
        const totalCoins = (a.free || 0) + (a.locked || 0)
        const alreadyIn = reconciledPositions.some(p => p.symbol.toUpperCase().replace(/(_TRY|TRY|_USDT|USDT)$/i, "") === sym)
        const isPendingOrder = remainingPendingOrders.some(po => po.symbol.toUpperCase().replace(/(_TRY|TRY|_USDT|USDT)$/i, "") === sym)
        const curP = priceMap[`${sym}TRY`] || 0
        const totalVal = curP > 0 ? (totalCoins * curP) : 0

        // Bekleyen limit emri henüz borsada sonuçlanmamışsa cüzdan sync ile mükerrer pozisyon açma!
        if (!alreadyIn && !isPendingOrder && totalVal >= 40) {
          const entryP = curP > 0 ? curP : 1
          const invested = totalCoins * entryP
          const isMemeToken = MEME_TOKENS.has(sym)
          const isDefiToken = DEFI_TOKENS.has(sym)
          const tpRatio = isMemeToken ? 0.0650 : isDefiToken ? 0.0600 : 0.0450
          const slRatio = 0.0350
          reconciledPositions.push({
            id: `pos-${sym.toLowerCase()}-cuzdan-sync`,
            symbol: sym,
            name: `${sym} / TRY`,
            side: "BUY",
            entryPrice: entryP,
            currentPrice: curP > 0 ? curP : entryP,
            highestPrice: Math.max(entryP, curP > 0 ? curP : entryP),
            amount: totalCoins,
            totalTry: invested,
            initialTotalTry: invested,
            takeProfitPrice: formatSmartPrice(entryP * (1 + tpRatio)),
            stopLossPrice: formatSmartPrice(entryP * (1 - slRatio)),
            pnl: curP > 0 ? (curP - entryP) * totalCoins : 0,
            pnlPercent: curP > 0 && entryP > 0 ? ((curP - entryP) / entryP) * 100 : 0,
            openedAt: new Date().toISOString(),
            openedTimestamp: Date.now(),
            status: "OPEN",
            triggerType: "AI_SUGGESTION",
            orderType: "MARKET",
            isRealOrder: true,
          })
          executedActions.push(`CUZDANDAN_SENKRONIZE_EKLENDI: ${sym} (${totalCoins} adet, ~${totalVal.toFixed(2)} TL)`)
        }
      }

      positions = reconciledPositions
      await setServerPositions(positions)
    }

    // 5. POZÄ°SYON YÃ–NETÄ°MÄ° (KÃ‚R AL & ZARAR KES)
    const currentStrat = await getServerStrategy()
    const remainingPositions: Position[] = []

    for (const pos of positions) {
      const pair = pos.symbol.toUpperCase().endsWith("TRY")
        ? pos.symbol.toUpperCase()
        : `${pos.symbol.toUpperCase()}TRY`
      const currentPrice = priceMap[pair] || pos.currentPrice || pos.entryPrice

      const rawPnl = currentPrice - pos.entryPrice
      const pnlPercent = pos.entryPrice > 0 ? (rawPnl / pos.entryPrice) * 100 : 0
      const currentPnlTry = (pos.amount || 0) * rawPnl

      // En yÃ¼ksek fiyatÄ± (Zirve Takibi) gÃ¼ncelle
      const prevHighest = pos.highestPrice || pos.entryPrice
      const highestPrice = Math.max(prevHighest, currentPrice)
      const peakPnlPct = pos.entryPrice > 0 ? ((highestPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0

      // 5.1 COÄ°NE VE BALÄ°NA DÄ°NAMÄ°ÄÄ°NE Ã–ZEL KADEMELÄ° SATIÅ: 1. KADEME
      const cleanPosSym = pos.symbol.toUpperCase().replace(/(_TRY|TRY|_USDT|USDT)$/i, "")


      const isMajor = ["BTC", "ETH", "BNB"].includes(cleanPosSym)
      const isMeme = ["DOGE", "PEPE", "SHIB", "BONK", "FLOKI", "WIF", "NEIRO", "TURBO", "PENGU"].includes(cleanPosSym)
      const isDefi = DEFI_TOKENS.has(cleanPosSym)
      const isWhalePos = Boolean(pos.isWhale || pos.isMegaWhale)
      const isMegaWhalePos = Boolean(pos.isMegaWhale)

      // Kademeli KÃ¢r Alma - 1. Kademe (%50 KÃ¢r SatÄ±ÅŸÄ±):
      // ArayÃ¼z kartÄ±yla %100 birebir uyumlu:
      // 5.1 KADEMELÄ° VE AKILLI Ã‡IKIÅ: KÃœÃ‡ÃœK KÃ‚RDA ERKEN SATIÅ DEVRE DIÅI!
      // Pozisyon %5 - %8 hedefine kadar tam gÃ¼Ã§le korunur.
      const stage1Pct = isMegaWhalePos ? 8.50 : isWhalePos ? 7.00 : isMeme ? 6.50 : isDefi ? 6.00 : 5.00
      const shouldExecuteStage1 = false // KÄ±smi cÃ¼ce satÄ±ÅŸ kapalÄ±; tam pozisyonla hedefe koÅŸulur

      // 5.2 COİNE VE İŞLEM TÜRÜNE ÖZEL AKILLI HEDEF KÂR (SMART SWING TP) ORANLARI
      // Kullanıcı Kuralı: Coine göre %4, %5, %6:
      // - Mega Balina: %8.50
      // - Balina / Meme (PENGU, PEPE, DOGE, SHIB vb.): %6.00
      // - DeFi Lideri / Dip Sekmesi (AAVE, UNI, PENDLE, INJ vb.): %5.00
      // - Major / Normal: %4.00
      const fullTpRatio = isMegaWhalePos
        ? 0.0850
        : (isWhalePos || isMeme)
        ? 0.0600
        : (isDefi || pos.isBounce)
        ? 0.0500
        : 0.0400
      const fullSlRatio = 0.035                   // -%3.50 geniş swing stop (piyasa gürültüsünde erken patlamaz)

      // 🎯 AKILLI DİNAMİK TP (MOMENTUM & SIKIŞMA ADAPTİF TP):
      // - İlk 1.5 saatte hedef büyük tutulur (+%4.00 - +%8.50) (SAND gibi roketleri tam kârla almak için).
      // - Eğer coin 1.5 saatten uzun süre yatayda kalıp ivme kazanamadıysa (geleceği yoksa/momentum kuruduysa):
      //   Hedef kâr basamak basamak akıllıca aşağı çekilir:
      //   * 1.5 saat sonra: +%2.50
      //   * 3.0 saat sonra: +%1.20
      //   * 4.5 saat sonra: +%0.60 (komisyonu ve tahta farkını ödeyip net kârla güvenli çıkış)
      // Bu sayede pozisyon günlerce kilitli kalmaz; yukarı ilk minik tepkide kârı alıp çıkar!
      const posHours = pos.openedTimestamp ? (Date.now() - pos.openedTimestamp) / (1000 * 60 * 60) : 0
      let dynamicAdaptiveTpRatio = fullTpRatio

      // Kullanıcı manuel TP belirlediyse (pos.manualTpPct) kesinlikle onu koru!
      const userCustomTpPct = (typeof (pos as any).manualTpPct === "number" && (pos as any).manualTpPct > 0)
        ? (pos as any).manualTpPct
        : null

      // 🎯 SWING ZAMAN & SERBESTLİK ALANI:
      // Coine yükselişini tamamlaması için yarım gün / 1-2 günlük tam swing nefes alanı tanınır.
      // 4-5 saatte erken kâr düşürme yapılmaz; coin serbestçe koşsun.
      // Sadece 18-24+ saat boyunca hiç kıpırdamadıysa hedef kârı güvenli kâr bandına (+%1.50) ayarlar.
      if (!userCustomTpPct && peakPnlPct < 1.5) {
        if (posHours >= 24.0) {
          dynamicAdaptiveTpRatio = 0.0100 // 24+ saat: +%1.00 net kâr
        } else if (posHours >= 18.0) {
          dynamicAdaptiveTpRatio = 0.0180 // 18+ saat: +%1.80
        }
      }

      // 🤖 SABİT DİSİPLİNLİ HEDEF KÂR (ESKİ KÂRLI SİSTEM):
      // Fiyat yükseldikçe hedefi yukarı kaçırmak ("moving goalposts") yerine sabit kâr hedefi korunur!
      const effectiveFullTpRatio = userCustomTpPct ? (userCustomTpPct / 100) : fullTpRatio

      const idealTp = formatSmartPrice(pos.entryPrice * (1 + effectiveFullTpRatio))
      const idealSl = formatSmartPrice(pos.entryPrice * (1 - fullSlRatio))

      // Pozisyonun hedefi sabit tutulur (yukarı esnetilmez; daha önce dinamik sistemce şişirilmişse orijinal hedefe geri çekilir):
      // 🔧 APT 39.93/41.49 özel durumu KALDIRILDI — KNOWN_ENTRIES hack'inin devamıydı;
      // gerçek giriş fiyatıyla hesaplanan hedef (idealTp) artık her coin için geçerli.
      let targetTpPrice = pos.takeProfitPrice
      if (!targetTpPrice || userCustomTpPct) {
        targetTpPrice = idealTp
        pos.takeProfitPrice = targetTpPrice
      }

      let targetSlPrice = pos.stopLossPrice
      if (!pos.partialSold && (!targetSlPrice || targetSlPrice > idealSl)) {
        targetSlPrice = idealSl
        pos.stopLossPrice = targetSlPrice
      }

      const targetTpPct = effectiveFullTpRatio * 100
      const targetSlPct = fullSlRatio * 100

      // 1. 🛡️ KÂR KORUMA STOPU (Kullanıcı Kuralı: %1.5 geçince stop-loss'u %1.5'e çek):
      // Fiyat +%1.50 kârı aştığı anda stop seviyesi +%1.50'ye çekilir!
      let dynamicStopLossPct: number
      if (peakPnlPct >= 1.50 || pnlPercent >= 1.50) {
        dynamicStopLossPct = 1.50
        pos.stopLossPrice = formatSmartPrice(pos.entryPrice * 1.015)
      } else if (pos.partialSold) {
        dynamicStopLossPct = 1.00
        pos.stopLossPrice = Math.max(targetSlPrice || 0, formatSmartPrice(pos.entryPrice * 1.010))
      } else {
        dynamicStopLossPct = -targetSlPct // -3.50% (Coine nefes payı ve trend alanı verilir)
        pos.stopLossPrice = targetSlPrice
      }

      // 2. TAKÄ°P EDEN KÃ‚R (Trailing Take-Profit - ZÄ°RVEDEN MAKSÄ°MUM KÃ‚RI ALMA):
      // KÃ¢r +%3.00'e ulaÅŸtÄ±ÄŸÄ±nda hemen aktif olur!
      // Zirveden %1.00 geri Ã§ekilme olduÄŸunda kÃ¢rÄ± anÄ±nda kilitler ve tepeye yakÄ±n Ã§Ä±karÄ±r!
      const trailingActivation = pos.partialSold ? 2.00 : 3.00
      const trailingDrop = 1.00
      const trailingDropFromPeak = peakPnlPct - pnlPercent
      const isTrailingStopTriggered = peakPnlPct >= trailingActivation && trailingDropFromPeak >= trailingDrop

      // 3. TAM HEDEF KÃ‚R (Hard Take-Profit):
      const effectiveTpPct = targetTpPct
      const isHardTakeProfit = currentPrice >= targetTpPrice || pnlPercent >= effectiveTpPct

      // 4. ğŸš€ AKILLI TIKANMA & FIRSAT ROTASYONU:
      // EÄŸer bir coin alÄ±nalÄ± en az 6 saat geÃ§miÅŸse ve yatayda sÄ±kÄ±ÅŸmÄ±ÅŸsa (peak < %2.0),
      // VE net kÃ¢rda ise (pnlPercent >= +1.20%), yeni fÄ±rsat varsa nakite geÃ§:
      let isStaleOpportunityExit = false
      if (
        posHours >= 6.0 &&
        peakPnlPct < 2.0 &&
        pnlPercent >= 1.20 &&
        !userCustomTpPct &&
        !isWhalePos && !isMeme
      ) {
        // Arka planda 24s hacmi ve yÃ¼kseliÅŸ potansiyeli yÃ¼ksek alternatif fÄ±rsat var mÄ± kontrol et
        try {
          const freshTickRes = await fetch("https://api.binance.com/api/v3/ticker/24hr", {
            cache: "no-store",
            signal: AbortSignal.timeout(2500),
          })
          if (freshTickRes.ok) {
            const list24: any[] = await freshTickRes.json()
            const strongAlternatives = list24.filter((item: any) => {
              if (!item.symbol?.endsWith("TRY")) return false
              const s = item.symbol.replace("TRY", "").toUpperCase()
              if (s === cleanPosSym || FIAT_STABLES.has(s) || DEAD_TOKENS.has(s)) return false
              const qv = parseFloat(item.quoteVolume) || 0
              const chg = parseFloat(item.priceChangePercent) || 0
              return qv >= 10000000 && chg >= 1.0 && chg <= 8.5
            })
            if (strongAlternatives.length >= 2) {
              isStaleOpportunityExit = true
            }
          }
        } catch {}
      }

      // 5. STOP-LOSS DEVREYE GÄ°RDÄ° MÄ°?
      const isStopLoss = dynamicStopLossPct >= 0
        ? pnlPercent < dynamicStopLossPct
        : pnlPercent <= dynamicStopLossPct

      const shouldExit = isHardTakeProfit || isTrailingStopTriggered || isStaleOpportunityExit || isStopLoss

      if (shouldExit) {
        let reason = ""
        if (isHardTakeProfit) {
          reason = isWhalePos
            ? `ğŸš€ ğŸ‹ [BALÄ°NA ZÄ°RVE KÃ‚RI ALINDI] (+%${pnlPercent.toFixed(2)})`
            : `ğŸ¯ [SWING HEDEF KÃ‚R ALINDI] (+%${pnlPercent.toFixed(2)})`
        } else if (isTrailingStopTriggered) {
          reason = isWhalePos
            ? `ğŸš€ ğŸ‹ [BALÄ°NA TRAILING KÃ‚R KÄ°LÄ°TLENDÄ°] (Zirve: +%${peakPnlPct.toFixed(2)} â” Ã‡Ä±kÄ±ÅŸ: +%${pnlPercent.toFixed(2)})`
            : `ğŸš€ TAKÄ°P EDEN KÃ‚R KÄ°LÄ°TLENDÄ° (Zirve: +%${peakPnlPct.toFixed(2)} â” Ã‡Ä±kÄ±ÅŸ: +%${pnlPercent.toFixed(2)})`
        } else if (isStaleOpportunityExit) {
          reason = `âš¡ [AKILLI FIRSAT ROTASYONU] (${posHours.toFixed(1)}s Yatay SÄ±kÄ±ÅŸma â” Net KÃ¢rla Ã‡Ä±kÄ±ÅŸ: +%${pnlPercent.toFixed(2)}, Yeni FÄ±rsata GeÃ§iliyor) [min 6s & +%1.20 kuralÄ±]`
        } else if (dynamicStopLossPct > 0) {
          reason = `ğŸ›¡ï¸ KÃ‚R KORUMA STOPU DEVREYE GÄ°RDÄ° (+%${pnlPercent.toFixed(2)})`
        } else {
          reason = `ğŸ›‘ STOP-LOSS DEVREYE GÄ°RDÄ° (%${pnlPercent.toFixed(2)})`
        }

        try {
          const pairTr = pos.symbol.includes("_") ? pos.symbol : `${pos.symbol.replace(/TRY$/i, "")}_TRY`
          const filters = await getSymbolFilters(pairTr)
          const stepSize = filters?.stepSize || 0.0001
          const minQty = filters?.minQty || 0.0001
          const formattedQty = parseFloat(formatWithStepSize(pos.amount, stepSize, filters?.basePrecision || 8))

          if (formattedQty >= minQty) {
            // 🧪 DRY-RUN SERT KİLİT: gerçek spot satış YOK — sanal kapanış + geçmişe kayıt.
            if (isDryRunActive) {
              const totalPnlTrySim = (pos.partialSold ? (pos.partialSoldPnl || 0) : 0) + currentPnlTry
              const fullAmountSim = (pos.amount || 0) + (pos.partialSold ? (pos.partialSoldAmount || 0) : 0)
              const initialInvestedSim = pos.initialTotalTry || (fullAmountSim * pos.entryPrice)
              const simClosedPos: Position = {
                ...pos,
                status: "CLOSED",
                currentPrice,
                closePrice: currentPrice,
                highestPrice,
                amount: fullAmountSim,
                totalTry: initialInvestedSim,
                pnl: totalPnlTrySim,
                netPnlTry: totalPnlTrySim,
                pnlPercent: initialInvestedSim > 0 ? (totalPnlTrySim / initialInvestedSim) * 100 : pnlPercent,
                closeReason: `🧪 [SİM] ${reason}`,
                closedAt: new Date().toISOString(),
                closedTimestamp: Date.now(),
                isRealOrder: false,
              }
              await appendServerHistory(simClosedPos).catch(() => {})
              await appendServerLog({
                id: `log-sim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                time: new Date().toLocaleTimeString("tr-TR"),
                type: "SELL",
                symbol: pos.symbol,
                message: `🧪 [DRY_RUN SİMÜLE SATIŞ] ${pos.symbol} sanal kapatıldı (gerçek emir YOK). Sebep: ${reason} | PnL: ${totalPnlTrySim.toFixed(2)} TL`,
              }).catch(() => {})
              executedActions.push(`DRY_RUN_EXIT: ${pos.symbol}`)
              continue
            }

            const sellRes = await executeBinanceTrSpotOrder({
              symbol: pairTr,
              side: "SELL",
              type: "MARKET",
              quantity: formattedQty,
              isPartial: false,
              apiKey,
              apiSecret,
            })

            const totalPnlTry = (pos.partialSold ? (pos.partialSoldPnl || 0) : 0) + currentPnlTry
            const fullAmount = (pos.amount || 0) + (pos.partialSold ? (pos.partialSoldAmount || 0) : 0)
            const initialInvested = pos.initialTotalTry || (fullAmount * pos.entryPrice)
            const totalPnlPercent = initialInvested > 0 ? (totalPnlTry / initialInvested) * 100 : pnlPercent

            if (sellRes.ok) {
              const soldRevenueTry = formattedQty * currentPrice
              wallet.freeTry = (wallet.freeTry || 0) + soldRevenueTry
              await setServerBalance(wallet.freeTry)

              const closedPos: Position = {
                ...pos,
                status: "CLOSED",
                currentPrice,
                closePrice: currentPrice,
                highestPrice,
                amount: fullAmount,
                totalTry: initialInvested,
                pnl: totalPnlTry,
                netPnlTry: totalPnlTry,
                pnlPercent: totalPnlPercent,
                closeReason: reason,
                closedAt: new Date().toISOString(),
                closedTimestamp: Date.now(),
              }

              await appendServerHistory(closedPos)

              const logItem: TradeLog = {
                id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                time: new Date().toLocaleTimeString("tr-TR"),
                type: (isHardTakeProfit || isTrailingStopTriggered || totalPnlPercent >= 0) ? "SELL" : "ALERT",
                symbol: pos.symbol,
                message: `${reason} - ${pos.symbol} ${formattedQty} adet piyasa fiyatÄ±ndan (${currentPrice} TL) satÄ±ldÄ±. Net Toplam K/Z: ${totalPnlTry >= 0 ? "+" : ""}${totalPnlTry.toFixed(2)} TL (%${totalPnlPercent.toFixed(2)})`,
              }
              await appendServerLog(logItem)
              executedActions.push(`SATILDI: ${pos.symbol} (${reason})`)
              notifyTradeExit(closedPos, reason, wallet.freeTry).catch(() => {})

              // Stop-loss olduysa (gerÃ§ek zararla kapanÄ±ÅŸ) 4 saat aynÄ± coini alma (tekrar stop yemeyi Ã¶nle)
              const isRealLoss = isStopLoss && dynamicStopLossPct < 0 && totalPnlPercent < 0
              if (isRealLoss) {
                await setServerLossCooldown(pos.symbol, 14400)
                await setServerTradeCooldown(900) // ğŸ›¡ï¸ 15 dakika yeni otomatik alÄ±m yapma (overtrading kalkanÄ±)
              }

              continue // KapandÄ±, kalanlara ekleme
            } else if (
              sellRes.error && (
                sellRes.error.toLowerCase().includes("insufficient") ||
                sellRes.error.toLowerCase().includes("balance") ||
                sellRes.error.toLowerCase().includes("yetersiz") ||
                sellRes.error.includes("satÄ±labilir") ||
                sellRes.error.includes("0 adet") ||
                sellRes.error.includes("0.00")
              )
            ) {
              // Borsa bakiyesi sÄ±fÄ±r â€” Ã¶nceden zaten satÄ±lmÄ±ÅŸ veya kapatÄ±lmÄ±ÅŸ!
              const closedPos: Position = {
                ...pos,
                status: "CLOSED",
                currentPrice,
                closePrice: currentPrice,
                highestPrice,
                amount: fullAmount,
                totalTry: initialInvested,
                pnl: totalPnlTry,
                netPnlTry: totalPnlTry,
                pnlPercent: totalPnlPercent,
                closeReason: "ğŸ¯ Borsada KapatÄ±ldÄ± / Bakiye SÄ±fÄ±r",
                closedAt: new Date().toISOString(),
                closedTimestamp: Date.now(),
              }
              await appendServerHistory(closedPos)
              executedActions.push(`SATILDI_BORSADA_KAPANDI: ${pos.symbol}`)
              continue
            } else {
              executedActions.push(`SATIS_BASARISIZ: ${pos.symbol} - ${sellRes.error || "Bilinmeyen hata"}`)
            }
          } else {
            // formattedQty < minQty (Borsa bakiyesi zaten sÄ±fÄ±rlanmÄ±ÅŸ)
            const totalPnlTry = (pos.partialSold ? (pos.partialSoldPnl || 0) : 0) + currentPnlTry
            const fullAmount = (pos.amount || 0) + (pos.partialSold ? (pos.partialSoldAmount || 0) : 0)
            const initialInvested = pos.initialTotalTry || (fullAmount * pos.entryPrice)
            const totalPnlPercent = initialInvested > 0 ? (totalPnlTry / initialInvested) * 100 : pnlPercent

            const closedPos: Position = {
              ...pos,
              status: "CLOSED",
              currentPrice,
              closePrice: currentPrice,
              highestPrice,
              amount: fullAmount,
              totalTry: initialInvested,
              pnl: totalPnlTry,
              netPnlTry: totalPnlTry,
              pnlPercent: totalPnlPercent,
              closeReason: "ğŸ¯ Borsada KÃ¢rla SatÄ±ldÄ± (Bakiye TÃ¼kendi)",
              closedAt: new Date().toISOString(),
              closedTimestamp: Date.now(),
            }
            await appendServerHistory(closedPos)
            executedActions.push(`SATILDI_BAKIYE_SIFIR: ${pos.symbol}`)
            continue
          }
        } catch (sellErr: any) {
          executedActions.push(`SATIS_EXCEPTION: ${pos.symbol} - ${sellErr.message}`)
          console.error(logPrefix, "SatÄ±ÅŸ hatasÄ±:", sellErr.message)
        }
      }

      // â”€â”€ ğŸ¯ AKILLI VE RÄ°SK ANALÄ°ZLÄ° 1. KADEME KÃ‚R SATIÅI (%50 SAT, KÃ‚RI CEBE KOY) â”€â”€
      // KullanÄ±cÄ± kuralÄ±: Hedef %6-%7 hemen Ã§Ä±kmÄ±yor, %3-%4.5'lerde coin riskli mi analiz et.
      // - EÄŸer direnÃ§, RSI ÅŸiÅŸmesi veya satÄ±cÄ± baskÄ±sÄ± varsa: KÃ¢rÄ±n %50'sini HEMEN al ve nakite Ã§evir!
      // - EÄŸer momentum temiz ve direnÃ§ yoksa ("riskli deÄŸilse yardÄ±rsÄ±n"): Erken satma, tam hedefi bekle!
      if ((currentStrat?.multiStageTakeProfit ?? true) && !pos.partialSold && pnlPercent >= 2.5) {
        let isExhaustionRisk = false
        const riskReasons: string[] = []

        try {
          const [k1hRes, depthRes] = await Promise.all([
            fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1h&limit=20`, {
              signal: AbortSignal.timeout(2500),
            }),
            fetch(`https://api.binance.com/api/v3/depth?symbol=${pair}&limit=5`, {
              signal: AbortSignal.timeout(2500),
            }),
          ])

          if (k1hRes.ok) {
            const klines: any[] = await k1hRes.json()
            if (Array.isArray(klines) && klines.length >= 15) {
              const closes = klines.map((k) => parseFloat(k[4]))
              const lastK = klines[klines.length - 1]
              const openP = parseFloat(lastK[1])
              const highP = parseFloat(lastK[2])
              const lowP = parseFloat(lastK[3])
              const closeP = parseFloat(lastK[4])
              const lastVol = parseFloat(lastK[7]) || 1
              const takerBuy = parseFloat(lastK[10]) || (lastVol * 0.5)
              const takerRatio = (takerBuy / lastVol) * 100

              // 14 Periyotluk RSI
              let g = 0, l = 0
              for (let i = closes.length - 14; i < closes.length; i++) {
                const diff = closes[i] - closes[i - 1]
                if (diff >= 0) g += diff; else l -= diff
              }
              const rsi14 = 100 - (100 / (1 + (g / (l || 1))))

              // 1) RSI Aşırı Alım Doyumu (14 Periyot)
              if (rsi14 >= 67) {
                riskReasons.push(`RSI Şişmesi (${rsi14.toFixed(1)})`)
              }

              // 2) Tepeden Satıcı Fitili / İtişi (Upper Wick Rejection)
              const body = Math.abs(closeP - openP) || (closeP * 0.0005)
              const upperWick = highP - Math.max(openP, closeP)
              if (upperWick > body * 1.25 && highP > pos.entryPrice * 1.025) {
                riskReasons.push("Tepe Fitil Satışı (Üst Gölge)")
              }

              // 3) Order Flow: Taker Satıcı Baskısı (Piyasa Emri Dağıtımı)
              if (takerRatio < 46) {
                riskReasons.push(`Satıcı Baskısı (%${(100 - takerRatio).toFixed(0)})`)
              }

              // 4) Hacim Kuruması (Alıcı Gücü & Yakıt Tükenmesi)
              const recentVols = klines.slice(-6, -1).map((k: any) => parseFloat(k[7]) || 1)
              const avgVol = recentVols.reduce((a: number, b: number) => a + b, 0) / (recentVols.length || 1)
              if (lastVol < avgVol * 0.65) {
                riskReasons.push("Hacim Kuruması (Alıcı Desteği Çekildi)")
              }

              // 5) Tepe İvme Kaybı (Dönüş Mumu)
              const prevClose = closes[closes.length - 2]
              const prev2Close = closes[closes.length - 3]
              if (closeP < prevClose && prevClose > prev2Close && highP >= pos.entryPrice * 1.020) {
                riskReasons.push("Tepe İvme Kaybı (Dönüş Mumu)")
              }
            }
          }

          // 6) Canlı Emir Defteri / Tahta Derinliği (Order Book Asks vs Bids)
          if (depthRes.ok) {
            const depth = await depthRes.json()
            const topBids = depth.bids?.slice(0, 3).reduce((acc: number, b: any[]) => acc + parseFloat(b[1]), 0) || 1
            const topAsks = depth.asks?.slice(0, 3).reduce((acc: number, a: any[]) => acc + parseFloat(a[1]), 0) || 1
            if (topAsks > topBids * 1.35) {
              riskReasons.push("Tahtada Satış Duvarı")
            }
          }
        } catch {}

        // 🛡️ ÇOKLU ANALİZ KARAR MOTORU (Confluence):
        // Tek bir göstergeye ASLA bakılmaz!
        // - Kâr >= +%2.50 iken EN AZ 2 FARKLI BAĞIMSIZ GÖSTERGE risk teyidi verirse,
        // - VEYA kâr >= +%3.20 iken en az 1 risk tespit edilirse,
        // - VEYA kâr >= +%4.00 doyuma ulaştıysa:
        // HEMEN 1. KADEME SATIŞ YAPILIR (%50 kâr cebe atılır, stop +%1.0 nete kilitlenir)!
        const isMultiFactorConfirmed = riskReasons.length >= 2 || (pnlPercent >= 3.2 && riskReasons.length >= 1) || pnlPercent >= 4.0
        if (isMultiFactorConfirmed) {
          try {
            const pairTr = pos.symbol.includes("_") ? pos.symbol : `${pos.symbol.replace(/TRY$/i, "")}_TRY`
            const filters = await getSymbolFilters(pairTr)
            const stepSize = filters?.stepSize || 0.0001
            const minQty = filters?.minQty || 0.0001
            const halfAmount = pos.amount * 0.5
            const formattedHalfQty = parseFloat(formatWithStepSize(halfAmount, stepSize, filters?.basePrecision || 8))

            if (formattedHalfQty >= minQty) {
              // 🧪 DRY-RUN: kademeli satışta gerçek emir gönderilmez; sanal "FILLED"
              // yanıtı ile aşağıdaki state/kâr kilidi akışı simüle edilir.
              const sellRes = isDryRunActive
                ? ({ ok: true, sim: true, orderId: `sim-${Date.now()}`, status: "FILLED", executedQty: formattedHalfQty, cummulativeQuoteQty: formattedHalfQty * currentPrice, avgPrice: currentPrice } as any)
                : await executeBinanceTrSpotOrder({
                    symbol: pairTr,
                    side: "SELL",
                    type: "MARKET",
                    quantity: formattedHalfQty,
                    isPartial: true,
                    apiKey,
                    apiSecret,
                  })

              if (sellRes.ok) {
                const gainedTry = (formattedHalfQty * currentPrice) - (formattedHalfQty * pos.entryPrice)
                const soldTotalTry = formattedHalfQty * currentPrice
                const remainingQty = pos.amount - formattedHalfQty

                pos.partialSold = true
                pos.partialSoldAmount = formattedHalfQty
                pos.partialSoldPnl = gainedTry
                pos.partialSoldPercent = pnlPercent
                pos.partialSoldPrice = currentPrice
                pos.initialTotalTry = pos.totalTry
                pos.amount = remainingQty
                pos.totalTry = remainingQty * currentPrice
                // Kalan %50 iÃ§in Stop-Loss seviyesini hemen GÄ°RÄ°ÅÄ°N ÃœZERÄ°NE (+%1.00 KÃ‚RA) kilitle!
                pos.stopLossPrice = formatSmartPrice(pos.entryPrice * 1.010)

                const partialReason = isExhaustionRisk
                  ? `âš ï¸ [AKILLI KÃ‚R KÄ°LÄ°DÄ° - DÄ°RENÃ‡/RÄ°SK TESPÄ°TÄ°]: ${riskReasons.join(" + ")} (+%${pnlPercent.toFixed(2)})`
                  : `ğŸ’° [1. KADEME KÃ‚R SATIÅI (%50 CEBE ATILDI)]: (+%${pnlPercent.toFixed(2)})`

                await appendServerLog({
                  id: `log-partial-${Date.now()}`,
                  time: new Date().toLocaleTimeString("tr-TR"),
                  type: "SELL",
                  symbol: pos.symbol,
                  message: `${partialReason} - ${pos.symbol} varlÄ±ÄŸÄ±nÄ±n yarÄ±sÄ± (${formattedHalfQty} adet) nakite Ã§evrildi (+${gainedTry.toFixed(2)} TL kÃ¢r kasaya girdi). Kalan yarÄ±sÄ± sÄ±fÄ±r riskle tavan hedefine (${formatSmartPrice(pos.takeProfitPrice)} TL) koÅŸuyor!`,
                })

                wallet.freeTry = (wallet.freeTry || 0) + soldTotalTry
                await setServerBalance(wallet.freeTry)

                executedActions.push(`KADEMELI_SATIS_1: ${pos.symbol} (+${gainedTry.toFixed(2)} TL)`)
                notifyPartialExit(pos, gainedTry, pnlPercent, wallet.freeTry).catch(() => {})
              }
            }
          } catch (partErr: any) {
            console.error(logPrefix, "KÄ±smi satÄ±ÅŸ hatasÄ±:", partErr.message)
          }
        }
      }

      // Kapanmayan pozisyonu gÃ¼ncelle ve koru (highestPrice zirve takibi iÃ§in mutlaka kaydedilmeli)
      remainingPositions.push({
        ...pos,
        currentPrice,
        highestPrice,
        pnl: currentPnlTry,
        pnlPercent,
      })
    }

    positions = remainingPositions
    await setServerPositions(positions)

    // 6. MAKSÄ°MUM 2 SLOT MÄ°MARÄ°SÄ° (Para BoÅŸta KalmasÄ±n):
    // 6. SLOT VE GECE OTONOM BALÄ°NA AVCISI KONTROLÃœ:
    // - 3 slot doluysa: TÃ¼m slotlar dolu, pozisyonlarÄ± takip et.
    // - 2 slot doluysa VE serbest bakiye < 50 TL ise: 2 slotu takip et (3. slot iÃ§in bakiye yetersiz).
    // - 2 slot doluysa VE serbest bakiye >= 50 TL ise: "Gece Otonom Balina AvcÄ±sÄ±" devrede!
    //   Sen uyurken bile piyasada teyitli bir balina roketi veya dip sekmesi Ã§Ä±karsa serbest 50+ TL ile 3. slotu otomatik aÃ§ar!
    let freeTry = wallet.freeTry || 0
    if (executedActions.some((a) => a.startsWith("SATILDI") || a.startsWith("KADEMELI_SATIS_1"))) {
      try {
        const refreshedWallet = await getSpotAccountAssets(apiKey, apiSecret)
        if (typeof refreshedWallet.freeTry === "number") {
          freeTry = refreshedWallet.freeTry
          await setServerBalance(freeTry)
        }
      } catch (err: any) {
        console.warn(logPrefix, "Wallet refresh warning after sell:", err.message)
      }
    }

    // 6. ğŸ›¡ï¸ 2 SLOT DENGELÄ° HÄ°BRÄ°T KASA MÄ°MARÄ°SÄ° (Biri DÃ¼ÅŸerken DiÄŸeri Tutan GÃ¼venli BÃ¼yÃ¼me):
    // KullanÄ±cÄ± kuralÄ±: "tek slotta mÃ¼mkÃ¼n mertebe gitmemeye Ã§alÄ±ÅŸ; PEPE ile RAY Ã¶rneÄŸi Ã§ok iyi, biri dÃ¼ÅŸerken diÄŸeri portfÃ¶yÃ¼ tutuyor"
    // 1) Hedef: Sabit 2 Slot (Dengeli Hibrit: 1 Meme/L1 Momentum + 1 DeFi GÃ¼venli Ã‡Ä±pa).
    // 2) EÄŸer ÅŸu an 3 pozisyon aÃ§Ä±ksa (PEPE, RAY, BONK): Kendi TP/SL kurallarÄ±yla izlenir, yeni alÄ±m yapÄ±lmaz (biri kÃ¢rla kapanÄ±nca 2'ye dengelenir).
    // 3) Biri kÃ¢rla kapandÄ±ÄŸÄ±nda slot sayÄ±sÄ± 2'ye iner ve portfÃ¶y 2 dengeli slotta (%50 - %50) Ã§alÄ±ÅŸmaya devam eder.
    // 4) Pozisyonlardan biri kapandÄ±ÄŸÄ±nda serbest kalan nakitle diÄŸer sektÃ¶rden en gÃ¼Ã§lÃ¼ coin alÄ±narak 2 slot dengesi korunur.
    const slotConfig = await getServerSlotConfig()
    const targetBaseSlots = slotConfig?.targetSlots ?? 2 // VarsayÄ±lan 2 Slot (Dengeli Hibrit)
    const maxHardCap = slotConfig?.maxSlots ?? 2         // Azami 2 Slot tavanÄ±
    const maxAllowedSlots: number = Math.max(1, Math.min(3, targetBaseSlots || 2)) // Sabit 2 Slot Dengeli Kasa

    const isGlobalOnlyMode = exchangeSettings?.mode === "BINANCE_GLOBAL"
    let canBuyTr = hasTr && !isGlobalOnlyMode && snipeExchange !== "BINANCE_GLOBAL"
    let trSkipReason = isGlobalOnlyMode ? "Binance Global modu aktif: Tüm işlemler Binance Global Futures üzerinde yürütülüyor." : ""
    let trMode = isGlobalOnlyMode ? "GLOBAL_MODE" : "SCANNING"

    if (botRisk.killSwitchActive && !isSnipeMode) {
      canBuyTr = false
      trMode = "KILL_SWITCH"
      trSkipReason = `🛑 KILL SWITCH AKTİF (${botRisk.killSwitchReason || "Acil durdurma"}): Spot ve vadeli tüm YENİ alımlar kilitlendi. Açık pozisyonlar TP/SL motoruyla korunmaya devam ediyor.`
    } else if (isGlobalOnlyMode) {
      canBuyTr = false
    } else if (!isActive) {
      canBuyTr = false
      trMode = "PAUSED"
      trSkipReason = "Bot duraklatıldı: Yeni alımlar kapalı, mevcut pozisyonlar TP/SL ile güvenle korunuyor ve hedefe varınca kendi satacak."
    } else if (!hasTr) {
      canBuyTr = false
      trMode = "NO_TR_KEYS"
      trSkipReason = "Binance TR API girilmemiş (Binance Global veya izleme devrede)."
    } else if (positions.length >= 3) {
      canBuyTr = false
      trMode = "SLOT_DRAIN_MONITORING"
      trSkipReason = `Mevcut 3 pozisyon (${positions.map((p) => p.symbol).join(", ")}) hedeflerine doÄŸru 7/24 takip ediliyor. Biri kÃ¢rla kapandÄ±ÄŸÄ±nda 2 Slot Dengeli Hibrit Kasa moduna oturacak.`
    } else if (positions.length >= maxAllowedSlots) {
      canBuyTr = false
      trMode = "MAX_SLOTS_MONITORING"
      trSkipReason = `ğŸ›¡ï¸ ${maxAllowedSlots} Slot Kasa dolu (${positions.map((p) => p.symbol).join(", ")}). Pozisyonlar hedefine koÅŸuyor, 7/24 sabÄ±rla takip ediliyor.`
    } else if (freeTry < 50) {
      canBuyTr = false
      trMode = "WAITING_FUNDS"
      trSkipReason = `KullanÄ±labilir serbest TRY bakiyesi (${freeTry.toFixed(2)} TL) minimum iÅŸlem limiti (50 TL) altÄ±nda. Slot: ${positions.length}/${maxAllowedSlots}`
    } else {
      const manualSellCooldown = await isServerManualSellCooldown()
      if (manualSellCooldown.active && !isSnipeMode) {
        canBuyTr = false
        trMode = "MANUAL_SELL_COOLDOWN"
        trSkipReason = `â¸ï¸ KullanÄ±cÄ± manuel satÄ±ÅŸ yaptÄ±. KarÄ±ÅŸÄ±klÄ±ÄŸÄ± Ã¶nlemek iÃ§in bot yeni alÄ±mlara 1.5 dakika mola verdi (${manualSellCooldown.remainingSec}s kaldÄ±). Slot: ${positions.length}/2`
      } else {
        const tradeCooldown = await isServerTradeCooldown()
        if (tradeCooldown.active && !isSnipeMode) {
          canBuyTr = false
          trMode = "TRADE_COOLDOWN"
          trSkipReason = `â³ Sermaye koruma molasÄ± devrede (${tradeCooldown.remainingSec}s kaldÄ±). Stop-loss sonrasÄ± ardÄ±ÅŸÄ±k zararlarÄ± ve komisyon erimesini Ã¶nlemek iÃ§in bekleniyor. Slot: ${positions.length}/${maxAllowedSlots}`
        } else {
          // ğŸ›¡ï¸ GÃœNLÃœK DEVRE KESÄ°CÄ° (Daily Loss Circuit Breaker):
          const todayDateStr = new Date().toISOString().slice(0, 10)
          let todayRealizedPnl = 0
          try {
            const serverHistory = await getServerHistory()
            for (const h of serverHistory) {
              const closedDate = (h.closedAt || (h.closedTimestamp ? new Date(h.closedTimestamp).toISOString() : "")).slice(0, 10)
              if (closedDate === todayDateStr) {
                todayRealizedPnl += (h.netPnlTry ?? h.pnl ?? 0)
              }
            }
          } catch {}

          // Günlük zarar limiti: sabit -15 TL VEYA başlangıç kasasının %maxDailyLossPct'i (hangisi daha sıkı ise)
          const dailyLossFloorTry = Math.max(15.0, initialBalanceTry > 0 ? (initialBalanceTry * botRisk.maxDailyLossPct) / 100 : 15.0)
          if (todayRealizedPnl <= -dailyLossFloorTry && !isSnipeMode) {
            canBuyTr = false
            trMode = "DAILY_CIRCUIT_BREAKER"
            trSkipReason = `ğŸ›¡ï¸ GÃœNLÃœK DEVRE KESÄ°CÄ° DEVREDE: BugÃ¼n gerÃ§ekleÅŸen net zarar (${todayRealizedPnl.toFixed(2)} TL) gÃ¼nlÃ¼k gÃ¼venlik sÄ±nÄ±rÄ±nÄ± (-${dailyLossFloorTry.toFixed(2)} TL) aÅŸtÄ±. KasanÄ±n daha fazla erimesini Ã¶nlemek iÃ§in yeni alÄ±mlar kilitlendi. Mevcut ${positions.length} pozisyon korunuyor.`
          }
        }
      }
    }

    let globalMarketRedRatioPct = 50

    // 24s Ticker verilerini Ã§ekerek fÄ±rsat analizi yap (Binance TR filtreli)
    if (canBuyTr) {
      try {
        // Binance TR'de iÅŸlem gÃ¶ren semboller Ã¶nce Ã§ekilir (RUNE gibi olmayan coinler elenir)
        const [trSymbolRes, ticker24Res] = await Promise.allSettled([
          fetch("https://www.trbinance.com/open/v1/common/symbols", { cache: "no-store", signal: AbortSignal.timeout(5000) }),
          fetch("https://api.binance.com/api/v3/ticker/24hr", { cache: "no-store", signal: AbortSignal.timeout(5000) }),
        ])
        const trSymbols = new Set<string>()
        if (trSymbolRes.status === "fulfilled" && trSymbolRes.value.ok) {
          const trJson = await trSymbolRes.value.json()
          if (trJson?.data?.list) {
            for (const s of trJson.data.list) {
              trSymbols.add(s.symbol.replace("_", "")) // "SUI_TRY" -> "SUITRY"
            }
          }
        }
        if (ticker24Res.status === "fulfilled" && ticker24Res.value.ok) {
          const all24: any[] = await ticker24Res.value.json()

          // ğŸ©¸ 1. GENEL PÄ°YASA DUYARLILIÄI VE KAN BANYOSU ANALÄ°ZÄ°:
          let totalLikitCoins = 0
          let redLikitCoins = 0
          let btc24hChange = 0

          for (const item of all24) {
            if (item.symbol === "BTCUSDT" || item.symbol === "BTCTRY") {
              btc24hChange = parseFloat(item.priceChangePercent) || 0
            }
            if (item.symbol?.endsWith("TRY")) {
              const qv = parseFloat(item.quoteVolume) || 0
              if (qv >= 1500000) {
                totalLikitCoins++
                const chg = parseFloat(item.priceChangePercent) || 0
                if (chg < 0) redLikitCoins++
              }
            }
          }

          const redRatioPct = totalLikitCoins > 0 ? (redLikitCoins / totalLikitCoins) * 100 : 50
          globalMarketRedRatioPct = redRatioPct

          // ğŸ“‰ BTC 1 Saatlik Trendini Kontrol Et:
          let isBtcDowntrend = false
          let btc1hChange = 0
          try {
            const btcKlineRes = await fetch(
              "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=20",
              { cache: "no-store", signal: AbortSignal.timeout(3000) }
            )
            if (btcKlineRes.ok) {
              const btcKlines: any[] = await btcKlineRes.json()
              const btcCloses = btcKlines.map((k) => parseFloat(k[4]))
              const btcLastClose = btcCloses[btcCloses.length - 1]
              const btcSma20 = btcCloses.reduce((a, b) => a + b, 0) / btcCloses.length
              const btcLastOpen = parseFloat(btcKlines[btcKlines.length - 1][1]) || btcLastClose
              const btcPrev1hClose = btcCloses[btcCloses.length - 2] || btcLastClose
              btc1hChange = btcPrev1hClose > 0 ? ((btcLastClose - btcPrev1hClose) / btcPrev1hClose) * 100 : 0
              // BTC 1 saatlikte SMA20 altÄ±ndaysa VEYA 1 saatlik ani dÃ¼ÅŸÃ¼ÅŸ mumu yakÄ±yorsa:
              isBtcDowntrend = btcLastClose < btcSma20 || (btcLastClose < btcLastOpen && btc24hChange < -1.0) || btc1hChange <= -0.8
            }
          } catch {}

          // ğŸ›¡ï¸ GERÃ‡EK KAN BANYOSU & %59 AYI PÄ°YASASI KÄ°LÄ°DÄ°:
          // PiyasanÄ±n %59 veya daha fazlasÄ± kÄ±rmÄ±zÄ±yken VEYA BTC dÃ¼ÅŸÃ¼ÅŸteyken (-%1.2+ gÃ¼nlÃ¼k / -%0.5+ saatlik / SMA20 altÄ±) yeni alÄ±m tamamen kilitlenir.
          // DÃ¼ÅŸen bÄ±Ã§aÄŸÄ± tutmamak ve sermayeyi korumak iÃ§in %100 nakitte (CASH LOCK) beklenir.
          const isMarketBloodbath = redRatioPct >= 60 || (isBtcDowntrend && (btc24hChange <= -1.2 || btc1hChange <= -0.5))

          if (isMarketBloodbath && !isSnipeMode) {
            canBuyTr = false
            trMode = "BEAR_MARKET_CASH_LOCK"
            trSkipReason = `ğŸ» AYI PÄ°YASASI KORUMA KÄ°LÄ°DÄ°: PiyasanÄ±n %${Math.round(redRatioPct)}'si kÄ±rmÄ±zÄ± ve BTC satÄ±cÄ±lÄ± (${btc24hChange.toFixed(2)}%). DÃ¼ÅŸen bÄ±Ã§aÄŸÄ± tutmamak ve parayÄ± korumak iÃ§in yeni alÄ±mlar kilitlendi. Nakitte (${freeTry.toFixed(2)} TL) gÃ¼venli dip dÃ¶nÃ¼ÅŸÃ¼ bekleniyor.`
          } else {

        const candidates: Array<{
          symbol: string
          pair: string
          price: number
          high: number
          low: number
          bid: number
          change24h: number
          rangePos: number
          spreadPct: number
          quoteVolume: number
          count: number
          score: number
          isWhaleSpike?: boolean
          isMegaWhale?: boolean
          isBounceReversal?: boolean
          isMomentumBreakout?: boolean
          isPullback?: boolean
          isTier1?: boolean
          isDefi?: boolean
          isMeme?: boolean
          reason: string
        }> = []


        // 1. AÅŸama: TÃ¼m Binance TR Ã§iftlerini tara ve gÃ¼venlik/likidite Ã¶n filtresi uygula
        const preFiltered: Array<{
          sym: string
          pair: string
          price: number
          bid: number
          high: number
          low: number
          change24h: number
          quoteVolume: number
          count: number
          spreadPct: number
          rangePos: number
          isDefi: boolean
          isMeme: boolean
          isTier1: boolean
          quickScore: number
        }> = []

        for (const item of all24) {
          if (!item.symbol || !item.symbol.endsWith("TRY")) continue
          const sym = item.symbol.replace(/TRY$/, "").toUpperCase()

          // Sabit fiat paralarÄ±, nakitleri ve Ã¶ksÃ¼z coinleri ele
          if (FIAT_STABLES.has(sym) || DEAD_TOKENS.has(sym)) continue

          // SADECE Binance TR'de listeli ve iÅŸlem gÃ¶ren Ã§iftleri kabul et (RUNE vb. olmayanlar elenir)
          if (trSymbols.size > 0 && !trSymbols.has(item.symbol) && !trSymbols.has(`${sym}TRY`)) continue

          const price = parseFloat(item.lastPrice) || 0
          if (price <= 0) continue

          const high = parseFloat(item.highPrice) || price
          const low = parseFloat(item.lowPrice) || price
          const change24h = parseFloat(item.priceChangePercent) || 0
          const quoteVolume = parseFloat(item.quoteVolume) || 0
          const count = parseInt(item.count) || 0
          const bid = parseFloat(item.bidPrice) || price
          const ask = parseFloat(item.askPrice) || price

          // Likidite ve Tahta GÃ¼venliÄŸi:
          // En az 8.000.000 TL 24s hacim (Ã¶ksÃ¼z, sÄ±ÄŸ ve mikro tahtalarÄ± KESÄ°NLÄ°KLE engeller)
          if (quoteVolume < 8000000) continue

          // Makas GÃ¼venliÄŸi (AlÄ±ÅŸ-satÄ±ÅŸ makasÄ± %0.20'den dar olmalÄ±, alÄ±rken eksi baÅŸlatmaz)
          const spreadPct = bid > 0 ? ((ask - bid) / bid) * 100 : 0
          if (spreadPct > 0.20) continue

          // Aşırı çöküş / düşüşte dip avı (-25% ile +15% arası - Kırmızı piyasada dipten toplama fırsatları)
          if (change24h < -25 || change24h > 15) continue

          const rangeSpan = high - low
          const rangePos = rangeSpan > 0 ? ((price - low) / rangeSpan) * 100 : 50
          if (rangePos > 72) continue // Günün zirve %28'lik tavan fitilinde olanları ele (Tepeden alma engeli)

          // 🛑 2-3 GÜN YATAYDA SAYIKLAYACAK ÖLÜ COİNLERİ ENGELLE (Volatilite ve Canlılık Şartı):
          // Eğer bir coinin 24 saatlik fiyat oynaklığı %3.2'den azsa, bu coin hareketsizdir/uyuyordur.
          // Hareketsiz coin günlerce yerinde sayar; bu yüzden en az %3.20 günlük dinamizm şartı aranır!
          const dayVolatilityPct = low > 0 ? ((high - low) / low) * 100 : 0
          if (dayVolatilityPct < 3.2) continue

          const isDefi = DEFI_TOKENS.has(sym)
          const isMeme = MEME_TOKENS.has(sym)
          const isPopular = POPULAR_CRYPTO.has(sym)
          let quickScore = 50

          // Hacim & Likidite Ağırlığı (Hacmi yüksek olan her zaman öne geçer):
          if (quoteVolume > 20000000) quickScore += 25
          else if (quoteVolume > 8000000) quickScore += 18

          if (isMeme) quickScore += 25    // Popüler meme coinleri
          if (isPopular) quickScore += 20 // Popüler kripto / hibrit liderler
          if (isDefi) quickScore += 15    // DeFi protokolleri

          // 🌐 Sektör & Anlatı Liderliği (AI, RWA, L1):
          const spotNarrative = getNarrativeSector(sym)
          if (spotNarrative) quickScore += spotNarrative.bonus

          // Trend veya Dip Avı Puanı:
          if (change24h >= 0.5 && change24h <= 8.0) quickScore += 15
          else if (change24h < 0 && rangePos <= 35) quickScore += 25 // 🎯 DİPTEN TOPLAMA: Kırmızı piyasada günün dip tabanında olanlar öne geçer!
          if (rangePos >= 20 && rangePos <= 65) quickScore += 15

          preFiltered.push({
            sym,
            pair: item.symbol,
            price,
            bid,
            high,
            low,
            change24h,
            quoteVolume,
            count,
            spreadPct,
            rangePos,
            isDefi,
            isMeme,
            isTier1: isPopular,
            quickScore,
          })
        }

        // Binance TR'deki en yÃ¼ksek hacimli ve potansiyelli ilk 20 adayÄ± seÃ§ip derin analize al (Performans & API hÄ±z optimizasyonu)
        preFiltered.sort((a, b) => b.quickScore - a.quickScore || b.quoteVolume - a.quoteVolume)
        const topCandidates = preFiltered.slice(0, 20)

        // Derin 1 Saatlik Kline & RSI & Çok Boyutlu Balina Analizi (Paralel Hızlı Yürütme)
        await Promise.allSettled(
          topCandidates.map(async (cand) => {
            const symCd = await isSymbolInCooldown(cand.sym)
            if (symCd.active) return

            let isAboveSma20 = false
            let rsi14 = 50

            try {
              // 🌐 TEKNİK ANALİZ %100 GLOBAL COIN/USDT VERİSİYLE YAPILIR (TRY KUR VE MAKAS DALGALANMASI SİNYALİ BOZMAZ):
              const globalAnalysisPair = `${cand.sym.toUpperCase()}USDT`
              const [klineRes, kline5mRes, kline15mRes, kline4hRes] = await Promise.all([
                fetch(
                  `https://api.binance.com/api/v3/klines?symbol=${globalAnalysisPair}&interval=1h&limit=28`,
                  { cache: "no-store", signal: AbortSignal.timeout(3000) }
                ).catch(() => fetch(`https://api.binance.com/api/v3/klines?symbol=${cand.pair}&interval=1h&limit=28`, { cache: "no-store", signal: AbortSignal.timeout(3000) })),
                fetch(
                  `https://api.binance.com/api/v3/klines?symbol=${globalAnalysisPair}&interval=5m&limit=25`,
                  { cache: "no-store", signal: AbortSignal.timeout(3000) }
                ).catch(() => fetch(`https://api.binance.com/api/v3/klines?symbol=${cand.pair}&interval=5m&limit=25`, { cache: "no-store", signal: AbortSignal.timeout(3000) })),
                fetch(
                  `https://api.binance.com/api/v3/klines?symbol=${globalAnalysisPair}&interval=15m&limit=25`,
                  { cache: "no-store", signal: AbortSignal.timeout(3000) }
                ).catch(() => fetch(`https://api.binance.com/api/v3/klines?symbol=${cand.pair}&interval=15m&limit=25`, { cache: "no-store", signal: AbortSignal.timeout(3000) })),
                fetch(
                  `https://api.binance.com/api/v3/klines?symbol=${globalAnalysisPair}&interval=4h&limit=24`,
                  { cache: "no-store", signal: AbortSignal.timeout(3000) }
                ).catch(() => fetch(`https://api.binance.com/api/v3/klines?symbol=${cand.pair}&interval=4h&limit=24`, { cache: "no-store", signal: AbortSignal.timeout(3000) })),
              ])

              if (klineRes.ok) {
                const klines: any[] = await klineRes.json()
                const closes = klines.map((k) => parseFloat(k[4]))
                const lastClose = closes[closes.length - 1]
                const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20
                isAboveSma20 = lastClose >= sma20

                // â”€â”€ ğŸ›¡ï¸ 1) 5 DAKÄ°KALIK EMA 9, EMA 20 & Ã‡Ä°FT YEÅÄ°L MUM TEYÄ°DÄ° â”€â”€
                let volRatio5m = 1
                let takerBuyRatio5m = 50
                let is5mGreen = false
                let candle5mChange = 0
                let isEma5mValid = false
                let isDoubleGreen5m = false

                if (kline5mRes.ok) {
                  try {
                    const klines5m: any[] = await kline5mRes.json()
                    if (Array.isArray(klines5m) && klines5m.length >= 20) {
                      const closes5m = klines5m.map((k: any) => parseFloat(k[4]))
                      const cur5m = closes5m[closes5m.length - 1]
                      const ema9_5m = calcEmaLast(closes5m, 9)
                      const ema20_5m = calcEmaLast(closes5m, 20)
                      isEma5mValid = cur5m >= ema9_5m && cur5m >= ema20_5m

                      const last5m = klines5m[klines5m.length - 2] // 🛑 REPAINT ENGELİ: kapanmış 5m mum
                      const prev5m = klines5m[klines5m.length - 3]
                      const open5m = parseFloat(last5m[1]) || cur5m
                      const high5m = parseFloat(last5m[2]) || cur5m
                      const low5m = parseFloat(last5m[3]) || cur5m
                      const close5m = parseFloat(last5m[4]) || cur5m
                      candle5mChange = open5m > 0 ? ((close5m - open5m) / open5m) * 100 : 0
                      is5mGreen = close5m >= open5m

                      const openPrev5m = parseFloat(prev5m[1]) || close5m
                      const closePrev5m = parseFloat(prev5m[4]) || close5m
                      isDoubleGreen5m = close5m >= open5m && closePrev5m >= openPrev5m

                      // ğŸ›‘ 5m FOMO KalkanÄ±: Son 5 dakikada %0.40'tan fazla fÄ±rlamÄ±ÅŸ veya mum tepesinde koÅŸan coinleri ASLA alma!
                      if (candle5mChange > 0.40) return

                      // ğŸ›‘ 5m Tepe SatÄ±ÅŸ Fitili Engeli: Ãœst fitil gÃ¶vdeden 1.3 kat bÃ¼yÃ¼kse ASLA alma!
                      const body5m = Math.abs(close5m - open5m) || (cur5m * 0.0005)
                      const upperWick5m = high5m - Math.max(open5m, close5m)
                      if (upperWick5m > body5m * 1.3) return

                      // ğŸ‹ 5m Balina Hacmi & Taker AlÄ±cÄ± Analizi:
                      const past5mVols = klines5m.slice(0, -2).map((k: any) => parseFloat(k[7]) || 0)
                      const avg5mVol = past5mVols.length > 0 ? past5mVols.reduce((a: number, b: number) => a + b, 0) / past5mVols.length : 1
                      const recent5mVol = parseFloat(prev5m[7]) || 0
                      const recent5mTaker = parseFloat(prev5m[10]) || 0
                      volRatio5m = avg5mVol > 0 ? recent5mVol / avg5mVol : 1
                      takerBuyRatio5m = recent5mVol > 0 ? (recent5mTaker / recent5mVol) * 100 : 50
                    }
                  } catch {}
                }

                // â”€â”€ ğŸ›¡ï¸ 2) 15 DAKÄ°KALIK EMA 9, EMA 20 & Ã‡Ä°FT YEÅÄ°L MUM TEYÄ°DÄ° â”€â”€
                let isEma15mValid = false
                let isDoubleGreen15m = false
                let takerBuyRatio15m = 50

                if (kline15mRes.ok) {
                  try {
                    const klines15m: any[] = await kline15mRes.json()
                    if (Array.isArray(klines15m) && klines15m.length >= 20) {
                      const closes15m = klines15m.map((k: any) => parseFloat(k[4]))
                      const cur15m = closes15m[closes15m.length - 1]
                      const ema9_15m = calcEmaLast(closes15m, 9)
                      const ema20_15m = calcEmaLast(closes15m, 20)
                      isEma15mValid = cur15m >= ema9_15m && cur15m >= ema20_15m

                      const last15m = klines15m[klines15m.length - 2] // 🛑 REPAINT ENGELİ: kapanmış 15m mum
                      const prev15m = klines15m[klines15m.length - 3]
                      const open15m = parseFloat(last15m[1]) || cur15m
                      const close15m = parseFloat(last15m[4]) || cur15m
                      const openPrev15m = parseFloat(prev15m[1]) || close15m
                      const closePrev15m = parseFloat(prev15m[4]) || close15m
                      isDoubleGreen15m = close15m >= open15m && closePrev15m >= openPrev15m

                      const last15mVol = parseFloat(prev15m[7]) || 0
                      const last15mTaker = parseFloat(prev15m[10]) || 0
                      takerBuyRatio15m = last15mVol > 0 ? (last15mTaker / last15mVol) * 100 : 50
                    }
                  } catch {}
                }

                // â”€â”€ ğŸ›¡ï¸ KULLANICI KURALI: EMA 9 / EMA 20 VE Ã‡Ä°FT YEÅÄ°L MUM TEYÄ°DÄ° â”€â”€
                // 1) Hem 5m hem 15m'de fiyat EMA 9 ve EMA 20'nin ÃœZERÄ°NE Ã§Ä±kmÄ±ÅŸ olmalÄ±:
                if (!isEma5mValid || !isEma15mValid) return

                // 2) En az Ã¼st Ã¼ste 2 tane yeÅŸil mum yakarak alÄ±cÄ±larÄ±n tahtayÄ± ele geÃ§irdiÄŸini kanÄ±tlamalÄ±:
                if (!isDoubleGreen5m && !isDoubleGreen15m) return

                // 14 Periyotluk 1 Saatlik RSI HesaplamasÄ± (Dizi ve Veri GÃ¼venliÄŸi KontrollÃ¼)
                if (closes.length >= 15) {
                  let gains = 0
                  let losses = 0
                  const startIdx = Math.max(1, closes.length - 14)
                  for (let i = startIdx; i < closes.length; i++) {
                    const diff = closes[i] - closes[i - 1]
                    if (diff >= 0) gains += diff
                    else losses -= diff
                  }
                  const rs = losses === 0 ? 100 : gains / losses
                  rsi14 = 100 - (100 / (1 + rs))
                }

                // ğŸ”­ 4 SAATLÄ°K MAKRO ZAMAN DÄ°LÄ°MÄ° ANALÄ°ZÄ° (Swing Teyidi)
                let isAbove4hSma = false
                let rsi4h = 50
                if (kline4hRes && kline4hRes.ok) {
                  try {
                    const klines4h: any[] = await kline4hRes.json()
                    if (Array.isArray(klines4h) && klines4h.length >= 20) {
                      const closes4h = klines4h.map((k) => parseFloat(k[4]))
                      const last4h = closes4h[closes4h.length - 1]
                      const sma4h = closes4h.slice(-20).reduce((a, b) => a + b, 0) / 20
                      isAbove4hSma = last4h >= sma4h
                      if (closes4h.length >= 15) {
                        let g4 = 0, l4 = 0
                        for (let i = closes4h.length - 14; i < closes4h.length; i++) {
                          const d = closes4h[i] - closes4h[i - 1]
                          if (d >= 0) g4 += d; else l4 -= d
                        }
                        rsi4h = 100 - (100 / (1 + (g4 / (l4 || 1))))
                      }
                    }
                  } catch {}
                }

                // ğŸ‹ Ã‡OK BOYUTLU GERÃ‡EK BALÄ°NA TESPÄ°TÄ° (1 Saatlik Makro + 5 DakikalÄ±k Taze GiriÅŸ Sentezi)
                const completedKline = klines[klines.length - 2] // son tamamlanmÄ±ÅŸ mum
                const pastVols = klines.slice(0, -2).map((k) => parseFloat(k[7]) || 0) // Ã¶nceki 22 tamamlanmÄ±ÅŸ
                const avgPastVol = pastVols.length > 0 ? pastVols.reduce((a, b) => a + b, 0) / pastVols.length : 1
                const lastKline = completedKline
                const lastTryVol = parseFloat(lastKline[7]) || 0
                const lastTakerBuyVol = parseFloat(lastKline[10]) || 0
                const takerBuyRatio = lastTryVol > 0 ? (lastTakerBuyVol / lastTryVol) * 100 : 50
                const volRatio = avgPastVol > 0 ? lastTryVol / avgPastVol : 1

                // RVOL (Relative Volume): 24 saatlik ortalamaya gore anormal para girisi kontrolu
                const past24Vols = klines.slice(Math.max(0, klines.length - 26), -2).map((k) => parseFloat(k[7]) || 0)
                const dayAvgVol = past24Vols.length > 0 ? past24Vols.reduce((a, b) => a + b, 0) / past24Vols.length : avgPastVol
                const rvol1h = dayAvgVol > 0 ? lastTryVol / dayAvgVol : volRatio

                // Hacimsiz olu piyasa engeli: RVOL zayifsa ve 5m'de taze hacim yoksa sahte yukselistir, atla!
                if (rvol1h < 1.10 && volRatio5m < 1.40) return

                // â”€â”€ ğŸ›¡ï¸ KULLANICI KURALI: TAKER BUY (PÄ°YASA ALICI) ORANI EN AZ %52 ZORUNLU! â”€â”€
                const maxTakerBuy = Math.max(takerBuyRatio, takerBuyRatio5m, takerBuyRatio15m)
                if (maxTakerBuy < 52) return

                // Mum YapÄ±sÄ± & Alt Fitil (Ã‡ekiÃ§ / Rejection Wick) Analizi:
                const klineOpen = parseFloat(lastKline[1]) || 0
                const klineHigh = parseFloat(lastKline[2]) || lastClose
                const klineLow = parseFloat(lastKline[3]) || lastClose
                const klineClose = parseFloat(lastKline[4]) || 0
                const isGreenCandle = klineClose >= klineOpen
                const candleMin = Math.min(klineOpen, klineClose)
                const lowerWick = candleMin - klineLow
                const candleBody = Math.abs(klineClose - klineOpen) || (lastClose * 0.001)
                const isHammerReversal = lowerWick >= candleBody * 0.70 // Dipten gÃ¼Ã§lÃ¼ alÄ±cÄ± tepkisi / Ã§ekiÃ§ fitili

                // â”€â”€ ğŸ›¡ï¸ 2) 1 SAATLÄ°K BOLLINGER BANDI KONTROLÃœ (Tepe ÅiÅŸmesi Engeli) â”€â”€
                let bollingerPctB = 0.5
                if (closes.length >= 20) {
                  const mean = sma20
                  const variance = closes.slice(-20).reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / 20
                  const stdDev = Math.sqrt(variance)
                  const upperBand = mean + 2 * stdDev
                  const lowerBand = mean - 2 * stdDev
                  bollingerPctB = (upperBand - lowerBand) > 0 ? (lastClose - lowerBand) / (upperBand - lowerBand) : 0.5
                }

                // â”€â”€ ğŸ›¡ï¸ 3) 1 SAATLÄ°K TEPE FITÄ°LÄ° (Rejection Wick) KONTROLÃœ â”€â”€
                const upperWick1h = klineHigh - Math.max(klineOpen, klineClose)

                let isWhaleSpike = false
                let isMegaWhale = false
                let isBounceReversal = false

                // 5m ve 1h Balina Tespiti:
                const isWhale5m = volRatio5m >= 1.60 && is5mGreen && takerBuyRatio5m >= 54
                const isMegaWhale5m = volRatio5m >= 2.20 && is5mGreen && takerBuyRatio5m >= 56 && cand.quoteVolume >= 2500000

                // 1) ğŸš€ Mega Balina GiriÅŸi: En az 1.8x hacim (veya 5m'de 2.2x), YEÅÄ°L mum, Taker AlÄ±cÄ± >= %53 ve toplam tahta hacmi >= 2.5M TL
                if (((rvol1h >= 1.8 || volRatio >= 1.8) && isGreenCandle && takerBuyRatio >= 53 && cand.quoteVolume >= 2500000) || isMegaWhale5m) {
                  isMegaWhale = true
                  isWhaleSpike = true
                }
                // 2) ğŸ‹ Teyitli Balina GiriÅŸi: En az 1.35x hacim (veya 5m'de 1.6x), YEÅÄ°L mum ve Taker AlÄ±cÄ± >= %52
                else if (((rvol1h >= 1.35 || volRatio >= 1.35) && isGreenCandle && takerBuyRatio >= 52) || isWhale5m) {
                  isWhaleSpike = true
                }

                // 3) ğŸ¯ V-REVERSAL / AÅIRI SATIÅ DÄ°P SEKMESÄ° (Piyasa Ã‡Ã¶ktÃ¼ÄŸÃ¼nde / Sert DÃ¼ÅŸtÃ¼ÄŸÃ¼nde Dipten Yakalama YeteneÄŸi!):
                // Åartlar: GerÃ§ek RSI <= 36 (aÅŸÄ±rÄ± ucuzlamÄ±ÅŸ), gÃ¼nÃ¼n dip bÃ¶lgesinde (rangePos <= 40), ve (Ã‡ekiÃ§ fitili VEYA Taker AlÄ±cÄ± >= %49 VEYA yeÅŸil toparlanma)
                if (rsi14 <= 36 && cand.rangePos <= 40 && (isHammerReversal || takerBuyRatio >= 49 || isGreenCandle)) {
                  isBounceReversal = true
                }

                // â”€â”€ ğŸ›¡ï¸ OTOMASYON 2 KURAL 1: AÅIRI ALIM (RSI >= 68) TEPE RÄ°SKÄ° ENGELÄ° â”€â”€
                // ÅiÅŸmiÅŸ RSI (>= 68) olan coinleri ASLA alma! (Tepe alÄ±mÄ± / FOMO engeli)
                if (rsi14 >= 68) return

                // â”€â”€ ğŸ›¡ï¸ BOLLINGER ÃœST BANT ÅÄ°ÅMESÄ° ENGELÄ° (%B > 0.90 ise tepededir, alma!) â”€â”€
                if (bollingerPctB > 0.90) return

                // â”€â”€ ğŸ›¡ï¸ 1 SAATLÄ°K TEPE SATICI BASKISI ENGELÄ° (Ãœst fitil gÃ¶vdeden 1.5 kat bÃ¼yÃ¼kse alma!) â”€â”€
                if (upperWick1h > candleBody * 1.5) return

                // â”€â”€ ğŸ›¡ï¸ OTOMASYON 2 KURAL 6: 1 SAATLÄ°K BÃœYÃœK RESÄ°M & AYI TUZAÄI ENGELÄ° â”€â”€
                // 1 saatlik grafikte dÃ¼ÅŸÃ¼ÅŸ trendinde olan veya kÄ±rmÄ±zÄ±ya basan coinler KESÄ°NLÄ°KLE ALINMAZ!
                const prev1hClose = closes[closes.length - 2] || lastClose
                const is1hBullish = (lastClose >= sma20 * 0.995) || (cand.change24h >= 0.5 && lastClose >= sma20 * 0.988)
                if (!is1hBullish && !isBounceReversal) return

                // â”€â”€ ğŸ›¡ï¸ OTOMASYON 2 MACD TEYÄ°DÄ° (Pozitif Momentum ÅartÄ±) â”€â”€
                let isMacdPositive = true
                if (closes.length >= 26) {
                  const k12 = 2 / (12 + 1)
                  const k26 = 2 / (26 + 1)
                  let ema12 = closes[0]
                  let ema26 = closes[0]
                  for (let i = 1; i < closes.length; i++) {
                    ema12 = closes[i] * k12 + ema12 * (1 - k12)
                    ema26 = closes[i] * k26 + ema26 * (1 - k26)
                  }
                  isMacdPositive = ema12 >= ema26
                }
                if (!isMacdPositive && !isBounceReversal) return

                // âš ï¸ PUMP TEPESÄ° ENGELÄ°: Son 1 saatlik mumda aÅŸÄ±rÄ± fÄ±rlamÄ±ÅŸ (+%2.8 Ã¼zeri dikey fitil) mumlarÄ±n tepesinden alma!
                const lastCandleGain = prev1hClose > 0 ? ((lastClose - prev1hClose) / prev1hClose) * 100 : 0
                if (lastCandleGain > 2.8) return

                let score = cand.quickScore
                const reasons: string[] = []

                if (cand.isTier1) reasons.push("ğŸ’ Tier-1 SÃ¼per Likit")
                if (cand.isDefi) reasons.push("ğŸŒ DeFi ProtokolÃ¼")
                if (cand.isMeme) {
                  score += 25
                  reasons.push("ğŸ­ PopÃ¼ler Meme Coini")
                }

                // ğŸ”­ 4 SAATLÄ°K MAKRO ZAMAN DÄ°LÄ°MÄ° DESTEÄÄ°:
                if (isAbove4hSma && rsi4h >= 48 && rsi4h <= 68) {
                  score += 35
                  reasons.push(`ğŸ”­ 4S Makro BoÄŸa Trendi (RSI ${rsi4h.toFixed(1)})`)
                } else if (!isAbove4hSma && rsi4h < 48) {
                  score -= 30 // 4 saatlikte dÃ¼ÅŸÃ¼ÅŸ trendinde olan coinlere ceza
                }
                
                let isMomentumBreakout = false

                // ğŸ‹ Ã‡ok Boyutlu Balina PuanÄ±:
                if (isMegaWhale) {
                  score += 55
                  reasons.push(`ğŸš€ Mega Balina Roketi (${volRatio.toFixed(1)}x Hacim + %${takerBuyRatio.toFixed(0)} AlÄ±cÄ± + YeÅŸil Mum)`)
                } else if (isWhaleSpike) {
                  score += 42
                  reasons.push(`ğŸ‹ Teyitli Balina GiriÅŸi (${volRatio.toFixed(1)}x Hacim + %${takerBuyRatio.toFixed(0)} AlÄ±cÄ± + YeÅŸil Mum)`)
                } else if (volRatio >= 1.25 && isGreenCandle && takerBuyRatio >= 51) {
                  score += 15
                  reasons.push(`ğŸ“Š ${volRatio.toFixed(1)}x YeÅŸil AlÄ±cÄ± Hacmi`)
                }

                // ğŸ¯ V-REVERSAL DÄ°P SEKMESÄ° PUANI:
                if (isBounceReversal) {
                  score += 50
                  reasons.push(`ğŸ¯ V-Reversal Dip Sekmesi (RSI ${rsi14.toFixed(1)} + ${isHammerReversal ? "Ã‡ekiÃ§ Fitili" : "AlÄ±cÄ± Absorpsiyonu"})`)
                }

                // ğŸš€ GERÃ‡EK BOÄA MOMENTUM KIRILIMI & TREND DEVAMI:
                // Åartlar: HO20 trendi civarÄ±/Ã¼zeri + RSI 48-68 + Piyasa AlÄ±cÄ±sÄ± Taker >= %48
                if ((isAboveSma20 || cand.change24h >= 0.5) && rsi14 >= 48 && rsi14 <= 68 && takerBuyRatio >= 48) {
                  isMomentumBreakout = true
                  score += 45
                  reasons.push(`ğŸš€ BoÄŸa Trendi (RSI ${rsi14.toFixed(1)} + %${takerBuyRatio.toFixed(0)} AlÄ±cÄ±)`)
                }

                // â”€â”€ ğŸ¯ OTOMASYON 2 EFSANE DÃœZELTME / DIP PULLBACK MOTORU â”€â”€
                // KoÅŸan yeÅŸil tepeyi DEÄÄ°L, 24 saatlikte yÃ¼kselen coinin 5 dakikalÄ±k grafikteki kÄ±rmÄ±zÄ±/soÄŸuma anÄ±nÄ± yakala!
                let isPullback = false
                if (
                  is1hBullish &&
                  cand.change24h >= 0.8 && cand.change24h <= 10.0 &&
                  rsi14 >= 35 && rsi14 <= 55 &&
                  candle5mChange <= 0.10 &&
                  bollingerPctB <= 0.55 &&
                  takerBuyRatio >= 48
                ) {
                  isPullback = true
                  score += 55
                  reasons.push(`ğŸ“ˆ Trend Ä°Ã§i DÃ¼zeltme (RSI ${rsi14.toFixed(1)} + KÄ±rmÄ±zÄ± Mumda Dip AlÄ±mÄ±)`)
                }

                if (cand.quoteVolume > 10000000) reasons.push("YÃ¼ksek Likidite")

                candidates.push({
                  symbol: cand.sym,
                  pair: cand.pair,
                  price: cand.price,
                  high: cand.high,
                  low: cand.low,
                  bid: cand.bid,
                  change24h: cand.change24h,
                  rangePos: Math.round(cand.rangePos),
                  spreadPct: Number(cand.spreadPct.toFixed(3)),
                  quoteVolume: Math.round(cand.quoteVolume),
                  count: cand.count,
                  score,
                  isWhaleSpike,
                  isMegaWhale,
                  isBounceReversal,
                  isMomentumBreakout,
                  isPullback,
                  isTier1: cand.isTier1,
                  isDefi: cand.isDefi,
                  isMeme: cand.isMeme,
                  reason: reasons.join(" + ") || "Piyasa Analizi",
                })
              }
            } catch {}
          })
        )

        // PuanÄ± en yÃ¼ksek saÄŸlam adaylarÄ± seÃ§
        candidates.sort((a, b) => b.score - a.score || b.quoteVolume - a.quoteVolume)

        // ğŸ›¡ï¸ SIKI KALÄ°TE VE TETÄ°KLEYÄ°CÄ° FÄ°LTRESÄ°:
        // ASLA VE ASLA SÄ°NYALSÄ°Z COÄ°N ALINMAZ!
        // Sadece ve sadece ÅŸu somut piyasa itiÅŸ gÃ¼Ã§lerinden biri olmalÄ±:
        // 1) Balina GiriÅŸi (isWhaleSpike || isMegaWhale)
        // 2) Teyitli BoÄŸa Momentumu (isMomentumBreakout)
        // 3) OnaylanmÄ±ÅŸ Dip Sekmesi (isBounceReversal)
        // 4) Trend Ä°Ã§i SoÄŸuma / Pullback (isPullback)
        const qualifiedCandidates = candidates.filter((c) => {
          const hasConcreteTrigger = c.isWhaleSpike || c.isMegaWhale || c.isBounceReversal || c.isPullback || c.isMomentumBreakout
          if (!hasConcreteTrigger) return false
          // Sadece A+ kalite sinyalleri kabul et (Uyuyan veya vasat coinler ASLA alÄ±nmaz):
          const minScore = positions.length === 1 ? 115 : 95
          if (c.score < minScore) return false
          if (c.spreadPct > 0.18) return false // Makas %0.18'i geÃ§erse alÄ±rken eksi baÅŸlatÄ±r, KESÄ°NLÄ°KLE ALMA!
          return c.quoteVolume >= 8000000 // Minimum 8 Milyon TL hacim ÅŸartÄ± (Ã–lÃ¼ tahta engeli)
        })

        // ğŸ§  MÄ°MARÄ°DEKÄ° TÃœM ANALÄ°Z MOTORUNU DEVREYE SOK:
        // 5 Zaman Dilimi (1m + 5m + 1h + 1w + 1M) Ã‡oklu Trend & Yapay Zeka (AI) Karar Sentezi (En iyi 4 adayÄ± derin incele)
        const mtfRejected = new Set<string>()
        await Promise.allSettled(
          qualifiedCandidates.slice(0, 4).map(async (cand) => {
            try {
              const mtf = await getMultiTimeframeAnalysis({
                symbol: cand.symbol,
                name: cand.symbol,
                binance: cand.pair,
                quoteVolume24h: cand.quoteVolume,
                high24h: cand.high,
                low24h: cand.low,
                currentPrice: cand.price,
              })
              if (mtf) {
                if (mtf.aiVerdict === "GÜÇLÜ AL") {
                  cand.score += 60
                  cand.reason += ` + ğŸ§  5Z-AI: GÜÇLÜ AL (${mtf.overallScore}/100)`
                } else if (mtf.aiVerdict === "AL") {
                  cand.score += 35
                  cand.reason += ` + ğŸ§  5Z-AI: AL (${mtf.overallScore}/100)`
                } else if (mtf.aiVerdict === "SAT" || mtf.aiVerdict === "GÜÇLÜ SAT") {
                  cand.score -= 85 // 5 zaman diliminde makro yÃ¶nÃ¼ aÅŸaÄŸÄ± olan coini doÄŸrudan ele
                  mtfRejected.add(cand.symbol)
                } else if (mtf.aiVerdict === "TUT") {
                  // TUT kararÄ± alan coinler yÃ¶nsÃ¼zdÃ¼r ve gÃ¼nlerce bekletebilir; patlama onayÄ± olanlarÄ±n gerisine it
                  cand.score -= 30
                  cand.reason += ` + âš ï¸ 5Z-AI: NÖTR/BEKLE`
                }
              }
            } catch {}
          })
        )

        // ğŸŒ HÄ°BRÄ°T PORTFÃ–Y Ã–NCELÄ°KLENDÄ°RMESÄ°:
        // EÄŸer 1. slotta Kripto/Meme varsa, 2. slot iÃ§in DeFi adaylarÄ±na Ã¶ncelik verilir!
        // EÄŸer 1. slotta DeFi varsa, 2. slot iÃ§in Kripto/Meme adaylarÄ±na Ã¶ncelik verilir!
        const existingHasDefi = positions.some(p => DEFI_TOKENS.has(p.symbol))
        const existingHasCrypto = positions.some(p => !DEFI_TOKENS.has(p.symbol))

        qualifiedCandidates.sort((a, b) => {
          let scoreA = a.score
          let scoreB = b.score
          if (MEME_TOKENS.has(a.symbol)) scoreA += 15
          if (MEME_TOKENS.has(b.symbol)) scoreB += 15
          // 🌐 Hibrit portföy dengesi: Mevcut slotta DeFi varsa Kripto/Meme'e öncelik, Kripto/Meme varsa DeFi'ye öncelik
          if (existingHasDefi && !DEFI_TOKENS.has(a.symbol)) scoreA += 20
          if (existingHasDefi && !DEFI_TOKENS.has(b.symbol)) scoreB += 20
          if (existingHasCrypto && DEFI_TOKENS.has(a.symbol)) scoreA += 20
          if (existingHasCrypto && DEFI_TOKENS.has(b.symbol)) scoreB += 20
          return scoreB - scoreA || b.quoteVolume - a.quoteVolume
        })

        if (qualifiedCandidates.length === 0) {
          trMode = isSnipeMode ? "SNIPE_NO_OPPORTUNITY" : "HUNTING_OPPORTUNITIES"
          trSkipReason = isSnipeMode
            ? "âš ï¸ Åu an piyasada teyitli bir balina giriÅŸi veya dip sekmesi fÄ±rsatÄ± bulunamadÄ±. KasanÄ±zÄ± riske atmamak iÃ§in beklemede kalÄ±ndÄ±."
            : `${positions.length} slot aktif. Serbest ${freeTry.toFixed(2)} TL ile yeni slot fÄ±rsatlarÄ± 7/24 taranÄ±yorâ€¦`
          if (isSnipeMode && !snipeResult && snipeExchange !== "BINANCE_GLOBAL" && !isGlobalOnlyMode) {
            snipeResult = { ok: false, message: trSkipReason }
          }
        }

        for (const candidate of qualifiedCandidates) {
          // 5 zaman dilimli AI analizi SAT/GÜÇLÜ SAT verdiyse bu coini KESÄ°NLÄ°KLE alma
          if (mtfRejected.has(candidate.symbol)) continue
          // Mevcut aÃ§Ä±k pozisyonlarda bu coin varsa tekrar alma (aynÄ± coinden Ã§ift slot aÃ§ma!)
          if (positions.some((p) => p.symbol === candidate.symbol)) continue
          // Bekleyen limit emirlerinde bu coin varsa tekrar alma
          if (remainingPendingOrders.some((po) => po.symbol === candidate.symbol)) continue
          // Slot doluluÄŸu (aÃ§Ä±k pozisyonlar + bekleyen TR limit emirleri) ve bakiye kontrolÃ¼:
          // Pozisyonlar hedefe (TP) koÅŸarken sabÄ±rla korunur; zÄ±rt pÄ±rt satÄ±p tahta makasÄ± ve komisyon Ã¶denmez!
          const trPendingCount = remainingPendingOrders.filter((po) => po.exchange === "BINANCE_TR").length
          if (positions.length + trPendingCount >= maxAllowedSlots || freeTry < 50) {
            break
          }

          // âš–ï¸ SERMAYE YÃ–NETÄ°MÄ°: Kasa 2 slota paylaÅŸtÄ±rÄ±lÄ±r, kasada aÃ§Ä±kta/boÅŸta para bÄ±rakÄ±lmaz
          const currentPositionsValue = positions.reduce((sum, p) => sum + (p.totalTry || 0), 0)
          const totalTradingEquity = freeTry + currentPositionsValue
          const targetSlotBudget = Math.floor(totalTradingEquity / maxAllowedSlots)

          // AlÄ±m tutarÄ±: Ä°leri GÃ¶rÃ¼ÅŸlÃ¼lÃ¼k & YÃ¼ksek Sermaye YÃ¶netimi:
          // Slot sayÄ±sÄ± en fazla 1 veya 2 tutulur.
          // EÄŸer tek baÅŸÄ±na tavan potansiyeli yÃ¼ksek, 5 zaman dilimli GÜÇLÜ AL / Mega Balina adayÄ± varsa (YÃ¼ksek GÃ¼ven):
          // Kasa kÃ¼Ã§Ã¼k parÃ§alara bÃ¶lÃ¼nmez, sermayenin %70-75'i ile tek yÃ¼ksek hacimli lider pozisyon aÃ§Ä±lÄ±r!
          // Standart fÄ±rsatlarda ise 2 dengeli slota (%50 - %50) paylaÅŸtÄ±rÄ±lÄ±r.
          let buyAmountTry = targetSlotBudget
          if (maxAllowedSlots === 1) {
            // ğŸ¯ TEK SLOT (FULL BÄ°LEÅÄ°K): KasanÄ±n %96'sÄ± ile tek gÃ¼Ã§lÃ¼ lider pozisyona odaklan
            buyAmountTry = Math.floor(freeTry * 0.96)
          } else if (positions.length === maxAllowedSlots - 1) {
            // ğŸ›¡ï¸ 2. Slot (Son Slot): Kasada kalan serbest bakiyenin tamamÄ±nÄ± kullan
            buyAmountTry = Math.floor(freeTry * 0.96)
          } else if (positions.length === 0) {
            // 2 Slot modunda ilk iÅŸlem: KasayÄ± dengeli %50 paylaÅŸtÄ±r
            buyAmountTry = Math.min(targetSlotBudget, Math.floor(freeTry * 0.50))
          } else {
            buyAmountTry = Math.min(targetSlotBudget, Math.floor(freeTry * 0.95))
          }

          // GÃ¼venlik sÄ±nÄ±rlarÄ±: Maksimum tek iÅŸlemde 10.000 TL
          buyAmountTry = Math.min(buyAmountTry, 10000)

          // EÄŸer serbest TRY >= 50 ama hesaplanan miktar 50 TL'nin altÄ±ndaysa 50 TL'ye eÅŸitle:
          if (freeTry >= 50 && buyAmountTry < 50) {
            buyAmountTry = Math.min(50, Math.floor(freeTry))
          }
          if (buyAmountTry < 50) break

          const trPair = `${candidate.symbol}_TRY`

          // ğŸ¯ LÄ°MÄ°T EMÄ°RLE PUSU (BEST BID - SIFIR SLIPPAGE):
          // AlÄ±m emri tahtanÄ±n en iyi alÄ±ÅŸÄ±na (Best Bid) Limit olarak atÄ±lÄ±r.
          // Fiyat kaÃ§arsa kaÃ§sÄ±n, asla tepeden ya da piyasadan pahalÄ±ya kovalanmaz!
          let limitPrice = candidate.bid || candidate.price
          try {
            const depthRes = await fetch(`https://api.binance.com/api/v3/depth?symbol=${candidate.pair}&limit=5`, {
              cache: "no-store",
              signal: AbortSignal.timeout(2000),
            })
            if (depthRes.ok) {
              const depth = await depthRes.json()
              const bestBid = parseFloat(depth.bids[0]?.[0]) || 0
              const bestAsk = parseFloat(depth.asks[0]?.[0]) || 0
              if (bestBid > 0) limitPrice = bestBid
              if (bestBid > 0 && bestAsk > 0) {
                const liveSpreadPct = ((bestAsk - bestBid) / bestBid) * 100
                if (liveSpreadPct > 0.20) {
                  console.warn(logPrefix, `${candidate.symbol} anlÄ±k makas aÃ§Ä±k (%${liveSpreadPct.toFixed(2)}), ekside baÅŸlamamak iÃ§in pas geÃ§ildi.`)
                  continue
                }
                const topBidsVol = depth.bids.slice(0, 3).reduce((acc: number, b: any[]) => acc + parseFloat(b[1]), 0)
                const topAsksVol = depth.asks.slice(0, 3).reduce((acc: number, a: any[]) => acc + parseFloat(a[1]), 0)
                if (topAsksVol > topBidsVol * 1.35) {
                  console.warn(logPrefix, `${candidate.symbol} tahtada satÄ±ÅŸ duvarÄ± var (Asks/Bids: ${(topAsksVol / topBidsVol).toFixed(1)}x), pas geÃ§ildi.`)
                  continue
                }
              }
            }
          } catch {}

          const trFilters = await getSymbolFilters(trPair)
          const stepSize = trFilters?.stepSize || 0.001
          const tickSize = trFilters?.tickSize || 0.01
          const basePrecision = trFilters?.basePrecision || 3
          const quotePrecision = trFilters?.quotePrecision || 4

          const formattedLimitPrice = formatWithTickSize(limitPrice, tickSize, quotePrecision)
          const targetQty = buyAmountTry / parseFloat(formattedLimitPrice)
          const formattedQty = formatWithStepSize(targetQty, stepSize, basePrecision)

          if (parseFloat(formattedQty) < (trFilters?.minQty || 0.001)) {
            continue
          }

          // ğŸ¯ BEST BID LÄ°MÄ°T ALIM EMRÄ°:
          // 🧪 DRY-RUN SERT KİLİT: gerçek spot alım emri GÖNDERİLMEZ.
          if (isDryRunActive) {
            const simSpotTrade = {
              symbol: candidate.symbol,
              pair: trPair,
              side: "BUY" as const,
              price: parseFloat(formattedLimitPrice),
              quantity: parseFloat(formattedQty),
              costTry: buyAmountTry,
              reason: `🧪 DRY_RUN SIM SPOT LIMIT ALIM (${candidate.symbol})`,
              createdAt: Date.now(),
              market: "BINANCE_TR_SPOT",
            }
            console.log(logPrefix, `🧪 [DRY_RUN AKTİF] Gerçek spot emri gönderilmedi! Simüle Limit Alım: ${trPair} | Fiyat: ${formattedLimitPrice} | Adet: ${formattedQty} | Tutar: ${buyAmountTry.toFixed(2)} TL`)
            await appendDryRunTradeToRedis(simSpotTrade).catch(() => {})
            await appendServerLog({
              id: `log-sim-buy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              time: new Date().toLocaleTimeString("tr-TR"),
              type: "BUY",
              symbol: candidate.symbol,
              message: `🧪 [DRY_RUN SİMÜLE SPOT ALIM] ${trPair} | Fiyat: ${formattedLimitPrice} | Tutar: ${buyAmountTry.toFixed(2)} TL (gerçek emir YOK)`,
            }).catch(() => {})
            executedActions.push(`DRY_RUN_SPOT_ENTRY: ${candidate.symbol}`)
            continue
          }

          const buyRes = await executeBinanceTrSpotOrder({
            symbol: trPair,
            side: "BUY",
            type: "LIMIT",
            price: parseFloat(formattedLimitPrice),
            quantity: parseFloat(formattedQty),
            apiKey,
            apiSecret,
          })

          if (buyRes.ok) {
            const executedQty = buyRes.executedQty || 0
            const avgPrice = parseFloat(formattedLimitPrice)
            const actualCost = buyRes.cummulativeQuoteQty || (avgPrice * (executedQty || parseFloat(formattedQty)))
            const cleanSym = candidate.symbol

            // Coine ve GiriÅŸ TÃ¼rÃ¼ne Ã–zel AkÄ±llÄ± Swing KÃ¢r Hedefleri (%5.0 - %8.5+):
            // - Mega Balina / Tavan PatlamasÄ±: +%8.50
            // - Teyitli Balina / GÃ¼Ã§lÃ¼ KÄ±rÄ±lÄ±m: +%7.00
            // - Meme / HÄ±zlÄ± KoÅŸucu (PENGU, PEPE vb.): +%6.50
            // - DeFi ProtokolÃ¼ (AAVE, UNI, PENDLE vb.): +%6.00
            // - Dip Sekmesi (Bounce): +%5.00
            // - Major: +%4.50
            const isCandMajor = ["BTC", "ETH", "BNB"].includes(cleanSym.toUpperCase())
            const isCandMeme = ["DOGE", "PEPE", "SHIB", "BONK", "FLOKI", "WIF", "NEIRO", "TURBO", "PENGU"].includes(cleanSym.toUpperCase())
            let tpRatio = candidate.isMegaWhale
              ? 0.0850 // +%8.50 Mega Balina
              : candidate.isWhaleSpike
              ? 0.0700 // +%7.00 Teyitli Balina
              : isCandMeme
              ? 0.0650 // +%6.50 HÄ±zlÄ± KoÅŸucu
              : candidate.isDefi
              ? 0.0600 // +%6.00 DeFi ProtokolÃ¼
              : candidate.isBounceReversal
              ? 0.0500 // +%5.00 Dip Sekmesi
              : 0.0450 // +%4.50 Standart
            const slRatio = 0.035 // -%3.50 geniÅŸ swing stop (piyasa gÃ¼rÃ¼ltÃ¼sÃ¼nde erken patlamaz)
            const calculatedTp = formatSmartPrice(avgPrice * (1 + tpRatio))
            const calculatedSl = formatSmartPrice(avgPrice * (1 - slRatio))

            if (buyRes.status === "NEW" || executedQty <= 0) {
              // â³ EMÄ°R TAHTAYA YAZILDI (LÄ°MÄ°T PUSU - HENÃœZ DOLMADI)
              const pendingOrder: PendingLimitOrder = {
                id: buyRes.orderId || Date.now(),
                symbol: cleanSym,
                pair: trPair,
                side: "BUY",
                price: avgPrice,
                quantity: parseFloat(formattedQty),
                costTryOrUsdt: buyAmountTry,
                createdAt: Date.now(),
                exchange: "BINANCE_TR",
                orderId: buyRes.orderId,
                tpPrice: calculatedTp,
                slPrice: calculatedSl,
                tpRatio,
                slRatio,
                reason: candidate.reason,
                isWhale: candidate.isWhaleSpike,
                isMegaWhale: candidate.isMegaWhale,
                isBounce: candidate.isBounceReversal,
              }
              await addPendingLimitOrder(pendingOrder)
              remainingPendingOrders.push(pendingOrder)

              const pendingLog: TradeLog = {
                id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                time: new Date().toLocaleTimeString("tr-TR"),
                type: "BUY",
                symbol: cleanSym,
                message: `â³ [LÄ°MÄ°T PUSU KURULDU] ${cleanSym} iÃ§in Best Bid (${avgPrice.toFixed(4)} TL) seviyesinden limit alÄ±m emri tahtaya yazÄ±ldÄ± (SipariÅŸ ID: ${buyRes.orderId || "-"}). SÄ±fÄ±r slippage, tahta makasÄ± Ã¶denmedi. 60 saniyede dolmazsa otomatik iptal edilecek. AkÄ±llÄ± TP: +%${(tpRatio * 100).toFixed(2)} (${calculatedTp} TL), SL: -%${(slRatio * 100).toFixed(1)} (${calculatedSl} TL).`,
              }
              await appendServerLog(pendingLog)
              executedActions.push(`LÄ°MÄ°T_PUSU_ATILDI: ${cleanSym} (${avgPrice.toFixed(4)} TL)`)
              break
            } else {
              // ğŸŸ¢ ANINDA DOLDU (FILLED)
              const newPosition: Position = {
                id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                symbol: cleanSym,
                name: `${cleanSym} / TRY`,
                side: "BUY",
                entryPrice: avgPrice,
                currentPrice: avgPrice,
                highestPrice: avgPrice,
                amount: executedQty,
                totalTry: actualCost,
                initialTotalTry: actualCost,
                takeProfitPrice: calculatedTp,
                stopLossPrice: calculatedSl,
                pnl: 0,
                pnlPercent: 0,
                openedAt: new Date().toISOString(),
                openedTimestamp: Date.now(),
                status: "OPEN",
                triggerType: "AI_SUGGESTION",
                orderType: "LIMIT",
                orderId: buyRes.orderId,
                isRealOrder: true,
                isWhale: candidate.isWhaleSpike,
                isMegaWhale: candidate.isMegaWhale,
                isBounce: candidate.isBounceReversal,
              }

              const updatedPositions = [...positions, newPosition]
              await setServerPositions(updatedPositions)

              const slotNumber = updatedPositions.length
              const buyLog: TradeLog = {
                id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                time: new Date().toLocaleTimeString("tr-TR"),
                type: "BUY",
                symbol: cleanSym,
                message: `ğŸŸ¢ [${slotNumber}. SLOT LÄ°MÄ°T PUSU ANINDA DOLDU] ${cleanSym} ${actualCost.toFixed(2)} TL tutarÄ±nda Best Bid fiyatÄ±ndan (${avgPrice.toFixed(4)} TL) Limit emri doldu. SÄ±fÄ±r slippage, tahta makasÄ± Ã¶denmedi. AkÄ±llÄ± TP: +%${(tpRatio * 100).toFixed(2)} (${calculatedTp} TL), SL: -%${(slRatio * 100).toFixed(1)} (${calculatedSl} TL). Analiz: ${candidate.reason}`,
              }
              await appendServerLog(buyLog)
              executedActions.push(`ALINDI_SLOT_${slotNumber}: ${cleanSym} (${actualCost.toFixed(2)} TL)`)
              notifyTradeEntry(newPosition, candidate.reason).catch(() => {})
              // Snipe modunda baÅŸarÄ±lÄ± alÄ±m sonucunu dÃ¶n
              snipeResult = {
                ok: true,
                symbol: cleanSym,
                amount: executedQty,
                price: avgPrice,
                totalTry: actualCost,
                tpPrice: calculatedTp,
                slPrice: calculatedSl,
                tpPct: tpRatio * 100,
                reason: candidate.reason,
              }
              break // BaÅŸarÄ±lÄ± alÄ±m yapÄ±ldÄ±, dÃ¶ngÃ¼yÃ¼ bitir
            }
          } else {
            console.warn(logPrefix, `Order failed for ${candidate.symbol}:`, buyRes.error)
            executedActions.push(`ALIM_DENENDI_HATALI: ${candidate.symbol} (${buyRes.error || "Hata"})`)
          }
        }
          }
        }
      } catch (scanErr: any) {
        console.warn(logPrefix, "Market scan warning:", scanErr.message)
      }
    }

    if (isSnipeMode && !snipeResult && snipeExchange !== "BINANCE_GLOBAL" && !isGlobalOnlyMode) {
      const failureAction = executedActions.find((a) => a.startsWith("ALIM_DENENDI_HATALI"))
      if (failureAction) {
        snipeResult = {
          ok: false,
          message: `Alım denendi fakat emir iletilemedi: ${failureAction.replace("ALIM_DENENDI_HATALI: ", "")}`,
        }
      }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // ğŸŒ BÄ°NANCE GLOBAL KALDIRAÃ‡LI (FUTURES) AKILLI 2-SLOT HÄ°BRÄ°T MOTORU
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    let futuresSummary: any = null
    if (hasGlobal && binanceGlobal) {
      try {
        const globKey = binanceGlobal.apiKey.trim()
        const globSecret = binanceGlobal.apiSecret.trim()
        const futuresBalance = await getFuturesAccountBalance(globKey, globSecret)

        if (futuresBalance.ok) {
          let availUsdt = futuresBalance.availableBalanceUsdt
          const todayStr = new Date().toISOString().split("T")[0]
          // 📉 GÜN BAŞI BAKİYE KAYDI — SADECE GÜN DEĞİŞİNCE YAZILIR (FAIL-PROOF):
          // Daha önce her döngüde setDailyLoss(availUsdt) üzerine yazıyordu; zarar ettikçe
          // "gün başı bakiyesi" de düşüyordu ve günlük zarar debriyajı ASLA devreye giremiyordu.
          // getDailyLoss(currentBalance): gün aynıysa ilk kaydedilen bakiyeyi geri döner.
          const dailyLossInfo = await getDailyLoss(availUsdt).catch(() => ({ startBalance: 0, date: todayStr }))
          const futuresDayStartUsdt = dailyLossInfo.startBalance || 0
          const allFuturesPos = await getFuturesPositions(globKey, globSecret)
          // Sadece açık Long pozisyonlar
          let openFuturesPos = allFuturesPos.filter((p) => p.positionAmt > 0)
          futuresSummary = {
            ok: true,
            availUsdt,
            openPositions: openFuturesPos.length,
            message: openFuturesPos.length > 0
              ? `${openFuturesPos.length} aktif pozisyon (${openFuturesPos.map((p) => `${p.symbol} ${p.leverage}x`).join(", ")})`
              : `${availUsdt.toFixed(2)} USDT ile ${Math.min(3, exchangeSettings?.leverage || 3)}x kaldıraçlı fırsat taranıyor`,
          }
          const leverage = exchangeSettings?.leverage || 5
          const targetSlPct = 3.50 // Binance TR ile birebir aynı: -%3.50 geniş swing stop (eski %1.8 dar stop gürültüde patlatıyordu)

          // 📜 OTOMATİK VADELİ İŞLEM GEÇMİŞİ SENKRONİZASYONU (Binance Global'de kapanmış kâr/zararları geçmişe aktar)
          try {
            const recentIncomes = await getFuturesRecentIncome(globKey, globSecret, 25)
            if (Array.isArray(recentIncomes) && recentIncomes.length > 0) {
              const currentHist = await getServerHistory()
              const activeFuturesSymbols = new Set(
                openFuturesPos.map((p) => p.symbol.replace(/USDT$/i, "").toUpperCase())
              )
              const usdtRate = await getCronUsdtTryRate()

              for (const inc of recentIncomes) {
                if (!inc.symbol?.endsWith("USDT") || Math.abs(inc.income) < 0.00001) continue
                const cSym = inc.symbol.replace(/USDT$/i, "").toUpperCase()
                const incTime = Number(inc.time) || Date.now()

                // 🛡️ DEĞİŞİKLİK 3: Botun kendi kapanışını clientOrderId / orderId ile eşleştir
                const closingMeta = await getFuturesClosing(cSym)
                const isAlreadyRecorded = currentHist.some((h: any) =>
                  h.isFutures && (
                    (inc.tranId && h.id?.includes(String(inc.tranId))) ||
                    (closingMeta?.clientOrderId && (h.clientOrderId === closingMeta.clientOrderId || h.id?.includes(closingMeta.clientOrderId))) ||
                    (closingMeta?.orderId && (h.orderId === closingMeta.orderId || h.id?.includes(String(closingMeta.orderId))))
                  )
                )

                if (!isAlreadyRecorded && !activeFuturesSymbols.has(cSym)) {
                  // DEĞİŞİKLİK 2: userTrades'ten gerçek giriş/çıkış/miktar/kaldıracı al
                  let verifiedEntryPrice: number = 0
                  let verifiedExitPrice: number = 0
                  let verifiedAmount: number = 0
                  let verifiedLeverage: number | null = null
                  let verifiedPnlPercent: number | null = null
                  let isVerifiedTrade = false

                  try {
                    const trades = await getFuturesUserTrades(globKey, globSecret, cSym, 10)
                    if (Array.isArray(trades) && trades.length > 0) {
                      // incTime'a en yakın kapanış sell trade'ini bul
                      const matchingSell = trades.find((t: any) =>
                        Math.abs(Number(t.time) - incTime) <= 60000 && t.side === "SELL"
                      ) || trades[0]

                      if (matchingSell) {
                        verifiedExitPrice = parseFloat(matchingSell.price || "0")
                        verifiedAmount = parseFloat(matchingSell.qty || "0")
                        
                        // Önceki buy trade'lerini bularak ortalama giriş fiyatını belirle
                        const priorBuys = trades.filter((t: any) => t.side === "BUY" && Number(t.time) <= Number(matchingSell.time))
                        if (priorBuys.length > 0) {
                          const totalBuyQty = priorBuys.reduce((sum: number, b: any) => sum + parseFloat(b.qty || "0"), 0)
                          const totalBuyCost = priorBuys.reduce((sum: number, b: any) => sum + (parseFloat(b.qty || "0") * parseFloat(b.price || "0")), 0)
                          if (totalBuyQty > 0) {
                            verifiedEntryPrice = totalBuyCost / totalBuyQty
                          }
                        }

                        if (verifiedEntryPrice > 0 && verifiedExitPrice > 0) {
                          isVerifiedTrade = true
                          const priceDiffPct = ((verifiedExitPrice - verifiedEntryPrice) / verifiedEntryPrice) * 100
                          // Kaldıraç bilinmiyorsa veya pozisyon kapandıysa marjinden ROI tahmini yerine ham fiyat farkı * nominal
                          verifiedPnlPercent = Number(priceDiffPct.toFixed(2))
                        }
                      }
                    }
                  } catch (tradeFetchErr) {
                    console.warn(logPrefix, `userTrades sorgulanamadı (${cSym}):`, tradeFetchErr)
                  }

                  const isProfit = inc.income >= 0
                  const netTry = inc.income * usdtRate

                  // 90 saniyelik manuel cooldown'ı sadece doğrulanmış harici kapanışta uygula
                  const isBotClosed = Boolean(closingMeta)
                  if (!isBotClosed && isVerifiedTrade) {
                    await setServerManualSellCooldown(90)
                  }

                  const newClosedPos: any = {
                    id: `futures-income-${inc.tranId || incTime}`,
                    symbol: cSym,
                    name: verifiedLeverage ? `${cSym} (${verifiedLeverage}x Vadeli)` : `${cSym} (Vadeli)`,
                    side: "BUY",
                    entryPrice: verifiedEntryPrice,
                    currentPrice: verifiedExitPrice,
                    closePrice: verifiedExitPrice,
                    amount: verifiedAmount,
                    totalTry: verifiedAmount > 0 && verifiedEntryPrice > 0 ? (verifiedAmount * verifiedEntryPrice * usdtRate) : 0,
                    pnl: inc.income,
                    netPnlTry: netTry,
                    pnlPercent: isVerifiedTrade ? verifiedPnlPercent : null,
                    openedAt: null,
                    openedTimestamp: null,
                    status: "CLOSED",
                    closeReason: isVerifiedTrade 
                      ? (isProfit ? "Binance Global Kâr Satışı (Doğrulandı)" : "Binance Global Stop Loss (Doğrulandı)")
                      : "Harici Vadeli Kapanış (Doğrulanamadı)",
                    closedAt: new Date(incTime).toISOString(),
                    closedTimestamp: incTime,
                    triggerType: isBotClosed ? (closingMeta?.reason || "BOT_CLOSE") : "EXTERNAL_UNVERIFIED",
                    orderType: "MARKET",
                    isFutures: true,
                    leverage: verifiedLeverage,
                    exchange: "BINANCE_GLOBAL_FUTURES",
                    clientOrderId: closingMeta?.clientOrderId || null,
                    orderId: closingMeta?.orderId || null,
                  }

                  // Sadece giriş ve çıkış fiyatı doğrulanmış gerçek işlemleri geçmişe kaydet (0 fiyatlı sahte/fonlama kayıtlarını engelle)
                  if (isVerifiedTrade && verifiedEntryPrice > 0 && verifiedExitPrice > 0) {
                    await appendServerHistory(newClosedPos)
                  }

                  // 🧹 Borsa kaynaklı kapanan pozisyonun Redis meta verilerini ve yetim emirlerini temizle:
                  await clearFuturesPositionMeta(cSym).catch(() => {})
                  await cancelFuturesAllOpenOrders(globKey, globSecret, cSym).catch(() => {})

                  // Kapanış meta bilgisini temizle
                  if (closingMeta) {
                    await clearFuturesClosing(cSym, closingMeta.clientOrderId)
                  }
                }
              }
            }
          } catch (syncErr) {
            console.warn(logPrefix, "Cron futures income sync error:", syncErr)
          }

          const closedFuturesSymbols = new Set<string>()
          for (const fPos of openFuturesPos) {
            const sym = fPos.symbol
            const cleanSym = sym.replace(/USDT$/i, "").toUpperCase()

            // 🧪 DRY-RUN SERT KİLİT: gerçek borsa pozisyonlarına HİÇ dokunulmaz
            // (kapatma / stop yükseltme / self-healing stop emri GÖNDERİLMEZ).
            if (isDryRunActive) {
              console.log(logPrefix, `🧪 [DRY_RUN] ${sym} gerçek pozisyon yönetimi atlandı — gerçek emir gönderilmiyor.`)
              continue
            }

            // 🛡️ KULLANICI MANUEL POZİSYON KORUMASI:
            // Kullanıcı mobilden/uygulamadan elle işlem açtığında bot o pozisyona dokunmaz.
            const isBotOpened = await isFuturesBotOwned(sym)
            if (!isBotOpened) {
              // Kullanıcının manuel pozisyonu: Sadece izle, loglara dokunma, ASLA otomatik kapatma!
              continue
            }

            const entryP = fPos.entryPrice
            const markP = fPos.markPrice
            if (entryP <= 0 || markP <= 0) continue

            // 🛡️ AÇIK POZİSYON KORUYUCU STOP DOĞRULAMASI & KENDİ KENDİNİ ONARMA (SELF-HEALING STOP):
            // Borsada bu pozisyona ait bekleyen STOP_MARKET emri var mı kontrol et; yoksa ANINDA yeniden kur!
            try {
              const openOrders = await getFuturesOpenOrders(globKey, globSecret, sym)
              const activeStopOrder = openOrders.find((o) => o.type === "STOP_MARKET" || o.type === "STOP")
              if (activeStopOrder) {
                console.log(logPrefix, `✅ [STOP KORUMASI MEVCUT] ${sym} için borsada bekleyen koruyucu stop emri aktif (OrderId: ${activeStopOrder.orderId}, Tetik: ${activeStopOrder.stopPrice || "Bilinmiyor"})`)
              } else {
                console.warn(logPrefix, `⚠️ [STOP KORUMASI EKSİK - KENDİ KENDİNİ ONARMA DEVREDE] ${sym} pozisyonu açık fakat borsada bekleyen STOP_MARKET emri bulunamadı! Anında koruyucu stop emri kuruluyor...`)
                const symFilters = await getFuturesSymbolFilters(sym)
                const symTick = symFilters?.tickSize || 0.0001
                const fallbackSlDistPct = 3.50
                const calculatedSafeStop = parseFloat(formatWithTickSize(Math.min(entryP * (1 - fallbackSlDistPct / 100), markP * 0.985), symTick))
                if (calculatedSafeStop > 0 && calculatedSafeStop < markP) {
                  const healStopRes = await executeBinanceFuturesOrder({
                    apiKey: globKey,
                    apiSecret: globSecret,
                    symbol: sym,
                    side: "SELL",
                    type: "STOP_MARKET",
                    stopPrice: calculatedSafeStop,
                    closePosition: true,
                    workingType: "MARK_PRICE",
                  }).catch(() => ({ ok: false, orderId: undefined }))
                  if (healStopRes.ok && healStopRes.orderId) {
                    console.log(logPrefix, `🛡️ [KENDİ KENDİNİ ONARAN STOP KURULDU] ${sym} için eksik stop ${calculatedSafeStop}$ seviyesinde başarıyla oluşturuldu (OrderId: ${healStopRes.orderId}).`)
                  }
                }
              }
            } catch (err: any) {
              console.warn(logPrefix, `⚠️ [STOP KONTROL HATASI] ${sym} açık emirler sorgulanamadı:`, err.message)
            }

            const rawPriceDiffPct = ((markP - entryP) / entryP) * 100
            const leveragedRoiPct = rawPriceDiffPct * fPos.leverage

            const isMeme = MEME_TOKENS.has(cleanSym)
            const isDefi = DEFI_TOKENS.has(cleanSym)

            // ⏱️ Giriş Zamanı ve Pozisyon Süresi (Saat)
            let entryTime = await getFuturesEntryTime(sym)
            if (!entryTime) {
              entryTime = Date.now()
              await setFuturesEntryTime(sym, entryTime)
            }
            const posHours = Math.max(0, (Date.now() - entryTime) / (1000 * 60 * 60))

            // 📈 Zirve Kâr Takibi (Trailing Stop & Tıkanma Tespiti İçin)
            let peakRoiPct = await getFuturesPeakPnl(sym)
            if (leveragedRoiPct > peakRoiPct) {
              peakRoiPct = leveragedRoiPct
              await setFuturesPeakPnl(sym, peakRoiPct)
            }

            let peakPriceGainPct = await getFuturesPeakPricePct(sym)
            if (rawPriceDiffPct > peakPriceGainPct) {
              peakPriceGainPct = rawPriceDiffPct
              await setFuturesPeakPricePct(sym, peakPriceGainPct)
            }

            const currentLev = fPos.leverage || 5

            // 🎯 %1.5 KÂR KORUMA STOPU KONTROLÜ (TÜM COINLER İÇİN):
            // Kullanıcı Kuralı: "%1.5 geçince stop loss'u %1.5'e çek (kârı kilitle)"
            let passed2Pct = false
            if (rawPriceDiffPct >= 1.5 || peakPriceGainPct >= 1.5) {
              passed2Pct = true
              await setFuturesPassed2Pct(sym)
            } else {
              passed2Pct = await isFuturesPassed2Pct(sym)
            }

            // 🎯 COİNE GÖRE AKILLI HEDEF KÂR (10x Kaldıraç Optimize: Az İşlem, Yüksek Kazanç):
            // - Meme / Yüksek Volatilite Patlayıcı Coinler (PEPE, DOGE, BONK, SHIB, FLOKI, WIF vb.):
            //   TP1: +%6.50 (10x ile +%65 ROI) -> %50 kademeli satış, stop başabaşa çekilir.
            //   TP2: +%15.00 (10x ile +%150 ROI)!
            // - DeFi ve Standart Altcoinler (SUI, AVAX, LINK, INJ, AAVE, TIA, ARB, OP, NEAR vb.):
            //   TP1: +%5.00 (10x ile +%50 ROI) -> %50 kademeli satış, stop başabaşa çekilir.
            //   TP2: +%10.00 (10x ile +%100 ROI - 2x kasa katlama)!
            // - Major Coinler (BTC, ETH, BNB, SOL, XRP):
            //   TP1: +%3.50 (10x ile +%35 ROI) -> %50 kademeli satış, stop başabaşa çekilir.
            //   TP2: +%7.50 (10x ile +%75 ROI).
            const isMajorCoin = ["BTC", "ETH", "BNB", "SOL", "XRP"].includes(cleanSym)
            const isMemeCoin = isMeme || ["DOGE", "PEPE", "SHIB", "BONK", "FLOKI", "WIF", "NEIRO", "TURBO", "PENGU", "1000PEPE", "1000SHIB", "1000BONK", "1000FLOKI"].includes(cleanSym)
            
            const defaultCoinTp1 = isMemeCoin ? 7.00 : isMajorCoin ? 5.00 : 5.60
            const defaultCoinTp2 = isMemeCoin ? 15.00 : isMajorCoin ? 9.00 : 11.00

            const customTp = await getFuturesCustomTp(cleanSym)
            const calculatedSlPct = 3.50 // -%3.50 geniş swing stop-loss

            let baseTp1Pct = customTp ? customTp : defaultCoinTp1
            let baseTp2Pct = customTp ? customTp * 1.60 : defaultCoinTp2
            if (customTp && customTp >= baseTp2Pct) {
              baseTp2Pct = customTp * 1.60
            }
            let isFuturesExhausted = false
            let futuresRiskReasons: string[] = []
            let klines15mList: any[] = []
            // Futures Risk Teyit Analizi:

            // Anlık grafik analizi ile dinamik ayar:
            try {
              const [kRes15m, tick24Res] = await Promise.all([
                publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=${sym}&interval=15m&limit=30`, {
                  signal: AbortSignal.timeout(3000),
                  cache: "no-store",
                }),
                publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr?symbol=${sym}`, {
                  signal: AbortSignal.timeout(3000),
                  cache: "no-store",
                }),
              ])

              if (kRes15m.ok && tick24Res.ok) {
                const klines: any[] = await kRes15m.json()
                const tick24: any = await tick24Res.json()

                if (Array.isArray(klines) && klines.length >= 15) {
                  klines15mList = klines
                  const closes = klines.map((k: any) => parseFloat(k[4]))
                  const lastK = klines[klines.length - 1]
                  const prevK = klines[klines.length - 2]

                  // 1) 14 Periyotluk RSI:
                  let g = 0, l = 0
                  for (let i = closes.length - 14; i < closes.length; i++) {
                    const d = closes[i] - closes[i - 1]
                    if (d >= 0) g += d; else l -= d
                  }
                  const rsi14 = 100 - (100 / (1 + (g / (l || 1))))

                  // 2) Son 15m Taker Buy Oranı (Alıcı gücü):
                  const lastVol = parseFloat(lastK[7]) || 1
                  const lastTaker = parseFloat(lastK[10]) || (lastVol * 0.5)
                  const takerBuyPct = (lastTaker / lastVol) * 100

                  // 3) 24h Fiyat Değişimi (%):
                  const change24h = parseFloat(tick24.priceChangePercent) || 0

                  // 4) Son 15m Hacim Artış Trendi (önceki muma göre):
                  const prevVol = parseFloat(prevK[7]) || 1
                  const volGrowth = (lastVol / prevVol) - 1 // >0 artış, <0 azalış

                  // Futures için Çoklu Gösterge Risk Teyit Analizi:
                  futuresRiskReasons = []
                  if (rsi14 >= 72) futuresRiskReasons.push(`RSI Şişmesi (${rsi14.toFixed(1)})`)
                  if (takerBuyPct < 40) futuresRiskReasons.push(`Taker Satıcı Baskısı (%${(100 - takerBuyPct).toFixed(0)})`)
                  if (volGrowth < -0.35) futuresRiskReasons.push("Hacim Sönmesi")
                  if (change24h >= 14.0) futuresRiskReasons.push("24h FOMO Doyumu")

                  const body = Math.abs((parseFloat(lastK[4]) || 0) - (parseFloat(lastK[1]) || 0)) || 0.001
                  const upperWick = (parseFloat(lastK[2]) || 0) - Math.max(parseFloat(lastK[1]) || 0, parseFloat(lastK[4]) || 0)
                  if (upperWick > body * 1.5 && markP > entryP * 1.02) {
                    futuresRiskReasons.push("Tepe Fitil Satışı")
                  }

                  // 🚀 AKILLI HEDEF ESNETME & FIRLAMA SÜRÜŞÜ:
                  // Coin güçlü koşuyorsa ve alıcılar dominant ise TP2 hedefini yukarı aç!
                  if (rsi14 < 65 && takerBuyPct > 54 && volGrowth > 0.10) {
                    baseTp2Pct = Math.max(baseTp2Pct, isMemeCoin ? 20.00 : (isMajorCoin ? 9.50 : 14.00)) // Güçlü momentumda zirveye kadar sür
                  }

                  isFuturesExhausted = futuresRiskReasons.length >= 2 || (rawPriceDiffPct >= 2.2 && futuresRiskReasons.length >= 1)

                  console.log(logPrefix, `📊 [FUTURES ÇOKLU ANALİZ] ${sym} (${currentLev}x): RSI=${rsi14.toFixed(1)}, Taker=${takerBuyPct.toFixed(1)}%, Risk=${futuresRiskReasons.join("+") || "YOK (TEMİZ)"}, TP1=Ham +%${baseTp1Pct.toFixed(2)} (+%${(baseTp1Pct * currentLev).toFixed(1)} ROI), TP2=Ham +%${baseTp2Pct.toFixed(2)} (+%${(baseTp2Pct * currentLev).toFixed(1)} ROI), SL=-%${calculatedSlPct.toFixed(2)}`)
                }
              }
            } catch {
              // Analiz başarısız → baz oranlarla devam et
            }

            // 🧮 15m ATR ve Dinamik R (Risk Katı) Seviyeleri:
            // TP1 = 1.2R, TP2 = 2.5R, Trailing Başlangıç = 1.5R, Trailing Geri Çekilme = 0.8 x ATR
            let posAtrPct = 2.0
            try {
              if (Array.isArray(klines15mList) && klines15mList.length >= 16) {
                const cList: Candle[] = klines15mList.map((k: any) => ({
                  t: Number(k[0]), o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5])
                }))
                const s = atrSeries(cList.slice(0, -1), 14)
                const curAtr = s[s.length - 1]
                if (curAtr > 0 && markP > 0) {
                  posAtrPct = (curAtr / markP) * 100
                }
              }
            } catch {}

            const dynamicStopDistPct = Math.max(2.0, Math.min(6.0, posAtrPct * 2.0))
            const dynamicExits = calculateDynamicRExits(dynamicStopDistPct, posAtrPct)

            // Dinamik R ve ATR Seviyeleri:
            const targetTp1Pct = dynamicExits.tp1Pct // 1.2R
            const targetTp2Pct = dynamicExits.tp2Pct // 2.5R
            const minTrailingActivationPct = dynamicExits.trailingActivationPct // 1.5R
            const dynamicTrailingPullbackPct = dynamicExits.trailingPullbackPct // 0.8 x ATR (%)
            const targetSlPct = dynamicExits.stopLossDistancePct // 1R

            const alreadyTp1 = await isFuturesTp1Taken(sym)

            // Borsadaki mevcut açık STOP_MARKET tetik fiyatını al
            let currentExchangeStopPrice = 0
            try {
              const openOrders = await getFuturesOpenOrders(globKey, globSecret, sym)
              const curStopOrder = openOrders.find((o) => o.type === "STOP_MARKET" || o.type === "STOP")
              currentExchangeStopPrice = curStopOrder?.stopPrice || 0
            } catch {}

            // 🛡️ MONOTONİK R-BAZLI STOP SEVİYESİ HESAPLAMASI:
            const monoStop = calculateMonotonicStopTarget({
              entryPrice: entryP,
              highestPrice: peakPriceGainPct > 0 ? entryP * (1 + peakPriceGainPct / 100) : entryP,
              currentPrice: markP,
              stopLossDistancePct: dynamicStopDistPct,
              atrPct: posAtrPct,
              isTp1Taken: alreadyTp1,
              currentStopPrice: currentExchangeStopPrice,
            })

            // 🔒 BORSADAKİ GERÇEK STOP_MARKET EMRİNİ DİNAMİK/KADEMELİ OTOMATİK KÂRA TAŞIMA:
            // Kademe 1: Fiyat +%1.20 (10x'te +%12 ROI) -> Stop = Giriş + %0.25 (Başabaş + Komisyon Kilidi)
            // Kademe 2: Fiyat +%2.20 (10x'te +%22 ROI) -> Stop = Giriş + %1.10 (+%11 Net ROI Garanti Kâr Kilidi)
            // Sürekli Takip (Trailing): monoStop fiyatı mevcut borsa stopundan > %0.35 daha yüksekse borsadaki emri yukarı sür!
            const effectiveMaxGainPct = Math.max(rawPriceDiffPct, peakPriceGainPct)
            if (effectiveMaxGainPct >= 1.20 && markP > entryP * 1.005) {
              try {
                const isStage2ProfitLock = effectiveMaxGainPct >= 2.20 && markP > entryP * 1.014
                const targetLockMultiplier = isStage2ProfitLock ? 1.0110 : 1.0025
                const minRequiredStageStop = isStage2ProfitLock ? entryP * 1.0095 : entryP
                const candidateTargetStop = Math.max(entryP * targetLockMultiplier, monoStop.newStopPrice)

                const shouldUpgradeStop =
                  (currentExchangeStopPrice > 0 && currentExchangeStopPrice < minRequiredStageStop) ||
                  (candidateTargetStop > currentExchangeStopPrice * 1.0035 && candidateTargetStop < markP * 0.998)

                if (shouldUpgradeStop) {
                  const symFilters = await getFuturesSymbolFilters(sym)
                  const symTick = symFilters?.tickSize || 0.0001
                  const safeLockTrigger = parseFloat(formatWithTickSize(candidateTargetStop, symTick))
                  if (safeLockTrigger > currentExchangeStopPrice && safeLockTrigger < markP * 0.998) {
                    const upgStopRes = await executeBinanceFuturesOrder({
                      apiKey: globKey,
                      apiSecret: globSecret,
                      symbol: sym,
                      side: "SELL",
                      type: "STOP_MARKET",
                      stopPrice: safeLockTrigger,
                      closePosition: true,
                      workingType: "MARK_PRICE",
                    }).catch(() => ({ ok: false, orderId: undefined }))
                    if (upgStopRes.ok && upgStopRes.orderId) {
                      await cancelFuturesAllOpenOrders(globKey, globSecret, sym, [upgStopRes.orderId]).catch(() => {})
                      const lockLabel = safeLockTrigger >= entryP * 1.011
                        ? "KADEME-2 +%1.10 (+%11 ROI) GARANTİ KÂR KİLİDİ"
                        : safeLockTrigger >= entryP * 1.0025
                        ? "KADEME-1 +%0.25 BAŞABAŞ KİLİDİ"
                        : "ATR DİNAMİK TAKİPÇİ STOP"
                      console.log(logPrefix, `🔒 [BORSA STOP YÜKSELTİLDİ - ${lockLabel}] ${sym} gerçek STOP_MARKET emri ${currentExchangeStopPrice}$ -> ${safeLockTrigger}$ seviyesine yükseltildi!`)
                      currentExchangeStopPrice = safeLockTrigger
                    }
                  }
                }
              } catch {}
            }

            // 🧪 YENİ ÇIKIŞ KURALI MODU (useNewExitRules)
            const useNewExitRules = Boolean(exchangeSettings?.useNewExitRules)

            // 🔬 GÖLGE DEĞERLENDİRME (SHADOW LOG): Bayrak kapalıyken de yeni kuralın ne yapacağını logla
            const feePct = 0.08 // Tahmini çift taraflı komisyon ve kayma (%0.08)
            const bePrice = entryP * (1 + feePct / 100)
            const hasPassedActivation = peakPriceGainPct >= minTrailingActivationPct || rawPriceDiffPct >= minTrailingActivationPct
            let shadowTrigger: string | null = null
            let shadowExitPrice = markP
            let shadowReason = ""

            // Öncelik Sıralaması:
            // 1. Dinamik Stop-Loss: fiyatta -1R (-targetSlPct%)
            // 2. Dinamik Kâr Hedefi (TP): fiyatta +2.5R (+targetTp2Pct%)
            // 3. Dinamik Trailing Stop: +1.5R görüldükten sonra zirveden 0.8x ATR geride
            // 4. Başabaş Stop: +1.5R görüldükten sonra başabaşın altına düşerse
            if (rawPriceDiffPct <= -targetSlPct) {
              shadowTrigger = "NEW_SL"
              shadowExitPrice = markP
              shadowReason = `Dinamik Stop-Loss (-1R: -%${targetSlPct.toFixed(2)})`
            } else if (rawPriceDiffPct >= targetTp2Pct) {
              shadowTrigger = "NEW_TP"
              shadowExitPrice = markP
              shadowReason = `Dinamik Hedef Kâr (+2.5R: +%${targetTp2Pct.toFixed(2)})`
            } else if (hasPassedActivation && rawPriceDiffPct <= (peakPriceGainPct - dynamicTrailingPullbackPct)) {
              shadowTrigger = "NEW_TRAILING"
              shadowExitPrice = markP
              shadowReason = `Dinamik Trailing Stop (Zirve: %${peakPriceGainPct.toFixed(2)} -> 0.8x ATR Çekilme %${dynamicTrailingPullbackPct.toFixed(2)})`
            } else if (hasPassedActivation && markP <= bePrice) {
              shadowTrigger = "NEW_BREAKEVEN"
              shadowExitPrice = bePrice
              shadowReason = `Başabaş Stop: +1.5R sonrası maliyet+komisyona geri çekilme`
            }

            if (shadowTrigger) {
              const shadowGrossUsdt = fPos.positionAmt * (shadowExitPrice - entryP)
              const shadowFeeUsdt = (fPos.positionAmt * entryP * 0.0004) + (fPos.positionAmt * shadowExitPrice * 0.0004)
              const shadowNetPnlUsdt = shadowGrossUsdt - shadowFeeUsdt
              const shadowNetRoiPct = (shadowNetPnlUsdt / ((fPos.positionAmt * entryP) / (fPos.leverage || 5))) * 100
              console.log(logPrefix, `[SHADOW_NEW_EXIT_SIM] ${sym} -> Tetik: ${shadowTrigger}, Çıkış Fiyatı: ${shadowExitPrice.toFixed(4)}, Net PnL: ${shadowNetPnlUsdt.toFixed(3)} USDT (ROI: %${shadowNetRoiPct.toFixed(2)}), Gerekçe: ${shadowReason}`)
            }

            // 🚀 YENİ KURAL AKTİF İSE (useNewExitRules === true):
            if (useNewExitRules) {
              let newRuleTrigger: "TP" | "SL" | "TRAILING_STOP" | "BREAKEVEN" | null = null
              let newRuleReason = ""

              if (rawPriceDiffPct <= -targetSlPct) {
                newRuleTrigger = "SL"
                newRuleReason = `Dinamik Stop-Loss (-1R: -%${targetSlPct.toFixed(2)})`
              } else if (rawPriceDiffPct >= targetTp2Pct) {
                newRuleTrigger = "TP"
                newRuleReason = `Dinamik Hedef Kâr (+2.5R: +%${targetTp2Pct.toFixed(2)})`
              } else if (hasPassedActivation && rawPriceDiffPct <= (peakPriceGainPct - dynamicTrailingPullbackPct)) {
                newRuleTrigger = "TRAILING_STOP"
                newRuleReason = `Dinamik Trailing Stop (Zirve: %${peakPriceGainPct.toFixed(2)} -> 0.8x ATR Çekilme %${dynamicTrailingPullbackPct.toFixed(2)})`
              } else if (hasPassedActivation && markP <= bePrice) {
                newRuleTrigger = "BREAKEVEN"
                newRuleReason = `Dinamik Başabaş Koruma Stopu (Giriş + Komisyon)`
              }

              if (newRuleTrigger) {
                const filters = await getFuturesSymbolFilters(sym)
                const stepSize = filters?.stepSize || 0.001
                const fullAmt = parseFloat(formatWithStepSize(fPos.positionAmt, stepSize, filters?.basePrecision || 3))

                const closeClientOrderId = `bot-newexit-${cleanSym}-${Date.now()}`
                await markFuturesClosing(cleanSym, { clientOrderId: closeClientOrderId, reason: newRuleTrigger === "TP" ? "TP" : (newRuleTrigger === "TRAILING_STOP" ? "TRAILING_STOP" : "SL") })

                const closeRes = await executeBinanceFuturesOrder({
                  apiKey: globKey,
                  apiSecret: globSecret,
                  symbol: sym,
                  side: "SELL",
                  type: "MARKET",
                  quantity: fullAmt,
                  reduceOnly: true,
                  newClientOrderId: closeClientOrderId,
                })

                if (closeRes.ok) {
                  closedFuturesSymbols.add(sym)
                  await cancelFuturesAllOpenOrders(globKey, globSecret, sym).catch(() => {})
                  await clearFuturesPositionMeta(sym)
                  const cdReason = newRuleTrigger === "SL" ? "SL" : (newRuleTrigger === "TP" || newRuleTrigger === "TRAILING_STOP" ? "TP" : "BREAKEVEN")
                  const cdDuration = cdReason === "SL" ? 3600 : cdReason === "BREAKEVEN" ? 1800 : 900
                  await setSymbolCooldown(sym, cdReason, cdDuration).catch(() => {})
                  const pnlUsdt = fullAmt * (markP - entryP)
                  const usdtRate = await getCronUsdtTryRate()
                  const netTry = pnlUsdt * usdtRate
                  const logMsg = `🧪 🌐 [YENİ ÇIKIŞ KURALI KAPATILDI] ${sym} ${fPos.leverage}x: ${newRuleReason} -> Fiyat Farkı: %${rawPriceDiffPct.toFixed(2)}, PnL: ${pnlUsdt.toFixed(3)} USDT`
                  executedActions.push(`FUTURES_NEW_EXIT_${newRuleTrigger}: ${sym} (%${rawPriceDiffPct.toFixed(2)})`)
                  notifyFuturesTradeExit({
                    symbol: sym,
                    leverage: fPos.leverage,
                    pnlUsdt,
                    leveragedRoiPct,
                    exitPrice: markP,
                    entryPrice: entryP,
                    reason: newRuleReason,
                  }).catch(() => {})
                  await appendServerLog({
                    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    time: new Date().toLocaleTimeString("tr-TR"),
                    type: newRuleTrigger === "TP" || newRuleTrigger === "TRAILING_STOP" ? "SELL" : "ALERT",
                    symbol: sym,
                    message: logMsg,
                  })
                  const histItem: any = {
                    id: `futures-newexit-${sym}-${Date.now()}`,
                    symbol: cleanSym,
                    name: `${cleanSym} (${fPos.leverage}x Vadeli - Yeni Kural)`,
                    side: "BUY",
                    entryPrice: entryP,
                    currentPrice: markP,
                    closePrice: markP,
                    amount: fullAmt,
                    totalTry: fullAmt * entryP * usdtRate,
                    pnl: pnlUsdt,
                    netPnlTry: netTry,
                    pnlPercent: leveragedRoiPct,
                    openedAt: new Date(entryTime).toLocaleTimeString("tr-TR"),
                    openedTimestamp: entryTime,
                    status: "CLOSED",
                    closeReason: newRuleReason,
                    closedAt: new Date().toISOString(),
                    closedTimestamp: Date.now(),
                    triggerType: newRuleTrigger === "TP" ? "TP" : (newRuleTrigger === "TRAILING_STOP" ? "TRAILING_STOP" : "SL"),
                    orderType: "MARKET",
                    isFutures: true,
                    leverage: fPos.leverage,
                    exchange: "BINANCE_GLOBAL_FUTURES",
                    clientOrderId: closeClientOrderId,
                  }
                  await appendServerHistory(histItem).catch(() => {})
                  continue
                }
              }
              // Yeni kural tetiklenmediyse bu pozisyon için döngü devam etsin (eski kurallara düşmesin)
              continue
            }

            // --- MEVCUT ÇIKIŞ KURALLARI (useNewExitRules === false) ---

            // A.0) 🚨 AKILLI YORULMA KÂR KİLİDİ (EXHAUSTION TP):
            // Pozisyon en az +%1.40 fiyatta (+%14 ROI) kârdayken, RSI > 78, Taker alımları çökmüş ve üst fitil satışı başlamışsa,
            // kârın buharlaşmasını beklemeden anında kârı kasaya kilitleyip pozisyonu kapatır:
            if (rawPriceDiffPct >= 1.40 && isFuturesExhausted) {
              const filters = await getFuturesSymbolFilters(sym)
              const stepSize = filters?.stepSize || 0.001
              const fullAmt = parseFloat(formatWithStepSize(fPos.positionAmt, stepSize, filters?.basePrecision || 3))
              const closeClientOrderId = `bot-exhaust-${cleanSym}-${Date.now()}`
              await markFuturesClosing(cleanSym, { clientOrderId: closeClientOrderId, reason: "TP" })

              const closeRes = await executeBinanceFuturesOrder({
                apiKey: globKey,
                apiSecret: globSecret,
                symbol: sym,
                side: "SELL",
                type: "MARKET",
                quantity: fullAmt,
                reduceOnly: true,
                newClientOrderId: closeClientOrderId,
              })
              if (closeRes.ok) {
                closedFuturesSymbols.add(sym)
                await cancelFuturesAllOpenOrders(globKey, globSecret, sym).catch(() => {})
                await clearFuturesPositionMeta(sym)
                await setSymbolCooldown(sym, "TP", 900).catch(() => {})
                const pnlUsdt = fullAmt * (markP - entryP)
                const usdtRate = await getCronUsdtTryRate()
                const netTry = pnlUsdt * usdtRate
                const reasonsText = futuresRiskReasons.join("+") || "Zirve Yorulması"
                const logMsg = `⚡ 🌐 [YORULMA KÂR KİLİDİ] ${sym} ${fPos.leverage}x Kaldıraç: +%${leveragedRoiPct.toFixed(2)} ROI Net Kârla Kapatıldı! Sinyal: ${reasonsText}.`
                executedActions.push(`FUTURES_EXHAUSTION_TP: ${sym} (+%${leveragedRoiPct.toFixed(2)})`)
                notifyFuturesTradeExit({
                  symbol: sym,
                  leverage: fPos.leverage,
                  pnlUsdt,
                  leveragedRoiPct,
                  exitPrice: markP,
                  entryPrice: entryP,
                  reason: `Akıllı Yorulma Kâr Kilidi (${reasonsText})`,
                }).catch(() => {})
                await appendServerLog({
                  id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  time: new Date().toLocaleTimeString("tr-TR"),
                  type: "SELL",
                  symbol: sym,
                  message: logMsg,
                })
                const histItem: any = {
                  id: `futures-exhaust-${sym}-${Date.now()}`,
                  symbol: cleanSym,
                  name: `${cleanSym} (${fPos.leverage}x Vadeli - Yorulma TP)`,
                  side: "BUY",
                  entryPrice: entryP,
                  currentPrice: markP,
                  closePrice: markP,
                  amount: fullAmt,
                  totalTry: fullAmt * entryP * usdtRate,
                  pnl: pnlUsdt,
                  netPnlTry: netTry,
                  pnlPercent: leveragedRoiPct,
                  openedAt: new Date(entryTime).toLocaleTimeString("tr-TR"),
                  openedTimestamp: entryTime,
                  status: "CLOSED",
                  closeReason: `Akıllı Yorulma Kâr Kilidi (${reasonsText})`,
                  closedAt: new Date().toISOString(),
                  closedTimestamp: Date.now(),
                  triggerType: "TP",
                  orderType: "MARKET",
                  isFutures: true,
                  leverage: fPos.leverage,
                  exchange: "BINANCE_GLOBAL_FUTURES",
                }
                await appendServerHistory(histItem).catch(() => {})
                continue
              }
            }

            // A) 🎯 HEDEF TP1 (COİNE GÖRE %4, %5, %6 HEDEF SATIŞI):
            // Ham fiyatta kâr >= targetTp1Pct (%4, %5, %6) olduğunda tetiklenir!
            // %2'yi geçince stop-loss zaten +%2.0'ye çekildiği için erken cüce satış yapılmaz; tam hedefe koşulur.
            const shouldTriggerFuturesTp1 = !alreadyTp1 && rawPriceDiffPct < targetTp2Pct && (
              rawPriceDiffPct >= targetTp1Pct
            )
            if (shouldTriggerFuturesTp1) {
              const isShortCovering = await isFuturesShortCovering(sym)
              const tp1Ratio = isShortCovering ? 0.75 : 0.50
              const filters = await getFuturesSymbolFilters(sym)
              const stepSize = filters?.stepSize || 0.001
              const fullAmt = parseFloat(formatWithStepSize(fPos.positionAmt, stepSize, filters?.basePrecision || 3))
              const tp1Amt = parseFloat(formatWithStepSize(fPos.positionAmt * tp1Ratio, stepSize, filters?.basePrecision || 3))
              const remainingAmt = parseFloat(formatWithStepSize(fPos.positionAmt - tp1Amt, stepSize, filters?.basePrecision || 3))
              const minQty = filters?.minQty || 0.001
              const minNotional = filters?.minNotional || 5

              const canSplit =
                tp1Amt >= minQty &&
                tp1Amt * markP >= minNotional &&
                remainingAmt >= minQty &&
                remainingAmt * markP >= minNotional * 1.05

              if (canSplit) {
                const closeRes = await executeBinanceFuturesOrder({
                  apiKey: globKey,
                  apiSecret: globSecret,
                  symbol: sym,
                  side: "SELL",
                  type: "MARKET",
                  quantity: tp1Amt,
                  reduceOnly: true,
                })
                if (closeRes.ok) {
                  await setFuturesTp1Taken(sym, true)

                  // 🛡️ ATOMİK STOP GÜNCELLEMESİ (YETİM EMİR KORUMASI):
                  // Monotonik Stop Kuralı: TP1 vurulduğunda kalan pozisyon +0.5R kâr seviyesine kilitlenir!
                  const symFilters = await getFuturesSymbolFilters(sym)
                  const symTick = symFilters?.tickSize || 0.0001
                  const oneRVal = entryP * (dynamicStopDistPct / 100)
                  const tp1LockedStopPrice = parseFloat(formatWithTickSize(entryP + (0.5 * oneRVal), symTick))

                  // 1. Önce yeni STOP_MARKET emrini gönderip borsadan onay al (Milisaniyelik bile korumasız kalmaz):
                  const newStopRes = await executeBinanceFuturesOrder({
                    apiKey: globKey,
                    apiSecret: globSecret,
                    symbol: sym,
                    side: "SELL",
                    type: "STOP_MARKET",
                    stopPrice: tp1LockedStopPrice,
                    quantity: remainingAmt,
                    reduceOnly: true,
                    workingType: "MARK_PRICE",
                  }).catch((err: any) => ({ ok: false, error: err.message, orderId: undefined as string | number | undefined }))

                  // 2. Onay geldikten SONRA eski stop emirlerini temizle (yeni emir hariç):
                  if (newStopRes.ok && newStopRes.orderId) {
                    console.log(logPrefix, `🛡️ [ATOMİK STOP ONAYLANDI] ${sym} yeni +0.5R stop emri kuruldu (OrderId: ${newStopRes.orderId}, Tetik: ${tp1LockedStopPrice}$, Kalan: ${remainingAmt}). Eski emirler temizleniyor.`)
                    await cancelFuturesAllOpenOrders(globKey, globSecret, sym, [newStopRes.orderId]).catch(() => {})
                  } else {
                    console.warn(logPrefix, `⚠️ [ATOMİK STOP UYARISI] ${sym} yeni stop emri reddedildi (${newStopRes.error || "Bilinmiyor"}). Eski stop iptal edilmedi, pozisyon korunuyor!`)
                  }

                  const pnlUsdt = tp1Amt * (markP - entryP)
                  const usdtRate = await getCronUsdtTryRate()
                  const netTry = pnlUsdt * usdtRate
                  const logMsg = isShortCovering
                    ? `🚀 🌐 [BINANCE GLOBAL TP1 ALINDI - SHORT KAPAMA] ${sym} ${fPos.leverage}x Kaldıraç: +%${leveragedRoiPct.toFixed(2)} Net Kâr! Short kapama sönme riskine karşı pozisyonun %75'i nakite çevrildi, kalan %25 sıfır riskle maliyete çekildi.`
                    : `🚀 🌐 [BINANCE GLOBAL TP1 ALINDI] ${sym} ${fPos.leverage}x Kaldıraç: +%${leveragedRoiPct.toFixed(2)} Net Kâr! Pozisyonun %50'si nakite çevrildi, kalan %50 sıfır riskle maliyete (breakeven) çekildi.`
                  executedActions.push(`FUTURES_TP1: ${sym} (+%${leveragedRoiPct.toFixed(2)}${isShortCovering ? " - Short Covering %75" : ""})`)
                  notifyFuturesPartialExit({
                    symbol: sym,
                    leverage: fPos.leverage,
                    pnlUsdt,
                    leveragedRoiPct,
                    exitPrice: markP,
                    entryPrice: entryP,
                  }).catch(() => {})
                  await appendServerLog({
                    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    time: new Date().toLocaleTimeString("tr-TR"),
                    type: "SELL",
                    symbol: sym,
                    message: logMsg,
                  })
                  const histItem: any = {
                    id: `futures-tp1-${sym}-${Date.now()}`,
                    symbol: cleanSym,
                    name: `${cleanSym} (${fPos.leverage}x Vadeli TP1)`,
                    side: "BUY",
                    entryPrice: entryP,
                    currentPrice: markP,
                    closePrice: markP,
                    amount: tp1Amt,
                    totalTry: tp1Amt * entryP * usdtRate,
                    pnl: pnlUsdt,
                    netPnlTry: netTry,
                    pnlPercent: leveragedRoiPct,
                    openedAt: new Date(entryTime).toLocaleTimeString("tr-TR"),
                    openedTimestamp: entryTime,
                    status: "CLOSED",
                    closeReason: isShortCovering
                      ? `Kaldıraçlı TP1 Kâr Satışı (%75 Short Covering) [+%${leveragedRoiPct.toFixed(2)} ROI]`
                      : `Kaldıraçlı TP1 Kâr Satışı (%50) [+%${leveragedRoiPct.toFixed(2)} ROI]`,
                    closedAt: new Date().toISOString(),
                    closedTimestamp: Date.now(),
                    triggerType: "TP",
                    orderType: "MARKET",
                    isFutures: true,
                    leverage: fPos.leverage,
                    exchange: "BINANCE_GLOBAL_FUTURES",
                  }
                  await appendServerHistory(histItem).catch(() => {})
                }
              } else {
                // Pozisyon bölünemeyecek marjinde/küçükse (%50 satışı Binance izin vermez):
                // BOT KENDİ OTOMATİK SATAR: TP1 hedefine ulaşıldığı için %100 TAM SATIŞ yapıp kârı kasaya kilitler!
                const closeClientOrderId = `bot-tp1full-${cleanSym}-${Date.now()}`
                await markFuturesClosing(cleanSym, { clientOrderId: closeClientOrderId, reason: "TP" })

                const closeRes = await executeBinanceFuturesOrder({
                  apiKey: globKey,
                  apiSecret: globSecret,
                  symbol: sym,
                  side: "SELL",
                  type: "MARKET",
                  quantity: fullAmt,
                  reduceOnly: true,
                  newClientOrderId: closeClientOrderId,
                })
                if (closeRes.ok) {
                  closedFuturesSymbols.add(sym)
                  await cancelFuturesAllOpenOrders(globKey, globSecret, sym).catch(() => {})
                  await clearFuturesPositionMeta(sym)
                  await setSymbolCooldown(sym, "TP", 900).catch(() => {})
                  const pnlUsdt = fullAmt * (markP - entryP)
                  const usdtRate = await getCronUsdtTryRate()
                  const netTry = pnlUsdt * usdtRate
                  const logMsg = `🚀 🌐 [BINANCE GLOBAL TP1 TAM KÂR SATIŞI] ${sym} ${fPos.leverage}x Kaldıraç: +%${leveragedRoiPct.toFixed(2)} Net Kâr! Pozisyon minLimit nedeniyle bölünemediği için %100 tam kârla güvenle kapatıldı.`
                  executedActions.push(`FUTURES_TP1_FULL: ${sym} (+%${leveragedRoiPct.toFixed(2)})`)
                  notifyFuturesTradeExit({
                    symbol: sym,
                    leverage: fPos.leverage,
                    pnlUsdt,
                    leveragedRoiPct,
                    exitPrice: markP,
                    entryPrice: entryP,
                    reason: `TP1 Tam Kâr Satışı (+%${leveragedRoiPct.toFixed(2)} ROI)`,
                  }).catch(() => {})
                  await appendServerLog({
                    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    time: new Date().toLocaleTimeString("tr-TR"),
                    type: "SELL",
                    symbol: sym,
                    message: logMsg,
                  })
                  const histItem: any = {
                    id: `futures-tp1full-${sym}-${Date.now()}`,
                    symbol: cleanSym,
                    name: `${cleanSym} (${fPos.leverage}x Vadeli)`,
                    side: "BUY",
                    entryPrice: entryP,
                    currentPrice: markP,
                    closePrice: markP,
                    amount: fullAmt,
                    totalTry: fullAmt * entryP * usdtRate,
                    pnl: pnlUsdt,
                    netPnlTry: netTry,
                    pnlPercent: leveragedRoiPct,
                    openedAt: new Date(entryTime).toLocaleTimeString("tr-TR"),
                    openedTimestamp: entryTime,
                    status: "CLOSED",
                    closeReason: `Kaldıraçlı TP1 Tam Kâr Satışı [+%${leveragedRoiPct.toFixed(2)} ROI]`,
                    closedAt: new Date().toISOString(),
                    closedTimestamp: Date.now(),
                    triggerType: "TP",
                    orderType: "MARKET",
                    isFutures: true,
                    leverage: fPos.leverage,
                    exchange: "BINANCE_GLOBAL_FUTURES",
                  }
                  await appendServerHistory(histItem).catch(() => {})
                  continue
                }
              }
            }

            // B) 🚀 🦅 DİNAMİK ATR TRAILING STOP & MONOTONİK STOP:
            // Trailing stop, breakeven ve stop-loss artık aşağıda Bölüm E'deki Monotonik R-Bazlı Stop Motoru
            // (calculateMonotonicStopTarget: newStop = max(currentStop, candidateStop)) tarafından tek merkezden yönetilir.


            // C.0) ⏱️ ZAMAN BAZLI ÇIKIŞ (DİP AVCISI TIME-STOP):
            // Dipten alınan coin 45 - 90 dakika (posHours >= 0.75 && posHours <= 1.5) sonunda
            // kâra geçemeyip zararda sürünüyorsa (rawPriceDiffPct < -0.35) VE son iki 15m mumunda CVD azalıyorsa 2. satış dalgasına yakalanmamak için kapat:
            let isCvdDeclining = true
            if (klines15mList && klines15mList.length >= 3) {
              const m1 = klines15mList[klines15mList.length - 2]
              const m2 = klines15mList[klines15mList.length - 3]
              const m1Vol = parseFloat(m1[7]) || 1
              const m1Taker = parseFloat(m1[10]) || 0
              const m1Ratio = m1Taker / m1Vol
              const m2Vol = parseFloat(m2[7]) || 1
              const m2Taker = parseFloat(m2[10]) || 0
              const m2Ratio = m2Taker / m2Vol
              isCvdDeclining = m1Ratio <= m2Ratio && m1Ratio < 0.46
            }
            const isDipTimeStopTriggered = posHours >= 0.75 && posHours <= 1.5 && rawPriceDiffPct < -0.35 && isCvdDeclining
            if (isDipTimeStopTriggered) {
              const filters = await getFuturesSymbolFilters(sym)
              const stepSize = filters?.stepSize || 0.001
              const fullAmt = parseFloat(formatWithStepSize(fPos.positionAmt, stepSize, filters?.basePrecision || 3))

              const closeClientOrderId = `bot-timestop-${cleanSym}-${Date.now()}`
              await markFuturesClosing(cleanSym, { clientOrderId: closeClientOrderId, reason: "TIME_EXIT" })

              const closeRes = await executeBinanceFuturesOrder({
                apiKey: globKey,
                apiSecret: globSecret,
                symbol: sym,
                side: "SELL",
                type: "MARKET",
                quantity: fullAmt,
                reduceOnly: true,
                newClientOrderId: closeClientOrderId,
              })
              if (closeRes.ok) {
                closedFuturesSymbols.add(sym)
                await cancelFuturesAllOpenOrders(globKey, globSecret, sym).catch(() => {})
                await clearFuturesPositionMeta(sym)
                await setSymbolCooldown(sym, "TIME_STOP", 1800).catch(() => {})
                const pnlUsdt = fullAmt * (markP - entryP)
                const usdtRate = await getCronUsdtTryRate()
                const netTry = pnlUsdt * usdtRate
                const logMsg = `⏱️ 🌐 [DİP AVCISI TIME-STOP] ${sym} ${posHours.toFixed(1)}s (45-60dk) içinde beklenen +%1.5 tepkiyi veremedi. İkinci satış dalgasından korunmak için başabaş güvenle kapatıldı.`
                executedActions.push(`FUTURES_DIP_TIME_STOP: ${sym} (%${rawPriceDiffPct.toFixed(2)})`)
                notifyFuturesTradeExit({
                  symbol: sym,
                  leverage: fPos.leverage,
                  pnlUsdt,
                  leveragedRoiPct,
                  exitPrice: markP,
                  entryPrice: entryP,
                  reason: `Dip Avcısı Time-Stop (45-60dk tepki gecikmesi)`,
                }).catch(() => {})
                await appendServerLog({
                  id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  time: new Date().toLocaleTimeString("tr-TR"),
                  type: "SELL",
                  symbol: sym,
                  message: logMsg,
                })
                const histItem: any = {
                  id: `futures-timestop-${sym}-${Date.now()}`,
                  symbol: cleanSym,
                  name: `${cleanSym} (${fPos.leverage}x Vadeli Time-Stop)`,
                  side: "BUY",
                  entryPrice: entryP,
                  currentPrice: markP,
                  closePrice: markP,
                  amount: fullAmt,
                  totalTry: fullAmt * entryP * usdtRate,
                  pnl: pnlUsdt,
                  netPnlTry: netTry,
                  pnlPercent: leveragedRoiPct,
                  openedAt: new Date(entryTime).toLocaleTimeString("tr-TR"),
                  openedTimestamp: entryTime,
                  status: "CLOSED",
                  closeReason: `Dip Avcısı Time-Stop (45-60dk tepki gecikmesi)`,
                  closedAt: new Date().toISOString(),
                  closedTimestamp: Date.now(),
                  triggerType: "TIME_EXIT",
                  orderType: "MARKET",
                  isFutures: true,
                  leverage: fPos.leverage,
                  exchange: "BINANCE_GLOBAL_FUTURES",
                }
                await appendServerHistory(histItem).catch(() => {})
                continue
              }
            }

            // C) ⚡ 🔄 YENİ: SERİ FIRSAT ROTASYONU (Kaldıraçta Marjin Kilitli Kalmasın)
            // 1. En az 3.5 saat geÃ§miÅŸse (posHours >= 3.5)
            // 2. Fiyat yukarÄ± patlayamayÄ±p sÄ±kÄ±ÅŸmÄ±ÅŸsa (peakRoiPct < 6.0, fiyatta %1.2 yÃ¼kseliÅŸi aÅŸamamÄ±ÅŸsa)
            // 3. Pozisyon net kÃ¢rda ise (leveragedRoiPct >= 2.0, komisyonlar hariÃ§ en az +%2.0 net hesap kÃ¢rÄ±)
            // 4. Meme coin DEÄÄ°LSE (!isMeme - patlama potansiyeli korunur)
            // 5. DÄ±ÅŸarÄ±da bekleyen gÃ¼Ã§lÃ¼ alternatif varsa
            let isFuturesStaleExit = false
            if (
              posHours >= 12.0 &&
              peakRoiPct < 6.0 &&
              leveragedRoiPct >= 3.0 &&
              !isMeme
            ) {
              try {
                const tickRes = await publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr`, {
                  signal: AbortSignal.timeout(4000),
                  cache: "no-store",
                }, 180000)
                if (tickRes.ok) {
                  const list24: any[] = await tickRes.json()
                  const strongAlts = list24.filter((item: any) => {
                    if (!item.symbol?.endsWith("USDT")) return false
                    const s = item.symbol.replace("USDT", "").toUpperCase()
                    if (s === cleanSym || FIAT_STABLES.has(s) || DEAD_TOKENS.has(s)) return false
                    const qv = parseFloat(item.quoteVolume) || 0
                    const chg = parseFloat(item.priceChangePercent) || 0
                    return qv >= 25000000 && chg >= 1.0 && chg <= 8.5
                  })
                  if (strongAlts.length >= 2) {
                    isFuturesStaleExit = true
                  }
                }
              } catch {}
            }

            if (isFuturesStaleExit) {
              const filters = await getFuturesSymbolFilters(sym)
              const stepSize = filters?.stepSize || 0.001
              const fullAmt = parseFloat(formatWithStepSize(fPos.positionAmt, stepSize, filters?.basePrecision || 3))

              const closeClientOrderId = `bot-stale-${cleanSym}-${Date.now()}`
              await markFuturesClosing(cleanSym, { clientOrderId: closeClientOrderId, reason: "TIME_EXIT" })

              const closeRes = await executeBinanceFuturesOrder({
                apiKey: globKey,
                apiSecret: globSecret,
                symbol: sym,
                side: "SELL",
                type: "MARKET",
                quantity: fullAmt,
                reduceOnly: true,
                newClientOrderId: closeClientOrderId,
              })
              if (closeRes.ok) {
                closedFuturesSymbols.add(sym)
                await cancelFuturesAllOpenOrders(globKey, globSecret, sym).catch(() => {})
                await clearFuturesPositionMeta(sym)
                await setSymbolCooldown(sym, "TIME_STOP", 1800).catch(() => {})
                const logMsg = `âš¡ ğŸŒ [BINANCE GLOBAL FIRSAT ROTASYONU] ${sym} ${posHours.toFixed(1)}s Yatay SÄ±kÄ±ÅŸma â” Net KÃ¢rla Ã‡Ä±kÄ±ÅŸ: +%${leveragedRoiPct.toFixed(2)} ROI, Marjin Serbest BÄ±rakÄ±ldÄ± [6s & +%3.0 ROI kuralÄ±].`
                executedActions.push(`FUTURES_STALE_ROTATION: ${sym} (+%${leveragedRoiPct.toFixed(2)})`)
                notifyFuturesTradeExit({
                  symbol: sym,
                  leverage: fPos.leverage,
                  pnlUsdt: fullAmt * (markP - entryP),
                  leveragedRoiPct,
                  exitPrice: markP,
                  entryPrice: entryP,
                  reason: `Fırsat Rotasyonu (${posHours.toFixed(1)}s Yatay Sıkışma Sonrası +%${leveragedRoiPct.toFixed(1)} Net Kârla Çıkış)`,
                }).catch(() => {})
                await appendServerLog({
                  id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  time: new Date().toLocaleTimeString("tr-TR"),
                  type: "SELL",
                  symbol: sym,
                  message: logMsg,
                })
                const pnlUsdt = fullAmt * (markP - entryP)
                const usdtRate = await getCronUsdtTryRate()
                const netTry = pnlUsdt * usdtRate
                const histItem: any = {
                  id: `futures-stale-${sym}-${Date.now()}`,
                  symbol: cleanSym,
                  name: `${cleanSym} (${fPos.leverage}x Vadeli)`,
                  side: "BUY",
                  entryPrice: entryP,
                  currentPrice: markP,
                  closePrice: markP,
                  amount: fullAmt,
                  totalTry: fullAmt * entryP * usdtRate,
                  pnl: pnlUsdt,
                  netPnlTry: netTry,
                  pnlPercent: leveragedRoiPct,
                  openedAt: new Date(entryTime).toLocaleTimeString("tr-TR"),
                  openedTimestamp: entryTime,
                  status: "CLOSED",
                  closeReason: `Fırsat Rotasyonu (${posHours.toFixed(1)}s Yatay Sıkışma Sonrası +%${leveragedRoiPct.toFixed(1)} Net Kârla Çıkış)`,
                  closedAt: new Date().toISOString(),
                  closedTimestamp: Date.now(),
                  triggerType: "TIME_EXIT",
                  orderType: "MARKET",
                  isFutures: true,
                  leverage: fPos.leverage,
                  exchange: "BINANCE_GLOBAL_FUTURES",
                }
                await appendServerHistory(histItem).catch(() => {})
                continue
              }
            }

            // D) ğŸš€ ZÄ°RVE TP2 (Zirve Fiyat Hareketi -> 5x'te +%15 - +%20 Dev KÃ¢r):
            if (rawPriceDiffPct >= targetTp2Pct) {
              const filters = await getFuturesSymbolFilters(sym)
              const stepSize = filters?.stepSize || 0.001
              const fullAmt = parseFloat(formatWithStepSize(fPos.positionAmt, stepSize, filters?.basePrecision || 3))

              const closeClientOrderId = `bot-tp2-${cleanSym}-${Date.now()}`
              await markFuturesClosing(cleanSym, { clientOrderId: closeClientOrderId, reason: "TP" })

              const closeRes = await executeBinanceFuturesOrder({
                apiKey: globKey,
                apiSecret: globSecret,
                symbol: sym,
                side: "SELL",
                type: "MARKET",
                quantity: fullAmt,
                reduceOnly: true,
                newClientOrderId: closeClientOrderId,
              })
              if (closeRes.ok) {
                closedFuturesSymbols.add(sym)
                await cancelFuturesAllOpenOrders(globKey, globSecret, sym).catch(() => {})
                await clearFuturesPositionMeta(sym)
                await setSymbolCooldown(sym, "TP", 900).catch(() => {})
                const logMsg = `ğŸ¯ ğŸŒ [BINANCE GLOBAL ZÄ°RVE KÃ‚R KAPATILDI] ${sym} ${fPos.leverage}x KaldÄ±raÃ§: +%${leveragedRoiPct.toFixed(2)} Dev KÃ¢rla Tamamen KapatÄ±ldÄ±!`
                executedActions.push(`FUTURES_TP2: ${sym} (+%${leveragedRoiPct.toFixed(2)})`)
                notifyFuturesTradeExit({
                  symbol: sym,
                  leverage: fPos.leverage,
                  pnlUsdt: fullAmt * (markP - entryP),
                  leveragedRoiPct,
                  exitPrice: markP,
                  entryPrice: entryP,
                  reason: `Zirve TP2 Dev Kâr (+%${leveragedRoiPct.toFixed(2)} ROI)`,
                }).catch(() => {})
                await appendServerLog({
                  id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  time: new Date().toLocaleTimeString("tr-TR"),
                  type: "SELL",
                  symbol: sym,
                  message: logMsg,
                })
                const pnlUsdt = fullAmt * (markP - entryP)
                const usdtRate = await getCronUsdtTryRate()
                const netTry = pnlUsdt * usdtRate
                const histItem: any = {
                  id: `futures-tp2-${sym}-${Date.now()}`,
                  symbol: cleanSym,
                  name: `${cleanSym} (${fPos.leverage}x Vadeli)`,
                  side: "BUY",
                  entryPrice: entryP,
                  currentPrice: markP,
                  closePrice: markP,
                  amount: fullAmt,
                  totalTry: fullAmt * entryP * usdtRate,
                  pnl: pnlUsdt,
                  netPnlTry: netTry,
                  pnlPercent: leveragedRoiPct,
                  openedAt: new Date(entryTime).toLocaleTimeString("tr-TR"),
                  openedTimestamp: entryTime,
                  status: "CLOSED",
                  closeReason: `Zirve TP2 Dev Kâr (+%${leveragedRoiPct.toFixed(2)} ROI)`,
                  closedAt: new Date().toISOString(),
                  closedTimestamp: Date.now(),
                  triggerType: "TP",
                  orderType: "MARKET",
                  isFutures: true,
                  leverage: fPos.leverage,
                  exchange: "BINANCE_GLOBAL_FUTURES",
                }
                await appendServerHistory(histItem).catch(() => {})
                continue
              }
            }

            // E) 🛡️ MONOTONİK R-BAZLI STOP MOTORU (INITIAL -> BREAKEVEN -> TP1 LOCK -> TRAILING)
            // Kuralların birbiriyle çelişmesini ve stopun aşağıya çekilmesini engeller:
            // newStop = max(currentStop, candidateStop). Asla geriye çekilmez!
            // 1. Başlangıç Stopu: -1R
            // 2. +0.8R görüldüğünde: Başabaş stopu (giriş * 1.002)
            // 3. TP1 (+1.2R) vurulduğunda: +0.5R kâr kilidi
            // 4. +1.5R görüldüğünde: 0.8 x ATR Takipçi stop
            if (markP <= monoStop.newStopPrice) {
              const filters = await getFuturesSymbolFilters(sym)
              const stepSize = filters?.stepSize || 0.001
              const fullAmt = parseFloat(formatWithStepSize(fPos.positionAmt, stepSize, filters?.basePrecision || 3))

              const isSlOrBe = monoStop.stopStage === "INITIAL" || monoStop.stopStage === "BREAKEVEN"
              const closeClientOrderId = `bot-mono-${cleanSym}-${Date.now()}`
              await markFuturesClosing(cleanSym, { clientOrderId: closeClientOrderId, reason: isSlOrBe ? "SL" : "TP" })

              const closeRes = await executeBinanceFuturesOrder({
                apiKey: globKey,
                apiSecret: globSecret,
                symbol: sym,
                side: "SELL",
                type: "MARKET",
                quantity: fullAmt,
                reduceOnly: true,
                newClientOrderId: closeClientOrderId,
              })
              if (closeRes.ok) {
                closedFuturesSymbols.add(sym)
                await cancelFuturesAllOpenOrders(globKey, globSecret, sym).catch(() => {})
                await clearFuturesPositionMeta(sym)

                const cdReason = monoStop.stopStage === "INITIAL" ? "SL" : monoStop.stopStage === "BREAKEVEN" ? "BREAKEVEN" : "TP"
                const cdDuration = cdReason === "SL" ? 3600 : cdReason === "BREAKEVEN" ? 1800 : 900
                await setSymbolCooldown(sym, cdReason, cdDuration).catch(() => {})

                const triggerLabel = monoStop.stopStage === "INITIAL"
                  ? "SERMAYE KORUMA STOPU"
                  : monoStop.stopStage === "BREAKEVEN"
                  ? "BAŞABAŞ GÜVENCE STOPU"
                  : monoStop.stopStage === "TP1_LOCKED"
                  ? "TP1 +0.5R KÂR KİLİDİ"
                  : "DİNAMİK ATR TRAILING STOP"

                const logMsg = `🛡️ 🌐 [MONOTONİK STOP - ${triggerLabel}] ${sym} ${fPos.leverage}x Kaldıraç: ${monoStop.stageReason}. Tetik: ${monoStop.newStopPrice}$, Anlık: ${markP}$, ROI: %${leveragedRoiPct.toFixed(2)}`
                executedActions.push(`FUTURES_MONO_STOP_${monoStop.stopStage}: ${sym} (%${leveragedRoiPct.toFixed(2)})`)

                notifyFuturesTradeExit({
                  symbol: sym,
                  leverage: fPos.leverage,
                  pnlUsdt: fullAmt * (markP - entryP),
                  leveragedRoiPct,
                  exitPrice: markP,
                  entryPrice: entryP,
                  reason: monoStop.stageReason,
                }).catch(() => {})

                await appendServerLog({
                  id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  time: new Date().toLocaleTimeString("tr-TR"),
                  type: monoStop.stopStage === "INITIAL" ? "ALERT" : "SELL",
                  symbol: sym,
                  message: logMsg,
                })

                const pnlUsdt = fullAmt * (markP - entryP)
                const usdtRate = await getCronUsdtTryRate()
                const netTry = pnlUsdt * usdtRate
                const histItem: any = {
                  id: `futures-mono-${sym}-${Date.now()}`,
                  symbol: cleanSym,
                  name: `${cleanSym} (${fPos.leverage}x Vadeli - ${triggerLabel})`,
                  side: "BUY",
                  entryPrice: entryP,
                  currentPrice: markP,
                  closePrice: markP,
                  amount: fullAmt,
                  totalTry: fullAmt * entryP * usdtRate,
                  pnl: pnlUsdt,
                  netPnlTry: netTry,
                  pnlPercent: leveragedRoiPct,
                  openedAt: new Date(entryTime).toLocaleTimeString("tr-TR"),
                  openedTimestamp: entryTime,
                  status: "CLOSED",
                  closeReason: monoStop.stageReason,
                  closedAt: new Date().toISOString(),
                  closedTimestamp: Date.now(),
                  triggerType: monoStop.stopStage === "INITIAL" ? "SL" : monoStop.stopStage === "BREAKEVEN" ? "BREAKEVEN" : monoStop.stopStage === "TRAILING" ? "TRAILING_STOP" : "TP",
                  orderType: "MARKET",
                  isFutures: true,
                  leverage: fPos.leverage,
                  exchange: "BINANCE_GLOBAL_FUTURES",
                }
                await appendServerHistory(histItem).catch(() => {})
                continue
              }
            }
          }

          // 2. YENÄ° KALDIRAÃ‡LI Ä°ÅLEM FIRSATI ARAMA (2-SLOT HÄ°BRÄ°T MOTORU)
          if (closedFuturesSymbols.size > 0) {
            openFuturesPos = openFuturesPos.filter((p) => !closedFuturesSymbols.has(p.symbol))
            try {
              const freshBalance = await getFuturesAccountBalance(globKey, globSecret)
              if (freshBalance.ok && typeof freshBalance.availableBalanceUsdt === "number") {
                availUsdt = freshBalance.availableBalanceUsdt
                console.log(logPrefix, `💰 Pozisyon kapatıldı (${Array.from(closedFuturesSymbols).join(", ")}), güncel serbest teminat: ${availUsdt.toFixed(2)} USDT`)
              }
            } catch {}
          }

          const globalConcurrentCap = exchangeSettings?.maxConcurrentPositionsCap || 2
          const configuredFuturesSlots = Math.max(1, slotConfig?.targetSlots ?? exchangeSettings?.maxSlots ?? 2)
          const wantedFuturesSlots = Math.max(1, Math.min(globalConcurrentCap, configuredFuturesSlots))
          const maxFuturesSlots = wantedFuturesSlots

          // 🛡️ GÜNLÜK ZARAR DEVRE KESİCİ (FUTURES):
          // Gün başı bakiyesi (futuresDayStartUsdt) ile güncel serbest teminat karşılaştırılır;
          // maxDailyLossPct (>=%5 varsayılan) aşılırsa yeni kaldıraçlı alımlar KİLİTLENİR.
          let futuresDailyLossBlock = false
          if (futuresDayStartUsdt > 0 && availUsdt < futuresDayStartUsdt) {
            const dayLossPct = ((futuresDayStartUsdt - availUsdt) / futuresDayStartUsdt) * 100
            if (dayLossPct >= botRisk.maxDailyLossPct && !isSnipeMode) {
              futuresDailyLossBlock = true
              if (futuresSummary) {
                futuresSummary.message = `📉 GÜNLÜK ZARAR KİLİDİ: Gün başı ${futuresDayStartUsdt.toFixed(2)} USDT → şimdi ${availUsdt.toFixed(2)} USDT (-%${dayLossPct.toFixed(2)}, sınır %${botRisk.maxDailyLossPct}). Yeni alımlar durduruldu, açık pozisyonlar TP/SL ile korunuyor.`
              }
              console.warn(logPrefix, `📉 [FUTURES GÜNLÜK DEVRE KESİCİ] Gün başı ${futuresDayStartUsdt.toFixed(2)} → ${availUsdt.toFixed(2)} USDT (zarar %${dayLossPct.toFixed(2)} >= %${botRisk.maxDailyLossPct}). Yeni vadeli alımlar kilitlendi.`)
            }
          }

          const futuresManualPause = await isServerManualSellCooldown()
          if (futuresDailyLossBlock) {
            console.warn(logPrefix, `📉 Günlük zarar sınırı aşıldı → yeni vadeli alım yapılmıyor (açık pozisyonlar korunuyor).`)
          } else if (futuresManualPause.active) {
            console.log(logPrefix, `⏸️ Kullanıcı manuel satış yaptı. 30 dakikalık (2 mum) soğuma kuralı devrede (${futuresManualPause.remainingSec}s kaldı). Yeni alım yapılmıyor.`)
          } else if (isActive && openFuturesPos.length < maxFuturesSlots && availUsdt >= 0.35) {
            // 🛡️ BİNANCE GLOBAL KALKAN KURALI: BTC ÇÖKÜŞTEYKEN ASLA KALDIRAÇLI LONG AÇMA!
            let isBtcSafeForLong = true
            let isBtcCircuitBreakerActive = false
            let btcChange15mPct = 0
            let btcTakerBuy15mPct = 50

            let btcShieldReason = ""
            try {
              const [btc15mRes, btc5mRes] = await Promise.all([
                publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=5`, { cache: "no-store" }, 15000),
                publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=16`, { cache: "no-store" }, 15000),
              ])

              if (btc15mRes.ok) {
                const btcKlines = await btc15mRes.json()
                if (Array.isArray(btcKlines) && btcKlines.length >= 3) {
                  // 🔒 KAPANMIŞ SON 15M MUMU (index [-2]) KULLANILIR (Canlı oynayan [-1] değil! - REPAINT ENGELİ):
                  const closed15m = btcKlines[btcKlines.length - 2]
                  const prevClosed15m = btcKlines[btcKlines.length - 3]
                  const btcOpen15m = parseFloat(closed15m[1])
                  const btcHigh15m = parseFloat(closed15m[2])
                  const btcLow15m = parseFloat(closed15m[3])
                  const btcClose15m = parseFloat(closed15m[4])
                  const btcVol15m = parseFloat(closed15m[7]) || 0
                  const btcTaker15m = parseFloat(closed15m[10]) || 0
                  btcTakerBuy15mPct = btcVol15m > 0 ? (btcTaker15m / btcVol15m) * 100 : 50

                  const prevClose = parseFloat(prevClosed15m[4])
                  if (prevClose > 0) {
                    btcChange15mPct = ((btcClose15m - prevClose) / prevClose) * 100
                  }

                  const btcCandleRange = btcHigh15m - btcLow15m
                  const btcBody = Math.abs(btcClose15m - btcOpen15m)
                  // Gövdeli kırmızı mum: Kapanış < Açılış ve gövde toplam aralığın en az %40'ı
                  const isSolidRed15m = (btcClose15m < btcOpen15m) && (btcCandleRange > 0 ? (btcBody / btcCandleRange >= 0.40) : true)

                  // 🛑 ŞALTER KURALI: 15m gerçek panik çöküşü (Düşüş <= -0.80% veya sert gövde + aşırı satıcı Taker Buy < %38)
                  const isCrashPlunge15m = btcChange15mPct <= -0.80 || (btcChange15mPct <= -0.50 && isSolidRed15m && btcTakerBuy15mPct < 38)
                  if (isCrashPlunge15m) {
                    isBtcCircuitBreakerActive = true
                    isBtcSafeForLong = false
                    btcShieldReason = `BTC 15m sert düşüş (%${btcChange15mPct.toFixed(2)}, Taker %${btcTakerBuy15mPct.toFixed(1)})`
                    console.warn(logPrefix, `🛑 [BTC GLOBAL CIRCUIT BREAKER AKTİF] BTC son kapanan 15m mumu sert çöküş (%${btcChange15mPct.toFixed(2)}) ve Taker Buy %${btcTakerBuy15mPct.toFixed(1)} < %38! Tüm altcoin alımları HOLD (bekleme) moduna alındı.`)
                  }
                }
              }

              // 5 dakikalıkta aşırı satış baskısı teyidi (Kapanmış son 5m mumu index [-2])
              // Volatilite Eşiği: Yatay piyasadaki %0.05-%0.25 mikro gürültü mumlarında kilitlenmeyi önler (Düşüş >= %0.30 VE >= 1.2 * ATR)
              if (btc5mRes.ok && isBtcSafeForLong) {
                const btc5mKlines = await btc5mRes.json()
                if (Array.isArray(btc5mKlines) && btc5mKlines.length >= 16) {
                  const closed5m = btc5mKlines[btc5mKlines.length - 2]
                  const b5Vol = parseFloat(closed5m[7]) || 0
                  const b5Taker = parseFloat(closed5m[10]) || 0
                  const b5TakerPct = b5Vol > 0 ? (b5Taker / b5Vol) * 100 : 50

                  const c5List: Candle[] = btc5mKlines.slice(0, -1).map((k: any) => ({
                    t: Number(k[0]), o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5])
                  }))
                  const s5 = atrSeries(c5List, 14)
                  const curAtr5m = s5[s5.length - 1] || Math.max(10, parseFloat(closed5m[2]) - parseFloat(closed5m[3]))
                  const open5m = parseFloat(closed5m[1]) || 1
                  const drop5m = open5m - parseFloat(closed5m[4]) // Açılış - Kapanış
                  const drop5mPct = (drop5m / open5m) * 100

                  if (drop5mPct >= 0.30 && drop5m >= 1.2 * curAtr5m && b5TakerPct < 36) {
                    isBtcSafeForLong = false
                    btcShieldReason = `BTC 5m sert satış (%-${drop5mPct.toFixed(2)}, Taker %${b5TakerPct.toFixed(1)})`
                    console.warn(logPrefix, `🛑 [BTC 5M BASKI] BTC son 5m mumunda sert düşüş (%-${drop5mPct.toFixed(2)}, ${drop5m.toFixed(1)}$ >= 1.2*ATR ${curAtr5m.toFixed(1)}$) ve Taker Buy %${b5TakerPct.toFixed(1)} < %36! Yeni pozisyon geçici kilitlendi.`)
                  }
                }
              }
            } catch (btcErr: any) {
              console.warn(logPrefix, "BTC kalkan kontrolü hatası:", btcErr.message)
            }

            // ğŸ›¡ï¸            // 🌐 Sektör Sepetlerinin 24h Ortalama Göreli Güç (RS) Liderliğini ve Global Piyasa Genişliğini dinamik hesapla:
            let dynamicSectorBonuses = new Map<string, { sectorKey: string; sectorName: string; bonus: number; avgRs: number }>()
            const futures24hQuoteVol = new Map<string, number>()
            try {
              const tick24AllRes = await publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr`, { cache: "no-store" }, 120000)
              if (tick24AllRes.ok) {
                const all24hList = await tick24AllRes.json()
                if (Array.isArray(all24hList)) {
                  const btcItem = all24hList.find((t: any) => t.symbol === "BTCUSDT")
                  const btcChg = btcItem ? parseFloat(btcItem.priceChangePercent) || 0 : 0
                  dynamicSectorBonuses = calculateDynamicSectorBonuses(all24hList, btcChg)

                  let redFuturesCount = 0
                  let liquidFuturesCount = 0
                  for (const item of all24hList) {
                    if (!item?.symbol?.endsWith("USDT")) continue
                    const qv = parseFloat(item.quoteVolume) || 0
                    futures24hQuoteVol.set(item.symbol, qv)
                    if (qv >= 5_000_000) {
                      liquidFuturesCount++
                      if ((parseFloat(item.priceChangePercent) || 0) < 0) redFuturesCount++
                    }
                  }
                  if (liquidFuturesCount > 0) {
                    globalMarketRedRatioPct = (redFuturesCount / liquidFuturesCount) * 100
                  }
                }
              }
            } catch {}

            // 🛡️ BİNANCE GLOBAL KALKAN KURALI: Piyasanın %60+'ı kırmızıysa dip avcısı, %85+'ı kırmızıysa koruma!
            const isHighRedMarket = globalMarketRedRatioPct >= 60
            if (globalMarketRedRatioPct >= 85) {
              isBtcSafeForLong = false
              console.warn(logPrefix, `🐻 [FUTURES KORUMASI] Piyasanın %${Math.round(globalMarketRedRatioPct)}'si kırmızı. Kaldıraçlı Long açılışları kilitlendi, teminat korundu.`)
            }

            if (isBtcSafeForLong) {
              // 🌐 COINGECKO ÖN FİLTRE LİSTESİ KONTROLÜ (Günde birkaç kez güncellenir, 6 saat geçerlidir)
              let prefilterState = await getCoinGeckoPrefilterState()
              let isFresh = isPrefilterFresh(prefilterState)

              if (!isFresh) {
                console.log(logPrefix, "🔄 [COINGECKO ÖN FİLTRE] Önbellek boş veya 6 saatten eski. Yeni liste taranıyor...")
                try {
                  // Binance Futures'ta açık işlem gören çiftleri topla
                  const exchangePairs = new Set<string>()
                  try {
                    const tickRes = await publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr`)
                    if (tickRes.ok) {
                      const tList: any[] = await tickRes.json()
                      for (const t of tList) {
                        if (t.symbol?.endsWith("USDT")) exchangePairs.add(t.symbol)
                      }
                    }
                  } catch {}

                  const newState = await refreshCoinGeckoPrefilter({ exchangePairs })
                  if (newState.candidates.length > 0) {
                    await setCoinGeckoPrefilterState(newState)
                    prefilterState = newState
                    isFresh = true
                    console.log(logPrefix, `✅ [COINGECKO ÖN FİLTRE] ${newState.candidates.length} adet onaylı coin listelendi. İlk 3: ${newState.candidates.slice(0, 3).map((c: any) => c.binanceSymbol).join(", ")}. Elenen: ${newState.eliminated.length} coin.`)
                  }
                } catch (cgErr: any) {
                  console.error(logPrefix, "🚨 [COINGECKO ÖN FİLTRE HATA]", cgErr.message)
                }
              }

              // Liste hâlâ boşsa veya 6 saatten eskiyse GÜVENLİK GEREĞİ yeni pozisyon açma!
              if (!isFresh || !prefilterState || prefilterState.candidates.length === 0) {
                console.warn(logPrefix, "⏸️ [GÜVENLİK ENGELİ] CoinGecko ön filtre listesi boş veya 6 saatten eski (bayat). Yeni pozisyon açılışı kilitlendi!")
                return NextResponse.json({
                  ok: true,
                  message: "CoinGecko ön filtre listesi bayat veya boş, yeni pozisyon açılmadı.",
                  timestamp,
                })
              }

              // CoinGecko ön filtre listesi + Ana Likit Vadeli Çiftler (SOL, BNB, XRP, DOGE, SUI, NEAR, AVAX, LINK vb. dışarıda kalmasın)
              const cgPairs: string[] = prefilterState.candidates.map((c: FilteredCandidate) => c.binanceSymbol)
              const THIN_FUTURES_BLACKLIST = new Set(["BTWUSDT", "AKEUSDT", "VVVUSDT", "BIOUSDT", "TSTUSDT", "BROCCOLIUSDT", "WLDUSDT"])
              const rawPrefilteredPairs: string[] = Array.from(new Set([...FALLBACK_TOP_PAIRS, ...cgPairs]))
              const prefilteredPairs: string[] = rawPrefilteredPairs.filter((sym) => {
                if (THIN_FUTURES_BLACKLIST.has(sym)) return false
                if (futures24hQuoteVol.size > 0) {
                  const fVol = futures24hQuoteVol.get(sym) || 0
                  if (fVol < 25_000_000) return false
                }
                return true
              })
              const openSymbols = new Set(openFuturesPos.map((p) => p.symbol.toUpperCase()))

              // 🛡️ Açık pozisyonları ve Soğuma (Cooldown) sürecindeki coinleri ele:
              const availableCandidates: string[] = []
              for (const s of prefilteredPairs) {
                if (openSymbols.has(s)) continue
                const cd = await isSymbolInCooldown(s)
                if (cd.active) {
                  console.log(logPrefix, `⏳ [COOLDOWN DEVREDE] ${s} soğuma sürecinde (${cd.reason}, ${cd.remainingSec}s kaldı), aday listesinden elendi.`)
                  continue
                }
                availableCandidates.push(s)
              }

              // 🌐 Grok & Token Unlock Duygu Verilerini Arka Planda Isıt (Non-blocking):
              // ENTRY anında dış API beklemeden milisaniyede Redis'ten okunmasını sağlar
              prewarmGrokWatchlistCache(availableCandidates).catch(() => {})

              if (availableCandidates.length === 0) {
                console.log(logPrefix, "ℹ️ CoinGecko ön filtre listesindeki tüm adaylar halihazırda açık pozisyonda, soğuma (cooldown) sürecinde veya slot dolu.")
              }

              // 🧮 FUTURES ADAY PUANLAMA (Trend Takipçisi, Göreli Güç, Likidasyon Temizliği & Dip Avcısı):
              type FuturesScored = {
                candSym: string
                curPrice: number
                score: number
                reasons: string[]
                snapshot: string
                smartMoneyRegime?: string
                isShortCovering?: boolean
              }
              const minFuturesScore = isHighRedMarket ? 80 : 55
              const rejectionReasons: Record<string, string> = {}

              const evaluateFuturesCandidate = async (candSym: string): Promise<FuturesScored | null> => {
                try {
                  const [kRes15m, kRes5m, bookRes, premRes, liqStats, oiStats, depth5] = await Promise.all([
                    publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=${candSym}&interval=15m&limit=30`),
                    publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=${candSym}&interval=5m&limit=30`),
                    publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/bookTicker?symbol=${candSym}`, { cache: "no-store" }, 30000),
                    publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${candSym}`, { cache: "no-store" }, 60000),
                    getSymbolLiquidationStats(candSym, 20 * 60 * 1000, 500).catch(() => ({
                      symbol: candSym,
                      longLiquidationUsdt: 0,
                      shortLiquidationUsdt: 0,
                      longCount: 0,
                      shortCount: 0,
                      hasLongFlush: false,
                    })),
                    getFuturesOpenInterestStats(candSym).catch(() => ({ openInterest: 0, oiChangePct: 0 })),
                    getFuturesOrderBookTop5(candSym).catch(() => null),
                  ])
                  if (!kRes15m.ok || !kRes5m.ok) {
                    rejectionReasons[candSym] = `kline_http_${kRes15m.status}_${kRes5m.status}`
                    return null
                  }
                  const klines15m = await kRes15m.json().catch(() => null)
                  const klines5m = await kRes5m.json().catch(() => null)
                  if (!Array.isArray(klines15m) || klines15m.length < 20) {
                    rejectionReasons[candSym] = `klines15m_len_${Array.isArray(klines15m) ? klines15m.length : JSON.stringify(klines15m).slice(0, 60)}`
                    return null
                  }
                  if (!Array.isArray(klines5m) || klines5m.length < 20) {
                    rejectionReasons[candSym] = `klines5m_len_${Array.isArray(klines5m) ? klines5m.length : JSON.stringify(klines5m).slice(0, 60)}`
                    return null
                  }

                  const closes15m = klines15m.map((k: any) => parseFloat(k[4]))
                  const curPrice = closes15m[closes15m.length - 1]

                  // İlk 5 kademe alış derinliğini hesapla (bookTicker yalnızca tek L1 mikro-tick verir!)
                  let top5BidDepthUsdt = 0
                  if (depth5 && Array.isArray(depth5.bids)) {
                    for (const b of depth5.bids) {
                      const bp = parseFloat(String(b[0])) || 0
                      const bq = parseFloat(String(b[1])) || 0
                      top5BidDepthUsdt += bp * bq
                    }
                  }

                  // 1) Emir Defteri Derinliği & Bid-Ask Spread Kontrolü (Kayma / Slippage Koruması)
                  let spreadPct = 0.05
                  let topBidDepthUsdt = 10000
                  if (bookRes.ok) {
                    try {
                      const book = await bookRes.json()
                      const bPrice = parseFloat(book.bidPrice || "0")
                      const aPrice = parseFloat(book.askPrice || "0")
                      const bQty = parseFloat(book.bidQty || "0")
                      if (bPrice > 0 && aPrice > 0) {
                        spreadPct = ((aPrice - bPrice) / bPrice) * 100
                        topBidDepthUsdt = Math.max(bPrice * bQty, top5BidDepthUsdt)
                        // Sığ tahta veya geniş makas (> %0.20): Çöküşte piyasa yapıcılar çekilmiş, kesinlikle girme!
                        if (spreadPct > 0.20) {
                          rejectionReasons[candSym] = `spread_${spreadPct.toFixed(3)}`
                          console.log(logPrefix, `🛑 [GENİŞ SPREAD] ${candSym} elendi: Spread %${spreadPct.toFixed(3)} > %0.20`)
                          return null
                        }
                        // İlk 5 alış kademesinde asgari 500 USDT derinlik şartı (maks pozisyon 20 USDT)
                        if (topBidDepthUsdt < 500) {
                          rejectionReasons[candSym] = `depth_${topBidDepthUsdt.toFixed(0)}_top5_${top5BidDepthUsdt.toFixed(0)}`
                          console.log(logPrefix, `🛑 [SIĞ TAHTA] ${candSym} elendi: İlk 5 kademe alış derinliği ${topBidDepthUsdt.toFixed(0)} USDT < 500 USDT`)
                          return null
                        }
                      }
                    } catch {}
                  }

                  // 2) Türev Verileriyle Likidasyon Temizliği (Funding Rate / Fonlama Kontrolü & Zaman Kalkanı)
                  let fundingRate = 0
                  if (premRes.ok) {
                    try {
                      const prem = await premRes.json()
                      fundingRate = parseFloat(prem.lastFundingRate || "0")
                      const nextFundingTime = Number(prem.nextFundingTime) || 0
                      const msToFunding = nextFundingTime - Date.now()

                      // Fonlama Kesintisine Son 15 Dakika Kalkanı:
                      // Eğer 15 dakika içinde 8 saatlik fonlama kesilecekse ve fonlama pozitifse (> +%0.02),
                      // hem fonlama komisyonu ödememek hem de saat başı "funding dump" iğnesine yakalanmamak için alımı ertele:
                      if (msToFunding > 0 && msToFunding <= 15 * 60 * 1000 && fundingRate > 0.0002) {
                        rejectionReasons[candSym] = `funding_settle_${Math.round(msToFunding / 60000)}m`
                        console.log(logPrefix, `🛑 [FONLAMA SAATİ KALKANI] ${candSym} elendi: Fonlama kesintisine ${Math.round(msToFunding / 60000)} dk kaldı ve oran %${(fundingRate * 100).toFixed(4)} > %0.02. Fonlama sonrası tekrar değerlendirilecek.`)
                        return null
                      }

                      // Düşüş anında aşırı yüksek pozitif funding (> %0.05): Long tasfiyesi bitmemiştir, bıçak düşüyor!
                      if (isHighRedMarket && fundingRate >= 0.0005) {
                        rejectionReasons[candSym] = `funding_${fundingRate}`
                        console.log(logPrefix, `🛑 [YÜKSEK FONLAMA] ${candSym} elendi: Fonlama %${(fundingRate * 100).toFixed(4)} çok yüksek, long tasfiyesi sürüyor.`)
                        return null
                      }
                    } catch {}
                  }

                  // 3) Göreli Güç (Relative Strength - RS) Analizi:
                  // RS = (Coin % Değişimi) - (BTC % Değişimi)
                  const coinChange15mPct = closes15m.length >= 2
                    ? ((closes15m[closes15m.length - 1] - closes15m[closes15m.length - 2]) / closes15m[closes15m.length - 2]) * 100
                    : 0
                  const relativeStrength = coinChange15mPct - btcChange15mPct

                  if (isHighRedMarket) {
                    // Düşüşte BTC'ye kıyasla daha hızlı çöken zayıf coinleri ele
                    if (relativeStrength < -1.5) {
                      rejectionReasons[candSym] = `rs_${relativeStrength.toFixed(2)}`
                      return null
                    }
                  }

                  // 4) Mum Değişkenleri ve Ortalama Hesapları
                  const sma20_15m = closes15m.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20
                  const m0_15 = klines15m[klines15m.length - 2] // 🛑 REPAINT ENGELİ: SADECE KAPANMIŞ 15m mumu (canlı [-1] mum kapanınca değişir!)
                  const m1_15 = klines15m[klines15m.length - 3]
                  const isGreen15m = parseFloat(m0_15[4]) >= parseFloat(m0_15[1])
                  const isPrevGreen15m = parseFloat(m1_15[4]) >= parseFloat(m1_15[1])
                  const isDoubleGreen15m = isGreen15m && isPrevGreen15m

                  const m0_5 = klines5m[klines5m.length - 2] // 🛑 REPAINT ENGELİ: SADECE KAPANMIŞ 5m mumu
                  const m1_5 = klines5m[klines5m.length - 3]
                  const isGreen5m = parseFloat(m0_5[4]) >= parseFloat(m0_5[1])
                  const isPrevGreen5m = parseFloat(m1_5[4]) >= parseFloat(m1_5[1])
                  const isDoubleGreen5m = isGreen5m && isPrevGreen5m

                  const last15mVol = parseFloat(m1_15[7]) || 0
                  const last15mTaker = parseFloat(m1_15[10]) || 0
                  const closedTakerBuy15m = last15mVol > 0 ? (last15mTaker / last15mVol) * 100 : 50

                  const cur15mVol = parseFloat(m0_15[7]) || 0
                  const cur15mTaker = parseFloat(m0_15[10]) || 0
                  const curTakerBuy15m = cur15mVol > 0 ? (cur15mTaker / cur15mVol) * 100 : 50

                  const last5mVol = parseFloat(m0_5[7]) || 0
                  const last5mTaker = parseFloat(m0_5[10]) || 0
                  const curTakerBuy5m = last5mVol > 0 ? (last5mTaker / last5mVol) * 100 : 50

                  const prev5mVol = parseFloat(m1_5[7]) || 0
                  const prev5mTaker = parseFloat(m1_5[10]) || 0
                  const prevTakerBuy5m = prev5mVol > 0 ? (prev5mTaker / prev5mVol) * 100 : 50

                  const takerBuy5m = Math.max(curTakerBuy5m, prevTakerBuy5m)
                  const takerBuy15m = Math.max(closedTakerBuy15m, curTakerBuy15m, takerBuy5m)

                  const past15mVols = klines15m.slice(0, -2).map((k: any) => parseFloat(k[7]) || 0)
                  const avg15mVol = past15mVols.length > 0 ? past15mVols.reduce((a: number, b: number) => a + b, 0) / past15mVols.length : 1
                  const closedRvol15m = avg15mVol > 0 ? last15mVol / avg15mVol : 1
                  const curRvol15m = avg15mVol > 0 ? cur15mVol / avg15mVol : 1
                  const rvol15m = Math.max(closedRvol15m, curRvol15m)

                  // 5) 15m RSI Kontrolü
                  let g = 0, l = 0
                  for (let i = closes15m.length - 14; i < closes15m.length; i++) {
                    const diff = closes15m[i] - closes15m[i - 1]
                    if (diff >= 0) g += diff; else l -= diff
                  }
                  const rsi14 = 100 - (100 / (1 + (g / (l || 1))))

                  // 6) SFP (Likidite Süpürmesi & Alt Fitil %45+) ve CVD Divergence Analizi (Kapanmış Mumlar):
                  const candleData15m: Candle[] = klines15m.map((k: any) => ({
                    t: Number(k[0]),
                    o: parseFloat(k[1]),
                    h: parseFloat(k[2]),
                    l: parseFloat(k[3]),
                    c: parseFloat(k[4]),
                    v: parseFloat(k[5]),
                  }))
                  const takerRatios15m = klines15m.map((k: any) => {
                    const v = parseFloat(k[7]) || 0
                    const tb = parseFloat(k[10]) || 0
                    return v > 0 ? (tb / v) * 100 : 50
                  })

                  const closedCandles15m = candleData15m.slice(0, -1)
                  const closedTakerRatios15m = takerRatios15m.slice(0, -1)

                  // 🎯 Dip Avcısı (SFP): Mumun alt fitilinin yanı sıra, <symbol>@forceOrder üzerinden
                  // o dip iğnesinde gerçekten zorunlu long likidasyonlarının (panik/tasfiye satışlarının) patlayıp emildiği teyit edilir!
                  const sfpCheck = detectLiquiditySweepAbsorption(closedCandles15m, 16, {
                    longLiquidationUsdt: liqStats.longLiquidationUsdt,
                    liquidationCount: liqStats.longCount,
                    requireLiquidation: isHighRedMarket,
                    minLiquidationUsdt: 500,
                  })
                  const cvdCheck = detectCvdDivergence(closedCandles15m, closedTakerRatios15m)

                  // 🚦 7) STRATEJİ MODU AYRIMI: TREND_MODE vs SFP_REVERSAL_MODE
                  const isReversalMode = isHighRedMarket || (sfpCheck.detected && cvdCheck.detected)
                  const strategyMode: "SFP_REVERSAL_MODE" | "TREND_MODE" = isReversalMode ? "SFP_REVERSAL_MODE" : "TREND_MODE"

                  // 15m Bollinger Bandı ve Aşırı Şişme (%B > 0.85) Engeli:
                  let bollingerPctB15m = 0.5
                  if (closes15m.length >= 20) {
                    const variance = closes15m.slice(-20).reduce((sum: number, c: number) => sum + Math.pow(c - sma20_15m, 2), 0) / 20
                    const stdDev = Math.sqrt(variance)
                    const upperBand = sma20_15m + 2 * stdDev
                    const lowerBand = sma20_15m - 2 * stdDev
                    bollingerPctB15m = (upperBand - lowerBand) > 0 ? (curPrice - lowerBand) / (upperBand - lowerBand) : 0.5
                  }

                  // 5m Tepe Satış Fitili & FOMO Engeli:
                  const o5m = parseFloat(m0_5[1]) || curPrice
                  const h5m = parseFloat(m0_5[2]) || curPrice
                  const c5m = parseFloat(m0_5[4]) || curPrice
                  const body5m = Math.abs(c5m - o5m) || (curPrice * 0.0005)
                  const upperWick5m = h5m - Math.max(o5m, c5m)
                  const candle5mChange = o5m > 0 ? ((c5m - o5m) / o5m) * 100 : 0

                  if (strategyMode === "SFP_REVERSAL_MODE") {
                    // 🎯 Dip Avcısı Reversal Modu: SMA20 ve RSI >= 46 ŞARTLARI DEVRE DIŞI!
                    // 1. Kapanış > Süpürülen Swing Low şartı
                    if (!sfpCheck.detected) { rejectionReasons[candSym] = "sfp_not_detected"; return null }
                    // 2. Zorunlu Long Likidasyon Teyidi (Sahte dip iğnelerini eler):
                    if (!sfpCheck.liquidationConfirmed && liqStats.longCount === 0) {
                      rejectionReasons[candSym] = "sfp_no_liq"
                      console.log(logPrefix, `🛑 [SAHTE DİP VETO] ${candSym} fitil altında zorunlu long tasfiyesi (forceOrder) patlamadı/emilmedi.`)
                      return null
                    }
                    // 3. RSI(14) > 32 (Aşırı çöküş tükenmesi ve dönüş bölgesi)
                    if (rsi14 <= 32) { rejectionReasons[candSym] = `sfp_rsi_${rsi14.toFixed(1)}`; return null }
                    // 4. Alıcı tepkisi
                    if (takerBuy15m < 48 && !isDoubleGreen15m) { rejectionReasons[candSym] = `sfp_taker_${takerBuy15m.toFixed(1)}`; return null }
                  } else {
                    // 🚀 TREND_MODE (Normal / Boğa / Dengeli Piyasa):
                    // 1. Fiyat 15m SMA20 üzerinde olmak zorunda (Düşüş trendindeki coini ASLA alma)
                    if (curPrice < sma20_15m) { rejectionReasons[candSym] = "below_sma20"; return null }
                    // 2. RSI 44 - 66 sağlıklı trend ve boğa momentum bölgesinde olmalı (Aşırı alım tepe engeli: > 66 kesinlikle alma!)
                    if (rsi14 < 44 || rsi14 > 66) { rejectionReasons[candSym] = `rsi_${rsi14.toFixed(1)}_out_of_44_66`; return null }
                    // 3. Bollinger %B Şişme Engeli: %B > 0.85 ise tepededir, satıcılar kafasına vurur, alma!
                    if (bollingerPctB15m > 0.85) { rejectionReasons[candSym] = `bollinger_top_${bollingerPctB15m.toFixed(2)}`; return null }
                    // 4. 5m Tepe Satıcı Baskısı Engeli (Üst fitil gövdeden 1.2 kat büyükse ve kırmızıysa alma!)
                    if (upperWick5m > body5m * 1.2 && !isGreen5m) { rejectionReasons[candSym] = "upper_wick_5m_rejection"; return null }
                    // 5. 5m FOMO / Ani Şişme Engeli (Son 5 dakikada %0.45'ten fazla fırlamışsa tepeden alma!)
                    if (candle5mChange > 0.45) { rejectionReasons[candSym] = "fomo_pump_5m"; return null }
                    // 6. Alıcı gücü ve trend/kırılım teyidi
                    if (takerBuy15m < 50.0) { rejectionReasons[candSym] = `taker_${takerBuy15m.toFixed(1)}`; return null }
                    const isVolumeBreakout = rvol15m >= 1.15 && takerBuy15m >= 51.5 && (isGreen15m || isGreen5m || isPrevGreen15m)
                    const isBullTrendAligned = curPrice >= sma20_15m && rsi14 >= 48 && takerBuy15m >= 50.5 && (isGreen15m || isGreen5m || isPrevGreen15m || isPrevGreen5m)
                    if (!isVolumeBreakout && !isDoubleGreen15m && !isDoubleGreen5m && !isBullTrendAligned) {
                      rejectionReasons[candSym] = `no_align_rsi_${rsi14.toFixed(1)}_tkr_${takerBuy15m.toFixed(1)}`
                      return null
                    }
                  }

                  // ⚖️ EMİR DEFTERİ DENGESİZLİĞİ (OBI = (BidVol - AskVol) / (BidVol + AskVol)) & Microprice:
                  // Sadece aşırı satış duvarı (OBI < -0.60) varsa veto edilir; pozitif OBI puan bonusu verir.
                  let obiScoreBonus = 0
                  let obiSnapshot = "OBI N/A"
                  if (depth5 && Array.isArray(depth5.bids) && Array.isArray(depth5.asks) && depth5.bids.length > 0 && depth5.asks.length > 0) {
                    const obiResult = calculateOrderBookImbalance(depth5.bids, depth5.asks, 5, 0.20)
                    if (obiResult.obi < -0.60) {
                      rejectionReasons[candSym] = `obi_${obiResult.obi.toFixed(2)}`
                      console.log(logPrefix, `🛑 [AŞIRI SATIŞ DUVARI VETO] ${candSym} OBI ${(obiResult.obi * 100).toFixed(1)}% < -60%. Ağır satış duvarı nedeniyle elendi!`)
                      return null
                    }
                    if (obiResult.passGate) {
                      obiScoreBonus = 15
                    } else if (obiResult.obi >= 0) {
                      obiScoreBonus = 8
                    }
                    obiSnapshot = `OBI ${obiResult.obi >= 0 ? "+" : ""}${(obiResult.obi * 100).toFixed(1)}% | Micro $${obiResult.microprice.toFixed(4)}`
                  }

                  // 🧭 OPEN INTEREST (OI) + CVD 4 KADRANLI AKILLI PARA MATRİSİ:
                  const lastCandleO = closedCandles15m[closedCandles15m.length - 1]?.o || curPrice
                  const priceChangePct = curPrice > 0 && lastCandleO > 0 ? ((curPrice - lastCandleO) / lastCandleO) * 100 : 0
                  const cvdDeltaPct = takerBuy15m - 50

                  const smartMoney = evaluateSmartMoneyMatrix({
                    priceChangePct,
                    cvdDeltaPct,
                    oiChangePct: oiStats.oiChangePct,
                  })

                  // Kurumsal Short girişi varsa long'u veto et
                  if (smartMoney.quadrant === "INSTITUTIONAL_SHORT") {
                    rejectionReasons[candSym] = "institutional_short"
                    console.log(logPrefix, `🛑 [KURUMSAL SHORT VETO] ${candSym} elendi: Fiyat ↓ + CVD ↓ + OI ↑ (Yeni Kurumsal Short Baskısı)`)
                    return null
                  }

                  // 8) GÖREV BAZLI GELİŞMİŞ PUANLAMA
                  let score = 0
                  const reasons: string[] = []

                  // SFP & Fitil Emilimi Bonusu (+30)
                  if (sfpCheck.detected) {
                    score += 30
                    reasons.push(`SFP Likidite Süpürmesi (Fitil %${(sfpCheck.lowerWickRatio * 100).toFixed(0)})`)
                  }
                  if (sfpCheck.liquidationConfirmed) {
                    score += 15
                    reasons.push(`🔥 Zorunlu Long Tasfiye Emilimi ($${(sfpCheck.longLiquidationUsdt || 0).toFixed(0)} hacim)`)
                  }

                  // CVD Pozitif Uyumsuzluk Bonusu (+25)
                  if (cvdCheck.detected) {
                    score += 25
                    reasons.push("Pozitif CVD/Taker Uyumsuzluğu (Balina Emilimi)")
                  }

                  if (strategyMode === "TREND_MODE") {
                    score += 20
                    reasons.push("SMA20 Üstü Trend")
                    if (rsi14 >= 50 && rsi14 <= 72) {
                      score += 10
                      reasons.push(`Güçlü Trend RSI (${rsi14.toFixed(0)})`)
                    }
                  } else {
                    score += 20
                    reasons.push("Dip Dönüş Formasyonu (SFP Reversal)")
                  }

                  // Akıllı Para 4 Kadran Bonusu ve gerekçesi
                  score += smartMoney.scoreModifier
                  reasons.push(...smartMoney.reasons)

                  // OBI Alıcı Derinliği Bonusu
                  if (obiScoreBonus > 0) {
                    score += obiScoreBonus
                    reasons.push(obiScoreBonus >= 15 ? "OBI Alıcı Üstünlüğü (> +0.20, Satış Duvarı Yok)" : "Dengeli/Pozitif Emir Defteri")
                  }

                  // B) Göreli Güç (Relative Strength):
                  if (relativeStrength >= 1.2) {
                    score += 25
                    reasons.push(`Güçlü RS (+${relativeStrength.toFixed(1)}% vs BTC)`)
                  } else if (relativeStrength >= 0.5) {
                    score += 15
                    reasons.push(`Pozitif RS (+${relativeStrength.toFixed(1)}%)`)
                  } else if (relativeStrength >= 0.0) {
                    score += 8
                  }

                  // C) Fonlama Oranı (Funding Rate) Filtresi & Short Squeeze:
                  if (fundingRate > 0.0005) { // > +%0.05
                    score -= 25
                    reasons.push("Yüksek Pozitif Fonlama Cezası (-25p, kalabalık long)")
                    if (fundingRate > 0.0008) {
                      rejectionReasons[candSym] = `high_funding_${fundingRate}`
                      console.log(logPrefix, `🛑 [AŞIRI FONLAMA VETOSU] ${candSym} fonlama %${(fundingRate * 100).toFixed(4)} > %0.08, elendi.`)
                      return null
                    }
                  } else if (fundingRate < -0.0003 && (cvdCheck.detected || isReversalMode)) {
                    score += 25
                    reasons.push(`🔥 Negatif Fonlama (%${(fundingRate * 100).toFixed(4)}) + CVD Short Squeeze Bonusu (+25p)`)
                  } else if (fundingRate < 0) {
                    score += 15
                    reasons.push(`Negatif Funding (%${(fundingRate * 100).toFixed(4)})`)
                  } else if (fundingRate <= 0.00015) {
                    score += 10
                    reasons.push("Sağlıklı Fonlama")
                  }

                  // D) Sektör ve Anlatı Liderliği (Dinamik 24h RS Liderliği):
                  const narrativeInfo = getNarrativeSector(candSym, dynamicSectorBonuses)
                  if (narrativeInfo) {
                    score += narrativeInfo.bonus
                    reasons.push(`Öncü Sektör: ${narrativeInfo.sectorName} (+${narrativeInfo.bonus}p${narrativeInfo.avgRs !== undefined ? `, RS %${narrativeInfo.avgRs}` : ""})`)
                  }

                  // E) Emir Defteri & Spread:
                  if (spreadPct <= 0.05) {
                    score += 10
                    reasons.push("Sıkı Spread")
                  }

                  // F) Hacim & Taker Alım Baskısı:
                  if (rvol15m >= 2.0) { score += 25; reasons.push(`RVOL ${rvol15m.toFixed(1)}x`) }
                  else if (rvol15m >= 1.5) { score += 15; reasons.push(`RVOL ${rvol15m.toFixed(1)}x`) }
                  else if (rvol15m >= 1.15) { score += 10 }

                  if (takerBuy15m >= 58) { score += 20; reasons.push(`Taker15m %${takerBuy15m.toFixed(0)}`) }
                  else if (takerBuy15m >= 52) { score += 12; reasons.push(`Taker15m %${takerBuy15m.toFixed(0)}`) }
                  else if (takerBuy15m >= 49.5) { score += 6 }

                  if (takerBuy5m >= 54) score += 10
                  if (isDoubleGreen15m) { score += 15; reasons.push("15m Çift Yeşil") }
                  else if (isGreen15m) { score += 8 }
                  if (isDoubleGreen5m) score += 10

                  if (score < minFuturesScore) {
                    rejectionReasons[candSym] = `low_score_${score}_min_${minFuturesScore}`
                    return null
                  }

                  const snapshot = `Skor ${score}/${minFuturesScore} | RS ${relativeStrength >= 0 ? "+" : ""}${relativeStrength.toFixed(2)}% | Spread %${spreadPct.toFixed(3)} | Funding %${(fundingRate * 100).toFixed(4)} | Anlatı ${narrativeInfo?.sectorKey || "GENEL"} | RSI15m ${rsi14.toFixed(1)} | RVOL15m ${rvol15m.toFixed(2)}x | Taker15m %${takerBuy15m.toFixed(0)} | ${obiSnapshot} | OI %${oiStats.oiChangePct >= 0 ? "+" : ""}${oiStats.oiChangePct.toFixed(2)} | Kadran: ${smartMoney.quadrant}`
                  return {
                    candSym,
                    curPrice,
                    score,
                    reasons,
                    snapshot,
                    smartMoneyRegime: smartMoney.quadrant,
                    isShortCovering: smartMoney.isShortCovering,
                  }
                } catch (fErr: any) {
                  rejectionReasons[candSym] = `err_${fErr.message}`
                  console.warn(logPrefix, `Futures candidate ${candSym} check error:`, fErr.message)
                  return null
                }
              }

              // ⚡ GENİŞLETİLMİŞ ADAY TARAMASI:
              // CoinGecko ön filtresi ve ana likit vadeli çiftlerden ilk 18 aday paralel gruplar halinde taranır.
              const candidatesToScan = availableCandidates.slice(0, 18)
              const scoredCandidates: FuturesScored[] = []
              for (let i = 0; i < candidatesToScan.length; i += 9) {
                const chunkResults = await Promise.all(candidatesToScan.slice(i, i + 9).map(evaluateFuturesCandidate))
                for (const r of chunkResults) if (r) scoredCandidates.push(r)
              }
              scoredCandidates.sort((a, b) => b.score - a.score)
              console.log(
                logPrefix,
                `🧮 [FUTURES TREND PUANLAMA] ${candidatesToScan.length} öncelikli aday tarandı, ${scoredCandidates.length} tanesi trend ve hacim şartlarını geçti.` +
                  (scoredCandidates.length > 0 ? ` En iyi: ${scoredCandidates.slice(0, 3).map((s) => `${s.candSym}=${s.score}`).join(", ")}` : "")
              )

              // 🔍 TEŞHİS: Hiç aday geçmediğinde "neden" sorusunu loga yaz.
              // (Vercel loglarında tek bakışta görülsün diye insan-okur özet.)
              if (scoredCandidates.length === 0 && Object.keys(rejectionReasons).length > 0) {
                const humanizeRejection = (r: string): string => {
                  if (r.startsWith("low_score")) return "trend/hacim skoru eşiğin altında"
                  if (r === "sfp_not_detected") return "SFP fitili/süpürmesi yok"
                  if (r === "sfp_no_liq") return "likidasyon teyidi yok"
                  if (r.startsWith("sfp_rsi")) return "SFP+RSI uygun değil"
                  if (r.startsWith("sfp_taker")) return "SFP+taker alıcı baskısı yok"
                  if (r === "below_sma20") return "fiyat SMA20 altında"
                  if (r.startsWith("rsi_")) return "RSI 44-66 dışında"
                  if (r.startsWith("bollinger_top")) return "bollinger tepesinde"
                  if (r === "upper_wick_5m_rejection") return "5m üst fitil reddi"
                  if (r.startsWith("fomo")) return "5m ani pompa (FOMO)"
                  if (r.startsWith("taker_")) return "taker alıcı baskısı zayıf"
                  if (r.startsWith("no_align")) return "RSI/taker hizalanmadı"
                  if (r.startsWith("obi_")) return "emir defteri baskısı ters"
                  if (r === "institutional_short") return "kurumsal short baskısı"
                  if (r.startsWith("high_funding") || r.startsWith("funding_")) return "funding uygun değil"
                  if (r.startsWith("spread")) return "spread geniş"
                  if (r.startsWith("depth")) return "derinlik yetersiz"
                  if (r.startsWith("rs_")) return "göreli güç zayıf"
                  if (r.startsWith("kline")) return "borsa mum verisi eksik/hatalı"
                  if (r.startsWith("err_")) return "hesaplama hatası"
                  return r
                }
                const grouped: Record<string, number> = {}
                for (const sym of Object.keys(rejectionReasons)) {
                  const key = humanizeRejection(rejectionReasons[sym] || "bilinmeyen")
                  grouped[key] = (grouped[key] || 0) + 1
                }
                const summary = Object.entries(grouped)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" | ")
                console.log(logPrefix, `🔍 [GİRİŞ ENGELLERİ] ${candidatesToScan.length} aday → ${summary}`)
              }

              // 🧠 xAI GROK KANTİTATİF VE DUYGU TEYİT KATMANI:
              // Teknik puanı geçen en güçlü en iyi 8 aday paralel olarak Grok Veto ve duygu analizinden geçirilir.
              const topCandidates = scoredCandidates.slice(0, 8)
              const minConfluenceScore = isHighRedMarket ? 68 : 55
              const grokEvalResults = await Promise.all(
                topCandidates.map(async (cand) => {
                  try {
                    const grokEval = await evaluateGrokConfluence({
                      symbol: cand.candSym,
                      curPrice: cand.curPrice,
                      technicalScore: cand.score,
                    })

                    if (grokEval.vetoed) {
                      console.warn(logPrefix, `🛑 [GROK VETO] ${cand.candSym} elendi: ${grokEval.vetoReason || "Kritik güvenlik/hack uyarısı"}`)
                      return null
                    }

                    // 💎 CONFLUENCE EŞİĞİ:
                    if (grokEval.finalConfluenceScore < minConfluenceScore) {
                      console.log(logPrefix, `ℹ️ [GROK FİLTRE] ${cand.candSym} elendi: Confluence skoru ${grokEval.finalConfluenceScore} < ${minConfluenceScore}`)
                      return null
                    }

                    const adjustedReasons = [
                      ...cand.reasons,
                      `Grok ${grokEval.sentiment.sentimentCategory} (%${grokEval.grokScore})`,
                    ]
                    if (grokEval.narrative && !adjustedReasons.some(r => r.includes(grokEval.narrative!.sectorName))) {
                      adjustedReasons.push(`Anlatı: ${grokEval.narrative.sectorName}`)
                    }
                    const updatedSnapshot = `${cand.snapshot} | GrokScore ${grokEval.grokScore}/100 | GrokConfluence ${grokEval.finalConfluenceScore} | Anlatı ${grokEval.narrative?.sectorKey || "GENEL"} | GrokVelocity ${grokEval.sentiment.socialVelocity}`

                    return {
                      candSym: cand.candSym,
                      curPrice: cand.curPrice,
                      score: grokEval.finalConfluenceScore,
                      reasons: adjustedReasons,
                      snapshot: updatedSnapshot,
                      smartMoneyRegime: cand.smartMoneyRegime,
                      isShortCovering: cand.isShortCovering,
                    } as FuturesScored
                  } catch (gErr: any) {
                    console.warn(logPrefix, `⚠️ [GROK CONFLUENCE] ${cand.candSym} Grok teyidi hatası, teknik skor korunuyor:`, gErr.message)
                    return cand
                  }
                })
              )

              const grokConfluenceCandidates: FuturesScored[] = grokEvalResults.filter(Boolean) as FuturesScored[]

              grokConfluenceCandidates.sort((a, b) => b.score - a.score)
              if (futuresSummary) {
                futuresSummary.scanStats = {
                  scanned: candidatesToScan.length,
                  candidatesToScan,
                  rejectionReasons,
                  scored: scoredCandidates.map(s => ({ sym: s.candSym, score: s.score })),
                  grokPassed: grokConfluenceCandidates.map(s => ({ sym: s.candSym, score: s.score })),
                  dryRun: botRisk.dryRun,
                  killSwitch: botRisk.killSwitchActive,
                  maxFuturesSlots,
                }
              }
              if (grokConfluenceCandidates.length > 0) {
                console.log(
                  logPrefix,
                  `🧠 [GROK & TREND PUANLAMA] ${scoredCandidates.length} adaydan ${grokConfluenceCandidates.length} tanesi Grok teyidini geçti. En iyi 3: ${grokConfluenceCandidates.slice(0, 3).map((s) => `${s.candSym}=${s.score}`).join(", ")}`
                )
              }

              // 📈 BTC TREND REJİM FİLTRESİ (YÜKSEK TF) — 2026-10 analytics tepkisi:
              // byHour verisi UTC 9,10,12,15,17 saatlerinde %0 isabet; byDay 36 işlemde
              // 26 zarar. Sebep: düşüş/karışma rejiminde alt-long açıp %73 oranla stop.
              // BTC 1h kapanışı EMA20'nin altındaysa VE 24h değişimi negatifse
              // bu turda YENİ vadeli long açılmaz (açık pozisyonlar kendi kurallarıyla yönetilir).
              let btcRegimeOk = true
              try {
                const btcKRegimeRes = await publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=50`, { cache: "no-store" })
                if (btcKRegimeRes.ok) {
                  const btcRegimeKlines: any[] = await btcKRegimeRes.json()
                  if (Array.isArray(btcRegimeKlines) && btcRegimeKlines.length >= 45) {
                    const btcCloses = btcRegimeKlines.map((k: any) => parseFloat(k[4]))
                    let btcEma20 = btcCloses[0]
                    const btcEmaK = 2 / (20 + 1)
                    for (let i = 1; i < btcCloses.length; i++) {
                      btcEma20 = btcCloses[i] * btcEmaK + btcEma20 * (1 - btcEmaK)
                    }
                    const btcLastClose = btcCloses[btcCloses.length - 1]
                    const btcRefClose = btcCloses[btcCloses.length - 25]
                    const btc24hChg = btcRefClose > 0 ? ((btcLastClose - btcRefClose) / btcRefClose) * 100 : 0
                    // 🔧 EŞİK AYARI: %0.1'lik sapma "kırmızı rejim" sayılırsa filtre sürekli
                    // kapalı kalır ve bot hiç işlem yapmaz (ölçüm de imkânsız olur). Bu yüzden
                    // anlamlı bir bozulma aranır: BTC 1h kapanışı EMA20'nin en az %0.5 altı
                    // VE 24h değişim en az -%1.0. Aradaki "gürültü bandı" işlem engellemez.
                    const btcBelowEmaPct = ((btcLastClose - btcEma20) / btcEma20) * 100
                    if (btcBelowEmaPct <= -0.5 && btc24hChg <= -1.0) {
                      btcRegimeOk = false
                      console.log(
                        logPrefix,
                        `📉 [BTC TREND REJİMİ KAPALI] BTC 1h kapanışı EMA20'nin %${btcBelowEmaPct.toFixed(2)} altında ve 24h değişim %${btc24hChg.toFixed(2)}. Bu turda YENİ vadeli long açılmayacak (mevcut pozisyonlar kendi kurallarıyla yönetilmeye devam eder).`
                      )
                    } else {
                      // Teşhis görünürlüğü: rejim açıkken de tek satır bas (kullanıcı neden
                      // işlem olduğunu/olmadığını logdan görebilsin).
                      console.log(
                        logPrefix,
                        `📈 [BTC TREND REJİMİ AÇIK] BTC 1h kapanışı EMA20'ye göre %${btcBelowEmaPct >= 0 ? "+" : ""}${btcBelowEmaPct.toFixed(2)}, 24h %${btc24hChg >= 0 ? "+" : ""}${btc24hChg.toFixed(2)} — yeni long girişleri serbest.`
                      )
                    }
                  }
                }
              } catch {}

              for (const sel of grokConfluenceCandidates) {
                const candSym = sel.candSym
                const curPrice = sel.curPrice
                try {
                  // 📉 BTC REJİM KAPISI — rejim kapalıysa tüm adayları atla:
                  if (!btcRegimeOk) {
                    console.log(logPrefix, `📉 [BTC REJİMİ] ${candSym} atlandı: BTC trend rejimi kapalı, yeni long yasak.`)
                    continue
                  }

                  // 🚫 FOMO-KOŞU GİRİŞ ENGELİ (analytics: 27.8% isabet, SL +24s):
                  // 24h pompasını çoktan yapmış coine (>= %+8) girmek tepe satıcılarına
                  // para bağışlamaktır — giriş fiyatı mum tepesine oturur, ilk red candle
                  // stop'u doldurur. Bu durumda aday ele.
                  try {
                    const c24hqRes = await publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr?symbol=${candSym}`, { cache: "no-store" })
                    if (c24hqRes.ok) {
                      const c24hq: any = await c24hqRes.json()
                      const candChange24h = parseFloat(c24hq.priceChangePercent) || 0
                      if (candChange24h >= 8.0) {
                        console.log(logPrefix, `🚫 [FOMO KOŞUSU ENGELLENDİ] ${candSym} atlandı: 24h değişim %+${candChange24h.toFixed(1)} — tepe avcılığı riski.`)
                        continue
                      }
                    }
                  } catch {}

                  if (openFuturesPos.some((p) => p.symbol === candSym)) continue
                  if (remainingPendingOrders.some((po) => po.pair === candSym)) continue

                  // 🛡️ Sektör Sepet Limiti (Portföyde aynı anda en fazla 3-4 işlem ve her sektörden maks 1 coin)
                  const activeSectors = new Set<string>()
                  for (const p of openFuturesPos) {
                    const sec = getNarrativeSector(p.symbol)
                    if (sec) activeSectors.add(sec.sectorKey)
                  }
                  const candSector = getNarrativeSector(candSym)
                  if (candSector && activeSectors.has(candSector.sectorKey)) {
                    console.log(logPrefix, `🛑 [SEKTÖR SEPET LİMİTİ] ${candSym} elendi: ${candSector.sectorName} sektöründen portföyde zaten açık pozisyon var! (Maks 1 coin/sektör)`)
                    continue
                  }

                  const pendingFuturesCount = remainingPendingOrders.filter((po) => po.exchange === "BINANCE_GLOBAL_FUTURES").length
                  if (openFuturesPos.length + pendingFuturesCount >= maxFuturesSlots) break

                  if (curPrice > 0) {
                    const cleanCand = candSym.replace(/USDT$/i, "").toUpperCase()
                    const isCandMajor = ["BTC", "ETH", "BNB", "SOL", "XRP"].includes(cleanCand)
                    const isCandMeme = MEME_TOKENS.has(cleanCand) || ["DOGE", "PEPE", "SHIB", "BONK", "FLOKI", "WIF", "NEIRO", "TURBO", "PENGU", "1000PEPE", "1000SHIB", "1000BONK", "1000FLOKI"].includes(cleanCand)

                    // 🛡️ GÜVENLİK VE RİSK TAVANLARI:
                    // 📉 KALDIRAÇ TAVANI 10x → 3x düşürüldü (2026-10, analytics verisi):
                    // 25/36 işlem stop'a gitmişti; 10x'te ±%3.5 fiyat bandı ±%35 ROI
                    // salınımı demek ve likidasyon tamponu tek mum fitilini bile kaldıramıyor.
                    // 3x = aynı parasal riskle 3x daha kalın tasfiye tamponu.
                    // (Kaldıraç maks 3x, pozisyon maks 20 USDT, açık pozisyon maks 3)
                    const maxAllowedLeverage = Math.min(exchangeSettings?.maxLeverageCap || 10, botRisk.maxLeverageCap || 10)
                    const maxAllowedNotional = Math.min(exchangeSettings?.maxPositionSizeUsdt || 20, botRisk.maxPositionSizeUsdt || 20)
                    let targetLeverage = Math.min(3, maxAllowedLeverage)

                    const remainingSlots = Math.max(1, maxFuturesSlots - openFuturesPos.length - pendingFuturesCount)
                    const slotMarginUsdt = availUsdt < 25 ? (availUsdt * 0.95) : Math.max(5, (availUsdt / remainingSlots) * 0.95)
                    let notionalUsdt = Math.max(5.1, slotMarginUsdt * targetLeverage)
                    if (notionalUsdt > maxAllowedNotional) {
                      notionalUsdt = maxAllowedNotional
                    }

                    // 🧮 Dinamik ATR Stop (1.8x - 2.2x ATR) ve Sabit Parasal Risk Boyutlandırma
                    let dynamicSlPct = 3.50
                    let stopLossPrice = curPrice * (1 - (dynamicSlPct / 100))
                    try {
                      const atrRes = await publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=${candSym}&interval=15m&limit=25`, { cache: "no-store" }, 30000)
                      if (atrRes.ok) {
                        const rawAtrKlines = await atrRes.json()
                        if (Array.isArray(rawAtrKlines) && rawAtrKlines.length >= 15) {
                          const candleList: Candle[] = rawAtrKlines.map((k: any) => ({
                            t: Number(k[0]), o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5])
                          }))
                          const series = atrSeries(candleList, 14)
                          const latestAtr = series[series.length - 1]
                          if (latestAtr && latestAtr > 0) {
                            const atrSizing = calculateDynamicAtrSizing({
                              curPrice,
                              atr14: latestAtr,
                              equityUsdt: availUsdt,
                              riskPctPerTrade: 2.0,
                              atrMultiplier: 2.0,
                              minPositionUsdt: 0.35,
                              maxPositionUsdt: maxAllowedNotional,
                              maxLeverageCap: targetLeverage,
                            })
                            dynamicSlPct = atrSizing.stopLossDistancePct
                            stopLossPrice = atrSizing.stopLossPrice
                            if (availUsdt >= 15) {
                              notionalUsdt = Math.min(maxAllowedNotional, atrSizing.positionSizeUsdt)
                            }
                          }
                        }
                      }
                    } catch {}

                    // 🛡️ DİNAMİK KALDIRAÇ TAMPONU (İzole Likidasyon Koruması):
                    // İzole likidasyon seviyesinin stop seviyesinden önce tetiklenmemesi için:
                    // leverage = min(3, floor(100 / (stopMesafesiYuzde + 2.5)))
                    const leverageCapWithBuffer = Math.min(3, Math.floor(100 / (dynamicSlPct + 2.5)))
                    targetLeverage = Math.min(targetLeverage, Math.max(1, leverageCapWithBuffer))
                    // 🔧 Eski "küçük bakiyede kaldıracı 5-10x'e zorla şişir" bloğu kaldırıldı:
                    // bakiye küçükse notional kendi küçülür; risk büyütmek yerine pozisyon atlanır.

                    // 🧪 DRY-RUN SİMÜLASYON BOYUTU: simülasyon GERÇEK BAKİYE ile sınırlı OLMAMALI.
                    // Aksi halde (ör. 1.29 USDT × 3x = 3.9 USDT < 5 USDT borsa minimumu) hiç
                    // simüle işlem açılmıyor ve ölçüm imkânsız hale geliyordu.
                    // Simülasyonda konfigüre edilmiş üst limit (varsayılan 20 USDT) kullanılır;
                    // pozisyon boyutu isabet oranını değiştirmez, sadece ölçümü mümkün kılar.
                    if (isDryRunActive) {
                      notionalUsdt = Math.max(notionalUsdt, Math.min(maxAllowedNotional, 20))
                    }

                    // 🛑 KILL_SWITCH VE GÜNLÜK ZARAR KORUMASI:
                    if (botRisk.killSwitchActive) {
                      console.warn(logPrefix, `🛑 [KILL_SWITCH] Yeni alım iptal edildi: ${candSym}`)
                      break
                    }

                    // 📉 GÜNLÜK ZARAR TEKRAR KONTROLÜ (alım döngüsü içi son savunma):
                    // NOT: Gün başı bakiyesi artık HER DÖNGÜDE üzerine YAZILMAZ (günlük zarar debriyajı çalışır).
                    if (futuresDailyLossBlock) {
                      console.warn(logPrefix, `📉 [GÜNLÜK ZARAR KİLİDİ] Yeni alım iptal edildi: ${candSym}`)
                      break
                    }

                    // Olası eski açık kalan emirleri temizle
                    await cancelFuturesAllOpenOrders(globKey, globSecret, candSym).catch(() => {})

                    const filters = await getFuturesSymbolFilters(candSym)
                    const stepSize = filters?.stepSize || 0.001
                    const minNotionalReq = filters?.minNotional || 5
                    const rawQty = notionalUsdt / curPrice
                    let formattedQty = parseFloat(formatWithStepSize(rawQty, stepSize, filters?.basePrecision || 3))
                    if (formattedQty * curPrice < minNotionalReq) {
                      const bumpedQty = parseFloat(formatWithStepSize(rawQty + stepSize, stepSize, filters?.basePrecision || 3))
                      if (bumpedQty * curPrice <= availUsdt * targetLeverage * 0.98) {
                        formattedQty = bumpedQty
                      }
                    }

                    if (formattedQty >= (filters?.minQty || 0.001) && formattedQty * curPrice >= minNotionalReq) {

                      // 📊 VWAP KAYMA (SLIPPAGE) SİMÜLASYONU:
                      // Emir defterinin ilk 10-15 kademesini tarayarak notionalUsdt için ağırlıklı ortalama fiyatı hesapla:
                      // VWAP kayması < %0.20 şartı sağlanmalıdır.
                      let vwapApproved = true
                      try {
                        const depthRes = await publicFetch(
                          `${BINANCE_FUTURES_BASE}/fapi/v1/depth?symbol=${candSym}&limit=20`,
                          { cache: "no-store", signal: AbortSignal.timeout(3000) },
                          5000
                        )
                        if (depthRes.ok) {
                          const depthData = await depthRes.json()
                          const vwapCheck = simulateVwapSlippage(depthData.asks || [], notionalUsdt)
                          if (!vwapCheck.acceptable && vwapCheck.slippagePct >= 0.20) {
                            console.log(logPrefix, `🛑 [VWAP KAYMA VETO] ${candSym} elendi: ${vwapCheck.reason}`)
                            vwapApproved = false
                          } else {
                            console.log(logPrefix, `✅ [VWAP ONAY] ${candSym}: Kayma %${vwapCheck.slippagePct.toFixed(3)} < %0.20, VWAP: ${vwapCheck.vwapPrice}`)
                          }

                          // Giriş anında anlık aşırı satış duvarı (OBI < -0.65) kontrolü
                          const obiFinal = calculateOrderBookImbalance(depthData.bids || [], depthData.asks || [], 5, 0.20)
                          if (obiFinal.obi < -0.65) {
                            console.log(logPrefix, `🛑 [SATIŞ DUVARI ANLIK VETO] ${candSym} tam giriş anında ağır satış duvarı tespit edildi: OBI ${(obiFinal.obi * 100).toFixed(1)}%`)
                            vwapApproved = false
                          }
                        }
                      } catch (vErr: any) {
                        console.warn(logPrefix, `⚠️ [VWAP CHECK] ${candSym} derinlik okunamadı, devam ediliyor:`, vErr?.message)
                      }

                      if (!vwapApproved) {
                        continue
                      }

                      // 🧪 DRY_RUN KONTROLÜ (FAIL-CLOSED, getBotRiskConfig() ile birebir tutarlı):
                      // - DRY_RUN "false" DIŞINDAKİ her değer (tanımsız dahil) → SİMÜLASYON
                      // - BINANCE_ENV "live"/"production" değilse → SİMÜLASYON
                      // Aksi halde canlı API anahtarlarıyla gerçek emir gönderilir!
                      const isExplicitDryRun = botRisk.dryRun || botRisk.binanceEnv !== "live"
                      if (isExplicitDryRun) {
                        // 📊 Canlı giriş yoluyla AYNI TP formülleri (ölçüm adil olsun):
                        const simBaseTp1 = isCandMeme ? 7.00 : isCandMajor ? 5.00 : 5.60
                        const simTp1Pct = Math.max(simBaseTp1, Number((dynamicSlPct * 1.60).toFixed(2)))
                        const simBaseTp2 = isCandMeme ? 15.00 : isCandMajor ? 9.00 : 11.00
                        const simTp2Pct = Math.max(simBaseTp2, Number((dynamicSlPct * 2.50).toFixed(2)))
                        const dryTrade = {
                          symbol: candSym,
                          side: "BUY" as const,
                          price: curPrice,
                          quantity: formattedQty,
                          notionalUsdt,
                          leverage: targetLeverage,
                          stopLossPrice,
                          tp1Pct: simTp1Pct,
                          tp2Pct: simTp2Pct,
                          reason: `CoinGecko Ön Filtre + Teknik Sinyal (Skor: ${sel.score}) [${sel.smartMoneyRegime || "GENEL"}]`,
                        }
                        console.log(logPrefix, `🧪 [DRY_RUN AKTİF] Gerçek emir gönderilmedi! Simüle Alım: ${candSym} ${targetLeverage}x | Fiyat: ${curPrice} | Adet: ${formattedQty} | Tutar: ${notionalUsdt.toFixed(2)} USDT | SL: ${stopLossPrice.toFixed(4)} | TP1: +%${simTp1Pct} | TP2: +%${simTp2Pct}`)
                        recordDryRunTrade(dryTrade)
                        await appendDryRunTradeToRedis(dryTrade).catch(() => {})
                        // 🧪 SANAL POZİSYON AÇ: her cron turunda fiyatla takip edilip
                        // SL/TP/trailing/zaman kurallarıyla SANAL kapatılacak (analytics beslenir).
                        try {
                          const simPositions = await getDryRunPositions()
                          if (simPositions.length >= maxFuturesSlots) {
                            console.log(logPrefix, `🧪 [DRY_RUN] Simülasyon slotu dolu (${simPositions.length}/${maxFuturesSlots}) — ${candSym} simüle edilmedi.`)
                          } else if (!simPositions.some((p: any) => p.symbol === candSym)) {
                            simPositions.push({
                              symbol: candSym,
                              entryPrice: curPrice,
                              quantity: formattedQty,
                              notionalUsdt,
                              leverage: targetLeverage,
                              stopLossPrice,
                              tp1Pct: simTp1Pct,
                              tp2Pct: simTp2Pct,
                              peakPrice: curPrice,
                              tp1Taken: false,
                              openedTimestamp: Date.now(),
                              openedAt: new Date().toISOString(),
                              reason: dryTrade.reason,
                            })
                            await setDryRunPositions(simPositions)
                          }
                        } catch (simErr: any) {
                          console.warn(logPrefix, `⚠️ [DRY_RUN] Sanal pozisyon kaydı başarısız: ${simErr?.message}`)
                        }
                        if (sel.smartMoneyRegime) {
                          await setFuturesSmartMoneyRegime(candSym, sel.smartMoneyRegime, Boolean(sel.isShortCovering)).catch(() => {})
                        }
                        await appendServerLog({
                          id: `dry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                          time: new Date().toLocaleTimeString("tr-TR"),
                          type: "BUY",
                          symbol: candSym,
                          message: `🧪 [DRY_RUN SİMÜLE ALIM] ${candSym} ${targetLeverage}x | Giriş: ${curPrice} | Tutar: ${notionalUsdt.toFixed(2)} USDT | SL: ${stopLossPrice.toFixed(4)} | Skor: ${sel.score} | Kadran: ${sel.smartMoneyRegime || "NEUTRAL"}`,
                        }).catch(() => {})
                        executedActions.push(`DRY_RUN_ENTRY: ${candSym} (Fiyat: ${curPrice}, Tutar: ${notionalUsdt.toFixed(2)} USDT)`)
                        break
                      }

                      // 🚀 CANLI EMİR İLETİMİ
                      const buyRes = await executeBinanceFuturesOrder({
                        apiKey: globKey,
                        apiSecret: globSecret,
                        symbol: candSym,
                        side: "BUY",
                        type: "MARKET",
                        quantity: formattedQty,
                        leverage: targetLeverage,
                      })

                      if (buyRes.ok) {
                        const effectiveEntryPrice = (buyRes.avgPrice && buyRes.avgPrice > 0) ? buyRes.avgPrice : curPrice
                        const actualMargin = (formattedQty * effectiveEntryPrice) / targetLeverage
                        const baseTp1 = isCandMeme ? 7.00 : isCandMajor ? 5.00 : 5.60
                        const tp1PctDisplay = Math.max(baseTp1, Number((dynamicSlPct * 1.60).toFixed(2)))
                        const baseTp2 = isCandMeme ? 15.00 : isCandMajor ? 9.00 : 11.00
                        const tp2PctDisplay = Math.max(baseTp2, Number((dynamicSlPct * 2.50).toFixed(2)))
                        const slPctDisplay = dynamicSlPct

                        const symFilters = await getFuturesSymbolFilters(candSym)
                        const symTick = symFilters?.tickSize || 0.0001

                        // 🛑 Pozisyon açıldıktan hemen sonra borsaya reduceOnly STOP_MARKET emri gönder (Dinamik ATR Stop).
                        const stopLossTriggerPrice = parseFloat(formatWithTickSize(effectiveEntryPrice * (1 - (dynamicSlPct / 100)), symTick))
                        const stopOrderRes = await executeBinanceFuturesOrder({
                          apiKey: globKey,
                          apiSecret: globSecret,
                          symbol: candSym,
                          side: "SELL",
                          type: "STOP_MARKET",
                          stopPrice: stopLossTriggerPrice,
                          closePosition: true,
                          workingType: "MARK_PRICE",
                        })

                        if (!stopOrderRes.ok) {
                          // Borsa stop emri başarısız! Pozisyonu hemen acil kapat ve logla.
                          console.error(logPrefix, `🚨 STOP_MARKET emri borsaya iletilemedi (${candSym}): ${stopOrderRes.error}. Güvenlik için pozisyon derhal kapatılıyor!`)
                          executedActions.push(`FUTURES_STOP_ORDER_FAILED: ${candSym} - ${stopOrderRes.error}`)
                          
                          await appendServerLog({
                            id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            time: new Date().toLocaleTimeString("tr-TR"),
                            type: "ALERT",
                            symbol: candSym,
                            message: `🚨 [STOP_MARKET BAŞARISIZ - ACİL KAPATILDI] ${candSym} stop emri borsaya girilemedi (${stopOrderRes.error || "Bilinmiyor"}). Pozisyon risk almamak için piyasa fiyatından hemen kapatıldı.`,
                          })

                          // Acil piyasadan kapat (reduceOnly MARKET) - 3 defa deneme döngüsü
                          let emergencyCloseOk = false
                          for (let attempt = 1; attempt <= 3; attempt++) {
                            const emRes = await executeBinanceFuturesOrder({
                              apiKey: globKey,
                              apiSecret: globSecret,
                              symbol: candSym,
                              side: "SELL",
                              type: "MARKET",
                              quantity: formattedQty,
                              reduceOnly: true,
                            })
                            if (emRes.ok) {
                              emergencyCloseOk = true
                              console.warn(logPrefix, `✅ [ACİL KAPATMA BAŞARILI] ${candSym} ${attempt}. denemede piyasa fiyatından kapatıldı.`)
                              break
                            }
                            console.error(logPrefix, `❌ [ACİL KAPATMA BAŞARISIZ] ${candSym} ${attempt}. deneme hatası: ${emRes.error}`)
                          }

                          if (!emergencyCloseOk) {
                            console.error(logPrefix, `🔥 [KRİTİK HATA] ${candSym} pozisyonu stop emri girilemedi ve acil piyasa satışı 3 denemede de başarısız oldu! Pozisyon açıkta kaldı!`)
                            await appendServerLog({
                              id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                              time: new Date().toLocaleTimeString("tr-TR"),
                              type: "ALERT",
                              symbol: candSym,
                              message: `🔥 [KRİTİK UYARI] ${candSym} borsa stop emri girilemedi ve 3 acil kapatma denemesi de başarısız oldu (${candSym} açık kaldı, manuel kontrol gerek)!`,
                            })
                          }
                          break
                        } else {
                          // ✅ Koruyucu STOP_MARKET emri borsada kabul edildi
                          console.log(logPrefix, `🛡️ [STOP_MARKET AKTİF] ${candSym} koruyucu stop emri borsada açıldı (OrderId: ${stopOrderRes.orderId}, Tetik Fiyatı: ${stopLossTriggerPrice.toFixed(4)}, Durum: ${stopOrderRes.status})`)
                          await appendServerLog({
                            id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            time: new Date().toLocaleTimeString("tr-TR"),
                            type: "INFO",
                            symbol: candSym,
                            message: `🛡️ [STOP EMRİ ONAYLANDI] ${candSym} stop emri borsada aktif. OrderId: ${stopOrderRes.orderId || "Bilinmiyor"}, Tetik: ${stopLossTriggerPrice.toFixed(4)}, Durum: ${stopOrderRes.status}`,
                          })

                          // 🎯 DONANIMSAL TAKE_PROFIT_MARKET EMRİ (İğne/Wick Yakalayıcı):
                          // Sunucu kapalı veya cron çalışmıyor olsa bile ani sert yukarı iğnede (pump wick) kârı milisaniyesinde borsada alır!
                          try {
                            const takeProfitTriggerPrice = parseFloat(formatWithTickSize(effectiveEntryPrice * (1 + (tp1PctDisplay / 100)), symTick))
                            if (takeProfitTriggerPrice > effectiveEntryPrice) {
                              const tpOrderRes = await executeBinanceFuturesOrder({
                                apiKey: globKey,
                                apiSecret: globSecret,
                                symbol: candSym,
                                side: "SELL",
                                type: "TAKE_PROFIT_MARKET",
                                stopPrice: takeProfitTriggerPrice,
                                closePosition: true,
                                workingType: "MARK_PRICE",
                              }).catch(() => ({ ok: false, orderId: undefined }))
                              if (tpOrderRes.ok && tpOrderRes.orderId) {
                                console.log(logPrefix, `🎯 [TAKE_PROFIT_MARKET AKTİF] ${candSym} borsa TP emri açıldı (OrderId: ${tpOrderRes.orderId}, Tetik Fiyatı: ${takeProfitTriggerPrice.toFixed(4)})`)
                              }
                            }
                          } catch (tpErr: any) {
                            console.warn(logPrefix, `⚠️ [TP EMRİ GİRİLEMEDİ] ${candSym}:`, tpErr.message)
                          }
                        }

                        await markFuturesBotOwned(candSym)
                        await setFuturesEntryTime(candSym, Date.now())
                        if (sel.smartMoneyRegime) {
                          await setFuturesSmartMoneyRegime(candSym, sel.smartMoneyRegime, Boolean(sel.isShortCovering)).catch(() => {})
                        }
                        const logMsg = `⚡ 🌐 [BINANCE GLOBAL POZİSYON AÇILDI] ${candSym} ${actualMargin.toFixed(2)}$ Marjin ile ${targetLeverage}x İzole Long pozisyonu açıldı! Borsa STOP_MARKET yerleştirildi (${stopLossTriggerPrice.toFixed(4)}$ -%${slPctDisplay}%). TP1: +%${tp1PctDisplay}, TP2: +%${tp2PctDisplay}. [${sel.smartMoneyRegime || "GENEL"}]`
                        executedActions.push(`FUTURES_ENTRY: ${candSym}`)
                        if (isSnipeMode && !snipeResult) {
                          snipeResult = {
                            ok: true,
                            symbol: candSym,
                            price: curPrice,
                            marginUsdt: actualMargin,
                            leverage: targetLeverage,
                            message: `Binance Global ${targetLeverage}x Long emri açıldı: ${candSym}`,
                          }
                        }
                        notifyFuturesTradeEntry({
                          symbol: candSym,
                          leverage: targetLeverage,
                          entryPrice: curPrice,
                          marginUsdt: actualMargin,
                          reason: `Skor ${sel.score} (${sel.reasons.join(" + ") || "Sinyal"}) - ${candSym} ${targetLeverage}x`,
                        }).catch(() => {})
                        console.log(logPrefix, `📊 [GİRİŞ SİNYALİ] ${candSym} ${sel.snapshot}`)
                        await appendServerLog({
                          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                          time: new Date().toLocaleTimeString("tr-TR"),
                          type: "BUY",
                          symbol: candSym,
                          message: `${logMsg} 📊 Sinyal: ${sel.snapshot}`,
                        })
                        break // Bir döngüde tek alım yap
                      } else {
                        console.warn(logPrefix, `Futures buy failed for ${candSym}:`, buyRes.error)
                        executedActions.push(`FUTURES_BUY_ERROR: ${candSym} - ${buyRes.error}`)
                      }
                    } else {
                      console.warn(logPrefix, `Futures minNotional not met for ${candSym}: qty=${formattedQty}, price=${curPrice}, notional=${(formattedQty * curPrice).toFixed(2)}$ (min: ${filters?.minNotional || 5}$)`)
                    }
                  }
                } catch (fErr: any) {
                  console.warn(logPrefix, `Futures candidate ${candSym} check error:`, fErr.message)
                }
              }
            } else {
              console.warn(logPrefix, `Binance Global: ${btcShieldReason || "BTC ani düşüşte"}, sermayeyi korumak için kaldıraçlı alım pas geçildi.`)
              if (futuresSummary) {
                futuresSummary.message = `🛡️ Kalkan: ${btcShieldReason || "BTC ani satış baskısında"}, güvenli mum bekleniyor`
              }
            }
          }
        }
      } catch (globErr: any) {
        console.warn(logPrefix, "Binance Global Futures loop error:", globErr.message)
      }
    }

    if (isSnipeMode && !snipeResult && (snipeExchange === "BINANCE_GLOBAL" || isGlobalOnlyMode)) {
      const globErr = executedActions.find((a) => a.startsWith("FUTURES_BUY_ERROR"))
      snipeResult = {
        ok: false,
        message: globErr
          ? `Binance Global emri iletilemedi: ${globErr.replace("FUTURES_BUY_ERROR: ", "")}`
          : "Binance Global vadeli piyasada şu an taranan coinler pusu kriterlerini bekliyor veya serbest teminat yetersiz.",
      }
    }

    // ── 🏛️ BIST HALKA ARZ RADARI (Midas & Yapı Kredi Otomatik Takip & Telegram Bildirimi) ──
    try {
      const ipos = await getHalkaArzCalendar()
      // Yalnızca aktif talep toplayan veya onaylanmış yeni halka arzları filtrele
      const relevantIpos = ipos.filter(i => i.status === "TALEP_TOPLUYOR" || i.status === "ONAYLANDI")
      
      for (const ipo of relevantIpos.slice(0, 3)) {
        const alreadyNotified = await isHalkaArzNotified(ipo.code)
        if (!alreadyNotified) {
          const msg = formatHalkaArzTelegramMessage(ipo)
          const sendRes = await sendTelegramMessage(msg)
          if (sendRes.ok) {
            await markHalkaArzNotified(ipo.code)
            console.log(logPrefix, `[HALKA ARZ BİLDİRİMİ GÖNDERİLDİ] ${ipo.code} (${ipo.companyName})`)
            executedActions.push(`HALKA_ARZ_ALERT: ${ipo.code}`)
          }
        }
      }
    } catch (ipoErr: any) {
      console.warn(logPrefix, "Halka arz radarı kontrol hatası:", ipoErr.message)
    }

    // ── 🧪 DRY_RUN SANAL POZİSYON SİMÜLATÖRÜ ──
    // DRY_RUN aktifken açılan sanal vadeli pozisyonları her cron turunda mark-to-market eder.
    // Canlı kurallarla AYNI mantık: SL / TP1 kâr kilidi (stop→başabaş) / TP2 hedef /
    // trailing (zirveden %0.8 çekilme) / 48 saat zaman stopu. Tetiklenince SANAL kapatır
    // ve kapanışı sunucu geçmişine yazar → /api/bot/analytics ölçebilir. Gerçek emir YOK.
    try {
      if (isDryRunActive) {
        const simOpenPositions = await getDryRunPositions()
        if (simOpenPositions.length > 0) {
          const simUsdtRate = await getCronUsdtTryRate().catch(() => 0)
          const simRemaining: any[] = []
          for (const sp of simOpenPositions) {
            const simSym = String(sp.symbol || "").toUpperCase()
            if (!simSym) continue
            let markPrice = 0
            try {
              const mpRes = await publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${simSym}`, { cache: "no-store" })
              if (mpRes.ok) {
                const mp: any = await mpRes.json()
                markPrice = parseFloat(mp?.markPrice || mp?.indexPrice || "0") || 0
              }
              if (!markPrice) {
                const tpRes = await publicFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/price?symbol=${simSym}`, { cache: "no-store" })
                if (tpRes.ok) {
                  const tp: any = await tpRes.json()
                  markPrice = parseFloat(tp?.price || "0") || 0
                }
              }
            } catch {}
            const simEntry = Number(sp.entryPrice) || 0
            const simQty = Number(sp.quantity) || 0
            const simLev = Number(sp.leverage) || 1
            const simStop = Number(sp.stopLossPrice) || 0
            if (!markPrice || !simEntry || !simQty) {
              simRemaining.push(sp)
              continue
            }
            const simPriceGainPct = ((markPrice - simEntry) / simEntry) * 100
            const simPeakPrice = Math.max(Number(sp.peakPrice) || simEntry, markPrice)
            sp.peakPrice = simPeakPrice
            const simPeakGainPct = ((simPeakPrice - simEntry) / simEntry) * 100
            const simTp1 = Number(sp.tp1Pct) || 5.6
            const simTp2 = Number(sp.tp2Pct) || 11
            const simOpenHours = (Date.now() - (Number(sp.openedTimestamp) || Date.now())) / 3600000

            let simCloseReason: string | null = null
            if (simStop > 0 && markPrice <= simStop) {
              simCloseReason = `🧪 [SİM] STOP-LOSS DEVREYE GİRDİ (${simPriceGainPct.toFixed(2)}%)`
            } else if (simPriceGainPct >= simTp2) {
              simCloseReason = `🧪 [SİM] HEDEF KÂR ALINDI (+%${simPriceGainPct.toFixed(2)})`
            } else if (sp.tp1Taken && simPeakGainPct >= simTp1 && markPrice <= simPeakPrice * 0.992) {
              simCloseReason = `🧪 [SİM] TRAILING KÂR KİLİTLENDİ (Zirve: +%${simPeakGainPct.toFixed(2)} → Çıkış: +%${simPriceGainPct.toFixed(2)})`
            } else if (simOpenHours >= 48) {
              simCloseReason = `🧪 [SİM] Time-Stop (48 saati aştı, ${simPriceGainPct.toFixed(2)}%)`
            }

            if (simCloseReason) {
              const simPnlUsdt = simQty * (markPrice - simEntry)
              const simNetTry = simUsdtRate > 0 ? simPnlUsdt * simUsdtRate : simPnlUsdt * 30
              const simClosedPos: Position = {
                id: `sim-${simSym}-${Date.now()}`,
                symbol: simSym,
                name: `${simSym} / USDT (SİM)`,
                side: "BUY",
                entryPrice: simEntry,
                currentPrice: markPrice,
                amount: simQty,
                totalTry: simQty * simEntry * (simUsdtRate > 0 ? simUsdtRate : 30),
                takeProfitPrice: formatSmartPrice(simEntry * (1 + simTp2 / 100)),
                stopLossPrice: simStop,
                highestPrice: simPeakPrice,
                pnl: simPnlUsdt,
                pnlPercent: Number(simPriceGainPct.toFixed(2)),
                openedAt: String(sp.openedAt || new Date().toISOString()),
                openedTimestamp: Number(sp.openedTimestamp) || Date.now(),
                status: "CLOSED",
                closePrice: markPrice,
                exitPrice: markPrice,
                closeReason: simCloseReason,
                closedAt: new Date().toISOString(),
                closedTimestamp: Date.now(),
                triggerType: "AI_SUGGESTION",
                orderType: "MARKET",
                commissionTry: 0,
                netPnlTry: simNetTry,
                isRealOrder: false,
                isFutures: true,
                leverage: simLev,
              } as Position
              await appendServerHistory(simClosedPos).catch(() => {})
              await appendServerLog({
                id: `log-sim-exit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                time: new Date().toLocaleTimeString("tr-TR"),
                type: simNetTry >= 0 ? "SELL" : "ALERT",
                symbol: simSym,
                message: `${simCloseReason} | Giriş: ${simEntry} → Çıkış: ${markPrice} | Net: ${simNetTry >= 0 ? "+" : ""}${simNetTry.toFixed(2)} TL (SİMÜLASYON — gerçek emir yok)`,
              }).catch(() => {})
              executedActions.push(`DRY_RUN_SIM_CLOSE: ${simSym}`)
              console.log(logPrefix, `🧪 [SİM KAPANIŞ] ${simSym}: ${simCloseReason} | Net: ${simNetTry.toFixed(2)} TL`)
            } else {
              // TP1 kâr kilidi: zirve TP1'e ulaştıysa stop'u başabaşa (+komisyon) çek
              if (!sp.tp1Taken && simPeakGainPct >= simTp1) {
                sp.tp1Taken = true
                sp.stopLossPrice = Math.max(simStop, simEntry * 1.0008)
                console.log(logPrefix, `🧪 [SİM TP1] ${simSym} zirve +%${simPeakGainPct.toFixed(2)} → stop başabaşa çekildi (${sp.stopLossPrice.toFixed(6)})`)
              }
              simRemaining.push(sp)
            }
          }
          await setDryRunPositions(simRemaining).catch(() => {})
          if (simOpenPositions.length > 0) {
            console.log(logPrefix, `🧪 [SİMÜLASYON] ${simOpenPositions.length} sanal pozisyon takip edildi, ${simRemaining.length} tanesi açık kaldı.`)
          }
        }
      }
    } catch (simLoopErr: any) {
      console.warn(logPrefix, "DRY_RUN simülatör hatası:", simLoopErr?.message)
    }

    // ── 📆 GÜNLÜK DRY_RUN KARNESİ (Telegram hatırlatıcısı) ──
    // DRY_RUN simülasyonu aktifken günde BİR KEZ, bugün (TR saati) kapanan
    // işlemlerin karne özetini Telegram'a atar: işlem sayısı / isabet / net TL.
    // Amaç: "2-3 gün sonra karneye bak" hatırlatmasını botun kendisi yapar;
    // canlıya dönüş kararı için ölçüt: isabet ≥ %46 ve net pozitif.
    try {
      if (botRisk.dryRun) {
        const karneDay = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" }) // YYYY-MM-DD (TR)
        const karneFlag = await redisCmd("GET", `bot:dryrun:karne:${karneDay}`)
        if (!karneFlag) {
          await redisCmd("SET", `bot:dryrun:karne:${karneDay}`, "1", "EX", 129600) // 36 saat tolerans
          const allHist = await getServerHistory()
          const todayCloses = allHist.filter((p: Position) => {
            if (p.status !== "CLOSED") return false
            const ts = p.closedTimestamp || (p.closedAt ? new Date(p.closedAt).getTime() : 0)
            if (!ts) return false
            return new Date(ts).toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" }) === karneDay
          })
          let karneWins = 0
          let karneLosses = 0
          let karneNetTry = 0
          let simCount = 0
          for (const t of todayCloses) {
            const net = typeof t.netPnlTry === "number" ? t.netPnlTry : t.pnl ?? 0
            if (net > 0) karneWins++
            else if (net < 0) karneLosses++
            karneNetTry += net
            if (!t.isRealOrder) simCount++
          }
          const karneTotal = todayCloses.length
          const karneWr = karneTotal > 0 ? Math.round((karneWins / karneTotal) * 100) : null
          const karneNetStr = `${karneNetTry >= 0 ? "+" : "-"}${Math.abs(karneNetTry).toFixed(2)} TL`
          const karneMsg =
            `📆 <b>DRY_RUN GÜNLÜK KARNE</b> — ${karneDay} (TR)\n` +
            `• Kapanan işlem: ${karneTotal}` +
            (karneTotal > 0 ? ` (kazanç ${karneWins} / zarar ${karneLosses} — isabet %${karneWr})\n` : "\n") +
            `• Net: ${karneNetStr}` +
            (simCount > 0 ? ` — bunlardan ${simCount} tanesi SİMÜLASYON (gerçek emir yok)` : "") +
            `\n• 🛡️ Gerçek emir gönderilmiyor, cüzdan etkilenmiyor.\n` +
            `• ⏰ Hatırlatma: canlıya (DRY_RUN=false) ancak isabet ≥ %46 <b>ve</b> net pozitife geçince dönülecek. Karar için 2-3 gün veri birikmesi hedef.` +
            (karneTotal === 0 ? `\n• Bugün kapanış yok — olabilir: BTC rejimi kapalı / FOMO engeli / slot dolu iken bot bekler. Bu da bir veri noktası.` : "")
          const karneRes = await sendTelegramMessage(karneMsg)
          console.log(
            logPrefix,
            karneRes.ok
              ? `📆 [DRY_RUN KARNESİ GÖNDERİLDİ] ${karneTotal} işlem, net ${karneNetStr}`
              : `📆 [DRY_RUN KARNESİ GÖNDERİLEMEDİ] ${karneRes.error || "bilinmeyen hata"} (Telegram config eksik olabilir)`
          )
          executedActions.push(`DRY_RUN_KARNE: ${karneTotal} işlem, ${karneNetStr}`)
        }
      }
    } catch (karneErr: any) {
      console.warn(logPrefix, "DRY_RUN karne hatası:", karneErr?.message)
    }

    const finalPositions = await getServerPositions()
    const mode = trMode !== "SCANNING"
      ? trMode
      : finalPositions.length >= 3
      ? "TRIPLE_SLOT_MONITORING"
      : finalPositions.length === 2
      ? "DUAL_SLOT_MONITORING"
      : finalPositions.length === 1
      ? "SINGLE_SLOT_MONITORING"
      : "SCANNING"
    let message = trSkipReason || (finalPositions.length >= 2
      ? `${finalPositions.length} slot aktif (${finalPositions.map(p => p.symbol).join(", ")}). Pozisyonlar 7/24 takip ediliyor.`
      : "Slot taraması yapılıyor…")

    if (futuresSummary?.ok) {
      message = `[🇹🇷 TR] ${message} | [🌐 Futures] ${futuresSummary.message}`
    }

    return NextResponse.json({
      ok: true,
      active: true,
      mode,
      openPositions: finalPositions.length,
      actions: executedActions,
      freeTry,
      futures: futuresSummary,
      message,
      timestamp,
      ...(snipeResult ? { snipeResult } : {}),
    })
  } catch (err: any) {
    console.error(logPrefix, "Cron fatal error:", err)
    return NextResponse.json(
      { ok: false, error: err.message || "Cron dÃ¶ngÃ¼sÃ¼nde beklenmeyen hata" },
      { status: 500 }
    )
  } finally {
    if (lockToken) {
      await releaseCronLock(lockToken).catch(() => {})
    }
  }
}

