import { NextRequest, NextResponse } from "next/server"
import { getServerHistory } from "@/lib/bot/server-state"
import { getClientIp, checkRateLimit, rateLimitResponse } from "@/lib/security"
import type { Position } from "@/lib/bot/engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/bot/analytics
 *
 * 📊 KÂR/ZARAR ANALİTİK RAPORU (read-only, emir GÖNDERMEZ):
 * Bot geçmişindeki (appendServerHistory → Redis, son 500 kapanış) tüm işlemleri
 * çıkış nedenine / giriş sinyaline / coine / saate / güne / piyasaya göre kırar ve
 * hangi kuralın para kazandırdığını / kaybettirdiğini sayısal gösterir.
 *
 * Örn: /api/bot/analytics              → tüm geçmiş
 *      /api/bot/analytics?days=14      → son 14 gün
 *      /api/bot/analytics?market=futures → sadece vadeli
 *
 * NOT: pnl alanları fiyat farkı bazlıdır (komisyon/makas dahil değildir).
 * Binance TR spot round-trip maliyet ~%0.45; düşük oranlı çıkışlar maliyete yakınsar.
 */

// ── Çıkış nedeni → kova (bucket) sınıflandırma ──
// closeReason metinleri Türkçe üretildiği için anahtar kelime eşleştirme kullanılır.
// Sıralama bilinçli: önce başabaş/kâr koruma kontrolleri, sonra SL.
// NOT: Route'taki bazı metinler bozuk UTF-8 (mojibake) olarak kayıtlıdır
// (örn. "TAKÄ°P EDEN KÃ‚R KÄ°LÄ°TLENDÄ°"); bu yüzden hem düzgün hem bozuk
// varyantları kapsayan ASCII-güvenli anahtar kelimeler kullanılır.
function classifyExitBucket(reason: string | undefined | null): string {
  const r = (reason || "").toString()
  if (!r) return "DIGER"
  if (r.includes("Başabaş") || r.includes("BaÅŸabaÅŸ")) return "BASABAS"
  // "KAR_KORUMA" hem "Kâr Koruma" hem bozuk "KÃ‚R KORUMA" varyantlarını yakalar
  if (r.includes("KORUMA")) return "KAR_KORUMA_STOPU"
  if (r.includes("TP1")) return "TP1_KADEMELI"
  if (
    r.includes("TRAILING") ||
    r.includes("Trailing") ||
    r.includes("TAKİP EDEN") ||
    r.includes("Takip Eden") ||
    r.includes("TAKÄ°P EDEN")
  )
    return "TRAILING"
  if (r.includes("KİLİD") || r.includes("KÄ°LÄ°TLENDÄ°") || r.includes("Kilidi") || r.includes("Yorulma"))
    return "KAR_KILIDI"
  if (r.includes("ROTASYON") || r.includes("Rotasyon")) return "FIRSAT_ROTASYONU"
  if (r.includes("TIME-STOP") || r.includes("Time-Stop") || r.includes("TIME_STOP")) return "TIME_STOP"
  if (
    r.includes("STOP-LOSS") ||
    r.includes("STOP_LOSS") ||
    r.includes("Stop Loss") ||
    r.includes("Dinamik Stop") ||
    r.includes("Sermaye Koruma")
  )
    return "STOP_LOSS"
  // "ALINDI"/"HEDEF" ASCII-güvenli: bozuk metinlerde de eşleşir
  if (
    r.includes("HEDEF") ||
    r.includes("Hedef Kâr") ||
    r.includes("Zirve") ||
    r.includes("TP2") ||
    r.includes("Kâr Satışı") ||
    r.includes("ALINDI")
  )
    return "TP_HEDEF"
  if (r.includes("Borsada")) return "BORSA_BAKIYE_KAPANIS"
  if (r.includes("Harici") || r.includes("Doğrulanamadı")) return "HARICI_KAPANIS"
  return "DIGER"
}

interface Agg {
  count: number
  wins: number
  losses: number
  netPnlTry: number
  avgPnlPercent: number
  pnlPercentSum: number
  pnlPercentCount: number
  avgHoldHours: number
  holdHoursSum: number
  holdHoursCount: number
}

