import { generateText } from "ai"
import { z } from "zod"

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
    const paragraphs = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(t => t.length > 40)
    return paragraphs.slice(0, 8).join("\n").slice(0, 3500)
  } catch {
    return ""
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Geçersiz özet isteği" }, { status: 400 })
  const { title, source, url } = parsed.data
  const article = url ? await fetchArticleText(url) : ""

  try {
    const { text } = await generateText({
      model: "anthropic/claude-sonnet-5",
      temperature: 0.2,
      maxOutputTokens: 200,
      system: "Sen Türkçe bir finans haber editörüsün. Sana verilen haber başlığını ve varsa metin parçasını 2 kısa cümlede özetle. Yalnız verilen bilgiyi kullan, rakam veya olay uydurma. Metin yoksa başlıktan çıkarılabilecek kadarını söyle ve haberin hangi varlığı ilgilendirdiğini belirt. Yatırım tavsiyesi verme.",
      prompt: `Başlık: ${title}\nKaynak: ${source ?? "belirtilmedi"}\n\nHaber metni:\n${article || "(metin alınamadı, yalnız başlık mevcut)"}`,
    })
    return Response.json({ summary: text.trim(), source: article ? "article" : "title" })
  } catch {
    const lead = article ? article.split("\n")[0].slice(0, 220) : title
    return Response.json({ summary: `${lead}${article ? "" : ` (${source ?? "kaynak"})`}`, source: article ? "excerpt" : "title" })
  }
}
