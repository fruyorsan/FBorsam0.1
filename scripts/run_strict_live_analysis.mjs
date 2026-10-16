import fs from "fs"

// =========================================================================
// 12 COINS (USER'S VOLATILE PORTFOLIO) & EXACT REALISTIC COSTS
// =========================================================================
const SYMBOLS = [
  "STRKUSDT", "TIAUSDT", "LUMIAUSDT", "INJUSDT", "SUIUSDT",
  "RENDERUSDT", "UNIUSDT", "NEARUSDT", "APTUSDT", "DOGEUSDT",
  "SOLUSDT", "ENAUSDT"
]

const LIMIT_PER_REQ = 1000
const TOTAL_CANDLES = 2880 // 30 days of 15m candles
const LEVERAGE = 10
const MARGIN_USDT = 5 // 50 USDT notional / 10x
const NOTIONAL_USDT = 50

// Requested cost: entry 0.05% + exit 0.05% taker + 0.04% slippage each way = 0.18%
const REAL_COST_PCT = 0.18

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
      await new Promise(r => setTimeout(r, 40))
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
// EXIT ENGINES (NO TIME ROTATION IN ANY OF THEM)
// =========================================================================
// exitMode:
// 1. "LIVE_EXACT": -3.5% SL, +1.5% profit lock stop, +2.8% trailing (0.85% drop), +5.0% TP
// 2. "FIXED_TP_SL": -3.5% SL, +5.0% TP (kâr kilidi yok, trailing yok)
// 3. "ATR_TRAILING": -3.5% SL, +2.5% pass -> trailing 1.5% behind peak (kâr kilidi yok)
function simulateExit(candleStream, startIdx, entryPrice, exitMode) {
  let highestPrice = entryPrice
  let passedProfitLock = false

  for (let i = startIdx; i < candleStream.length; i++) {
    const candle = candleStream[i]
    highestPrice = Math.max(highestPrice, candle.high)
    const peakGain = ((highestPrice - entryPrice) / entryPrice) * 100
    const rawDiffLow = ((candle.low - entryPrice) / entryPrice) * 100
    const rawDiffHigh = ((candle.high - entryPrice) / entryPrice) * 100

    if (exitMode === "LIVE_EXACT") {
      if (peakGain >= 1.5) passedProfitLock = true

      // Kötümser: aynı mumda hem SL hem TP görürse önce SL
      if (rawDiffLow <= -3.5 && !passedProfitLock) {
        return { exitPrice: entryPrice * (1 - 0.035), reason: "STOP_LOSS", durationBars: i - startIdx, exitTime: candle.time }
      } else if (passedProfitLock && rawDiffLow <= 1.5) {
        return { exitPrice: entryPrice * (1 + 0.015), reason: "PROFIT_LOCK_STOP", durationBars: i - startIdx, exitTime: candle.time }
      } else if (peakGain >= 2.8 && rawDiffLow <= (peakGain - 0.85)) {
        return { exitPrice: entryPrice * (1 + (peakGain - 0.85) / 100), reason: "TRAILING_STOP", durationBars: i - startIdx, exitTime: candle.time }
      } else if (rawDiffHigh >= 5.0) {
        return { exitPrice: entryPrice * (1 + 0.05), reason: "TAKE_PROFIT", durationBars: i - startIdx, exitTime: candle.time }
      }
    } else if (exitMode === "FIXED_TP_SL") {
      // Sadece TP (+5.0%) ve SL (-3.5%)
      if (rawDiffLow <= -3.5) {
        return { exitPrice: entryPrice * (1 - 0.035), reason: "STOP_LOSS", durationBars: i - startIdx, exitTime: candle.time }
      } else if (rawDiffHigh >= 5.0) {
        return { exitPrice: entryPrice * (1 + 0.05), reason: "TAKE_PROFIT", durationBars: i - startIdx, exitTime: candle.time }
      }
    } else if (exitMode === "TRAILING_ONLY") {
      // Kâr kilidi yok: -3.5% SL, +2.5% pass sonrası zirveden %1.5 trailing, +8.0% TP
      if (rawDiffLow <= -3.5) {
        return { exitPrice: entryPrice * (1 - 0.035), reason: "STOP_LOSS", durationBars: i - startIdx, exitTime: candle.time }
      } else if (rawDiffHigh >= 8.0) {
        return { exitPrice: entryPrice * (1 + 0.08), reason: "TAKE_PROFIT_8PCT", durationBars: i - startIdx, exitTime: candle.time }
      } else if (peakGain >= 2.5 && rawDiffLow <= (peakGain - 1.5)) {
        return { exitPrice: entryPrice * (1 + (peakGain - 1.5) / 100), reason: "TRAILING_STOP", durationBars: i - startIdx, exitTime: candle.time }
      }
    }
  }

  // Veri sonuna ulaşıldı
  const lastC = candleStream[candleStream.length - 1]
  return { exitPrice: lastC.close, reason: "DATA_END", durationBars: candleStream.length - 1 - startIdx, exitTime: lastC.time }
}

