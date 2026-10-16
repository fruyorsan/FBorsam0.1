export type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number }
export type Signal = "GÜÇLÜ AL" | "AL" | "TUT" | "SAT" | "GÜÇLÜ SAT"
export type Verdict = "pos" | "neg" | "neutral"
export type IndicatorRead = { key: string; group: string; title: string; verdict: Verdict; note: string }

const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, finite(value, min)))
const round = (value: number, digits?: number) => {
  const v = finite(value)
  if (digits !== undefined) {
    const f = 10 ** digits
    return Math.round(v * f) / f
  }
  const abs = Math.abs(v)
  if (abs === 0) return 0
  if (abs < 0.00001) return Math.round(v * 1e8) / 1e8
  if (abs < 0.001) return Math.round(v * 1e6) / 1e6
  if (abs < 1) return Math.round(v * 1e4) / 1e4
  return Math.round(v * 100) / 100
}

export function ema(values: number[], period: number): number[] {
  if (!values.length) return []
  const k = 2 / (period + 1)
  const result: number[] = new Array(values.length)

  if (values.length < period) {
    let sum = 0
    for (let i = 0; i < values.length; i++) {
      sum += values[i]
      result[i] = sum / (i + 1)
    }
    return result
  }

  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += values[i]
    result[i] = sum / (i + 1)
  }
  // Standart TA-Lib / TradingView EMA Başlatması: İlk period elemanın tam SMA ortalamasıyla başla
  result[period - 1] = sum / period

  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k)
  }
  return result
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return 50
  const changes = values.slice(1).map((v, i) => v - values[i])
  let gains = avg(changes.slice(0, period).map(v => Math.max(v, 0)))
  let losses = avg(changes.slice(0, period).map(v => Math.max(-v, 0)))
  for (const change of changes.slice(period)) {
    gains = (gains * (period - 1) + Math.max(change, 0)) / period
    losses = (losses * (period - 1) + Math.max(-change, 0)) / period
  }
  if (losses === 0) return gains === 0 ? 50 : 100
  return clamp(finite(100 - 100 / (1 + gains / losses), 50), 0, 100)
}

function atr(candles: Candle[], period = 14) {
  if (candles.length < 2) return 0
  const ranges = candles.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - candles[i].close), Math.abs(c.low - candles[i].close)))
  return avg(ranges.slice(-period))
}

/**
 * Slow Stochastic Oscillator (%K, 3-period smoothed SMA)
 * Ham tek-mum Fast %K gürültüsünü (whipsaw) yok eder, gerçek dönüşleri saptar.
 */
function stochastic(candles: Candle[], period = 14, smoothK = 3): number {
  if (candles.length < Math.min(period, 7)) return 50
  const fastKList: number[] = []
  const startIdx = Math.max(0, candles.length - smoothK)
  for (let i = startIdx; i < candles.length; i++) {
    const windowStart = Math.max(0, i - period + 1)
    const window = candles.slice(windowStart, i + 1)
    const low = Math.min(...window.map(c => c.low))
    const high = Math.max(...window.map(c => c.high))
    const currentClose = candles[i].close
    const val = high === low ? 50 : clamp(((currentClose - low) / (high - low)) * 100, 0, 100)
    fastKList.push(val)
  }
  return clamp(round(fastKList.length ? avg(fastKList) : 50, 2), 0, 100)
}

function signalFromScore(score: number): Signal {
  if (score >= 3) return "GÜÇLÜ AL"
  if (score >= 1) return "AL"
  if (score <= -3) return "GÜÇLÜ SAT"
  if (score <= -1) return "SAT"
  return "TUT"
}

