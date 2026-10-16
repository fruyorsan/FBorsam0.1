/**
 * lib/multi-timeframe.ts
 * ═══════════════════════════════════════════════════════
 * Coklu Zaman Dilimi (Multi-Timeframe: 1m + 5m + 1h + 1w + 1M)
 * ve Yapay Zeka (AI) Karar Sentez Motoru.
 * 
 * Her bir kripto para icin 5 farkli zaman ufku eszamanli taranir:
 * - 1m: Mikro Giris / Cikis & Anlik Hacim Tetikleyicisi
 * - 5m: Kisa Vadeli Osilatorler (RSI, MACD, Stoch, Bollinger)
 * - 1h: Ara Trend Yonu (EMA20 vs EMA50, Super Trend)
 * - 1w (1 Hafta): Haftalik Ivme & SMA7 Destegi
 * - 1M (1 Ay): Aylik Dip Tabani / Tepe Direnc Konumu
 * 
 * Terminal Quant-AI Sentezi:
 * 5 zaman diliminin sinyalleri tek bir 0-100 Guven Skoruna ve
 * net karara (GUCLU AL / AL / TUT / SAT) donusturulur.
 * ═══════════════════════════════════════════════════════
 */

import { analyzeCandles, type Candle } from "./indicators"

export interface TimeframeSignal {
  interval: "1m" | "5m" | "15m" | "1h" | "1w" | "1M"
  trend: "BULLISH" | "BEARISH" | "NEUTRAL"
  score: number // -100 to +100
  rsi?: number
  macd?: number
  macdSignal?: number
  changePct: number
  summary: string
}

export interface MultiTimeframeAnalysis {
  symbol: string
  name: string
  binancePair: string
  currentPrice: number
  tf1m: TimeframeSignal
  tf5m: TimeframeSignal
  tf15m?: TimeframeSignal
  tf1h: TimeframeSignal
  tf1w: TimeframeSignal
  tf1mMonth: TimeframeSignal
  overallScore: number // 0 to 100
  aiVerdict: "GÜÇLÜ AL" | "AL" | "TUT" | "SAT" | "GÜÇLÜ SAT"
  aiConfidence: number // 0 to 100
  aiReason: string
  takeProfitPrice: number
  stopLossPrice: number
  breakevenPrice: number
  volumeRatio24h: number
  quoteVolume24h: number
  high24h: number
  low24h: number
}

// 45 saniyelik optimize in-memory onbellek (makro analizler gereksiz tekrarlanmaz)
const mtfCache = new Map<string, { data: MultiTimeframeAnalysis; timestamp: number }>()
const CACHE_TTL = 45 * 1000

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      { signal: AbortSignal.timeout(3500) }
    )
    if (!res.ok) return []
    const json = await res.json()
    if (!Array.isArray(json)) return []

    return json
      .map((k) => {
        const close = Number(k[4])
        if (!Number.isFinite(close) || close <= 0) return null
        return {
          date: new Date(k[0]).toISOString(),
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close,
          volume: Number(k[5]),
        }
      })
      .filter((c): c is Candle => c !== null)
  } catch {
    return []
  }
}

function analyze1m(candles: Candle[]): TimeframeSignal {
  if (candles.length < 5) {
    return { interval: "1m", trend: "NEUTRAL", score: 0, changePct: 0, summary: "Yetersiz Veri" }
  }
  const last = candles[candles.length - 1]
  const prev = candles[candles.length - 2] || candles[0]
  const changePct = prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0

  let score = 0
  let rsiVal: number | undefined

  try {
    const t = analyzeCandles(candles.slice(-20))
    rsiVal = t.values.rsi
    if (rsiVal !== undefined) {
      if (rsiVal >= 45 && rsiVal <= 65 && changePct >= 0) score += 40
      else if (rsiVal <= 30 && changePct > 0) score += 60
      else if (rsiVal >= 75) score -= 60
      else if (rsiVal < 35 && changePct < 0) score -= 40
    }
  } catch {}

  const trend: TimeframeSignal["trend"] = score >= 30 ? "BULLISH" : score <= -30 ? "BEARISH" : "NEUTRAL"
  const summary =
    trend === "BULLISH"
      ? `Mikro Pozitif (1m RSI: ${rsiVal?.toFixed(0) ?? "-"}, Deg: %${changePct.toFixed(2)})`
      : trend === "BEARISH"
      ? `Mikro Saticili (1m RSI: ${rsiVal?.toFixed(0) ?? "-"}, Deg: %${changePct.toFixed(2)})`
      : `Mikro Denge (Deg: %${changePct.toFixed(2)})`

  return { interval: "1m", trend, score, rsi: rsiVal, changePct, summary }
}

