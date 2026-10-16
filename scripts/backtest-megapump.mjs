/**
 * MEGA PUMP & PARABOLİK ROKET STRATEJİSİ TESTİ (CANLIYA ASLA DOKUNMAZ)
 * ─────────────────────────────────────────────────────────────────────────────
 * Kullanıcı Talebi:
 * "günde %60 çıkan coinler var, öyle bi durum söz konusuysa hedef kârı kendine göre ayarla,
 * %5 gibi ufak şeylerle çıkmayalım, %45'ten çıkalım. AKE gibi %80 çıkıp sonra -%12'ye
 * çakılan coinlerde tepe satışını yakalayalım."
 * 
 * Strateji Mantığı:
 * 1. Mega Pump Algılama: Anormal balina hacmi (>= 2.5x), güçlü ivme ve yeşil mumlar.
 * 2. Dinamik Hedef Genişletme: Standart %2.5 yerine hedef %25 - %35 - %45'e kadar sürülür.
 * 3. Kademeli Zirve Koruma (Trailing Peak):
 *    - +%10 kârda stop: +%7.5 net kilit
 *    - +%20 kârda stop: +%16.5 net kilit
 *    - +%30 kârda stop: +%26.0 net kilit
 *    - +%40 kârda stop: +%35.5 net kilit
 *    - +%45 kârda: Tam Satış & Kâr Realizasyonu (%45 Hedef Vuruldu!)
 * 4. Ani Tepe Boşaltması (Dump Kalkanı):
 *    - Kâr %15'in üzerindeyken anormal tepe fitili (üst fitil > %45) veya sert kırmızı dönüşte
 *      hemen piyasadan satar; kârın -%12'ye erimesini kesin olarak engeller.
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

async function runMegaPumpTest() {
  console.log("================================================================================")
  console.log("  PIYASAIQ - MEGA PUMP (%45 HEDEF & TEPE BOŞALTMA KALKANI) TEST RAPORU")
  console.log("  (Salt-Okunur Binance Piyasa Verileriyle Canlıya Dokunmadan Test Ediliyor)")
  console.log("================================================================================\n")

  // Binance'deki tüm TRY çiftlerinden en yüksek volatiliteye sahip olanları tara
  const tickerRes = await fetch("https://api.binance.com/api/v3/ticker/24hr")
  const allTickers = await tickerRes.json()
  const tryTickers = allTickers
    .filter(t => t.symbol.endsWith("TRY") && parseFloat(t.quoteVolume) >= 500000)
    .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))

  // En yüksek hareketli 30 kripto parayı test portföyüne al
  const selectedCoins = tryTickers.slice(0, 30).map(t => ({
    symbol: t.symbol,
    name: t.symbol.replace("TRY", ""),
    change24h: parseFloat(t.priceChangePercent),
    volumeTRY: parseFloat(t.quoteVolume)
  }))

  console.log(`🔍 İncelenen Yüksek Volatiliteli Coin Sayısı: ${selectedCoins.length}`)
  console.log(`Örnek Volatil Coinler: ${selectedCoins.slice(0, 6).map(c => `${c.name} (%${c.change24h.toFixed(1)})`).join(", ")}\n`)

  const allTrades = []

  for (const coin of selectedCoins) {
    const candles = await fetchKlines(coin.symbol, "5m", 1000)
    if (!candles || candles.length < 100) continue

    const closes = candles.map(c => c.close)
    const rsis = calculateRSI(closes, 14)

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

        // 1. Dinamik Kâr Hedefi Belirleme (Mega Pump tespiti)
        const pastVols = candles.slice(i - 20, i).map(k => k.volume)
        const avgVol = pastVols.reduce((a, b) => a + b, 0) / (pastVols.length || 1)
        const curVolRatio = avgVol > 0 ? c.volume / avgVol : 1.0
        const curRsi = rsis[i] || 50
        const candle5mChange = ((c.close - c.open) / c.open) * 100

        // Mega Pump Şartı: Devasa Hacim (>= 2.5x) veya Süper İvme
        const isMegaPumpMode = currentTrade.isMegaPump || curVolRatio >= 2.8 || maxPnlPct >= 8.0 || candle5mChange >= 2.0
        if (isMegaPumpMode && !currentTrade.isMegaPump) {
          currentTrade.isMegaPump = true
        }

        // Dinamik Hedef:
        // Eğer Mega Pump modundaysa hedefi %45.00'e kadar sür!
        const targetPct = currentTrade.isMegaPump ? 45.00 : 2.50

        // 2. Kademeli Kâr Kilitleri (Asla kârı geri verme!)
        // a) +%1.20 kârda stop +%0.50 nete kilitlenir
        if (maxPnlPct >= 1.20) {
          const bePrice = entryPrice * 1.0050
          if (currentTrade.stopPrice < bePrice) currentTrade.stopPrice = bePrice
        }
        // b) +%2.50 aşıldığında stop +%2.10 nete kilitlenir
        if (maxPnlPct >= 2.50) {
          const lock25 = Math.max(entryPrice * 1.0210, currentTrade.highestPrice * 0.994)
          if (currentTrade.stopPrice < lock25) currentTrade.stopPrice = lock25
        }
        // c) +%5.0 aşıldığında stop +%4.0 nete kilitlenir
        if (maxPnlPct >= 5.00) {
          const lock5 = Math.max(entryPrice * 1.040, currentTrade.highestPrice * 0.985)
          if (currentTrade.stopPrice < lock5) currentTrade.stopPrice = lock5
        }
        // d) +%10.0 aşıldığında stop +%7.8 nete kilitlenir
        if (maxPnlPct >= 10.00) {
          const lock10 = Math.max(entryPrice * 1.078, currentTrade.highestPrice * 0.975)
          if (currentTrade.stopPrice < lock10) currentTrade.stopPrice = lock10
        }
        // e) +%20.0 aşıldığında stop +%16.5 nete kilitlenir
        if (maxPnlPct >= 20.00) {
          const lock20 = Math.max(entryPrice * 1.165, currentTrade.highestPrice * 0.970)
          if (currentTrade.stopPrice < lock20) currentTrade.stopPrice = lock20
        }
        // f) +%30.0 aşıldığında stop +%26.0 nete kilitlenir
        if (maxPnlPct >= 30.00) {
          const lock30 = Math.max(entryPrice * 1.260, currentTrade.highestPrice * 0.965)
          if (currentTrade.stopPrice < lock30) currentTrade.stopPrice = lock30
        }
        // g) +%40.0 aşıldığında stop +%36.0 nete kilitlenir
        if (maxPnlPct >= 40.00) {
          const lock40 = Math.max(entryPrice * 1.360, currentTrade.highestPrice * 0.960)
          if (currentTrade.stopPrice < lock40) currentTrade.stopPrice = lock40
        }

        // 3. %45 MEGA HEDEF VURUŞU
        if (highPrice >= entryPrice * (1 + targetPct / 100)) {
          allTrades.push({
            coin: coin.name,
            entryPrice,
            exitPrice: entryPrice * (1 + targetPct / 100),
            returnPct: targetPct,
            durationBars: i - currentTrade.startIndex,
            isWin: true,
            exitType: currentTrade.isMegaPump ? "MEGA_TP_45" : "STANDARD_TP_2.5",
            entryTime: currentTrade.entryTime,
            exitTime: c.time,
          })
          inTrade = false
          currentTrade = null
          continue
        }

        // 4. TEPE BOŞALTMA & ANİ SATIŞ KALKANI (Kullanıcı Örneği: AKE gibi tepe yapıp -%12'ye çakılmayı önle!)
        const upperWickRatio = (c.high - c.low) > 0 ? (c.high - Math.max(c.open, c.close)) / (c.high - c.low) : 0
        const isDumping = (maxPnlPct >= 12.0 && upperWickRatio > 0.45 && candle5mChange < -0.8) ||
                          (maxPnlPct >= 8.0 && candle5mChange <= -2.0 && curVolRatio >= 2.0)

        if (isDumping) {
          const exitPrice = curPrice
          const returnPct = pnlPct
          allTrades.push({
            coin: coin.name,
            entryPrice,
            exitPrice,
            returnPct,
            durationBars: i - currentTrade.startIndex,
            isWin: returnPct > 0,
            exitType: "PEAK_DUMP_PROTECTION_EXIT",
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
            coin: coin.name,
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

        // 6. Zaman Aşımı (3 saat sonra ivme bittiyse kârla kapat)
        const barsHeld = i - currentTrade.startIndex
        if (barsHeld >= 36 && pnlPct >= 0.20 && curVolRatio < 1.1) {
          allTrades.push({
            coin: coin.name,
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

      // Yeni Alım Taraması (Erken Aşama Balina Patlaması Tespiti)
      // AKE gibi %80'e çıkıp tepe yapan coinleri TEPE DÖNÜŞÜNDE DEĞİL, DİP/KIRILIM ANINDA YAKALA!
      if (!inTrade) {
        const change5m = prevC.close > 0 ? ((c.close - prevC.close) / prevC.close) * 100 : 0
        const rsi = rsis[i]
        const pastCandles20 = candles.slice(i - 20, i)
        const pastVols = pastCandles20.map(k => k.volume)
        const avgVol = pastVols.reduce((a, b) => a + b, 0) / (pastVols.length || 1)
        const volumeRatio = avgVol > 0 ? c.volume / avgVol : 1.0

        // 20 barlık konsolidasyon tavanı (Kırılım teyidi)
        const pastHigh20 = Math.max(...pastCandles20.map(k => k.high))
        const is20BarBreakout = c.close >= pastHigh20 * 0.998 // Tavan kırılımı

        const upperWickRatio = (c.high - c.low) > 0 ? (c.high - c.close) / (c.high - c.low) : 0

        // 🛡️ AKE TUZAĞI ENGELİ: 
        // 1. RSI >= 74 ise tepe şişmesidir, girme!
        // 2. 5m mumu yeşil olmalı (+0.20% ile +2.50% arası)
        // 3. Hacim patlaması en az 1.8x olmalı
        // 4. Kırılım tavanı delinmiş olmalı (konsolidasyondan patlama)
        const isGreen = change5m >= 0.20
        const isNotExhausted = change5m <= 2.80 && rsi >= 44 && rsi <= 72
        const isVolumeExplosion = volumeRatio >= 1.8
        const isNotUpperWick = upperWickRatio <= 0.35

        if (isGreen && isNotExhausted && isVolumeExplosion && is20BarBreakout && isNotUpperWick) {
          inTrade = true
          currentTrade = {
            coin: coin.name,
            startIndex: i,
            entryPrice: c.close,
            highestPrice: c.close,
            stopPrice: c.close * (1 - 0.0185),
            entryTime: c.time,
            isMegaPump: volumeRatio >= 2.5 // Dev balina hacmi
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

  // Çıkış Dağılımı
  const mega45Count = allTrades.filter(t => t.exitType === "MEGA_TP_45").length
  const megaTrailing = allTrades.filter(t => t.exitType === "MEGA_TRAILING_LOCK_WIN").length
  const peakProtects = allTrades.filter(t => t.exitType === "PEAK_DUMP_PROTECTION_EXIT").length
  const trailingLocks = allTrades.filter(t => t.exitType === "TRAILING_LOCK_WIN").length
  const beWins = allTrades.filter(t => t.exitType === "BREAKEVEN_WIN").length
  const stdTp = allTrades.filter(t => t.exitType === "STANDARD_TP_2.5").length
  const slCount = allTrades.filter(t => t.exitType === "STOP_LOSS").length

  // Portföy Tek Mermi Testi (Max 1 Slot)
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

  console.log("--------------------------------------------------------------------------------")
  console.log("📊 1️⃣ TEK MERMİ (CANLI BOT 2 PORTFÖY MODELİ) TESTİ")
  console.log("--------------------------------------------------------------------------------")
  console.log(`🎯 Toplam İşlem           : ${sTotal}`)
  console.log(`✅ Kazançla Kapanan       : ${sWins}`)
  console.log(`❌ Zararla Kapanan        : ${sLosses}`)
  console.log(`🏆 BAŞARI ORANI (WIN RATE): %${sWinRate.toFixed(2)}`)
  console.log(`💰 Kâr Faktörü (Profit F.): ${sProfitFactor.toFixed(2)}x`)
  console.log(`📈 Ortalama Kazanç       : +%${sAvgWin.toFixed(2)}`)
  console.log(`📉 Ortalama Kayıp        : -%${sAvgLoss.toFixed(2)}`)
  console.log(`💵 1.000 TL Bakiye Net Büyüme: ${sCapital.toFixed(2)} ₺ (+%${sGrowth.toFixed(2)})\n`)

  console.log("--------------------------------------------------------------------------------")
  console.log("🎯 2️⃣ TÜM İŞLEMLERDE ÇIKIŞ TİPİ DAĞILIMI (Toplam: " + totalTrades + " İşlem)")
  console.log("--------------------------------------------------------------------------------")
  console.log(`🔥 %45.00 Mega Hedef Vuruşu          : ${mega45Count} adet`)
  console.log(`🚀 Mega Trailing Kilitleri (+%7-%36) : ${megaTrailing} adet`)
  console.log(`🛡️ Tepe Boşaltma Kalkanı Kârı        : ${peakProtects} adet (Çöküşten önce zirvede kârı kurtaran)`)
  console.log(`⚡ Normal Trailing Kilitleri (+%2.1) : ${trailingLocks} adet`)
  console.log(`🎯 %2.50 Standart Hedef              : ${stdTp} adet`)
  console.log(`🛡️ Başabaş Koruması (+%0.50 Net)     : ${beWins} adet`)
  console.log(`❌ -%1.85 Stop Loss                  : ${slCount} adet`)
  console.log("================================================================================\n")
}

runMegaPumpTest().catch(console.error)
