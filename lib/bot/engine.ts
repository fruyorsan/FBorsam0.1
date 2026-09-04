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
  closeReason?: string
  closedAt?: string
  triggerType: "INDICATOR" | "MANUAL" | "AI_SUGGESTION"
  orderType: "LIMIT" | "MARKET"
  limitPrice?: number
  commissionTry?: number
  commissionRatio?: number
  netPnlTry?: number
}


export interface BotStrategy {
  autoPilot: boolean
  orderType: "LIMIT" | "MARKET"
  limitDiscountPct: number
  tradeAmountTry: number
  maxConcurrentPositions: number
  autoAllocateCapital: boolean
  aiOpportunityRanking: boolean
  // Öneri 4: Dinamik Pozisyon Boyutu
  dynamicSizing: boolean
  dynamicSizingAggressiveness: "conservative" | "balanced" | "aggressive"
  // Öneri 5: Günlük Maks. Zarar Limiti
  dailyMaxLossPct: number
  // Öneri 2: Yatay Pozisyon Kapatma (Stale Position Timeout)
  stalePositionTimeoutEnabled: boolean
  stalePositionTimeoutHours: number // örn. 4 saat
  // Öneri 3: BTC Şelale / Ani Düşüş Koruması (Market Panic Switch)
  btcDropProtectionEnabled: boolean
  btcDropThresholdPct: number // örn. -2.0%
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
  connected: boolean
  realBalanceTry: number
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
  orderType: "LIMIT",
  limitDiscountPct: 0.25,
  tradeAmountTry: 2500,
  maxConcurrentPositions: 3, // En fazla 2-3 açık pozisyon
  autoAllocateCapital: true, // Parayı bakiye ve slot sayısına göre otomatik dağıt
  aiOpportunityRanking: true, // En yüksek kâr potansiyelli meme coinleri önceliklendir
  dynamicSizing: true, // Öneri 4: AI skora göre slot boyutu ayarla
  dynamicSizingAggressiveness: "balanced", // conservative | balanced | aggressive
  dailyMaxLossPct: 5, // Öneri 5: Günde max %5 zarar toleransı, sonra bot durur
  stalePositionTimeoutEnabled: true, // Öneri 2: 4 saatte hedefe gitmeyen yatay pozisyonu kapatıp yeni fırsata geç
  stalePositionTimeoutHours: 4,
  btcDropProtectionEnabled: true, // Öneri 3: BTC ani şelale yaparsa alımları dondur & kârları koru
  btcDropThresholdPct: -2.0, // BTC son 15m'de -%2.0 düşerse panik modu
  emailNotificationsEnabled: true, // E-posta Bildirimleri
  userNotificationEmail: "",
  rsiEnabled: true,

  rsiBuyThreshold: 32,
  rsiSellThreshold: 68,
  smaCrossEnabled: true,
  sentimentEnabled: true,
  defaultStopLossPct: 2.0,
  defaultTakeProfitPct: 2.5,
  smartEarlyExitEnabled: true,
  breakevenEnabled: true,
  breakevenPct: 0.7,
  trailingStopPct: 0.8,
  commissionRatePct: 0.1,
  maxCommissionProfitRatio: 10,
  tradingHoursEnabled: false, // 7/24 Kesintisiz Kripto Piyasası Modu
  tradingHoursStart: 0,
  tradingHoursEnd: 24,
  timeframeFilterEnabled: true,
  memeCoinsOnly: false, // Sadece meme değil; ucuz, popüler ve yüksek hacimli tüm Binance coinlerini kapsasın
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
  balanceTry: 50000,
  initialBalanceTry: 50000,
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
  // Popüler & Yüksek Hacimli Ucuz / Orta Fiyatlı Kriptolar (Binance TR)
  { symbol: "PEPE", name: "Pepe", yahoo: "PEPE24478-USD", binance: "PEPETRY", decimals: 8, badge: "MEME 🐸", isCheap: true },
  { symbol: "SHIB", name: "Shiba Inu", yahoo: "SHIB-USD", binance: "SHIBTRY", decimals: 8, badge: "MEME 🐕", isCheap: true },
  { symbol: "DOGE", name: "Dogecoin", yahoo: "DOGE-USD", binance: "DOGETRY", decimals: 4, badge: "MEME 🚀", isCheap: true },
  { symbol: "FLOKI", name: "Floki", yahoo: "FLOKI-USD", binance: "FLOKITRY", decimals: 6, badge: "MEME ⚔️", isCheap: true },
  { symbol: "BONK", name: "Bonk", yahoo: "BONK-USD", binance: "BONKTRY", decimals: 8, badge: "MEME 🔨", isCheap: true },
  { symbol: "WIF", name: "dogwifhat", yahoo: "WIF-USD", binance: "WIFTRY", decimals: 4, badge: "MEME 🧢", isCheap: false },
  { symbol: "XRP", name: "Ripple", yahoo: "XRP-USD", binance: "XRPTRY", decimals: 4, badge: "POPÜLER ⚡", isCheap: true },
  { symbol: "ADA", name: "Cardano", yahoo: "ADA-USD", binance: "ADATRY", decimals: 4, badge: "POPÜLER 💎", isCheap: true },
  { symbol: "SUI", name: "Sui Network", yahoo: "SUI20947-USD", binance: "SUITRY", decimals: 4, badge: "L1 POPÜLER 🔥", isCheap: true },
  { symbol: "RENDER", name: "Render AI", yahoo: "RENDER-USD", binance: "RENDERTRY", decimals: 4, badge: "YAPAY ZEKA 🤖", isCheap: false },
  { symbol: "NEAR", name: "NEAR Protocol", yahoo: "NEAR-USD", binance: "NEARTRY", decimals: 4, badge: "YAPAY ZEKA 🧠", isCheap: false },
  { symbol: "AVAX", name: "Avalanche", yahoo: "AVAX-USD", binance: "AVAXTRY", decimals: 2, badge: "L1 DEV 🔺", isCheap: false },
  { symbol: "SOL", name: "Solana", yahoo: "SOL-USD", binance: "SOLTRY", decimals: 2, badge: "L1 ⚡", isCheap: false },
  { symbol: "BTC", name: "Bitcoin", yahoo: "BTC-USD", binance: "BTCTRY", decimals: 2, badge: "KRAL 👑", isCheap: false },
]

export const BOT_STORAGE_KEY = "piyasaiq:crypto_bot_tl_v3"

