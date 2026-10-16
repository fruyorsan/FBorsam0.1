import { NextRequest, NextResponse } from "next/server"
import {
  getFullServerState,
  setServerSlotConfig,
  setServerActive,
  appendDevTask,
  getServerBinance,
  getServerBinanceGlobal,
  setServerPositions,
  setServerBalance,
  setPendingLimitOrders,
  getPendingLimitOrders,
  setServerManualSellCooldown,
} from "@/lib/bot/server-state"
import {
  getSpotAccountAssets,
  emergencySellAll,
  executeBinanceTrSpotOrder,
  getSymbolFilters,
  formatWithStepSize,
  getFuturesPositions,
  getFuturesAccountBalance,
} from "@/lib/binance-helpers"

export const dynamic = "force-dynamic"
export const maxDuration = 30

interface ChatMessage {
  role: "user" | "assistant" | "system"
  content: string
}

// ── Ultra Hızlı Gemini Flash Lite API Çağrısı ──
async function callGeminiLive(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  historyMessages: ChatMessage[]
): Promise<string | null> {
  const contents = [
    ...historyMessages.slice(-4).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ]

  // En hızlı ve en güncel lite model: gemini-flash-lite-latest
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.2, // Disiplinli, ciddi ve net yanıtlar
          maxOutputTokens: 600,
        },
      }),
    })

    if (res.ok) {
      const json = await res.json()
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text
      if (text && text.trim()) {
        return text.trim()
      }
    } else {
      const errText = await res.text()
      console.error("[Gemini API Error]", res.status, errText)
    }
  } catch (err: any) {
    console.error("[Gemini Fetch Error]", err?.message || err)
  }

  return null
}