function analyze5m(candles: Candle[]): TimeframeSignal {
  if (candles.length < 15) {
    return { interval: "5m", trend: "NEUTRAL", score: 0, changePct: 0, summary: "Yetersiz Veri" }
  }
  const t = analyzeCandles(candles)
  const rsi = t.values.rsi ?? 50
  const macd = t.values.macd ?? 0
  const macdSignal = t.values.macdSignal ?? 0
  const last = candles[candles.length - 1]
  const prev = candles[candles.length - 2] || candles[0]
  const changePct = prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0

  let score = 0
  if (t.signal === "GÜÇLÜ AL") score += 50
  else if (t.signal === "AL") score += 30
  else if (t.signal === "GÜÇLÜ SAT") score -= 50
  else if (t.signal === "SAT") score -= 30

  if (macd > macdSignal) score += 20
  else score -= 20

  if (rsi >= 40 && rsi <= 58) score += 20
  else if (rsi <= 32) score += 30
  else if (rsi >= 70) score -= 40

  const trend: TimeframeSignal["trend"] = score >= 25 ? "BULLISH" : score <= -25 ? "BEARISH" : "NEUTRAL"
  const summary = `5m ${t.signal} (RSI: ${rsi.toFixed(0)}, MACD: ${macd > macdSignal ? "Pozitif" : "Negatif"})`

  return { interval: "5m", trend, score, rsi, macd, macdSignal, changePct, summary }
}

function analyze15m(candles: Candle[]): TimeframeSignal {
  if (candles.length < 15) {
    return { interval: "15m", trend: "NEUTRAL", score: 0, changePct: 0, summary: "Yetersiz Veri" }
  }
  const t = analyzeCandles(candles)
  const price = candles[candles.length - 1].close
  const prev = candles[candles.length - 2] || candles[0]
  const changePct = prev.close > 0 ? ((price - prev.close) / prev.close) * 100 : 0
  const ema20 = t.values.ema20 ?? t.values.sma20 ?? price
  const ema50 = t.values.ema50 ?? t.values.sma50 ?? ema20
  const rsi = t.values.rsi ?? 50
  const macd = t.values.macd ?? 0
  const macdSignal = t.values.macdSignal ?? 0

  let score = 0
  const isBull = price >= ema20 && ema20 >= ema50 * 0.995 && rsi >= 42
  const isBear = price < ema20 && ema20 < ema50 && (rsi < 45 || macd < macdSignal)

  if (isBull) score += 60
  else if (isBear) score -= 60

  if (macd > macdSignal) score += 20
  else score -= 20

  const trend: TimeframeSignal["trend"] = score >= 30 ? "BULLISH" : score <= -30 ? "BEARISH" : "NEUTRAL"
  const summary = isBull
    ? `15m Boğa Trendi (EMA20 > EMA50, RSI: ${rsi.toFixed(0)})`
    : isBear
    ? `15m Ayı Baskısı (Ortalamalar Altında, RSI: ${rsi.toFixed(0)})`
    : `15m Yatay Denge`

  return { interval: "15m", trend, score, rsi, macd, macdSignal, changePct, summary }
}

