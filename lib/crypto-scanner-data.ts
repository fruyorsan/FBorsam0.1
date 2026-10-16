import { analyzeCandles, ema, type Candle, type Signal } from "@/lib/indicators"

export interface CryptoScannerMetadata {
  symbol: string        // e.g. "SOLUSDT"
  displaySymbol: string // e.g. "SOL"
  name: string          // e.g. "Solana"
  category: "meme" | "l1" | "ai" | "defi"
  decimals: number
  badge?: string
  description?: string
  catalysts?: string[]
  risks?: string[]
}

export const SCANNER_CRYPTO_LIST: CryptoScannerMetadata[] = [
  // ⚡ Majör & L1 Kriptolar
  {
    symbol: "SOLUSDT",
    displaySymbol: "SOL",
    name: "Solana",
    category: "l1",
    decimals: 2,
    badge: "L1 ⚡",
    description: "Yüksek hızlı ve düşük işlem ücretli Layer-1 blokzinciri.",
    catalysts: ["Ekosistem TVL ve DEX hacminde güçlü büyüme", "Ağ hızı ve kurumsal ilgi"],
    risks: ["BTC düzeltmelerine yüksek beta duyarlılığı"]
  },
  {
    symbol: "BTCUSDT",
    displaySymbol: "BTC",
    name: "Bitcoin",
    category: "l1",
    decimals: 2,
    badge: "KRAL 👑",
    description: "Kripto para piyasasının amiral gemisi ve dijital altın rezervi.",
    catalysts: ["Spot ETF girişleri ve makro likidite", "Uzun vadeli cüzdan birikimi"],
    risks: ["Makro faiz belirsizliği ve direnç reddi"]
  },
  {
    symbol: "ETHUSDT",
    displaySymbol: "ETH",
    name: "Ethereum",
    category: "l1",
    decimals: 2,
    badge: "L1 💎",
    description: "Akıllı sözleşmelerin ve DeFi ekosisteminin öncüsü.",
    catalysts: ["Staking ve deflasyonist arz yapısı", "Layer-2 ölçeklenme çözümleri"],
    risks: ["Diğer L1 zincirleriyle pazar payı rekabeti"]
  },
  {
    symbol: "SUIUSDT",
    displaySymbol: "SUI",
    name: "Sui Network",
    category: "l1",
    decimals: 4,
    badge: "L1 🚀",
    description: "Move dili ile geliştirilmiş yeni nesil yüksek performanslı L1 zinciri.",
    catalysts: ["TVL patlaması ve artan aktif kullanıcı sayısı", "Ağ içi transfer hızı"],
    risks: ["Token kilit açılımları ve kısa vadeli volatilite"]
  },
  {
    symbol: "AVAXUSDT",
    displaySymbol: "AVAX",
    name: "Avalanche",
    category: "l1",
    decimals: 2,
    badge: "L1",
    description: "Alt-ağ (Subnet) mimarisiyle ölçeklenen kurumsal uyumlu blokzincir.",
    catalysts: ["Gerçek dünya varlıkları (RWA) entegrasyonları", "Gaming ve Subnet ortaklıkları"],
    risks: ["Konsolidasyon bölgesinde hacim yavaşlığı"]
  },
  {
    symbol: "BNBUSDT",
    displaySymbol: "BNB",
    name: "BNB",
    category: "l1",
    decimals: 2,
    badge: "L1",
    description: "Binance ekosisteminin yakıtı ve BNB Chain ana varlığı.",
    catalysts: ["Launchpool ve Launchpad staking talebi", "Otomatik çeyreklik yakımlar"],
    risks: ["Borsa hacmi ve regülasyon gelişmeleri"]
  },
  {
    symbol: "XRPUSDT",
    displaySymbol: "XRP",
    name: "Ripple",
    category: "l1",
    decimals: 4,
    badge: "L1",
    description: "Sınır ötesi ödemeler ve bankacılık mutabakatları için optimize edilmiş varlık.",
    catalysts: ["Kurumsal ödeme koridorları ve likidite anlaşmaları", "Hukuki netlik"],
    risks: ["Yüksek arz ve ani pump-dump döngüleri"]
  },
  {
    symbol: "ADAUSDT",
    displaySymbol: "ADA",
    name: "Cardano",
    category: "l1",
    decimals: 4,
    badge: "L1",
    description: "Akademik incelemelere dayalı sürdürülebilir hisse ispatı (PoS) ağı.",
    catalysts: ["Yönetişim güncellemeleri ve staking oranı", "Topluluk desteği"],
    risks: ["Ekosistem DEX hacminin majörlere göre düşük seyretmesi"]
  },

  // 🐸 Meme & Patlama Potansiyelli Coinler
  {
    symbol: "PEPEUSDT",
    displaySymbol: "PEPE",
    name: "Pepe",
    category: "meme",
    decimals: 8,
    badge: "MEME 🐸",
    description: "En yüksek işlem hacmine sahip lider kurbağa meme coini.",
    catalysts: ["Balina cüzdan hareketliliği ve sosyal medya hacmi", "Yüksek volatilite kırılımları"],
    risks: ["Meme coinlerde stopsuz işlem riski ve sert silkelemeler"]
  },
  {
    symbol: "DOGEUSDT",
    displaySymbol: "DOGE",
    name: "Dogecoin",
    category: "meme",
    decimals: 4,
    badge: "MEME 🐶",
    description: "Kripto dünyasının ilk ve en popüler köpek temalı meme coini.",
    catalysts: ["Elon Musk / X ödeme entegrasyonu spekülasyonları", "Büyük perakende yatırımcı tabanı"],
    risks: ["Sınırsız yıllık arz enflasyonu"]
  },
  {
    symbol: "SHIBUSDT",
    displaySymbol: "SHIB",
    name: "Shiba Inu",
    category: "meme",
    decimals: 8,
    badge: "MEME",
    description: "Shibarium L2 ağı ve ShibaSwap ile genişleyen meme ekosistemi.",
    catalysts: ["Token yakım oranındaki sıçramalar", "Shibarium işlem artışı"],
    risks: ["Direnç bantlarında kâr realizasyonu"]
  },
  {
    symbol: "FLOKIUSDT",
    displaySymbol: "FLOKI",
    name: "Floki",
    category: "meme",
    decimals: 8,
    badge: "MEME 🐕",
    description: "Valhalla metaverse ve FlokiFi ekosistemine sahip topluluk coini.",
    catalysts: ["Staking kilitlenmeleri ve reklam kampanyaları", "Meme sektör rallileri"],
    risks: ["Ani duygu dalgalanmaları"]
  },
  {
    symbol: "PENGUUSDT",
    displaySymbol: "PENGU",
    name: "Pudgy Penguins",
    category: "meme",
    decimals: 6,
    badge: "MEME 🐧",
    description: "Popüler NFT markası Pudgy Penguins'in resmi ekosistem tokeni.",
    catalysts: ["Perakende oyuncak satışları ve marka büyümesi", "Topluluk ilgisi"],
    risks: ["Yeni listelenme oynaklığı"]
  },
  {
    symbol: "BONKUSDT",
    displaySymbol: "BONK",
    name: "Bonk",
    category: "meme",
    decimals: 8,
    badge: "MEME",
    description: "Solana ağının ilk ve en büyük topluluk meme coini.",
    catalysts: ["Solana DeFi entegrasyonları ve SOL ekosistemiyle korelasyon", "Düzenli yakımlar"],
    risks: ["Solana ağındaki genel duygu geri çekilmeleri"]
  },
  {
    symbol: "WIFUSDT",
    displaySymbol: "WIF",
    name: "dogwifhat",
    category: "meme",
    decimals: 4,
    badge: "MEME 🧢",
    description: "Solana ağındaki şapkalı köpek temalı viral meme coini.",
    catalysts: ["Kült topluluk desteği ve spot hacim patlamaları", "Vadeli işlemlerde açık pozisyon artışı"],
    risks: ["Sert kaldıraç temizleme iğneleri"]
  },
  {
    symbol: "BOMEUSDT",
    displaySymbol: "BOME",
    name: "Book of Meme",
    category: "meme",
    decimals: 6,
    badge: "MEME",
    description: "Meme kültürünü blokzincirde arşivlemeyi hedefleyen deneysel proje.",
    catalysts: ["Düşük piyasa değeriyle hızlı tepki potansiyeli", "Topluluk aktivitesi"],
    risks: ["Geniş spread aralığı"]
  },

  // 🤖 AI & Yapay Zekâ Coinleri
  {
    symbol: "NEARUSDT",
    displaySymbol: "NEAR",
    name: "NEAR Protocol",
    category: "ai",
    decimals: 3,
    badge: "AI 🤖",
    description: "Kullanıcı dostu yapay zekâ odaklı sharding altyapısına sahip L1 blokzincir.",
    catalysts: ["Kullanıcı odaklı AI modelleri ve zincir soyutlama (Chain Abstraction)", "Geliştirici aktivitesi"],
    risks: ["Direnç kırılımı öncesi akümülasyon uzaması"]
  },
  {
    symbol: "RENDERUSDT",
    displaySymbol: "RENDER",
    name: "Render Network",
    category: "ai",
    decimals: 3,
    badge: "AI 🎨",
    description: "Merkeziyetsiz GPU bilişim ağı; yapay zekâ ve render iş yükleri.",
    catalysts: ["Yapay zekâ modellerine olan dev GPU talebi", "Apple ve prodüksiyon işbirlikleri"],
    risks: ["Genel teknoloji hisselerindeki düzeltmeler"]
  },
  {
    symbol: "FETUSDT",
    displaySymbol: "FET",
    name: "Artificial Superintelligence",
    category: "ai",
    decimals: 4,
    badge: "AI",
    description: "Merkeziyetsiz otonom yapay zekâ ajanları ve ASI ittifakı tokeni.",
    catalysts: ["Otonom AI ajanları ekosistemi", "ASI birleşmesi sinerjisi"],
    risks: ["Sektörel haber akışına aşırı duyarlılık"]
  },

  // 💎 DeFi & Oracle
  {
    symbol: "LINKUSDT",
    displaySymbol: "LINK",
    name: "Chainlink",
    category: "defi",
    decimals: 3,
    badge: "DEFI 🌐",
    description: "Blokzincirleri gerçek dünya verileri ve bankacılıkla bağlayan oracle lideri.",
    catalysts: ["CCIP zincirler arası iletişim protokolü", "Kurumsal SWIFT testleri ve RWA"],
    risks: ["Fiyatın yavaş ve oturaklı hareket etmesi"]
  },
]

