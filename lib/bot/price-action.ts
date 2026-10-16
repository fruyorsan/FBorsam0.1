// Fiyat yapısı (price action) modülü — saf fonksiyonlar, yan etkisiz.
// Şimdilik canlı bota BAĞLI DEĞİL; sadece backtest ve testnet doğrulaması için.

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number }

export function rsiSeries(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(NaN)
  if (closes.length <= period) return out
  let g = 0, l = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) g += d; else l -= d
  }
  g /= period; l /= period
  out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l)
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    g = (g * (period - 1) + (d > 0 ? d : 0)) / period
    l = (l * (period - 1) + (d < 0 ? -d : 0)) / period
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l)
  }
  return out
}

export function atrSeries(c: Candle[], period = 14): number[] {
  const out: number[] = new Array(c.length).fill(NaN)
  let sum = 0
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c))
    if (i <= period) {
      sum += tr
      if (i === period) out[i] = sum / period
    } else {
      out[i] = (out[i - 1] * (period - 1) + tr) / period
    }
  }
  return out
}

// Pivot dip: low[i], solundaki ve sağındaki k mumun en düşüğü. Sağdaki k mum kapanınca ONAYLANIR (i+k).
export function isPivotLow(c: Candle[], i: number, k = 3): boolean {
  if (i - k < 0 || i + k >= c.length) return false
  for (let j = i - k; j <= i + k; j++) {
    if (j !== i && c[j].l <= c[i].l) return false
  }
  return true
}

// t anında bilinen (onaylanmış) pivot dipleri: sadece i + k <= t olanlar → geleceğe bakmaz.
export function confirmedPivotLows(c: Candle[], t: number, k = 3, maxLookback = 80): number[] {
  const res: number[] = []
  for (let i = Math.max(k, t - maxLookback); i <= t - k; i++) {
    if (isPivotLow(c, i, k)) res.push(i)
  }
  return res
}

export type Signal = { type: "SWEEP" | "DIVERGENCE"; slPrice: number; reason: string }

// Likidite süpürmesi: onaylı pivot dibin ALTINA iğne atıp mum kapanışında geri üstüne kapanmak.
export function detectSweep(c: Candle[], t: number, avgVol: number, k = 3): Signal | null {
  const piv = confirmedPivotLows(c, t, k)
  if (piv.length === 0) return null
  const p = piv[piv.length - 1]
  const lvl = c[p].l
  const cur = c[t]
  const range = cur.h - cur.l
  if (range <= 0) return null
  const lowerWick = Math.min(cur.o, cur.c) - cur.l
  if (cur.l < lvl && cur.c > lvl && lowerWick / range >= 0.5 && cur.v >= avgVol * 1.3) {
    return { type: "SWEEP", slPrice: cur.l * 0.999, reason: `Dip süpürme: ${lvl} altına iğne, geri kapanış` }
  }
  return null
}

// Boğa uyumsuzluğu: fiyat daha düşük dip yaparken RSI daha yüksek dip yapıyor. Onay: 2. pivot kapandığı mum.
export function detectDivergence(c: Candle[], rsi: number[], t: number, k = 3): Signal | null {
  const piv = confirmedPivotLows(c, t, k, 60)
  if (piv.length < 2) return null
  const p2 = piv[piv.length - 1]
  if (p2 + k !== t) return null // sadece onay anında tetikle
  const p1 = piv[piv.length - 2]
  const dist = p2 - p1
  if (dist < 5 || dist > 40) return null
  if (!(c[p2].l < c[p1].l) || !(rsi[p2] > rsi[p1] + 2) || !(rsi[p2] < 45)) return null
  if (!(c[t].c > c[t].o)) return null
  return { type: "DIVERGENCE", slPrice: c[p2].l * 0.999, reason: `RSI uyumsuzluğu: ${rsi[p1].toFixed(0)}→${rsi[p2].toFixed(0)}` }
}

export interface LiquiditySweepAbsorptionResult {
  detected: boolean
  priorLow: number
  currentLow: number
  lowerWickRatio: number
  reasons: string[]
  liquidationConfirmed?: boolean
  longLiquidationUsdt?: number
  liquidationCount?: number
}