function analyze1h(candles: Candle[]): TimeframeSignal {
  if (candles.length < 15) {
    return { interval: "1h", trend: "NEUTRAL", score: 0, changePct: 0, summary: "Yetersiz Veri" }
  }
  const t = analyzeCandles(candles)
  const price = candles[candles.length - 1].close
  const prev = candles[candles.length - 2] || candles[0]
  const changePct = prev.close > 0 ? ((price - prev.close) / prev.close) * 100 : 0
  const ema20 = t.values.ema20 ?? t.values.sma20 ?? price
  const ema50 = t.values.ema50 ?? t.values.sma50 ?? ema20
  const rsi = t.values.rsi ?? 50
  const macd = t.values.macd ?? 0
  const macdSignal = t.values.macdSignal ?? 0

  let score = 0
  const isBull = price >= ema20 && ema20 >= ema50 * 0.995 && rsi >= 42
  const isBear = price < ema20 && ema20 < ema50 && (rsi < 45 || macd < macdSignal)

  if (isBull) score += 60
  else if (isBear) score -= 60

  if (macd > macdSignal) score += 20
  else score -= 20

  const trend: TimeframeSignal["trend"] = score >= 30 ? "BULLISH" : score <= -30 ? "BEARISH" : "NEUTRAL"
  const summary = isBull
    ? `1H Boga Trendi (EMA20 > EMA50 Destegi, RSI: ${rsi.toFixed(0)})`
    : isBear
    ? `1H Ayi Baskisi (Ortalamalar Altinda, RSI: ${rsi.toFixed(0)})`
    : `1H Konsolidasyon / Yatay Bant`

  return { interval: "1h", trend, score, rsi, macd, macdSignal, changePct, summary }
}

function analyzeMacroDays(candles: Candle[]): { tf1w: TimeframeSignal; tf1mMonth: TimeframeSignal } {
  if (candles.length < 7) {
    const fallback: TimeframeSignal = { interval: "1w", trend: "NEUTRAL", score: 0, changePct: 0, summary: "Yetersiz Veri" }
    return { tf1w: fallback, tf1mMonth: { ...fallback, interval: "1M" } }
  }

  const closes = candles.map((c) => c.close)
  const currentPrice = closes[closes.length - 1]
  const price7dAgo = closes[Math.max(0, closes.length - 8)]
  const price30dAgo = closes[0]

  const change1w = price7dAgo > 0 ? ((currentPrice - price7dAgo) / price7dAgo) * 100 : 0
  const change1m = price30dAgo > 0 ? ((currentPrice - price30dAgo) / price30dAgo) * 100 : 0

  const last7 = closes.slice(-7)
  const sma7 = last7.reduce((a, b) => a + b, 0) / last7.length
  const isAboveSma7 = currentPrice >= sma7

  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const high30d = Math.max(...highs)
  const low30d = Math.min(...lows)
  const range = high30d - low30d
  const rangePos = range > 0 ? Math.round(((currentPrice - low30d) / range) * 100) : 50

  let score1w = 0
  if (change1w > 0 && isAboveSma7) score1w += 50
  else if (change1w < -5 && !isAboveSma7) score1w -= 50

  const trend1w: TimeframeSignal["trend"] = score1w >= 25 ? "BULLISH" : score1w <= -25 ? "BEARISH" : "NEUTRAL"
  const summary1w = isAboveSma7
    ? `1Haf Boga (SMA7 Ustu, %${change1w >= 0 ? "+" : ""}${change1w.toFixed(1)})`
    : `1Haf Saticili (SMA7 Alti, %${change1w.toFixed(1)})`

  const tf1w: TimeframeSignal = {
    interval: "1w",
    trend: trend1w,
    score: score1w,
    changePct: change1w,
    summary: summary1w,
  }

  let score1m = 0
  if (rangePos <= 35 && change1w >= -3) {
    score1m += 50
  } else if (rangePos >= 85) {
    score1m -= 40
  } else if (change1m > 0 && rangePos <= 75) {
    score1m += 30
  }

  const trend1m: TimeframeSignal["trend"] = score1m >= 25 ? "BULLISH" : score1m <= -25 ? "BEARISH" : "NEUTRAL"
  const summary1m =
    rangePos <= 35
      ? `1Ay Dip Tabani (%${rangePos} Taban Konumu)`
      : rangePos >= 80
      ? `1Ay Zirve Direnci (%${rangePos} Tepe Konumu)`
      : `1Ay Orta Kanal (%${rangePos} Konum, %${change1m >= 0 ? "+" : ""}${change1m.toFixed(1)})`

  const tf1mMonth: TimeframeSignal = {
    interval: "1M",
    trend: trend1m,
    score: score1m,
    changePct: change1m,
    summary: summary1m,
  }

  return { tf1w, tf1mMonth }
}

