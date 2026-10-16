import { z } from "zod"

export const runtime = "nodejs"

const requestSchema = z.object({
  title: z.string().trim().min(3).max(300),
  source: z.string().trim().max(120).optional(),
  url: z.string().url().optional(),
})

const headers = { "User-Agent": "Mozilla/5.0 PiyasaIQ/1.0" }

// Best-effort plain-text extraction from an article URL.
async function fetchArticleText(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 7000)
  try {
    const response = await fetch(url, { signal: controller.signal, headers, redirect: "follow" })
    if (!response.ok) return ""
    const html = await response.text()
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    const paragraphs = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .filter(t => t.length > 40)
    return paragraphs.slice(0, 8).join("\n").slice(0, 3500)
  } catch {
    return ""
  } finally {
    clearTimeout(timeout)
  }
}

async function callGeminiSummary(apiKey: string, title: string, source: string, article: string): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: "Sen Türkçe bir finans haber editörüsün. Sana verilen haber başlığını ve varsa metin parçasını 2 kısa cümlede özetle. Yalnız verilen bilgiyi kullan, rakam uydurma." }]
        },
        contents: [{
          role: "user",
          parts: [{ text: `Başlık: ${title}\nKaynak: ${source}\nMetin: ${article || "Yalnızca başlık mevcut."}` }]
        }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.2 },
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Geçersiz özet isteği" }, { status: 400 })
  const { title, source, url } = parsed.data
  const cleanSource = source ?? "Piyasa Kaynağı"
  const article = url ? await fetchArticleText(url) : ""

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY
  if (geminiKey) {
    const aiSummary = await callGeminiSummary(geminiKey, title, cleanSource, article)
    if (aiSummary) {
      return Response.json({ summary: aiSummary, source: "gemini" })
    }
  }

  // Akıllı NLP Çıkarımı
  const lead = article ? article.split("\n")[0].slice(0, 240).trim() : title
  const finalSummary = article
    ? `${lead}... (Haber özeti: ${cleanSource})`
    : `${title} (${cleanSource})`

  return Response.json({ summary: finalSummary, source: article ? "article-nlp" : "title-nlp" })
}
