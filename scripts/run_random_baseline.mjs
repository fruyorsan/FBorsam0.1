import fs from "fs"

const SYMBOLS = [
  "STRKUSDT", "TIAUSDT", "LUMIAUSDT", "INJUSDT", "SUIUSDT",
  "RENDERUSDT", "UNIUSDT", "NEARUSDT", "APTUSDT", "DOGEUSDT",
  "SOLUSDT", "ENAUSDT"
]

const LIMIT_PER_REQ = 1000
const TOTAL_CANDLES = 2880
const LEVERAGE = 10
const MARGIN_USDT = 5 // 50 USDT / 10x
const REAL_COST_PCT = 0.18 // 0.10% commission + 0.08% slippage

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
        close: parseFloat(d[4])
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

function simulateExit(candleStream, startIdx, entryPrice) {
  let highestPrice = entryPrice
  let passedProfitLock = false

  for (let i = startIdx; i < candleStream.length; i++) {
    const candle = candleStream[i]
    highestPrice = Math.max(highestPrice, candle.high)
    const peakGain = ((highestPrice - entryPrice) / entryPrice) * 100
    const rawDiffLow = ((candle.low - entryPrice) / entryPrice) * 100
    const rawDiffHigh = ((candle.high - entryPrice) / entryPrice) * 100
    const rawDiffClose = ((candle.close - entryPrice) / entryPrice) * 100

    if (peakGain >= 1.5) passedProfitLock = true

    // Mevcut çıkış kuralı
    if (rawDiffLow <= -3.5 && !passedProfitLock) {
      const exitPrice = entryPrice * (1 - 0.035)
      return { exitPrice, reason: "STOP_LOSS" }
    } else if (passedProfitLock && rawDiffLow <= 1.5) {
      const exitPrice = entryPrice * (1 + 0.015)
      return { exitPrice, reason: "PROFIT_LOCK_STOP" }
    } else if (peakGain >= 2.8 && rawDiffLow <= (peakGain - 0.85)) {
      const exitPrice = entryPrice * (1 + (peakGain - 0.85) / 100)
      return { exitPrice, reason: "TRAILING_STOP" }
    } else if (rawDiffHigh >= 5.0) {
      const exitPrice = entryPrice * (1 + 0.05)
      return { exitPrice, reason: "TAKE_PROFIT" }
    } else if ((i - startIdx) >= 24 && rawDiffClose >= 0.5) {
      return { exitPrice: candle.close, reason: "TIME_ROTATION" }
    }
  }

  // End of data
  const lastC = candleStream[candleStream.length - 1]
  return { exitPrice: lastC.close, reason: "DATA_END" }
}

async function run() {
  console.log("Loading candle data for 12 coins...")
  const marketData = {}
  for (const s of SYMBOLS) {
    marketData[s] = await fetchHistoricalKlines(s, TOTAL_CANDLES)
  }
  const minLen = Math.min(...SYMBOLS.map(s => marketData[s].length))
  console.log(`Candles loaded: ${minLen} per coin.`)

  const N_TRADES_TARGET = 697 // Same sample size as signal backtest
  const NUM_RANDOM_SETS = 100
  const randomSetResults = []

  console.log(`Running ${NUM_RANDOM_SETS} Monte Carlo random entry sets (N=${N_TRADES_TARGET} trades each)...`)

  for (let r = 0; r < NUM_RANDOM_SETS; r++) {
    const trades = []
    for (let k = 0; k < N_TRADES_TARGET; k++) {
      const randSym = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
      const stream = marketData[randSym]
      // Random bar between 35 and minLen - 50
      const randIdx = 35 + Math.floor(Math.random() * (minLen - 85))
      const entryPrice = stream[randIdx].close
      const exit = simulateExit(stream, randIdx, entryPrice)

      const grossReturnPct = ((exit.exitPrice - entryPrice) / entryPrice) * 100
      const netReturnPct = grossReturnPct - REAL_COST_PCT
      const netRoi = netReturnPct * LEVERAGE
      const netPnl = (MARGIN_USDT * netRoi) / 100
      trades.push({ netPnl, grossReturnPct })
    }

    const wins = trades.filter(t => t.netPnl > 0)
    const winRate = (wins.length / trades.length) * 100
    const totalPnl = trades.reduce((a, b) => a + b.netPnl, 0)
    const avgPnl = totalPnl / trades.length
    randomSetResults.push({ winRate, totalPnl, avgPnl })
  }

  const winRates = randomSetResults.map(r => r.winRate)
  const avgPnls = randomSetResults.map(r => r.avgPnl)

  const meanRandomWinRate = winRates.reduce((a, b) => a + b, 0) / NUM_RANDOM_SETS
  const minRandomWinRate = Math.min(...winRates)
  const maxRandomWinRate = Math.max(...winRates)

  const meanRandomAvgPnl = avgPnls.reduce((a, b) => a + b, 0) / NUM_RANDOM_SETS
  const minRandomAvgPnl = Math.min(...avgPnls)
  const maxRandomAvgPnl = Math.max(...avgPnls)

  console.log("\n=======================================================")
  console.log("🎲 RASTGELE GİRİŞ (MONTE CARLO) VS STRATEJİ SİNYALİ")
  console.log("=======================================================")
  console.log(`Simülasyon Set Sayısı: ${NUM_RANDOM_SETS}`)
  console.log(`Set Başına İşlem Sayısı: ${N_TRADES_TARGET}`)
  console.log(`Maliyet Modeli: %0.18 (%0.10 komisyon + %0.08 kayma)`)
  console.log(`Çıkış Kuralı: Mevcut Kurallar (Birebir Aynı)\n`)

  console.log(`📌 RASTGELE GİRİŞLERİN SONUÇLARI:`)
  console.log(`- Ortalama Kazanma Oranı: %${meanRandomWinRate.toFixed(2)} (Min: %${minRandomWinRate.toFixed(2)}, Max: %${maxRandomWinRate.toFixed(2)})`)
  console.log(`- İşlem Başına Ortalama Net PnL: ${meanRandomAvgPnl.toFixed(4)} USDT (Min: ${minRandomAvgPnl.toFixed(4)}, Max: ${maxRandomAvgPnl.toFixed(4)})`)

  console.log(`\n📌 BOTUN STRATEJİ SİNYALİ SONUÇLARI:`)
  console.log(`- Strateji Kazanma Oranı: %75.04`)
  console.log(`- Strateji İşlem Başı Ort. Net PnL: -0.0370 USDT`)

  fs.writeFileSync("random_entry_results.json", JSON.stringify({
    numSets: NUM_RANDOM_SETS,
    tradesPerSet: N_TRADES_TARGET,
    meanRandomWinRate,
    minRandomWinRate,
    maxRandomWinRate,
    meanRandomAvgPnl,
    minRandomAvgPnl,
    maxRandomAvgPnl,
    allSets: randomSetResults
  }, null, 2))
}

run().catch(console.error)
