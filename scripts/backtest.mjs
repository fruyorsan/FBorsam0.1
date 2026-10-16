/**
 * OFFLINE STRATEGY BACKTESTER (CANLIYA ASLA DOKUNMAZ)
 * ─────────────────────────────────────────────────────────────────────────────
 * Bu script tamamen salt-okunur (read-only) Binance piyasa mum verilerini çeker.
 * Canlı Binance TR hesabına, API anahtarlarına veya yayındaki bota DOKUNMAZ.
 * 
 * Test Edilen Strateji:
 * - Baz Hedef Kâr (TP): +%2.50
 * - Dinamik Potansiyel Genişlemesi: +%4.00, +%5.00, +%6.00
 * - Korumalı Stop Loss (SL): -%1.85
 * - Başabaş Koruması (BE): +%1.20'de stop +%0.25 nete kilitlenir
 * - Kademeli Trailing Kilitleri: 
 *     +%2.50 aşıldığında stop en az +%2.10
 *     +%3.80 aşıldığında stop en az +%3.20
 *     +%4.80 aşıldığında stop en az +%4.20
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TEST_COINS = [
  { symbol: "PEPETRY", name: "PEPE" },
  { symbol: "DOGETRY", name: "DOGE" },
  { symbol: "SHIBTRY", name: "SHIB" },
  { symbol: "BONKTRY", name: "BONK" },
  { symbol: "FLOKITRY", name: "FLOKI" },
  { symbol: "SOLTRY", name: "SOL" },
  { symbol: "AVAXTRY", name: "AVAX" },
  { symbol: "SUITRY", name: "SUI" },
  { symbol: "BTCTRY", name: "BTC" },
  { symbol: "ETHTRY", name: "ETH" },
  { symbol: "XRPTRY", name: "XRP" },
  { symbol: "NEATRY", name: "NEAR" },
  { symbol: "TIATRY", name: "TIA" },
  { symbol: "APTTRY", name: "APT" },
  { symbol: "ARBTRY", name: "ARB" },
  { symbol: "WIFTRY", name: "WIF" }
]

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

async function fetchCandles(symbol, interval = "5m", limit = 1000) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    })
    if (!res.ok) {
      // Alternatif USDT çiftini dene (TRY likiditesi Binance.com'da yoksa)
      const altSymbol = symbol.replace("TRY", "USDT")
      const altRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${altSymbol}&interval=${interval}&limit=${limit}`)
      if (altRes.ok) {
        const altData = await altRes.json()
        return parseKlines(altData)
      }
      return []
    }
    const data = await res.json()
    return parseKlines(data)
  } catch (err) {
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

async function runBacktest() {
  console.log("================================================================================")
  console.log("  PIYASAIQ - BOT 2 DİNAMİK POTANSİYEL (%2.50 -> %4 / %5 / %6) GERİYE DÖNÜK TEST  ")
  console.log("  (Salt-Okunur Binance Verileri Üzerinden Gerçekleştiriliyor, Canlıya Dokunmaz) ")
  console.log("================================================================================\n")

  const allTrades = []
  let testedCoinsCount = 0

  for (const coin of TEST_COINS) {
    const candles = await fetchCandles(coin.symbol, "5m", 1000)
    if (!candles || candles.length < 100) {
      continue
    }
    testedCoinsCount++

    const closes = candles.map(c => c.close)
    const rsis = calculateRSI(closes, 14)

    // Simülasyon döngüsü
    let inTrade = false
    let currentTrade = null

    for (let i = 25; i < candles.length; i++) {
      const c = candles[i]
      const prevC = candles[i - 1]

      // Aktif işlem takibi
      if (inTrade && currentTrade) {
        const entryPrice = currentTrade.entryPrice
        const curPrice = c.close
        const highPrice = c.high
        const lowPrice = c.low

        // En yüksek fiyatı güncelle
        if (highPrice > currentTrade.highestPrice) {
          currentTrade.highestPrice = highPrice
        }

        const pnlPct = ((curPrice - entryPrice) / entryPrice) * 100
        const maxPnlPct = ((currentTrade.highestPrice - entryPrice) / entryPrice) * 100

        // 1. Potansiyel Belirleme (Önce mevcut piyasa koşuluna göre hedefi belirle)
        const pastVols = candles.slice(i - 20, i).map(k => k.volume)
        const avgVol = pastVols.reduce((a, b) => a + b, 0) / (pastVols.length || 1)
        const curVolRatio = avgVol > 0 ? c.volume / avgVol : 1.0
        const curRsi = rsis[i] || 50
        const candle5mChange = ((c.close - c.open) / c.open) * 100

        // Potansiyel Seviyeleri (İvme, hacim ve yeşil mum desteğine göre)
        const hasLevel3 = curVolRatio >= 2.2 && curRsi >= 50 && curRsi <= 74 && candle5mChange >= 0.20
        const hasLevel2 = hasLevel3 || (curVolRatio >= 1.6 && candle5mChange >= 0.15 && curRsi >= 48)
        const hasLevel1 = hasLevel2 || (curVolRatio >= 1.25 && candle5mChange >= 0.05 && curRsi >= 45)

        let dynamicTargetPct = 2.50
        let targetTier = "TP_2.5_STANDARD"

        if (hasLevel3) {
          dynamicTargetPct = 6.00
          targetTier = "TP_6.0_MEGA"
        } else if (hasLevel2) {
          dynamicTargetPct = 5.00
          targetTier = "TP_5.0_STRONG"
        } else if (hasLevel1) {
          dynamicTargetPct = 4.00
          targetTier = "TP_4.0_MOMENTUM"
        }

        // 2. Kâr Hedefine Ulaşma Kontrolü (Mumun tavanı hedefe vurdu mu?)
        const targetPrice = entryPrice * (1 + dynamicTargetPct / 100)
        const baseTpPrice = entryPrice * 1.025

        if (highPrice >= targetPrice) {
          allTrades.push({
            coin: coin.name,
            entryPrice,
            exitPrice: targetPrice,
            returnPct: dynamicTargetPct,
            durationBars: i - currentTrade.startIndex,
            isWin: true,
            exitType: targetTier,
            entryTime: currentTrade.entryTime,
            exitTime: c.time,
          })
          inTrade = false
          currentTrade = null
          continue
        } else if (highPrice >= baseTpPrice && !hasLevel1) {
          // İvme yetersiz, baz hedef %2.50'de kârı al
          allTrades.push({
            coin: coin.name,
            entryPrice,
            exitPrice: baseTpPrice,
            returnPct: 2.50,
            durationBars: i - currentTrade.startIndex,
            isWin: true,
            exitType: "TP_2.5_STANDARD",
            entryTime: currentTrade.entryTime,
            exitTime: c.time,
          })
          inTrade = false
          currentTrade = null
          continue
        }

        // 3. Breakeven & Trailing Stop Kilitleri
        // +%1.20 kârda stop +%0.45 net kâra kilitlenir
        if (maxPnlPct >= 1.20) {
          const bePrice = entryPrice * 1.0045
          if (currentTrade.stopPrice < bePrice) {
            currentTrade.stopPrice = bePrice
          }
        }

        // Trailing kilitleri (Hedef 4, 5, 6 beklenirken geri düşüşe karşı kârı garantiye al)
        if (maxPnlPct >= 2.50) {
          const lock25 = Math.max(entryPrice * 1.0210, currentTrade.highestPrice * 0.994)
          if (currentTrade.stopPrice < lock25) currentTrade.stopPrice = lock25
        }
        if (maxPnlPct >= 3.80) {
          const lock38 = Math.max(entryPrice * 1.0320, currentTrade.highestPrice * 0.993)
          if (currentTrade.stopPrice < lock38) currentTrade.stopPrice = lock38
        }
        if (maxPnlPct >= 4.80) {
          const lock48 = Math.max(entryPrice * 1.0420, currentTrade.highestPrice * 0.992)
          if (currentTrade.stopPrice < lock48) currentTrade.stopPrice = lock48
        }

        // 4. Stop-Loss Kontrolü (Mumun en düşüğü stop seviyesinin altına indi mi?)
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
            exitType: returnPct >= 2.0 ? "TRAILING_LOCK_WIN" : returnPct > 0 ? "BREAKEVEN_WIN" : "STOP_LOSS",
            entryTime: currentTrade.entryTime,
            exitTime: c.time,
          })
          inTrade = false
          currentTrade = null
          continue
        }

        // 5. Zaman Aşımı Kuralı (3 saat = 36 adet 5m mum): İvme söndüyse kârla kapat
        const barsHeld = i - currentTrade.startIndex
        if (barsHeld >= 36) {
          if (pnlPct >= 0.20 && (curVolRatio < 1.1 || curRsi < 50)) {
            const exitPrice = curPrice
            const returnPct = pnlPct
            allTrades.push({
              coin: coin.name,
              entryPrice,
              exitPrice,
              returnPct,
              durationBars: barsHeld,
              isWin: returnPct > 0,
              exitType: "TIMEOUT_PROFIT_CLOSE",
              entryTime: currentTrade.entryTime,
              exitTime: c.time,
            })
            inTrade = false
            currentTrade = null
            continue
          }
        }
      }

      // Yeni Alım Sinyali Taraması
      if (!inTrade) {
        const change5m = prevC.close > 0 ? ((c.close - prevC.close) / prevC.close) * 100 : 0
        const rsi = rsis[i]

        const pastVols = candles.slice(i - 20, i).map(k => k.volume)
        const avgVol = pastVols.reduce((a, b) => a + b, 0) / (pastVols.length || 1)
        const volumeRatio = avgVol > 0 ? c.volume / avgVol : 1.0

        const high = c.high
        const low = c.low
        const close = c.close
        const upperWickRatio = (high - low) > 0 ? (high - close) / (high - low) : 0

        // Botun Alım Kriterleri:
        const isGreen = change5m >= 0.05
        const isNotFomo = change5m <= 2.80
        const isVolumeSpike = volumeRatio >= 1.25
        const isRsiHealthy = rsi >= 40 && rsi <= 70
        const isNotUpperWick = upperWickRatio <= 0.40

        if (isGreen && isNotFomo && isVolumeSpike && isRsiHealthy && isNotUpperWick) {
          inTrade = true
          currentTrade = {
            coin: coin.name,
            startIndex: i,
            entryPrice: c.close,
            highestPrice: c.close,
            stopPrice: c.close * (1 - 0.0185), // -%1.85 Başlangıç SL
            entryTime: c.time,
          }
        }
      }
    }
  }

  // İSTATİSTİKLER VE BAŞARI ORANI
  const totalTrades = allTrades.length
  if (totalTrades === 0) {
    console.log("Yeterli işlem verisi oluşmadı.")
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
  const tp6Count = allTrades.filter(t => t.exitType === "TP_6.0_MEGA").length
  const tp5Count = allTrades.filter(t => t.exitType === "TP_5.0_STRONG").length
  const tp4Count = allTrades.filter(t => t.exitType === "TP_4.0_MOMENTUM").length
  const tp25Count = allTrades.filter(t => t.exitType === "STANDARD_TP_2.5").length
  const trailingLocks = allTrades.filter(t => t.exitType === "TRAILING_LOCK_WIN").length
  const beWins = allTrades.filter(t => t.exitType === "BREAKEVEN_WIN").length
  const timeouts = allTrades.filter(t => t.exitType === "TIMEOUT_PROFIT_CLOSE").length
  const slCount = allTrades.filter(t => t.exitType === "STOP_LOSS").length

  // Kümülatif Kâr Büyümesi Simülasyonu (1000 TL Sermaye ile)
  let capital = 1000.0
  for (const t of allTrades) {
    const netReturn = t.returnPct - 0.15 // Alış + satış komisyonu düşülmüş net
    capital = capital * (1 + netReturn / 100)
  }
  const netTotalReturnPct = ((capital - 1000.0) / 1000.0) * 100

  console.log("--------------------------------------------------------------------------------")
  console.log(`📊 TEST SONUÇLARI ÖZETİ (${testedCoinsCount} Kripto Para / Son 1000 Bar 5m Verisi)`)
  console.log("--------------------------------------------------------------------------------")
  console.log(`🎯 Toplam İşlem Sayısı   : ${totalTrades}`)
  console.log(`✅ Kazanan İşlemler      : ${winningTrades.length}`)
  console.log(`❌ Kaybeden İşlemler     : ${losingTrades.length}`)
  console.log(`\n🏆 BAŞARI ORANI (WIN RATE): %${winRate.toFixed(2)}`)
  console.log(`💰 Kâr Faktörü (Profit F.): ${profitFactor.toFixed(2)}x (Kazanç/Kayıp Oranı)`)
  console.log(`📈 Ortalama Kazanç       : +%${avgWinPct.toFixed(2)}`)
  console.log(`📉 Ortalama Kayıp        : -%${avgLossPct.toFixed(2)}`)
  console.log(`💵 1.000 TL Bakiye Sonucu: ${capital.toFixed(2)} ₺ (Net Büyüme: +%${netTotalReturnPct.toFixed(2)})\n`)

  // ─────────────────────────────────────────────────────────────────────────────
  // TEK MERMİ (PORTFÖY) SİMÜLASYONU: Gerçek Bot 2 gibi aynı anda sadece 1 pozisyon
  // ─────────────────────────────────────────────────────────────────────────────
  // Tüm sinyalleri zamana göre diz
  allTrades.sort((a, b) => a.entryTime - b.entryTime)

  const singleSlotTrades = []
  let lastExitTime = 0

  for (const trade of allTrades) {
    if (trade.entryTime >= lastExitTime) {
      singleSlotTrades.push(trade)
      lastExitTime = trade.exitTime
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
    const netReturn = t.returnPct - 0.15 // Komisyon kesintisi
    sCapital = sCapital * (1 + netReturn / 100)
  }
  const sGrowthPct = ((sCapital - 1000.0) / 1000.0) * 100

  console.log("================================================================================")
  console.log("  🎯 TEK MERMİ (BOT 2 CANLI DAVRANIŞI) PORTFÖY TESTİ (Max 1 Pozisyon)")
  console.log("================================================================================")
  console.log(`🎯 Gerçekleştirilen İşlem : ${sTotal}`)
  console.log(`✅ Kazançlı İşlemler      : ${sWins}`)
  console.log(`❌ Zararlı İşlemler       : ${sLosses}`)
  console.log(`🏆 BAŞARI ORANI (WIN RATE): %${sWinRate.toFixed(2)}`)
  console.log(`💰 Kâr Faktörü (Profit F.): ${sProfitFactor.toFixed(2)}x`)
  console.log(`📈 Ortalama Kazanç       : +%${sAvgWin.toFixed(2)}`)
  console.log(`📉 Ortalama Zarar        : -%${sAvgLoss.toFixed(2)}`)
  console.log(`💵 1.000 TL Bakiye Net Büyüme: ${sCapital.toFixed(2)} ₺ (+%${sGrowthPct.toFixed(2)})\n`)
  console.log("================================================================================\n")
}

runBacktest()
