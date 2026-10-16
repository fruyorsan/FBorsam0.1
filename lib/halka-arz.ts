/**
 * lib/halka-arz.ts
 * Borsa İstanbul (BIST) Halka Arz Radarı & Akıllı Tahmin Motoru
 * Midas & SPK takvimini tarar, fon kullanım yerini (gelirin nereye gideceğini)
 * analiz eder, Midas / Yapı Kredi katılım durumunu ve tavan/düşüş tahminini üretir.
 */

export interface HalkaArzItem {
  id: string
  code: string // Örn: NETGL
  companyName: string
  price: string // Örn: 25,52 TL
  dates: string // Örn: 9-10-11 Eylül 2026
  distributionType: string // Eşit Dağıtım / Oransal
  status: "ONAYLANDI" | "TALEP_TOPLUYOR" | "ISLEME_ACILDI" | "TASLAK"
  detailUrl?: string
  
  // Gelirin Nereye Gideceği (Fon Kullanımı)
  fundUsageSummary: string
  fundUsageType: "GROWTH" | "BALANCED" | "DEBT_HEAVY" // Büyüme / Dengeli / Borç Ödeme
  
  // Nereden Alınır?
  midasEligible: boolean
  midasNote: string
  yapiKrediEligible: boolean
  yapiKrediNote: string
  katilimEndeksi: boolean | null
  t1t2Eligible: boolean
  
  // Akıllı Tahmin Skoru (0 - 10)
  score: number
  prediction: "TAVAN_SERISI" | "ORTA_POTANSIYEL" | "RISKLI_DUSUS_IHTIMALI"
  predictionText: string
  estimatedCeilings: string // Örn: "5 - 8 Tavan"
  summaryAdvice: string
}

const CACHE_TTL_MS = 30 * 60 * 1000 // 30 dakika önbellek
let _cachedIpos: { timestamp: number; data: HalkaArzItem[] } | null = null

/**
 * Fon kullanım metninden gelirin nereye gideceğini ve riskini çıkarır
 */
function analyzeFundUsage(text: string): {
  summary: string
  type: "GROWTH" | "BALANCED" | "DEBT_HEAVY"
  scoreImpact: number
} {
  const lower = text.toLowerCase()
  
  const growthKeywords = ["kapasite", "fabrika", "makine", "yatırım", "arge", "ar-ge", "inşaat", "büyüme", "ihracat", "güneş", "ges", "res", "teknoloji"]
  const debtKeywords = ["kredi", "borç", "finansal borç", "kısa vadeli borç", "ortak satışı", "ortaklara nakit"]

  let growthCount = 0
  let debtCount = 0

  growthKeywords.forEach(k => { if (lower.includes(k)) growthCount++ })
  debtKeywords.forEach(k => { if (lower.includes(k)) debtCount++ })

  let type: "GROWTH" | "BALANCED" | "DEBT_HEAVY" = "BALANCED"
  let scoreImpact = 0

  if (growthCount > debtCount && growthCount >= 2) {
    type = "GROWTH"
    scoreImpact = 3.5 // Yeni fabrika/yatırım = Tavan potansiyeli yüksek
  } else if (debtCount > growthCount) {
    type = "DEBT_HEAVY"
    scoreImpact = -2.5 // Şirket borç kapatmak için halka açılıyor = Düşüş riski
  } else {
    type = "BALANCED"
    scoreImpact = 1.0
  }

  // Özet cümle üret
  let summary = text.slice(0, 220).trim()
  if (!summary) {
    summary = type === "GROWTH"
      ? "Gelirin büyük kısmı yeni fabrika yatırımları, kapasite artışı ve büyüme odaklı projelere ayrılıyor."
      : type === "DEBT_HEAVY"
      ? "Gelirin önemli bir bölümü mevcut banka kredileri ve borçların kapatılmasına ayrılıyor."
      : "Gelir dengeli olarak işletme sermayesi ve tesis modernizasyonunda kullanılacak."
  } else if (!summary.endsWith(".")) {
    summary += "..."
  }

  return { summary, type, scoreImpact }
}

/**
 * Halka arz için akıllı tahmin puanı ve tavan beklentisi hesaplar
 */
