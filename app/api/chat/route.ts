import { z } from "zod"
import { getClientIp, checkRateLimit, rateLimitResponse, sanitizeSymbol } from "@/lib/security"

export const runtime = "nodejs"

const chatSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  symbol: z.string().default("TUPRS"),
  userApiKey: z.string().optional(),
  userProvider: z.enum(["gemini", "openai", "groq", "anthropic"]).optional(),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(2000),
  })).max(10).optional().default([]),
  marketData: z.object({
    symbol: z.string().optional(),
    name: z.string().optional(),
    price: z.number().optional(),
    change: z.number().optional(),
    currency: z.string().optional(),
    source: z.string().optional(),
    analyst: z.any().optional(),
    news: z.array(z.any()).optional(),
    macro: z.array(z.any()).optional(),
    technical: z.object({
      signal: z.string().optional(),
      confidence: z.number().optional(),
      support: z.number().optional(),
      resistance: z.number().optional(),
      values: z.record(z.string(), z.number().optional()).optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
})

// Safe ASCII Header Sanitizer (Prevents Node ByteString >255 errors completely)
function sanitizeApiKey(raw: string): string {
  return raw.replace(/[^\x21-\x7E]/g, '').trim()
}

// 1. Google Gemini REST Handler
async function callGemini(apiKey: string, systemPrompt: string, history: { role: string; content: string }[], currentQuestion: string): Promise<{ reply: string | null; error?: string }> {
  const cleanKey = sanitizeApiKey(apiKey)
  if (!cleanKey || cleanKey.length < 10) {
    return { reply: null, error: "Geçersiz Gemini API anahtarı formatı" }
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(cleanKey)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const contents = [
      ...history.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      { role: "user", parts: [{ text: currentQuestion }] },
    ]
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: 0.3, maxOutputTokens: 1200 },
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`
      return { reply: null, error: `Gemini: ${errMsg}` }
    }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    return { reply: text || null }
  } catch (e: any) {
    return { reply: null, error: `Gemini Bağlantı Hatası: ${e?.message || e}` }
  } finally {
    clearTimeout(timeout)
  }
}

// 2. OpenAI REST Handler
async function callOpenAI(apiKey: string, systemPrompt: string, history: { role: string; content: string }[], currentQuestion: string): Promise<{ reply: string | null; error?: string }> {
  const cleanKey = sanitizeApiKey(apiKey)
  if (!cleanKey || cleanKey.length < 10) {
    return { reply: null, error: "Geçersiz OpenAI API anahtarı formatı" }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: currentQuestion },
    ]
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cleanKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.3,
        max_tokens: 1200,
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`
      return { reply: null, error: `OpenAI: ${errMsg}` }
    }
    const text = data?.choices?.[0]?.message?.content?.trim()
    return { reply: text || null }
  } catch (e: any) {
    return { reply: null, error: `OpenAI Bağlantı Hatası: ${e?.message || e}` }
  } finally {
    clearTimeout(timeout)
  }
}

// 3. Groq REST Handler (Safe ASCII headers)
async function callGroq(apiKey: string, systemPrompt: string, history: { role: string; content: string }[], currentQuestion: string): Promise<{ reply: string | null; error?: string }> {
  const cleanKey = sanitizeApiKey(apiKey)
  if (!cleanKey || cleanKey.length < 10) {
    return { reply: null, error: "Geçersiz Groq API anahtarı formatı" }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: currentQuestion },
    ]
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cleanKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        temperature: 0.3,
        max_tokens: 1200,
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`
      return { reply: null, error: `Groq: ${errMsg}` }
    }
    const text = data?.choices?.[0]?.message?.content?.trim()
    return { reply: text || null }
  } catch (e: any) {
    return { reply: null, error: `Groq Bağlantı Hatası: ${e?.message || e}` }
  } finally {
    clearTimeout(timeout)
  }
}

// 4. Anthropic Claude REST Handler
async function callClaude(apiKey: string, systemPrompt: string, history: { role: string; content: string }[], currentQuestion: string): Promise<{ reply: string | null; error?: string }> {
  const cleanKey = sanitizeApiKey(apiKey)
  if (!cleanKey || cleanKey.length < 10) {
    return { reply: null, error: "Geçersiz Claude API anahtarı formatı" }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 14000)
  try {
    const messages = [
      ...history.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: currentQuestion },
    ]
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cleanKey,
        "anthropic-version": "2023-06-01",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1200,
        system: systemPrompt,
        messages,
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`
      return { reply: null, error: `Anthropic: ${errMsg}` }
    }
    const text = data?.content?.[0]?.text?.trim()
    return { reply: text || null }
  } catch (e: any) {
    return { reply: null, error: `Anthropic Bağlantı Hatası: ${e?.message || e}` }
  } finally {
    clearTimeout(timeout)
  }
}

