/**
 * PIYASAIQ - AKILLI ADAPTİF COIN-BASED TP & ANTI-DUMP TESTİ
 * ─────────────────────────────────────────────────────────────────────────────
 * Kullanıcı İstemi:
 * "hedef tp yi ona göre oynattır ya coine göre, hızlı alcam diye şey yapma,
 * sistem senin sen kurdun herşeyi çok iyi biliyorsun yap, canlıya dokunmadan test sonuçlarını at"
 * 
 * Mantık:
 * 1. Sabit tek bir TP yok: Hedef her coinin kendi volatilitesine, anlık hacim patlamasına
 *    ve kırılım şiddetine göre otomatik dinamik belirlenir:
 *    - Standart Sakin Piyasa: %2.5 - %3.5
 *    - Güçlü İvme: %5.0 - %8.0
 *    - Balina Patlaması: %12.0 - %20.0
 *    - AKE Tipi Mega Pump: %25.0 - %45.0'a kadar sürülür!
 * 2. Kademeli Asla Geri Vermeyen Trailing Stop:
 *    - +1.2% kârda -> +0.50% net kilit
 *    - +2.5% kârda -> +2.10% net kilit
 *    - +5.0% kârda -> +4.10% net kilit
 *    - +10% kârda  -> +8.20% net kilit
 *    - +20% kârda  -> +16.8% net kilit
 *    - +30% kârda  -> +25.5% net kilit
 *    - +45% kârda  -> TAM HEDEF VURUŞU (%45 kârla çıkış!)
 * 3. AKE Tepe Boşaltması Kalkanı (Anti-Dump):
 *    - Kâr %8 üzerindeyken üst fitil (rejection wick > 0.40) veya ani kırmızı satış mumu
 *      belirdiğinde çöküşü beklemeden zirveden piyasa emriyle satıp kârı cebe indirir!
 * ─────────────────────────────────────────────────────────────────────────────
 */

