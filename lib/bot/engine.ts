export interface Position {
  id: string
  symbol: string
  name: string
  side: "BUY" | "SELL"
  entryPrice: number
  currentPrice: number
  amount: number
  totalTry: number
  takeProfitPrice: number
  stopLossPrice: number
  highestPrice?: number
  trailingStopPrice?: number
  pnl: number
  pnlPercent: number
  openedAt: string
  openedTimestamp?: number
  status: "OPEN" | "CLOSED"
  closePrice?: number
  exitPrice?: number
  closeReason?: string
  closedAt?: string
  closedTimestamp?: number
  triggerType: "INDICATOR" | "MANUAL" | "AI_SUGGESTION"
  orderType: "LIMIT" | "MARKET"
  limitPrice?: number
  commissionTry?: number
  commissionRatio?: number
  netPnlTry?: number
  orderId?: string | number
  isRealOrder?: boolean
  partialSold?: boolean
  partialSoldAmount?: number
  partialSoldPnl?: number
  partialSoldPercent?: number
  partialSoldPrice?: number
  initialTotalTry?: number
  isWhale?: boolean
  isMegaWhale?: boolean
  isBounce?: boolean
  manualTpPct?: number
  exchange?: "BINANCE_TR" | "BINANCE_GLOBAL"
  leverage?: number
  marginType?: "ISOLATED" | "CROSSED"
  liquidationPrice?: number
  totalUsdt?: number
  pnlUsdt?: number
}


export interface BotStrategy {
  autoPilot: boolean
  orderType: "LIMIT" | "MARKET"
  limitDiscountPct: number
  tradeAmountTry: number
  maxConcurrentPositions: number
  autoAllocateCapital: boolean
  aiOpportunityRanking: boolean
  // Çoklu Zaman Dilimi (1m + 5m + 1h + 1w + 1M) & AI Sentezi
  multiTimeframeEnabled: boolean
  requireAiConfirmation: boolean
  autoSellOrphanAssets: boolean
  // Dinamik Pozisyon Boyutu
  dynamicSizing: boolean
  dynamicSizingAggressiveness: "conservative" | "balanced" | "aggressive"
  // Günlük Maks. Zarar Limiti
  dailyMaxLossPct: number
  // Yatay Pozisyon Kapatma (Stale Position Timeout)
  stalePositionTimeoutEnabled: boolean
  stalePositionTimeoutHours: number // örn. 4 saat
  // BTC Şelale / Ani Düşüş Koruması (Market Panic Switch)
  btcDropProtectionEnabled: boolean
  btcDropThresholdPct: number // örn. -1.5%
  // E-posta Bildirimleri
  emailNotificationsEnabled: boolean
  userNotificationEmail: string
  rsiEnabled: boolean

  rsiBuyThreshold: number
  rsiSellThreshold: number
  smaCrossEnabled: boolean
  sentimentEnabled: boolean
  defaultStopLossPct: number
  defaultTakeProfitPct: number
  smartEarlyExitEnabled: boolean
  breakevenEnabled: boolean
  breakevenPct: number
  trailingStopPct: number
  commissionRatePct: number
  maxCommissionProfitRatio: number
  tradingHoursEnabled: boolean
  tradingHoursStart: number
  tradingHoursEnd: number
  timeframeFilterEnabled: boolean
  memeCoinsOnly: boolean
  // Max Kâr İyileştirmeleri
  multiStageTakeProfit?: boolean      // %2'de yarısını sat, kalan yarısını roketlemeye bırak
  volumeSpikeDetection?: boolean      // Anormal balina hacim artışlarını yakala
  dynamicRegimeEnabled?: boolean      // Ayı modunda %0.95 hızlı scalp, Boğa modunda %3.0+ runner otomatik ayarlar
  compoundGrowth?: boolean            // Kârları otomatik bir sonraki işlemlere bileşik ekle
  recoveryMode?: boolean              // Telafi & Kâra Geçiş Modu: Sadece Tier-1 süper likit coinler ve %1.8 hızlı scalp
  superTakeProfitPct?: number         // Dev roket / balina patlaması hedef kârı (örn. %2.25)
}

