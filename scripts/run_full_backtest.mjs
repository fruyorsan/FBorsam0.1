import fs from "fs"

// ==========================================
// BACKTEST CONFIGURATION
// ==========================================
// Multi-coin basket across 30 days (15m candles = 2880 candles per coin)
const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "NEARUSDT", "SUIUSDT", "AVAXUSDT", "LINKUSDT"
]

const LIMIT_PER_REQ = 1000
const TOTAL_CANDLES = 2880 // ~30 days of 15m candles
const FEE_ROUNDTRIP_PCT = 0.08 // 0.04% entry + 0.04% exit
const SLIPPAGE_PCT = 0.04 // 0.02% entry + 0.02% exit

async function fetchHistoricalKlines(symbol, totalCount) {
  let allKlines = []
  let endTime = Date.now()

  while (allKlines.length < totalCount) {
    const fetchLimit = Math.min(LIMIT_PER_REQ, totalCount - allKlines.length)
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=${fetchLimit}&endTime=${endTime}`
    try {
      const res = await fetch(url)
      if (!res.ok) break
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) break
      const formatted = data.map(d => ({
        time: d[0],
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5]),
        quoteVolume: parseFloat(d[7]),
        takerBuyQuoteVolume: parseFloat(d[10])
      }))
      allKlines = [...formatted, ...allKlines]
      endTime = data[0][0] - 1
      await new Promise(r => setTimeout(r, 80))
    } catch (e) {
      console.error(`Error fetching ${symbol}:`, e.message)
      break
    }
  }
  // Deduplicate and sort
  const map = new Map()
  for (const k of allKlines) map.set(k.time, k)
  return Array.from(map.values()).sort((a, b) => a.time - b.time)
}

function calcRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(50)
  if (closes.length <= period) return rsi

  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)))

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)))
  }
  return rsi
}

// ==========================================
// SIMULATE ENGINE FOR GIVEN EXIT RULES
// ==========================================
function runBacktest(allMarketData, exitRuleMode = "CURRENT") {
  // exitRuleMode: "CURRENT" vs "NEW"
  const coinList = Object.keys(allMarketData)
  const minLen = Math.min(...coinList.map(s => allMarketData[s].length))
  
  const MAX_SLOTS = 2 // max concurrent positions cap
  const POSITION_SIZE_USDT = 50 // cap 50 USDT
  const LEVERAGE = 5 // standard leverage

  let activePositions = [] // { symbol, entryPrice, entryBar, entryTime, highestPrice, passedProfitLock }
  const closedTrades = []

  for (let i = 35; i < minLen; i++) {
    // 1. UPDATE & CHECK EXITS ON ACTIVE POSITIONS
    const remainingPositions = []
    for (const pos of activePositions) {
      const candle = allMarketData[pos.symbol][i]
      pos.highestPrice = Math.max(pos.highestPrice, candle.high)

      const rawDiffHigh = ((candle.high - pos.entryPrice) / pos.entryPrice) * 100
      const rawDiffLow = ((candle.low - pos.entryPrice) / pos.entryPrice) * 100
      const rawDiffClose = ((candle.close - pos.entryPrice) / pos.entryPrice) * 100
      const peakPriceGainPct = ((pos.highestPrice - pos.entryPrice) / pos.entryPrice) * 100

      let exited = false
      let exitPrice = candle.close
      let exitReason = ""

      if (exitRuleMode === "CURRENT") {
        // Mevcut Çıkış Kuralları:
        // - SL: fiyatta -%3.5
        // - TP1: fiyatta +%5.0 (%50 split veya full)
        // - Profit lock stop: Fiyat +%1.5'i geçtikten sonra geri çekilmede +%1.5
        // - Trailing stop: Zirve +%2.8 gördükten sonra zirveden %0.85 düşüş
        if (peakPriceGainPct >= 1.5) {
          pos.passedProfitLock = true
        }

        // Kötümserlik: Hem SL (-3.5%) hem TP (+5.0%) değdiyse önce SL say
        if (rawDiffLow <= -3.5 && !pos.passedProfitLock) {
          exited = true
          exitPrice = pos.entryPrice * (1 - 0.035)
          exitReason = "STOP_LOSS"
        } else if (pos.passedProfitLock && rawDiffLow <= 1.5) {
          exited = true
          exitPrice = pos.entryPrice * (1 + 0.015)
          exitReason = "PROFIT_LOCK_STOP"
        } else if (peakPriceGainPct >= 2.8 && rawDiffLow <= (peakPriceGainPct - 0.85)) {
          exited = true
          exitPrice = pos.entryPrice * (1 + (peakPriceGainPct - 0.85) / 100)
          exitReason = "TRAILING_STOP"
        } else if (rawDiffHigh >= 5.0) {
          exited = true
          exitPrice = pos.entryPrice * (1 + 0.05)
          exitReason = "TAKE_PROFIT"
        } else if ((i - pos.entryBar) >= 24 && rawDiffClose >= 0.8) {
          // Stale exit: 6 saat yatay
          exited = true
          exitPrice = candle.close
          exitReason = "TIME_ROTATION"
        }
      } else {
        // YENİ ÇIKIŞ KURALI (useNewExitRules):
        // - Fiyat +%2.5 olunca stop başabaşa (giriş + komisyon) çekilir.
        // - Zirveden %1.5 geride trailing stop.
        // - Full TP: +%8.0. Full SL: -%3.5.
        // - Aynı mumda TP ve SL değerse KÖTÜMSER (önce SL).
        const hasPassed2Point5 = peakPriceGainPct >= 2.5
        const bePricePct = FEE_ROUNDTRIP_PCT // +0.08%

        if (rawDiffLow <= -3.5) {
          exited = true
          exitPrice = pos.entryPrice * (1 - 0.035)
          exitReason = "STOP_LOSS"
        } else if (rawDiffHigh >= 8.0) {
          // Eğer aynı mumda low <= -3.5 olsaydı yukarıdaki if yakalardı (kötümser varsayım sağlandı)
          exited = true
          exitPrice = pos.entryPrice * (1 + 0.08)
          exitReason = "TAKE_PROFIT_8PCT"
        } else if (hasPassed2Point5 && rawDiffLow <= (peakPriceGainPct - 1.5)) {
          exited = true
          const trailPct = Math.max(bePricePct, peakPriceGainPct - 1.5)
          exitPrice = pos.entryPrice * (1 + trailPct / 100)
          exitReason = "NEW_TRAILING_STOP"
        } else if (hasPassed2Point5 && rawDiffLow <= bePricePct) {
          exited = true
          exitPrice = pos.entryPrice * (1 + bePricePct / 100)
          exitReason = "BREAKEVEN_STOP"
        }
      }

      if (exited) {
        // Net ROI ve USDT PnL hesabı (komisyon ve kayma dahil)
        const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100
        const totalCostPct = FEE_ROUNDTRIP_PCT + SLIPPAGE_PCT
        const netReturnPct = grossReturnPct - totalCostPct
        const leveragedRoiPct = netReturnPct * LEVERAGE
        const marginUsdt = POSITION_SIZE_USDT / LEVERAGE
        const netPnlUsdt = (marginUsdt * leveragedRoiPct) / 100

        closedTrades.push({
          symbol: pos.symbol,
          entryTime: new Date(pos.entryTime).toISOString(),
          exitTime: new Date(candle.time).toISOString(),
          entryPrice: pos.entryPrice,
          exitPrice,
          exitReason,
          grossReturnPct,
          netReturnPct,
          leveragedRoiPct,
          netPnlUsdt,
          durationBars: i - pos.entryBar
        })
      } else {
        remainingPositions.push(pos)
      }
    }
    activePositions = remainingPositions

    // 2. ENTRY SIGNALS SCAN
    if (activePositions.length >= MAX_SLOTS) continue

    for (const sym of coinList) {
      if (activePositions.length >= MAX_SLOTS) break
      if (activePositions.some(p => p.symbol === sym)) continue

      const klines = allMarketData[sym].slice(0, i + 1)
      const curCandle = klines[klines.length - 1]
      const prevCandle = klines[klines.length - 2]

      const closes = klines.map(k => k.close)
      const rsiArr = calcRSI(closes, 14)
      const curRsi = rsiArr[rsiArr.length - 1]

      // Sinyal Kuralları (Mevcut Botun Giriş Şartları):
      // - 15m RSI <= 42 (Dip dönüşü) veya RSI 42-60 arası momentum
      // - Son mum yeşil
      // - Hacim ortalamanın üzerinde
      const past20Vols = klines.slice(-21, -1).map(k => k.quoteVolume)
      const avgVol = past20Vols.reduce((a, b) => a + b, 0) / (past20Vols.length || 1)
      const volRatio = avgVol > 0 ? curCandle.quoteVolume / avgVol : 1
      const isGreen = curCandle.close >= curCandle.open

      const isSignal = (curRsi <= 42 && isGreen && volRatio >= 1.1) ||
                       (curRsi > 42 && curRsi <= 62 && isGreen && volRatio >= 1.6)

      if (isSignal) {
        activePositions.push({
          symbol: sym,
          entryPrice: curCandle.close,
          entryBar: i,
          entryTime: curCandle.time,
          highestPrice: curCandle.close,
          passedProfitLock: false
        })
      }
    }
  }

  // Calculate Summary Statistics
  const n = closedTrades.length
  const wins = closedTrades.filter(t => t.netPnlUsdt > 0)
  const losses = closedTrades.filter(t => t.netPnlUsdt <= 0)
  const winRate = n > 0 ? (wins.length / n) * 100 : 0
  const totalNetPnlUsdt = closedTrades.reduce((sum, t) => sum + t.netPnlUsdt, 0)
  const avgNetPnlUsdt = n > 0 ? totalNetPnlUsdt / n : 0
  const avgRoiPct = n > 0 ? closedTrades.reduce((sum, t) => sum + t.leveragedRoiPct, 0) / n : 0

  const winMean = wins.length > 0 ? wins.reduce((s, t) => s + t.netPnlUsdt, 0) / wins.length : 0
  const lossMean = losses.length > 0 ? losses.reduce((s, t) => s + t.netPnlUsdt, 0) / losses.length : 0
  const profitFactor = Math.abs(lossMean) > 0 && losses.length > 0
    ? (wins.reduce((s, t) => s + t.netPnlUsdt, 0)) / Math.abs(losses.reduce((s, t) => s + t.netPnlUsdt, 0))
    : 0

  // Max Drawdown calculation (USDT equity curve)
  let peak = 0, currentEq = 0, maxDd = 0
  for (const t of closedTrades) {
    currentEq += t.netPnlUsdt
    if (currentEq > peak) peak = currentEq
    const dd = peak - currentEq
    if (dd > maxDd) maxDd = dd
  }

  // Exit reason breakdown
  const reasons = {}
  for (const t of closedTrades) {
    reasons[t.exitReason] = (reasons[t.exitReason] || 0) + 1
  }

  return {
    mode: exitRuleMode,
    sampleSize: n,
    wins: wins.length,
    losses: losses.length,
    winRate: winRate.toFixed(2) + "%",
    totalNetPnlUsdt: totalNetPnlUsdt.toFixed(2),
    avgNetPnlUsdt: avgNetPnlUsdt.toFixed(3),
    avgRoiPct: avgRoiPct.toFixed(2) + "%",
    winMeanUsdt: winMean.toFixed(3),
    lossMeanUsdt: lossMean.toFixed(3),
    profitFactor: profitFactor.toFixed(2),
    maxDrawdownUsdt: maxDd.toFixed(2),
    reasons,
    trades: closedTrades
  }
}

async function main() {
  console.log("📥 Binance Vadeli Piyasa Verileri Çekiliyor (10 Coin, 30 Gün, 15m Mumlar)...")
  const marketData = {}
  for (const sym of SYMBOLS) {
    process.stdout.write(`Fetching ${sym}... `)
    const klines = await fetchHistoricalKlines(sym, TOTAL_CANDLES)
    marketData[sym] = klines
    console.log(`Tamamlandı (${klines.length} mum).`)
  }

  console.log("\n⚙️ Backtest Çalıştırılıyor...")
  const baselineResults = runBacktest(marketData, "CURRENT")
  const newExitResults = runBacktest(marketData, "NEW")

  console.log("\n=======================================================")
  console.log("📊 BACKTEST SONUÇLARI KARŞILAŞTIRMASI")
  console.log("=======================================================")
  console.log(`Parametreler: Tavan 50 USDT notional, 5x kaldıraç, Maks 2 pozisyon`)
  console.log(`Maliyetler: Çift yönlü komisyon + gerçek kayma = %0.12 düşüldü`)
  console.log(`Aynı mum çakışması: Kötümser yaklaşım (Önce SL tetiklendi)\n`)

  const tableSummary = [
    {
      "Metrik": "Toplam İşlem Sayısı (N)",
      "Mevcut Çıkış Kuralları": baselineResults.sampleSize,
      "Yeni Çıkış Kuralları": newExitResults.sampleSize,
    },
    {
      "Metrik": "Kazanma Oranı (Win Rate)",
      "Mevcut Çıkış Kuralları": baselineResults.winRate,
      "Yeni Çıkış Kuralları": newExitResults.winRate,
    },
    {
      "Metrik": "Toplam Net PnL (USDT)",
      "Mevcut Çıkış Kuralları": baselineResults.totalNetPnlUsdt + " USDT",
      "Yeni Çıkış Kuralları": newExitResults.totalNetPnlUsdt + " USDT",
    },
    {
      "Metrik": "İşlem Başına Ort. Net PnL",
      "Mevcut Çıkış Kuralları": baselineResults.avgNetPnlUsdt + " USDT",
      "Yeni Çıkış Kuralları": newExitResults.avgNetPnlUsdt + " USDT",
    },
    {
      "Metrik": "Ortalama Kaldıraçlı ROI",
      "Mevcut Çıkış Kuralları": baselineResults.avgRoiPct,
      "Yeni Çıkış Kuralları": newExitResults.avgRoiPct,
    },
    {
      "Metrik": "Ortalama Kazanç (W)",
      "Mevcut Çıkış Kuralları": baselineResults.winMeanUsdt + " USDT",
      "Yeni Çıkış Kuralları": newExitResults.winMeanUsdt + " USDT",
    },
    {
      "Metrik": "Ortalama Kayıp (L)",
      "Mevcut Çıkış Kuralları": baselineResults.lossMeanUsdt + " USDT",
      "Yeni Çıkış Kuralları": newExitResults.lossMeanUsdt + " USDT",
    },
    {
      "Metrik": "Kâr Faktörü (Profit Factor)",
      "Mevcut Çıkış Kuralları": baselineResults.profitFactor,
      "Yeni Çıkış Kuralları": newExitResults.profitFactor,
    },
    {
      "Metrik": "Maksimum Düşüş (Max DD)",
      "Mevcut Çıkış Kuralları": baselineResults.maxDrawdownUsdt + " USDT",
      "Yeni Çıkış Kuralları": newExitResults.maxDrawdownUsdt + " USDT",
    }
  ]

  console.table(tableSummary)

  console.log("\n📌 Çıkış Nedenleri Dağılımı (Mevcut):", baselineResults.reasons)
  console.log("📌 Çıkış Nedenleri Dağılımı (Yeni):", newExitResults.reasons)

  fs.writeFileSync("backtest_full_results.json", JSON.stringify({
    summary: tableSummary,
    baseline: baselineResults,
    newExit: newExitResults
  }, null, 2))
  console.log("\n💾 Detaylı sonuçlar 'backtest_full_results.json' dosyasına kaydedildi.")
}

main().catch(console.error)
