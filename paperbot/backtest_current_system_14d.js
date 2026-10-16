const fs = require('fs');

const COINS = [
  'APT', 'SUI', 'DYDX', 'ENA', 'DOGE', 'PEPE', 'SOL', 'AVAX', 'NEAR', 'RENDER', 'FET', 'TIA', 'ARB', 'FLOKI', 'LINK'
];

const MEME_COINS = new Set(['DOGE', 'PEPE', 'FLOKI', 'WIF', 'BONK', 'SHIB', 'TURBO', 'NEIRO']);
const MAJOR_COINS = new Set(['BTC', 'ETH', 'BNB', 'SOL']);

async function fetchKlines(symbol) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1h&limit=336`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data.map(k => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[7]),
    takerBuyVol: parseFloat(k[10])
  }));
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

async function runBacktest() {
  console.log('14 Günlük Binance Gerçek Mum Verileri İndiriliyor...');
  const marketData = {};
  for (const sym of COINS) {
    const klines = await fetchKlines(sym);
    if (klines && klines.length >= 100) {
      marketData[sym] = klines;
    }
  }

  const validCoins = Object.keys(marketData);
  console.log(`${validCoins.length} adet Tier-1 & DeFi coinin son 14 günlük (336 saat) verisi hazır.`);

  // Simülasyon Değişkenleri
  let balance = 1000; // 1000 TL başlangıç kasası
  let initialBalance = 1000;
  let positions = []; // Max 2 slot
  let closedTrades = [];

  const totalHours = marketData[validCoins[0]].length;
  // İlk 30 saati indikatör ısıtması için kullanıyoruz
  for (let t = 30; t < totalHours; t++) {
    const currentTimestamp = marketData[validCoins[0]][t].time;

    // 1. AÇIK POZİSYONLARI KONTROL ET VE ÇIKIŞLARI DEĞERLENDİR
    const remainingPositions = [];
    for (const pos of positions) {
      const kline = marketData[pos.symbol][t];
      const highPrice = kline.high;
      const lowPrice = kline.low;
      const closePrice = kline.close;

      pos.holdingHours += 1;
      pos.highestPrice = Math.max(pos.highestPrice, highPrice);
      
      const pnlHighPct = ((pos.highestPrice - pos.entryPrice) / pos.entryPrice) * 100;
      const pnlCurrentPct = ((closePrice - pos.entryPrice) / pos.entryPrice) * 100;

      const isMeme = MEME_COINS.has(pos.symbol);
      const isMajor = MAJOR_COINS.has(pos.symbol);
      const stage1Pct = isMajor ? 0.95 : isMeme ? 1.40 : 1.25;
      const fullTpPct = isMajor ? 1.85 : isMeme ? 3.50 : 2.80;

      let isClosed = false;
      let closeReason = '';
      let exitPrice = closePrice;

      // Akıllı 1. Kademe Çıkış Kontrolü
      if (!pos.partialSold && pnlHighPct >= stage1Pct) {
        // Zirveden hafif gevşeme veya tavan sınırında %50 sat
        const dropFromPeak = pnlHighPct - pnlCurrentPct;
        if (dropFromPeak >= 0.15 || pnlCurrentPct >= stage1Pct * 1.45) {
          pos.partialSold = true;
          const stage1GainPct = Math.min(pnlHighPct, stage1Pct * 1.25);
          const freedCash = (pos.allocatedCapital * 0.5) * (1 + stage1GainPct / 100);
          pos.allocatedCapital = pos.allocatedCapital * 0.5;
          balance += freedCash; // Nakit kasaya döndü, 2. slot için açıldı!
          pos.stopLossPct = 0.30; // Komisyonu (%0.20) aşan net kârlı koruma stopu!
        }
      }

      // Tam Kâr Kontrolü (2. Kademe)
      if (pnlHighPct >= fullTpPct) {
        isClosed = true;
        exitPrice = pos.entryPrice * (1 + fullTpPct / 100);
        closeReason = `🎯 Tam Hedef Kâr (+%${fullTpPct.toFixed(2)})`;
      }
      // Trailing Kâr Kontrolü (+%1.80 aşıldığında zirveden %0.40 geri çekilme)
      else if (pnlHighPct >= 1.80 && (pnlHighPct - pnlCurrentPct) >= 0.40) {
        isClosed = true;
        exitPrice = closePrice;
        closeReason = `🚀 Trailing Kâr Kilitlendi (+%${pnlCurrentPct.toFixed(2)})`;
      }
      // Stop Loss Kontrolü (-%2.00)
      else if (pnlCurrentPct <= pos.stopLossPct || ((lowPrice - pos.entryPrice) / pos.entryPrice) * 100 <= pos.stopLossPct) {
        isClosed = true;
        exitPrice = pos.entryPrice * (1 + pos.stopLossPct / 100);
        closeReason = pos.stopLossPct >= 0 ? `🛡️ Başabaş Stop Koruması (+%${pos.stopLossPct})` : `🛑 Stop Loss (%${pos.stopLossPct})`;
      }
      // Yatay Pozisyon Rotasyonu (En az 6 saat ve SADECE pozitif kârda - asla zararına satma!)
      else if (pos.holdingHours >= 6 && !pos.partialSold && pnlCurrentPct >= 0.15 && pnlCurrentPct <= 0.60) {
        isClosed = true;
        exitPrice = closePrice;
        closeReason = `⏳ 6s Yatay Kâr Kapatma (+%${pnlCurrentPct.toFixed(2)})`;
      }

      if (isClosed) {
        const finalPnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const rawTradePnlPct = pos.partialSold
          ? (stage1Pct * 0.5) + (finalPnlPct * 0.5)
          : finalPnlPct;
        const feePct = 0.20; // %0.20 Binance Alış + Satış Taker Komisyonu
        const totalTradePnlPct = rawTradePnlPct - feePct;
        const returnTry = pos.allocatedCapital * (1 + finalPnlPct / 100) * (1 - 0.001); // Satış komisyonu düşülür
        balance += returnTry;

        closedTrades.push({
          symbol: pos.symbol,
          entryTime: pos.entryTime,
          exitTime: new Date(currentTimestamp).toISOString().slice(5, 16),
          entryPrice: pos.entryPrice,
          exitPrice,
          pnlPct: totalTradePnlPct,
          reason: closeReason,
          isWin: totalTradePnlPct > 0
        });
      } else {
        remainingPositions.push(pos);
      }
    }
    positions = remainingPositions;

    // 2. YENİ İŞLEM ARAMA (2 SLOT MİMARİSİ)
    // 0 slot varsa veya 1 slot olup o da partialSold yapmışsa yeni işlem açılabilir
    const canOpenSlot = positions.length === 0 || (positions.length === 1 && positions[0].partialSold === true);
    
    if (canOpenSlot && balance >= 50 && positions.length < 2) {
      // Bütün coinleri analiz et ve puanla
      const candidates = [];
      for (const sym of validCoins) {
        // Halihazırda pozisyonda varsa atla
        if (positions.some(p => p.symbol === sym)) continue;

        const klines = marketData[sym].slice(0, t + 1);
        const closes = klines.map(k => k.close);
        const lastClose = closes[closes.length - 1];
        const prevClose = closes[closes.length - 2];
        const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const isAboveSma20 = lastClose >= sma20;

        const rsi = calcRSI(closes, 14);

        // KESİN KURAL 1: RSI >= 58 ASLA ALMA
        if (rsi >= 58) continue;

        // KESİN KURAL 0: Son mumda %2.5 fırlamış mumu alma
        const lastCandleGain = ((lastClose - prevClose) / prevClose) * 100;
        if (lastCandleGain > 2.5) continue;

        // Balina & Hacim Radarı
        const past22 = klines.slice(-24, -2);
        const avgPastVol = past22.reduce((s, k) => s + k.volume, 0) / (past22.length || 1);
        const completedKline = klines[klines.length - 2];
        const volRatio = avgPastVol > 0 ? completedKline.volume / avgPastVol : 1;
        const takerBuyRatio = completedKline.volume > 0 ? (completedKline.takerBuyVol / completedKline.volume) * 100 : 50;

        let score = 50;
        if (MEME_COINS.has(sym)) score += 20;
        else score += 25; // Tier-1 & DeFi

        if (volRatio >= 2.0 && takerBuyRatio >= 54) score += 45;
        else if (volRatio >= 1.35 && takerBuyRatio >= 52) score += 30;
        else if (volRatio >= 1.15) score += 15;

        // Pullback / Soğuma Alımı
        if (isAboveSma20 && rsi >= 35 && rsi <= 52 && lastCandleGain <= 0.4) {
          score += 40;
        } else if (rsi < 35) {
          score += 35;
        } else if (isAboveSma20) {
          score += 20;
        }

        if (score >= 80) {
          candidates.push({ symbol: sym, price: lastClose, score });
        }
      }

      candidates.sort((a, b) => b.score - a.score);

      if (candidates.length > 0) {
        const topCandidate = candidates[0];
        // Kasa Yönetimi: 2 slot dengeli dağılım
        const capitalToUse = positions.length === 0 ? balance * 0.55 : balance * 0.90;
        balance -= capitalToUse;

        positions.push({
          symbol: topCandidate.symbol,
          entryPrice: topCandidate.price,
          entryTime: new Date(currentTimestamp).toISOString().slice(5, 16),
          allocatedCapital: capitalToUse * (1 - 0.001), // Alış komisyonu düşülür
          highestPrice: topCandidate.price,
          holdingHours: 0,
          partialSold: false,
          stopLossPct: -2.00
        });
      }
    }
  }

  // SONUÇLARIN DERLENMESİ
  const wins = closedTrades.filter(t => t.isWin);
  const losses = closedTrades.filter(t => !t.isWin);
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

  const totalWinPnl = wins.reduce((sum, t) => sum + t.pnlPct, 0);
  const totalLossPnl = losses.reduce((sum, t) => sum + Math.abs(t.pnlPct), 0);
  const profitFactor = totalLossPnl > 0 ? (totalWinPnl / totalLossPnl) : 999;
  // Açık kalan pozisyonları son fiyatla portföy değerine ekle
  let openPositionsValue = 0;
  for (const pos of positions) {
    const lastKline = marketData[pos.symbol][totalHours - 1];
    const markPrice = lastKline.close;
    const pnl = ((markPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const curVal = pos.allocatedCapital * (1 + pnl / 100);
    openPositionsValue += curVal;
  }
  const totalEquity = balance + openPositionsValue;
  const netReturnPct = ((totalEquity - initialBalance) / initialBalance) * 100;

  console.log('\n============================================================');
  console.log('       GÜNCEL HİBRİT OTOMASYON 14 GÜNLÜK BACKTEST RAPORU    ');
  console.log('============================================================');
  console.log('📅 Test Edilen Zaman Aralığı : Son 14 Gün (13 - 27 Eylül)');
  console.log('🎯 Test Edilen Coin Havuzu   : 15 Tier-1 & DeFi Protokolü');
  console.log('💵 Başlangıç Sermayesi       : 1.000,00 TL');
  console.log('💰 Test Sonu Toplam Varlık   : ' + totalEquity.toFixed(2) + ' TL (Nakit: ' + balance.toFixed(2) + ' TL, Pozisyonlar: ' + openPositionsValue.toFixed(2) + ' TL)');
  console.log('📈 NET GETİRİ (KÂR ORANI)    : %' + netReturnPct.toFixed(2));
  console.log('------------------------------------------------------------');
  console.log('📊 Toplam Yapılan İşlem      : ' + closedTrades.length + ' adet');
  console.log('🟢 Kazançlı (Yeşil) İşlem   : ' + wins.length + ' adet');
  console.log('🔴 Zararla Kapanan İşlem     : ' + losses.length + ' adet');
  console.log('🏆 KAZANMA (BAŞARI) ORANI    : %' + winRate.toFixed(1));
  console.log('⚖️ Kâr/Zarar Faktörü (PF)    : ' + profitFactor.toFixed(2));
  console.log('⭐ Ortalama Kâr (Kazançta)   : +%' + (wins.length > 0 ? (totalWinPnl / wins.length).toFixed(2) : 0));
  console.log('🛑 Ortalama Zarar (Kayıpta)  : -%' + (losses.length > 0 ? (totalLossPnl / losses.length).toFixed(2) : 0));
  console.log('============================================================');

  console.log('\nÖrnek Kapanan Son 10 İşlem:');
  closedTrades.slice(-10).forEach((t, i) => {
    console.log(`${i+1}. ${t.symbol.padEnd(6)} | ${t.isWin ? '🟢 KAZANÇ' : '🔴 KAYIP'} | %${t.pnlPct.toFixed(2).padStart(5)} | ${t.entryTime} ➔ ${t.exitTime} | ${t.reason}`);
  });
}

runBacktest().catch(console.error);
