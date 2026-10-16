import { z } from "zod"
import { getClientIp, checkRateLimit, rateLimitResponse } from "@/lib/security"

export const runtime = "nodejs"

const requestSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9_:.-]{2,15}$/i),
  question: z.string().trim().min(3).max(500),
  market: z.object({
    price: z.number(),
    change: z.number(),
    updatedAt: z.string().optional(),
    source: z.string().optional(),
    technical: z.object({
      signal: z.string(),
      confidence: z.number(),
      support: z.number(),
      resistance: z.number(),
      values: z.record(z.string(), z.number().optional()),
    }),
    advice: z.array(z.object({
      label: z.string(),
      signal: z.string(),
      action: z.string(),
      invalidation: z.number(),
      target: z.number(),
    })).max(4).optional(),
    news: z.array(z.object({
      title: z.string(),
      source: z.string(),
      publishedAt: z.string().nullish(),
      url: z.string().optional(),
    }).passthrough()).max(8).optional(),
    macro: z.array(z.object({
      symbol: z.string(),
      name: z.string(),
      price: z.number().optional(),
      change: z.number().optional(),
      ok: z.boolean(),
    })).max(12).optional(),
  }),
})

// 1. Google Gemini REST Handler
async function callGemini(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6500)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 420,
        },
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text
    return candidate ? candidate.trim() : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// 2. OpenAI REST Handler
