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

function ema(values: number[], period: number) {
  if (!values.length) return []
  const k = 2 / (period + 1)
  const result = [values[0]]
  for (let i = 1; i < values.length; i++) result.push(values[i] * k + result[i - 1] * (1 - k))
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
  return finite(100 - 100 / (1 + gains / losses), 50)
}

function atr(candles: Candle[], period = 14) {
  if (candles.length < 2) return 0
  const ranges = candles.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - candles[i].close), Math.abs(c.low - candles[i].close)))
  return avg(ranges.slice(-period))
}

function stochastic(candles: Candle[], period = 14) {
  const window = candles.slice(-period)
  if (!window.length) return 50
  const low = Math.min(...window.map(c => c.low))
  const high = Math.max(...window.map(c => c.high))
  return high === low ? 50 : finite(((window.at(-1)!.close - low) / (high - low)) * 100, 50)
}

function signalFromScore(score: number): Signal {
  if (score >= 3) return "GÜÇLÜ AL"
  if (score >= 1) return "AL"
  if (score <= -3) return "GÜÇLÜ SAT"
  if (score <= -1) return "SAT"
  return "TUT"
}

export function analyzeCandles(candles: Candle[]) {
  if (candles.length < 30) throw new Error("Teknik analiz için yeterli mum yok")
  const closes = candles.map(c => c.close)
  const price = closes.at(-1)!
  const sma20 = avg(closes.slice(-20))
  const sma50 = avg(closes.slice(-50))
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const macdSeries = ema12.map((value, i) => value - (ema26[i] ?? value))
  const macd = macdSeries.at(-1) ?? 0
  const macdSignal = ema(macdSeries, 9).at(-1) ?? 0
  const currentRsi = rsi(closes)
  const currentStoch = stochastic(candles)
  const currentAtr = atr(candles)
  const deviation = Math.sqrt(avg(closes.slice(-20).map(v => (v - sma20) ** 2)))
  const upper = sma20 + deviation * 2
  const lower = sma20 - deviation * 2
  const bandwidthPosition = clamp(upper === lower ? 50 : ((price - lower) / (upper - lower)) * 100, 0, 100)
  const support = Math.min(...candles.slice(-20).map(c => c.low))
  const resistance = Math.max(...candles.slice(-20).map(c => c.high))
  const volumes = candles.map(c => c.volume).filter(Number.isFinite)
  const lastVolume = volumes.at(-1) ?? 0
  const avgVolume = avg(volumes.slice(-20))
  const volumeRatio = avgVolume ? lastVolume / avgVolume : 1
  const atrPercent = price ? (currentAtr / price) * 100 : 0
  const swingWindow = candles.slice(-90)
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
  score += price > sma20 ? 1 : -1
  score += price > sma50 ? 1 : -1
  score += macd > macdSignal ? 1 : -1
  score += currentRsi > 55 && currentRsi < 72 ? 1 : currentRsi > 78 || currentRsi < 30 ? -1 : 0
  score += currentStoch > 55 && currentStoch < 82 ? 1 : currentStoch > 88 ? -1 : 0
  const signal = signalFromScore(score)
  const confidence = Math.min(88, Math.max(48, 52 + Math.abs(score) * 7))

  const rsiRead: IndicatorRead =
    currentRsi >= 70 ? { key: "rsi", group: "RSI · GÜÇ", title: "AŞIRI ALIM", verdict: "neg", note: "Momentum aşırı alım bölgesinde; geri çekilme riski var." }
    : currentRsi <= 30 ? { key: "rsi", group: "RSI · GÜÇ", title: "AŞIRI SATIM", verdict: "pos", note: "Aşırı satım bölgesi; tepki alımı gelebilir." }
    : currentRsi >= 55 ? { key: "rsi", group: "RSI · GÜÇ", title: "GÜÇLÜ", verdict: "pos", note: "Momentum alıcı tarafında." }
    : currentRsi <= 45 ? { key: "rsi", group: "RSI · GÜÇ", title: "ZAYIF", verdict: "neg", note: "Momentum satıcı tarafında." }
    : { key: "rsi", group: "RSI · GÜÇ", title: "DENGELİ", verdict: "neutral", note: "Fiyat momentumu aşırı bölgelere girmemiş." }

  const emaRead: IndicatorRead =
    price > sma20 && sma20 > sma50 ? { key: "ema", group: "EMA · TREND", title: "YUKARI TREND", verdict: "pos", note: "Fiyat EMA20 ve EMA50 üzerinde; yükseliş teyitli." }
    : price < sma20 && sma20 < sma50 ? { key: "ema", group: "EMA · TREND", title: "AŞAĞI BASKI", verdict: "neg", note: "EMA20, EMA50'nin altında; yükseliş teyitsiz." }
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

  const volumeLabel = volumeRatio >= 1.5 ? "YÜKSEK HACİM" : volumeRatio <= 0.6 ? "DÜŞÜK HACİM" : "NORMAL HACİM"
  const volatilityLabel = atrPercent >= 3 ? "YÜKSEK OYNAKLIK" : atrPercent >= 1.5 ? "ORTA OYNAKLIK" : "DÜŞÜK OYNAKLIK"
  const riskRead: IndicatorRead = {
    key: "risk", group: "HACİM / ATR · RİSK",
    title: `${volumeLabel} · ${volatilityLabel}`,
    verdict: volumeRatio >= 1.5 ? "pos" : volumeRatio <= 0.6 ? "neg" : "neutral",
    note: `Ortalama günlük hareket fiyatın %${round(atrPercent, 1)}'i; işlem hacmi ortalamanın ${round(volumeRatio, 1)} katı.`,
  }
  const breakdown: IndicatorRead[] = [rsiRead, emaRead, macdRead, bollingerRead, stochRead, riskRead]

  return {
    price: round(price), signal, confidence, support: round(support), resistance: round(resistance),
    values: {
      rsi: round(currentRsi), macd: round(macd, 3), macdSignal: round(macdSignal, 3), sma20: round(sma20), sma50: round(sma50),
      bollinger: round(bandwidthPosition), stochastic: round(currentStoch), atr: round(currentAtr, 3), atrPercent: round(atrPercent), volumeRatio: round(volumeRatio),
    },
    fibonacci: Object.fromEntries(Object.entries(fibonacci).map(([k, v]) => [k, round(v)])) as typeof fibonacci,
    breakdown,
    chart: candles.slice(-70).map((c, i, rows) => ({ date: c.date, price: round(c.close), sma: round(avg(rows.slice(Math.max(0, i - 19), i + 1).map(x => x.close))) })),
  }
}

export function horizonAdvice(candles: Candle[]) {
  const configurations = [
    { key: "gunluk", label: "Günlük", slice: 45 },
    { key: "haftalik", label: "Haftalık", slice: 90 },
    { key: "aylik", label: "Aylık", slice: 180 },
  ]
  return configurations.map(config => {
    const result = analyzeCandles(candles.slice(-Math.max(config.slice, 30)))
    const action = result.signal.includes("AL") ? "Geri çekilmelerde kademeli izlenebilir" : result.signal.includes("SAT") ? "Riski azalt, destek tepkisini bekle" : "Pozisyonu koru, kırılımı bekle"
    return { ...config, signal: result.signal, confidence: result.confidence, action, invalidation: result.support, target: result.resistance }
  })
}