export type CryptoTimeHorizon = "GÜN İÇİ (BUGÜN PATLAMA)" | "HAFTALIK (YARI OTOMASYON)"

export interface CryptoStockAnalysis {
  symbol: string
  displaySymbol: string
  name: string
  category: "meme" | "l1" | "ai" | "defi"
  badge: string
  price: number
  priceFormatted: string
  change: number
  previousClose: number
  high24h: number
  low24h: number
  volumeUsdt: number
  volumeFormatted: string
  decimals: number
  signal: Signal
  confidence: number
  score: number
  scoreRaw: number
  isTopPick: boolean
  isBuyOpportunity: boolean
  isSellWarning: boolean
  timeHorizon: CryptoTimeHorizon
  horizonBadgeText: string
  plan: {
    entryMin: number
    entryMax: number
    target1: number
    target1Percent: number
    target2: number
    target2Percent: number
    stopLoss: number
    stopLossPercent: number
    riskRewardRatio: string
    timeHorizon: string
    tacticalNote: string
  }
  technical: {
    rsi: number
    ema20: number
    ema50: number
    ema200?: number
    trend: "YUKARI" | "AŞAĞI" | "YATAY"
    macd: number
    macdSignal: number
    macdStatus: "POZİTİF" | "NEGATİF"
    stochastic: number
    bollingerPercent: number
    atr: number
    atrPercent: number
    rvol: number
    support1: number
    support2: number
    resistance1: number
    resistance2: number
  }
  orderFlow: {
    buyerRatio: number
    sellerRatio: number
    moneyFlowStatus: "GÜÇLÜ PARA GİRİŞİ" | "DENGELİ" | "PARA ÇIKIŞI"
    volumeIntensity: "YÜKSEK (BALİNA)" | "NORMAL" | "DÜŞÜK"
  }
  sparkline: { date: string; price: number }[]
  description: string
  catalysts: string[]
  risks: string[]
  aiAnalysis?: {
    summary: string
    catalysts: string[]
    risks: string[]
    bullCase: string
    bearCase: string
    actionVerdict: string
  }
}