function newAgg(): Agg {
  return {
    count: 0,
    wins: 0,
    losses: 0,
    netPnlTry: 0,
    avgPnlPercent: 0,
    pnlPercentSum: 0,
    pnlPercentCount: 0,
    avgHoldHours: 0,
    holdHoursSum: 0,
    holdHoursCount: 0,
  }
}

function push(agg: Agg, p: Position, closedTs: number) {
  const net = typeof p.netPnlTry === "number" ? p.netPnlTry : p.pnl ?? 0
  agg.count++
  agg.netPnlTry += net
  if (net > 0) agg.wins++
  else if (net < 0) agg.losses++

  const pct = p.pnlPercent
  if (typeof pct === "number" && isFinite(pct)) {
    agg.pnlPercentSum += pct
    agg.pnlPercentCount++
  }

  if (p.openedTimestamp && closedTs > p.openedTimestamp) {
    const hours = (closedTs - p.openedTimestamp) / (1000 * 60 * 60)
    if (hours >= 0 && hours < 24 * 30) {
      agg.holdHoursSum += hours
      agg.holdHoursCount++
    }
  }
}

function finalize(agg: Agg): Agg {
  const result = { ...agg }
  if (agg.pnlPercentCount > 0) result.avgPnlPercent = agg.pnlPercentSum / agg.pnlPercentCount
  if (agg.holdHoursCount > 0) result.avgHoldHours = agg.holdHoursSum / agg.holdHoursCount
  return result
}

function entrySignalOf(p: Position): string {
  if ((p as any).isMegaWhale) return "MEGA_BALINA"
  if ((p as any).isWhale) return "TEYITLI_BALINA"
  if ((p as any).isBounce) return "DIP_SEKMESI"
  if ((p as any).isFutures) return "FUTURES_SINYAL"
  return "GENEL_SINYAL"
}

function closedTsOf(p: Position): number {
  if (p.closedTimestamp) return p.closedTimestamp
  if (p.closedAt) {
    const t = new Date(p.closedAt).getTime()
    if (isFinite(t)) return t
  }
  return 0
}