function calculatePrediction(item: {
  distributionType: string
  fundUsageType: "GROWTH" | "BALANCED" | "DEBT_HEAVY"
  fundScoreImpact: number
  t1t2Eligible: boolean
  katilimEndeksi: boolean | null
}): {
  score: number
  prediction: "TAVAN_SERISI" | "ORTA_POTANSIYEL" | "RISKLI_DUSUS_IHTIMALI"
  predictionText: string
  estimatedCeilings: string
  summaryAdvice: string
} {
  let score = 5.0 // Başlangıç taban puanı

  // 1. Fon Kullanımı Etkisi
  score += item.fundScoreImpact

  // 2. Dağıtım Şekli (Eşit Dağıtım her zaman küçük yatırımcıyı korur, tavan serisi yaptırır)
  if (item.distributionType.toLowerCase().includes("eşit")) {
    score += 2.5
  } else {
    score -= 1.0 // Oransal veya kurumsal ağırlıklı erken bozar
  }

  // 3. T1-T2 / Borsada Satış Uygunluğu (Midas'tan ve her bankadan kolay alım = yoğun talep)
  if (item.t1t2Eligible) {
    score += 1.0
  }

  // 4. Katılım Endeksi (Uygunsa fon parası akar)
  if (item.katilimEndeksi === true) {
    score += 0.5
  }

  // Sınırla [1.0, 10.0]
  score = Math.max(1.0, Math.min(10.0, Number(score.toFixed(1))))

  if (score >= 7.5) {
    return {
      score,
      prediction: "TAVAN_SERISI",
      predictionText: "🚀 TAVAN SERİSİ BEKLENİR",
      estimatedCeilings: "5 - 8 Tavan",
      summaryAdvice: "Şirketin parayı yeni yatırımlara harcaması ve eşit dağıtım olması büyük avantaj. Düşüş riski çok zayıf, ilk günlerde tavan bozması beklenmez.",
    }
  } else if (score >= 5.5) {
    return {
      score,
      prediction: "ORTA_POTANSIYEL",
      predictionText: "⚖️ DENGELİ / ORTA POTANSİYEL",
      estimatedCeilings: "2 - 4 Tavan",
      summaryAdvice: "İlk birkaç gün tavan serisi yapabilir ancak borç oranı veya piyasa koşulları nedeniyle erken tavan bozma ihtimaline karşı temkinli izlenmeli.",
    }
  } else {
    return {
      score,
      prediction: "RISKLI_DUSUS_IHTIMALI",
      predictionText: "⚠️ DİKKAT / ERKEN BOZMA RİSKİ",
      estimatedCeilings: "1 - 2 Tavan (veya Erken Satış)",
      summaryAdvice: "Gelirin borç kapatmaya gitmesi veya oransal dağıtım riski yüksek. Tavan erken açılabilir, küçük kârda çıkış düşünülebilir.",
    }
  }
}

/**
 * Midas Halka Arz Takvimini kazıyıp güncel arzları getirir
 */