/**
 * Emilim (Absorption) ve Alt Fitil (Wick) Teyidi (SFP - Swing Failure Pattern):
 * Son lookback (örn. 16 mum = 4 saat) periyodun en düşüğünün (Low) altına iğne atıp,
 * 15m mum kapanışını tekrar o seviyenin ÜZERİNDE yapması (SFP).
 * Alt fitil boyunun toplam mum boyunun en az %45'i olması zorunludur.
 * 
 * Mikro-Yapı Likidasyon Teyidi:
 * Sadece fitile bakmak sahte diplere yakalanmaya yol açar.
 * <symbol>@forceOrder üzerinden o dip iğnesinde gerçekten zorunlu long likidasyonlarının
 * (panik/tasfiye satışlarının) patlayıp emildiği teyit edilir.
 */
export function detectLiquiditySweepAbsorption(
  candles: Candle[],
  lookback = 16,
  liquidationConfirmation?: {
    longLiquidationUsdt: number
    liquidationCount: number
    requireLiquidation?: boolean
    minLiquidationUsdt?: number
  }
): LiquiditySweepAbsorptionResult {
  if (candles.length < lookback + 1) {
    return { detected: false, priorLow: 0, currentLow: 0, lowerWickRatio: 0, reasons: [] }
  }

  const cur = candles[candles.length - 1]
  const priorCandles = candles.slice(-lookback - 1, -1)
  const priorLow = Math.min(...priorCandles.map((c) => c.l))

  const range = cur.h - cur.l
  if (range <= 0) {
    return { detected: false, priorLow, currentLow: cur.l, lowerWickRatio: 0, reasons: [] }
  }

  const lowerWick = Math.min(cur.o, cur.c) - cur.l
  const lowerWickRatio = lowerWick / range

  // Şart 1: İğne eski dip seviyesinin altına inmiş olmalı (likidite süpürmesi)
  const sweptBelow = cur.l < priorLow
  // Şart 2: Mum kapanışı eski dip seviyesinin ÜZERİNDE gerçekleşmeli (boğa emilimi / SFP)
  const closedAbove = cur.c > priorLow
  // Şart 3: Alt fitil boyu toplam mum boyunun en az %45'i olmalı (alıcı tepkisi)
  const strongWick = lowerWickRatio >= 0.45
  // Şart 4: Alıcı tepkisini teyit eden yeşil kapanış veya doji dönüşü
  const bullishBody = cur.c >= cur.o || (cur.o - cur.c) / range <= 0.20

  let detected = sweptBelow && closedAbove && strongWick && bullishBody

  const reasons: string[] = []
  if (detected) {
    reasons.push(`SFP Likidite Süpürmesi (${priorLow.toFixed(4)} altı iğne, üstü kapanış)`)
    reasons.push(`Güçlü Alt Fitil (%${(lowerWickRatio * 100).toFixed(0)} >= %45)`)
  }

  let liquidationConfirmed = false
  if (liquidationConfirmation) {
    const minLiq = liquidationConfirmation.minLiquidationUsdt ?? 500
    const hasFlush = liquidationConfirmation.longLiquidationUsdt >= minLiq || liquidationConfirmation.liquidationCount >= 1
    liquidationConfirmed = hasFlush

    if (hasFlush) {
      reasons.push(`🔥 Zorunlu Long Tasfiye Emilimi Teyit Edildi ($${liquidationConfirmation.longLiquidationUsdt.toFixed(0)} hacim, ${liquidationConfirmation.liquidationCount} adet forceOrder)`)
    } else if (liquidationConfirmation.requireLiquidation) {
      detected = false
      reasons.push("🛑 Sahte Dip Uyarısı: Alt fitilde zorunlu long tasfiyesi patlamadı/emilmedi")
    }
  }

  return {
    detected,
    priorLow,
    currentLow: cur.l,
    lowerWickRatio,
    reasons,
    liquidationConfirmed,
    longLiquidationUsdt: liquidationConfirmation?.longLiquidationUsdt,
    liquidationCount: liquidationConfirmation?.liquidationCount,
  }
}

export interface CvdDivergenceResult {
  detected: boolean
  reasons: string[]
  deltaImprovement: number
}