async function callOpenAI(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string | null> {
  const url = "https://api.openai.com/v1/chat/completions"
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6500)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 420,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    return content ? content.trim() : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// 3. Yüksek Hassasiyetli Quant-AI Finansal Muhakeme Motoru
function generateQuantAnalysis(params: {
  symbol: string
  price: number
  change: number
  signal: string
  confidence: number
  support: number
  resistance: number
  rsi: number
  macd: number
  macdSignal: number
  ema20?: number
  ema50?: number
  stochastic?: number
  bollinger?: number
  volumeRatio?: number
  newsCount: number
  macroSummary?: string
}): string {
  const {
    symbol, price, change, signal, confidence, support, resistance,
    rsi, macd, macdSignal, ema20, ema50, stochastic, bollinger, volumeRatio,
    newsCount, macroSummary,
  } = params

  const hasEma = ema20 !== undefined && ema50 !== undefined
  const isEmaBull = hasEma ? (price >= ema20 && ema20 >= ema50) : price > support
  const isEmaBear = hasEma ? (price < ema20 && ema20 < ema50) : price < support

  let trendText = ""
  if (isEmaBull) {
    trendText = `Fiyat üstel ortalamaların (**EMA20** ve **EMA50**) üzerinde kalarak orta vadeli yükseliş yapısını koruyor.`
  } else if (isEmaBear) {
    trendText = `Fiyat ortalamaların altında kalarak satıcılı seyrin sürdüğünü ve düşüş baskısının devam ettiğini gösteriyor.`
  } else {
    trendText = `Fiyat ortalamaların arasında sıkışarak yatay konsolidasyon ve yön arayışında bulunuyor.`
  }

  let momentumText = ""
  if (rsi >= 70 || (stochastic !== undefined && stochastic >= 80)) {
    momentumText = `RSI (${rsi.toFixed(0)}) ve Stokastik aşırı alım bölgesine gerilmiş durumda; tepede kâr realizasyonu ve geri çekilme riski yüksek.`
  } else if (rsi <= 35 || (stochastic !== undefined && stochastic <= 25)) {
    momentumText = `RSI (${rsi.toFixed(0)}) ve Stokastik aşırı satım dip bölgesinde; tepki alımları için elverişli bir zemin oluşuyor.`
  } else if (rsi >= 45 && rsi <= 60 && macd >= macdSignal) {
    momentumText = `RSI (${rsi.toFixed(0)}) sağlıklı bir birikim bölgesinde ve MACD momentumu pozitif ivmeyi teyit ediyor.`
  } else {
    momentumText = `Momentum göstergeleri dengeli seyrediyor; MACD sinyal çizgisine yakın konsolide oluyor.`
  }

  let volumeText = ""
  if (volumeRatio && volumeRatio >= 1.3) {
    volumeText = `Ortalamanın ${volumeRatio.toFixed(1)} katına ulaşan işlem hacmi mevcut harekete güçlü teyit veriyor.`
  } else if (volumeRatio && volumeRatio <= 0.6) {
    volumeText = `Düşük işlem hacmi kırılımların sahte olabileceğine işaret ediyor; temkinli olunmalı.`
  }

  let finalVerdict: "AL" | "SAT" | "TUT" = "TUT"
  let verdictRationale = ""

  if (signal.includes("AL") && rsi < 65 && (!hasEma || price >= ema20 * 0.99)) {
    finalVerdict = "AL"
    verdictRationale = `${support.toFixed(2)} desteği stop kabul edilerek ${resistance.toFixed(2)} direncine doğru kademeli pozisyon açılabilir.`
  } else if (signal.includes("SAT") || rsi >= 72 || isEmaBear) {
    finalVerdict = "SAT"
    verdictRationale = `${resistance.toFixed(2)} seviyesindeki satış baskısı ve zayıflayan momentum nedeniyle kâr realizasyonu veya risk azaltımı uygundur.`
  } else {
    finalVerdict = "TUT"
    verdictRationale = `${support.toFixed(2)} desteği ile ${resistance.toFixed(2)} direnci arasındaki kırılım yönü netleşene kadar mevcut pozisyonlar korunmalıdır.`
  }

  const newsNote = newsCount > 0
    ? `Akışta ${newsCount} güncel başlık takip ediliyor; haber akışının fiyat desteğiyle uyumlu kalması önemli.`
    : `Kaynaklı haber akışı sakin; fiyatlamalar doğrudan teknik seviyeler ve makro dinamikler tarafından belirleniyor.`

  const macroNote = macroSummary ? `Makro Çerçeve: ${macroSummary}.` : ""

  return `**${symbol}** güncel olarak **${price.toFixed(2)} ₺** seviyesinde ve günlük %${change >= 0 ? "+" : ""}${change.toFixed(2)} değişimle işlem görüyor. ${trendText} ${momentumText} ${volumeText}\n\n${newsNote} ${macroNote} Kritik teknik seviyeler: **${support.toFixed(2)} ₺** seviyesi aşağı yönlü risk eşiği (stop-loss), **${resistance.toFixed(2)} ₺** seviyesi ise ana kâr hedefi konumundadır.\n\nMevcut indikatör ve risk-getiri konsensüsüne göre net karar: **${finalVerdict}**. ${verdictRationale} (Bu analiz kural tabanlı yapay zeka modelimiz tarafından üretilmiştir; yatırım tavsiyesi değildir.)`
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const rl = checkRateLimit(`analyze:${ip}`, 30, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Geçersiz analiz isteği" }, { status: 400 })

  const { symbol, market, question } = parsed.data

  const price = market.price
  const change = market.change
  const signal = market.technical.signal
  const confidence = market.technical.confidence
  const support = market.technical.support
  const resistance = market.technical.resistance
  const rsi = market.technical.values.rsi ?? 50
  const macd = market.technical.values.macd ?? 0
  const macdSignal = market.technical.values.macdSignal ?? 0
  const ema20 = market.technical.values.ema20 ?? market.technical.values.sma20
  const ema50 = market.technical.values.ema50 ?? market.technical.values.sma50
  const stochastic = market.technical.values.stochastic
  const bollinger = market.technical.values.bollinger
  const volumeRatio = market.technical.values.volumeRatio
  const newsCount = market.news?.length ?? 0
  const macroSummary = market.macro?.map((m) => `${m.name}: ${m.change ? `%${m.change.toFixed(1)}` : ""}`).join("; ")

  const systemPrompt = "Sen keskin, net konuşan profesyonel bir Türkçe finans piyasası analistisin. İndikatörleri tek tek ezbere sayma; şirketi ve fiyatı gerçekten etkileyen trend, momentum, destek/direnç seviyelerini ve haber bağlamını 2 akıcı paragrafta açıkla. En sonda MUTLAKA kalın yazılmış net kararını (**AL** / **SAT** / **TUT**) ver ve tek cümleyle gerekçelendir. En fazla 120 kelime."
  const userPrompt = `Sembol: ${symbol}\nFiyat: ${price} ₺, Günlük Değişim: %${change.toFixed(2)}\nTeknik Konsensüs: ${signal} (%${confidence} güven)\nDestek: ${support}, Direnç: ${resistance}\nRSI: ${rsi.toFixed(1)}, MACD: ${macd.toFixed(3)} (Sinyal: ${macdSignal.toFixed(3)})\nEMA20: ${ema20?.toFixed(2) ?? "yok"}, EMA50: ${ema50?.toFixed(2) ?? "yok"}\nStochastic: ${stochastic?.toFixed(0) ?? "yok"}, Bollinger: %${bollinger?.toFixed(0) ?? "yok"}\nKullanıcı Sorusu: ${question}\nMakro Bağlam: ${macroSummary || "yok"}`

  // 1. Varsa Google Gemini API Anahtarını Dene
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY
  if (geminiKey) {
    const geminiText = await callGemini(geminiKey, systemPrompt, userPrompt)
    if (geminiText) {
      return Response.json({ text: geminiText, source: "gemini", model: "gemini-1.5-flash" })
    }
  }

  // 2. Varsa OpenAI API Anahtarını Dene
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    const openaiText = await callOpenAI(openaiKey, systemPrompt, userPrompt)
    if (openaiText) {
      return Response.json({ text: openaiText, source: "openai", model: "gpt-4o-mini" })
    }
  }

  // 3. Yerleşik Akıllı Quant-AI Finansal Muhakeme Motoru
  const quantText = generateQuantAnalysis({
    symbol, price, change, signal, confidence, support, resistance,
    rsi, macd, macdSignal, ema20, ema50, stochastic, bollinger, volumeRatio,
    newsCount, macroSummary,
  })

  return Response.json({ text: quantText, source: "quant-ai", model: "QuantAI-Financial-Model" })
}