export interface CryptoScanResult {
  topPick: CryptoStockAnalysis
  topBuys: CryptoStockAnalysis[]
  topSells: CryptoStockAnalysis[]
  dailyExplosions: CryptoStockAnalysis[] // Gün içi patlama yapacaklar
  weeklySwings: CryptoStockAnalysis[]    // Haftalık yarı otomasyon
  allCoins: CryptoStockAnalysis[]
  timestamp: string
}

const BINANCE_BASE = "https://api.binance.com/api/v3"

export function formatCryptoVolume(num: number): string {
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`
  return `$${num.toFixed(2)}`
}

export function formatCryptoPrice(price: number, decimals: number): string {
  if (!Number.isFinite(price)) return "—"
  return price.toLocaleString("en-US", {
    minimumFractionDigits: decimals > 4 ? 6 : 2,
    maximumFractionDigits: decimals,
  })
}

// In-memory cache for crypto scan results (30 seconds)
let cryptoScanCache: {
  data: CryptoScanResult
  expiresAt: number
} | null = null

export async function fetchCryptoCandles(symbol: string, interval = "1h", limit = 60): Promise<Candle[]> {
  try {
    const res = await fetch(`${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, {
      next: { revalidate: 20 },
    })
    if (!res.ok) return []
    const klines = await res.json()
    if (!Array.isArray(klines)) return []

    return klines.map((k: (number | string)[]) => {
      const openTime = Number(k[0])
      const dateStr = new Intl.DateTimeFormat("tr-TR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(openTime))

      return {
        date: dateStr,
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
      }
    })
  } catch {
    return []
  }
}