export interface BotProposal {
  id: string
  symbol: string
  name: string
  side: "BUY" | "SELL"
  price: number
  reason: string
  indicators: {
    rsi?: number
    sma?: number
    signal?: string
  }
  confidence: number
  timestamp: number
}

export interface ManualOrderTrigger {
  id: string
  symbol: string
  name: string
  targetPrice: number
  direction: "BELOW" | "ABOVE"
  action: "BUY" | "SELL"
  amountTry: number
  active: boolean
  createdAt: string
}

export interface TradeLog {
  id: string
  time: string
  type: "INFO" | "BUY" | "SELL" | "ALERT" | "PROPOSAL"
  symbol?: string
  message: string
}

export interface BinanceCredentials {
  apiKey: string
  apiSecret: string
  accountName: string
  accountType: "REAL" | "SIMULATION"
  exchangeType?: "BINANCE_TR" | "BINANCE_GLOBAL"
  connected: boolean
  realBalanceTry: number
  walletTotalTry?: number
  freeTry?: number
  lockedTry?: number
  coinValueTry?: number
  usdtFree?: number
  usdtTotal?: number
  usdtTryValue?: number
  lastSyncTime?: string
}

export interface BotState {
  balanceTry: number
  initialBalanceTry: number
  currency: "TRY"
  active: boolean
  positions: Position[]
  history: Position[]
  proposals: BotProposal[]
  manualTriggers: ManualOrderTrigger[]
  logs: TradeLog[]
  strategy: BotStrategy
  binance: BinanceCredentials
  // Öneri 5: Günlük zarar takibi
  dailyLossStartBalance?: number
  dailyLossDate?: string
}

export const DEFAULT_BOT_STRATEGY: BotStrategy = {
  autoPilot: true,
  orderType: "MARKET", // Market emri: Anında dolar, nakit asılı kalmaz
  limitDiscountPct: 0.25,
  tradeAmountTry: 2500,
  maxConcurrentPositions: 2, // En fazla 2 slot (Sermaye bölünmez, odaklanmış portföy)
  autoAllocateCapital: true, // Parayı 2 slota eşit paylaştır (~%50 - ~%50)
  aiOpportunityRanking: true, // En yüksek kâr potansiyelli coinleri önceliklendir
  multiTimeframeEnabled: true, // 1h + 1d + 1w + 1M çoklu zaman dilimi sentezi
  requireAiConfirmation: true, // Terminal AI Analiz onayı şartı
  autoSellOrphanAssets: false,
  dynamicSizing: true,
  dynamicSizingAggressiveness: "balanced",
  dailyMaxLossPct: 6.0, // Swing işlemler için geniş günlük tolerans
  stalePositionTimeoutEnabled: false, // Zaman sınırı KAPALI: Kullanıcı isterse elle satar, bot zamana bakarak kapatmaz
  stalePositionTimeoutHours: 72,
  btcDropProtectionEnabled: true, // Piyasa çöküşünde düşen bıçağı tutmama kilidi
  btcDropThresholdPct: -1.5,
  emailNotificationsEnabled: true,
  userNotificationEmail: "",
  rsiEnabled: true,

  rsiBuyThreshold: 35, // Sadece dip dönüşü ve kaliteli trend düzeltmeleri
  rsiSellThreshold: 78,
  smaCrossEnabled: true,
  sentimentEnabled: true,
  defaultStopLossPct: 3.5, // Swing Stop-Loss: -%3.5 (Piyasa gürültüsünde erken patlamaz)
  defaultTakeProfitPct: 6.5, // Yüksek Akıllı Kâr Hedefi: +%6.5 (Coine göre %5.0 - %8.5+)
  smartEarlyExitEnabled: false, // Ufak kârda erken kaçış KAPALI
  breakevenEnabled: true,
  breakevenPct: 4.5, // Sadece +%4.5 kâr görüldükten sonra koruma stopu devreye girer
  trailingStopPct: 2.0, // Zirveden %2.0 nefes payı (Büyük kârın koşmasına izin verir)
  commissionRatePct: 0.1,
  maxCommissionProfitRatio: 10,
  tradingHoursEnabled: false, // 7/24 Kesintisiz Kripto Piyasası Modu
  tradingHoursStart: 0,
  tradingHoursEnd: 24,
  timeframeFilterEnabled: true,
  memeCoinsOnly: false,
  multiStageTakeProfit: true,
  dynamicRegimeEnabled: true,
  volumeSpikeDetection: true, // Balina hacim artışlarını algıla
  compoundGrowth: true,
  recoveryMode: true,
}


