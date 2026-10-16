import fs from "fs"

const COINS = [
  "BTC", "ETH", "SOL", "BNB", "XRP",
  "SUI", "AVAX", "NEAR", "APT", "ARB", "LINK", "TIA", "GALA",
  "DOGE", "PEPE", "FLOKI"
]

const MEME_COINS = new Set(["DOGE", "PEPE", "FLOKI", "BONK", "SHIB", "WIF"])
const MAJOR_COINS = new Set(["BTC", "ETH", "BNB", "SOL"])

async function fetchKlines(symbol, interval = "15m", limit = 1000) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data.map((d) => ({
      time: d[0],
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
      quoteVolume: parseFloat(d[7]),
      count: d[8],
      takerBuyQuoteVolume: parseFloat(d[10]),
    }))
  } catch {
    return []
  }
}

function calcEMA(values, period) {
  if (values.length === 0) return []
  const k = 2 / (period + 1)
  const ema = [values[0]]
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k))
  }
  return ema
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return Array(closes.length).fill(50)
  const rsis = Array(closes.length).fill(50)
  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses += Math.abs(diff)
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  rsis[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    rsis[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return rsis
}

// Simülasyon Motoru Fonksiyonu
function runSimulation(marketData, mode = "BASELINE") {
  const coinList = Object.keys(marketData)
  const numCandles = marketData[coinList[0]].length
  const initialBalance = 1000
  let balance = initialBalance
  let positions = [] // Max 2 slot
  const closedTrades = []
  let pendingOrders = [] // Bekleyen limit pusuları

  // En yüksek ve en düşük bakiye takibi (Drawdown)
  let peakBalance = initialBalance
  let maxDrawdownPct = 0

  for (let i = 35; i < numCandles; i++) {
    const currentTimestamp = marketData[coinList[0]][i].time

    // 1. BEKLEYEN LİMİT EMİRLERİ DENETLE
    const remainingPending = []
    for (const po of pendingOrders) {
      const candle = marketData[po.symbol][i]
      po.ageBars = (po.ageBars || 0) + 1

      // Limit emrin dolması için mumun LOW değerinin limit alış fiyatına veya altına inmesi gerekir
      const isFilled = candle.low <= po.price

      if (isFilled) {
        // Doldu! Pozisyona dönüştür
        positions.push({
          id: `pos-${po.symbol}-${po.price}-${i}`,
          symbol: po.symbol,
          entryPrice: po.price,
          currentPrice: po.price,
          highestPrice: po.price,
          amount: po.allocatedCapital / po.price,
          allocatedCapital: po.allocatedCapital,
          tpPrice: po.tpPrice,
          slPrice: po.slPrice,
          openBar: i,
          partialSold: false,
          partialPnl: 0,
        })
      } else {
        // Dolmadı: Zaman aşımı kontrolü
        const timeoutBars = mode === "PROPOSAL_1_2" ? 2 : 1 // 1 bar = ~15m (Canlıda 60s vs 90s)
        if (po.ageBars >= timeoutBars) {
          // İptal et, sermayeyi kasaya iade et
          balance += po.allocatedCapital
        } else {
          remainingPending.push(po)
        }
      }
    }
    pendingOrders = remainingPending

    // 2. MEVCUT AÇIK POZİSYONLARI TAKİP ET & ÇIKIŞLARI DEĞERLENDİR
    const remainingPositions = []
    for (const pos of positions) {
      const candle = marketData[pos.symbol][i]
      pos.highestPrice = Math.max(pos.highestPrice, candle.high)
      pos.currentPrice = candle.close

      const pnlHighPct = ((pos.highestPrice - pos.entryPrice) / pos.entryPrice) * 100
      const pnlCurrentPct = ((candle.close - pos.entryPrice) / pos.entryPrice) * 100
      const pnlLowPct = ((candle.low - pos.entryPrice) / pos.entryPrice) * 100

      let closed = false
      let exitPrice = candle.close
      let exitReason = ""

      // A) TP Kontrolü
      if (candle.high >= pos.tpPrice) {
        closed = true
        exitPrice = pos.tpPrice
        exitReason = "TAKE_PROFIT"
      }
      // B) Kademeli Breakeven / Trailing: SMART_HYBRID_3'te kâr +%1.20'yi gördüyse stopu maliyete (+%0.3 net) çek!
      else if ((mode === "SMART_HYBRID_3" ? pnlHighPct >= 1.2 : pnlHighPct >= 2.0) && candle.low <= pos.entryPrice * 1.003) {
        closed = true
        exitPrice = pos.entryPrice * 1.003
        exitReason = "BREAKEVEN_PROTECT"
      }
      // C) SL Kontrolü
      else if (candle.low <= pos.slPrice) {
        closed = true
        exitPrice = pos.slPrice
        exitReason = "STOP_LOSS"
      }
      // D) Zaman Stopu (6 saat boyunca kâr alamadıysa ve pnl nötrse kapat)
      else if ((mode === "PROPOSAL_1_2" || mode === "SMART_HYBRID_3") && (i - pos.openBar) >= 24 && pnlCurrentPct < 0.8) {
        closed = true
        exitPrice = candle.close
        exitReason = "TIME_STOP"
      }

      if (closed) {
        const netReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100
        const profitTry = (pos.allocatedCapital * netReturnPct) / 100
        balance += pos.allocatedCapital + profitTry

        closedTrades.push({
          symbol: pos.symbol,
          entryPrice: pos.entryPrice,
          exitPrice,
          returnPct: netReturnPct,
          profitTry,
          exitReason,
          durationBars: i - pos.openBar,
          openBar: pos.openBar,
          closeBar: i,
        })
      } else {
        remainingPositions.push(pos)
      }
    }
    positions = remainingPositions

    // Bakiye ve Drawdown güncellemesi
    const activeValue = positions.reduce((sum, p) => sum + p.allocatedCapital * (p.currentPrice / p.entryPrice), 0)
    const pendingValue = pendingOrders.reduce((sum, po) => sum + po.allocatedCapital, 0)
    const currentEquity = balance + activeValue + pendingValue
    if (currentEquity > peakBalance) peakBalance = currentEquity
    const currentDd = ((peakBalance - currentEquity) / peakBalance) * 100
    if (currentDd > maxDrawdownPct) maxDrawdownPct = currentDd

    // 3. YENİ COİN TARAMASI & ALIM KARARI
    const maxSlots = 2
    const currentSlotCount = positions.length + pendingOrders.length
    if (currentSlotCount >= maxSlots || balance < 50) continue

    const candidates = []

    for (const sym of coinList) {
      if (positions.some((p) => p.symbol === sym)) continue
      if (pendingOrders.some((po) => po.symbol === sym)) continue

      const klines = marketData[sym].slice(0, i + 1)
      const currentKline = klines[klines.length - 1]
      const prevKline = klines[klines.length - 2]
      const prev2Kline = klines[klines.length - 3]

      const closes = klines.map((k) => k.close)
      const ema9 = calcEMA(closes, 9)
      const ema20 = calcEMA(closes, 20)
      const rsiArr = calcRSI(closes, 14)

      const curPrice = currentKline.close
      const curEma9 = ema9[ema9.length - 1]
      const curEma20 = ema20[ema20.length - 1]
      const curRsi = rsiArr[rsiArr.length - 1]

      // Çift yeşil mum kontrolü
      const isCurGreen = currentKline.close >= currentKline.open
      const isPrevGreen = prevKline.close >= prevKline.open
      const isDoubleGreen = isCurGreen && isPrevGreen

      // EMA üstü kontrolü
      const isAboveEma = curPrice >= curEma9 && curPrice >= curEma20

      // Hacim ve Taker oranı
      const past20Vols = klines.slice(-21, -1).map((k) => k.quoteVolume)
      const avgVol = past20Vols.reduce((a, b) => a + b, 0) / (past20Vols.length || 1)
      const volRatio = avgVol > 0 ? currentKline.quoteVolume / avgVol : 1
      const takerRatio = currentKline.quoteVolume > 0 ? (currentKline.takerBuyQuoteVolume / currentKline.quoteVolume) * 100 : 50

      // Bollinger & Wick
      const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20
      const variance = closes.slice(-20).reduce((sum, c) => sum + Math.pow(c - sma20, 2), 0) / 20
      const stdDev = Math.sqrt(variance)
      const upperBand = sma20 + 2 * stdDev
      const lowerBand = sma20 - 2 * stdDev
      const bollingerB = (upperBand - lowerBand) > 0 ? (curPrice - lowerBand) / (upperBand - lowerBand) : 0.5
      const upperWick = currentKline.high - Math.max(currentKline.open, currentKline.close)
      const body = Math.abs(currentKline.close - currentKline.open) || (curPrice * 0.001)

      // Genel Tepe & FOMO Filtresi (Her iki modda da aktif - güvenlik)
      if (curRsi >= 68 || bollingerB > 0.90 || upperWick > body * 1.5) continue

      let score = 0
      let isWhale = false
      let isMegaWhale = false

      if (volRatio >= 2.0 && isCurGreen && takerRatio >= 53) {
        isMegaWhale = true
        isWhale = true
        score += 55
      } else if (volRatio >= 1.4 && isCurGreen && takerRatio >= 51) {
        isWhale = true
        score += 35
      }

      // ── MOD A: BASELINE (MEVCUT CANLI SISTEM - KATI FILTRE) ──
      if (mode === "BASELINE") {
        if (!isAboveEma) continue // KATI KURAL 1: EMA altındaysa drop
        if (!isDoubleGreen) continue // KATI KURAL 2: Çift yeşil yoksa drop
        if (takerRatio < 52) continue // KATI KURAL 3: Taker %52 altındaysa drop

        if (isCurGreen) score += 20
        if (curRsi >= 45 && curRsi <= 62) score += 20
        if (takerRatio >= 54) score += 15
        if (MEME_COINS.has(sym)) score += 10
        if (MAJOR_COINS.has(sym)) score += 15

        // Eşik
        const threshold = currentSlotCount === 1 ? 115 : 95
        if (score < threshold) continue

        candidates.push({
          symbol: sym,
          score,
          price: currentKline.close,
          bidPrice: currentKline.open * 0.999, // Best bid simülasyonu
          isMegaWhale,
          isWhale,
        })
      }
      // ── MOD B: PROPOSAL 1 & 2 (DINAMIK SKOR + PUANLAMA BAZLI FILTRE) ──
      else if (mode === "PROPOSAL_1_2") {
        if (isAboveEma) score += 30
        else if (curPrice >= curEma9) score += 15

        if (isDoubleGreen) score += 25
        else if (isCurGreen) score += 10

        if (takerRatio >= 54) score += 25
        else if (takerRatio >= 50) score += 15
        else score -= 15

        if (curRsi >= 40 && curRsi <= 62) score += 20
        if (MEME_COINS.has(sym)) score += 10
        if (MAJOR_COINS.has(sym)) score += 15

        let threshold = currentSlotCount === 1 ? 100 : 88
        if (isMegaWhale) threshold = 78
        else if (isWhale) threshold = 82

        if (score < threshold) continue

        candidates.push({
          symbol: sym,
          score,
          price: currentKline.close,
          bidPrice: (currentKline.close + currentKline.low) / 2,
          isMegaWhale,
          isWhale,
        })
      }
      // ── MOD C: SMART_HYBRID_3 (DİNAMİK PUANLAMA + BTC TREND KORUMASI + %2.5 STOP) ──
      else if (mode === "SMART_HYBRID_3") {
        let btcIsDropping = false
        if (marketData["BTC"]) {
          const btcKlines = marketData["BTC"].slice(0, i + 1)
          const btcCloses = btcKlines.map((k) => k.close)
          const btcEma = calcEMA(btcCloses, 20)
          if (btcCloses[btcCloses.length - 1] < btcEma[btcEma.length - 1]) {
            btcIsDropping = true
          }
        }

        // BTC trendi zayıfken veya ayıdayken sadece gerçek Balina (isWhale / isMegaWhale) varsa gir
        if (btcIsDropping && !isWhale && !isMegaWhale && sym !== "BTC") continue

        if (isAboveEma) score += 30
        else if (curPrice >= curEma9) score += 15

        if (isDoubleGreen) score += 25
        else if (isCurGreen) score += 10

        if (takerRatio >= 54) score += 25
        else if (takerRatio >= 50) score += 15
        else score -= 15

        if (curRsi >= 40 && curRsi <= 60) score += 20
        if (MEME_COINS.has(sym)) score += 10
        if (MAJOR_COINS.has(sym)) score += 15

        let threshold = currentSlotCount === 1 ? 100 : 88
        if (isMegaWhale) threshold = 78
        else if (isWhale) threshold = 82

        if (score < threshold) continue

        candidates.push({
          symbol: sym,
          score,
          price: currentKline.close,
          bidPrice: (currentKline.close + currentKline.low) / 2,
          isMegaWhale,
          isWhale,
        })
      }
    }

    // En iyi adayı seç
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score)
      const best = candidates[0]

      const slotsRemaining = maxSlots - currentSlotCount
      const slotBudget = Math.floor(balance / slotsRemaining)
      const buyAmount = Math.min(slotBudget, balance * 0.95)

      if (buyAmount >= 50) {
        balance -= buyAmount
        const limitEntryPrice = best.bidPrice
        const isMeme = MEME_COINS.has(best.symbol)
        const tpPct = best.isMegaWhale ? 8.5 : best.isWhale ? 7.0 : isMeme ? 6.5 : 5.0
        const slPct = mode === "SMART_HYBRID_3" ? 2.5 : 3.5

        pendingOrders.push({
          symbol: best.symbol,
          price: limitEntryPrice,
          allocatedCapital: buyAmount,
          tpPrice: limitEntryPrice * (1 + tpPct / 100),
          slPrice: limitEntryPrice * (1 - slPct / 100),
          ageBars: 0,
        })
      }
    }
  }

  // Sonuç Hesaplama
  const totalTrades = closedTrades.length
  const winningTrades = closedTrades.filter((t) => t.returnPct > 0)
  const losingTrades = closedTrades.filter((t) => t.returnPct <= 0)
  const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0

  const totalGrossProfit = winningTrades.reduce((sum, t) => sum + t.profitTry, 0)
  const totalGrossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.profitTry, 0))
  const profitFactor = totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : totalGrossProfit > 0 ? 99 : 0
  const finalEquity = balance + positions.reduce((sum, p) => sum + p.allocatedCapital, 0)
  const netReturnPct = ((finalEquity - initialBalance) / initialBalance) * 100

  const avgTradeDuration = totalTrades > 0 ? closedTrades.reduce((sum, t) => sum + t.durationBars, 0) / totalTrades : 0

  return {
    mode,
    initialBalance,
    finalEquity: Number(finalEquity.toFixed(2)),
    netReturnPct: Number(netReturnPct.toFixed(2)),
    totalTrades,
    wins: winningTrades.length,
    losses: losingTrades.length,
    winRate: Number(winRate.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    avgTradeDurationBars: Number(avgTradeDuration.toFixed(1)),
    totalGrossProfit: Number(totalGrossProfit.toFixed(2)),
    totalGrossLoss: Number(totalGrossLoss.toFixed(2)),
    trades: closedTrades,
  }
}