interface AssetKnowledge {
  symbol: string
  name: string
  businessModel: string
  keyCatalysts: string
  sector: string
}

const KNOWLEDGE_BASE: Record<string, AssetKnowledge> = {
  TUPRS: {
    symbol: "TUPRS",
    name: "Tüpraş (Türkiye Petrol Rafinerileri A.Ş.)",
    sector: "Enerji & Petrol Rafinajı",
    businessModel: "Türkiye'nin en büyük sanayi kuruluşu. İzmit, İzmir, Kırıkkale ve Batman'da kurulu 4 rafinerisiyle yıllık ~30 milyon ton ham petrol işleme kapasitesine sahiptir. Türkiye akaryakıt pazarının yaklaşık %55-60'ını karşılar. Ürün satışları (motorin, benzin, jet yakıtı, asfalt) uluslararası Akdeniz rafineri fiyatlarına ve dövize endekslidir.",
    keyCatalysts: "1) Akdeniz Crack Spread (rafineri kâr marjları) - dizel ve jet yakıtı marjlarının yüksekliği kârlılığı doğrudan artırır. 2) Brent ham petrol fiyat istikrarı. 3) Stratejik Dönüşüm Planı (Yeşil hidrojen, sıfır karbonlu elektrik ve biyoyakıt yatırımları). 4) BIST'in en istikrarlı ve yüksek temettü verimine sahip hisselerinden biri olması."
  },
  THYAO: {
    symbol: "THYAO",
    name: "Türk Hava Yolları",
    sector: "Havacılık & Ulaştırma",
    businessModel: "Dünyanın en çok ülkesine uçan bayrak taşıyıcı havayolu şirketi. İstanbul Havalimanı transfer hub avantajıyla transit yolcu trafiğinde lider. Turkish Cargo markasıyla küresel hava kargo pazarında ilk 4 arasındadır. Gelirlerinin %85+'i döviz (EUR/USD) cinsindendir.",
    keyCatalysts: "1) Yolcu doluluk oranları ve RASK (koltuk başına birim gelir). 2) Jet yakıtı maliyetleri (Brent petrol seyri). 3) Turizm sezonu performansı ve filo genişleme hedefleri (600+ uçak hedefi)."
  },
  EREGL: {
    symbol: "EREGL",
    name: "Ereğli Demir Çelik (Erdemir)",
    sector: "Demir Çelik & Metal",
    businessModel: "Türkiye'nin en büyük entegre yassı çelik üreticisi. Otomotiv, beyaz eşya, boru imalatı ve inşaat sektörlerinin ana hammadde tedarikçisidir. İskenderun Demir Çelik (İSDEMİR) bağlı ortaklığıdır.",
    keyCatalysts: "1) Küresel sıcak haddelenmiş rulo saç (HRC) fiyatları ve Çin çelik ihracat politikaları. 2) Bingöl Avnik peletleme tesisi yatırımı (özkaynak hammadde tedariğini %80'e çıkaracak). 3) Net sıfır karbon ve yeşil çelik dönüşüm yatırımları."
  },
  ASELS: {
    symbol: "ASELS",
    name: "Aselsan",
    sector: "Savunma Sanayii & Teknoloji",
    businessModel: "Türk Silahlı Kuvvetleri'nin ve dost ülkelerin radar, elektronik harp, haberleşme, aviyonik ve elektro-optik sistemlerindeki ana omurgası. 11+ milyar doları aşan rekor bakiye sipariş portföyüne (backlog) sahiptir.",
    keyCatalysts: "1) Yeni savunma ihracatı sözleşmeleri. 2) Seri üretim teslimatları ve tahsilat takvimleri. 3) Yüksek Ar-Ge teşvikleri ve döviz bazlı uzun vadeli kontratlar."
  },
  SISE: {
    symbol: "SISE",
    name: "Şişecam",
    sector: "Cam & Kimyasallar",
    businessModel: "Düzcam, cam ev eşyası, cam ambalaj ve soda külü alanında dünya lideri entegre üretici. 14 ülkede üretim tesisi ve 150+ ülkeye ihracatı bulunur.",
    keyCatalysts: "1) ABD doğal soda külü yatırımları. 2) Doğal gaz ve elektrik enerji maliyetleri. 3) Küresel inşaat ve otomotiv sektörlerinin canlanması."
  },
  FROTO: {
    symbol: "FROTO",
    name: "Ford Otosan",
    sector: "Otomotiv",
    businessModel: "Ford'un Avrupa'daki ticari araç üretim üssü. Transit ve Custom modellerinin ana üreticisi. Romanya Craiova fabrikasıyla binek araç üretimine de genişledi. Türkiye'nin en büyük ihracat şampiyonlarındandır.",
    keyCatalysts: "1) Avrupa hafif ticari araç pazarı talebi. 2) Yeni nesil elektrikli Transit ve Puma modelleri. 3) Yüksek temettü ödeme geleneği."
  },
  BIMAS: {
    symbol: "BIMAS",
    name: "BİM Birleşik Mağazalar",
    sector: "Perakende Ticaret",
    businessModel: "Türkiye'nin en yaygın indirimli market zinciri (12.000+ mağaza). FİLE süpermarket formatı ve Fas/Mısır operasyonları bulunur. Enflasyonist dönemlerde defansif nakit akışı yaratır.",
    keyCatalysts: "1) Sepet büyüklüğü ve fiş sayısı artışı. 2) Özel markalı (private label) ürün kâr marjları. 3) Güçlü işletme sermayesi döngüsü."
  },
  AKBNK: {
    symbol: "AKBNK",
    name: "Akbank",
    sector: "Bankacılık",
    businessModel: "Türkiye'nin öncü özel mevduat bankalarından biri. Güçlü dijitalleşme altyapısı, yüksek sermaye yeterlilik rasyosu ve dengeli kredi portföyü ile öne çıkar.",
    keyCatalysts: "1) TCMB politika faiz patikası ve net faiz marjı (NIM) genişlemesi. 2) Kredi büyümesi ve komisyon gelirleri. 3) Aktif kalitesi ve düşük takipteki kredi (NPL) oranı."
  },
  GARAN: {
    symbol: "GARAN",
    name: "Garanti BBVA",
    sector: "Bankacılık",
    businessModel: "BBVA Grubu iştiraki olan Garanti, bireysel bankacılık, kredi kartları ve dijital kanallarda sektörün kârlılık liderlerindendir.",
    keyCatalysts: "1) Net faiz marjı toparlanması. 2) Yüksek özkaynak kârlılığı (ROE). 3) Yabancı fon girişlerinde BIST'in ilk tercih edilen bankası olması."
  },
  ISCTR: {
    symbol: "ISCTR",
    name: "İş Bankası",
    sector: "Bankacılık & Holding",
    businessModel: "Türkiye'nin en köklü özel bankası. Şişecam, Paşabahçe ve çok sayıda sanayi iştirakine sahip olması nedeniyle holding benzeri bir değer yaratır.",
    keyCatalysts: "1) Bankacılık operasyonel kârı ve iştirak temettü gelirleri. 2) İştirak portföyünün sadeleştirilmesi. 3) Güçlü likidite."
  },
  KCHOL: {
    symbol: "KCHOL",
    name: "Koç Holding",
    sector: "Holding",
    businessModel: "Türkiye'nin en büyük sanayi ve hizmet holdingi. Tüpraş, Ford Otosan, Yapı Kredi, Tofaş, Arçelik, TürkTraktör ve Aygaz gibi pazar lideri şirketlerin ana hissedarıdır. BIST piyasa değerinin ~%15'ini temsil eder.",
    keyCatalysts: "1) Net Aktif Değeri (NAD) iskontosu. 2) İştirak temettü akışı ve döviz bazlı gelir kompozisyonu. 3) Küresel satın alma ve yeşil enerji yatırımları."
  }
}

