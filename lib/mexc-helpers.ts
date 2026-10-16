import crypto from "node:crypto"

export const MEXC_FUTURES_BASE = "https://contract.mexc.com"

/**
 * MEXC Futures API HMAC-SHA256 İmza Üretici
 * MEXC Vadeli Kuralları:
 * Header:
 *   ApiKey: <apiKey>
 *   Request-Time: <timestamp>
 *   Signature: hex(HMAC_SHA256(apiKey + reqTime + [queryString or body], apiSecret))
 */
export function signMexcFutures(apiKey: string, apiSecret: string, reqTime: string | number, payload: string = ""): string {
  const signString = `${apiKey}${reqTime}${payload}`
  return crypto.createHmac("sha256", apiSecret).update(signString).digest("hex")
}

/** MEXC Vadeli (USDT-M Futures) Bakiye & Hesap Sorgusu */
export async function getMexcAccountBalance(apiKey: string, apiSecret: string): Promise<{
  ok: boolean
  availableBalanceUsdt: number
  totalWalletBalanceUsdt: number
  totalUnrealizedPnlUsdt: number
  openPositionsCount: number
  error?: string
}> {
  try {
    const cleanKey = apiKey.trim()
    const cleanSecret = apiSecret.trim()
    const reqTime = Date.now().toString()
    const signature = signMexcFutures(cleanKey, cleanSecret, reqTime, "")

    const res = await fetch(`${MEXC_FUTURES_BASE}/api/v1/private/account/assets`, {
      method: "GET",
      headers: {
        ApiKey: cleanKey,
        "Request-Time": reqTime,
        Signature: signature,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    })

    const json = await res.json()
    if (!res.ok || !json.success || !json.data) {
      return {
        ok: false,
        availableBalanceUsdt: 0,
        totalWalletBalanceUsdt: 0,
        totalUnrealizedPnlUsdt: 0,
        openPositionsCount: 0,
        error: json.message || `MEXC API hatası (${json.code})`,
      }
    }

    // USDT varlığını bul
    const usdtAsset = Array.isArray(json.data)
      ? json.data.find((a: any) => a.currency?.toUpperCase() === "USDT")
      : json.data

    const available = parseFloat(usdtAsset?.availableBalance || usdtAsset?.cashBalance || "0")
    const totalWallet = parseFloat(usdtAsset?.equity || usdtAsset?.positionMargin || available)
    const unrealized = parseFloat(usdtAsset?.unrealized || "0")

    return {
      ok: true,
      availableBalanceUsdt: available,
      totalWalletBalanceUsdt: totalWallet,
      totalUnrealizedPnlUsdt: unrealized,
      openPositionsCount: 0,
    }
  } catch (err: any) {
    return {
      ok: false,
      availableBalanceUsdt: 0,
      totalWalletBalanceUsdt: 0,
      totalUnrealizedPnlUsdt: 0,
      openPositionsCount: 0,
      error: `MEXC bağlantı hatası: ${err.message || err}`,
    }
  }
}

/** MEXC Açık Vadeli Pozisyonları Çekme */
export async function getMexcOpenPositions(apiKey: string, apiSecret: string): Promise<Array<{
  symbol: string
  positionAmt: number
  holdVol: number
  entryPrice: number
  markPrice: number
  unrealizedProfit: number
  leverage: number
  marginType: "ISOLATED" | "CROSSED"
  positionType: 1 | 2 // 1: Long, 2: Short
}>> {
  try {
    const cleanKey = apiKey.trim()
    const cleanSecret = apiSecret.trim()
    const reqTime = Date.now().toString()
    const signature = signMexcFutures(cleanKey, cleanSecret, reqTime, "")

    const res = await fetch(`${MEXC_FUTURES_BASE}/api/v1/private/position/open_positions`, {
      method: "GET",
      headers: {
        ApiKey: cleanKey,
        "Request-Time": reqTime,
        Signature: signature,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    })

    const json = await res.json()
    if (!json.success || !Array.isArray(json.data)) return []

    return json.data
      .filter((p: any) => (parseFloat(p.holdVol || "0") > 0 || Math.abs(parseFloat(p.positionAmt || "0")) > 0))
      .map((p: any) => ({
        symbol: p.symbol,
        positionAmt: parseFloat(p.positionAmt || p.holdVol || "0"),
        holdVol: parseFloat(p.holdVol || "0"),
        entryPrice: parseFloat(p.holdAvgPrice || p.openPrice || "0"),
        markPrice: parseFloat(p.fairPrice || p.markPrice || "0"),
        unrealizedProfit: parseFloat(p.realised || p.unrealised || "0"),
        leverage: parseInt(p.leverage || "5", 10),
        marginType: p.openType === 1 ? "ISOLATED" : "CROSSED",
        positionType: p.positionType || 1,
      }))
  } catch {
    return []
  }
}

/** MEXC Kaldıraç ve İzole Marjin Ayarlama */
export async function setMexcLeverageAndMargin(params: {
  apiKey: string
  apiSecret: string
  symbol: string // örn. "SOL_USDT"
  leverage: number
  marginType?: "ISOLATED" | "CROSSED"
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const cleanKey = params.apiKey.trim()
    const cleanSecret = params.apiSecret.trim()
    const sym = params.symbol.replace("/", "_").toUpperCase()
    const reqTime = Date.now().toString()

    const bodyObj = {
      symbol: sym,
      leverage: Math.min(Math.max(params.leverage, 1), 20),
      openType: params.marginType === "CROSSED" ? 2 : 1, // 1: Isolated, 2: Crossed
    }
    const bodyStr = JSON.stringify(bodyObj)
    const signature = signMexcFutures(cleanKey, cleanSecret, reqTime, bodyStr)

    const res = await fetch(`${MEXC_FUTURES_BASE}/api/v1/private/position/change_leverage`, {
      method: "POST",
      headers: {
        ApiKey: cleanKey,
        "Request-Time": reqTime,
        Signature: signature,
        "Content-Type": "application/json",
      },
      body: bodyStr,
      signal: AbortSignal.timeout(4000),
    })

    const json = await res.json()
    if (json.success || json.code === 200) {
      return { ok: true }
    }
    return { ok: false, error: json.message }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

/** MEXC Vadeli Alım/Satım Emri Ver (Akıllı Kaldıraç) */
export async function executeMexcFuturesOrder(params: {
  apiKey: string
  apiSecret: string
  symbol: string // örn. "SOL_USDT"
  side: "BUY" | "SELL"
  quantity: number // vol
  price?: number
  type?: "MARKET" | "LIMIT"
  leverage?: number
  reduceOnly?: boolean
}): Promise<{ ok: boolean; orderId?: string; error?: string }> {
  try {
    const cleanKey = params.apiKey.trim()
    const cleanSecret = params.apiSecret.trim()
    const sym = params.symbol.replace("/", "_").toUpperCase()

    // 1. Önce İzole Marjin & Kaldıraç ayarla
    if (params.leverage) {
      await setMexcLeverageAndMargin({
        apiKey: cleanKey,
        apiSecret: cleanSecret,
        symbol: sym,
        leverage: params.leverage,
        marginType: "ISOLATED",
      }).catch(() => {})
    }

    // 2. Emir Parametreleri
    // side: 1: Open Long, 2: Close Short, 3: Open Short, 4: Close Long
    // reduceOnly ise: side BUY ise 2 (Close Short), SELL ise 4 (Close Long)
    let mexcSide = 1
    if (params.reduceOnly) {
      mexcSide = params.side === "SELL" ? 4 : 2
    } else {
      mexcSide = params.side === "BUY" ? 1 : 3
    }

    const reqTime = Date.now().toString()
    const orderPayload = {
      symbol: sym,
      price: params.price || 0,
      vol: Math.max(Math.floor(params.quantity), 1),
      leverage: params.leverage || 5,
      side: mexcSide,
      type: params.type === "LIMIT" && params.price ? 1 : 5, // 1: Limit, 5: Market
      openType: 1, // 1: Isolated (İzole Marjin Güvencesi)
    }

    const payloadStr = JSON.stringify(orderPayload)
    const signature = signMexcFutures(cleanKey, cleanSecret, reqTime, payloadStr)

    const res = await fetch(`${MEXC_FUTURES_BASE}/api/v1/private/order/submit`, {
      method: "POST",
      headers: {
        ApiKey: cleanKey,
        "Request-Time": reqTime,
        Signature: signature,
        "Content-Type": "application/json",
      },
      body: payloadStr,
      signal: AbortSignal.timeout(6000),
    })

    const json = await res.json()
    if (json.success && json.data) {
      return { ok: true, orderId: String(json.data) }
    }

    return { ok: false, error: json.message || `MEXC Hata Kodu: ${json.code}` }
  } catch (e: any) {
    return { ok: false, error: `MEXC emir hatası: ${e.message || e}` }
  }
}
