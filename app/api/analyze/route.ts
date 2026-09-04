import { generateText } from "ai"
import { z } from "zod"
import { getClientIp, checkRateLimit, rateLimitResponse } from "@/lib/security"

const requestSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{3,10}$/),
  question: z.string().trim().min(3).max(500),
  market: z.object({
    price: z.number(), change: z.number(), updatedAt: z.string().optional(), source: z.string().optional(),
    technical: z.object({ signal: z.string(), confidence: z.number(), support: z.number(), resistance: z.number(), values: z.record(z.string(), z.number()) }),
    advice: z.array(z.object({ label: z.string(), signal: z.string(), action: z.string(), invalidation: z.number(), target: z.number() })).max(4),
    news: z.array(z.object({ title: z.string(), source: z.string(), publishedAt: z.string().nullish(), url: z.string().optional() }).passthrough()).max(8),
    macro: z.array(z.object({ symbol: z.string(), name: z.string(), price: z.number().optional(), change: z.number().optional(), ok: z.boolean() })).max(12).optional(),
  }),
})

export async function POST(request: Request) {
  // Rate limiting: 12 AI requests/minute per IP
  const ip = getClientIp(request)
  const rl = checkRateLimit(`analyze:${ip}`, 12, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Geçersiz analiz isteği" }, { status: 400 })
  const { symbol, market, question } = parsed.data
  const technical = `Fiyat ${market.price}; günlük değişim %${market.change.toFixed(2)}; konsensüs ${market.technical.signal}; model güveni %${market.technical.confidence}; destek ${market.technical.support}; direnç ${market.technical.resistance}; RSI ${market.technical.values.rsi?.toFixed(2)}; MACD ${market.technical.values.macd?.toFixed(2)}; MACD sinyal ${market.technical.values.macdSignal?.toFixed(2)}; Stochastic ${market.technical.values.stochastic?.toFixed(2)}; ATR ${market.technical.values.atr?.toFixed(2)}; EMA20 ${market.technical.values.sma20?.toFixed(2)}; EMA50 ${market.technical.values.sma50?.toFixed(2)}`
  const horizons = market.advice.map(item => `${item.label}: ${item.signal}, ${item.action}, risk/geçersizleşme ${item.invalidation}, izlenecek direnç ${item.target}`).join("; ")
  const news = market.news.length ? market.news.map(item => `[${item.source}${item.publishedAt ? ` · ${item.publishedAt}` : " · tarih yok"}] ${item.title}`).join("\n") : "Kaynaklı güncel haber yok."
  const macro = market.macro?.length ? market.macro.map(item => `${item.name} (${item.symbol}): ${item.price ?? "veri yok"}, değişim ${typeof item.change === "number" ? `%${item.change.toFixed(2)}` : "yok"}`).join("; ") : "Makro bağlam sağlanmadı."

  try {
    const { text } = await generateText({
      model: "anthropic/claude-sonnet-5",
      temperature: 0.15,
      maxOutputTokens: 420,
      system: "Sen keskin, net konuşan bir Türkçe piyasa yorumcususun. İndikatörleri (RSI, MACD, Bollinger vb.) TEK TEK sayma — bunlar ekranda zaten var. Bunun yerine şirketi gerçekten etkileyen 2-3 şeyi kısaca anlat: iş modeline göre emtia/kur/endeks etkisi (ör. rafineride Brent petrol ve rafineri marjı, ihracatçıda kur, bankada faiz) ve varsa güncel haber. Bilanço verisi verilmediyse tek cümleyle 'bilanço verisi sağlanmadı, şu kalemler kontrol edilmeli' de; rakam uydurma. Sonda MUTLAKA kendi kararını ver: AL / SAT / TUT'tan birini seç ve tek cümleyle gerekçelendir. Markdown kullan: en önemli kelime ve kararı **çift yıldızla kalın** yaz. En fazla 110 kelime, akıcı 2-3 kısa paragraf. Kesin getiri veya fiyat garantisi verme.",
      prompt: `Sembol: ${symbol}\nVeri kaynağı: ${market.source ?? "Yahoo Finance (gecikmeli)"}\nGüncel fiyat/değişim ve teknik özet: ${technical}\nMakro ve emtia bağlamı: ${macro}\nModel konsensüsü: ${market.technical.signal} (%${market.technical.confidence} güven)\nVade planları: ${horizons}\nKaynaklı başlıklar:\n${news}\n\nKısa ve net yaz. Önce şirketi etkileyen ana unsurları anlat, sonra son satırda kalın yazılmış net kararını (**AL** / **SAT** / **TUT**) ver.`,
    })
    return Response.json({ text, source: "claude", model: "anthropic/claude-sonnet-5" })
  } catch {
    const verdict = market.technical.signal.includes("AL") ? "**AL**" : market.technical.signal.includes("SAT") ? "**SAT**" : "**TUT**"
    return Response.json({
      text: `${symbol} için model konsensüsü **${market.technical.signal}** (%${market.technical.confidence} güven). ${market.technical.support.toFixed(2)} desteği altı görünümü zayıflatır; ${market.technical.resistance.toFixed(2)} direnci üstü yeni alım teyidi verir.\n\n${market.news.length ? "Güncel başlıklar mevcut; tek başına sinyal sayma, emtia/kur ile aynı yönde teyit ararsan güçlenir." : "Kaynaklı güncel haber bulunamadı, haber etkisi çıkarılmadı."} Bilanço verisi sağlanmadı; net kâr marjı ve borçluluk ayrıca kontrol edilmeli.\n\nMevcut teknik tabloya göre kısa vadeli eğilim: ${verdict}. (Bu kural tabanlı özet yatırım tavsiyesi değildir.)`,
      source: "fallback",
    })
  }
}
