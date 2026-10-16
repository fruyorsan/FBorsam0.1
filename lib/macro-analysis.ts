/**
 * lib/macro-analysis.ts
 * ═══════════════════════════════════════════════════════
 * 1 Haftalık (7 Gün) ve 1 Aylık (30 Gün) Makro Trend Analizi.
 * Binance 30 günlük günlük mumlarını (1d) çekerek uzun vadeli
 * trend yönünü, aylık tepe/dip aralığını ve haftalık SMA7'yi hesaplar.
 * 10 dakikalık in-memory önbellek ile sıfır gecikme sağlar.
 * ═══════════════════════════════════════════════════════
 */

export interface MacroTrendData {
  change1w: number         // 1 Haftalık Değişim (%)
  change1m: number         // 1 Aylık Değişim (%)
  high30d: number          // 30 Günlük Zirve (₺)
  low30d: number           // 30 Günlük Dip (₺)
  monthlyRangePos: number  // 0 - 100% (0: Aylık Dipte, 100: Aylık Zirvede)
  isAboveSma7: boolean     // Fiyat 7 günlük haftalık ortalama üzerinde mi?
  macroVerdict: "BULLISH" | "BEARISH" | "DIP_BASE" | "NEUTRAL"
  summaryText: string
}

interface CacheEntry {
  data: MacroTrendData
  timestamp: number
}

const macroCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 dakika

export async function getMacroAnalysis(binancePair: string): Promise<MacroTrendData | null> {
  const now = Date.now()
  const cached = macroCache.get(binancePair)
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data
  }

  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${binancePair}&interval=1d&limit=35`,
      { signal: AbortSignal.timeout(4000) }
    )
    if (!res.ok) return cached?.data ?? null

    const klines = await res.json()
    if (!Array.isArray(klines) || klines.length < 7) {
      return cached?.data ?? null
    }

    const closes = klines.map((k) => Number(k[4]))
    const highs = klines.map((k) => Number(k[2]))
    const lows = klines.map((k) => Number(k[3]))

    const currentPrice = closes[closes.length - 1]
    const price1wAgo = closes[Math.max(0, closes.length - 8)]
    const price1mAgo = closes[0]

    const change1w = price1wAgo > 0 ? ((currentPrice - price1wAgo) / price1wAgo) * 100 : 0
    const change1m = price1mAgo > 0 ? ((currentPrice - price1mAgo) / price1mAgo) * 100 : 0

    const high30d = Math.max(...highs)
    const low30d = Math.min(...lows)
    const range = high30d - low30d
    const monthlyRangePos = range > 0 ? Math.round(((currentPrice - low30d) / range) * 100) : 50

    // Son 7 günün ortalaması (Haftalık SMA7)
    const last7Closes = closes.slice(-7)
    const sma7 = last7Closes.reduce((a, b) => a + b, 0) / last7Closes.length
    const isAboveSma7 = currentPrice >= sma7

    // Makro Karar
    let macroVerdict: MacroTrendData["macroVerdict"] = "NEUTRAL"
    let summaryText = "Yatay Bant"

    if (monthlyRangePos <= 35 && change1w >= -3) {
      macroVerdict = "DIP_BASE"
      summaryText = "Aylık Dip Tabanı (Toplama Bölgesi)"
    } else if (change1w > 0 && isAboveSma7 && monthlyRangePos <= 85) {
      macroVerdict = "BULLISH"
      summaryText = "Haftalık & Aylık Yükseliş Trendi"
    } else if (change1w < -6 && !isAboveSma7) {
      macroVerdict = "BEARISH"
      summaryText = "Düşüş Baskısı Altında"
    }

    const data: MacroTrendData = {
      change1w: Number(change1w.toFixed(2)),
      change1m: Number(change1m.toFixed(2)),
      high30d,
      low30d,
      monthlyRangePos,
      isAboveSma7,
      macroVerdict,
      summaryText,
    }

    macroCache.set(binancePair, { data, timestamp: now })
    return data
  } catch (err) {
    return cached?.data ?? null
  }
}

/**
 * İzlenen tüm kriptolar için 1w ve 1m verilerini paralel toplar
 */
export async function getBulkMacroAnalysis(
  pairs: string[]
): Promise<Map<string, MacroTrendData>> {
  const result = new Map<string, MacroTrendData>()
  await Promise.allSettled(
    pairs.map(async (pair) => {
      const data = await getMacroAnalysis(pair)
      if (data) result.set(pair, data)
    })
  )
  return result
}
