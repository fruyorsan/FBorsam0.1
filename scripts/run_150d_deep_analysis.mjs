import fs from "fs"

// =========================================================================
// 12 VOLATILE COINS - 150 DAYS (5 MONTHS) HISTORICAL DATA ANALYSIS
// =========================================================================
const SYMBOLS = [
  "STRKUSDT", "TIAUSDT", "LUMIAUSDT", "INJUSDT", "SUIUSDT",
  "RENDERUSDT", "UNIUSDT", "NEARUSDT", "APTUSDT", "DOGEUSDT",
  "SOLUSDT", "ENAUSDT"
]

const LIMIT_PER_REQ = 1000
const DAYS = 150 // 5 months
const TOTAL_CANDLES = DAYS * 24 * 4 // ~14,400 candles per coin
const LEVERAGE = 10
const MARGIN_USDT = 5 // 50 USDT notional / 10x
const NOTIONAL_USDT = 50

// Costs: Taker entry 0.05% + Taker exit 0.05% + Market slippage 0.04% each way = 0.18% base
// Soru 7 için: Stop dolumunda ek gecikme/kayma (+0.08% ekstra stop kayması = toplam stop çıkış maliyeti %0.22)
const BASE_COST_PCT = 0.18
const STOP_EXTRA_SLIPPAGE_PCT = 0.08 // Stop tetiklenince ek piyasa kayması

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
        quoteVolume: parseFloat(d[7])
      }))
      allKlines = [...formatted, ...allKlines]
      endTime = data[0][0] - 1
      await new Promise(r => setTimeout(r, 30))
    } catch {
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

// =========================================================================
// SIMULATE EXIT WITH REALISTIC NEXT-CANDLE / EXTRA SLIPPAGE STOP EXECUTION
// =========================================================================
function simulateExit(candleStream, startIdx, entryPrice, exitMode) {
  let highestPrice = entryPrice
  let passedProfitLock = false

  for (let i = startIdx; i < candleStream.length; i++) {
    const candle = candleStream[i]
    highestPrice = Math.max(highestPrice, candle.high)
    const peakGain = ((highestPrice - entryPrice) / entryPrice) * 100
    const rawDiffLow = ((candle.low - entryPrice) / entryPrice) * 100
    const rawDiffHigh = ((candle.high - entryPrice) / entryPrice) * 100

    if (exitMode === "RULE_1") {
      // Mevcut: -3.5% SL, +1.5% profit lock, +2.8% trailing (0.85% drop), +5% TP
      if (peakGain >= 1.5) passedProfitLock = true

      if (rawDiffLow <= -3.5 && !passedProfitLock) {
        // Gerçekçi stop dolumu: bir sonraki mum açılışı veya ek kayma
        const nextOpen = (i + 1 < candleStream.length) ? candleStream[i + 1].open : candle.close
        const worstStopPrice = Math.min(entryPrice * (1 - 0.035), nextOpen)
        return { exitPrice: worstStopPrice, reason: "STOP_LOSS", durationBars: i - startIdx, exitTime: candle.time, exitBar: i, isStop: true }
      } else if (passedProfitLock && rawDiffLow <= 1.5) {
        return { exitPrice: entryPrice * (1 + 0.015), reason: "PROFIT_LOCK_STOP", durationBars: i - startIdx, exitTime: candle.time, exitBar: i, isStop: false }
      } else if (peakGain >= 2.8 && rawDiffLow <= (peakGain - 0.85)) {
        return { exitPrice: entryPrice * (1 + (peakGain - 0.85) / 100), reason: "TRAILING_STOP", durationBars: i - startIdx, exitTime: candle.time, exitBar: i, isStop: false }
      } else if (rawDiffHigh >= 5.0) {
        return { exitPrice: entryPrice * (1 + 0.05), reason: "TAKE_PROFIT", durationBars: i - startIdx, exitTime: candle.time, exitBar: i, isStop: false }
      }
    } else if (exitMode === "RULE_2") {
      // Sabit TP/SL (+5.0% / -3.5%)
      if (rawDiffLow <= -3.5) {
        const nextOpen = (i + 1 < candleStream.length) ? candleStream[i + 1].open : candle.close
        const worstStopPrice = Math.min(entryPrice * (1 - 0.035), nextOpen)
        return { exitPrice: worstStopPrice, reason: "STOP_LOSS", durationBars: i - startIdx, exitTime: candle.time, exitBar: i, isStop: true }
      } else if (rawDiffHigh >= 5.0) {
        return { exitPrice: entryPrice * (1 + 0.05), reason: "TAKE_PROFIT", durationBars: i - startIdx, exitTime: candle.time, exitBar: i, isStop: false }
      }
    } else if (exitMode === "RULE_3") {
      // Trailing Only (-3.5% SL, +2.5% pass sonrası zirveden %1.5 trailing, +8% TP)
      if (rawDiffLow <= -3.5) {
        const nextOpen = (i + 1 < candleStream.length) ? candleStream[i + 1].open : candle.close
        const worstStopPrice = Math.min(entryPrice * (1 - 0.035), nextOpen)
        return { exitPrice: worstStopPrice, reason: "STOP_LOSS", durationBars: i - startIdx, exitTime: candle.time, exitBar: i, isStop: true }
      } else if (rawDiffHigh >= 8.0) {
        return { exitPrice: entryPrice * (1 + 0.08), reason: "TAKE_PROFIT_8PCT", durationBars: i - startIdx, exitTime: candle.time, exitBar: i, isStop: false }
      } else if (peakGain >= 2.5 && rawDiffLow <= (peakGain - 1.5)) {
        return { exitPrice: entryPrice * (1 + (peakGain - 1.5) / 100), reason: "TRAILING_STOP", durationBars: i - startIdx, exitTime: candle.time, exitBar: i, isStop: false }
      }
    }
  }
  const lastC = candleStream[candleStream.length - 1]
  return { exitPrice: lastC.close, reason: "DATA_END", durationBars: candleStream.length - 1 - startIdx, exitTime: lastC.time, exitBar: candleStream.length - 1, isStop: false }
}

// Strictly enforce ONE position per coin at any given time
function generateSignalEntries(marketData, minLen, entryType = "CLOSED_BAR") {
  // entryType: "CLOSED_BAR" (close of candle) vs "MID_BAR" (open/mid price simulating live m0 intra-bar)
  const entries = []
  for (const sym of SYMBOLS) {
    const klines = marketData[sym]
    const closes = klines.map(k => k.close)
    const rsiArr = calcRSI(closes, 14)

    let busyUntilBar = 0

    for (let i = 35; i < minLen - 10; i++) {
      if (i < busyUntilBar) continue // Enforces 1 active position per coin

      const curCandle = klines[i]
      const past20Vols = klines.slice(i - 20, i).map(k => k.quoteVolume)
      const avgVol = past20Vols.reduce((a, b) => a + b, 0) / (past20Vols.length || 1)
      const volRatio = avgVol > 0 ? curCandle.quoteVolume / avgVol : 1
      const isGreen = curCandle.close >= curCandle.open
      const curRsi = rsiArr[i]

      const isSignal = (curRsi <= 42 && isGreen && volRatio >= 1.1) ||
                       (curRsi > 42 && curRsi <= 62 && isGreen && volRatio >= 1.6)

      if (isSignal) {
        // Entry price calculation:
        // CLOSED_BAR: curCandle.close
        // MID_BAR: simulating live intra-candle execution (higher execution price as green candle is moving up: (open + close)/2 + 0.15% adverse slippage)
        const entryPrice = entryType === "CLOSED_BAR"
          ? curCandle.close
          : Math.max(curCandle.close, (curCandle.open + curCandle.close) / 2 * 1.002)

        // Pre-simulate exit with Rule 1 to find when position frees up for this coin
        const simExit = simulateExit(klines, i, entryPrice, "RULE_1")
        busyUntilBar = simExit.exitBar + 1 // coin remains locked until exit

        entries.push({
          symbol: sym,
          barIdx: i,
          time: curCandle.time,
          entryPrice
        })
      }
    }
  }
  return entries.sort((a, b) => a.time - b.time)
}

function processTrades(entries, marketData, exitMode) {
  const trades = []
  for (const ent of entries) {
    const stream = marketData[ent.symbol]
    const exit = simulateExit(stream, ent.barIdx, ent.entryPrice, exitMode)

    const grossReturnPct = ((exit.exitPrice - ent.entryPrice) / ent.entryPrice) * 100
    const cost = exit.isStop ? (BASE_COST_PCT + STOP_EXTRA_SLIPPAGE_PCT) : BASE_COST_PCT
    const netReturnPct = grossReturnPct - cost
    const leveragedRoiPct = netReturnPct * LEVERAGE
    const netPnlUsdt = (MARGIN_USDT * leveragedRoiPct) / 100

    const dateObj = new Date(ent.time)
    const month = dateObj.toISOString().slice(0, 7) // YYYY-MM
    const day = dateObj.toISOString().slice(0, 10)

    trades.push({
      symbol: ent.symbol,
      entryTime: dateObj.toISOString(),
      exitTime: new Date(exit.exitTime).toISOString(),
      month,
      day,
      entryPrice: ent.entryPrice,
      exitPrice: exit.exitPrice,
      exitReason: exit.reason,
      durationBars: exit.durationBars,
      grossReturnPct,
      netReturnPct,
      leveragedRoiPct,
      netPnlUsdt
    })
  }
  return trades
}

function calcStats(trades) {
  const n = trades.length
  if (n === 0) return { n: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgPnl: 0, avgRoi: 0, wMean: 0, lMean: 0, pf: 0 }
  const wins = trades.filter(t => t.netPnlUsdt > 0)
  const losses = trades.filter(t => t.netPnlUsdt <= 0)
  const winRate = (wins.length / n) * 100
  const totalPnl = trades.reduce((a, b) => a + b.netPnlUsdt, 0)
  const avgPnl = totalPnl / n
  const avgRoi = trades.reduce((a, b) => a + b.leveragedRoiPct, 0) / n
  const wMean = wins.length > 0 ? wins.reduce((a, b) => a + b.netPnlUsdt, 0) / wins.length : 0
  const lMean = losses.length > 0 ? losses.reduce((a, b) => a + b.netPnlUsdt, 0) / losses.length : 0
  const lossSum = Math.abs(losses.reduce((a, b) => a + b.netPnlUsdt, 0))
  const pf = lossSum > 0 ? wins.reduce((a, b) => a + b.netPnlUsdt, 0) / lossSum : 0
  return { n, wins: wins.length, losses: losses.length, winRate, totalPnl, avgPnl, avgRoi, wMean, lMean, pf }
}

// Paired Block Bootstrap for A vs B
function pairedBootstrap(tradesA, tradesB, iterations = 2000, blockSize = 2) {
  const n = Math.min(tradesA.length, tradesB.length)
  const diffsByDay = new Map()

  for (let i = 0; i < n; i++) {
    const day = tradesA[i].day
    const diff = tradesA[i].netPnlUsdt - tradesB[i].netPnlUsdt
    if (!diffsByDay.has(day)) diffsByDay.set(day, [])
    diffsByDay.get(day).push(diff)
  }

  const days = Array.from(diffsByDay.keys()).sort()
  const blocks = []
  for (let d = 0; d <= days.length - blockSize; d++) {
    const blockDays = days.slice(d, d + blockSize)
    blocks.push(blockDays.flatMap(day => diffsByDay.get(day) || []))
  }
  if (blocks.length === 0) blocks.push(Array.from(diffsByDay.values()).flat())

  const bootDiffMeans = []
  const numBlocksNeeded = Math.ceil(days.length / blockSize)

  for (let b = 0; b < iterations; b++) {
    const sampled = []
    for (let k = 0; k < numBlocksNeeded; k++) {
      const r = Math.floor(Math.random() * blocks.length)
      sampled.push(...blocks[r])
    }
    if (sampled.length > 0) {
      bootDiffMeans.push(sampled.reduce((x, y) => x + y, 0) / sampled.length)
    }
  }
  bootDiffMeans.sort((x, y) => x - y)
  const observedMeanDiff = (tradesA.slice(0, n).reduce((x, y) => x + y.netPnlUsdt, 0) - tradesB.slice(0, n).reduce((x, y) => x + y.netPnlUsdt, 0)) / n
  const ciLower = bootDiffMeans[Math.floor(iterations * 0.025)]
  const ciUpper = bootDiffMeans[Math.floor(iterations * 0.975)]

  return { observedMeanDiff, ciLower, ciUpper }
}

async function run() {
  console.log("📥 150 Günlük Binance Vadeli Piyasa Verisi Çekiliyor (12 Oynak Coin)...")
  const marketData = {}
  for (const s of SYMBOLS) {
    process.stdout.write(`Fetching ${s}... `)
    const k = await fetchHistoricalKlines(s, TOTAL_CANDLES)
    marketData[s] = k
    console.log(`Tamamlandı (${k.length} mum).`)
  }
  const minLen = Math.min(...SYMBOLS.map(s => marketData[s].length))
  console.log(`\nVeri Aralığı: ${new Date(marketData[SYMBOLS[0]][0].time).toISOString().slice(0,10)} -> ${new Date(marketData[SYMBOLS[0]][minLen-1].time).toISOString().slice(0,10)} (${minLen} mum per coin)`)

  // 1. SIGNAL ENTRIES (STRICT: 1 POSITION PER COIN)
  const entriesClosed = generateSignalEntries(marketData, minLen, "CLOSED_BAR")
  const entriesLiveM0 = generateSignalEntries(marketData, minLen, "MID_BAR")
  console.log(`\n📌 Sinyal Sayısı (Coin Başına Aynı Anda Tek Pozisyon Kuralı ile): ${entriesClosed.length}`)

  // 2. PROCESS RULES ON CLOSED_BAR
  const tradesR1 = processTrades(entriesClosed, marketData, "RULE_1")
  const tradesR2 = processTrades(entriesClosed, marketData, "RULE_2")
  const tradesR3 = processTrades(entriesClosed, marketData, "RULE_3")
  const tradesM0 = processTrades(entriesLiveM0, marketData, "RULE_1") // Soru 5: Canlı m0 eşleştirmesi

  // 3. BUY AND HOLD BENCHMARK (Al-ve-Tut)
  let totalBnHReturnPct = 0
  for (const s of SYMBOLS) {
    const pStart = marketData[s][0].close
    const pEnd = marketData[s][minLen - 1].close
    const rPct = ((pEnd - pStart) / pStart) * 100
    totalBnHReturnPct += rPct
  }
  const avgBnHReturnPct = totalBnHReturnPct / SYMBOLS.length
  const leveragedBnHReturnPct = avgBnHReturnPct * LEVERAGE

  // 4. RANDOM ENTRY + SAME EXIT BENCHMARK (100 SETS)
  const coinCounts = {}
  entriesClosed.forEach(e => coinCounts[e.symbol] = (coinCounts[e.symbol] || 0) + 1)
  const randomSetPnls = []
  for (let r = 0; r < 100; r++) {
    const randEntries = []
    for (const [sym, count] of Object.entries(coinCounts)) {
      const stream = marketData[sym]
      for (let c = 0; c < count; c++) {
        const randIdx = 35 + Math.floor(Math.random() * (minLen - 100))
        randEntries.push({ symbol: sym, barIdx: randIdx, time: stream[randIdx].time, entryPrice: stream[randIdx].close })
      }
    }
    const rTrades = processTrades(randEntries, marketData, "RULE_1")
    randomSetPnls.push(rTrades.reduce((a, b) => a + b.netPnlUsdt, 0) / rTrades.length)
  }
  const avgRandomPnl = randomSetPnls.reduce((a, b) => a + b, 0) / 100

  // 5. MONTHLY BREAKDOWN (Soru 1)
  const months = Array.from(new Set(tradesR1.map(t => t.month))).sort()
  const monthlyReport = months.map(m => {
    const mTradesR1 = tradesR1.filter(t => t.month === m)
    const mTradesR2 = tradesR2.filter(t => t.month === m)
    const s1 = calcStats(mTradesR1)
    const s2 = calcStats(mTradesR2)
    return {
      "Ay": m,
      "İşlem (N)": s1.n,
      "Kural 1 WR": s1.winRate.toFixed(1) + "%",
      "Kural 1 Net PnL": s1.totalPnl.toFixed(2) + "$",
      "Kural 2 WR": s2.winRate.toFixed(1) + "%",
      "Kural 2 Net PnL": s2.totalPnl.toFixed(2) + "$"
    }
  })

  // 6. PAIRED BLOCK BOOTSTRAP (Soru 3)
  const pairR1_R2 = pairedBootstrap(tradesR2, tradesR1) // R2 - R1
  const pairR3_R1 = pairedBootstrap(tradesR3, tradesR1) // R3 - R1

  // 7. WALK-FORWARD ANALYSIS (%60 IN-SAMPLE, %40 OUT-OF-SAMPLE) (Soru 6)
  const splitIdx = Math.floor(entriesClosed.length * 0.6)
  const inSampleR1 = tradesR1.slice(0, splitIdx)
  const inSampleR2 = tradesR2.slice(0, splitIdx)
  const inSampleR3 = tradesR3.slice(0, splitIdx)

  const outOfSampleR1 = tradesR1.slice(splitIdx)
  const outOfSampleR2 = tradesR2.slice(splitIdx)
  const outOfSampleR3 = tradesR3.slice(splitIdx)

  const sInR1 = calcStats(inSampleR1), sInR2 = calcStats(inSampleR2), sInR3 = calcStats(inSampleR3)
  const sOutR1 = calcStats(outOfSampleR1), sOutR2 = calcStats(outOfSampleR2), sOutR3 = calcStats(outOfSampleR3)

  // Overall Stats
  const sR1 = calcStats(tradesR1)
  const sR2 = calcStats(tradesR2)
  const sR3 = calcStats(tradesR3)
  const sM0 = calcStats(tradesM0)

  console.log("\n=========================================================================")
  console.log("📅 1. AYLIK SONUÇ TABLOSU (150 GÜN / 5 AY)")
  console.log("=========================================================================")
  console.table(monthlyReport)

  console.log("\n=========================================================================")
  console.log("📊 2. 150 GÜNLÜK GENEL PERFORMANS VE BENCHMARK KARŞILAŞTIRMASI")
  console.log("=========================================================================")
  console.log(`📌 Al-ve-Tut (Buy & Hold) Benchmark: Ham Ortalama: %${avgBnHReturnPct.toFixed(2)} (10x Kaldıraçlı: %${leveragedBnHReturnPct.toFixed(2)})`)
  console.log(`📌 Rastgele Giriş + Kural 1 Benchmark (100 Set Ort.): İşlem Başı PnL = ${avgRandomPnl.toFixed(4)} USDT`)

  const summaryTable = [
    {
      "Metrik": "Toplam İşlem (N)",
      "Kural 1 (Canlı Kural)": sR1.n,
      "Kural 2 (Sabit TP/SL)": sR2.n,
      "Kural 3 (Trailing Only)": sR3.n,
      "Canlı m0 Girişi (Gecikmeli)": sM0.n
    },
    {
      "Metrik": "Kazanma Oranı (Win Rate)",
      "Kural 1 (Canlı Kural)": sR1.winRate.toFixed(2) + "%",
      "Kural 2 (Sabit TP/SL)": sR2.winRate.toFixed(2) + "%",
      "Kural 3 (Trailing Only)": sR3.winRate.toFixed(2) + "%",
      "Canlı m0 Girişi (Gecikmeli)": sM0.winRate.toFixed(2) + "%"
    },
    {
      "Metrik": "Toplam Net PnL (USDT)",
      "Kural 1 (Canlı Kural)": sR1.totalPnl.toFixed(2) + " USDT",
      "Kural 2 (Sabit TP/SL)": sR2.totalPnl.toFixed(2) + " USDT",
      "Kural 3 (Trailing Only)": sR3.totalPnl.toFixed(2) + " USDT",
      "Canlı m0 Girişi (Gecikmeli)": sM0.totalPnl.toFixed(2) + " USDT"
    },
    {
      "Metrik": "İşlem Başı Ort. Net PnL",
      "Kural 1 (Canlı Kural)": sR1.avgPnl.toFixed(4) + " USDT",
      "Kural 2 (Sabit TP/SL)": sR2.avgPnl.toFixed(4) + " USDT",
      "Kural 3 (Trailing Only)": sR3.avgPnl.toFixed(4) + " USDT",
      "Canlı m0 Girişi (Gecikmeli)": sM0.avgPnl.toFixed(4) + " USDT"
    },
    {
      "Metrik": "Kâr Faktörü (PF)",
      "Kural 1 (Canlı Kural)": sR1.pf.toFixed(2),
      "Kural 2 (Sabit TP/SL)": sR2.pf.toFixed(2),
      "Kural 3 (Trailing Only)": sR3.pf.toFixed(2),
      "Canlı m0 Girişi (Gecikmeli)": sM0.pf.toFixed(2)
    }
  ]
  console.table(summaryTable)

  console.log("\n=========================================================================")
  console.log("🔗 3. EŞLEŞTİRİLMİŞ (PAIRED) BLOK BOOTSTRAP KARŞILAŞTIRMASI")
  console.log("=========================================================================")
  console.log(`Kural 2 vs Kural 1 (Fark = R2 - R1): Ort Fark = +${pairR1_R2.observedMeanDiff.toFixed(4)} USDT | 95% GA = [${pairR1_R2.ciLower.toFixed(4)}, ${pairR1_R2.ciUpper.toFixed(4)}]`)
  console.log(`Kural 3 vs Kural 1 (Fark = R3 - R1): Ort Fark = ${pairR3_R1.observedMeanDiff.toFixed(4)} USDT | 95% GA = [${pairR3_R1.ciLower.toFixed(4)}, ${pairR3_R1.ciUpper.toFixed(4)}]`)

  console.log("\n=========================================================================")
  console.log("🚶 4. WALK-FORWARD DOĞRULAMA (%60 IN-SAMPLE / %40 OUT-OF-SAMPLE)")
  console.log("=========================================================================")
  console.log(`In-Sample (%60, N=${splitIdx}):`)
  console.log(`- Kural 1: WR = %${sInR1.winRate.toFixed(1)}, PnL = ${sInR1.totalPnl.toFixed(2)} USDT, PF = ${sInR1.pf.toFixed(2)}`)
  console.log(`- Kural 2: WR = %${sInR2.winRate.toFixed(1)}, PnL = ${sInR2.totalPnl.toFixed(2)} USDT, PF = ${sInR2.pf.toFixed(2)} [SEÇİLEN KURAL]`)
  console.log(`- Kural 3: WR = %${sInR3.winRate.toFixed(1)}, PnL = ${sInR3.totalPnl.toFixed(2)} USDT, PF = ${sInR3.pf.toFixed(2)}`)
  console.log(`Out-of-Sample (%40, N=${entriesClosed.length - splitIdx} - Sadece Seçilen Kural 2 Testi):`)
  console.log(`- Kural 2 OOS Sonucu: WR = %${sOutR2.winRate.toFixed(1)}, PnL = ${sOutR2.totalPnl.toFixed(2)} USDT, Ort PnL = ${sOutR2.avgPnl.toFixed(4)} USDT, PF = ${sOutR2.pf.toFixed(2)}`)
  console.log(`- Kural 1 OOS Karşılaştırma: WR = %${sOutR1.winRate.toFixed(1)}, PnL = ${sOutR1.totalPnl.toFixed(2)} USDT, PF = ${sOutR1.pf.toFixed(2)}`)

  fs.writeFileSync("walkforward_150d_results.json", JSON.stringify({
    summaryTable, monthlyReport, sR1, sR2, sR3, sM0, pairR1_R2, pairR3_R1,
    avgBnHReturnPct, avgRandomPnl, sInR1, sInR2, sInR3, sOutR1, sOutR2, sOutR3
  }, null, 2))
}

run().catch(console.error)