/**
 * CVD (Kümülatif Hacim Deltası) ve Taker Hacim Pozitif Uyumsuzluğu:
 * Fiyat yeni bir dip (Lower Low) yaparken, Taker Buy hacminin veya CVD'nin
 * bir önceki dibe göre daha yüksek kalması (Higher Low).
 * Balinaların pasif limit alımlarla satışı emdiğini kanıtlar.
 */
export function detectCvdDivergence(
  candles: Candle[],
  takerRatios: number[]
): CvdDivergenceResult {
  if (candles.length < 8 || takerRatios.length < 8) {
    return { detected: false, reasons: [], deltaImprovement: 0 }
  }

  const curIdx = candles.length - 1
  const prevIdx = candles.length - 4

  const curLow = candles[curIdx].l
  const prevLow = Math.min(...candles.slice(prevIdx - 2, prevIdx + 1).map((c) => c.l))

  const curTaker = takerRatios[curIdx] || 50
  const prevTaker = takerRatios[prevIdx] || 50

  // Fiyat daha düşük dip yaparken alıcı baskısı (Taker Buy oranı) daha yüksek kalmışsa
  const priceLowerLow = curLow < prevLow
  const takerHigherLow = curTaker >= prevTaker + 2.5 // En az %2.5 daha güçlü alıcı emilimi

  if (priceLowerLow && takerHigherLow && curTaker >= 51.0) {
    return {
      detected: true,
      deltaImprovement: curTaker - prevTaker,
      reasons: [
        `CVD / Hacim Deltası Pozitif Uyumsuzluğu (Fiyat Dip, Alıcı Oranı %${prevTaker.toFixed(0)} → %${curTaker.toFixed(0)})`,
      ],
    }
  }

  return { detected: false, reasons: [], deltaImprovement: 0 }
}

export interface DynamicAtrRiskSizing {
  atrValue: number
  stopLossDistancePct: number
  stopLossPrice: number
  positionSizeUsdt: number
  targetRiskUsdt: number
  recommendedLeverage: number
}

/**
 * Dinamik ATR Stop ve Sabit Parasal Risk Boyutlandırma:
 * - 15m ATR(14) değerinin 1.8 - 2.2 katı dinamik stop mesafesi.
 * - Sabit parasal risk: Kasanın kaybettiği net dolar miktarı her işlemde sabit kalır.
 *   Volatilite yüksek -> Stop açılır -> Pozisyon boyutu otomatik küçülür.
 *   Volatilite düşük -> Stop daralır -> Pozisyon boyutu büyür.
 */
export function calculateDynamicAtrSizing(params: {
  curPrice: number
  atr14: number
  equityUsdt: number
  riskPctPerTrade?: number // Varsayılan %1.5 - %2.0
  atrMultiplier?: number // Varsayılan 2.0x (1.8x - 2.2x aralığı)
  minPositionUsdt?: number
  maxPositionUsdt?: number
  maxLeverageCap?: number
}): DynamicAtrRiskSizing {
  const {
    curPrice,
    atr14,
    equityUsdt,
    riskPctPerTrade = 2.0,
    atrMultiplier = 2.0,
    minPositionUsdt = 0.35,
    maxPositionUsdt = 20.0,
    maxLeverageCap = 10,
  } = params

  const safePrice = Math.max(0.00000001, curPrice)
  const safeAtr = Math.max(safePrice * 0.01, atr14)

  // 1.8x - 2.2x ATR stop mesafesi
  const rawStopDist = safeAtr * atrMultiplier
  let stopLossDistancePct = (rawStopDist / safePrice) * 100
  // Güvenlik sınırları: Asgari %2.0, azami %8.0
  stopLossDistancePct = Math.max(2.0, Math.min(8.0, stopLossDistancePct))

  const stopLossPrice = safePrice * (1 - stopLossDistancePct / 100)

  // Sabit Dolar Riski: Toplam cüzdanın %2'si (asgari 0.05 USDT)
  const targetRiskUsdt = Math.max(0.05, equityUsdt * (riskPctPerTrade / 100))

  // Pozisyon Büyüklüğü = Hedef Dolar Riski / Stop Mesafesi Yüzdesi
  let positionSizeUsdt = targetRiskUsdt / (stopLossDistancePct / 100)

  // Sınırlandırma
  positionSizeUsdt = Math.max(minPositionUsdt, Math.min(maxPositionUsdt, positionSizeUsdt))

  // Tavsiye edilen izole kaldıraç: İzole marjin tasfiyesinin stop mesafesinden en az %2.5 uzakta kalmasını garanti eder
  const recommendedLeverage = Math.min(maxLeverageCap, Math.floor(100 / (stopLossDistancePct + 2.5)))

  return {
    atrValue: safeAtr,
    stopLossDistancePct: Number(stopLossDistancePct.toFixed(2)),
    stopLossPrice: Number(stopLossPrice.toFixed(6)),
    positionSizeUsdt: Number(positionSizeUsdt.toFixed(2)),
    targetRiskUsdt: Number(targetRiskUsdt.toFixed(3)),
    recommendedLeverage: Math.max(2, Math.min(maxLeverageCap, recommendedLeverage)),
  }
}

