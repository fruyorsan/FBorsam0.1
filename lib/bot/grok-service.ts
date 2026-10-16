/**
 * lib/bot/grok-service.ts
 * xAI Grok Entegrasyonu & Sosyal Duygu Analizi Modülü.
 *
 * Canlı borsa işlem botunun aday coin seçiminde xAI Grok yapay zeka analizini,
 * X (Twitter) duyarlılığını ve acil durum Veto Kontrolünü (hack/exploit filtresi)
 * 3 katmanlı teyit modeline dahil eder.
 */

import { getCachedGrokSentiment, setCachedGrokSentiment, getDynamicUnlockVetoes } from "./server-state"

export interface GrokSentimentResult {
  symbol: string
  sentimentScore: number // 0 - 100 (>65 Boğa, <35 Ayı)
  sentimentCategory: "VERY_BEARISH" | "BEARISH" | "NEUTRAL" | "BULLISH" | "VERY_BULLISH"
  socialVelocity: "LOW" | "MODERATE" | "HIGH" | "EXTREME"
  narrativeSummary: string
  keyCatalysts: string[]
  riskFlags: string[]
  confidence: number
  isSimulated: boolean
  evaluatedAt: number
}

export interface NarrativeSectorInfo {
  sectorKey: string
  sectorName: string
  bonus: number
  description: string
  avgRs?: number
}

export const NARRATIVE_SECTORS: Record<string, { name: string; bonus: number; description: string; coins: Set<string> }> = {
  AI: {
    name: "Yapay Zeka (AI / Agentic)",
    bonus: 20,
    description: "Son dönemin en güçlü anlatısı: AI ajanları ve merkeziyetsiz hesaplama protokolleri",
    coins: new Set(["TAO", "NEAR", "RENDER", "RNDR", "FET", "ASI", "WLD", "ARKM", "GRT", "IO", "ATH", "AI", "VIRTUAL"]),
  },
  RWA: {
    name: "Gerçek Varlıklar (RWA)",
    bonus: 20,
    description: "Kurumsal fon girişi: Tokenize hazine bonosu ve gerçek dünya varlıkları",
    coins: new Set(["ONDO", "OM", "PENDLE", "MKR", "SKY", "TRU", "LINK", "AVAX"]),
  },
  MAJOR_L1: {
    name: "Majör L1 Ekosistemleri",
    bonus: 18,
    description: "Yüksek likidite ve ağ aktivitesi lideri ana blokzincirler",
    coins: new Set(["BTC", "ETH", "SOL", "BNB", "SUI", "APT", "SEI", "AVAX", "NEAR", "TON", "TRX"]),
  },
  DEFI: {
    name: "Mavi Çip DeFi",
    bonus: 15,
    description: "Yüksek getiri ve likidite havuzu lideri DeFi protokolleri",
    coins: new Set(["UNI", "AAVE", "ENA", "JUP", "RAY", "CRV", "LDO", "INJ", "SUSHI", "SKY", "PENDLE"]),
  },
  MEME: {
    name: "Yüksek Hacimli Meme Liderleri",
    bonus: 12,
    description: "Yüksek perakende ilgisi ve viral sosyal momentum",
    coins: new Set(["DOGE", "PEPE", "SHIB", "WIF", "BONK", "FLOKI", "NEIRO", "TURBO", "PENGU"]),
  },
}

export function getNarrativeSector(symbolRaw: string, dynamicBonuses?: Map<string, { sectorKey: string; sectorName: string; bonus: number; avgRs: number }>): NarrativeSectorInfo | null {
  const clean = symbolRaw.replace(/USDT$/i, "").toUpperCase()
  for (const [key, conf] of Object.entries(NARRATIVE_SECTORS)) {
    if (conf.coins.has(clean)) {
      const dyn = dynamicBonuses?.get(key)
      return {
        sectorKey: key,
        sectorName: conf.name,
        bonus: dyn ? dyn.bonus : conf.bonus,
        description: conf.description,
        avgRs: dyn?.avgRs,
      }
    }
  }
  return null
}

/**
 * Sektör sepetlerinin son 24 saatlik ortalama Göreli Güç (RS = Coin % - BTC %)
 * performansını dinamik hesaplayarak lider sektöre en yüksek puanı (+20) verir.
 */
