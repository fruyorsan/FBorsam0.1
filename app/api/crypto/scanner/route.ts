import { NextRequest, NextResponse } from "next/server"
import { scanCryptoUniverse, SCANNER_CRYPTO_LIST, type CryptoStockAnalysis } from "@/lib/crypto-scanner-data"
import { getClientIp, checkRateLimit, rateLimitResponse, sanitizeSymbol } from "@/lib/security"

export const runtime = "nodejs"

async function generateCryptoAiReport(coin: CryptoStockAnalysis): Promise<CryptoStockAnalysis["aiAnalysis"]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return generateFallbackReport(coin)
  }

  const prompt = `Sen dünyanın en deneyimli kripto para baş analisti ve kantitatif portföy yöneticisisin.
Aşağıdaki kripto varlık için ${coin.timeHorizon} perspektifinde, kurumsal kalitede, doğrudan taktiksel al-sat analizi üret. Kullanıcı "sen dicen ben alcam" modunda, yani çok net, kafa karıştırmayan, sade ve eyleme dökülebilir rehberlik istiyor.

KRİPTO BİLGİLERİ:
- Sembol: ${coin.symbol} (${coin.name})
- Kategori: ${coin.category.toUpperCase()} (${coin.badge})
- Vade / Strateji: ${coin.timeHorizon} (${coin.horizonBadgeText})
- Fiyat: $${coin.priceFormatted} (24s Değişim: %${coin.change})
- 24s Hacim: ${coin.volumeFormatted} (RVOL: ${coin.technical.rvol}x)
- Teknik: RSI=${coin.technical.rsi}, Trend=${coin.technical.trend}, MACD=${coin.technical.macdStatus}, Stokastik=${coin.technical.stochastic}
- Destek / Direnç: S1=$${coin.technical.support1} | R1=$${coin.technical.resistance1}
- İşlem Planı: Giriş=$${coin.plan.entryMin} - $${coin.plan.entryMax} | TP1 Hedef=$${coin.plan.target1} (+%${coin.plan.target1Percent}) | TP2 Hedef=$${coin.plan.target2} (+%${coin.plan.target2Percent}) | Stop-Loss=$${coin.plan.stopLoss} (%${coin.plan.stopLossPercent})

Lütfen yanıtını SADECE aşağıdaki JSON formatında döndür (başka hiçbir metin, markdown backtick vb. ekleme):
{
  "summary": "Kripto varlığın güncel durumunu, bugün patlama yapıp yapmayacağını veya haftalık seyrini özetleyen 2-3 cümlelik çok net stratejist değerlendirmesi.",
  "catalysts": [
    "Fiyatı yukarı iten 1. faktör (hacim kırılımı, balina girişi veya ekosistem desteği)",
    "2. teknik faktör (RSI dengesi, EMA desteği veya trend gücü)",
    "3. piyasa korelasyonu ve momentum katalizörü"
  ],
  "risks": [
    "Dikkat edilecek 1. risk (stop seviyesi, BTC ani hareketi)",
    "2. volatilite veya kâr satışı riski"
  ],
  "bullCase": "Boğa senaryosu: Alıcıların üstün gelmesiyle hedeflenecek TP1 ve TP2 seviyesi.",
  "bearCase": "Ayı senaryosu: Desteğin kırılması halinde derhal uygulanacak stop-loss disiplini.",
  "actionVerdict": "Kullanıcıya doğrudan emir tavsiyesi: (Örn: '$${coin.plan.entryMin} - $${coin.plan.entryMax} aralığından alım gir, $${coin.plan.target1} seviyesinde kârı al, $${coin.plan.stopLoss} altına inerse kesin stop ol.')"
}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 7000)
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
        const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim()
        const parsed = JSON.parse(clean)
        if (parsed.summary && Array.isArray(parsed.catalysts)) {
          return parsed
        }
      }
    }
  } catch {}

  return generateFallbackReport(coin)
}

function generateFallbackReport(coin: CryptoStockAnalysis): CryptoStockAnalysis["aiAnalysis"] {
  const isDaily = coin.timeHorizon === "GÜN İÇİ (BUGÜN PATLAMA)"
  const isBull = coin.signal.includes("AL")

  const summary = isDaily
    ? `${coin.name} (${coin.displaySymbol}), yüksek işlem hacmi (${coin.technical.rvol}x) ve ${coin.technical.rsi} seviyesindeki güçlü ivmesiyle bugün gün içi patlama ve hızlı marj potansiyeli sunuyor.`
    : `${coin.name} (${coin.displaySymbol}), haftalık yarı otomasyon modelinde EMA 20 ve EMA 50 trend desteğini koruyor. Sakin ve kademeli yükseliş hedefleri için ideal konumda.`

  return {
    summary,
    catalysts: [
      `${coin.catalysts[0] || "Binance üzerinde yüksek derinlik ve balina ilgisi"}`,
      coin.technical.trend === "YUKARI" ? `Fiyat hareketli ortalamaların üzerinde seyrediyor; alıcılar kontrolde.` : `Destek bandında alım tepkisi gözleniyor.`,
      `MACD göstergesi ${coin.technical.macdStatus.toLowerCase()} bölgede pozitif momentumu teyit ediyor.`,
    ],
    risks: [
      `$${coin.plan.stopLoss} (%${coin.plan.stopLossPercent}) altındaki saatlik kapanışlarda pozisyon koşulsuz kapatılmalıdır.`,
      coin.risks[0] || "Bitcoin genel oynaklığı ve kaldıraç temizleme hareketleri.",
    ],
    bullCase: `$${coin.technical.resistance1} direnci hacimle kırılırsa doğrudan TP1 ($${coin.plan.target1}) ve TP2 ($${coin.plan.target2}) seviyeleri test edilir.`,
    bearCase: `$${coin.plan.stopLoss} desteği kaybedilirse alt destek olan $${coin.technical.support2} seviyesine geri çekilme riski doğar.`,
    actionVerdict: `${isBull ? "🟢 ALIM EMRİ:" : "🟡 İZLEME:"} $${coin.plan.entryMin} - $${coin.plan.entryMax} bandından giriş makul. İlk kâr hedefi $${coin.plan.target1} (+%${coin.plan.target1Percent}), zarar durdur ise $${coin.plan.stopLoss} (%${coin.plan.stopLossPercent}).`,
  }
}

export async function GET(request: NextRequest) {
  // Rate limiting: 60 requests/minute per IP
  const ip = getClientIp(request)
  const rl = checkRateLimit(`crypto-scanner:${ip}`, 60, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  const { searchParams } = request.nextUrl
  const symbolParam = sanitizeSymbol(searchParams.get("symbol"))
  const horizonParam = searchParams.get("horizon") // "daily" | "weekly"
  const withAi = searchParams.get("ai") === "1"
  const refresh = searchParams.get("refresh") === "1"

  try {
    const scan = await scanCryptoUniverse(refresh)

    // Filter by horizon if specified
    let filteredCoins = scan.allCoins
    if (horizonParam === "daily") {
      filteredCoins = scan.dailyExplosions
    } else if (horizonParam === "weekly") {
      filteredCoins = scan.weeklySwings
    }

    // Selected coin
    let selectedCoin: CryptoStockAnalysis | undefined
    if (symbolParam) {
      selectedCoin = scan.allCoins.find(
        (c) =>
          c.symbol.toUpperCase() === symbolParam.toUpperCase() ||
          c.displaySymbol.toUpperCase() === symbolParam.toUpperCase()
      )
    }
    if (!selectedCoin) {
      selectedCoin = scan.topPick
    }

    // AI Analysis for selected coin
    if (withAi && selectedCoin && !selectedCoin.aiAnalysis) {
      selectedCoin.aiAnalysis = await generateCryptoAiReport(selectedCoin)
    }

    return NextResponse.json({
      success: true,
      topPick: scan.topPick,
      topBuys: scan.topBuys,
      topSells: scan.topSells,
      dailyExplosions: scan.dailyExplosions,
      weeklySwings: scan.weeklySwings,
      selectedCoin,
      allCoins: filteredCoins,
      timestamp: scan.timestamp,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Kripto tarayıcısı verileri yüklenemedi.",
      },
      { status: 500 }
    )
  }
}