async function main() {
  console.log("================================================================================")
  console.log("🔬 GERÇEK PİYASA VERİSİ İLE CİDDİ KARŞILAŞTIRMA BACKTESTİ (BORU DEĞİL TESTİ)")
  console.log("================================================================================")
  console.log("Binance üzerinden 16 coin için son 1000 mum (15 dakikalık ~10.5 gün) çekiliyor...")

  const marketData = {}
  for (const sym of COINS) {
    const klines = await fetchKlines(sym, "15m", 1000)
    if (klines.length >= 100) {
      marketData[sym] = klines
      process.stdout.write(`✓ ${sym} `)
    } else {
      process.stdout.write(`✗ ${sym} `)
    }
  }
  console.log("\nVeri çekimi tamamlandı. Testler başlatılıyor...\n")

  // 1. MEVCUT DURUM (A SİSTEMİ)
  const resBaseline = runSimulation(marketData, "BASELINE")

  // 2. ÖNERİ 1 VE 2 UYGULANMIŞ DURUM (B SİSTEMİ)
  const resProposal = runSimulation(marketData, "PROPOSAL_1_2")

  // 3. AKILLI HİBRİT KORUMALI SİSTEM (C SİSTEMİ)
  const resSmartHybrid = runSimulation(marketData, "SMART_HYBRID_3")

  console.log("--------------------------------------------------------------------------------")
  console.log("📊 15 DAKİKALIK (10.5 GÜN) KARŞILAŞTIRMA TABLOSU:")
  console.log("--------------------------------------------------------------------------------")
  console.table([
    {
      "Strateji": "Sistem A (Mevcut Canlı - Katı Filtre)",
      "İşlem": resBaseline.totalTrades,
      "Win": resBaseline.wins,
      "Loss": resBaseline.losses,
      "Win Rate": `%${resBaseline.winRate}`,
      "Profit Factor": resBaseline.profitFactor,
      "Maks DD": `%${resBaseline.maxDrawdownPct}`,
      "Net Getiri": `%${resBaseline.netReturnPct}`,
      "Son Bakiye": `${resBaseline.finalEquity} TL`,
    },
    {
      "Strateji": "Sistem B (1 ve 2 - Dinamik Puanlama)",
      "İşlem": resProposal.totalTrades,
      "Win": resProposal.wins,
      "Loss": resProposal.losses,
      "Win Rate": `%${resProposal.winRate}`,
      "Profit Factor": resProposal.profitFactor,
      "Maks DD": `%${resProposal.maxDrawdownPct}`,
      "Net Getiri": `%${resProposal.netReturnPct}`,
      "Son Bakiye": `${resProposal.finalEquity} TL`,
    },
    {
      "Strateji": "Sistem C (Akıllı Hibrit - Koruma + Dar Stop)",
      "İşlem": resSmartHybrid.totalTrades,
      "Win": resSmartHybrid.wins,
      "Loss": resSmartHybrid.losses,
      "Win Rate": `%${resSmartHybrid.winRate}`,
      "Profit Factor": resSmartHybrid.profitFactor,
      "Maks DD": `%${resSmartHybrid.maxDrawdownPct}`,
      "Net Getiri": `%${resSmartHybrid.netReturnPct}`,
      "Son Bakiye": `${resSmartHybrid.finalEquity} TL`,
    },
  ])

  // 2. 30 GÜNLÜK (1 SAATLİK MUM) BÜYÜK RESİM TESTİ
  console.log("\n================================================================================")
  console.log("🔭 30 GÜNLÜK (720 SAAT) BÜYÜK RESİM PİYASA TESTİ (AYI + BOĞA + YATAY DÖNEMLER)")
  console.log("================================================================================")
  console.log("Binance üzerinden 16 coin için 720 saatlik (1h) veri çekiliyor...")

  const marketData1h = {}
  for (const sym of COINS) {
    const klines = await fetchKlines(sym, "1h", 720)
    if (klines.length >= 100) {
      marketData1h[sym] = klines
      process.stdout.write(`✓ ${sym} `)
    } else {
      process.stdout.write(`✗ ${sym} `)
    }
  }
  console.log("\n1 Saatlik veri çekimi tamamlandı. Testler başlatılıyor...\n")

  const resBaseline1h = runSimulation(marketData1h, "BASELINE")
  const resProposal1h = runSimulation(marketData1h, "PROPOSAL_1_2")
  const resSmartHybrid1h = runSimulation(marketData1h, "SMART_HYBRID_3")

  console.log("--------------------------------------------------------------------------------")
  console.log("📊 30 GÜNLÜK (1h) SONUÇ TABLOSU:")
  console.log("--------------------------------------------------------------------------------")
  console.table([
    {
      "Strateji (30 Günlük)": "Sistem A (Mevcut Canlı - Katı Filtre)",
      "İşlem": resBaseline1h.totalTrades,
      "Win": resBaseline1h.wins,
      "Loss": resBaseline1h.losses,
      "Win Rate": `%${resBaseline1h.winRate}`,
      "Profit Factor": resBaseline1h.profitFactor,
      "Maks DD": `%${resBaseline1h.maxDrawdownPct}`,
      "Net Getiri": `%${resBaseline1h.netReturnPct}`,
      "Son Bakiye": `${resBaseline1h.finalEquity} TL`,
    },
    {
      "Strateji (30 Günlük)": "Sistem B (1 ve 2 - Dinamik Puanlama)",
      "İşlem": resProposal1h.totalTrades,
      "Win": resProposal1h.wins,
      "Loss": resProposal1h.losses,
      "Win Rate": `%${resProposal1h.winRate}`,
      "Profit Factor": resProposal1h.profitFactor,
      "Maks DD": `%${resProposal1h.maxDrawdownPct}`,
      "Net Getiri": `%${resProposal1h.netReturnPct}`,
      "Son Bakiye": `${resProposal1h.finalEquity} TL`,
    },
    {
      "Strateji (30 Günlük)": "Sistem C (Akıllı Hibrit - Koruma + Dar Stop)",
      "İşlem": resSmartHybrid1h.totalTrades,
      "Win": resSmartHybrid1h.wins,
      "Loss": resSmartHybrid1h.losses,
      "Win Rate": `%${resSmartHybrid1h.winRate}`,
      "Profit Factor": resSmartHybrid1h.profitFactor,
      "Maks DD": `%${resSmartHybrid1h.maxDrawdownPct}`,
      "Net Getiri": `%${resSmartHybrid1h.netReturnPct}`,
      "Son Bakiye": `${resSmartHybrid1h.finalEquity} TL`,
    },
  ])

  // Detaylı analiz çıktısını JSON olarak da kaydet
  fs.writeFileSync(
    "scripts/backtest_comparison_results.json",
    JSON.stringify({ 
      test15m_10d: { baseline: resBaseline, proposal: resProposal },
      test1h_30d: { baseline: resBaseline1h, proposal: resProposal1h }
    }, null, 2)
  )
  console.log("\nTüm sonuçlar 'scripts/backtest_comparison_results.json' dosyasına kaydedildi.")
}

main()