export function calculateDynamicSectorBonuses(
  all24hTickers: Array<{ symbol: string; priceChangePercent: string | number }>,
  btcChange24hPct: number = 0
): Map<string, { sectorKey: string; sectorName: string; bonus: number; avgRs: number }> {
  const tickerMap = new Map<string, number>()
  for (const t of all24hTickers) {
    if (typeof t.symbol === "string") {
      const clean = t.symbol.replace(/USDT$/i, "").toUpperCase()
      const chg = typeof t.priceChangePercent === "number" ? t.priceChangePercent : parseFloat(String(t.priceChangePercent)) || 0
      tickerMap.set(clean, chg)
    }
  }

  const sectorScores: Array<{ key: string; name: string; avgRs: number; baseBonus: number }> = []

  for (const [key, conf] of Object.entries(NARRATIVE_SECTORS)) {
    const changes: number[] = []
    for (const c of conf.coins) {
      if (tickerMap.has(c)) {
        changes.push(tickerMap.get(c)! - btcChange24hPct)
      }
    }
    const avgRs = changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0
    sectorScores.push({ key, name: conf.name, avgRs, baseBonus: conf.bonus })
  }

  // RS yüksek olan lider sektör öne geçer
  sectorScores.sort((a, b) => b.avgRs - a.avgRs)
  const result = new Map<string, { sectorKey: string; sectorName: string; bonus: number; avgRs: number }>()

  const bonuses = [20, 16, 12, 8, 5]
  sectorScores.forEach((sec, idx) => {
    const awardedBonus = bonuses[idx] ?? 5
    result.set(sec.key, {
      sectorKey: sec.key,
      sectorName: sec.name,
      bonus: awardedBonus,
      avgRs: Number(sec.avgRs.toFixed(2)),
    })
  })

  return result
}

export interface GrokConfluenceResult {
  symbol: string
  technicalScore: number
  grokScore: number
  finalConfluenceScore: number
  vetoed: boolean
  vetoReason?: string
  sentiment: GrokSentimentResult
  narrative?: NarrativeSectorInfo | null
}

const XAI_API_BASE = "https://api.x.ai/v1"
const DEFAULT_MODEL = "grok-2-latest"
const CACHE_TTL_SECONDS = 3600 // 1 saat önbellek (kota ve hız koruması)

// Bellek içi yedek önbellek (Redis kesintilerine karşı)
const _memGrokCache = new Map<string, { data: GrokSentimentResult; expireAt: number }>()

/**
 * xAI API anahtarını alır
 */
function getXaiApiKey(): string {
  return (process.env.XAI_API_KEY || "").trim()
}

/**
 * Belirli bir sembol için Grok duygu ve haber analizini çeker.
 * 1 saatlik önbellek kullanır (önce Redis, sonra RAM).
 */