export function analyzeCandles(candles: Candle[]) {
  if (candles.length < 15) throw new Error("Teknik analiz için en az 15 mum gerekli")
  const closes = candles.map(c => c.close)
  const price = closes.at(-1)!
  const sma20 = avg(closes.slice(-Math.min(20, closes.length)))
  const sma50 = avg(closes.slice(-Math.min(50, closes.length)))
  const ema12Series = ema(closes, 12)
  const ema26Series = ema(closes, 26)
  const ema20Val = ema(closes, 20).at(-1) ?? sma20
  const ema50Val = ema(closes, 50).at(-1) ?? sma50
  const macdSeries = ema12Series.map((value, i) => value - (ema26Series[i] ?? value))
  const macd = macdSeries.at(-1) ?? 0
  const macdSignal = ema(macdSeries, 9).at(-1) ?? 0
  const macdHist = macd - macdSignal
  const currentRsi = rsi(closes)
  const currentStoch = stochastic(candles)
  const currentAtr = atr(candles)
  const deviation = Math.sqrt(avg(closes.slice(-Math.min(20, closes.length)).map(v => (v - sma20) ** 2)))
  const upper = sma20 + deviation * 2
  const lower = sma20 - deviation * 2
  const bandwidthPosition = clamp(upper === lower ? 50 : ((price - lower) / (upper - lower)) * 100, 0, 100)
  const support = Math.min(...candles.slice(-Math.min(30, candles.length)).map(c => c.low))
  const resistance = Math.max(...candles.slice(-Math.min(30, candles.length)).map(c => c.high))
  const volumes = candles.map(c => c.volume).filter(Number.isFinite)
  const lastVolume = volumes.at(-1) ?? 0
  const avgVolume = avg(volumes.slice(-Math.min(20, volumes.length)))
  const volumeRatio = avgVolume ? lastVolume / avgVolume : 1
  // RVOL (Relative Volume): Son mumun hacmi, son 24 periyotluk normal ortalamaya göre kaç kat yüksek?
  const dayAvgVolume = avg(volumes.slice(-Math.min(24, volumes.length)))
  const rvol = dayAvgVolume ? lastVolume / dayAvgVolume : volumeRatio
  const atrPercent = price ? (currentAtr / price) * 100 : 0
  const swingWindow = candles.slice(-Math.min(90, candles.length))
  const swingLow = Math.min(...swingWindow.map(c => c.low))
  const swingHigh = Math.max(...swingWindow.map(c => c.high))
  const swingRange = swingHigh - swingLow
  const fibonacci = {
    low: swingLow,
    level236: swingHigh - swingRange * 0.236,
    level382: swingHigh - swingRange * 0.382,
    level500: swingHigh - swingRange * 0.5,
    level618: swingHigh - swingRange * 0.618,
    high: swingHigh,
  }
  let score = 0
  // 0. RVOL / Gerçek Balina Para Girişi Desteği (Hacimsiz yükselişleri cezalandır, güçlü girişi ödüllendir)
  if (rvol >= 1.8) score += 2 // Güçlü para girişi
  else if (rvol < 0.8) score -= 1 // Hacimsiz ölü piyasa

  // 1. Trend (EMA20 & EMA50 Üstel Ağırlıklı Ortalamalar)
  if (price > ema20Val && ema20Val > ema50Val) score += 2
  else if (price > ema20Val) score += 1
  else if (price < ema20Val && ema20Val < ema50Val) score -= 2
  else score -= 1

  // 2. Momentum (MACD & Histogram İvmesi)
  if (macd > macdSignal && macdHist >= 0) score += 1
  else if (macd < macdSignal) score -= 1

  // 3. RSI (Aşırı Alım Tepe Cezası & Sağlıklı Düzeltme Alanı)
  if (currentRsi >= 70) score -= 3 // Tepe / Aşırı Alım — ASLA ALMA!
  else if (currentRsi >= 62) score -= 1 // Şişmiş bölge
  else if (currentRsi >= 40 && currentRsi <= 55) score += 2 // İdeal sağlıklı düzeltme / birikim
  else if (currentRsi <= 32) score += 2 // Derin dip tepki bölgesi

  // 4. Stochastic (Slow %K)
  if (currentStoch >= 80) score -= 2 // Stokastik tepe!
  else if (currentStoch >= 70) score -= 1
  else if (currentStoch <= 25) score += 2 // Stokastik dip

  // 5. Bollinger Bandı Konumu (%B)
  if (bandwidthPosition >= 80) score -= 2 // Üst banda aşırı gerilmiş
  else if (bandwidthPosition <= 25) score += 1 // Alt bant desteği

  // 6. Hacim Teyidi
  if (volumeRatio >= 1.2 && price > ema20Val) score += 1
  else if (volumeRatio < 0.6) score -= 1

  const signal = signalFromScore(score)
  const confidence = Math.min(92, Math.max(45, 50 + Math.abs(score) * 6))

  const rsiRead: IndicatorRead =
    currentRsi >= 70 ? { key: "rsi", group: "RSI · GÜÇ", title: "AŞIRI ALIM", verdict: "neg", note: "Momentum aşırı alım bölgesinde; geri çekilme riski var." }
    : currentRsi <= 30 ? { key: "rsi", group: "RSI · GÜÇ", title: "AŞIRI SATIM", verdict: "pos", note: "Aşırı satım bölgesi; tepki alımı gelebilir." }
    : currentRsi >= 55 ? { key: "rsi", group: "RSI · GÜÇ", title: "GÜÇLÜ", verdict: "pos", note: "Momentum alıcı tarafında." }
    : currentRsi <= 45 ? { key: "rsi", group: "RSI · GÜÇ", title: "ZAYIF", verdict: "neg", note: "Momentum satıcı tarafında." }
    : { key: "rsi", group: "RSI · GÜÇ", title: "DENGELİ", verdict: "neutral", note: "Fiyat momentumu aşırı bölgelere girmemiş." }

  const emaRead: IndicatorRead =
    price > ema20Val && ema20Val > ema50Val ? { key: "ema", group: "EMA · TREND", title: "YUKARI TREND", verdict: "pos", note: "Fiyat EMA20 ve EMA50 üzerinde; yükseliş teyitli." }
    : price < ema20Val && ema20Val < ema50Val ? { key: "ema", group: "EMA · TREND", title: "AŞAĞI BASKI", verdict: "neg", note: "EMA20, EMA50'nin altında; düşüş baskısı sürüyor." }
    : { key: "ema", group: "EMA · TREND", title: "YATAY", verdict: "neutral", note: "Ortalamalar iç içe; net yön oluşmamış." }

  const macdRead: IndicatorRead =
    macd > macdSignal ? { key: "macd", group: "MACD · MOMENTUM", title: "POZİTİF", verdict: "pos", note: "Momentum hareketi destekliyor." }
    : { key: "macd", group: "MACD · MOMENTUM", title: "NEGATİF", verdict: "neg", note: "Momentum zayıflıyor, sinyal çizgisi altında." }

  const bollingerRead: IndicatorRead =
    bandwidthPosition >= 80 ? { key: "bollinger", group: "BOLLINGER · FİYAT ALANI", title: "ÜST BANDA YAKIN", verdict: "neg", note: "Fiyat kısa vadede gerilmiş olabilir." }
    : bandwidthPosition <= 20 ? { key: "bollinger", group: "BOLLINGER · FİYAT ALANI", title: "ALT BANDA YAKIN", verdict: "pos", note: "Fiyat kısa vadede ucuzlamış olabilir." }
    : { key: "bollinger", group: "BOLLINGER · FİYAT ALANI", title: "ORTA BANT", verdict: "neutral", note: "Fiyat bant ortasında, dengeli seyrediyor." }

  const stochRead: IndicatorRead =
    currentStoch >= 80 ? { key: "stochastic", group: "STOCHASTIC · KISA DÖNÜŞ", title: "AŞIRI ALIM", verdict: "neg", note: "Kısa vadeli düzeltme riski artmış." }
    : currentStoch <= 20 ? { key: "stochastic", group: "STOCHASTIC · KISA DÖNÜŞ", title: "AŞIRI SATIM", verdict: "pos", note: "Kısa vadeli tepki alımı gelebilir." }
    : { key: "stochastic", group: "STOCHASTIC · KISA DÖNÜŞ", title: "DENGELİ", verdict: "neutral", note: "Kısa vadeli momentum dengeli." }

  const volumeLabel = rvol >= 1.8 ? "BALİNA GİRİŞİ (RVOL)" : volumeRatio >= 1.5 ? "YÜKSEK HACİM" : volumeRatio <= 0.6 ? "DÜŞÜK HACİM" : "NORMAL HACİM"
  const volatilityLabel = atrPercent >= 3 ? "YÜKSEK OYNAKLIK" : atrPercent >= 1.5 ? "ORTA OYNAKLIK" : "DÜŞÜK OYNAKLIK"
  const riskRead: IndicatorRead = {
    key: "risk", group: "HACİM / ATR · RİSK",
    title: `${volumeLabel} · ${volatilityLabel}`,
    verdict: rvol >= 1.8 ? "pos" : volumeRatio <= 0.6 ? "neg" : "neutral",
    note: `RVOL: ${round(rvol, 1)}x | İşlem hacmi ortalamanın ${round(volumeRatio, 1)} katı; oynaklık %${round(atrPercent, 1)}.`,
  }
  const breakdown: IndicatorRead[] = [rsiRead, emaRead, macdRead, bollingerRead, stochRead, riskRead]

  return {
    price: round(price), signal, confidence, support: round(support), resistance: round(resistance),
    values: {
      rsi: round(currentRsi), macd: round(macd, 4), macdSignal: round(macdSignal, 4), macdHist: round(macdHist, 4),
      sma20: round(sma20), sma50: round(sma50), ema20: round(ema20Val), ema50: round(ema50Val),
      bollinger: round(bandwidthPosition), stochastic: round(currentStoch), atr: round(currentAtr, 4), atrPercent: round(atrPercent), volumeRatio: round(volumeRatio),
      rvol: round(rvol, 2),
    },
    fibonacci: Object.fromEntries(Object.entries(fibonacci).map(([k, v]) => [k, round(v)])) as typeof fibonacci,
    breakdown,
    chart: (() => {
      const sma20Series = candles.map((_, idx) => {
        const window = candles.slice(Math.max(0, idx - 19), idx + 1)
        return avg(window.map(x => x.close))
      })
      const chartSlice = candles.slice(-70)
      const offset = candles.length - chartSlice.length
      return chartSlice.map((c, i) => ({
        date: c.date,
        price: round(c.close),
        open: round(c.open),
        high: round(c.high),
        low: round(c.low),
        close: round(c.close),
        volume: round(c.volume ?? 0),
        sma: round(sma20Series[offset + i]),
      }))
    })(),
  }
}

export function horizonAdvice(candles: Candle[]) {
  const configurations = [
    { key: "gunluk", label: "Günlük", slice: 45 },
    { key: "haftalik", label: "Haftalık", slice: 90 },
    { key: "aylik", label: "Aylık", slice: 180 },
  ]
  return configurations.map(config => {
    const minSlice = Math.min(candles.length, Math.max(config.slice, 15))
    const result = analyzeCandles(candles.slice(-minSlice))
    const action = result.signal.includes("AL") ? "Geri çekilmelerde kademeli izlenebilir" : result.signal.includes("SAT") ? "Riski azalt, destek tepkisini bekle" : "Pozisyonu koru, kırılımı bekle"
    return { ...config, signal: result.signal, confidence: result.confidence, action, invalidation: result.support, target: result.resistance }
  })
}
