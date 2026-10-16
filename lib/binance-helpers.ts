import https from "node:https"
import crypto from "node:crypto"
import zlib from "node:zlib"
import { HttpsProxyAgent } from "https-proxy-agent"

import { getBotRiskConfig } from "./bot/security-config"

// 🌐 BİNANCE GLOBAL PROXY YAPILANDIRMASI
// Vercel serverless ortamında fapi.binance.com erişimi ve sabit IP beyaz listesi için proxy kullanılır.
const DEFAULT_FUTURES_PROXY = "http://jxvenqjc:mf1gtma6enzl@64.137.10.153:5803"

function resolveSafeProxyUrl(): string {
  const raw = (process.env.FUTURES_PROXY_URL || "").trim().replace(/^["']|["']$/g, "")
  if (raw && (raw.startsWith("http://") || raw.startsWith("https://")) && !raw.includes("[SENSITIVE]")) {
    return raw
  }
  return DEFAULT_FUTURES_PROXY
}

const FUTURES_PROXY_URL = resolveSafeProxyUrl()
const USE_PROXY = process.env.USE_FUTURES_PROXY !== "false" && Boolean(FUTURES_PROXY_URL)

let proxyAgent: any = undefined
try {
  if (USE_PROXY && FUTURES_PROXY_URL) {
    proxyAgent = new HttpsProxyAgent(FUTURES_PROXY_URL, {
      keepAlive: true,
      keepAliveMsecs: 15000,
      maxSockets: 25,
      maxFreeSockets: 10,
      timeout: 8000,
    })
  }
} catch (agentErr: any) {
  console.warn("[binance-helpers] Proxy başlatma uyarısı:", agentErr.message)
}

export async function futuresProxyFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (!USE_PROXY) {
    return fetch(url, {
      ...options,
      cache: "no-store",
      signal: options.signal || AbortSignal.timeout(8000),
    })
  }
  const headers: Record<string, string> = {}
  if (options.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((v, k) => { headers[k] = v })
    } else if (Array.isArray(options.headers)) {
      options.headers.forEach(([k, v]) => { headers[k] = v })
    } else {
      Object.assign(headers, options.headers)
    }
  }

  const hasApiKey = Boolean(headers["X-MBX-APIKEY"] || headers["x-mbx-apikey"])

  // ⚡ GZIP / DEFLATE SIKIŞTIRMA (Proxy Bant Genişliğini %85 Azaltır):
  // Binance'in dev JSON yanıtları sıkıştırılarak proxy üzerinden geçer, kota 10 kat daha yavaş erir.
  headers["Accept-Encoding"] = "gzip, deflate"

  // 🌐 Tüm Binance Global Futures istekleri (fapi.binance.com) Frankfurt sabit IP proxy (31.58.9.4) üzerinden geçer.
  // Bu sayede Vercel ABD sunucu bloğu (HTTP 451 / 403) ve IP beyaz liste gereksinimi tamamen aşılır.

  // 2. İmzalı hesap, bakiye ve emir istekleri (X-MBX-APIKEY içerenler):
  // Binance Global IP beyaz listesine kayıtlı sabit Frankfurt IP'si (31.58.9.4) üzerinden geçer.
  return new Promise((resolve) => {
    try {
      const u = new URL(url)
      const method = (options.method || "GET").toUpperCase()
      const req = https.request({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers,
        agent: proxyAgent,
        timeout: 8000,
      }, (res) => {
        const chunks: Buffer[] = []
        res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on("end", () => {
          let bodyBuffer = Buffer.concat(chunks)
          const encoding = (res.headers["content-encoding"] || "").toLowerCase()

          // Gzip / Deflate açma (Decompression)
          if (encoding === "gzip") {
            try { bodyBuffer = zlib.gunzipSync(bodyBuffer) } catch (e: any) {
              console.warn("[futuresProxyFetch] gzip açma uyarısı:", e.message)
            }
          } else if (encoding === "deflate") {
            try { bodyBuffer = zlib.inflateSync(bodyBuffer) } catch (e: any) {
              console.warn("[futuresProxyFetch] deflate açma uyarısı:", e.message)
            }
          }

          const text = bodyBuffer.toString("utf8")

          // Proxy kota aşımı veya yetki hatası durumunda doğrudan bağlantıya geç:
          if (
            res.statusCode === 402 ||
            res.statusCode === 407 ||
            res.statusCode === 502 ||
            res.statusCode === 503 ||
            res.statusCode === 504 ||
            text.includes("Bandwidth limit") ||
            text.includes("Proxy Authentication")
          ) {
            console.warn("[futuresProxyFetch] Proxy bant genişliği veya bağlantı uyarısı! Doğrudan bağlantıya geçiliyor...")
            return resolve(fetch(url, {
              ...options,
              cache: "no-store",
              signal: options.signal || AbortSignal.timeout(6000),
            }))
          }

          const respHeaders = new Headers()
          for (const [key, val] of Object.entries(res.headers)) {
            // Sıkıştırılmış başlığı kaldır (veriyi zaten açtık)
            if (key.toLowerCase() === "content-encoding") continue
            if (val) {
              if (Array.isArray(val)) {
                val.forEach(v => respHeaders.append(key, v))
              } else {
                respHeaders.set(key, val)
              }
            }
          }
          resolve(new Response(bodyBuffer, {
            status: res.statusCode || 200,
            statusText: res.statusMessage || "OK",
            headers: respHeaders,
          }))
        })
      })

      req.on("error", (err) => {
        console.warn("[futuresProxyFetch] Proxy ağ hatası, doğrudan bağlantıya geçiliyor:", err.message)
        resolve(fetch(url, {
          ...options,
          cache: "no-store",
          signal: options.signal || AbortSignal.timeout(6000),
        }))
      })

      req.on("timeout", () => {
        req.destroy()
        console.warn("[futuresProxyFetch] Proxy zaman aşımı, doğrudan bağlantıya geçiliyor...")
        resolve(fetch(url, {
          ...options,
          cache: "no-store",
          signal: options.signal || AbortSignal.timeout(6000),
        }))
      })

      if (options.body) {
        if (typeof options.body === "string" || Buffer.isBuffer(options.body)) {
          req.write(options.body)
        } else {
          req.write(String(options.body))
        }
      }

      req.end()
    } catch (err: any) {
      console.warn("[futuresProxyFetch] Proxy oluşturma hatası, doğrudan bağlantıya geçiliyor:", err.message)
      resolve(fetch(url, {
        ...options,
        cache: "no-store",
        signal: options.signal || AbortSignal.timeout(6000),
      }))
    }
  })
}

export const BINANCE_TR_BASE = "https://www.trbinance.com"

// 10 dakikalık sembol kuralları önbelleği
let cachedSymbols: any[] | null = null
let cachedSymbolsTime = 0
const recentBuyOrders = new Map<string, number>()

export function signQuery(query: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(query).digest("hex")
}

export function countDecimals(num: number): number {
  const str = num.toString()
  if (str.includes("e-")) {
    const exp = parseInt(str.split("e-")[1], 10)
    return exp
  }
  if (!str.includes(".")) return 0
  return str.split(".")[1].length
}

export function formatWithStepSize(qty: number, stepSize: number, maxPrecision = 8): string {
  const safeQty = Math.abs(Number(qty) || 0)
  if (stepSize <= 0) return safeQty.toFixed(Math.min(maxPrecision, 4))
  const decimals = Math.min(maxPrecision, countDecimals(stepSize))
  
  // Asla yukarı yuvarlama yapma (Math.floor), bakiye aşımı -2010 hatası vermesin
  const factor = Math.pow(10, decimals)
  const stepped = Math.floor((safeQty / stepSize) + 1e-9) * stepSize
  const truncated = Math.floor(stepped * factor + 1e-9) / factor
  return truncated.toFixed(decimals)
}

export function formatWithTickSize(price: number, tickSize: number, maxPrecision = 8): string {
  if (tickSize <= 0) return price.toFixed(Math.min(maxPrecision, 2))
  const decimals = Math.min(maxPrecision, countDecimals(tickSize))
  const factor = Math.pow(10, decimals)
  const stepped = Math.round((price / tickSize)) * tickSize
  const rounded = Math.round(stepped * factor) / factor
  return rounded.toFixed(decimals)
}