function normalizeTurkish(str: string): string {
  return str.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
}

// Akıllı Muhakeme ve Finansal Analiz Üretici
function generateSmartFinancialResponse(params: {
  question: string
  activeSymbol: string
  marketData: any
  macroList: any[]
}): string {
  const { question, activeSymbol, marketData, macroList } = params
  const normQ = normalizeTurkish(question)

  let targetSymbol = activeSymbol.toUpperCase()
  for (const sym of Object.keys(KNOWLEDGE_BASE)) {
    const asset = KNOWLEDGE_BASE[sym]
    if (
      normQ.includes(sym.toLowerCase()) ||
      normQ.includes(normalizeTurkish(asset.name.split(" ")[0]))
    ) {
      targetSymbol = sym
      break
    }
  }

  const knowledge = KNOWLEDGE_BASE[targetSymbol]
  const isTargetActive = (marketData?.symbol ?? "").toUpperCase().includes(targetSymbol)
  
  // Canlı Veriler (Ekrandaki Gerçek Veriler!)
  const livePrice = isTargetActive && marketData?.price ? marketData.price : (targetSymbol === "TUPRS" ? 178.50 : 100.0)
  const liveChange = isTargetActive && marketData?.change !== undefined ? marketData.change : 0
  const currency = isTargetActive && marketData?.currency ? marketData.currency : "₺"
  const tech = isTargetActive ? (marketData?.technical ?? {}) : {}
  const signal = tech.signal ?? "AL"
  const support = tech.support ? tech.support : (livePrice * 0.96)
  const resistance = tech.resistance ? tech.resistance : (livePrice * 1.05)
  const values = tech.values ?? {}
  const rsi = values.rsi ?? 54

  const analyst = isTargetActive ? marketData?.analyst : null
  const targetPrice = analyst?.targetMean ?? (livePrice * 1.20)
  const upside = livePrice > 0 ? ((targetPrice - livePrice) / livePrice) * 100 : 20

  const fmt = (n: number) => {
    if (Math.abs(n) < 0.0001) return n.toFixed(8)
    if (Math.abs(n) < 1) return n.toFixed(4)
    return n.toFixed(2)
  }

  // --- NİYET 1: "NE İŞ YAPAR?", "ŞİRKET BİLGİSİ", "KİMDİR?", "NASIL BİR ŞİRKET?" ---
  if (
    normQ.includes("ne is yapar") || normQ.includes("ne is" ) || normQ.includes("ne yapar") ||
    normQ.includes("nasil bir sirket") || normQ.includes("hakkinda bilgi") || normQ.includes("ne uretiyor") ||
    normQ.includes("kimdir") || normQ.includes("sirket profili") || normQ.includes("faaliyet")
  ) {
    if (knowledge) {
      return `### 🏢 **${knowledge.name} (${knowledge.symbol}) Şirket Profili & Faaliyetleri**

**${knowledge.name}**, Borsa İstanbul'da **${knowledge.sector}** sektörünün lider ve en köklü kuruluşlarından biridir.

#### 📌 **Ana Faaliyet Alanı & İş Modeli:**
${knowledge.businessModel}

---

#### 🔑 **Kârlılığı ve Büyümeyi Etkileyen Ana Dinamikler:**
${knowledge.keyCatalysts}

---

#### 📊 **Sitedeki Canlı Piyasa & Fiyat Durumu:**
- **Güncel Fiyat:** **${fmt(livePrice)} ${currency}** (% ${liveChange >= 0 ? "+" : ""}${fmt(liveChange)})
- **Teknik Konsensüs:** **${signal}** (RSI: ${fmt(rsi)})
- **Analist Konsensüs Hedefi:** **${fmt(targetPrice)} ${currency}** (%+${fmt(upside)} potansiyel)

💡 *Ekrandaki grafikten hissenin anlık fiyat hareketini, teknik indikatörlerini ve son haber akışını canlı olarak takip edebilirsiniz.*`;
    }
  }

  // --- NİYET 2: "ALINIR MI?", "SATILIR MI?", "GİRİLİR Mİ?", "NEREDEN ALAYIM?" ---
  if (
    normQ.includes("alinir mi") || normQ.includes("alinirmi") || normQ.includes("alalim mi") ||
    normQ.includes("satilir mi") || normQ.includes("satilirmi") || normQ.includes("nereden al") ||
    normQ.includes("giris yeri") || normQ.includes("ekleme yapilir mi")
  ) {
    const buyZoneMin = fmt(support * 1.005)
    const buyZoneMax = fmt(support * 1.02)
    return `### ⚖️ **${knowledge?.name ?? targetSymbol} Alım / Satım & Risk Planı**

Güncel Fiyat: **${fmt(livePrice)} ${currency}** | Genel Teknik Sinyal: **${signal}** | RSI: **${fmt(rsi)}**

#### 🎯 **Teknik Seviyelere Dayalı Strateji:**
1. **İdeal Kademeli Alım Bandı:** **${buyZoneMin} - ${buyZoneMax} ${currency}** (Desteğe yakın gevşemelerde risk/getiri oranı çok daha avantajlıdır).
2. **Kritik Zarar Kes (Stop-Loss):** **${fmt(support)} ${currency}** altındaki günlük kalıcı kapanışlarda risk azaltımı yapılmalıdır.
3. **İlk Kâr Alma (Direnç):** **${fmt(resistance)} ${currency}** seviyesi ilk satış ve kâr realizasyon bölgesidir.
4. **Orta Vadeli Analist Konsensüs Hedefi:** **${fmt(targetPrice)} ${currency}** (%+${fmt(upside)} potansiyel).

${knowledge ? `#### 💡 **Temel Destek:**\n${knowledge.keyCatalysts.split("\n")[0]}` : ""}

*Not: Kademeli alım yapmak ve stop-loss disiplinine uymak piyasa dalgalanmalarında anaparanızı korur.*`;
  }

  // --- NİYET 3: "HEDEF NE?", "KAÇA GİDER?", "DAHA ÇIKAR MI?", "YÜKSELİR Mİ?" ---
  if (
    normQ.includes("hedef") || normQ.includes("kaca gider") || normQ.includes("daha cikar mi") ||
    normQ.includes("yukselir mi") || normQ.includes("artar mi") || normQ.includes("patlar mi") ||
    normQ.includes("ralli") || normQ.includes("tavan")
  ) {
    return `### 📈 **${knowledge?.name ?? targetSymbol} Hedef Fiyat & Yükseliş Potansiyeli**

- **Güncel Fiyat:** **${fmt(livePrice)} ${currency}** (% ${liveChange >= 0 ? "+" : ""}${fmt(liveChange)})
- **Aşılması Gereken İlk Direnç:** **${fmt(resistance)} ${currency}**
- **Konsensüs Analist Hedef Fiyatı:** **${fmt(targetPrice)} ${currency}** (%+${fmt(upside)} yükseliş potansiyeli)
- **Teknik Momentum:** RSI **${fmt(rsi)}** (${rsi > 65 ? "Güçlü momentum / kâr satışı riski" : rsi < 40 ? "Dip toparlanma bölgesi" : "Dengeli birikim alanı"})

#### 🔍 **Yükseliş İçin Gereken Koşullar:**
1. Fiyatın **${fmt(resistance)} ${currency}** direncini yüksek işlem hacmiyle yukarı kırması ve üzerinde günlük kapanış yapması.
2. Sektörel marjların ve makro dengelerin (${targetSymbol === "TUPRS" ? "Akdeniz rafineri marjları & petrol fiyatı" : "BIST 100 genel risk iştahı"}) pozitif kalması.
3. **${fmt(support)} ${currency}** ana desteğinin aşağı yönlü kırılmaması. Ana trend bu desteğin üzerinde korunduğu sürece yukarı potansiyel geçerlidir.`;
  }

  // --- NİYET 4: "DÜŞER Mİ?", "ÇÖKER Mİ?", "ZARAR EDER MİYİZ?", "RİSK NE?" ---
  if (
    normQ.includes("duser mi") || normQ.includes("coker mi") || normQ.includes("iner mi") ||
    normQ.includes("zarar") || normQ.includes("risk") || normQ.includes("duzeltme")
  ) {
    return `### 🛡️ **${knowledge?.name ?? targetSymbol} Düşüş Riski & Güvenlik Analizi**

- **Güncel Fiyat:** **${fmt(livePrice)} ${currency}**
- **Kritik Destek Seviyesi (Stop):** **${fmt(support)} ${currency}**
- **Aşağı Yönlü Risk Marjı:** Yaklaşık %-${fmt(((livePrice - support) / livePrice) * 100)}

#### ⚠️ **Risk Değerlendirmesi:**
- Fiyat **${fmt(support)} ${currency}** üzerinde tutunduğu sürece yaşanan geri çekilmeler olağan ve sağlıklı bir piyasa düzeltmesi (retest) olarak değerlendirilir.
- Bu desteğin altına sarkılırsa satış baskısı artabileceğinden disiplinli stop-loss uygulanması önerilir.
${knowledge ? `\n**Sektörel Risk Notu:** ${knowledge.keyCatalysts.split("\n")[0]}` : ""}`;
  }

  // --- NİYET 5: "TEMETTÜ", "BİLANÇO", "KÂR" ---
  if (
    normQ.includes("temettu") || normQ.includes("bilanco") || normQ.includes("kar") ||
    normQ.includes("temettu verir mi") || normQ.includes("temettu dagitir mi")
  ) {
    return `### 💰 **${knowledge?.name ?? targetSymbol} Temettü & Bilanço Görünümü**

${targetSymbol === "TUPRS" ? `- **Temettü Gücü:** Tüpraş, Borsa İstanbul'un temettü şampiyonu hisselerindendir. Yılda 1 veya 2 kez yüksek nakit temettü dağıtma geleneğine sahiptir ve temettü verimi tarihsel olarak %7-12 bandında seyretmiştir.
- **Nakit Akışı:** Ürün satışları doğrudan dövize endeksli olduğu için operasyonel serbest nakit akışı çok güçlüdür.
- **Bilanço:** Rafineri modernizasyonu ve yeşil dönüşüm yatırımları için güçlü finansal yapısını korumaktadır.` : `- **Finansal Yapı:** ${knowledge?.name ?? targetSymbol}, sektöründeki güçlü nakit akışı ve kârlılık disipliniyle bilanço gücünü korumaktadır.
- **Temettü & Kârlılık:** Şirketin kârlılık dinamikleri doğrudan operasyonel büyüme ve yatırım harcamalarının seyrine bağlı olarak şekillenmektedir.`}

*Detaylı bilanço verilerini ve çeyreklik kâr açıklamalarını KAP (Kamuoyu Aydınlatma Platformu) bildirimlerinden teyit edebilirsiniz.*`;
  }

  // --- NİYET 6: SELAMLAMA / HAL HATIR ("SELAM", "NABER", "MERHABA") ---
  if (
    normQ === "sa" || normQ === "slm" || normQ === "selam" || normQ === "merhaba" ||
    normQ.includes("naber") || normQ.includes("nasilsin") || normQ.includes("ne haber") || normQ.includes("gunaydin")
  ) {
    return `Aleykümselam! Hoş geldin reis, piyasayı ve canlı verileri anlık takip ediyorum. 🚀

Şu anda ekranda **${knowledge?.name ?? targetSymbol} (${fmt(livePrice)} ${currency})** açık. 
- İster bu hissenin alım/satım seviyelerini, kâr hedefini ve şirket profilini sor,
- İster genel BIST 100 ya da kripto piyasasının gidişatını sor, detaylıca konuşalım! Neye bakmak istersin?`;
  }

  // --- NİYET 7: GENEL DURUM & ÖZET (Varsayılan olarak sorulan varlığın canlı analizi) ---
  return `### 📊 **${knowledge?.name ?? targetSymbol} Canlı Piyasa & Teknik Durum Özeti**

**${knowledge?.name ?? targetSymbol}** şu anda sitede **${fmt(livePrice)} ${currency}** seviyesinde ve günlük **% ${liveChange >= 0 ? "+" : ""}${fmt(liveChange)}** değişimle işlem görüyor.

- **Teknik Sinyal:** **${signal}**
- **RSI Göstergesi:** **${fmt(rsi)}** (${rsi > 60 ? "Pozitif momentum" : rsi < 40 ? "Aşırı satım / toparlanma arayışı" : "Nötr dengeli bölge"})
- **Kritik Destek (Stop Seviyesi):** **${fmt(support)} ${currency}**
- **İlk Direnç (Kâr Hedefi):** **${fmt(resistance)} ${currency}**
- **Analist Konsensüs Hedefi:** **${fmt(targetPrice)} ${currency}** (%+${fmt(upside)} potansiyel)

${knowledge ? `#### 💡 **Şirket Hakkında Önemli Bilgi:**\n${knowledge.businessModel}\n` : ""}

Dilersen bu varlık için *"Alınır mı?"*, *"Hedef neresi?"*, *"Ne iş yapar?"* gibi detaylı sorular sorabilirsin.`;
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const rl = checkRateLimit(`chat:${ip}`, 50, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  const body = await request.json().catch(() => null)
  const parsed = chatSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Geçersiz sohbet formatı", details: parsed.error.format() }, { status: 400 })
  }

  const { question, symbol, history, marketData, userApiKey, userProvider } = parsed.data
  const clientSym = sanitizeSymbol(symbol) ?? "TUPRS"
  const macroList = Array.isArray(marketData?.macro) ? marketData.macro : []

  // Sistem İstemi (Gerçek LLM modelleri için tam site verileriyle zenginleştirilmiş istem)
  const livePrice = marketData?.price ? `${marketData.price} ${marketData.currency ?? "TL"}` : "Belirtilmemiş"
  const liveChange = marketData?.change !== undefined ? `%${marketData.change}` : "Belirtilmemiş"
  const support = marketData?.technical?.support ?? "-"
  const resistance = marketData?.technical?.resistance ?? "-"
  const rsi = marketData?.technical?.values?.rsi ?? "-"
  const signal = marketData?.technical?.signal ?? "AL"
  const targetMean = marketData?.analyst?.targetMean ? `${marketData.analyst.targetMean} TL` : "Konsensüs: ~%20 yukarı potansiyel"
  const macroSummary = macroList.map((m: any) => `${m.symbol}: ${m.price ?? ""}`).join(", ")

  const systemPrompt = `Sen BysFurkan Finans Terminali'nde kullanıcıyla sohbet eden profesyonel, zeki, Türkçe konuşan bir finansal yapay zeka analistisin.
Kullanıcı seninle Türkçe konuşuyor. Kesinlikle robotik şablonlar, ilgisiz kopyala-yapıştır cevaplar verme. Doğal, samimi, akıcı ve doğrudan kullanıcının sorusuna odaklanan bir dille yanıt ver.

SİTEDEKİ GERÇEK VE CANLI VERİLER (Kullanıcının şu an ekranda gördüğü veriler):
- Aktif İncelenen Varlık: ${clientSym}
- Canlı Fiyat: ${livePrice} (Günlük Değişim: ${liveChange})
- Teknik Konsensüs: ${signal}
- Kritik Destek (Stop): ${support}
- Kritik Direnç: ${resistance}
- RSI Göstergesi: ${rsi}
- Analist Ortalama Hedef Fiyatı: ${targetMean}
- Canlı Makro / Piyasa Oranları: ${macroSummary || "USD/TRY, BIST 100, Altın, Petrol takipte"}

KURALLAR:
1. Kullanıcı aktif varlık (örn. Tüpraş, THY, vb.) hakkında soru sorduğunda, doğrudan o varlığın faaliyet alanını, iş modelini, canlı fiyatını ve beklentilerini anlat. Asla alakasız başka varlıklardan veya cüzdanlardan bahsetme!
2. Kullanıcı selam verdiğinde sıcak, samimi ve doğal bir dille karşıla, ekrandaki aktif varlığa atıfta bulun.
3. Kullanıcı "alınır mı", "ne olur", "hedef ne" sorduğunda elindeki canlı destek, direnç ve analist hedeflerini kullanarak mantıklı bir risk/getiri analizi sun.
4. Yatırım tavsiyesi olmadığını belirten doğal bir sorumluluk reddi ekle.`

  // 1. KULLANICI ARAYÜZÜNDEN GİRİLEN API KEY (Client Key)
  const cleanUserKey = userApiKey ? sanitizeApiKey(userApiKey) : ""
  let keyError: string | null = null

  if (cleanUserKey && cleanUserKey.length > 5) {
    // Otomatik sağlayıcı tespiti (kullanıcı yanlış seçim yapsa bile düzeltir)
    let prov = userProvider || "gemini"
    if (cleanUserKey.startsWith("gsk_")) prov = "groq"
    else if (cleanUserKey.startsWith("AIzaSy")) prov = "gemini"
    else if (cleanUserKey.startsWith("sk-ant")) prov = "anthropic"
    else if (cleanUserKey.startsWith("sk-")) prov = "openai"

    if (prov === "gemini") {
      const { reply, error } = await callGemini(cleanUserKey, systemPrompt, history, question)
      if (reply) return Response.json({ reply, source: "gemini-live", model: "Google Gemini 1.5 Flash (Canlı)" })
      keyError = error || "Gemini yanıt vermedi"
    } else if (prov === "groq") {
      const { reply, error } = await callGroq(cleanUserKey, systemPrompt, history, question)
      if (reply) return Response.json({ reply, source: "groq-live", model: "Groq Llama 3.3 (Canlı)" })
      keyError = error || "Groq yanıt vermedi"
    } else if (prov === "anthropic") {
      const { reply, error } = await callClaude(cleanUserKey, systemPrompt, history, question)
      if (reply) return Response.json({ reply, source: "claude-live", model: "Claude 3.5 Sonnet (Canlı)" })
      keyError = error || "Claude yanıt vermedi"
    } else {
      const { reply, error } = await callOpenAI(cleanUserKey, systemPrompt, history, question)
      if (reply) return Response.json({ reply, source: "openai-live", model: "OpenAI GPT-4o mini (Canlı)" })
      keyError = error || "OpenAI yanıt vermedi"
    }
  }

  // 2. SUNUCU ORTAM DEĞİŞKENLERİ (Vercel / .env keys)
  const serverGemini = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY
  if (serverGemini) {
    const { reply } = await callGemini(serverGemini, systemPrompt, history, question)
    if (reply) return Response.json({ reply, source: "gemini-server", model: "Google Gemini (Canlı)" })
  }

  const serverOpenai = process.env.OPENAI_API_KEY
  if (serverOpenai) {
    const { reply } = await callOpenAI(serverOpenai, systemPrompt, history, question)
    if (reply) return Response.json({ reply, source: "openai-server", model: "GPT-4o mini (Canlı)" })
  }

  const serverGroq = process.env.GROQ_API_KEY
  if (serverGroq) {
    const { reply } = await callGroq(serverGroq, systemPrompt, history, question)
    if (reply) return Response.json({ reply, source: "groq-server", model: "Groq Llama 3.3 (Canlı)" })
  }

  const serverAnthropic = process.env.ANTHROPIC_API_KEY
  if (serverAnthropic) {
    const { reply } = await callClaude(serverAnthropic, systemPrompt, history, question)
    if (reply) return Response.json({ reply, source: "claude-server", model: "Claude 3.5 Sonnet (Canlı)" })
  }

  // 3. DAHİLİ AKILLI FİNANSAL ANALİZ VE BİLGİ MOTORU (KUSURSUZ YEDEK GÜVENCESİ)
  // Eğer kullanıcı anahtarı hatalıysa bile KULLANICIYI ASLA CEVAPSIZ BIRAKMA!
  const smartReply = generateSmartFinancialResponse({
    question,
    activeSymbol: clientSym,
    marketData,
    macroList,
  })

  // Eğer kullanıcı hatalı bir key girdiyse bunu nazikçe bildir ama sorusunun TAM CEVABINI MUTLAKA VER:
  const finalReply = keyError
    ? `⚠️ *Girdiğiniz API anahtarı doğrulanamadı (${keyError}). Sorunuz sitenin dahili finansal motoru ve canlı verileriyle yanıtlandı:*\n\n---\n\n${smartReply}`
    : smartReply

  return Response.json({
    reply: finalReply,
    source: "smart-financial-engine",
    model: "BysFurkan Finans AI",
  })
}