export function buildCryptoAnalysis(
  meta: CryptoScannerMetadata,
  ticker: {
    lastPrice: string
    priceChangePercent: string
    highPrice: string
    lowPrice: string
    quoteVolume: string
  },
  candles: Candle[]
): CryptoStockAnalysis {
  const price = parseFloat(ticker.lastPrice) || (candles.at(-1)?.close ?? 0)
  const change = parseFloat(ticker.priceChangePercent) || 0
  const high24h = parseFloat(ticker.highPrice) || price
  const low24h = parseFloat(ticker.lowPrice) || price
  const volumeUsdt = parseFloat(ticker.quoteVolume) || 0
  const previousClose = candles.at(-2)?.close ?? price

  // Fallback candles if needed
  const validCandles = candles.length >= 15 ? candles : [
    { date: "1", open: price * 0.98, high: price * 1.01, low: price * 0.97, close: price, volume: 100 }
  ]

  let technicalData
  try {
    technicalData = analyzeCandles(validCandles)
  } catch {
    technicalData = {
      signal: "TUT" as Signal,
      confidence: 50,
      support: low24h * 0.98,
      resistance: high24h * 1.02,
      values: {
        rsi: 50,
        ema20: price,
        ema50: price,
        macd: 0,
        macdSignal: 0,
        stochastic: 50,
        bollinger: 50,
        atr: price * 0.03,
        atrPercent: 3,
        rvol: 1,
      },
      fibonacci: {
        low: low24h,
        high: high24h,
        level236: low24h + (high24h - low24h) * 0.236,
        level382: low24h + (high24h - low24h) * 0.382,
        level500: low24h + (high24h - low24h) * 0.5,
        level618: low24h + (high24h - low24h) * 0.618,
      },
      breakdown: [],
      chart: [],
      price,
    }
  }

  const rsi = technicalData.values.rsi ?? 50
  const ema20 = technicalData.values.ema20 ?? price
  const ema50 = technicalData.values.ema50 ?? price
  const macd = technicalData.values.macd ?? 0
  const macdSignal = technicalData.values.macdSignal ?? 0
  const stochastic = technicalData.values.stochastic ?? 50
  const bollinger = technicalData.values.bollinger ?? 50
  const atr = technicalData.values.atr ?? price * 0.03
  const atrPercent = technicalData.values.atrPercent ?? 3
  const rvol = technicalData.values.rvol ?? 1

  // Pivot Points
  const pivot = (high24h + low24h + price) / 3
  const resistance1 = 2 * pivot - low24h
  const support1 = 2 * pivot - high24h
  const resistance2 = pivot + (high24h - low24h)
  const support2 = pivot - (high24h - low24h)

  // Scoring (-10 to +10)
  let rawScore = 0

  // 1. Trend Filter
  if (price > ema20 && ema20 > ema50) rawScore += 2.8
  else if (price > ema20) rawScore += 1.3
  else if (price < ema20 && ema20 < ema50) rawScore -= 2.8
  else rawScore -= 1.3

  // 2. MACD Momentum
  if (macd > macdSignal) rawScore += 2.0
  else rawScore -= 2.0

  // 3. RSI Zone
  if (rsi >= 75) rawScore -= 3.5 // Aşırı alım
  else if (rsi >= 44 && rsi <= 64) rawScore += 2.5 // Sağlıklı patlama/momentum bölgesi
  else if (rsi <= 32) rawScore += 2.2 // Aşırı satım dönüşü

  // 4. Volume / RVOL
  if (rvol >= 1.5) rawScore += 2.2
  else if (rvol < 0.7) rawScore -= 1.2

  // 5. 24h Change & Volatility
  if (change > 0 && change < 5.5) rawScore += 1.5
  else if (change >= 12) rawScore -= 1.5 // Çok primli gün içi riskli
  else if (change < -5 && rsi < 35) rawScore += 1.8 // Dip fırsatı

  const score = Math.round(Math.min(98, Math.max(15, 50 + rawScore * 5.2)))

  let signal: Signal = "TUT"
  if (score >= 70) signal = "GÜÇLÜ AL"
  else if (score >= 58) signal = "AL"
  else if (score <= 32) signal = "GÜÇLÜ SAT"
  else if (score <= 44) signal = "SAT"
  else signal = "TUT"

  // Vade & Patlama Tespiti
  // Gün içi patlama: Yüksek RVOL, RSI 48-68 arası ivmeli, MACD kesişimli veya meme coin hareketli
  const isDailyExplosion = (rvol >= 1.35 || meta.category === "meme" || Math.abs(change) >= 3.5) && score >= 58
  const timeHorizon: CryptoTimeHorizon = isDailyExplosion
    ? "GÜN İÇİ (BUGÜN PATLAMA)"
    : "HAFTALIK (YARI OTOMASYON)"

  const horizonBadgeText = isDailyExplosion
    ? "⚡ BUGÜN PATLAMA POTANSİYELİ"
    : "📅 HAFTALIK YARI OTOMASYON (1-7 GÜN)"

  // Trading Plan
  const stopBuffer = Math.max(atr * 1.2, price * 0.02)
  const stopLoss = Math.max(0.00000001, Number((price - stopBuffer).toFixed(meta.decimals)))
  const stopLossPercent = Number((((stopLoss - price) / price) * 100).toFixed(2))

  const entryMin = Number((price * 0.985).toFixed(meta.decimals))
  const entryMax = Number((price * 1.006).toFixed(meta.decimals))

  // TP1: Kısa vade / Direnç 1
  const tp1Ratio = isDailyExplosion ? 1.045 : 1.07
  const tp1Val = Math.max(resistance1, price * tp1Ratio)
  const target1 = Number(tp1Val.toFixed(meta.decimals))
  const target1Percent = Number((((target1 - price) / price) * 100).toFixed(2))

  // TP2: Orta vade / Direnç 2
  const tp2Ratio = isDailyExplosion ? 1.09 : 1.15
  const tp2Val = Math.max(resistance2, price * tp2Ratio)
  const target2 = Number(tp2Val.toFixed(meta.decimals))
  const target2Percent = Number((((target2 - price) / price) * 100).toFixed(2))

  // Risk / Reward
  const riskDiff = Math.abs(price - stopLoss)
  const rewardDiff = Math.abs(target1 - price)
  const rrValue = riskDiff > 0 ? (rewardDiff / riskDiff).toFixed(1) : "2.0"

  const tacticalNote = isDailyExplosion
    ? `🔥 Gün İçi Patlama Planı: ${formatCryptoPrice(entryMin, meta.decimals)} - ${formatCryptoPrice(entryMax, meta.decimals)} aralığından girilip ilk kâr hedefi TP1'de (%${target1Percent}) ana sermaye kilitlenmeli. Kesin stop: %${stopLossPercent}.`
    : `📅 Haftalık Yarı Otomasyon: Pozisyona kademeli oturulur. 1-7 gün vadede TP2 (%${target2Percent}) beklenir. %${stopLossPercent} stop emri Binance'e girilerek risk sınırlandırılır.`

  // Order flow estimate
  const buyerRatio = Math.round(Math.min(92, Math.max(20, (change > 0 ? 55 : 45) + (rvol > 1.2 ? 15 : 0))))
  const sellerRatio = 100 - buyerRatio
  const moneyFlowStatus = buyerRatio >= 60 ? "GÜÇLÜ PARA GİRİŞİ" : buyerRatio <= 40 ? "PARA ÇIKIŞI" : "DENGELİ"
  const volumeIntensity = rvol >= 1.5 ? "YÜKSEK (BALİNA)" : rvol <= 0.8 ? "DÜŞÜK" : "NORMAL"

  const trend: "YUKARI" | "AŞAĞI" | "YATAY" =
    price > ema20 && ema20 > ema50 ? "YUKARI" : price < ema20 && ema20 < ema50 ? "AŞAĞI" : "YATAY"

  const sparkline = validCandles.slice(-20).map((c) => ({ date: c.date, price: c.close }))

  return {
    symbol: meta.symbol,
    displaySymbol: meta.displaySymbol,
    name: meta.name,
    category: meta.category,
    badge: meta.badge || meta.category.toUpperCase(),
    price,
    priceFormatted: formatCryptoPrice(price, meta.decimals),
    change,
    previousClose,
    high24h,
    low24h,
    volumeUsdt,
    volumeFormatted: formatCryptoVolume(volumeUsdt),
    decimals: meta.decimals,
    signal,
    confidence: technicalData.confidence,
    score,
    scoreRaw: rawScore,
    isTopPick: false,
    isBuyOpportunity: signal === "GÜÇLÜ AL" || signal === "AL",
    isSellWarning: signal === "GÜÇLÜ SAT" || signal === "SAT" || rsi >= 75,
    timeHorizon,
    horizonBadgeText,
    plan: {
      entryMin,
      entryMax,
      target1,
      target1Percent,
      target2,
      target2Percent,
      stopLoss,
      stopLossPercent,
      riskRewardRatio: `1 : ${rrValue}`,
      timeHorizon: isDailyExplosion ? "Bugün İçi (Günlük Patlama)" : "1 - 7 Gün (Haftalık Yarı Otomasyon)",
      tacticalNote,
    },
    technical: {
      rsi: Number(rsi.toFixed(1)),
      ema20: Number(ema20.toFixed(meta.decimals > 4 ? 6 : 2)),
      ema50: Number(ema50.toFixed(meta.decimals > 4 ? 6 : 2)),
      trend,
      macd: Number(macd.toFixed(4)),
      macdSignal: Number(macdSignal.toFixed(4)),
      macdStatus: macd > macdSignal ? "POZİTİF" : "NEGATİF",
      stochastic: Number(stochastic.toFixed(1)),
      bollingerPercent: Number(bollinger.toFixed(1)),
      atr: Number(atr.toFixed(meta.decimals > 4 ? 6 : 2)),
      atrPercent: Number(atrPercent.toFixed(2)),
      rvol: Number(rvol.toFixed(2)),
      support1: Number(support1.toFixed(meta.decimals > 4 ? 6 : 2)),
      support2: Number(support2.toFixed(meta.decimals > 4 ? 6 : 2)),
      resistance1: Number(resistance1.toFixed(meta.decimals > 4 ? 6 : 2)),
      resistance2: Number(resistance2.toFixed(meta.decimals > 4 ? 6 : 2)),
    },
    orderFlow: {
      buyerRatio,
      sellerRatio,
      moneyFlowStatus,
      volumeIntensity,
    },
    sparkline,
    description: meta.description || `${meta.name} (${meta.displaySymbol}) Binance üzerinde aktif işlem gören kripto varlıktır.`,
    catalysts: meta.catalysts || ["Binance yüksek emir defteri likiditesi", "Teknik momentum ve hacim desteği"],
    risks: meta.risks || ["Kripto piyasası genel dalgalanması", "Sert kaldıraç ve volatilite riski"],
  }
}