export interface DynamicRExitTargets {
  tp1Pct: number
  tp2Pct: number
  trailingActivationPct: number
  trailingPullbackPct: number
  stopLossDistancePct: number
  atrPct: number
}

/**
 * Dinamik R (Risk Katı) ve ATR Çıkış Seviyeleri:
 * - 1R = Dinamik Stop-Loss Mesafesi (Yüzde)
 * - TP1 = 1.2R (Asgari 1.2:1 Risk-Ödül Oranı, örn. Stop %3.5 -> TP1 +%4.2, Stop %5.0 -> TP1 +%6.0)
 * - TP2 = 2.5R (Runner pozisyon kâr hedefi)
 * - Trailing Başlangıç = 1.5R (+1.5R kâr görüldükten sonra takip stopu devreye girer)
 * - Trailing Geri Çekilme = 0.8 x ATR (%) (Sert çöküş volatilitesinde erken stop ettirmez, piyasa gürültüsüne nefes payı bırakır)
 */
export function calculateDynamicRExits(
  stopLossDistancePct: number,
  atrPct?: number,
  atrMultiplier = 2.0
): DynamicRExitTargets {
  const safeStop = Math.max(1.5, stopLossDistancePct)
  const safeAtrPct = atrPct && atrPct > 0 ? atrPct : safeStop / atrMultiplier
  const oneR = safeStop

  const tp1Pct = Number((oneR * 1.2).toFixed(2))
  const tp2Pct = Number((oneR * 2.5).toFixed(2))
  const trailingActivationPct = Number((oneR * 1.5).toFixed(2))
  const trailingPullbackPct = Number(Math.max(0.60, safeAtrPct * 0.8).toFixed(2))

  return {
    tp1Pct,
    tp2Pct,
    trailingActivationPct,
    trailingPullbackPct,
    stopLossDistancePct: safeStop,
    atrPct: safeAtrPct,
  }
}

export interface MonotonicStopEvaluation {
  newStopPrice: number
  stopStage: "INITIAL" | "BREAKEVEN" | "TP1_LOCKED" | "TRAILING"
  stageReason: string
}

/**
 * Monotonik R-Bazlı Stop Motoru:
 * - newStop = max(currentStop, candidateStop)
 * - Fiyat >= +0.8R: stopu başabaş (entryPrice * 1.002, borsa komisyonu dahil) seviyesine çek.
 * - TP1 (+1.2R) vurulduğunda: stopu +0.5R kâr seviyesine kilitle (asla başabaşa geri düşmez!).
 * - Fiyat >= +1.5R: 0.8 x ATR (%) takipçi stopunu devreye al.
 * - Kural: Stop seviyesi ASLA geriye / aşağıya çekilemez.
 */