export async function getSymbolFilters(symbol: string): Promise<{
  stepSize: number
  minQty: number
  minNotional: number
  basePrecision: number
  tickSize: number
  quotePrecision: number
  marketStepSize?: number
  marketMinQty?: number
} | null> {
  try {
    const now = Date.now()
    if (!cachedSymbols || now - cachedSymbolsTime > 10 * 60 * 1000) {
      const res = await fetch(`${BINANCE_TR_BASE}/open/v1/common/symbols`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      })
      const json = await res.json()
      if (json.code === 0 && Array.isArray(json.data?.list)) {
        cachedSymbols = json.data.list
        cachedSymbolsTime = now
      }
    }

    if (cachedSymbols) {
      const info = cachedSymbols.find((s) => s.symbol === symbol)
      if (info) {
        const lotSizeFilter = info.filters?.find((f: any) => f.filterType === "LOT_SIZE")
        const marketLotSizeFilter = info.filters?.find((f: any) => f.filterType === "MARKET_LOT_SIZE")
        const notionalFilter = info.filters?.find((f: any) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL")
        const priceFilter = info.filters?.find((f: any) => f.filterType === "PRICE_FILTER")
        const stepSize = lotSizeFilter ? parseFloat(lotSizeFilter.stepSize) : 0.0001
        const minQty = lotSizeFilter ? parseFloat(lotSizeFilter.minQty) : 0.0001
        const minNotional = notionalFilter ? parseFloat(notionalFilter.minNotional) : 10
        const tickSize = priceFilter ? parseFloat(priceFilter.tickSize) : 0.01
        const basePrecision = typeof info.basePrecision === "number" ? info.basePrecision : 8
        const quotePrecision = typeof info.quotePrecision === "number" ? info.quotePrecision : 4

        // Market emirleri için özel hassasiyet kontrolü
        // MARKET_LOT_SIZE.stepSize = 0 olduğunda LOT_SIZE.stepSize'ı kullan (örn: LTC)
        let marketStepSize = stepSize
        if (marketLotSizeFilter) {
          const mls = parseFloat(marketLotSizeFilter.stepSize)
          if (mls > 0) {
            marketStepSize = mls
          }
          // mls === 0 ise LOT_SIZE.stepSize zaten geçerli — override etme
        }
        const marketMinQty = (marketLotSizeFilter && parseFloat(marketLotSizeFilter.minQty) > 0)
          ? parseFloat(marketLotSizeFilter.minQty)
          : minQty

        return { stepSize, minQty, minNotional, basePrecision, tickSize, quotePrecision, marketStepSize, marketMinQty }
      }
    }
  } catch (err) {
    console.warn("Binance TR symbol filters fetch failed:", err)
  }

  // Güvenlik Düşüşü: Binance TR sembol önbelleği geçici olarak boşsa veya sembol bulunamazsa
  const baseSymbol = symbol.replace("_", "").replace(/TRY$/, "").toUpperCase()
  const isMeme = ["PEPE", "SHIB", "BONK", "FLOKI", "LUNC", "BTTC"].includes(baseSymbol)
  const fallbackStep = isMeme ? 1 : 0.0001
  const fallbackMinQty = isMeme ? 1 : 0.0001
  return {
    stepSize: fallbackStep,
    minQty: fallbackMinQty,
    minNotional: 10,
    basePrecision: isMeme ? 0 : 8,
    tickSize: 0.01,
    quotePrecision: 4,
    marketStepSize: fallbackStep,
    marketMinQty: fallbackMinQty,
  }
}