// Generate signal entries for given market data
function findSignalEntries(marketData, minLen) {
  const signalEntries = []
  for (const sym of SYMBOLS) {
    const klines = marketData[sym]
    const closes = klines.map(k => k.close)
    const rsiArr = calcRSI(closes, 14)

    let inPos = false
    let lastExitBar = 0

    for (let i = 35; i < minLen - 10; i++) {
      if (i < lastExitBar) continue
      const curCandle = klines[i]
      const past20Vols = klines.slice(i - 20, i).map(k => k.quoteVolume)
      const avgVol = past20Vols.reduce((a, b) => a + b, 0) / (past20Vols.length || 1)
      const volRatio = avgVol > 0 ? curCandle.quoteVolume / avgVol : 1
      const isGreen = curCandle.close >= curCandle.open
      const curRsi = rsiArr[i]

      const isSignal = (curRsi <= 42 && isGreen && volRatio >= 1.1) ||
                       (curRsi > 42 && curRsi <= 62 && isGreen && volRatio >= 1.6)

      if (isSignal) {
        signalEntries.push({
          symbol: sym,
          barIdx: i,
          time: curCandle.time,
          entryPrice: curCandle.close
        })
      }
    }
  }
  return signalEntries.sort((a, b) => a.time - b.time)
}