export function calculateMonotonicStopTarget(params: {
  entryPrice: number
  highestPrice: number
  currentPrice: number
  stopLossDistancePct: number
  atrPct?: number
  isTp1Taken?: boolean
  currentStopPrice?: number
}): MonotonicStopEvaluation {
  const {
    entryPrice,
    highestPrice,
    currentPrice,
    stopLossDistancePct,
    atrPct,
    isTp1Taken = false,
    currentStopPrice = 0,
  } = params

  const safeEntry = Math.max(0.00000001, entryPrice)
  const oneRPct = Math.max(1.5, stopLossDistancePct)
  const oneRValue = (oneRPct / 100) * safeEntry
  const peakPrice = Math.max(highestPrice, currentPrice, safeEntry)
  const peakGainPct = ((peakPrice - safeEntry) / safeEntry) * 100

  // 1. Başlangıç Stopu: Entry - 1R
  let candidateStop = safeEntry * (1 - oneRPct / 100)
  let stage: MonotonicStopEvaluation["stopStage"] = "INITIAL"
  let reason = `Başlangıç 1R Stopu (-%${oneRPct.toFixed(2)})`

  // 2. Fiyat >= +0.8R gördüğünde: Başabaş stopu (+ komisyon tamponu: entry * 1.002)
  if (peakGainPct >= oneRPct * 0.8) {
    const beStop = safeEntry * 1.002
    if (beStop > candidateStop) {
      candidateStop = beStop
      stage = "BREAKEVEN"
      reason = `+0.8R Kâr Görüldü -> Başabaş Güvence Stopu (Giriş * 1.002)`
    }
  }

  // 3. TP1 (+1.2R) vurulduğunda: Stopu +0.5R kâra kilitle (asla başabaşa geri düşmez)
  if (isTp1Taken || peakGainPct >= oneRPct * 1.2) {
    const tp1LockedStop = safeEntry + (0.5 * oneRValue)
    if (tp1LockedStop > candidateStop) {
      candidateStop = tp1LockedStop
      stage = "TP1_LOCKED"
      reason = `TP1 (+1.2R) Gerçekleşti -> Kâr +0.5R Seviyesine Kilitlendi`
    }
  }

  // 4. Fiyat >= +1.5R olduğunda: Dinamik 0.8 x ATR Takipçi Stop
  if (peakGainPct >= oneRPct * 1.5) {
    const safeAtrPct = atrPct && atrPct > 0 ? atrPct : oneRPct / 2.0
    const trailingPullbackPct = Math.max(0.60, safeAtrPct * 0.8)
    const trailingStop = peakPrice * (1 - trailingPullbackPct / 100)
    if (trailingStop > candidateStop) {
      candidateStop = trailingStop
      stage = "TRAILING"
      reason = `+1.5R Zirve Takibi -> 0.8x ATR Takipçi Stop (-%${trailingPullbackPct.toFixed(2)} geri çekilme payı)`
    }
  }

  // MONOTONİK KURAL: newStop = max(currentStop, candidateStop)
  // Stop seviyesi ASLA geriye / aşağıya doğru çekilemez!
  let finalStopPrice = candidateStop
  let finalStage = stage
  let finalReason = reason

  if (currentStopPrice > candidateStop) {
    finalStopPrice = currentStopPrice
    finalReason = `Mevcut Stop Korundu ($${currentStopPrice})`
  }

  const formattedStop = finalStopPrice < 0.001 
    ? Number(finalStopPrice.toFixed(8))
    : finalStopPrice < 1
    ? Number(finalStopPrice.toFixed(6))
    : Number(finalStopPrice.toFixed(4))

  return {
    newStopPrice: formattedStop,
    stopStage: finalStage,
    stageReason: finalReason,
  }
}

export interface VwapSlippageResult {
  vwapPrice: number
  bestAskPrice: number
  slippagePct: number
  totalAvailableNotional: number
  acceptable: boolean
  reason?: string
}

/**
 * VWAP Kayma (Slippage) Simülasyonu:
 * Emir defterinin ilk 10-15 kademesindeki derinliği tarayarak hesaplanan
 * notional tutar için ağırlıklı ortalama gerçekleşme fiyatını hesaplar.
 * slippagePct = ((vwapPrice - bestAsk) / bestAsk) * 100
 * Kural: slippagePct < %0.10 olmalıdır.
 */