// ── Agentic Eylem İcracısı (Gemini Aksiyonları) ──
async function executeAgentAction(replyText: string): Promise<string> {
  let cleanedReply = replyText

  // 1. Acil Satış (Tümünü Nakite Geçir)
  if (cleanedReply.includes("[ACTION:EMERGENCY_SELL]")) {
    try {
      const creds = await getServerBinance()
      if (creds?.apiKey && creds?.apiSecret) {
        const res = await emergencySellAll(creds.apiKey, creds.apiSecret)
        await setServerPositions([])
        await setPendingLimitOrders([])
        await setServerManualSellCooldown(90)
        const wallet = await getSpotAccountAssets(creds.apiKey, creds.apiSecret)
        await setServerBalance(wallet.freeTry)
        cleanedReply = cleanedReply.replace(/\[ACTION:EMERGENCY_SELL\]/g, "").trim()
        cleanedReply += `\n\n🚨 **Acil Satış Tamamlandı!** Tüm açık pozisyonlar piyasa fiyatından satıldı. Satılanlar: ${res.soldList.join(", ") || "Yok"}. Serbest Kasa: ${wallet.freeTry.toFixed(2)} TL.`
      }
    } catch (e: any) {
      cleanedReply = cleanedReply.replace(/\[ACTION:EMERGENCY_SELL\]/g, "").trim()
      cleanedReply += `\n\n❌ Acil satış hatası: ${e.message}`
    }
  }

  // 2. Belirli Bir Coini Sat (Örn: [ACTION:SELL_COIN:EIGEN])
  const sellMatch = cleanedReply.match(/\[ACTION:SELL_COIN:([A-Za-z0-9]+)\]/)
  if (sellMatch) {
    const sym = sellMatch[1].toUpperCase().replace(/TRY$/, "")
    try {
      const creds = await getServerBinance()
      const state = await getFullServerState()
      const pos = (state.positions || []).find((p: any) => p.symbol.toUpperCase().replace(/TRY$/, "") === sym)

      if (pos && creds?.apiKey && creds?.apiSecret) {
        const pairTr = `${sym}_TRY`
        const filters = await getSymbolFilters(pairTr)
        const stepSize = filters?.stepSize || 0.0001
        const minQty = filters?.minQty || 0.0001
        const formattedQty = parseFloat(formatWithStepSize(pos.amount, stepSize, filters?.basePrecision || 8))

        if (formattedQty >= minQty) {
          const sellRes = await executeBinanceTrSpotOrder({
            symbol: pairTr,
            side: "SELL",
            type: "MARKET",
            quantity: formattedQty,
            isPartial: false,
            apiKey: creds.apiKey,
            apiSecret: creds.apiSecret,
          })

          if (sellRes.ok) {
            const remaining = (state.positions || []).filter((p: any) => p.symbol.toUpperCase().replace(/TRY$/, "") !== sym)
            await setServerPositions(remaining)
            await setServerManualSellCooldown(90)

            const wallet = await getSpotAccountAssets(creds.apiKey, creds.apiSecret)
            await setServerBalance(wallet.freeTry)

            cleanedReply = cleanedReply.replace(/\[ACTION:SELL_COIN:[A-Za-z0-9]+\]/g, "").trim()
            cleanedReply += `\n\n✅ **${sym} satışı yapıldı.** Pozisyon başarıyla kapatıldı. Güncel Kasa: ${wallet.freeTry.toFixed(2)} TL.`
          } else {
            cleanedReply = cleanedReply.replace(/\[ACTION:SELL_COIN:[A-Za-z0-9]+\]/g, "").trim()
            cleanedReply += `\n\n⚠️ ${sym} satışı borsada başarısız: ${sellRes.error}`
          }
        }
      } else {
        cleanedReply = cleanedReply.replace(/\[ACTION:SELL_COIN:[A-Za-z0-9]+\]/g, "").trim()
        cleanedReply += `\n\n⚠️ ${sym} pozisyonu açık pozisyonlar listesinde bulunamadı.`
      }
    } catch (e: any) {
      cleanedReply = cleanedReply.replace(/\[ACTION:SELL_COIN:[A-Za-z0-9]+\]/g, "").trim()
      cleanedReply += `\n\n❌ ${sym} satış işleminde hata: ${e.message}`
    }
  }

  // 3. Fırsat Tarama / Snipe Tetikleme
  if (cleanedReply.includes("[ACTION:SCAN_MARKET]")) {
    try {
      fetch("https://frborsam.vercel.app/api/bot/cron?snipe=1").catch(() => {})
      cleanedReply = cleanedReply.replace(/\[ACTION:SCAN_MARKET\]/g, "").trim()
      cleanedReply += `\n\n🎯 **Piyasa taraması başlatıldı.** Bot en yüksek sinyal puanına sahip fırsatları denetliyor.`
    } catch {}
  }

  // 4. Slot Değiştirme
  const slotMatch = cleanedReply.match(/\[ACTION:SET_SLOT:(\d+)\]/)
  if (slotMatch) {
    const num = parseInt(slotMatch[1], 10)
    if (num >= 1 && num <= 3) {
      const mode = num === 1 ? "fixed_1" : num === 3 ? "fixed_3" : "hybrid_2_slot"
      const desc =
        num === 1
          ? "🎯 Tek Slot Odak Modu: Tüm sermaye tek bir yüksek potansiyelli coinde toplanır."
          : num === 3
          ? "🌐 3 Slot Geniş Portföy: Risk 3 farklı varlığa dağıtılır."
          : "🛡️ 2 Slot Dengeli Hibrit Kasa: Biri düşerken diğeri portföyü tutan, Meme + DeFi dengesi."
      await setServerSlotConfig({ targetSlots: num, maxSlots: num, mode: mode as any, description: desc })
      cleanedReply = cleanedReply.replace(/\[ACTION:SET_SLOT:\d+\]/g, "").trim()
      cleanedReply += `\n\n⚙️ **Kasa Slot Ayarı Güncellendi:** ${num} Slot moduna geçildi.`
    }
  }

  // 5. Botu Durdurma
  if (cleanedReply.includes("[ACTION:PAUSE_BOT]")) {
    await setServerActive(false)
    cleanedReply = cleanedReply.replace(/\[ACTION:PAUSE_BOT\]/g, "").trim()
    cleanedReply += `\n\n⏸️ **Bot durduruldu (STOP).** Yeni alımlar kilitlendi.`
  }

  // 6. Botu Başlatma
  if (cleanedReply.includes("[ACTION:RESUME_BOT]")) {
    await setServerActive(true)
    cleanedReply = cleanedReply.replace(/\[ACTION:RESUME_BOT\]/g, "").trim()
    cleanedReply += `\n\n▶️ **Bot aktif edildi (START).** 7/24 piyasa takibi devrede.`
  }

  // 7. Geliştirici Görevi Kaydetme
  const devTaskMatch = cleanedReply.match(/\[ACTION:ADD_DEV_TASK:(.*?)\]/)
  if (devTaskMatch) {
    const taskDesc = devTaskMatch[1].trim()
    if (taskDesc) {
      await appendDevTask(taskDesc)
      cleanedReply = cleanedReply.replace(/\[ACTION:ADD_DEV_TASK:.*?\]/g, "").trim()
      cleanedReply += `\n\n📝 **Görev Kaydedildi:** ${taskDesc}`
    }
  }

  return cleanedReply
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const userMessage: string = body.message || ""
    const historyMessages: ChatMessage[] = body.history || []

    // 1. Canlı Sunucu Durumunu Çek
    const state = await getFullServerState()
    let realTryBalance = 0

    if (state.binance?.apiKey && state.binance?.apiSecret) {
      try {
        const b = await getSpotAccountAssets(state.binance.apiKey, state.binance.apiSecret)
        realTryBalance = b.freeTry || 0
      } catch {
        realTryBalance = state.binance?.realBalanceTry || state.balance || 0
      }
    } else {
      realTryBalance = state.balance || 0
    }

    const positions = state.positions || []
    const totalPositionsValue = positions.reduce(
      (acc: number, p: any) => acc + (p.currentValue || p.amount * p.currentPrice || 0),
      0
    )
    const totalEquity = realTryBalance + totalPositionsValue

    const positionsContext =
      positions.length > 0
        ? positions
            .map(
              (p: any) => {
                const sym = p.symbol === "RE" ? "RENDER" : p.symbol
                return `${sym}: Giriş=${p.entryPrice} TL, Anlık=${p.currentPrice?.toFixed(4)} TL, K/Z=${(p.pnlPercent || 0).toFixed(2)}% (${(p.pnl || 0).toFixed(2)} TL), TP=${p.takeProfitPrice || "-"}, SL=${p.stopLossPrice || "-"}`
              }
            )
            .join("\n")
        : "Açık pozisyon yok, nakitte yeni fırsat taranıyor."

    // 1.1 Vadeli (Futures) Durumu Çek
    const globCreds = await getServerBinanceGlobal()
    let futPositions: any[] = []
    let futBal: any = null
    if (globCreds?.apiKey && globCreds?.apiSecret) {
      try {
        const [fps, fb] = await Promise.all([
          getFuturesPositions(globCreds.apiKey, globCreds.apiSecret),
          getFuturesAccountBalance(globCreds.apiKey, globCreds.apiSecret),
        ])
        futPositions = fps || []
        futBal = fb || null
      } catch {}
    }

    const pendingOrders = await getPendingLimitOrders().catch(() => [])
    const firstFuturesBuy = pendingOrders.find(
      (o) => o.exchange === "BINANCE_GLOBAL_FUTURES" && o.side === "BUY"
    )
    const nextCand = firstFuturesBuy?.symbol || null
    const nextLev = firstFuturesBuy?.leverage || 5

    const futContext = futPositions.length > 0
      ? futPositions.map((fp: any) => {
          const rawGain = fp.entryPrice > 0 ? (((fp.markPrice - fp.entryPrice) / fp.entryPrice) * 100) : 0
          const roi = rawGain * fp.leverage
          const isPepe = fp.symbol.includes("PEPE")
          return `[VADELİ] ${fp.symbol} (${fp.leverage}x ${fp.positionAmt > 0 ? "LONG" : "SHORT"}): Giriş=$${fp.entryPrice}, Mark=$${fp.markPrice}, Net ROI=%${roi.toFixed(2)}, Kâr=$${(fp.unRealizedProfit || 0).toFixed(2)} USDT${isPepe ? " (PEPE Hedefi: %80 ROI / %8 Ham Artış)" : ""}`
        }).join("\n")
      : "Açık vadeli pozisyon yok."

    // 2. Canlı Gemini LLM Çağrısı (Proaktif, Dobra, Gerçek Finans Partneri)
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ""

    const systemPrompt = `Sen kullanıcının kişisel kripto işlem ortağı, tecrübeli trader dostu ve bot operatörüsün.
Kullanıcı seninle konuştuğunda bürokratik, soğuk devlet dairesi ağzıyla ("Bilgi alınmıştır", "Sistem mimarimize teyit edilmiştir", "Başka bir talimatınız var mı") KESİNLİKLE KONUŞMA!
Sen gerçek bir ekip arkadaşısın: Dobra, cana yakın ("kanka", "dostum" diyen), ne yaptığını adım adım bilen, piyasayı koklayan bir tradersın.

ANLIK CANLI PORTFÖY VE KASA VERİLERİ (BUNLARI EZBERDEN DEĞİL, BİREBİR KULLAN):
- Binance TR Spot Nakit: ${realTryBalance.toFixed(2)} ₺
- Binance Global Vadeli (Futures) Cüzdanı: $${(futBal?.totalWalletBalanceUsdt || 0).toFixed(2)} USDT
- Açık Vadeli Pozisyonlar:
${futContext}
- Pusuya Yatan / Sıradaki Futures Adayı: ${nextCand ? `${nextCand} (${nextLev}x kaldıraç ile limit emrinde pusu bekliyor)` : "Pusuda bekleyen yeni aday yok, tarama devam ediyor."}
- Açık Spot Pozisyonlar:
${positionsContext}
- Slot Düzeni: ${state.slotConfig?.targetSlots || 2} Slot
- Bot Durumu: ${state.active ? "Aktif (7/24 Piyasa Taramasında)" : "Durduruldu"}

ÖNEMLİ KURALLAR:
1. Kullanıcı kaldıraç veya vadeli işlem sorduğunda, yukarıdaki Binance Global Futures cüzdanını ($${(futBal?.totalWalletBalanceUsdt || 0).toFixed(2)} USDT) ve varsa açık vadeli pozisyonları doğrudan net rakamlarla anlat!
2. Kullanıcı "fırsat arıyor mu / ne yapıyor" dediğinde, neyi beklediğini (RSI dip teyidi, dip dönüş mumu, best-bid limit emri) bir trader gibi somut anlat.
3. Asla boş laf yapma, her cevabın masada gerçek bir analiz ve eylem hissettirsin.

TAM YETKİLİ KOMUT AKSİYONLARIN (Kullanıcı bir işlem talep ettiğinde cevabının en sonuna ilgili etiketi ekle):
- Bir coini sat dediyse: [ACTION:SELL_COIN:SYMBOL] (Örnek: EIGEN'i sat dediyse: [ACTION:SELL_COIN:EIGEN])
- Hepsini sat / Acil sat dediyse: [ACTION:EMERGENCY_SELL]
- Piyasa tara / fırsat bak / coin bul dediyse: [ACTION:SCAN_MARKET]
- Slot sayısını değiştir dediyse: [ACTION:SET_SLOT:1], [ACTION:SET_SLOT:2] veya [ACTION:SET_SLOT:3]
- Botu durdur / alımı kapat dediyse: [ACTION:PAUSE_BOT]
- Botu başlat / devam et dediyse: [ACTION:RESUME_BOT]
- Geliştirme notu verirse: [ACTION:ADD_DEV_TASK:özet]`

    const rawReply = await callGeminiLive(geminiKey, systemPrompt, userMessage, historyMessages)

    if (rawReply) {
      const finalReply = await executeAgentAction(rawReply)

      return NextResponse.json({
        reply: finalReply,
        suggestions: [
          "📊 Portföyde durum ne kanka?",
          "💰 Kasada ne kadar nakit var?",
          "🇹🇷 BIST hisse önerisi ver",
          "📈 1 yıl sonra ciro kaç olur?",
        ],
      })
    }

    // Yedek durum (çok nadir)
    return NextResponse.json({
      reply: `Kanka buradayım! Anlık kasamızda ${realTryBalance.toFixed(2)} ₺ serbest nakit var ve ${positions.length} açık slotumuz çalışıyor. Ne sormak veya yaptırmak istersin dostum?`,
      suggestions: ["Portföyde durum ne kanka?", "BIST hisse önerisi ver"],
    })
  } catch (error: any) {
    console.error("[Bot Assistant Route Error]", error)
    return NextResponse.json(
      {
        reply: "Kanka anlık bir dalgalanma oldu ama bot 7/24 görev başında! Tekrar sorabilirsin dostum.",
        suggestions: ["Portföyde durum ne kanka?"],
      },
      { status: 200 }
    )
  }
}