function processTrades(entries, marketData, exitMode) {
  const trades = []
  for (const ent of entries) {
    const stream = marketData[ent.symbol]
    const exit = simulateExit(stream, ent.barIdx, ent.entryPrice, exitMode)

    const grossReturnPct = ((exit.exitPrice - ent.entryPrice) / ent.entryPrice) * 100
    const netReturnPct = grossReturnPct - REAL_COST_PCT
    const leveragedRoiPct = netReturnPct * LEVERAGE
    const netPnlUsdt = (MARGIN_USDT * leveragedRoiPct) / 100

    trades.push({
      symbol: ent.symbol,
      entryTime: new Date(ent.time).toISOString(),
      exitTime: new Date(exit.exitTime).toISOString(),
      day: new Date(ent.time).toISOString().slice(0, 10),
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

function computeBootstrapCI(trades, iterations = 2000, blockSize = 2) {
  if (trades.length === 0) return { mean: 0, ciLower: 0, ciUpper: 0 }
  const dayMap = new Map()
  for (const t of trades) {
    if (!dayMap.has(t.day)) dayMap.set(t.day, [])
    dayMap.get(t.day).push(t.netPnlUsdt)
  }
  const days = Array.from(dayMap.keys()).sort()
  const numDays = days.length
  if (numDays === 0) return { mean: 0, ciLower: 0, ciUpper: 0 }

  const blocks = []
  for (let d = 0; d <= numDays - blockSize; d++) {
    const blockDays = days.slice(d, d + blockSize)
    const blockPnls = blockDays.flatMap(day => dayMap.get(day) || [])
    blocks.push(blockPnls)
  }
  if (blocks.length === 0) blocks.push(trades.map(t => t.netPnlUsdt))

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

  return { mean: observedMean, ciLower, ciUpper }
}

function calcStats(trades) {
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

function exportCSV(trades, filename) {
  const headers = [
    "symbol", "entryTime", "exitTime", "day", "entryPrice", "exitPrice",
    "exitReason", "durationBars", "grossReturnPct", "netReturnPct", "leveragedRoiPct", "netPnlUsdt"
  ]
  const rows = trades.map(t => [
    t.symbol, t.entryTime, t.exitTime, t.day, t.entryPrice.toFixed(6), t.exitPrice.toFixed(6),
    t.exitReason, t.durationBars, t.grossReturnPct.toFixed(2), t.netReturnPct.toFixed(2),
    t.leveragedRoiPct.toFixed(2), t.netPnlUsdt.toFixed(4)
  ])
  fs.writeFileSync(filename, [headers.join(","), ...rows.map(r => r.join(","))].join("\n"), "utf8")
}

async function main() {
  console.log("📥 12 Oynak Altcoin Verisi Yükleniyor (Binance Futures)...")
  const marketData = {}
  for (const s of SYMBOLS) {
    marketData[s] = await fetchHistoricalKlines(s, TOTAL_CANDLES)
  }
  const minLen = Math.min(...SYMBOLS.map(s => marketData[s].length))
  console.log(`Tamamlandı. Mum sayısı: ${minLen} per coin.`)

  // 1. SIGNAL ENTRIES
  const signalEntries = findSignalEntries(marketData, minLen)
  const N_TRADES = signalEntries.length
  console.log(`\n🎯 Strateji Sinyali ile Üretilen İşlem Sayısı: ${N_TRADES}`)

  // Coin counts distribution
  const coinCounts = {}
  for (const e of signalEntries) coinCounts[e.symbol] = (coinCounts[e.symbol] || 0) + 1

  // =========================================================================
  // TEST 1: MEVCUT CANLI BOT KURALI (TIME ROTATION YOK)
  // =========================================================================
  console.log("\n--- TEST 1: Canlı Bot Çıkış Kuralı (TIME_ROTATION YOK) ---")
  const liveExactTrades = processTrades(signalEntries, marketData, "LIVE_EXACT")
  exportCSV(liveExactTrades, "trades_live_exact_no_timerot.csv")
  const statsLive = calcStats(liveExactTrades)
  const bootLive = computeBootstrapCI(liveExactTrades)

  // =========================================================================
  // TEST 2: 200 RASTGELE GİRİŞ SETİ (AYNI İŞLEM SAYISI VE COİN DAĞILIMI)
  // =========================================================================
  console.log(`\n🎲 200 Rastgele Giriş Seti Koşturuluyor (Her set ${N_TRADES} işlem, birebir aynı coin ağırlıkları)...`)
  const randomSetResults = []
  for (let r = 0; r < 200; r++) {
    const randomEntries = []
    for (const [sym, count] of Object.entries(coinCounts)) {
      const stream = marketData[sym]
      for (let c = 0; c < count; c++) {
        const randIdx = 35 + Math.floor(Math.random() * (minLen - 85))
        randomEntries.push({
          symbol: sym,
          barIdx: randIdx,
          time: stream[randIdx].time,
          entryPrice: stream[randIdx].close
        })
      }
    }
    const rTrades = processTrades(randomEntries, marketData, "LIVE_EXACT")
    const rStats = calcStats(rTrades)
    randomSetResults.push(rStats)
  }

  // Calculate Percentile Rank of Signal within Random Distribution
  const randomWinRates = randomSetResults.map(r => r.winRate).sort((a, b) => a - b)
  const randomAvgPnls = randomSetResults.map(r => r.avgPnl).sort((a, b) => a - b)
  const winRatePercentile = (randomWinRates.filter(w => w < statsLive.winRate).length / 200) * 100
  const pnlPercentile = (randomAvgPnls.filter(p => p < statsLive.avgPnl).length / 200) * 100

  // =========================================================================
  // TEST 3: 3 FARKLI ÇIKIŞ KURALININ KARŞILAŞTIRMASI (ZAMAN ÇIKIŞI HİÇBİRİNDE YOK)
  // =========================================================================
  console.log("\n--- TEST 3: 3 Çıkış Kuralı Karşılaştırması ---")
  // Rule 2: Fixed TP/SL
  const fixedTrades = processTrades(signalEntries, marketData, "FIXED_TP_SL")
  exportCSV(fixedTrades, "trades_fixed_tp_sl_no_timerot.csv")
  const statsFixed = calcStats(fixedTrades)
  const bootFixed = computeBootstrapCI(fixedTrades)

  // Rule 3: Trailing Only
  const trailingTrades = processTrades(signalEntries, marketData, "TRAILING_ONLY")
  exportCSV(trailingTrades, "trades_trailing_only_no_timerot.csv")
  const statsTrailing = calcStats(trailingTrades)
  const bootTrailing = computeBootstrapCI(trailingTrades)

  console.log("\n================================================================================")
  console.log("📊 1. CANLI BOT KURALI (TIME_ROTATION YOK) - SİNYAL VS 200 RASTGELE GİRİŞ SETİ")
  console.log("================================================================================")
  console.log(`Strateji Sinyali Kazanma Oranı: %${statsLive.winRate.toFixed(2)} | Yüzdelik Sıralama (Percentile): %${winRatePercentile.toFixed(1)}`)
  console.log(`Strateji Sinyali İşlem Başı Ort. Net PnL: ${statsLive.avgPnl.toFixed(4)} USDT | Yüzdelik Sıralama: %${pnlPercentile.toFixed(1)}`)
  console.log(`200 Rastgele Giriş Dağılımı: Ort WR: %${(randomWinRates.reduce((a,b)=>a+b,0)/200).toFixed(2)} (Min: %${randomWinRates[0].toFixed(2)}, Max: %${randomWinRates[199].toFixed(2)})`)
  console.log(`200 Rastgele Giriş Ort PnL: ${(randomAvgPnls.reduce((a,b)=>a+b,0)/200).toFixed(4)} USDT (Min: ${randomAvgPnls[0].toFixed(4)}, Max: ${randomAvgPnls[199].toFixed(4)})\n`)

  console.log("================================================================================")
  console.log("📊 2. 3 FARKLI ÇIKIŞ KURALININ KARŞILAŞTIRMA TABLOSU (ZAMAN ÇIKIŞI YOK)")
  console.log("================================================================================")
  const comparisonTable = [
    {
      "Metrik": "Toplam İşlem Sayısı (N)",
      "Mevcut Canlı Kural (-3.5 SL, +1.5 Kâr Kilidi)": statsLive.n,
      "Sabit TP/SL (Kâr Kilidi Yok, +5 TP / -3.5 SL)": statsFixed.n,
      "Trailing Stop (+2.5 Sonrası %1.5 Takip)": statsTrailing.n
    },
    {
      "Metrik": "Kazanma Oranı (Win Rate)",
      "Mevcut Canlı Kural (-3.5 SL, +1.5 Kâr Kilidi)": statsLive.winRate.toFixed(2) + "%",
      "Sabit TP/SL (Kâr Kilidi Yok, +5 TP / -3.5 SL)": statsFixed.winRate.toFixed(2) + "%",
      "Trailing Stop (+2.5 Sonrası %1.5 Takip)": statsTrailing.winRate.toFixed(2) + "%"
    },
    {
      "Metrik": "Toplam Net PnL (USDT)",
      "Mevcut Canlı Kural (-3.5 SL, +1.5 Kâr Kilidi)": statsLive.totalPnl.toFixed(2) + " USDT",
      "Sabit TP/SL (Kâr Kilidi Yok, +5 TP / -3.5 SL)": statsFixed.totalPnl.toFixed(2) + " USDT",
      "Trailing Stop (+2.5 Sonrası %1.5 Takip)": statsTrailing.totalPnl.toFixed(2) + " USDT"
    },
    {
      "Metrik": "İşlem Başına Ort. Net PnL",
      "Mevcut Canlı Kural (-3.5 SL, +1.5 Kâr Kilidi)": statsLive.avgPnl.toFixed(4) + " USDT",
      "Sabit TP/SL (Kâr Kilidi Yok, +5 TP / -3.5 SL)": statsFixed.avgPnl.toFixed(4) + " USDT",
      "Trailing Stop (+2.5 Sonrası %1.5 Takip)": statsTrailing.avgPnl.toFixed(4) + " USDT"
    },
    {
      "Metrik": "95% Güven Aralığı (Blok Bootstrap)",
      "Mevcut Canlı Kural (-3.5 SL, +1.5 Kâr Kilidi)": `[${bootLive.ciLower.toFixed(4)}, ${bootLive.ciUpper.toFixed(4)}]`,
      "Sabit TP/SL (Kâr Kilidi Yok, +5 TP / -3.5 SL)": `[${bootFixed.ciLower.toFixed(4)}, ${bootFixed.ciUpper.toFixed(4)}]`,
      "Trailing Stop (+2.5 Sonrası %1.5 Takip)": `[${bootTrailing.ciLower.toFixed(4)}, ${bootTrailing.ciUpper.toFixed(4)}]`
    },
    {
      "Metrik": "Ortalama Kaldıraçlı ROI (10x)",
      "Mevcut Canlı Kural (-3.5 SL, +1.5 Kâr Kilidi)": statsLive.avgRoi.toFixed(2) + "%",
      "Sabit TP/SL (Kâr Kilidi Yok, +5 TP / -3.5 SL)": statsFixed.avgRoi.toFixed(2) + "%",
      "Trailing Stop (+2.5 Sonrası %1.5 Takip)": statsTrailing.avgRoi.toFixed(2) + "%"
    },
    {
      "Metrik": "Ortalama Kazanç (W)",
      "Mevcut Canlı Kural (-3.5 SL, +1.5 Kâr Kilidi)": "+" + statsLive.wMean.toFixed(4) + " USDT",
      "Sabit TP/SL (Kâr Kilidi Yok, +5 TP / -3.5 SL)": "+" + statsFixed.wMean.toFixed(4) + " USDT",
      "Trailing Stop (+2.5 Sonrası %1.5 Takip)": "+" + statsTrailing.wMean.toFixed(4) + " USDT"
    },
    {
      "Metrik": "Ortalama Kayıp (L)",
      "Mevcut Canlı Kural (-3.5 SL, +1.5 Kâr Kilidi)": statsLive.lMean.toFixed(4) + " USDT",
      "Sabit TP/SL (Kâr Kilidi Yok, +5 TP / -3.5 SL)": statsFixed.lMean.toFixed(4) + " USDT",
      "Trailing Stop (+2.5 Sonrası %1.5 Takip)": statsTrailing.lMean.toFixed(4) + " USDT"
    },
    {
      "Metrik": "Kâr Faktörü (Profit Factor)",
      "Mevcut Canlı Kural (-3.5 SL, +1.5 Kâr Kilidi)": statsLive.pf.toFixed(2),
      "Sabit TP/SL (Kâr Kilidi Yok, +5 TP / -3.5 SL)": statsFixed.pf.toFixed(2),
      "Trailing Stop (+2.5 Sonrası %1.5 Takip)": statsTrailing.pf.toFixed(2)
    }
  ]
  console.table(comparisonTable)

  fs.writeFileSync("pure_exit_rules_results.json", JSON.stringify({
    statsLive, bootLive, statsFixed, bootFixed, statsTrailing, bootTrailing,
    randomWinRates, randomAvgPnls, winRatePercentile, pnlPercentile
  }, null, 2))
}

main().catch(console.error)