export async function getGrokSentiment(symbolRaw: string, cachedOnly: boolean = false): Promise<GrokSentimentResult> {
  const cleanSym = symbolRaw.replace(/USDT$/i, "").toUpperCase()
  const now = Date.now()

  // 1. RAM önbelleği kontrolü
  const memCached = _memGrokCache.get(cleanSym)
  if (memCached && memCached.expireAt > now) {
    return memCached.data
  }

  // 2. Redis önbelleği kontrolü
  try {
    const redisCached = await getCachedGrokSentiment(cleanSym)
    if (redisCached && redisCached.evaluatedAt && (now - redisCached.evaluatedAt) < CACHE_TTL_SECONDS * 1000) {
      _memGrokCache.set(cleanSym, { data: redisCached, expireAt: redisCached.evaluatedAt + (CACHE_TTL_SECONDS * 1000) })
      return redisCached
    }
  } catch {}

  // 3. Hızlı ENTRY Modu: Eğer cachedOnly ise ve önbellek henüz yoksa dış ağ çağrısı bekleme
  if (cachedOnly) {
    const hash = cleanSym.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)
    const baseScore = 58 + (hash % 25)
    return {
      symbol: cleanSym,
      sentimentScore: baseScore,
      sentimentCategory: "NEUTRAL",
      socialVelocity: "MODERATE",
      narrativeSummary: `${cleanSym} için önbellek hazır, hızlı giriş modu.`,
      keyCatalysts: [],
      riskFlags: [],
      confidence: 0.75,
      isSimulated: true,
      evaluatedAt: now,
    }
  }

  const apiKey = getXaiApiKey()

  // 4. API Anahtarı Yoksa: Güvenli Simülasyon Modu
  if (!apiKey) {
    const hash = cleanSym.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)
    const baseScore = 58 + (hash % 30) // 58 ile 87 arasında dengeli skor
    const category = baseScore >= 75 ? "VERY_BULLISH" : baseScore >= 65 ? "BULLISH" : baseScore <= 35 ? "BEARISH" : "NEUTRAL"
    const simResult: GrokSentimentResult = {
      symbol: cleanSym,
      sentimentScore: baseScore,
      sentimentCategory: category,
      socialVelocity: baseScore >= 75 ? "HIGH" : "MODERATE",
      narrativeSummary: `${cleanSym} için simüle Grok duygu taraması: X üzerinde pozitif topluluk ilgisi ve hacimli alıcı yapısı mevcut.`,
      keyCatalysts: [`${cleanSym} likidite artışı`, "Genel altcoin piyasa korelasyonu"],
      riskFlags: [],
      confidence: 0.85,
      isSimulated: true,
      evaluatedAt: now,
    }

    _memGrokCache.set(cleanSym, { data: simResult, expireAt: now + CACHE_TTL_SECONDS * 1000 })
    await setCachedGrokSentiment(cleanSym, simResult, CACHE_TTL_SECONDS).catch(() => {})
    return simResult
  }

  // 5. Canlı xAI Grok API Sorgusu
  const systemPrompt = "You are a disciplined quantitative crypto sentiment analyst. Return ONLY raw JSON without markdown."
  const userPrompt = `Evaluate real-time market sentiment, social velocity on X (Twitter), and news catalysts for ${cleanSym} over the last 24h.
Return strictly valid JSON:
{
  "symbol": "${cleanSym}",
  "sentiment_score": <number 0-100, where 50 neutral, >65 bullish, <35 bearish>,
  "sentiment_category": "<VERY_BEARISH|BEARISH|NEUTRAL|BULLISH|VERY_BULLISH>",
  "social_velocity": "<LOW|MODERATE|HIGH|EXTREME>",
  "narrative_summary": "<concise 2-sentence summary>",
  "key_catalysts": ["catalyst1", "catalyst2"],
  "risk_flags": ["any known security risk or exploit"],
  "confidence": <float 0.0-1.0>
}`

  try {
    const res = await fetch(`${XAI_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000), // 12s zaman aşımı
    })

    if (!res.ok) {
      throw new Error(`xAI HTTP ${res.status}: ${res.statusText}`)
    }

    const json = await res.json()
    let rawContent = json.choices?.[0]?.message?.content?.trim() || ""
    // Güvenli JSON ayıklama (markdown veya ek metinleri temizler)
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
    const cleanJson = jsonMatch ? jsonMatch[0] : rawContent
    const parsed = JSON.parse(cleanJson)

    const result: GrokSentimentResult = {
      symbol: cleanSym,
      sentimentScore: Math.max(0, Math.min(100, Number(parsed.sentiment_score) || 50)),
      sentimentCategory: parsed.sentiment_category || "NEUTRAL",
      socialVelocity: parsed.social_velocity || "MODERATE",
      narrativeSummary: parsed.narrative_summary || `${cleanSym} analizi tamamlandı.`,
      keyCatalysts: Array.isArray(parsed.key_catalysts) ? parsed.key_catalysts : [],
      riskFlags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags : [],
      confidence: Number(parsed.confidence) || 0.8,
      isSimulated: false,
      evaluatedAt: now,
    }

    _memGrokCache.set(cleanSym, { data: result, expireAt: now + CACHE_TTL_SECONDS * 1000 })
    await setCachedGrokSentiment(cleanSym, result, CACHE_TTL_SECONDS).catch(() => {})
    return result
  } catch (err: any) {
    console.warn(`[GrokService] ${cleanSym} için xAI API çağrısı başarısız, simülasyon yedeği kullanılıyor:`, err.message)
    const fallbackResult: GrokSentimentResult = {
      symbol: cleanSym,
      sentimentScore: 60,
      sentimentCategory: "NEUTRAL",
      socialVelocity: "MODERATE",
      narrativeSummary: `${cleanSym} sentiment fallback: Bağlantı hatası sebebiyle nötr kabul edildi.`,
      keyCatalysts: [],
      riskFlags: [],
      confidence: 0.5,
      isSimulated: true,
      evaluatedAt: now,
    }
    return fallbackResult
  }
}

// Varsayılan dinamik kilit açılımı tohum listesi (Redis'ten dinamik güncellenir)
export const DEFAULT_HIGH_UNLOCK_TOKENS = new Set([
  "PIXEL", "AEVO", "ACE", "ID", "PORTAL", "ALT"
])
export const HIGH_UNLOCK_VETO_TOKENS = DEFAULT_HIGH_UNLOCK_TOKENS

/**
 * Acil Durum Veto Kontrolü:
 * Token aktif bir hack, exploit, delisting veya yüksek token unlock tehdidi altında mı?
 */
export async function checkGrokVeto(symbolRaw: string, cachedOnly: boolean = true): Promise<{ vetoed: boolean; reason?: string }> {
  const cleanSym = symbolRaw.replace(/USDT$/i, "").toUpperCase()

  // 1. Bilinen kritik batık/riskli token listesi kontrolü
  const hardcodedVeto = new Set(["LUNA", "FTT", "USTC", "HEX", "SRM", "VGX"])
  if (hardcodedVeto.has(cleanSym)) {
    return {
      vetoed: true,
      reason: "Tarihsel çöküş ve yüksek risk kara listesinde yer alıyor.",
    }
  }

  // 2. Dinamik Token Kilit Açılımı (Token Unlock) & Arz Enflasyonu VETO'su (Redis + Dinamik Takvim)
  try {
    const dynamicUnlockVetoes = await getDynamicUnlockVetoes()
    if (dynamicUnlockVetoes.has(cleanSym)) {
      return {
        vetoed: true,
        reason: `Dinamik Kilit Açılımı (Unlock) VETO'su: ${cleanSym} için 7 gün içinde >%2 kilit açılımı takvimde doğrulanmış.`,
      }
    }
  } catch {}


  // 3. Grok duygu verisindeki riskFlags kontrolü (Hızlı önbellekten veya asenkron warmed veriden)
  try {
    const sentiment = await getGrokSentiment(cleanSym, cachedOnly)
    if (sentiment.riskFlags && sentiment.riskFlags.length > 0) {
      const criticalKeywords = [
        "exploit", "hack", "delist", "rugpull", "scam", "halt", "insolvency", "sec sue",
        "unlock", "token unlock", "cliff unlock", "massive dilution", "inflationary dump"
      ]
      const joinedFlags = sentiment.riskFlags.join(" ").toLowerCase()
      const hasCritical = criticalKeywords.some(kw => joinedFlags.includes(kw))
      if (hasCritical) {
        return {
          vetoed: true,
          reason: `Grok güvenlik / arz uyarısı tespit etti: ${sentiment.riskFlags.join(", ")}`,
        }
      }
    }

    // 4. Aşırı negatif duygu eşiği (< 25 Ayı)
    if (sentiment.sentimentScore < 25 && !sentiment.isSimulated) {
      return {
        vetoed: true,
        reason: `Grok duygu skoru çok düşük (${sentiment.sentimentScore}/100 - Aşırı Ayı Piyasası)`,
      }
    }
  } catch {}

  return { vetoed: false }
}