export async function getMultiTimeframeAnalysis(crypto: {
  symbol: string
  name: string
  binance?: string
  yahoo?: string
  quoteVolume24h?: number
  high24h?: number
  low24h?: number
  currentPrice?: number
}): Promise<MultiTimeframeAnalysis | null> {
  const pair = crypto.binance
  if (!pair) return null

  const now = Date.now()
  const cached = mtfCache.get(pair)
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  try {
    const hasPrecomputed = typeof crypto.quoteVolume24h === "number" && crypto.quoteVolume24h > 0
    const [klines1m, klines5m, klines15m, klines1h, klines1d, tickerRes] = await Promise.all([
      fetchKlines(pair, "1m", 30),
      fetchKlines(pair, "5m", 60),
      fetchKlines(pair, "15m", 50),
      fetchKlines(pair, "1h", 60),
      fetchKlines(pair, "1d", 35),
      hasPrecomputed
        ? Promise.resolve(null)
        : fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`, {
            signal: AbortSignal.timeout(2500),
          }).catch(() => null),
    ])

    if (!klines5m.length || !klines1h.length) {
      return cached?.data ?? null
    }

    const currentPrice = crypto.currentPrice || klines5m[klines5m.length - 1].close

    let quoteVolume24h = crypto.quoteVolume24h || 0
    let high24h = crypto.high24h || currentPrice
    let low24h = crypto.low24h || currentPrice
    let volumeRatio24h = 1.0

    if (klines5m.length >= 10) {
      // Son tamamlanan veya anlık muma göre 20 mumluk ortalama hacme oranla
      const lastK = klines5m[klines5m.length - 1]
      const prevK = klines5m[klines5m.length - 2]
      const pastVols = klines5m.slice(Math.max(0, klines5m.length - 22), -2).map((k) => k.volume)
      const avgVol = pastVols.length > 0 ? pastVols.reduce((a, b) => a + b, 0) / pastVols.length : 1
      const effectiveVol = Math.max(lastK?.volume || 0, prevK?.volume || 0)
      volumeRatio24h = avgVol > 0 ? Number((effectiveVol / avgVol).toFixed(2)) : 1.0
    }

    if (!hasPrecomputed && tickerRes && tickerRes.ok) {
      try {
        const t = await tickerRes.json()
        quoteVolume24h = parseFloat(t.quoteVolume) || quoteVolume24h
        high24h = parseFloat(t.highPrice) || high24h
        low24h = parseFloat(t.lowPrice) || low24h
      } catch {}
    }

    const tf1m = analyze1m(klines1m)
    const tf5m = analyze5m(klines5m)
    const tf15m = analyze15m(klines15m)
    const tf1h = analyze1h(klines1h)
    const { tf1w, tf1mMonth } = analyzeMacroDays(klines1d)

    // 1H (Saatlik) + 1w (Haftalık) + 1M (Aylık) makro trend ağırlığı %75!
    // Kısa vadeli 5m/1m sadece giriş zamanlamasını belirler (%25).
    const weightedScore =
      tf1h.score * 0.35 +
      tf1w.score * 0.25 +
      tf1mMonth.score * 0.15 +
      tf5m.score * 0.15 +
      tf1m.score * 0.1

    const overallScore = Math.min(100, Math.max(0, Math.round(weightedScore + 50)))

    let aiVerdict: MultiTimeframeAnalysis["aiVerdict"] = "TUT"
    let aiConfidence = overallScore
    const reasons: string[] = []

    // DIP TESPITI: Piyasa cokuntusunde (%85 kirmiziyken) asiri satim (RSI < 35) + dipten donus teyidi
    const isDipReversal = (tf1h.rsi && tf1h.rsi <= 36) || (tf5m.rsi && tf5m.rsi <= 32) || (tf15m?.rsi && tf15m.rsi <= 32)
    const isDipRebound = isDipReversal && (tf5m.trend === "BULLISH" || (tf1m.score > 10) || (tf5m.changePct > 0.2))

    // KURAL 1: Eger 1H dusus trendindeyse AMA dipten toparlanma teyidi (Dip Reversal) varsa DIPTEN TOPLAMA ALIMI tetikle!
    if (tf1h.trend === "BEARISH") {
      if (isDipRebound) {
        aiVerdict = "AL"
        aiConfidence = Math.max(75, overallScore + 30)
        reasons.push("🎯 DİP REVERSAL AVCSISI: Piyasa aşırı satımda (RSI dip), dipten alıcı tepkisi ve toparlanma teyit edildi! Dipten toplama alımı onaylandı")
      } else {
        aiVerdict = "SAT"
        aiConfidence = Math.max(70, 100 - overallScore)
        reasons.push("1H düşüş trendi baskısı: Saatlik ve makro yön aşağı olduğu için bekleniyor (Dip dönüş teyidi henüz yok)")
      }
    }
    // KURAL 2: 1 Aylık tepe direncinin üzerindeyse veya aşırı şişmişse alım yasak
    else if (tf1mMonth.score <= -35 || (tf5m.rsi && tf5m.rsi >= 72) || (tf1m.rsi && tf1m.rsi >= 78)) {
      aiVerdict = "SAT"
      aiConfidence = 80
      reasons.push("Aylık tepe direnci veya aşırı alım bölgesi: Düzeltme riski yüksek")
    }
    // KURAL 3: 1H Boğa Trendi + 1w Desteği + 1M Dengeli ve Skor 65+ ise net AL / GÜÇLÜ AL
    else if (overallScore >= 65 && tf1h.trend === "BULLISH" && tf5m.trend !== "BEARISH") {
      aiVerdict = overallScore >= 80 ? "GÜÇLÜ AL" : "AL"
      reasons.push("1H ve 1A makro trend yönü pozitif, 5 zaman dilimi uyumlu")
      if (tf1w.trend === "BULLISH") reasons.push("Haftalık SMA7 desteği güçlü")
      if (tf1mMonth.trend === "BULLISH") reasons.push("Aylık dip/birikim kanalından yukarı dönüş")
    }
    // KURAL 4: Genel skor 60+ ve haftalık ayı trendinde değilse kontrollü AL
    else if (overallScore >= 60 && tf1w.trend !== "BEARISH") {
      aiVerdict = "AL"
      reasons.push("Saatlik ve haftalık denge pozitif, alım yönlü ivme mevcut")
    }
    // DİĞER: Yön arayışı, nötr bekleme
    else {
      aiVerdict = "TUT"
      reasons.push("Makro ve saatlik trendde net teyit yok, kırılım beklenmeli")
    }

    const takeProfitPrice = currentPrice * 1.032
    const stopLossPrice = currentPrice * 0.984
    const breakevenPrice = currentPrice * 1.0035

    const result: MultiTimeframeAnalysis = {
      symbol: crypto.symbol,
      name: crypto.name,
      binancePair: pair,
      currentPrice,
      tf1m,
      tf5m,
      tf15m,
      tf1h,
      tf1w,
      tf1mMonth,
      overallScore,
      aiVerdict,
      aiConfidence,
      aiReason: reasons.join(". ") || "Coklu zaman dilimi dengeli.",
      takeProfitPrice,
      stopLossPrice,
      breakevenPrice,
      volumeRatio24h,
      quoteVolume24h,
      high24h,
      low24h,
    }

    if (mtfCache.size > 50) {
      const oldestTime = now - CACHE_TTL
      for (const [k, v] of mtfCache.entries()) {
        if (v.timestamp < oldestTime) mtfCache.delete(k)
      }
    }
    mtfCache.set(pair, { data: result, timestamp: now })
    return result
  } catch {
    return cached?.data ?? null
  }
}

export async function getBulkMultiTimeframeAnalysis(
  cryptos: Array<{ symbol: string; name: string; binance?: string; yahoo?: string }>
): Promise<MultiTimeframeAnalysis[]> {
  const list = await Promise.allSettled(
    cryptos.map((c) => getMultiTimeframeAnalysis(c))
  )
  return list
    .filter((r): r is PromiseFulfilledResult<MultiTimeframeAnalysis | null> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value as MultiTimeframeAnalysis)
}