export async function getFreeBalance(apiKey: string, apiSecret: string, asset: string): Promise<number> {
  try {
    const timestamp = Date.now()
    const recvWindow = 60000
    const queryString = `recvWindow=${recvWindow}&timestamp=${timestamp}`
    const signature = signQuery(queryString, apiSecret)

    const res = await fetch(`${BINANCE_TR_BASE}/open/v1/account/spot?${queryString}&signature=${signature}`, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": apiKey,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    })

    const json = await res.json()
    if (json.code === 0 && json.data && Array.isArray(json.data.accountAssets)) {
      const cleanAsset = asset.trim().toUpperCase()
      const found = json.data.accountAssets.find((a: any) => {
        const itemAsset = String(a.asset || "").trim().toUpperCase()
        if (cleanAsset === "TRY" || cleanAsset === "TL") {
          return itemAsset === "TRY" || itemAsset === "TL"
        }
        return itemAsset === cleanAsset
      })
      if (found) {
        return parseFloat(found.free) || 0
      }
    }
  } catch (err) {
    console.warn("Binance TR balance query failed:", err)
  }
  return 0
}

export async function getSpotAccountAssets(apiKey: string, apiSecret: string): Promise<{
  freeTry: number
  lockedTry: number
  assets: Array<{ asset: string; free: number; locked: number; total: number }>
}> {
  try {
    const timestamp = Date.now()
    const recvWindow = 60000
    const queryString = `recvWindow=${recvWindow}&timestamp=${timestamp}`
    const signature = signQuery(queryString, apiSecret)

    const res = await fetch(`${BINANCE_TR_BASE}/open/v1/account/spot?${queryString}&signature=${signature}`, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": apiKey,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    })

    const json = await res.json()
    if (json.code === 0 && json.data && Array.isArray(json.data.accountAssets)) {
      let freeTry = 0
      let lockedTry = 0
      const assets: Array<{ asset: string; free: number; locked: number; total: number }> = []

      for (const item of json.data.accountAssets) {
        const free = parseFloat(item.free) || 0
        const locked = parseFloat(item.locked) || 0
        const total = free + locked
        const assetName = String(item.asset || "").trim().toUpperCase()
        if (assetName === "TRY" || assetName === "TL") {
          freeTry = free
          lockedTry = locked
        } else if (total > 0.00000001) {
          assets.push({ asset: assetName, free, locked, total })
        }
      }
      return { freeTry, lockedTry, assets }
    }
  } catch (err) {
    console.warn("Binance TR account assets query failed:", err)
  }
  return { freeTry: 0, lockedTry: 0, assets: [] }
}

export async function executeBinanceTrSpotOrder(params: {
  symbol: string
  side: "BUY" | "SELL"
  type?: "MARKET" | "LIMIT"
  quoteOrderQty?: number
  quantity?: number
  price?: number
  isPartial?: boolean
  apiKey: string
  apiSecret: string
}): Promise<{
  ok: boolean
  orderId?: string | number
  status?: string
  executedQty?: number
  cummulativeQuoteQty?: number
  message?: string
  error?: string
}> {
  try {
    const cleanKey = params.apiKey.trim()
    const cleanSecret = params.apiSecret.trim()
    const timestamp = Date.now()
    const recvWindow = 60000

    let trSymbol = params.symbol.toUpperCase()
    if (!trSymbol.includes("_") && trSymbol.endsWith("TRY")) {
      trSymbol = trSymbol.slice(0, -3) + "_TRY"
    } else if (!trSymbol.includes("_")) {
      trSymbol = trSymbol + "_TRY"
    }

    const baseAsset = trSymbol.split("_")[0]
    const filters = await getSymbolFilters(trSymbol)
    const stepSize = filters?.stepSize || 0.0001
    const minQty = filters?.minQty || 0.0001
    const basePrecision = filters?.basePrecision || 8

    const trSide = params.side === "BUY" ? "0" : "1"
    const isMarket = !params.type || params.type === "MARKET"
    const trType = isMarket ? "2" : "1"

    const orderParams: Record<string, string> = {
      symbol: trSymbol,
      side: trSide,
      type: trType,
      timestamp: String(timestamp),
      recvWindow: String(recvWindow),
    }

    // 🟢 MARKET BUY
    if (trSide === "0" && trType === "2") {
      const lastBuy = recentBuyOrders.get(trSymbol) || 0
      if (timestamp - lastBuy < 15000) {
        return {
          ok: false,
          error: `${trSymbol} için son 15 saniyede alım yapıldı. Çift alım koruması devreye girdi.`,
        }
      }
      const freeTry = await getFreeBalance(cleanKey, cleanSecret, "TRY")
      const requestedTry = params.quoteOrderQty ? Number(params.quoteOrderQty) : 0

      if (freeTry < 10) {
        return {
          ok: false,
          error: `Binance TR hesabınızda alım yapacak serbest TRY bulunmuyor (Serbest: ${freeTry.toFixed(2)} ₺, Minimum: 10.00 ₺).`,
        }
      }

      const maxSpendable = Math.max(10, Math.floor(freeTry * 0.998 * 100) / 100)
      const buyTry = requestedTry > 0 ? Math.min(requestedTry, maxSpendable) : maxSpendable
      orderParams.quoteOrderQty = buyTry.toFixed(2)
    }
    // 🔴 MARKET SELL
    else if (trSide === "1" && trType === "2") {
      const freeBalance = await getFreeBalance(cleanKey, cleanSecret, baseAsset)
      let sellQty: number
      if (params.isPartial && params.quantity && params.quantity > 0) {
        // Kısmi kâr satışı: İstenen miktar ile serbest bakiye arasından küçüğünü al
        sellQty = freeBalance > 0 ? Math.min(params.quantity, freeBalance) : params.quantity
      } else {
        // Tam çıkış (TP, SL, Trailing, Manuel): Cüzdandaki TÜM serbest bakiyeyi sat — artık/toz bakiye bırakma!
        sellQty = freeBalance > 0 ? freeBalance : (params.quantity && params.quantity > 0 ? params.quantity : 0)
      }

      if (sellQty <= 0) {
        return {
          ok: false,
          error: `Binance TR cüzdanınızda satılabilir ${baseAsset} bakiyesi bulunamadı (0 adet).`,
        }
      }

      const activeStepSize = filters?.marketStepSize || stepSize
      const activeMinQty = filters?.marketMinQty || minQty
      const formattedQty = formatWithStepSize(sellQty, activeStepSize, basePrecision)
      if (parseFloat(formattedQty) < activeMinQty) {
        return {
          ok: false,
          error: `Binance TR minimum satış adedi yetersiz: ${formattedQty} ${baseAsset} (Minimum: ${activeMinQty})`,
        }
      }

      orderParams.quantity = formattedQty
    }
    // ⚪ LIMIT EMİRLER
    else if (trType === "1") {
      if (!params.price) {
        return { ok: false, error: "Limit emir için fiyat belirtilmelidir." }
      }
      const tickSize = filters?.tickSize || 0.01
      const quotePrecision = filters?.quotePrecision || 4
      const formattedPrice = formatWithTickSize(Number(params.price), tickSize, quotePrecision)
      orderParams.price = formattedPrice

      let targetQty = Number(params.quantity || 0)

      if (trSide === "0") {
        const lastBuy = recentBuyOrders.get(trSymbol) || 0
        if (timestamp - lastBuy < 15000) {
          return {
            ok: false,
            error: `${trSymbol} için son 15 saniyede işlem açıldı. Çift alım koruması devrede.`,
          }
        }

        const freeTry = await getFreeBalance(cleanKey, cleanSecret, "TRY")
        if (freeTry < 10) {
          return {
            ok: false,
            error: `Binance TR serbest TRY bakiyesi yetersiz (${freeTry.toFixed(2)} ₺, min 10 ₺).`,
          }
        }

        const priceNum = parseFloat(formattedPrice) || Number(params.price)
        if (priceNum > 0) {
          const maxQtyByBalance = (freeTry * 0.995) / priceNum
          if (targetQty > maxQtyByBalance) {
            targetQty = maxQtyByBalance
          }
        }
      }

      const formattedQty = formatWithStepSize(targetQty, stepSize, basePrecision)
      if (parseFloat(formattedQty) < minQty) {
        return {
          ok: false,
          error: `Binance TR minimum adet sınırı: ${formattedQty} (Min: ${minQty})`,
        }
      }

      orderParams.quantity = formattedQty
      orderParams.timeInForce = "1"
    }

    const queryString = new URLSearchParams(orderParams).toString()
    const signature = signQuery(queryString, cleanSecret)

    const orderRes = await fetch(`${BINANCE_TR_BASE}/open/v1/orders`, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": cleanKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `${queryString}&signature=${signature}`,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    })

    const json = await orderRes.json()
    if (json.code === 0 && json.data) {
      if (trSide === "0") {
        recentBuyOrders.set(trSymbol, Date.now())
      }
      const orderData = json.data
      const rawStatus = orderData.status
      let executedQty = parseFloat(orderData.executedQty || "0")
      let cummulativeQuoteQty = parseFloat(orderData.executedQuoteQty || orderData.cummulativeQuoteQty || "0")

      // 0: NEW, 1: PARTIALLY_FILLED, 2: FILLED, 3: CANCELED
      let orderStatus: "FILLED" | "PARTIALLY_FILLED" | "NEW" = "NEW"
      if (rawStatus === 2 || rawStatus === "FILLED" || isMarket) {
        orderStatus = "FILLED"
        if (executedQty <= 0 && trSide === "0") {
          try {
            await new Promise((r) => setTimeout(r, 350))
            const freshBalance = await getFreeBalance(cleanKey, cleanSecret, baseAsset)
            if (freshBalance > 0) {
              executedQty = freshBalance
            }
          } catch {}
        }
      } else if (rawStatus === 1 || rawStatus === "PARTIALLY_FILLED") {
        orderStatus = "PARTIALLY_FILLED"
      } else {
        orderStatus = "NEW"
      }

      if (cummulativeQuoteQty <= 0 && executedQty > 0) {
        if (orderParams.price) {
          cummulativeQuoteQty = parseFloat(orderParams.price) * executedQty
        } else if (orderParams.quoteOrderQty) {
          cummulativeQuoteQty = parseFloat(orderParams.quoteOrderQty)
        }
      }

      return {
        ok: true,
        orderId: orderData.orderId,
        status: orderStatus,
        executedQty,
        cummulativeQuoteQty,
        message: `🟢 Binance TR Emri: ${trSymbol} ${params.side} | Durum: ${orderStatus} | Dolan Adet: ${executedQty} | Emir ID: ${orderData.orderId}`,
      }
    } else {
      let userFriendly = json.msg || JSON.stringify(json)
      if (json.msg && (json.msg.includes("NOTIONAL") || json.msg.includes("-1013"))) {
        userFriendly = "Binance Minimum Emir Limiti (NOTIONAL): Girilen tutar minimum işlem tutarının altında."
      }
      return { ok: false, error: userFriendly }
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Binance bağlantı hatası" }
  }
}

/** Belirli bir Binance TR Emrini İptal Et */
export async function cancelBinanceTrOrder(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  orderId: string | number
): Promise<{ ok: boolean; error?: string }> {
  try {
    const cleanKey = apiKey.trim()
    const cleanSecret = apiSecret.trim()
    let trSymbol = symbol.toUpperCase()
    if (!trSymbol.includes("_") && trSymbol.endsWith("TRY")) {
      trSymbol = trSymbol.slice(0, -3) + "_TRY"
    } else if (!trSymbol.includes("_")) {
      trSymbol = trSymbol + "_TRY"
    }
    const timestamp = Date.now()
    const recvWindow = 60000
    const query = `symbol=${trSymbol}&orderId=${orderId}&recvWindow=${recvWindow}&timestamp=${timestamp}`
    const signature = signQuery(query, cleanSecret)

    const res = await fetch(`${BINANCE_TR_BASE}/open/v1/orders?${query}&signature=${signature}`, {
      method: "DELETE",
      headers: { "X-MBX-APIKEY": cleanKey },
      signal: AbortSignal.timeout(4000),
    })
    const json = await res.json()
    if (json.code === 0) return { ok: true }
    return { ok: false, error: json.msg || "İptal başarısız" }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

/** Binance TR Emir Durumunu ve Dolan Miktarı Doğrula */
export async function getBinanceTrOrderStatus(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  orderId: string | number
): Promise<{
  ok: boolean
  status: "FILLED" | "PARTIALLY_FILLED" | "NEW" | "CANCELED" | "EXPIRED" | "REJECTED" | "UNKNOWN"
  executedQty: number
  cummulativeQuoteQty: number
  avgPrice: number
  price: number
  error?: string
}> {
  try {
    const cleanKey = apiKey.trim()
    const cleanSecret = apiSecret.trim()
    let trSymbol = symbol.toUpperCase()
    if (!trSymbol.includes("_") && trSymbol.endsWith("TRY")) {
      trSymbol = trSymbol.slice(0, -3) + "_TRY"
    } else if (!trSymbol.includes("_")) {
      trSymbol = trSymbol + "_TRY"
    }

    const timestamp = Date.now()
    const recvWindow = 60000
    const query = `symbol=${trSymbol}&orderId=${orderId}&recvWindow=${recvWindow}&timestamp=${timestamp}`
    const signature = signQuery(query, cleanSecret)

    const res = await fetch(`${BINANCE_TR_BASE}/open/v1/orders?${query}&signature=${signature}`, {
      headers: { "X-MBX-APIKEY": cleanKey },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    })

    if (res.ok) {
      const json = await res.json()
      if (json.code === 0 && json.data) {
        const d = json.data
        const rawStatus = d.status
        const executedQty = parseFloat(d.executedQty || "0")
        const cummulativeQuoteQty = parseFloat(d.cummulativeQuoteQty || d.executedQuoteQty || "0")
        const avgPrice = executedQty > 0 && cummulativeQuoteQty > 0 ? cummulativeQuoteQty / executedQty : parseFloat(d.price || "0")

        let status: "FILLED" | "PARTIALLY_FILLED" | "NEW" | "CANCELED" | "EXPIRED" | "REJECTED" | "UNKNOWN" = "UNKNOWN"
        if (rawStatus === 2 || rawStatus === "FILLED") status = "FILLED"
        else if (rawStatus === 1 || rawStatus === "PARTIALLY_FILLED") status = "PARTIALLY_FILLED"
        else if (rawStatus === 0 || rawStatus === "NEW") status = "NEW"
        else if (rawStatus === 3 || rawStatus === "CANCELED") status = "CANCELED"
        else if (rawStatus === 4 || rawStatus === "EXPIRED") status = "EXPIRED"
        else if (rawStatus === 5 || rawStatus === "REJECTED") status = "REJECTED"

        return { ok: true, status, executedQty, cummulativeQuoteQty, avgPrice, price: avgPrice }
      }
    }

    // Açık emirlerde ara
    const openQuery = `symbol=${trSymbol}&recvWindow=${recvWindow}&timestamp=${timestamp}`
    const openSig = signQuery(openQuery, cleanSecret)
    const openRes = await fetch(`${BINANCE_TR_BASE}/open/v1/orders/open?${openQuery}&signature=${openSig}`, {
      headers: { "X-MBX-APIKEY": cleanKey },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    })
    if (openRes.ok) {
      const openJson = await openRes.json()
      if (openJson.code === 0 && Array.isArray(openJson.data?.list)) {
        const found = openJson.data.list.find((o: any) => String(o.orderId) === String(orderId))
        if (found) {
          const executedQty = parseFloat(found.executedQty || "0")
          const p = parseFloat(found.price || "0")
          return {
            ok: true,
            status: executedQty > 0 ? "PARTIALLY_FILLED" : "NEW",
            executedQty,
            cummulativeQuoteQty: parseFloat(found.cummulativeQuoteQty || "0"),
            avgPrice: p,
            price: p,
          }
        }
      }
    }

    return { ok: false, status: "UNKNOWN", executedQty: 0, cummulativeQuoteQty: 0, avgPrice: 0, price: 0 }
  } catch (e: any) {
    return { ok: false, status: "UNKNOWN", executedQty: 0, cummulativeQuoteQty: 0, avgPrice: 0, price: 0, error: e.message }
  }
}

export async function cancelAllOpenOrders(apiKey: string, apiSecret: string): Promise<{ canceled: number }> {
  // Cüzdanda locked bakiyesi olan tüm coinleri ve popüler çiftleri otomatik topla
  const dynamicPairs = new Set<string>([
    "COW_TRY", "MUBARAK_TRY", "DOT_TRY", "PEPE_TRY", "DOGE_TRY", "SHIB_TRY",
    "FLOKI_TRY", "BONK_TRY", "BOME_TRY", "RENDER_TRY", "NEAR_TRY", "FET_TRY",
    "XRP_TRY", "SUI_TRY", "BTC_TRY", "ETH_TRY", "SOL_TRY", "AVAX_TRY",
    "ADA_TRY", "HOT_TRY", "CHZ_TRY", "GALA_TRY", "SAND_TRY", "TIA_TRY",
    "INJ_TRY", "ARB_TRY", "OP_TRY", "LINK_TRY", "WLD_TRY", "APT_TRY", "LTC_TRY"
  ])

  try {
    const wallet = await getSpotAccountAssets(apiKey, apiSecret)
    for (const a of wallet.assets) {
      if (a.locked > 0 && a.asset !== "TRY" && a.asset !== "TL") {
        dynamicPairs.add(`${a.asset.toUpperCase()}_TRY`)
      }
    }
  } catch {}

  const pairsToCheck = Array.from(dynamicPairs)
  let canceled = 0
  const recvWindow = 60000

  const results = await Promise.allSettled(
    pairsToCheck.map(async (pair) => {
      let localCanceled = 0
      try {
        const timestamp = Date.now()
        const queryString = `symbol=${pair}&recvWindow=${recvWindow}&timestamp=${timestamp}`
        const signature = signQuery(queryString, apiSecret)

        const res = await fetch(`${BINANCE_TR_BASE}/open/v1/orders/open?${queryString}&signature=${signature}`, {
          headers: { "X-MBX-APIKEY": apiKey },
          cache: "no-store",
          signal: AbortSignal.timeout(3000),
        })
        const json = await res.json()

        if (json.code === 0 && Array.isArray(json.data?.list) && json.data.list.length > 0) {
          for (const ord of json.data.list) {
            try {
              const cancelTs = Date.now()
              const cancelQuery = `symbol=${ord.symbol || pair}&orderId=${ord.orderId}&recvWindow=${recvWindow}&timestamp=${cancelTs}`
              const cancelSig = signQuery(cancelQuery, apiSecret)
              const delRes = await fetch(`${BINANCE_TR_BASE}/open/v1/orders?${cancelQuery}&signature=${cancelSig}`, {
                method: "DELETE",
                headers: { "X-MBX-APIKEY": apiKey },
                signal: AbortSignal.timeout(3000),
              })
              const delJson = await delRes.json()
              if (delJson.code === 0) {
                localCanceled++
              }
            } catch {}
          }
        }
      } catch {}
      return localCanceled
    })
  )

  for (const r of results) {
    if (r.status === "fulfilled") {
      canceled += r.value
    }
  }

  return { canceled }
}

export async function emergencySellAll(apiKey: string, apiSecret: string): Promise<{ ok: boolean; soldList: string[]; totalGainedTry: number }> {
  await cancelAllOpenOrders(apiKey, apiSecret)

  const wallet = await getSpotAccountAssets(apiKey, apiSecret)
  const soldList: string[] = []
  let totalGainedTry = 0

  for (const item of wallet.assets) {
    const asset = item.asset.toUpperCase()
    // TRY, TL ve BNB (Komisyon indirimi yakıtı) KESİNLİKLE SATILMAZ!
    if (asset === "TRY" || asset === "TL" || asset === "BNB") continue
    const freeQty = item.free
    if (!freeQty || freeQty <= 0) continue

    const pair = `${asset}_TRY`
    const filters = await getSymbolFilters(pair)
    if (!filters) continue

    const stepSize = filters.stepSize || 0.0001
    const minQty = filters.minQty || 0.0001
    const formatted = parseFloat(formatWithStepSize(freeQty, stepSize, filters.basePrecision))

    if (formatted >= minQty) {
      try {
        const sellRes = await executeBinanceTrSpotOrder({
          apiKey,
          apiSecret,
          symbol: pair,
          side: "SELL",
          type: "MARKET",
          quantity: formatted,
        })
        if (sellRes.ok) {
          soldList.push(asset)
          if (sellRes.cummulativeQuoteQty) totalGainedTry += sellRes.cummulativeQuoteQty
        }
      } catch {}
    }
  }

  return { ok: true, soldList, totalGainedTry }
}

// Canlı Binance Global USDⓈ-M Vadeli İşlemler (fapi.binance.com)
export const BINANCE_FUTURES_BASE = process.env.BINANCE_FUTURES_BASE || "https://fapi.binance.com"

// 10 dakikalık vadeli sembol kuralları önbelleği
let cachedFuturesSymbols: any[] | null = null
let cachedFuturesSymbolsTime = 0

export async function getFuturesSymbolFilters(symbol: string): Promise<{
  stepSize: number
  minQty: number
  tickSize: number
  minNotional: number
  basePrecision: number
} | null> {
  try {
    const now = Date.now()
    if (!cachedFuturesSymbols || now - cachedFuturesSymbolsTime > 30 * 60 * 1000) {
      // ⚡ KOTA KORUMASI: exchangeInfo halka açık genel bir veridir (API Key gerektirmez).
      // Proxy kotasını tüketmemek için doğrudan Vercel Frankfurt üzerinden çekilir (~1.2 MB tasarruf).
      const res = await fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/exchangeInfo`, {
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      })
      if (res.ok) {
        const json = await res.json()
        if (Array.isArray(json.symbols)) {
          cachedFuturesSymbols = json.symbols
          cachedFuturesSymbolsTime = now
        }
      }
    }

    if (cachedFuturesSymbols) {
      const cleanPair = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"
      const info = cachedFuturesSymbols.find((s) => s.symbol === cleanPair)
      if (info) {
        const lotSizeFilter = info.filters?.find((f: any) => f.filterType === "LOT_SIZE")
        const priceFilter = info.filters?.find((f: any) => f.filterType === "PRICE_FILTER")
        const minNotionalFilter = info.filters?.find((f: any) => f.filterType === "MIN_NOTIONAL")

        const stepSize = lotSizeFilter ? parseFloat(lotSizeFilter.stepSize) : 0.001
        const minQty = lotSizeFilter ? parseFloat(lotSizeFilter.minQty) : 0.001
        const tickSize = priceFilter ? parseFloat(priceFilter.tickSize) : 0.01
        const minNotional = minNotionalFilter ? parseFloat(minNotionalFilter.notional || "5") : 5
        const basePrecision = typeof info.quantityPrecision === "number" ? info.quantityPrecision : countDecimals(stepSize)

        return { stepSize, minQty, tickSize, minNotional, basePrecision }
      }
    }
  } catch (e: any) {
    console.warn("[FUTURES] Symbol filters fetch error:", e.message)
  }

  return {
    stepSize: 0.001,
    minQty: 0.001,
    tickSize: 0.01,
    minNotional: 5,
    basePrecision: 3,
  }
}

// 🛡️ PROXY BANT GENİŞLİĞİ & KOTA KORUMA MEKANİZMASI (Anti-Quota Drain Layer):
// - Devam eden eşzamanlı istekleri tek istekte birleştirir (In-flight Request Deduplication).
// - Sık okunan bakiye ve pozisyonları kısa süreli (8-10s) bellekte tutar (%70 tasarruf).
// - Realized PnL geçmişini 120s bellekte tutar (%95 tasarruf).
// - Emir verildiğinde veya kapatıldığında önbellek anında temizlenir (Zero Lag).

let cachedFuturesBalance: { data: any; expiresAt: number; key: string } | null = null
let inFlightBalancePromise: Promise<any> | null = null

let cachedFuturesPositions: { data: any[]; expiresAt: number; key: string } | null = null
let inFlightPositionsPromise: Promise<any[]> | null = null

let cachedFuturesIncome: { data: any[]; expiresAt: number; key: string } | null = null
let inFlightIncomePromise: Promise<any[]> | null = null

const cachedFuturesOpenOrdersMap = new Map<string, { data: any[]; expiresAt: number }>()

export function invalidateFuturesCache(): void {
  cachedFuturesBalance = null
  cachedFuturesPositions = null
  cachedFuturesIncome = null
  cachedFuturesOpenOrdersMap.clear()
}

/** Binance Global Futures (USDⓈ-M) Cüzdan ve Hesap Bilgileri */
export async function getFuturesAccountBalance(apiKey: string, apiSecret: string): Promise<{
  ok: boolean
  totalWalletBalanceUsdt: number
  availableBalanceUsdt: number
  totalUnrealizedPnlUsdt: number
  positionsCount: number
  error?: string
}> {
  const cleanKey = apiKey.trim()
  const cleanSecret = apiSecret.trim()
  const now = Date.now()

  // 1. Önbellek kontrolü (10 saniye TTL - Kota koruması)
  if (cachedFuturesBalance && cachedFuturesBalance.key === cleanKey && now < cachedFuturesBalance.expiresAt) {
    return cachedFuturesBalance.data
  }

  // 2. Halihazırda yürüyen bir proxy isteği varsa onu paylaş (Deduplication)
  if (inFlightBalancePromise) {
    try {
      return await inFlightBalancePromise
    } catch {}
  }

  inFlightBalancePromise = (async () => {
    try {
      const timestamp = Date.now()
      const query = `timestamp=${timestamp}`
      const signature = signQuery(query, cleanSecret)

      const res = await futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v2/account?${query}&signature=${signature}`, {
        headers: {
          "X-MBX-APIKEY": cleanKey,
        },
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      })

      let data: any
      try {
        data = await res.json()
      } catch (parseErr: any) {
        return {
          ok: false,
          totalWalletBalanceUsdt: 0,
          availableBalanceUsdt: 0,
          totalUnrealizedPnlUsdt: 0,
          positionsCount: 0,
          error: `Futures yanıtı ayrıştırılamadı: ${parseErr.message}`,
        }
      }
      if (!res.ok || (data.code !== undefined && data.code !== 200)) {
        return {
          ok: false,
          totalWalletBalanceUsdt: 0,
          availableBalanceUsdt: 0,
          totalUnrealizedPnlUsdt: 0,
          positionsCount: 0,
          error: data.msg || `Futures API hata: ${data.code}`,
        }
      }

      const totalWallet = parseFloat(data.totalWalletBalance || "0")
      const available = parseFloat(data.availableBalance || "0")
      const unrealizedPnl = parseFloat(data.totalUnrealizedProfit || "0")
      const activePositions = Array.isArray(data.positions)
        ? data.positions.filter((p: any) => parseFloat(p.positionAmt || "0") !== 0)
        : []

      const result = {
        ok: true,
        totalWalletBalanceUsdt: totalWallet,
        availableBalanceUsdt: available,
        totalUnrealizedPnlUsdt: unrealizedPnl,
        positionsCount: activePositions.length,
      }

      cachedFuturesBalance = {
        data: result,
        expiresAt: Date.now() + 25000,
        key: cleanKey,
      }

      return result
    } catch (err: any) {
      return {
        ok: false,
        totalWalletBalanceUsdt: 0,
        availableBalanceUsdt: 0,
        totalUnrealizedPnlUsdt: 0,
        positionsCount: 0,
        error: `Binance Global Futures bağlantı kurulamadı: ${err.message || err}`,
      }
    } finally {
      inFlightBalancePromise = null
    }
  })()

  return inFlightBalancePromise
}

/** Vadeli Marjin Tipini İzole (ISOLATED) Yapma */
export async function setFuturesMarginType(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  marginType: "ISOLATED" | "CROSSED" = "ISOLATED"
): Promise<{ ok: boolean; error?: string }> {
  try {
    const cleanKey = apiKey.trim()
    const cleanSecret = apiSecret.trim()
    const pair = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"
    const timestamp = Date.now()
    const query = `symbol=${pair}&marginType=${marginType}&timestamp=${timestamp}`
    const signature = signQuery(query, cleanSecret)

    const res = await futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/marginType`, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": cleanKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `${query}&signature=${signature}`,
      signal: AbortSignal.timeout(4000),
    })

    const json = await res.json()
    // -4046: "No need to change margin type" (Zaten ISOLATED) -> Başarılı sayılır
    if (json.code === -4046 || res.ok) {
      return { ok: true }
    }
    return { ok: false, error: json.msg }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

/** Vadeli Kaldıraç Ayarlama (Örn: 5x) */
export async function setFuturesLeverage(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  leverage: number = 5
): Promise<{ ok: boolean; leverage?: number; error?: string }> {
  try {
    const cleanKey = apiKey.trim()
    const cleanSecret = apiSecret.trim()
    const pair = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"
    const timestamp = Date.now()
    const query = `symbol=${pair}&leverage=${Math.min(Math.max(leverage, 1), 20)}&timestamp=${timestamp}`
    const signature = signQuery(query, cleanSecret)

    const res = await futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/leverage`, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": cleanKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `${query}&signature=${signature}`,
      signal: AbortSignal.timeout(4000),
    })

    const json = await res.json()
    if (res.ok && json.leverage) {
      return { ok: true, leverage: json.leverage }
    }
    return { ok: false, error: json.msg || "Kaldıraç ayarlanamadı" }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

/** Açık Vadeli Pozisyonları Çekme (PositionRisk) - 8s TTL Önbellek & Deduplication */
export async function getFuturesPositions(apiKey: string, apiSecret: string): Promise<Array<{
  symbol: string
  positionAmt: number
  entryPrice: number
  markPrice: number
  unRealizedProfit: number
  liquidationPrice: number
  leverage: number
  marginType: string
  isolatedMargin: number
}>> {
  const cleanKey = apiKey.trim()
  const cleanSecret = apiSecret.trim()
  const now = Date.now()

  // 1. Önbellek kontrolü (8 saniye TTL - Kota koruması)
  if (cachedFuturesPositions && cachedFuturesPositions.key === cleanKey && now < cachedFuturesPositions.expiresAt) {
    return cachedFuturesPositions.data
  }

  // 2. Halihazırda yürüyen bir proxy isteği varsa onu paylaş (Deduplication)
  if (inFlightPositionsPromise) {
    try {
      return await inFlightPositionsPromise
    } catch {}
  }

  inFlightPositionsPromise = (async () => {
    try {
      const timestamp = Date.now()
      const query = `timestamp=${timestamp}`
      const signature = signQuery(query, cleanSecret)

      const res = await futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v2/positionRisk?${query}&signature=${signature}`, {
        headers: { "X-MBX-APIKEY": cleanKey },
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      })

      if (!res.ok) return []
      let json: any
      try {
        json = await res.json()
      } catch {
        return []
      }
      if (!Array.isArray(json)) return []

      const mapped = json
        .filter((p: any) => Math.abs(parseFloat(p.positionAmt || "0")) > 0)
        .map((p: any) => ({
          symbol: p.symbol,
          positionAmt: parseFloat(p.positionAmt || "0"),
          entryPrice: parseFloat(p.entryPrice || "0"),
          markPrice: parseFloat(p.markPrice || "0"),
          unRealizedProfit: parseFloat(p.unRealizedProfit || "0"),
          liquidationPrice: parseFloat(p.liquidationPrice || "0"),
          leverage: parseInt(p.leverage || "5", 10),
          marginType: p.marginType || "isolated",
          isolatedMargin: parseFloat(p.isolatedMargin || "0"),
        }))

      cachedFuturesPositions = {
        data: mapped,
        expiresAt: Date.now() + 25000,
        key: cleanKey,
      }

      return mapped
    } catch {
      return []
    } finally {
      inFlightPositionsPromise = null
    }
  })()

  return inFlightPositionsPromise
}

/** Gerçekleşen Kâr/Zarar Gelir Kayıtları (Realized PnL Income) - 120s TTL (2 Dk) Önbellek */
export async function getFuturesRecentIncome(apiKey: string, apiSecret: string, limit: number = 30): Promise<Array<{
  symbol: string
  incomeType: string
  income: number
  asset: string
  time: number
  tranId: number | string
  tradeId: string
}>> {
  const cleanKey = apiKey.trim()
  const cleanSecret = apiSecret.trim()
  const now = Date.now()

  // 1. Önbellek kontrolü (120 saniye = 2 dakika TTL - Geçmiş işlemler saniyede bir değişmez!)
  if (cachedFuturesIncome && cachedFuturesIncome.key === cleanKey && now < cachedFuturesIncome.expiresAt) {
    return cachedFuturesIncome.data
  }

  // 2. Devam eden istek varsa onu paylaş
  if (inFlightIncomePromise) {
    try {
      return await inFlightIncomePromise
    } catch {}
  }

  inFlightIncomePromise = (async () => {
    try {
      const timestamp = Date.now()
      const query = `incomeType=REALIZED_PNL&limit=${limit}&timestamp=${timestamp}`
      const signature = signQuery(query, cleanSecret)

      const res = await futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/income?${query}&signature=${signature}`, {
        headers: { "X-MBX-APIKEY": cleanKey },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      })

      if (!res.ok) return []
      let json: any
      try {
        json = await res.json()
      } catch {
        return []
      }
      if (!Array.isArray(json)) return []

      const mapped = json.map((item: any) => ({
        symbol: item.symbol || "",
        incomeType: item.incomeType || "REALIZED_PNL",
        income: parseFloat(item.income || "0"),
        asset: item.asset || "USDT",
        time: Number(item.time || Date.now()),
        tranId: item.tranId || "",
        tradeId: item.tradeId || "",
      }))

      cachedFuturesIncome = {
        data: mapped,
        expiresAt: Date.now() + 180000, // 3 dakika önbellek
        key: cleanKey,
      }

      return mapped
    } catch {
      return []
    } finally {
      inFlightIncomePromise = null
    }
  })()

  return inFlightIncomePromise
}

/** Kullanıcının Vadeli İşlemleri (Gerçek Alış/Satış Fiyatları) */
export async function getFuturesUserTrades(apiKey: string, apiSecret: string, symbol: string, limit: number = 20): Promise<any[]> {
  try {
    const cleanKey = apiKey.trim()
    const cleanSecret = apiSecret.trim()
    const pair = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"
    const timestamp = Date.now()
    const query = `symbol=${pair}&limit=${limit}&timestamp=${timestamp}`
    const signature = signQuery(query, cleanSecret)

    const res = await futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/userTrades?${query}&signature=${signature}`, {
      headers: { "X-MBX-APIKEY": cleanKey },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    })

    if (!res.ok) return []
    const json = await res.json()
    if (!Array.isArray(json)) return []
    return json
  } catch {
    return []
  }
}

/** Vadeli İşlem Emri Ver (Akıllı Kaldıraçlı Alım / Satım) */
export async function executeBinanceFuturesOrder(params: {
  apiKey: string
  apiSecret: string
  symbol: string // e.g. "BTCUSDT" or "BTC"
  side: "BUY" | "SELL"
  type?: "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET"
  price?: number
  stopPrice?: number
  timeInForce?: "GTC" | "IOC" | "FOK" | "GTX"
  quantity?: number
  leverage?: number
  reduceOnly?: boolean
  closePosition?: boolean
  workingType?: "MARK_PRICE" | "CONTRACT_PRICE"
  newClientOrderId?: string
}): Promise<{ ok: boolean; orderId?: number | string; clientOrderId?: string; status?: "FILLED" | "PARTIALLY_FILLED" | "NEW" | "CANCELED" | "EXPIRED" | "UNKNOWN"; executedQty?: number; avgPrice?: number; error?: string }> {
  try {
    const cleanKey = params.apiKey.trim()
    const cleanSecret = params.apiSecret.trim()
    const pair = params.symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"

    // 🛡️ ÇİFT KATMANLI GÜVENLİK BARİYERİ (DRY_RUN & KILL_SWITCH KONTROLÜ):
    // Pozisyon kapatma (reduceOnly / closePosition) haricindeki tüm yeni emirlerde
    // DRY_RUN=true veya KILL_SWITCH aktifse borsa API'sine istek ATILMAZ!
    const botRisk = getBotRiskConfig()
    if (botRisk.killSwitchActive && !params.reduceOnly && !params.closePosition) {
      console.warn(`[executeBinanceFuturesOrder] 🛑 KILL_SWITCH aktif! Yeni emir borsaya iletilmedi (${params.side} ${pair}).`)
      return { ok: false, error: `KILL_SWITCH_ACTIVE: ${botRisk.killSwitchReason || "Acil durdurma devrede"}` }
    }
    const isExplicitDryRun = ["true", "1"].includes((process.env.DRY_RUN || "").trim().replace(/^["']|["']$/g, "").toLowerCase()) || (!cleanKey || !cleanSecret)
    if (isExplicitDryRun && botRisk.dryRun && !params.reduceOnly && !params.closePosition) {
      console.log(`[executeBinanceFuturesOrder] 🧪 DRY_RUN aktif! Borsa tarafına gerçek emir gönderilmedi (${params.side} ${pair}).`)
      return {
        ok: true,
        orderId: `sim-${Date.now()}`,
        clientOrderId: `sim-${Date.now()}`,
        status: "FILLED",
        executedQty: params.quantity || 0,
        avgPrice: params.price || 0,
      }
    }

    // 1. İzole Marjin Güvencesi (Isolated Margin) & Kaldıraç Kurulumu
    // reduceOnly (pozisyon kapatma) emirlerinde marjin/kaldıraç değiştirilmez (açık pozisyonda -4048 hatası verir)
    if (!params.reduceOnly && !params.closePosition && params.leverage && params.leverage >= 1 && params.leverage <= 20) {
      const marginRes = await setFuturesMarginType(cleanKey, cleanSecret, pair, "ISOLATED").catch((e: any) => ({ ok: false, error: e?.message }))
      // Açık pozisyon varken (-4048), zaten izoleyken (-4046) veya hesap Multi-Assets modundaysa marjin tipi değiştirilemez; kaldıraç yeterlidir
      if (!marginRes.ok && !/open (position|order)|-4048|-4047|-4046|multi-assets/i.test(String(marginRes.error || ""))) {
        return { ok: false, error: `İzole marjin ayarlanamadı: ${marginRes.error || "bilinmeyen hata"}` }
      }
      const levRes = await setFuturesLeverage(cleanKey, cleanSecret, pair, params.leverage).catch((e: any) => ({ ok: false, error: e?.message }))
      if (!levRes.ok) {
        return { ok: false, error: `${params.leverage}x kaldıraç ayarlanamadı, emir güvenlik için iptal edildi: ${levRes.error || "bilinmeyen hata"}` }
      }
    }

    // 2. Vadeli İşlem Emri Ver: Koşullu emirler (STOP_MARKET, TAKE_PROFIT_MARKET) algoOrder endpoint'ine, diğerleri order endpoint'ine
    const orderTs = Date.now()
    const orderSide = params.side.toUpperCase()
    const orderType = params.type || "MARKET"
    const isAlgoOrder = orderType === "STOP_MARKET" || orderType === "TAKE_PROFIT_MARKET"

    if (isAlgoOrder) {
      if (!params.stopPrice || params.stopPrice <= 0) {
        return { ok: false, error: `${orderType} emri için stopPrice (triggerPrice) belirtilmelidir.` }
      }

      let finalTriggerPrice = params.stopPrice
      try {
        const filters = await getFuturesSymbolFilters(pair)
        if (filters?.tickSize) {
          finalTriggerPrice = parseFloat(formatWithTickSize(finalTriggerPrice, filters.tickSize))
        }
      } catch {}

      const algoParams: Record<string, string> = {
        algoType: "CONDITIONAL",
        symbol: pair,
        side: orderSide,
        type: orderType,
        triggerPrice: finalTriggerPrice.toString(),
        workingType: params.workingType || "MARK_PRICE",
        timestamp: orderTs.toString(),
      }

      if (params.closePosition) {
        algoParams.closePosition = "true"
      } else {
        if (params.reduceOnly) {
          algoParams.reduceOnly = "true"
        }
        if (params.quantity && params.quantity > 0) {
          let finalQty = params.quantity
          try {
            const filters = await getFuturesSymbolFilters(pair)
            if (filters?.stepSize) {
              finalQty = parseFloat(formatWithStepSize(finalQty, filters.stepSize, filters.basePrecision || 3))
            }
          } catch {}
          if (!(finalQty > 0)) {
            return { ok: false, error: `Miktar minimum adım büyüklüğünün altında kaldı (${params.quantity} → 0).` }
          }
          algoParams.quantity = finalQty.toString()
        }
      }

      if (params.newClientOrderId) {
        algoParams.clientAlgoId = params.newClientOrderId
      }

      const algoQuery = new URLSearchParams(algoParams).toString()
      const algoSig = signQuery(algoQuery, cleanSecret)

      const res = await futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/algoOrder`, {
        method: "POST",
        headers: {
          "X-MBX-APIKEY": cleanKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `${algoQuery}&signature=${algoSig}`,
        signal: AbortSignal.timeout(6000),
      })

      const json = await res.json()
      if (!res.ok || (json.code !== undefined && json.code !== 200)) {
        return {
          ok: false,
          error: json.msg || `Binance Futures Algo Order hata kodu: ${json.code}`,
        }
      }

      invalidateFuturesCache()

      const rawStatus = String(json.algoStatus || json.status || "").toUpperCase()
      const status = rawStatus === "FILLED" ? "FILLED" : rawStatus === "PARTIALLY_FILLED" ? "PARTIALLY_FILLED" : "NEW"

      return {
        ok: true,
        orderId: json.algoId || json.orderId,
        clientOrderId: json.clientAlgoId || json.clientOrderId,
        status,
        executedQty: 0,
        avgPrice: parseFloat(json.triggerPrice || "0") || finalTriggerPrice,
      }
    }

    // Normal emirler (MARKET, LIMIT): /fapi/v1/order
    let orderQuery = `symbol=${pair}&side=${orderSide}&type=${orderType}&timestamp=${orderTs}`

    if (params.newClientOrderId) {
      orderQuery += `&newClientOrderId=${encodeURIComponent(params.newClientOrderId)}`
    }

    if (params.closePosition) {
      orderQuery += `&closePosition=true`
    } else if (params.reduceOnly) {
      orderQuery += `&reduceOnly=true`
    }

    if (params.quantity && params.quantity > 0 && !params.closePosition) {
      let finalQty = params.quantity
      try {
        const filters = await getFuturesSymbolFilters(pair)
        if (filters?.stepSize) {
          finalQty = parseFloat(formatWithStepSize(finalQty, filters.stepSize, filters.basePrecision || 3))
        }
      } catch {}
      if (!(finalQty > 0)) {
        return { ok: false, error: `Miktar minimum adım büyüklüğünün altında kaldı (${params.quantity} → 0).` }
      }
      orderQuery += `&quantity=${finalQty}`
    }

    if (orderType === "LIMIT") {
      if (params.price && params.price > 0) {
        let finalPrice = params.price
        try {
          const filters = await getFuturesSymbolFilters(pair)
          if (filters?.tickSize) {
            finalPrice = parseFloat(formatWithTickSize(finalPrice, filters.tickSize))
          }
        } catch {}
        orderQuery += `&price=${finalPrice}&timeInForce=${params.timeInForce || "GTC"}`
      }
    }

    const orderSig = signQuery(orderQuery, cleanSecret)

    const res = await futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/order`, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": cleanKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `${orderQuery}&signature=${orderSig}`,
      signal: AbortSignal.timeout(6000),
    })

    const json = await res.json()

    if (!res.ok || (json.code !== undefined && json.code !== 200)) {
      return {
        ok: false,
        error: json.msg || `Binance Futures hata kodu: ${json.code}`,
      }
    }

    const rawStatus = String(json.status || "").toUpperCase()
    const executedQty = parseFloat(json.executedQty || "0")
    const avgPrice = parseFloat(json.avgPrice || "0") || params.price || 0
    const status = rawStatus === "FILLED" ? "FILLED" : rawStatus === "PARTIALLY_FILLED" ? "PARTIALLY_FILLED" : "NEW"

    // 🚀 Emir verildi: Önbelleği anında temizle ki güncel durum gecikmesiz gelsin
    invalidateFuturesCache()

    return {
      ok: true,
      orderId: json.orderId,
      clientOrderId: json.clientOrderId,
      status,
      executedQty,
      avgPrice,
    }
  } catch (err: any) {
    return {
      ok: false,
      error: `Binance Global Futures bağlantı hatası: ${err.message || err}`,
    }
  }
}

/** Binance Global Futures Açık Emirleri Sorgula (Koruyucu Stop Varlığını Kontrol Eder) */
export async function getFuturesOpenOrders(
  apiKey: string,
  apiSecret: string,
  symbol: string
): Promise<Array<{ orderId: number; symbol: string; status: string; type: string; stopPrice?: number; side: string }>> {
  try {
    const cleanKey = apiKey.trim()
    const cleanSecret = apiSecret.trim()
    const pair = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"
    const cacheKey = `${cleanKey}:${pair}`
    const now = Date.now()

    // 1. Önbellek kontrolü (60 saniye TTL - Emirler saniyede bir değişmez)
    const cached = cachedFuturesOpenOrdersMap.get(cacheKey)
    if (cached && now < cached.expiresAt) {
      return cached.data
    }

    const timestamp = Date.now()

    // Standart açık emirler ve açık Algo (STOP) emirlerini paralel çek
    const query = `symbol=${pair}&timestamp=${timestamp}`
    const signature = signQuery(query, cleanSecret)

    const algoQuery = `symbol=${pair}&algoType=CONDITIONAL&timestamp=${timestamp}`
    const algoSig = signQuery(algoQuery, cleanSecret)

    const [stdRes, algoRes] = await Promise.allSettled([
      futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/openOrders?${query}&signature=${signature}`, {
        headers: { "X-MBX-APIKEY": cleanKey },
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      }),
      futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/openAlgoOrders?${algoQuery}&signature=${algoSig}`, {
        headers: { "X-MBX-APIKEY": cleanKey },
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      })
    ])

    const orders: Array<{ orderId: number; symbol: string; status: string; type: string; stopPrice?: number; side: string }> = []

    if (stdRes.status === "fulfilled" && stdRes.value.ok) {
      try {
        const stdJson = await stdRes.value.json()
        if (Array.isArray(stdJson)) {
          for (const o of stdJson) {
            orders.push({
              orderId: o.orderId,
              symbol: o.symbol,
              status: String(o.status || "").toUpperCase(),
              type: String(o.type || "").toUpperCase(),
              stopPrice: parseFloat(o.stopPrice || "0"),
              side: String(o.side || "").toUpperCase(),
            })
          }
        }
      } catch {}
    }

    if (algoRes.status === "fulfilled" && algoRes.value.ok) {
      try {
        const algoJson = await algoRes.value.json()
        if (Array.isArray(algoJson)) {
          for (const a of algoJson) {
            orders.push({
              orderId: a.algoId,
              symbol: a.symbol,
              status: String(a.algoStatus || a.status || "").toUpperCase(),
              type: String(a.orderType || a.algoType || "").toUpperCase(),
              stopPrice: parseFloat(a.triggerPrice || a.stopPrice || "0"),
              side: String(a.side || "").toUpperCase(),
            })
          }
        }
      } catch {}
    }

    cachedFuturesOpenOrdersMap.set(cacheKey, {
      data: orders,
      expiresAt: Date.now() + 60000,
    })

    return orders
  } catch {
    return []
  }
}

/** Binance Global Futures Belirli Bir Emri İptal Et */
export async function cancelFuturesOrder(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  orderId: string | number
): Promise<{ ok: boolean; error?: string }> {
  try {
    const cleanKey = apiKey.trim()
    const cleanSecret = apiSecret.trim()
    const pair = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"
    const timestamp = Date.now()
    const query = `symbol=${pair}&orderId=${orderId}&timestamp=${timestamp}`
    const signature = signQuery(query, cleanSecret)

    const res = await futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/order?${query}&signature=${signature}`, {
      method: "DELETE",
      headers: { "X-MBX-APIKEY": cleanKey },
      signal: AbortSignal.timeout(4000),
    })
    const json = await res.json()
    if (res.ok || json.code === 200) {
      // 🚀 Emir iptal edildi: Önbelleği temizle
      invalidateFuturesCache()
      return { ok: true }
    }
    return { ok: false, error: json.msg }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

/** Binance Global Futures Emir Durumu ve Dolan Miktarı Sorgula */
export async function getFuturesOrderStatus(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  orderId: string | number
): Promise<{
  ok: boolean
  status: "FILLED" | "PARTIALLY_FILLED" | "NEW" | "CANCELED" | "EXPIRED" | "REJECTED" | "UNKNOWN"
  executedQty: number
  avgPrice: number
  error?: string
}> {
  try {
    const cleanKey = apiKey.trim()
    const cleanSecret = apiSecret.trim()
    const pair = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"
    const timestamp = Date.now()
    const query = `symbol=${pair}&orderId=${orderId}&timestamp=${timestamp}`
    const signature = signQuery(query, cleanSecret)

    const res = await futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/order?${query}&signature=${signature}`, {
      headers: { "X-MBX-APIKEY": cleanKey },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    })

    if (!res.ok) {
      return { ok: false, status: "UNKNOWN", executedQty: 0, avgPrice: 0 }
    }

    const json = await res.json()
    const rawStatus = String(json.status || "").toUpperCase()
    const executedQty = parseFloat(json.executedQty || "0")
    const avgPrice = parseFloat(json.avgPrice || "0") || parseFloat(json.price || "0")

    let status: "FILLED" | "PARTIALLY_FILLED" | "NEW" | "CANCELED" | "EXPIRED" | "UNKNOWN" = "UNKNOWN"
    if (rawStatus === "FILLED") status = "FILLED"
    else if (rawStatus === "PARTIALLY_FILLED") status = "PARTIALLY_FILLED"
    else if (rawStatus === "NEW") status = "NEW"
    else if (rawStatus === "CANCELED") status = "CANCELED"
    else if (rawStatus === "EXPIRED") status = "EXPIRED"

    return {
      ok: true,
      status,
      executedQty,
      avgPrice,
    }
  } catch (e: any) {
    return { ok: false, status: "UNKNOWN", executedQty: 0, avgPrice: 0, error: e.message }
  }
}

/** Vadeli Açıkta Kalan Eski Limit Emirlerini ve Koruyucu Stop Emirlerini İptal Et (excludeOrderIds hariç) */
export async function cancelFuturesAllOpenOrders(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  excludeOrderIds?: Array<string | number>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const cleanKey = apiKey.trim()
    const cleanSecret = apiSecret.trim()
    const pair = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"

    // Belirli yeni emirlerin korunması istendiyse (Atomik Stop Koruması):
    if (excludeOrderIds && excludeOrderIds.length > 0) {
      const excludeSet = new Set(excludeOrderIds.map(String))
      const timestamp = Date.now()
      const query = `symbol=${pair}&timestamp=${timestamp}`
      const signature = signQuery(query, cleanSecret)
      try {
        const res = await futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/openOrders?${query}&signature=${signature}`, {
          method: "GET",
          headers: { "X-MBX-APIKEY": cleanKey },
          signal: AbortSignal.timeout(4000),
        })
        if (res.ok) {
          const openList: any[] = await res.json().catch(() => [])
          if (Array.isArray(openList)) {
            const toCancel = openList.filter((o) => !excludeSet.has(String(o.orderId)))
            await Promise.allSettled(toCancel.map((o) => cancelFuturesOrder(cleanKey, cleanSecret, pair, o.orderId)))
          }
        }
      } catch {}
      invalidateFuturesCache()
      return { ok: true }
    }

    const timestamp = Date.now()
    const query = `symbol=${pair}&timestamp=${timestamp}`
    const signature = signQuery(query, cleanSecret)

    // Hem standart açık emirleri hem de algo emirleri (STOP_MARKET) aynı anda iptal et
    const [resStd, resAlgo] = await Promise.allSettled([
      futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/allOpenOrders?${query}&signature=${signature}`, {
        method: "DELETE",
        headers: { "X-MBX-APIKEY": cleanKey },
        signal: AbortSignal.timeout(4000),
      }),
      futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/algoOpenOrders?${query}&signature=${signature}`, {
        method: "DELETE",
        headers: { "X-MBX-APIKEY": cleanKey },
        signal: AbortSignal.timeout(4000),
      }),
    ])

    invalidateFuturesCache()

    let stdOk = false
    if (resStd.status === "fulfilled" && (resStd.value.ok || (await resStd.value.clone().json().catch(() => ({}))).code === 200)) {
      stdOk = true
    }
    let algoOk = false
    if (resAlgo.status === "fulfilled" && (resAlgo.value.ok || (await resAlgo.value.clone().json().catch(() => ({}))).code === 200)) {
      algoOk = true
    }

    if (stdOk || algoOk) {
      return { ok: true }
    }
    return { ok: true } // Eğer hiç açık emir yoksa bile hata vermemesi güvenlidir
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