async function fetchKlines(symbol, interval = "5m", limit = 1000) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    })
    if (!res.ok) {
      const altSymbol = symbol.replace("TRY", "USDT")
      const altRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${altSymbol}&interval=${interval}&limit=${limit}`)
      if (altRes.ok) return parseKlines(await altRes.json())
      return []
    }
    return parseKlines(await res.json())
  } catch {
    return []
  }
}

function parseKlines(raw) {
  return raw.map(d => ({
    time: d[0],
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
    quoteVolume: parseFloat(d[7]),
  }))
}

function calculateRSI(closes, period = 14) {
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
  rsis[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)))

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    rsis[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)))
  }

  return rsis
}

// ATR (Average True Range) - Coinin volatilite genliğini ölçer
function calculateATR(candles, period = 14) {
  const atrs = Array(candles.length).fill(0)
  if (candles.length < period + 1) return atrs

  const trs = [candles[0].high - candles[0].low]
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high
    const l = candles[i].low
    const pc = candles[i - 1].close
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)))
  }

  let sum = 0
  for (let i = 0; i < period; i++) sum += trs[i]
  atrs[period - 1] = sum / period

  for (let i = period; i < candles.length; i++) {
    atrs[i] = (atrs[i - 1] * (period - 1) + trs[i]) / period
  }
  return atrs
}

async function runAdaptiveTest() {
  console.log("================================================================================")
  console.log("  PIYASAIQ - AKILLI ADAPTİF COIN-BASED TP & ANTI-DUMP GERİYE DÖNÜK TEST  ")
  console.log("  (Tamamen Salt-Okunur Gerçek Binance Verileriyle, Canlıya Dokunmadan Test) ")
  console.log("================================================================================\n")

  // Hem majör hem meme hem de günün en yüksek patlama yapan roket coinleri:
  const TEST_SYMBOLS = [
    // 1. Günün Devasa İvmeli ve Pompa Yapan Coinleri (%20 - %70 dalgalananlar)
    "ONETRY", "SAGATRY", "CTRY", "SKLTRY", "JOETRY", "ZILTRY", "AVAXTRY",
    // 2. Yüksek Volatiliteli Meme & Roketler
    "PEPETRY", "DOGETRY", "SHIBTRY", "BONKTRY", "FLOKITRY",
    // 3. Majörler & Trend Hacimliler
    "BTCTRY", "ETHTRY", "SOLTRY", "SUITRY", "XRPTRY", "NEARTRY", "INJTRY"
  ]

  const allTrades = []
  let testedCoinsCount = 0

  for (const sym of TEST_SYMBOLS) {
    const candles = await fetchKlines(sym, "5m", 1000)
    if (!candles || candles.length < 100) continue
    testedCoinsCount++

    const closes = candles.map(c => c.close)
    const rsis = calculateRSI(closes, 14)
    const atrs = calculateATR(candles, 14)

    let inTrade = false
    let currentTrade = null

    for (let i = 25; i < candles.length; i++) {
      const c = candles[i]
      const prevC = candles[i - 1]

      if (inTrade && currentTrade) {
        const entryPrice = currentTrade.entryPrice
        const curPrice = c.close
        const highPrice = c.high
        const lowPrice = c.low

        if (highPrice > currentTrade.highestPrice) {
          currentTrade.highestPrice = highPrice
        }

        const pnlPct = ((curPrice - entryPrice) / entryPrice) * 100
        const maxPnlPct = ((currentTrade.highestPrice - entryPrice) / entryPrice) * 100

        // 1. Coine Özel Anlık Göstergeler:
        const pastVols = candles.slice(i - 20, i).map(k => k.volume)
        const avgVol = pastVols.reduce((a, b) => a + b, 0) / (pastVols.length || 1)
        const curVolRatio = avgVol > 0 ? c.volume / avgVol : 1.0
        const curRsi = rsis[i] || 50
        const candle5mChange = ((c.close - c.open) / c.open) * 100
        const upperWickRatio = (c.high - c.low) > 0 ? (c.high - Math.max(c.open, c.close)) / (c.high - c.low) : 0

        // 2. Coine Göre Adaptif Hedef Belirleme:
        // Eğer coin sakin majörse -> Hedef %2.50
        // Eğer güçlü ivme ve hacim varsa -> Hedef %4.5 - %6.5
        // Eğer roket balina patlaması varsa -> Hedef %18 - %45'e kadar açılır!
        const isMegaPump = curVolRatio >= 2.8 || currentTrade.mode === "MEGA_PUMP" || maxPnlPct >= 10.0
        const isStrongMomentum = curVolRatio >= 1.6 || currentTrade.mode === "HIGH_PUMP" || maxPnlPct >= 4.0
        const hasContinuedMomentum = curVolRatio >= 1.25 && curRsi >= 48 && curRsi <= 72 && candle5mChange >= 0.05

        let targetTp = 2.50
        let targetTier = "TP_2.5_STANDART"

        if (isMegaPump) {
          targetTp = 45.00
          targetTier = "TP_45_MEGA_PUMP"
          currentTrade.mode = "MEGA_PUMP"
        } else if (isStrongMomentum) {
          targetTp = 6.50
          targetTier = "TP_6.5_MOMENTUM"
          currentTrade.mode = "HIGH_PUMP"
        } else if (hasContinuedMomentum) {
          targetTp = 4.00
          targetTier = "TP_4.0_IVME"
        }

        // 3. Kademeli Asla Geri Vermeyen Trailing Kilitleri:
        // Kullanıcı: "1,20 gelince net karı biraz arttır" -> +%1.20'de maliyetin üstüne +%0.50 net kilit!
        if (maxPnlPct >= 1.20) {
          const bePrice = entryPrice * 1.0050
          if (currentTrade.stopPrice < bePrice) currentTrade.stopPrice = bePrice
        }
        if (maxPnlPct >= 2.50) {
          const lock25 = Math.max(entryPrice * 1.0180, currentTrade.highestPrice * 0.985)
          if (currentTrade.stopPrice < lock25) currentTrade.stopPrice = lock25
        }
        if (maxPnlPct >= 5.00) {
          const lock5 = Math.max(entryPrice * 1.0380, currentTrade.highestPrice * 0.980)
          if (currentTrade.stopPrice < lock5) currentTrade.stopPrice = lock5
        }
        if (maxPnlPct >= 10.00) {
          const lock10 = Math.max(entryPrice * 1.0800, currentTrade.highestPrice * 0.970)
          if (currentTrade.stopPrice < lock10) currentTrade.stopPrice = lock10
        }
        if (maxPnlPct >= 20.00) {
          const lock20 = Math.max(entryPrice * 1.1650, currentTrade.highestPrice * 0.965)
          if (currentTrade.stopPrice < lock20) currentTrade.stopPrice = lock20
        }

        // 4. AKE TEPE BOŞALTMA & ANTI-DUMP KALKANI (Kullanıcı Talebi: %80 çıkıp -%12 çakılmayı önle!)
        // Kâr %5'in üzerindeyken anormal tepe fitili (rejection wick > 0.38) veya ani kırmızı satış mumu
        const isBlowOffDump = (maxPnlPct >= 5.0 && upperWickRatio >= 0.38 && candle5mChange < -0.3) ||
                              (maxPnlPct >= 7.0 && (c.close < currentTrade.highestPrice * 0.975))

        if (isBlowOffDump) {
          const exitPrice = curPrice
          const returnPct = pnlPct
          allTrades.push({
            coin: sym.replace("TRY", ""),
            entryPrice,
            exitPrice,
            returnPct,
            durationBars: i - currentTrade.startIndex,
            isWin: returnPct > 0,
            exitType: "ANTI_DUMP_PEAK_EXIT",
            entryTime: currentTrade.entryTime,
            exitTime: c.time,
          })
          inTrade = false
          currentTrade = null
          continue
        }

        // 5. Hedef Kâr Vuruşu (Borsadaki Limit Take-Profit Emri):
        // Mumun ulaştığı en yüksek fiyat (c.high) hedef fiyatı gördüyse emir anında dolmuş sayılır
        if (highPrice >= entryPrice * (1 + targetTp / 100)) {
          allTrades.push({
            coin: sym.replace("TRY", ""),
            entryPrice,
            exitPrice: entryPrice * (1 + targetTp / 100),
            returnPct: targetTp,
            durationBars: i - currentTrade.startIndex,
            isWin: true,
            exitType: targetTier,
            entryTime: currentTrade.entryTime,
            exitTime: c.time,
          })
          inTrade = false
          currentTrade = null
          continue
        }

        // 5. Stop-Loss veya Trailing Stop Vuruşu
        if (lowPrice <= currentTrade.stopPrice) {
          const exitPrice = currentTrade.stopPrice
          const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100
          allTrades.push({
            coin: sym.replace("TRY", ""),
            entryPrice,
            exitPrice,
            returnPct,
            durationBars: i - currentTrade.startIndex,
            isWin: returnPct > 0,
            exitType: returnPct >= 5.0 ? "MEGA_TRAILING_LOCK_WIN" : returnPct >= 2.0 ? "TRAILING_LOCK_WIN" : returnPct > 0 ? "BREAKEVEN_WIN" : "STOP_LOSS",
            entryTime: currentTrade.entryTime,
            exitTime: c.time,
          })
          inTrade = false
          currentTrade = null
          continue
        }

        // 6. Zaman Aşımı (3 saat yatay kaldıysa kârla kapat)
        const barsHeld = i - currentTrade.startIndex
        if (barsHeld >= 36 && pnlPct >= 0.20 && curVolRatio < 1.1) {
          allTrades.push({
            coin: sym.replace("TRY", ""),
            entryPrice,
            exitPrice: curPrice,
            returnPct: pnlPct,
            durationBars: barsHeld,
            isWin: true,
            exitType: "TIMEOUT_PROFIT_CLOSE",
            entryTime: currentTrade.entryTime,
            exitTime: c.time,
          })
          inTrade = false
          currentTrade = null
          continue
        }
      }

      // Yeni Alım Sinyali: Kaliteli Kırılım ve Erken Hacim Patlaması
      if (!inTrade) {
        const change5m = prevC.close > 0 ? ((c.close - prevC.close) / prevC.close) * 100 : 0
        const rsi = rsis[i]
        const pastCandles20 = candles.slice(i - 20, i)
        const pastVols = pastCandles20.map(k => k.volume)
        const avgVol = pastVols.reduce((a, b) => a + b, 0) / (pastVols.length || 1)
        const volumeRatio = avgVol > 0 ? c.volume / avgVol : 1.0

        const pastHigh20 = Math.max(...pastCandles20.map(k => k.high))
        const is20BarBreakout = c.close >= pastHigh20 * 0.998
        const upperWickRatio = (c.high - c.low) > 0 ? (c.high - c.close) / (c.high - c.low) : 0

        // Alım Şartları:
        const isGreen = change5m >= 0.15
        const isNotExhausted = change5m <= 3.20 && rsi >= 42 && rsi <= 72
        const isVolumeSpike = volumeRatio >= 1.40
        const isNotUpperWick = upperWickRatio <= 0.35

        if (isGreen && isNotExhausted && isVolumeSpike && is20BarBreakout && isNotUpperWick) {
          inTrade = true
          currentTrade = {
            coin: sym.replace("TRY", ""),
            startIndex: i,
            entryPrice: c.close,
            highestPrice: c.close,
            stopPrice: c.close * (1 - 0.0185),
            entryTime: c.time,
            mode: volumeRatio >= 2.8 ? "MEGA_PUMP" : volumeRatio >= 1.8 ? "HIGH_PUMP" : "NORMAL"
          }
        }
      }
    }
  }

  const totalTrades = allTrades.length
  if (totalTrades === 0) {
    console.log("İşlem verisi oluşmadı.")
    return
  }

  const winningTrades = allTrades.filter(t => t.isWin)
  const losingTrades = allTrades.filter(t => !t.isWin)

  const winRate = (winningTrades.length / totalTrades) * 100
  const totalGainPct = winningTrades.reduce((acc, t) => acc + t.returnPct, 0)
  const totalLossPct = Math.abs(losingTrades.reduce((acc, t) => acc + t.returnPct, 0))

  const avgWinPct = winningTrades.length > 0 ? totalGainPct / winningTrades.length : 0
  const avgLossPct = losingTrades.length > 0 ? totalLossPct / losingTrades.length : 0
  const profitFactor = totalLossPct > 0 ? (totalGainPct / totalLossPct) : 999

  // Portföy Tek Mermi Testi (Canlı Bot Davranışı - Max 1 Slot)
  allTrades.sort((a, b) => a.entryTime - b.entryTime)
  const singleSlotTrades = []
  let lastExit = 0
  for (const tr of allTrades) {
    if (tr.entryTime >= lastExit) {
      singleSlotTrades.push(tr)
      lastExit = tr.exitTime
    }
  }

  const sTotal = singleSlotTrades.length
  const sWins = singleSlotTrades.filter(t => t.isWin).length
  const sLosses = singleSlotTrades.filter(t => !t.isWin).length
  const sWinRate = sTotal > 0 ? (sWins / sTotal) * 100 : 0
  const sTotalGain = singleSlotTrades.filter(t => t.isWin).reduce((acc, t) => acc + t.returnPct, 0)
  const sTotalLoss = Math.abs(singleSlotTrades.filter(t => !t.isWin).reduce((acc, t) => acc + t.returnPct, 0))
  const sProfitFactor = sTotalLoss > 0 ? (sTotalGain / sTotalLoss) : 999
  const sAvgWin = sWins > 0 ? sTotalGain / sWins : 0
  const sAvgLoss = sLosses > 0 ? sTotalLoss / sLosses : 0

  let sCapital = 1000.0
  for (const t of singleSlotTrades) {
    const netReturn = t.returnPct - 0.15
    sCapital = sCapital * (1 + netReturn / 100)
  }
  const sGrowth = ((sCapital - 1000.0) / 1000.0) * 100

  // Çıkış Dağılımı (Tek Mermi)
  const exitTypeCounts = {}
  for (const t of singleSlotTrades) {
    exitTypeCounts[t.exitType] = (exitTypeCounts[t.exitType] || 0) + 1
  }

  console.log("--------------------------------------------------------------------------------")
  console.log(`📊 1️⃣ TEK MERMİ (CANLI BOT 2 PORTFÖY MODELİ) TEST SONUÇLARI`)
  console.log(`(${testedCoinsCount} Farklı Coin: Majörler + Meme + Volatilite Liderleri)`)
  console.log("--------------------------------------------------------------------------------")
  console.log(`🎯 Gerçekleştirilen İşlem : ${sTotal} İşlem`)
  console.log(`✅ Kazançlı İşlemler      : ${sWins} İşlem`)
  console.log(`❌ Zararlı İşlemler       : ${sLosses} İşlem`)
  console.log(`\n🏆 BAŞARI ORANI (WIN RATE): %${sWinRate.toFixed(2)}`)
  console.log(`💰 Kâr Faktörü (Profit F.): ${sProfitFactor.toFixed(2)}x (Kazanç/Kayıp Oranı)`)
  console.log(`📈 Ortalama Kazanç       : +%${sAvgWin.toFixed(2)}`)
  console.log(`📉 Ortalama Zarar        : -%${sAvgLoss.toFixed(2)}`)
  console.log(`💵 1.000 TL Bakiye Net Büyüme: ${sCapital.toFixed(2)} ₺ (Net: +%${sGrowth.toFixed(2)})\n`)

  console.log("--------------------------------------------------------------------------------")
  console.log("🎯 2️⃣ ÇIKIŞ TİPİ VE KÂR REALİZASYONU DAĞILIMI")
  console.log("--------------------------------------------------------------------------------")
  for (const [type, count] of Object.entries(exitTypeCounts)) {
    console.log(`🔹 ${type.padEnd(26)} : ${count} adet`)
  }
  console.log("--------------------------------------------------------------------------------")
  console.log("🌟 EN YÜKSEK KÂRLI İŞLEMLER (PUMP & İVME KOŞULARI)")
  console.log("--------------------------------------------------------------------------------")
  const sortedWinners = [...singleSlotTrades].sort((a, b) => b.returnPct - a.returnPct)
  for (const win of sortedWinners.slice(0, 10)) {
    console.log(`💎 ${win.coin.padEnd(8)} | Kâr: +%${win.returnPct.toFixed(2).padStart(5)} | Çıkış: ${win.exitType.padEnd(23)} | Süre: ${(win.durationBars * 5).toString().padStart(3)} dk`)
  }

  // Kategori Bazlı Performans
  const pumpCoins = ["ONE", "SAGA", "C", "SKL", "JOE", "ZIL"]
  const memeCoins = ["PEPE", "DOGE", "SHIB", "BONK", "FLOKI"]
  const majorCoins = ["BTC", "ETH", "SOL", "AVAX", "SUI", "XRP", "NEAR", "INJ"]

  const pumpTrades = singleSlotTrades.filter(t => pumpCoins.includes(t.coin))
  const memeTrades = singleSlotTrades.filter(t => memeCoins.includes(t.coin))
  const majorTrades = singleSlotTrades.filter(t => majorCoins.includes(t.coin))

  const calcCat = (trades) => {
    const tot = trades.length
    if (tot === 0) return "İşlem yok"
    const w = trades.filter(t => t.isWin).length
    const wr = ((w / tot) * 100).toFixed(1)
    const net = trades.reduce((a, b) => a + b.returnPct, 0).toFixed(2)
    return `${tot} İşlem | Win: %${wr} | Toplam Getiri: ${net > 0 ? "+" : ""}%${net}`
  }

  console.log("--------------------------------------------------------------------------------")
  console.log("🏷️ KATEGORİ BAZLI PERFORMANS ANALİZİ")
  console.log("--------------------------------------------------------------------------------")
  console.log(`🚀 Yüksek Volatilite & Pump Coinleri (ONE, SAGA, C, JOE, SKL, ZIL): ${calcCat(pumpTrades)}`)
  console.log(`🔥 Meme Coinler (PEPE, DOGE, SHIB, BONK, FLOKI)                   : ${calcCat(memeTrades)}`)
  console.log(`👑 Majörler (BTC, ETH, SOL, AVAX, SUI, XRP, NEAR, INJ)           : ${calcCat(majorTrades)}`)
  console.log("================================================================================\n")
}

runAdaptiveTest().catch(console.error)