export function simulateVwapSlippage(
  asks: Array<[string | number, string | number]>,
  targetNotionalUsdt: number
): VwapSlippageResult {
  if (!Array.isArray(asks) || asks.length === 0) {
    return {
      vwapPrice: 0,
      bestAskPrice: 0,
      slippagePct: 999,
      totalAvailableNotional: 0,
      acceptable: false,
      reason: "Emir defteri derinliği boş veya okunamadı.",
    }
  }

  const bestAsk = parseFloat(String(asks[0][0])) || 0
  if (bestAsk <= 0) {
    return {
      vwapPrice: 0,
      bestAskPrice: 0,
      slippagePct: 999,
      totalAvailableNotional: 0,
      acceptable: false,
      reason: "En iyi satış fiyatı geçersiz (0 veya negatif).",
    }
  }

  let remainingNotional = targetNotionalUsdt
  let totalCost = 0
  let totalQty = 0
  let totalAvailableNotional = 0

  const depthLimit = Math.min(15, asks.length)
  for (let i = 0; i < depthLimit; i++) {
    const price = parseFloat(String(asks[i][0])) || 0
    const qty = parseFloat(String(asks[i][1])) || 0
    if (price <= 0 || qty <= 0) continue

    const levelNotional = price * qty
    totalAvailableNotional += levelNotional

    if (remainingNotional > 0) {
      if (levelNotional >= remainingNotional) {
        const fillQty = remainingNotional / price
        totalCost += remainingNotional
        totalQty += fillQty
        remainingNotional = 0
      } else {
        totalCost += levelNotional
        totalQty += qty
        remainingNotional -= levelNotional
      }
    }
  }

  if (remainingNotional > 0 && totalQty > 0) {
    return {
      vwapPrice: totalCost / totalQty,
      bestAskPrice: bestAsk,
      slippagePct: 999,
      totalAvailableNotional,
      acceptable: false,
      reason: `Tahtada yeterli likidite yok: ${totalAvailableNotional.toFixed(2)}$ < ${targetNotionalUsdt.toFixed(2)}$`,
    }
  }

  const vwapPrice = totalQty > 0 ? totalCost / totalQty : bestAsk
  const slippagePct = bestAsk > 0 ? ((vwapPrice - bestAsk) / bestAsk) * 100 : 0
  const acceptable = slippagePct < 0.10

  return {
    vwapPrice: Number(vwapPrice.toFixed(6)),
    bestAskPrice: bestAsk,
    slippagePct: Number(slippagePct.toFixed(4)),
    totalAvailableNotional: Number(totalAvailableNotional.toFixed(2)),
    acceptable,
    reason: acceptable
      ? `VWAP Kayması kabul edilebilir: %${slippagePct.toFixed(3)} < %0.10`
      : `Aşırı kayma riski: VWAP Kayması %${slippagePct.toFixed(3)} >= %0.10`,
  }
}

export interface OrderBookImbalanceResult {
  obi: number
  microprice: number
  midPrice: number
  bidVol: number
  askVol: number
  passGate: boolean // OBI > minThreshold (+0.20)
  reason: string
}

/**
 * Microprice:
 * P_micro = (Ask1 * BidVol1 + Bid1 * AskVol1) / (BidVol1 + AskVol1)
 * İlk kademedeki alış ve satış likiditesinin ters ağırlıklı adil fiyatıdır.
 */
export function calculateMicroprice(
  bestBid: number,
  bidQty: number,
  bestAsk: number,
  askQty: number
): number {
  const bidVol = bestBid * bidQty
  const askVol = bestAsk * askQty
  const total = bidVol + askVol
  if (total <= 0) {
    return bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 0
  }
  return Number(((bestAsk * bidVol + bestBid * askVol) / total).toFixed(6))
}

/**
 * Emir Defteri Dengesizliği (OBI) & Microprice:
 * İlk 5 kademenin hacim ağırlıklı dengesine bakar:
 * OBI = (BidVol - AskVol) / (BidVol + AskVol)
 * 
 * Giriş anında tam satış duvarına çarpmamak için OBI > +0.20 şartı aranır.
 * Microprice: İlk kademe likidite ağırlıklı adil fiyat.
 */