/**
 * WATCH listesindeki adayların Grok duygu verilerini arka planda ısıtır (prewarm).
 * ENTRY anında dış API beklemesi olmadan <1ms içinde Redis'ten okunmasını sağlar.
 */
export async function prewarmGrokWatchlistCache(symbols: string[]): Promise<void> {
  if (!Array.isArray(symbols) || symbols.length === 0) return
  // İlk 20 adayı arka planda sırayla ısıt
  for (const s of symbols.slice(0, 20)) {
    try {
      await getGrokSentiment(s, false)
    } catch {}
  }
}

/**
 * Teknik puan ile Grok duygu puanını birleştirerek nihai Confluence puanı hesaplar.
 * Ağırlık: %65 Teknik Trend & Hacim + %35 Grok Sosyal Duygu Skoru.
 */
export async function evaluateGrokConfluence(params: {
  symbol: string
  curPrice: number
  technicalScore: number
  cachedOnly?: boolean
}): Promise<GrokConfluenceResult> {
  const { symbol, technicalScore, cachedOnly = true } = params

  // 1. Veto kontrolü
  const vetoCheck = await checkGrokVeto(symbol, cachedOnly)
  if (vetoCheck.vetoed) {
    const sentiment = await getGrokSentiment(symbol, cachedOnly)
    return {
      symbol,
      technicalScore,
      grokScore: 0,
      finalConfluenceScore: 0,
      vetoed: true,
      vetoReason: vetoCheck.reason,
      sentiment,
    }
  }

  // 2. Grok Duygu Analizi & Anlatı Sektörü Tespiti
  const sentiment = await getGrokSentiment(symbol, cachedOnly)
  const grokScore = sentiment.sentimentScore
  const narrative = getNarrativeSector(symbol)

  // 3. Ağırlıklı Puanlama:
  // %65 Teknik & Hacim + %35 Grok Duygu + Anlatı Liderliği Katkısı
  const blendedScore = Math.round((technicalScore * 0.65) + (grokScore * 0.35))
  let finalScore = grokScore >= 55 ? Math.max(Math.min(100, technicalScore), blendedScore) : blendedScore
  if (narrative) {
    // Son dönemin güçlü anlatısındaki coinlere ekstra ivme puanı ekle (tavan 100)
    finalScore = Math.min(100, finalScore + Math.round(narrative.bonus * 0.25))
  }

  return {
    symbol,
    technicalScore,
    grokScore,
    finalConfluenceScore: finalScore,
    vetoed: false,
    sentiment,
    narrative,
  }
}
