import { NextRequest } from "next/server"
import { scanBist30, fetchStockCandles, buildStockAnalysis, BIST_30_COMPANIES, type Bist30StockAnalysis } from "@/lib/bist30-data"
import { getClientIp, checkRateLimit, rateLimitResponse, sanitizeSymbol } from "@/lib/security"

export const runtime = "nodejs"

async function generateAiReport(stock: Bist30StockAnalysis): Promise<Bist30StockAnalysis["aiAnalysis"]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return generateFallbackReport(stock)
  }

  const prompt = `Sen Türkiye'nin en deneyimli baş borsa stratejisti ve BIST 30 portföy yöneticisisin.
Aşağıdaki BIST 30 hissesi için GÜN İÇİ ve KISA VADELİ (1-5 iş günü) derinlemesine profesyonel alım-satım ve strateji analizi yap.

HİSSE BİLGİLERİ:
- Sembol: ${stock.symbol} (${stock.name})
- Sektör: ${stock.sector}
- Anlık Fiyat: ${stock.price} TL (Günlük Değişim: %${stock.change})
- Algoritmik Sinyal: ${stock.signal} (Güven: %${stock.confidence}, Puan: ${stock.score}/100)
- Teknik Göstergeler: RSI=${stock.technical.rsi}, Trend=${stock.technical.trend}, MACD=${stock.technical.macdStatus}, RVOL (Hacim Katı)=${stock.technical.rvol}x, Stokastik=${stock.technical.stochastic}
- Destek Seviyeleri: S1=${stock.technical.support1} TL, S2=${stock.technical.support2} TL
- Direnç Seviyeleri: R1=${stock.technical.resistance1} TL, R2=${stock.technical.resistance2} TL
- İşlem Planı: Giriş=${stock.plan.entryMin} - ${stock.plan.entryMax} TL | Hedef 1=${stock.plan.target1} TL (+%${stock.plan.target1Percent}) | Hedef 2=${stock.plan.target2} TL (+%${stock.plan.target2Percent}) | Stop-Loss=${stock.plan.stopLoss} TL (%${stock.plan.stopLossPercent})
- Şirket Profili: ${stock.fundamental.description}
- İhracat / Döviz Durumu: ${stock.fundamental.exportShare} ihracat, ${stock.fundamental.fxSensitivity}

Lütfen yanıtını SADECE aşağıdaki geçerli JSON formatında döndür (başka hiçbir metin, markdown backtick vb. ekleme):
{
  "summary": "Hissenin güncel teknik ve temel durumunu, günün yönünü ve piyasa iştahını özetleyen 2-3 cümlelik vurucu stratejist değerlendirmesi.",
  "catalysts": [
    "Hissenin yükselişini veya fiyat istikrarını destekleyen 1. somut faktör",
    "2. teknik veya temel katalizör (kırılım, hacim veya sektörel destek)",
    "3. bilanço, ihracat veya kur etkisi katalizörü",
    "4. kurumsal yatırımcı veya takas desteği faktörü"
  ],
  "risks": [
    "Geri çekilmede dikkat edilmesi gereken 1. ana risk (stop seviyesi, direnç reddi)",
    "2. sektörel veya makro risk (petrol, faiz, kur, jeopolitik vb.)"
  ],
  "bullCase": "Boğa senaryosu: Alıcıların üstün gelmesi halinde kırılacak seviye ve test edilecek tepe hedef.",
  "bearCase": "Ayı senaryosu: Satış baskısının artması durumunda tutunması gereken kritik taban ve stop uyarısı.",
  "actionVerdict": "Yatırımcıya doğrudan net taktik öneri: (Örn: '286 - 289 TL bandında kademeli alım makul; 281 TL altında kesin stop uygulanmalı.')"
}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 7500)
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 600,
        },
      }),
    })
    clearTimeout(timeout)

    if (res.ok) {
      const data = await res.json()
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (text) {
        // Clean JSON formatting
        const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim()
        const parsed = JSON.parse(clean)
        if (parsed.summary && Array.isArray(parsed.catalysts)) {
          return parsed
        }
      }
    }
  } catch {}

  return generateFallbackReport(stock)
}

function generateFallbackReport(stock: Bist30StockAnalysis): Bist30StockAnalysis["aiAnalysis"] {
  const isBull = stock.signal.includes("AL")
  const isBear = stock.signal.includes("SAT")

  const summary = isBull
    ? `${stock.name} (${stock.symbol}), teknik tarafta ${stock.technical.trend.toLowerCase()} trendi ve ${stock.technical.rsi} seviyesindeki dengeli momentumuyla pozitif ayrışıyor. İşlem hacmi son ortalamaların ${stock.technical.rvol} katında seyrederken alıcıların kontrolü koruduğu görülüyor.`
    : isBear
    ? `${stock.name} (${stock.symbol}), ${stock.technical.rsi >= 70 ? "aşırı alım bölgesinde yorulma emareleri" : "teknik direnç baskısı"} gösteriyor. Kısa vadede kâr realizasyonu veya destek seviyelerine doğru geri çekilme riski yüksek.`
    : `${stock.name} (${stock.symbol}), ${stock.technical.support1} TL desteği ile ${stock.technical.resistance1} TL direnci arasında yatay konsolidasyon sürecinde. Net bir yön kırılımı oluşana kadar temkinli kalınmalıdır.`

  return {
    summary,
    catalysts: [
      `${stock.fundamental.catalysts[0] || "Güçlü pazar payı ve BIST 30 likiditesi"}`,
      stock.technical.trend === "YUKARI" ? `Fiyat EMA 20 (${stock.technical.ema20} TL) ve EMA 50 (${stock.technical.ema50} TL) ortalamalarının üzerinde seyrediyor.` : `Direnç testinde hacim teyidi bekleniyor.`,
      `MACD göstergesi ${stock.technical.macdStatus.toLowerCase()} bölgede momentumu teyit ediyor.`,
      `${stock.fundamental.exportShare} ihracat oranı ve ${stock.fundamental.fxSensitivity.toLowerCase()} ile sağlam mali yapı.`,
    ],
    risks: [
      `${stock.plan.stopLoss} TL seviyesi altındaki günlük kapanışlar kısa vadeli yükseliş yapısını bozar.`,
      stock.fundamental.risks[0] || "Sektörel maliyet artışları veya genel BIST 100 düzeltme riski.",
    ],
    bullCase: `${stock.technical.resistance1} TL direncinin hacimli aşılması halinde ${stock.plan.target1} TL ve ardından ${stock.plan.target2} TL seviyeleri hedeflenebilir.`,
    bearCase: `${stock.technical.support1} TL desteğinin kırılması durumunda satış baskısı ${stock.plan.stopLoss} TL stop seviyesine kadar derinleşebilir.`,
    actionVerdict: isBull
      ? `${stock.plan.entryMin} - ${stock.plan.entryMax} TL aralığında kademeli giriş düşünülebilir. Zarar durdur seviyesi ${stock.plan.stopLoss} TL (%${stock.plan.stopLossPercent}) olarak disiplinle takip edilmelidir.`
      : isBear
      ? `Mevcut seviyelerde yeni alım riskli olabilir. ${stock.technical.support1} TL desteğindeki tepki hareketleri veya kâr realizasyonu izlenmelidir.`
      : `Bandın kırılım yönü (Direnç: ${stock.technical.resistance1} TL / Destek: ${stock.technical.support1} TL) teyit edilene kadar bekle-gör stratejisi uygulanabilir.`,
  }
}

export async function GET(request: NextRequest) {
  // Rate limiting: 60 requests per minute per IP
  const ip = getClientIp(request)
  const rl = checkRateLimit(`bist30:${ip}`, 60, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  const { searchParams } = new URL(request.url)
  const requestedSymbol = sanitizeSymbol(searchParams.get("symbol") || "")
  const shouldForceRefresh = searchParams.get("refresh") === "1"
  const includeAi = searchParams.get("ai") === "1"

  try {
    const scanResult = await scanBist30(shouldForceRefresh)

    // If specific symbol requested
    let targetStock: Bist30StockAnalysis | undefined
    if (requestedSymbol) {
      targetStock = scanResult.allStocks.find(s => s.symbol.toUpperCase() === requestedSymbol.toUpperCase())
      if (!targetStock && BIST_30_COMPANIES[requestedSymbol.toUpperCase()]) {
        // Fetch on-demand if not in current list
        const sym = requestedSymbol.toUpperCase()
        const fetched = await fetchStockCandles(sym)
        if (fetched) {
          targetStock = buildStockAnalysis(sym, fetched.candles, fetched.price, fetched.change, fetched.previousClose)
        }
      }
    }

    // Default to top pick if no specific valid symbol was found
    const stockToDeepAnalyze = targetStock || scanResult.topPick

    // Generate or attach AI Analysis if requested or for selected stock
    if (includeAi || !stockToDeepAnalyze.aiAnalysis) {
      stockToDeepAnalyze.aiAnalysis = await generateAiReport(stockToDeepAnalyze)
    }

    return Response.json({
      success: true,
      topPick: scanResult.topPick,
      topBuys: scanResult.topBuys,
      topSells: scanResult.topSells,
      selectedStock: stockToDeepAnalyze,
      allStocks: scanResult.allStocks,
      backtestSummary: scanResult.backtestSummary,
      timestamp: scanResult.timestamp,
    })
  } catch (error: any) {
    return Response.json(
      {
        success: false,
        error: error.message || "BIST 30 verisi alınamadı",
      },
      { status: 500 }
    )
  }
}