export function calculateOrderBookImbalance(
  bids: Array<[string | number, string | number]>,
  asks: Array<[string | number, string | number]>,
  levels = 5,
  minThreshold = 0.20
): OrderBookImbalanceResult {
  if (!Array.isArray(bids) || !Array.isArray(asks) || bids.length === 0 || asks.length === 0) {
    return {
      obi: 0,
      microprice: 0,
      midPrice: 0,
      bidVol: 0,
      askVol: 0,
      passGate: false,
      reason: "Emir defteri derinliği boş veya okunamadı.",
    }
  }

  const n = Math.min(levels, bids.length, asks.length)
  let bidVol = 0
  let askVol = 0

  for (let i = 0; i < n; i++) {
    const bPrice = parseFloat(String(bids[i][0])) || 0
    const bQty = parseFloat(String(bids[i][1])) || 0
    const aPrice = parseFloat(String(asks[i][0])) || 0
    const aQty = parseFloat(String(asks[i][1])) || 0

    bidVol += bPrice * bQty
    askVol += aPrice * aQty
  }

  const totalVol = bidVol + askVol
  const rawObi = totalVol > 0 ? (bidVol - askVol) / totalVol : 0
  const obi = Number(rawObi.toFixed(4))

  // Microprice: P_micro = (Ask1 * BidVol1 + Bid1 * AskVol1) / (BidVol1 + AskVol1)
  const bestBid = parseFloat(String(bids[0][0])) || 0
  const bestAsk = parseFloat(String(asks[0][0])) || 0
  const bestBidQty = parseFloat(String(bids[0][1])) || 0
  const bestAskQty = parseFloat(String(asks[0][1])) || 0
  const microprice = calculateMicroprice(bestBid, bestBidQty, bestAsk, bestAskQty)
  const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk

  const passGate = obi > minThreshold
  const reason = passGate
    ? `OBI Alıcı Baskısı: +${(obi * 100).toFixed(1)}% > +${(minThreshold * 100).toFixed(0)}% (Satış Duvarı Yok)`
    : `Satış Duvarı Riski: OBI ${(obi * 100).toFixed(1)}% <= +${(minThreshold * 100).toFixed(0)}% (Yetersiz Alıcı Derinliği)`

  return {
    obi,
    microprice: Number(microprice.toFixed(6)),
    midPrice: Number(midPrice.toFixed(6)),
    bidVol: Number(bidVol.toFixed(2)),
    askVol: Number(askVol.toFixed(2)),
    passGate,
    reason,
  }
}

export type SmartMoneyQuadrant =
  | "INSTITUTIONAL_LONG"       // Fiyat ↑ + CVD ↑ + OI ↑ (Gerçek kurumsal long girişi)
  | "SHORT_COVERING"          // Fiyat ↑ + CVD ↑ + OI ↓ (Short kapama rallisi - çabuk söner)
  | "INSTITUTIONAL_SHORT"      // Fiyat ↓ + CVD ↓ + OI ↑ (Kurumsal short girişi)
  | "LONG_LIQUIDATION_FLUSH"   // Fiyat ↓ + CVD ↓ + OI ↓ (Long tasfiye boşalması)
  | "NEUTRAL"

export interface SmartMoneyMatrixResult {
  quadrant: SmartMoneyQuadrant
  tp1Ratio: number // 0.50 (standart) veya 0.75 (short kapamada %75 kâr al)
  isShortCovering: boolean
  isInstitutionalLong: boolean
  description: string
  reasons: string[]
  scoreModifier: number
}

/**
 * Open Interest (OI) + CVD 4 Kadranlı Akıllı Para Matrisi:
 * - Fiyat ↑ + CVD ↑ + OI ↑: Gerçek kurumsal long girişi (Trend devamı, TP1 %50 sat, %50 runner).
 * - Fiyat ↑ + CVD ↑ + OI ↓: Short Kapama (Short Covering) rallisi (Çabuk söner — TP1'de %50 yerine %75 kâr al!).
 * - Fiyat ↓ + CVD ↓ + OI ↑: Kurumsal short girişi (Düşüş trendi kuvvetli, long vetosu).
 * - Fiyat ↓ + CVD ↓ + OI ↓: Long Tasfiye Boşalması (Panik satışlar, SFP için potansiyel zemin).
 */