export function validateTradeCommission(
  amountTry: number,
  takeProfitPct: number,
  feeRatePct = 0.1,
  maxAllowedRatio = 10
): { ok: boolean; totalFeeTry: number; grossProfitTry: number; feeRatio: number; reason?: string } {
  const feeDecimal = feeRatePct / 100
  const buyFee = amountTry * feeDecimal
  const targetVal = amountTry * (1 + takeProfitPct / 100)
  const sellFee = targetVal * feeDecimal
  const totalFeeTry = buyFee + sellFee
  const grossProfitTry = targetVal - amountTry
  const feeRatio = grossProfitTry > 0 ? (totalFeeTry / grossProfitTry) * 100 : 999

  if (feeRatio > maxAllowedRatio) {
    return {
      ok: false,
      totalFeeTry,
      grossProfitTry,
      feeRatio,
      reason: `Komisyon (${totalFeeTry.toFixed(2)} ₺), hedeflenen kârın %${feeRatio.toFixed(1)}'sini aşıyor! (Max %${maxAllowedRatio} sınırı). İşlem kârsız bulunup reddedildi.`,
    }
  }

  return { ok: true, totalFeeTry, grossProfitTry, feeRatio }
}

export function isTradingHourActive(startHour = 13, endHour = 24): boolean {
  const currentHour = new Date().getHours()
  return currentHour >= startHour && currentHour < endHour
}

export const INITIAL_BOT_STATE: BotState = {
  balanceTry: 0,
  initialBalanceTry: 0,
  currency: "TRY",
  active: true,
  positions: [],
  history: [],
  proposals: [],
  manualTriggers: [
    {
      id: "trig-pepe-tl",
      symbol: "PEPE",
      name: "Pepe",
      targetPrice: 0.000160,
      direction: "BELOW",
      action: "BUY",
      amountTry: 2500,
      active: true,
      createdAt: new Date().toLocaleTimeString("tr-TR"),
    },
  ],
  logs: [
    {
      id: "log-init",
      time: new Date().toLocaleTimeString("tr-TR"),
      type: "INFO",
      message: "Binance TL Meme Coin Al-Sat Motoru başlatıldı. Canlı TL kurları devrede.",
    },
  ],
  strategy: DEFAULT_BOT_STRATEGY,
  binance: {
    apiKey: "",
    apiSecret: "",
    accountName: "Kişisel Binance Hesabı",
    accountType: "SIMULATION",
    connected: false,
    realBalanceTry: 0,
  },
}