function roundedBucket(agg: Agg) {
  const f = finalize(agg)
  return {
    count: f.count,
    wins: f.wins,
    losses: f.losses,
    winRatePct: f.count > 0 ? Math.round((f.wins / f.count) * 1000) / 10 : 0,
    netPnlTry: Math.round(f.netPnlTry * 100) / 100,
    avgPnlPercent: Math.round(f.avgPnlPercent * 100) / 100,
    avgHoldHours: Math.round(f.avgHoldHours * 10) / 10,
  }
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = checkRateLimit(`botanalytics:${ip}`, 60, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  try {
    const url = new URL(request.url)
    const daysParam = parseInt(url.searchParams.get("days") || "", 10)
    const days = isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 0
    const market = (url.searchParams.get("market") || "all").toLowerCase() // all | spot | futures

    const history = await getServerHistory()
    if (!history || history.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "Kapanmış işlem geçmişi bulunamadı (appendServerHistory boş). Bot henüz işlem kapatmamış.",
        summary: null,
      })
    }

    const cutoff = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0

    const trades: Array<{ p: Position; ts: number; bucket: string; signal: string; isFutures: boolean }> = []
    for (const p of history) {
      const ts = closedTsOf(p)
      if (!ts) continue
      if (cutoff && ts < cutoff) continue
      const isFutures = Boolean((p as any).isFutures)
      if (market === "futures" && !isFutures) continue
      if (market === "spot" && isFutures) continue
      trades.push({
        p,
        ts,
        bucket: classifyExitBucket(p.closeReason),
        signal: entrySignalOf(p),
        isFutures,
      })
    }

    if (trades.length === 0) {
      return NextResponse.json({
        ok: true,
        message: days > 0 ? `Son ${days} günde kapanmış işlem yok.` : "Kapanmış işlem yok (filtre sonrası).",
        summary: null,
      })
    }

    // ── 1. GENEL ÖZET ──
    const summaryAgg = newAgg()
    for (const t of trades) push(summaryAgg, t.p, t.ts)
    const summary = finalize(summaryAgg)
    const grossWin = trades.reduce((s, t) => {
      const net = t.p.netPnlTry ?? t.p.pnl ?? 0
      return net > 0 ? s + net : s
    }, 0)
    const grossLoss = trades.reduce((s, t) => {
      const net = t.p.netPnlTry ?? t.p.pnl ?? 0
      return net < 0 ? s + Math.abs(net) : s
    }, 0)
    const summaryOut = {
      count: summary.count,
      wins: summary.wins,
      losses: summary.losses,
      winRatePct: Math.round((summary.wins / summary.count) * 1000) / 10,
      netPnlTry: Math.round(summary.netPnlTry * 100) / 100,
      avgPnlPercent: Math.round(summary.avgPnlPercent * 100) / 100,
      avgHoldHours: Math.round(summary.avgHoldHours * 10) / 10,
      avgWinTry: summary.wins > 0 ? Math.round((grossWin / summary.wins) * 100) / 100 : 0,
      avgLossTry: summary.losses > 0 ? Math.round((grossLoss / summary.losses) * 100) / 100 : 0,
      profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
      // Başabaş isabet oranı: ort. kazanma / (ort. kazanma + ort. kayıp) — üstündeyse strateji matematiksel pozitif
      breakevenWinRatePct:
        grossWin > 0 && grossLoss > 0
          ? Math.round((grossLoss / summary.losses / (grossLoss / summary.losses + grossWin / summary.wins)) * 1000) / 10
          : null,
      spotRoundTripCostPct: 0.45, // referans: Binance TR komisyon + ortalama makas (fiyat bazlı pnl'e dahil DEĞİL)
    }

    // ── 2. ÇIKIŞ NEDENİNE GÖRE (hangi kural ne kazanıyor/kaybettiriyor) ──
    const bucketAggs = new Map<string, Agg>()
    for (const t of trades) {
      const agg = bucketAggs.get(t.bucket) || newAgg()
      push(agg, t.p, t.ts)
      bucketAggs.set(t.bucket, agg)
    }
    const byExitBucket = Array.from(bucketAggs.entries())
      .map(([bucket, agg]) => ({ bucket, ...roundedBucket(agg) }))
      .sort((a, b) => a.netPnlTry - b.netPnlTry) // en kötü önce

    // ── 3. GİRİŞ SİNYALİNE GÖRE ──
    const signalAggs = new Map<string, Agg>()
    for (const t of trades) {
      const agg = signalAggs.get(t.signal) || newAgg()
      push(agg, t.p, t.ts)
      signalAggs.set(t.signal, agg)
    }
    const byEntrySignal = Array.from(signalAggs.entries())
      .map(([signal, agg]) => ({ signal, ...roundedBucket(agg) }))
      .sort((a, b) => b.netPnlTry - a.netPnlTry)

    // ── 4. COİNE GÖRE (en iyi / en kötü 10) ──
    const symbolAggs = new Map<string, Agg>()
    for (const t of trades) {
      const key = t.p.symbol || "?"
      const agg = symbolAggs.get(key) || newAgg()
      push(agg, t.p, t.ts)
      symbolAggs.set(key, agg)
    }
    const bySymbolAll = Array.from(symbolAggs.entries())
      .map(([symbol, agg]) => ({ symbol, ...roundedBucket(agg) }))
      .sort((a, b) => b.netPnlTry - a.netPnlTry)
    const bySymbolBest = bySymbolAll.slice(0, 10)
    const bySymbolWorst = bySymbolAll.slice(-10).reverse()

    // ── 5. PİYASAYA GÖRE (Spot vs Futures) ──
    const spotAgg = newAgg()
    const futuresAgg = newAgg()
    for (const t of trades) push(t.isFutures ? futuresAgg : spotAgg, t.p, t.ts)
    const byMarket =
      market === "all"
        ? {
            spot: spotAgg.count > 0 ? roundedBucket(spotAgg) : null,
            futures: futuresAgg.count > 0 ? roundedBucket(futuresAgg) : null,
          }
        : null

    // ── 6. SAATE GÖRE (UTC saat dilimi) ──
    const hourAggs = new Map<number, Agg>()
    for (const t of trades) {
      const h = new Date(t.ts).getUTCHours()
      const agg = hourAggs.get(h) || newAgg()
      push(agg, t.p, t.ts)
      hourAggs.set(h, agg)
    }
    const byHour = Array.from(hourAggs.entries())
      .map(([hourUtc, agg]) => ({ hourUtc, ...roundedBucket(agg) }))
      .sort((a, b) => a.hourUtc - b.hourUtc)

    // ── 7. GÜNE GÖRE (son 14 gün, net PnL) ──
    const dayAggs = new Map<string, Agg>()
    for (const t of trades) {
      const day = new Date(t.ts).toISOString().slice(0, 10)
      const agg = dayAggs.get(day) || newAgg()
      push(agg, t.p, t.ts)
      dayAggs.set(day, agg)
    }
    const byDay = Array.from(dayAggs.entries())
      .map(([day, agg]) => ({ day, netPnlTry: Math.round(finalize(agg).netPnlTry * 100) / 100, count: finalize(agg).count }))
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, 14)

    // ── 8. OTOMATİK GÖRÜŞ (insights) ──
    const insights: string[] = []
    const worst = byExitBucket.find((b) => b.count >= 3 && b.netPnlTry < 0)
    if (worst) {
      insights.push(
        `🔴 EN KÖTÜ KURAL: "${worst.bucket}" — ${worst.count} işlem, toplam ${worst.netPnlTry.toFixed(2)} TL, ortalama %${worst.avgPnlPercent}. Bu çıkış kuralını kapatmak/eşik yükseltmek net ${Math.abs(worst.netPnlTry).toFixed(2)} TL tasarruf demekti.`
      )
    }
    const best = [...byExitBucket].reverse().find((b) => b.count >= 3 && b.netPnlTry > 0)
    if (best) {
      insights.push(`🟢 EN İYİ KURAL: "${best.bucket}" — ${best.count} işlem, toplam +${best.netPnlTry.toFixed(2)} TL (ortalama %${best.avgPnlPercent}). Ağırlığı artırılmayı değerlendir.`)
    }
    if (typeof summaryOut.breakevenWinRatePct === "number") {
      if (summaryOut.winRatePct >= summaryOut.breakevenWinRatePct) {
        insights.push(`✅ İsabet %${summaryOut.winRatePct} ≥ başabaş eşiği %${summaryOut.breakevenWinRatePct} → strateji matematiksel olarak pozitif bölgede; oyuncu ölçeği artırılabilir.`)
      } else {
        insights.push(
          `⚠️ İsabet %${summaryOut.winRatePct} < başabaş eşiği %${summaryOut.breakevenWinRatePct} → ort. kazanan +${summaryOut.avgWinTry.toFixed(2)} TL iken ort. kaybeden -${Math.abs(summaryOut.avgLossTry).toFixed(2)} TL. KAZANANLARI ERKEN KESMEYEN çıkış kuralları gerekiyor (kademeli %2.5 / rotasyon +%1.2 / trailing kuralları).`
        )
      }
    }
    const microWins = trades.filter((t) => {
      const net = t.p.netPnlTry ?? t.p.pnl ?? 0
      const pct = t.p.pnlPercent
      return !t.isFutures && net > 0 && typeof pct === "number" && pct < 1.5
    }).length
    if (microWins >= 5) {
      insights.push(
        `💰 Spot'ta +%1.5 altında kâr kilitlenen ${microWins} işlem var — round-trip maliyet (~%0.45) sonrası bu çıkışların neti nominaldir; maliyet altı çıkış eşiği yükseltilmeli.`
      )
    }

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      filters: { days: days || "all", market },
      coverageNote: "Redis history son 500 kapanışı tutar; daha eski işlemler kapsam dışıdır.",
      summary: summaryOut,
      byExitBucket,
      byEntrySignal,
      bySymbolBest,
      bySymbolWorst,
      byMarket,
      byHour,
      byDay,
      insights,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Analitik hatası" }, { status: 500 })
  }
}