export async function scanCryptoUniverse(forceRefresh = false): Promise<CryptoScanResult> {
  const now = Date.now()
  if (!forceRefresh && cryptoScanCache && cryptoScanCache.expiresAt > now) {
    return cryptoScanCache.data
  }

  // 1. Fetch 24hr tickers in batch
  const symbols = SCANNER_CRYPTO_LIST.map((c) => c.symbol)
  const tickerRes = await fetch(`${BINANCE_BASE}/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`, {
    next: { revalidate: 15 },
  })
  if (!tickerRes.ok) {
    throw new Error(`Binance ticker listesi alınamadı (${tickerRes.status})`)
  }

  const tickerList: Array<{
    symbol: string
    lastPrice: string
    priceChangePercent: string
    highPrice: string
    lowPrice: string
    quoteVolume: string
  }> = await tickerRes.json()

  const tickerMap = new Map(tickerList.map((t) => [t.symbol, t]))

  // 2. Fetch candles in chunks of 5
  const results: CryptoStockAnalysis[] = []
  const chunkSize = 5

  for (let i = 0; i < SCANNER_CRYPTO_LIST.length; i += chunkSize) {
    const chunk = SCANNER_CRYPTO_LIST.slice(i, i + chunkSize)
    const chunkResults = await Promise.all(
      chunk.map(async (meta) => {
        const ticker = tickerMap.get(meta.symbol)
        if (!ticker) return null
        const candles = await fetchCryptoCandles(meta.symbol, "1h", 48)
        return buildCryptoAnalysis(meta, ticker, candles)
      })
    )
    for (const r of chunkResults) {
      if (r) results.push(r)
    }
  }

  if (results.length === 0) {
    throw new Error("Kripto para analizi tamamlanamadı. Lütfen tekrar deneyin.")
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score)

  // Top Pick
  const topPick = results.find((r) => r.isBuyOpportunity) || results[0]
  topPick.isTopPick = true

  const topBuys = results.filter((r) => r.isBuyOpportunity).slice(0, 6)
  const topSells = results.filter((r) => r.isSellWarning).slice(0, 4)
  const dailyExplosions = results.filter((r) => r.timeHorizon === "GÜN İÇİ (BUGÜN PATLAMA)" && r.isBuyOpportunity)
  const weeklySwings = results.filter((r) => r.timeHorizon === "HAFTALIK (YARI OTOMASYON)" && r.isBuyOpportunity)

  const payload: CryptoScanResult = {
    topPick,
    topBuys,
    topSells,
    dailyExplosions,
    weeklySwings,
    allCoins: results,
    timestamp: new Date().toISOString(),
  }

  cryptoScanCache = {
    data: payload,
    expiresAt: now + 30 * 1000, // 30 sec cache
  }

  return payload
}