export const WATCHED_CRYPTOS = [
  // ── Popüler & Yüksek İvmeli Ucuz Kriptolar (Binance TR) ──
  { symbol: "PENGU", name: "Pudgy Penguins", yahoo: "PENGU-USD", binance: "PENGUTRY", decimals: 4, badge: "MEME 🐧", isCheap: true },
  { symbol: "PEPE", name: "Pepe", yahoo: "PEPE24478-USD", binance: "PEPETRY", decimals: 8, badge: "MEME 🐸", isCheap: true },
  { symbol: "SHIB", name: "Shiba Inu", yahoo: "SHIB-USD", binance: "SHIBTRY", decimals: 8, badge: "MEME 🐕", isCheap: true },
  { symbol: "BONK", name: "Bonk", yahoo: "BONK-USD", binance: "BONKTRY", decimals: 8, badge: "MEME 🔨", isCheap: true },
  { symbol: "FLOKI", name: "Floki", yahoo: "FLOKI-USD", binance: "FLOKITRY", decimals: 6, badge: "MEME ⚔️", isCheap: true },
  { symbol: "BOME", name: "Book of Meme", yahoo: "BOME-USD", binance: "BOMETRY", decimals: 6, badge: "MEME 📖", isCheap: true },
  { symbol: "CHZ", name: "Chiliz", yahoo: "CHZ-USD", binance: "CHZTRY", decimals: 4, badge: "FAN ⚽", isCheap: true },
  { symbol: "HOT", name: "Holo", yahoo: "HOT-USD", binance: "HOTTRY", decimals: 6, badge: "DİP ⚡", isCheap: true },
  { symbol: "GALA", name: "Gala Games", yahoo: "GALA-USD", binance: "GALATRY", decimals: 6, badge: "GAME 🎮", isCheap: true },
  { symbol: "DOGE", name: "Dogecoin", yahoo: "DOGE-USD", binance: "DOGETRY", decimals: 4, badge: "MEME 🚀", isCheap: true },
  { symbol: "SAND", name: "The Sandbox", yahoo: "SAND-USD", binance: "SANDTRY", decimals: 4, badge: "METAVERSE 🌐", isCheap: true },
  { symbol: "XRP", name: "Ripple", yahoo: "XRP-USD", binance: "XRPTRY", decimals: 4, badge: "POPÜLER ⚡", isCheap: true },
  { symbol: "ADA", name: "Cardano", yahoo: "ADA-USD", binance: "ADATRY", decimals: 4, badge: "POPÜLER 💎", isCheap: true },
  { symbol: "SUI", name: "Sui Network", yahoo: "SUI20947-USD", binance: "SUITRY", decimals: 4, badge: "L1 POPÜLER 🔥", isCheap: true },
  { symbol: "RENDER", name: "Render AI", yahoo: "RENDER-USD", binance: "RENDERTRY", decimals: 4, badge: "YAPAY ZEKA 🤖", isCheap: false },
  { symbol: "FET", name: "Artificial Superintelligence", yahoo: "FET-USD", binance: "FETTRY", decimals: 4, badge: "YAPAY ZEKA 🤖", isCheap: false },
  { symbol: "NEAR", name: "NEAR Protocol", yahoo: "NEAR-USD", binance: "NEARTRY", decimals: 4, badge: "YAPAY ZEKA 🧠", isCheap: false },
  { symbol: "TIA", name: "Celestia", yahoo: "TIA22861-USD", binance: "TIATRY", decimals: 4, badge: "MODÜLER 🧬", isCheap: false },
  { symbol: "INJ", name: "Injective", yahoo: "INJ-USD", binance: "INJTRY", decimals: 4, badge: "DEFI ⚡", isCheap: false },
  { symbol: "ARB", name: "Arbitrum", yahoo: "ARB11841-USD", binance: "ARBTRY", decimals: 4, badge: "L2 DEV 🔷", isCheap: true },
  { symbol: "OP", name: "Optimism", yahoo: "OP-USD", binance: "OPTRY", decimals: 4, badge: "L2 DEV 🔴", isCheap: false },
  { symbol: "LINK", name: "Chainlink", yahoo: "LINK-USD", binance: "LINKTRY", decimals: 2, badge: "ORACLE 🔗", isCheap: false },
  { symbol: "WLD", name: "Worldcoin", yahoo: "WLD-USD", binance: "WLDTRY", decimals: 4, badge: "AI 👁️", isCheap: true },
  { symbol: "APT", name: "Aptos", yahoo: "APT21794-USD", binance: "APTTRY", decimals: 2, badge: "L1 🪐", isCheap: false },
  { symbol: "DOT", name: "Polkadot", yahoo: "DOT-USD", binance: "DOTTRY", decimals: 4, badge: "L1 🔴", isCheap: true },
  { symbol: "LTC", name: "Litecoin", yahoo: "LTC-USD", binance: "LTCTRY", decimals: 2, badge: "GÜMÜŞ 🥈", isCheap: false },
  { symbol: "AVAX", name: "Avalanche", yahoo: "AVAX-USD", binance: "AVAXTRY", decimals: 2, badge: "L1 DEV 🔺", isCheap: false },
  { symbol: "SOL", name: "Solana", yahoo: "SOL-USD", binance: "SOLTRY", decimals: 2, badge: "L1 ⚡", isCheap: false },
  { symbol: "ETH", name: "Ethereum", yahoo: "ETH-USD", binance: "ETHTRY", decimals: 2, badge: "DEV L1 💎", isCheap: false },
  { symbol: "BNB", name: "BNB", yahoo: "BNB-USD", binance: "BNBTRY", decimals: 2, badge: "BORSA 🟡", isCheap: false },
  { symbol: "WIF", name: "dogwifhat", yahoo: "WIF-USD", binance: "WIFTRY", decimals: 4, badge: "MEME 🧢", isCheap: true },
  { symbol: "NEIRO", name: "Neiro", yahoo: "NEIRO-USD", binance: "NEIROTRY", decimals: 6, badge: "MEME 🐕", isCheap: true },
  { symbol: "TURBO", name: "Turbo", yahoo: "TURBO-USD", binance: "TURBOTRY", decimals: 6, badge: "MEME ⚡", isCheap: true },
  { symbol: "TRX", name: "TRON", yahoo: "TRX-USD", binance: "TRXTRY", decimals: 4, badge: "L1 🌐", isCheap: true },
  { symbol: "TON", name: "Toncoin", yahoo: "TON11419-USD", binance: "TONTRY", decimals: 4, badge: "L1 💎", isCheap: false },
  { symbol: "ENA", name: "Ethena", yahoo: "ENA-USD", binance: "ENATRY", decimals: 4, badge: "DEFI 💵", isCheap: true },
  { symbol: "BTC", name: "Bitcoin", yahoo: "BTC-USD", binance: "BTCTRY", decimals: 2, badge: "KRAL 👑", isCheap: false },
  // ── DeFi (Merkeziyetsiz Finans) — Binance TR Yüksek Hacimli Coinler ──
  { symbol: "PENDLE", name: "Pendle Finance", yahoo: "PENDLE-USD", binance: "PENDLETRY", decimals: 4, badge: "DEFI 🌊", isCheap: true },
  { symbol: "UNI", name: "Uniswap", yahoo: "UNI7083-USD", binance: "UNITRY", decimals: 4, badge: "DEX 🦄", isCheap: false },
  { symbol: "AAVE", name: "Aave", yahoo: "AAVE-USD", binance: "AAVETRY", decimals: 2, badge: "DEFI 👻", isCheap: false },
  { symbol: "CRV", name: "Curve Finance", yahoo: "CRV-USD", binance: "CRVTRY", decimals: 4, badge: "DEFI 🌀", isCheap: true },
  { symbol: "CAKE", name: "PancakeSwap", yahoo: "CAKE-USD", binance: "CAKETRY", decimals: 4, badge: "DEX 🥞", isCheap: true },
  { symbol: "DYDX", name: "dYdX", yahoo: "DYDX-USD", binance: "DYDXTRY", decimals: 4, badge: "DEFI ⚡", isCheap: true },
  { symbol: "JUP", name: "Jupiter", yahoo: "JUP-USD", binance: "JUPTRY", decimals: 4, badge: "DEX 🪐", isCheap: true },
  { symbol: "LDO", name: "Lido DAO", yahoo: "LDO-USD", binance: "LDOTRY", decimals: 4, badge: "DEFI 🔵", isCheap: true },
  { symbol: "SUSHI", name: "SushiSwap", yahoo: "SUSHI-USD", binance: "SUSHITRY", decimals: 4, badge: "DEX 🍣", isCheap: true },
]

export const BOT_STORAGE_KEY = "piyasaiq:crypto_bot_tl_v3"

// 🔄 KESİN İŞLEM DURUM MAKİNESİ (Trade State Machine)
// WATCH → READY → ENTRY → MANAGE → EXIT → COOLDOWN
export type TradeState = "WATCH" | "READY" | "ENTRY" | "MANAGE" | "EXIT" | "COOLDOWN"

export interface TradeStateMachineContext {
  symbol: string
  state: TradeState
  lastTransitionTime: number
  reentryCooldownUntil?: number
  cooldownReason?: "SL" | "TIME_STOP" | "MANUAL" | "TP"
  btcCircuitBreakerLocked: boolean
  reasons: string[]
}