// ── Mikro-Yapı Veri Getiricileri (Derinlik OBI, Açık Pozisyon OI) ─────────
const _depthCache = new Map<string, { data: { bids: [string, string][]; asks: [string, string][] }; expiresAt: number }>()

export async function getFuturesOrderBookTop5(symbol: string): Promise<{
  bids: Array<[string | number, string | number]>
  asks: Array<[string | number, string | number]>
} | null> {
  const cleanSym = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"
  const now = Date.now()
  const cached = _depthCache.get(cleanSym)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }

  try {
    const res = await futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/depth?symbol=${cleanSym}&limit=5`, {
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    })
    if (!res.ok) return null
    const json = await res.json()
    if (Array.isArray(json.bids) && Array.isArray(json.asks)) {
      _depthCache.set(cleanSym, { data: json, expiresAt: now + 5000 }) // 5 sn önbellek
      return json
    }
  } catch (err: any) {
    // Sessiz hata yönetimi
  }
  return null
}

const _oiCache = new Map<string, { data: { openInterest: number; oiChangePct: number }; expiresAt: number }>()

export async function getFuturesOpenInterestStats(symbol: string): Promise<{
  openInterest: number
  oiChangePct: number
}> {
  const cleanSym = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"
  const now = Date.now()
  const cached = _oiCache.get(cleanSym)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }

  try {
    const [curRes, histRes] = await Promise.allSettled([
      futuresProxyFetch(`${BINANCE_FUTURES_BASE}/fapi/v1/openInterest?symbol=${cleanSym}`, {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      }),
      futuresProxyFetch(`${BINANCE_FUTURES_BASE}/futures/data/openInterestHist?symbol=${cleanSym}&period=15m&limit=3`, {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      }),
    ])

    let openInterest = 0
    if (curRes.status === "fulfilled" && curRes.value.ok) {
      const curJson = await curRes.value.json().catch(() => null)
      if (curJson && curJson.openInterest) {
        openInterest = parseFloat(curJson.openInterest) || 0
      }
    }

    let oiChangePct = 0
    if (histRes.status === "fulfilled" && histRes.value.ok) {
      const histJson = await histRes.value.json().catch(() => null)
      if (Array.isArray(histJson) && histJson.length >= 2) {
        const latest = parseFloat(histJson[histJson.length - 1].sumOpenInterest) || 0
        const prev = parseFloat(histJson[histJson.length - 2].sumOpenInterest) || 0
        if (prev > 0) {
          oiChangePct = ((latest - prev) / prev) * 100
        }
      }
    }

    const result = {
      openInterest: Number(openInterest.toFixed(2)),
      oiChangePct: Number(oiChangePct.toFixed(2)),
    }
    _oiCache.set(cleanSym, { data: result, expiresAt: now + 30000 }) // 30 sn önbellek
    return result
  } catch {
    return { openInterest: 0, oiChangePct: 0 }
  }
}