export function evaluateSmartMoneyMatrix(params: {
  priceChangePct: number // % (örn. +0.5%)
  cvdDeltaPct: number    // % (örn. +1.5% veya takerBuyRatio - 50)
  oiChangePct: number    // % (örn. +1.2% veya -0.8%)
  oiThresholdPct?: number
  deltaThresholdPct?: number
}): SmartMoneyMatrixResult {
  const {
    priceChangePct,
    cvdDeltaPct,
    oiChangePct,
    oiThresholdPct = 0.15,
    deltaThresholdPct = 0.40,
  } = params

  const isPriceUp = priceChangePct > 0.05
  const isPriceDown = priceChangePct < -0.05
  const isCvdUp = cvdDeltaPct > deltaThresholdPct
  const isCvdDown = cvdDeltaPct < -deltaThresholdPct
  const isOiUp = oiChangePct > oiThresholdPct
  const isOiDown = oiChangePct < -oiThresholdPct

  let quadrant: SmartMoneyQuadrant = "NEUTRAL"
  let tp1Ratio = 0.50
  let isShortCovering = false
  let isInstitutionalLong = false
  let scoreModifier = 0
  let description = "Dengeli Piyasa Dinamiği (Nötr Kadran)"
  const reasons: string[] = []

  // 1. Kadran: Fiyat ↑ + CVD ↑ + OI ↑ (Gerçek Kurumsal Long Girişi)
  if (isPriceUp && isCvdUp && isOiUp) {
    quadrant = "INSTITUTIONAL_LONG"
    isInstitutionalLong = true
    tp1Ratio = 0.50
    scoreModifier = +25
    description = `Gerçek Kurumsal Long Girişi (Fiyat +%${priceChangePct.toFixed(2)}, CVD +%${cvdDeltaPct.toFixed(1)}, OI +%${oiChangePct.toFixed(2)})`
    reasons.push("4 Kadran Akıllı Para: Gerçek Kurumsal Long Akışı (Fiyat ↑ + CVD ↑ + OI ↑)")
  }
  // 2. Kadran: Fiyat ↑ + CVD ↑ + OI ↓ (Short Kapama Rallisi — Çabuk Söner!)
  else if (isPriceUp && isCvdUp && isOiDown) {
    quadrant = "SHORT_COVERING"
    isShortCovering = true
    tp1Ratio = 0.75 // Short kapama çabuk söner -> TP1'de %50 yerine %75 kâr al!
    scoreModifier = +15
    description = `Short Kapama Rallisi (Fiyat +%${priceChangePct.toFixed(2)}, CVD +%${cvdDeltaPct.toFixed(1)}, OI -%${Math.abs(oiChangePct).toFixed(2)})`
    reasons.push("4 Kadran Akıllı Para: Short Kapama / Squeeze Rallisi (Fiyat ↑ + CVD ↑ + OI ↓ — TP1'de %75 Kâr Al)")
  }
  // 3. Kadran: Fiyat ↓ + CVD ↓ + OI ↑ (Kurumsal Short Girişi)
  else if (isPriceDown && isCvdDown && isOiUp) {
    quadrant = "INSTITUTIONAL_SHORT"
    tp1Ratio = 0.50
    scoreModifier = -30
    description = `Kurumsal Short Girişi (Fiyat -%${Math.abs(priceChangePct).toFixed(2)}, CVD -%${Math.abs(cvdDeltaPct).toFixed(1)}, OI +%${oiChangePct.toFixed(2)})`
    reasons.push("4 Kadran Akıllı Para: Kurumsal Short Baskısı (Fiyat ↓ + CVD ↓ + OI ↑)")
  }
  // 4. Kadran: Fiyat ↓ + CVD ↓ + OI ↓ (Long Tasfiyesi / Boşalma)
  else if (isPriceDown && isCvdDown && isOiDown) {
    quadrant = "LONG_LIQUIDATION_FLUSH"
    tp1Ratio = 0.50
    scoreModifier = +10
    description = `Long Tasfiye Boşalması (Fiyat -%${Math.abs(priceChangePct).toFixed(2)}, CVD -%${Math.abs(cvdDeltaPct).toFixed(1)}, OI -%${Math.abs(oiChangePct).toFixed(2)})`
    reasons.push("4 Kadran Akıllı Para: Long Tasfiyeleri Boşaldı (Fiyat ↓ + CVD ↓ + OI ↓ — Olası SFP Dip Zemini)")
  }

  return {
    quadrant,
    tp1Ratio,
    isShortCovering,
    isInstitutionalLong,
    description,
    reasons,
    scoreModifier,
  }
}

