import fs from "fs"

// ==========================================================
// 1. CONFIGURATION & VOLATILE ALTCOIN BASKET (USER'S TRADES)
// ==========================================================
const SYMBOLS = [
  "STRKUSDT", "TIAUSDT", "LUMIAUSDT", "INJUSDT", "SUIUSDT",
  "RENDERUSDT", "UNIUSDT", "NEARUSDT", "APTUSDT", "DOGEUSDT",
  "SOLUSDT", "ENAUSDT"
]

const LIMIT_PER_REQ = 1000
const TOTAL_CANDLES = 2880 // 30 days of 15m candles
const LEVERAGE = 10 // Requested: 10x leverage
const POSITION_SIZE_USDT = 50 // Cap: 50 USDT notional

// Separate costs:
const COMMISSION_PCT = 0.08 // 0.04% entry + 0.04% exit (Taker fee)
const SLIPPAGE_PCT = 0.04   // 0.02% entry + 0.02% exit (Market execution slippage)
const TOTAL_COST_PCT = COMMISSION_PCT + SLIPPAGE_PCT // 0.12%

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
      await new Promise(r => setTimeout(r, 60))
    } catch (e) {
      console.error(`Error fetching ${symbol}:`, e.message)
      break
    }
  }
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

// ==========================================================
// 2. SIMULATION ENGINE (NO SLOT LIMIT, SAME SIGNALS, 6H TIME EXIT ON BOTH)
// ==========================================================
function runBacktest(allMarketData, exitRuleMode = "CURRENT") {
  const coinList = Object.keys(allMarketData)
  const minLen = Math.min(...coinList.map(s => allMarketData[s].length))

  let activePositions = [] // No slot limit: tracks all open positions
  const closedTrades = []

  for (let i = 35; i < minLen; i++) {
    // A. UPDATE & CHECK EXITS ON ACTIVE POSITIONS
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
        // MEVCUT ÇIKIŞ KURALI:
        // - SL: -%3.5
        // - %1.5 Kâr Koruma Stopu (Zirve >= %1.5 olunca stop %1.5'e çekilir)
        // - Trailing: Zirve >= %2.8 olunca zirveden %0.85 düşüşte
        // - TP: +%5.0
        // - Zaman Çıkışı: 6 saat (24 bar) yatay sıkışma ve net kâr >= %0.5 ise çıkış
        if (peakPriceGainPct >= 1.5) {
          pos.passedProfitLock = true
        }

        // Kötümserlik: Hem SL (-3.5) hem TP (+5.0) aynı mumda değerse önce SL say
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
        } else if ((i - pos.entryBar) >= 24 && rawDiffClose >= 0.5) {
          exited = true
          exitPrice = candle.close
          exitReason = "TIME_ROTATION"
        }
      } else {
        // YENİ ÇIKIŞ KURALI (Adil Karşılaştırma - 6 Saatlik Zaman Çıkışı Dahil):
        // - SL: -%3.5
        // - TP: +%8.0
        // - +%2.5 görülünce stop başabaşa (giriş + komisyon %0.08) çekilir
        // - Zirveden %1.5 geride Trailing Stop
        // - Zaman Çıkışı: 6 saat (24 bar) yatay sıkışma ve net kâr >= %0.5 ise çıkış
        const hasPassed2Point5 = peakPriceGainPct >= 2.5
        const bePricePct = COMMISSION_PCT // +0.08%

        if (rawDiffLow <= -3.5) {
          exited = true
          exitPrice = pos.entryPrice * (1 - 0.035)
          exitReason = "STOP_LOSS"
        } else if (rawDiffHigh >= 8.0) {
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
        } else if ((i - pos.entryBar) >= 24 && rawDiffClose >= 0.5) {
          exited = true
          exitPrice = candle.close
          exitReason = "TIME_ROTATION"
        }
      }

      if (exited) {
        const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100
        const netReturnPct = grossReturnPct - TOTAL_COST_PCT
        const leveragedRoiPct = netReturnPct * LEVERAGE
        const marginUsdt = POSITION_SIZE_USDT / LEVERAGE
        const netPnlUsdt = (marginUsdt * leveragedRoiPct) / 100
        const commissionUsdt = (POSITION_SIZE_USDT * COMMISSION_PCT) / 100
        const slippageUsdt = (POSITION_SIZE_USDT * SLIPPAGE_PCT) / 100

        closedTrades.push({
          id: `${pos.symbol}-${pos.entryTime}`,
          symbol: pos.symbol,
          entryTime: new Date(pos.entryTime).toISOString(),
          exitTime: new Date(candle.time).toISOString(),
          day: new Date(pos.entryTime).toISOString().slice(0, 10),
          entryPrice: pos.entryPrice,
          exitPrice,
          exitReason,
          leverage: LEVERAGE,
          marginUsdt,
          commissionUsdt,
          slippageUsdt,
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

    // B. SCAN ENTRY SIGNALS (NO SLOT RESTRICTION - ONLY ONE ACTIVE PER COIN)
    for (const sym of coinList) {
      if (activePositions.some(p => p.symbol === sym)) continue

      const klines = allMarketData[sym].slice(0, i + 1)
      const curCandle = klines[klines.length - 1]

      const closes = klines.map(k => k.close)
      const rsiArr = calcRSI(closes, 14)
      const curRsi = rsiArr[rsiArr.length - 1]

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

  return closedTrades
}

// ==========================================================
// 3. STATISTICAL EVALUATION & BLOCK BOOTSTRAP (DAY-BASED)
// ==========================================================
function computeBootstrapCI(trades, iterations = 2000, blockSize = 2) {
  if (trades.length === 0) return { mean: 0, ciLower: 0, ciUpper: 0 }

  // Group trades by calendar day
  const dayMap = new Map()
  for (const t of trades) {
    if (!dayMap.has(t.day)) dayMap.set(t.day, [])
    dayMap.get(t.day).push(t.netPnlUsdt)
  }

  const days = Array.from(dayMap.keys()).sort()
  const numDays = days.length
  if (numDays === 0) return { mean: 0, ciLower: 0, ciUpper: 0 }

  // Block creation
  const blocks = []
  for (let d = 0; d <= numDays - blockSize; d++) {
    const blockDays = days.slice(d, d + blockSize)
    const blockPnls = blockDays.flatMap(day => dayMap.get(day) || [])
    blocks.push(blockPnls)
  }
  if (blocks.length === 0) {
    blocks.push(trades.map(t => t.netPnlUsdt))
  }

  const bootstrapMeans = []
  const numBlocksNeeded = Math.ceil(numDays / blockSize)

  for (let b = 0; b < iterations; b++) {
    let samplePnls = []
    for (let k = 0; k < numBlocksNeeded; k++) {
      const randIdx = Math.floor(Math.random() * blocks.length)
      samplePnls.push(...blocks[randIdx])
    }
    if (samplePnls.length > 0) {
      const mean = samplePnls.reduce((a, b) => a + b, 0) / samplePnls.length
      bootstrapMeans.push(mean)
    }
  }

  bootstrapMeans.sort((a, b) => a - b)
  const ciLower = bootstrapMeans[Math.floor(iterations * 0.025)]
  const ciUpper = bootstrapMeans[Math.floor(iterations * 0.975)]
  const observedMean = trades.reduce((a, b) => a + b.netPnlUsdt, 0) / trades.length

  return {
    mean: observedMean,
    ciLower,
    ciUpper
  }
}

function generateCSV(trades, filename) {
  const headers = [
    "id", "symbol", "entryTime", "exitTime", "day", "entryPrice", "exitPrice",
    "exitReason", "leverage", "marginUsdt", "commissionUsdt", "slippageUsdt",
    "grossReturnPct", "netReturnPct", "leveragedRoiPct", "netPnlUsdt", "durationBars"
  ]
  const rows = trades.map(t => [
    t.id, t.symbol, t.entryTime, t.exitTime, t.day, t.entryPrice.toFixed(6), t.exitPrice.toFixed(6),
    t.exitReason, t.leverage, t.marginUsdt.toFixed(2), t.commissionUsdt.toFixed(4), t.slippageUsdt.toFixed(4),
    t.grossReturnPct.toFixed(2), t.netReturnPct.toFixed(2), t.leveragedRoiPct.toFixed(2), t.netPnlUsdt.toFixed(4),
    t.durationBars
  ])
  const content = [headers.join(","), ...rows.map(r => r.join(","))].join("\n")
  fs.writeFileSync(filename, content, "utf8")
}

async function main() {
  console.log("📥 Canlı Oynak Altcoin Verileri Çekiliyor (12 Coin, 30 Gün, 15m Mumlar)...")
  const marketData = {}
  for (const sym of SYMBOLS) {
    process.stdout.write(`Fetching ${sym}... `)
    const klines = await fetchHistoricalKlines(sym, TOTAL_CANDLES)
    marketData[sym] = klines
    console.log(`Tamamlandı (${klines.length} mum).`)
  }

  console.log("\n⚙️ Simülasyon Çalıştırılıyor (Slot Kısıtı Yok, Aynı Sinyaller, 10x Kaldıraç, Ayrılmış Komisyon ve Kayma)...")
  const currentTrades = runBacktest(marketData, "CURRENT")
  const newTrades = runBacktest(marketData, "NEW")

  // CSV'leri kaydet
  generateCSV(currentTrades, "trades_current_rules.csv")
  generateCSV(newTrades, "trades_new_rules.csv")
  console.log("💾 'trades_current_rules.csv' ve 'trades_new_rules.csv' dosyaları üretildi.")

  // İstatistiksel Bootstrap Hesaplaması
  const currentBoot = computeBootstrapCI(currentTrades)
  const newBoot = computeBootstrapCI(newTrades)

  const calcStats = (trades) => {
    const n = trades.length
    const wins = trades.filter(t => t.netPnlUsdt > 0)
    const losses = trades.filter(t => t.netPnlUsdt <= 0)
    const winRate = n > 0 ? (wins.length / n) * 100 : 0
    const totalPnl = trades.reduce((a, b) => a + b.netPnlUsdt, 0)
    const avgPnl = n > 0 ? totalPnl / n : 0
    const avgRoi = n > 0 ? trades.reduce((a, b) => a + b.leveragedRoiPct, 0) / n : 0
    const wMean = wins.length > 0 ? wins.reduce((a, b) => a + b.netPnlUsdt, 0) / wins.length : 0
    const lMean = losses.length > 0 ? losses.reduce((a, b) => a + b.netPnlUsdt, 0) / losses.length : 0
    const pf = Math.abs(losses.reduce((a, b) => a + b.netPnlUsdt, 0)) > 0
      ? wins.reduce((a, b) => a + b.netPnlUsdt, 0) / Math.abs(losses.reduce((a, b) => a + b.netPnlUsdt, 0))
      : 0
    return { n, wins: wins.length, losses: losses.length, winRate, totalPnl, avgPnl, avgRoi, wMean, lMean, pf }
  }

  const sCurrent = calcStats(currentTrades)
  const sNew = calcStats(newTrades)

  console.log("\n==========================================================================")
  console.log("📊 CANLI OYNAK ALTCOİNLERLE KARŞILAŞTIRMALI BACKTEST TABLOSU")
  console.log("==========================================================================")
  console.log(`Sepet (12 Coin): ${SYMBOLS.join(", ")}`)
  console.log(`Parametreler: 10x Kaldıraç, 50 USDT Notional, Slot Kısıtı YOK`)
  console.log(`Maliyetler: Komisyon: %0.08, Kayma: %0.04 (Toplam %0.12)`)
  console.log(`Güven Aralığı: Gün bazlı 2 günlük blok bootstrap (2000 iterasyon, %95 GA)\n`)

  const summary = [
    {
      "Metrik": "Toplam İşlem Sayısı (N)",
      "Mevcut Çıkış Kuralları": sCurrent.n,
      "Yeni Çıkış Kuralları": sNew.n
    },
    {
      "Metrik": "Kazanma Oranı (Win Rate)",
      "Mevcut Çıkış Kuralları": sCurrent.winRate.toFixed(2) + "%",
      "Yeni Çıkış Kuralları": sNew.winRate.toFixed(2) + "%"
    },
    {
      "Metrik": "Toplam Net PnL (USDT)",
      "Mevcut Çıkış Kuralları": sCurrent.totalPnl.toFixed(2) + " USDT",
      "Yeni Çıkış Kuralları": sNew.totalPnl.toFixed(2) + " USDT"
    },
    {
      "Metrik": "İşlem Başına Ort. Net PnL",
      "Mevcut Çıkış Kuralları": sCurrent.avgPnl.toFixed(4) + " USDT",
      "Yeni Çıkış Kuralları": sNew.avgPnl.toFixed(4) + " USDT"
    },
    {
      "Metrik": "95% Güven Aralığı (Blok Bootstrap)",
      "Mevcut Çıkış Kuralları": `[${currentBoot.ciLower.toFixed(4)}, ${currentBoot.ciUpper.toFixed(4)}]`,
      "Yeni Çıkış Kuralları": `[${newBoot.ciLower.toFixed(4)}, ${newBoot.ciUpper.toFixed(4)}]`
    },
    {
      "Metrik": "Ortalama Kaldıraçlı ROI (10x)",
      "Mevcut Çıkış Kuralları": sCurrent.avgRoi.toFixed(2) + "%",
      "Yeni Çıkış Kuralları": sNew.avgRoi.toFixed(2) + "%"
    },
    {
      "Metrik": "Ortalama Kazanç (W)",
      "Mevcut Çıkış Kuralları": "+" + sCurrent.wMean.toFixed(4) + " USDT",
      "Yeni Çıkış Kuralları": "+" + sNew.wMean.toFixed(4) + " USDT"
    },
    {
      "Metrik": "Ortalama Kayıp (L)",
      "Mevcut Çıkış Kuralları": sCurrent.lMean.toFixed(4) + " USDT",
      "Yeni Çıkış Kuralları": sNew.lMean.toFixed(4) + " USDT"
    },
    {
      "Metrik": "Kâr Faktörü (Profit Factor)",
      "Mevcut Çıkış Kuralları": sCurrent.pf.toFixed(2),
      "Yeni Çıkış Kuralları": sNew.pf.toFixed(2)
    }
  ]

  console.table(summary)

  // Çıkış nedenleri
  const rCurrent = {}, rNew = {}
  currentTrades.forEach(t => rCurrent[t.exitReason] = (rCurrent[t.exitReason] || 0) + 1)
  newTrades.forEach(t => rNew[t.exitReason] = (rNew[t.exitReason] || 0) + 1)
  console.log("📌 Çıkış Dağılımı (Mevcut):", rCurrent)
  console.log("📌 Çıkış Dağılımı (Yeni):", rNew)

  fs.writeFileSync("backtest_altcoin_results.json", JSON.stringify({ summary, sCurrent, sNew, rCurrent, rNew, currentBoot, newBoot }, null, 2))
}

main().catch(console.error)