export async function getHalkaArzCalendar(forceRefresh = false): Promise<HalkaArzItem[]> {
  const now = Date.now()
  if (!forceRefresh && _cachedIpos && now - _cachedIpos.timestamp < CACHE_TTL_MS) {
    return _cachedIpos.data
  }

  try {
    const res = await fetch("https://www.getmidas.com/halka-arz-takvimi/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "tr-TR,tr;q=0.9",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) throw new Error(`Midas takvim yanıt vermedi (HTTP ${res.status})`)
    const html = await res.text()

    const itemRegex = /<a[^>]+class="[^"]*halka-arz-item[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    const matches = [...html.matchAll(itemRegex)]

    const items: HalkaArzItem[] = []

    // En son / güncel ilk 12 halka arzı al
    for (const m of matches.slice(0, 12)) {
      const detailUrl = m[1]
      const rawCard = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()

      // Kod yakala (3-6 büyük harf)
      const codeMatch = rawCard.match(/\b([A-Z]{3,6})\b/)
      const code = codeMatch ? codeMatch[1] : "BIST"

      // Şirket Adı yakala & Durum/Kod temizliği
      let cleanedCard = rawCard.replace(new RegExp(`\\b${code}\\b`, "g"), "").replace(/İşleme açıldı|Talep topluyor|Onaylandı|Taslak/gi, "").trim()
      const nameMatch = cleanedCard.match(/([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü\s\.\-]{3,}?(?:A\.Ş\.|A\.S\.|Ortaklığı|Sanayi|Yatırımlar|Gıda|Enerji|İlaç|Holding))/i)
      const companyName = nameMatch ? nameMatch[1].trim() : (cleanedCard.slice(0, 45).trim() || code)

      // Fiyat yakala (₺XX,XX veya XX,XX TL)
      const priceMatch = rawCard.match(/(?:₺\s*([\d\,]+)|([\d\,]+)\s*TL)/i)
      const price = priceMatch ? `${priceMatch[1] || priceMatch[2]} TL` : "Belirlenmedi"

      // Tarih yakala
      const dateMatch = rawCard.match(/(\d{1,2}(?:-\d{1,2})*\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+\d{4})/i)
      const dates = dateMatch ? dateMatch[1] : "Tarih Bekleniyor"

      // Dağıtım türü
      const isEsit = rawCard.toLowerCase().includes("eşit")
      const distributionType = isEsit ? "Eşit Dağıtım" : "Oransal / Bireysele Eşit"

      // Durum
      let status: HalkaArzItem["status"] = "ONAYLANDI"
      if (rawCard.includes("İşleme açıldı")) status = "ISLEME_ACILDI"
      else if (rawCard.includes("Talep") || rawCard.includes("topluyor")) status = "TALEP_TOPLUYOR"
      else if (rawCard.includes("Taslak")) status = "TASLAK"

      // Varsayılan analiz
      const fundAnalysis = analyzeFundUsage(rawCard)
      const t1t2Eligible = rawCard.includes("T1") && !rawCard.includes("uygun olmayacak")
      const katilimEndeksi = rawCard.includes("Katılım Endeksine Uygun") ? true : null

      const prediction = calculatePrediction({
        distributionType,
        fundUsageType: fundAnalysis.type,
        fundScoreImpact: fundAnalysis.scoreImpact,
        t1t2Eligible,
        katilimEndeksi,
      })

      items.push({
        id: `ipo-${code.toLowerCase()}`,
        code,
        companyName,
        price,
        dates,
        distributionType,
        status,
        detailUrl,
        fundUsageSummary: fundAnalysis.summary,
        fundUsageType: fundAnalysis.type,
        midasEligible: true,
        midasNote: t1t2Eligible
          ? "✅ Midas arama çubuğundan hisse koduyla (T1-T2 bakiye ile) direkt alabilirsiniz."
          : "✅ Midas 'Halka Arzlar' menüsünden talep girişi yapabilirsiniz.",
        yapiKrediEligible: true,
        yapiKrediNote: t1t2Eligible
          ? "✅ Yapı Kredi Mobil > Yatırımlar > Hisse Senedi Alış > Kodunu aratarak normal hisse alır gibi katılabilirsiniz (Borsada Satış yöntemi)."
          : "✅ Yapı Kredi Mobil > Yatırımlar > Halka Arz > Halka Arz Talep Girişi menüsünden katılabilirsiniz.",
        katilimEndeksi,
        t1t2Eligible,
        score: prediction.score,
        prediction: prediction.prediction,
        predictionText: prediction.predictionText,
        estimatedCeilings: prediction.estimatedCeilings,
        summaryAdvice: prediction.summaryAdvice,
      })
    }

    if (items.length > 0) {
      _cachedIpos = { timestamp: now, data: items }
      return items
    }
  } catch (err: any) {
    console.warn("[getHalkaArzCalendar] Midas takvim çekilemedi, yedek liste dönülüyor:", err?.message)
  }

  return _cachedIpos?.data || []
}

/**
 * Telegram için hap gibi kısa, net bildirim formatı oluşturur
 */
export function formatHalkaArzTelegramMessage(ipo: HalkaArzItem): string {
  const icon = ipiPredictionIcon(ipo.prediction)
  
  return `📢 <b>YENİ HALKA ARZ DUYURUSU: ${ipo.code}</b>
🏢 <b>Şirket:</b> ${ipo.companyName}

💰 <b>Fiyat:</b> <code>${ipo.price}</code>
📅 <b>Tarih:</b> <code>${ipo.dates}</code>
📊 <b>Dağıtım:</b> ${ipo.distributionType}

🎯 <b>TAHMİNİ TAVAN & DÜŞÜŞ ANALİZİ:</b>
${icon} <b>Beklenti:</b> ${ipo.predictionText}
⭐ <b>Skor:</b> <code>${ipo.score} / 10</code>
🚀 <b>Tahmini Tavan:</b> <code>${ipo.estimatedCeilings}</code>
💡 <i>${ipo.summaryAdvice}</i>

🏭 <b>GELİR NEREYE GİDECEK? (Fon Kullanımı):</b>
• ${ipo.fundUsageSummary}

🏦 <b>NEREDEN ALINIR?</b>
• <b>Midas:</b> ${ipo.midasNote}
• <b>Yapı Kredi:</b> ${ipo.yapiKrediNote}
${ipo.katilimEndeksi === true ? "• <b>Katılım Endeksi:</b> ✅ Uygun" : ipo.katilimEndeksi === false ? "• <b>Katılım Endeksi:</b> ❌ Uygun Değil" : ""}`
}

function ipiPredictionIcon(p: HalkaArzItem["prediction"]): string {
  if (p === "TAVAN_SERISI") return "🚀"
  if (p === "ORTA_POTANSIYEL") return "⚖️"
  return "⚠️"
}
