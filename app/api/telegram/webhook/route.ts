import { NextRequest, NextResponse } from "next/server"
import {
  getFullServerState,
  setServerSlotConfig,
  setServerActive,
  appendDevTask,
  getDevTasks,
  getServerBinance,
  getServerBinanceGlobal,
  setServerPositions,
  setServerBalance,
  appendServerLog,
  setPendingLimitOrders,
  getPendingLimitOrders,
  setServerManualSellCooldown,
  clearFuturesPositionMeta,
  markFuturesBotOwned,
  setFuturesEntryTime,
} from "@/lib/bot/server-state"
import {
  getSpotAccountAssets,
  emergencySellAll,
  executeBinanceTrSpotOrder,
  getSymbolFilters,
  formatWithStepSize,
  getFuturesPositions,
  getFuturesAccountBalance,
  executeBinanceFuturesOrder,
  getFuturesSymbolFilters,
} from "@/lib/binance-helpers"
import { getTelegramConfig, sendTelegramMessage } from "@/lib/telegram"

export const dynamic = "force-dynamic"
export const maxDuration = 30

// ── Anlık USDT/TRY Kuru Getir ──
let cachedUsdtTry: { rate: number; updatedAt: number } | null = null
async function getUsdtTryRate(): Promise<number> {
  const now = Date.now()
  if (cachedUsdtTry && now - cachedUsdtTry.updatedAt < 60 * 1000) {
    return cachedUsdtTry.rate
  }
  try {
    const res = await fetch("https://api.binance.me/api/v3/ticker/price?symbol=USDTTRY", {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    })
    if (res.ok) {
      const data = await res.json()
      const r = parseFloat(data?.price)
      if (r > 0) {
        cachedUsdtTry = { rate: r, updatedAt: now }
        return r
      }
    }
  } catch {}
  return 38.0
}

// ── Ultra Hızlı Gemini API Çağrısı (Flash Lite / Flash Fallback) ──
async function callGeminiForTelegram(
  apiKey: string,
  systemPrompt: string,
  userMessage: string
): Promise<string | null> {
  const models = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-flash-latest"]

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 800,
          },
        }),
      })

      if (res.ok) {
        const json = await res.json()
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text
        if (text && text.trim()) {
          return text.trim()
        }
      }
    } catch (err: any) {
      console.warn(`[Telegram Gemini ${model} Error]`, err?.message || err)
    }
  }

  return null
}

// ── Vadeli Pozisyonu Kapat (Futures Market Close) ──
async function closeFuturesPositionBySymbol(rawSymbol: string): Promise<{ ok: boolean; message: string }> {
  const globCreds = await getServerBinanceGlobal()
  if (!globCreds?.apiKey || !globCreds?.apiSecret) {
    return { ok: false, message: "Binance Global API anahtarları tanımlı değil!" }
  }

  const cleanTarget = rawSymbol.toUpperCase().replace(/(USDT|TRY)$/i, "").trim()
  const positions = await getFuturesPositions(globCreds.apiKey, globCreds.apiSecret)

  // Hedef pozisyonu bul (1000PEPE veya PEPE vb. eşlemesi dahil)
  const pos = positions.find((p) => {
    const s = p.symbol.toUpperCase().replace(/USDT$/i, "")
    return s === cleanTarget || (cleanTarget === "PEPE" && s === "1000PEPE") || (cleanTarget === "1000PEPE" && s === "PEPE")
  })

  if (!pos || Math.abs(pos.positionAmt) <= 0) {
    return { ok: false, message: `Açık vadeli <b>${cleanTarget}</b> pozisyonu bulunamadı.` }
  }

  const filters = await getFuturesSymbolFilters(pos.symbol)
  const stepSize = filters?.stepSize || 0.001
  const fullAmt = parseFloat(formatWithStepSize(Math.abs(pos.positionAmt), stepSize, filters?.basePrecision || 3))

  if (fullAmt <= 0) {
    return { ok: false, message: `Pozisyon miktarı formatlanamadı (${pos.positionAmt}).` }
  }

  const closeSide = pos.positionAmt > 0 ? "SELL" : "BUY"
  const closeRes = await executeBinanceFuturesOrder({
    apiKey: globCreds.apiKey,
    apiSecret: globCreds.apiSecret,
    symbol: pos.symbol,
    side: closeSide,
    type: "MARKET",
    quantity: fullAmt,
    reduceOnly: true,
  })

  if (!closeRes.ok) {
    return { ok: false, message: `Vadeli emir iletilemedi: ${closeRes.error || "Bilinmeyen hata"}` }
  }

  await clearFuturesPositionMeta(pos.symbol)
  // Kullanıcı manuel çıktığında botun 1.5 dk yeni işlem açmaması için mola ver:
  await setServerManualSellCooldown(90)

  const pnlUsdt = pos.unRealizedProfit || 0
  const roiPct = pos.entryPrice > 0 ? (((pos.markPrice - pos.entryPrice) / pos.entryPrice) * 100 * pos.leverage) : 0
  const sign = pnlUsdt >= 0 ? "+" : ""

  return {
    ok: true,
    message: `✅ <b>${pos.symbol}</b> (${pos.leverage}x) pozisyonu piyasa fiyatından kapatıldı!\n` +
      `📊 Çıkış Fiyatı: $${pos.markPrice}\n` +
      `💰 Kâr/Zarar: ${sign}$${pnlUsdt.toFixed(2)} (${sign}%${roiPct.toFixed(2)} ROI)\n` +
      `⏳ <i>1.5 dakika (90 sn) koruma molası devrede, ardından otomatik sistem devam edecek.</i>`
  }
}

// ── Vadeli Long Pozisyonu Aç (Kaldıraçlı Alım) ──
async function openFuturesLongBySymbol(rawSymbol: string, rawLev?: string): Promise<{ ok: boolean; message: string }> {
  const globCreds = await getServerBinanceGlobal()
  if (!globCreds?.apiKey || !globCreds?.apiSecret) {
    return { ok: false, message: "⚠️ Binance Global API anahtarları tanımlı değil! Lütfen önce panelden anahtarlarınızı bağlayın." }
  }

  const cleanInput = rawSymbol.toUpperCase().replace(/(USDT|TRY)$/i, "").trim()
  if (!cleanInput) {
    return { ok: false, message: "⚠️ Lütfen bir coin belirtin. Örnek: <code>/long SOL 10x</code> veya <code>/long DOGE</code>" }
  }

  // Binance vadeli çarpan pariteleri (1000PEPE, 1000BONK vb.)
  let pair = `${cleanInput}USDT`
  if (cleanInput === "PEPE") pair = "1000PEPEUSDT"
  else if (cleanInput === "BONK") pair = "1000BONKUSDT"
  else if (cleanInput === "SHIB") pair = "1000SHIBUSDT"
  else if (cleanInput === "FLOKI") pair = "1000FLOKIUSDT"
  else if (cleanInput === "BOME") pair = "1000BOMEUSDT"

  // Kaldıraç ayarla (varsayılan 10x)
  let leverage = 10
  if (rawLev) {
    const parsed = parseInt(String(rawLev).replace(/[^0-9]/g, ""), 10)
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 20) {
      leverage = parsed
    }
  }

  const [bal, priceRes, filters] = await Promise.all([
    getFuturesAccountBalance(globCreds.apiKey, globCreds.apiSecret),
    fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${pair}`, { cache: "no-store", signal: AbortSignal.timeout(4000) }).then((r) => r.ok ? r.json() : null).catch(() => null),
    getFuturesSymbolFilters(pair),
  ])

  if (!priceRes || !priceRes.price) {
    return { ok: false, message: `⚠️ <b>${pair}</b> paritesi Binance Vadeli (Futures) tahtasında bulunamadı veya fiyat alınamadı.` }
  }

  const currentPrice = parseFloat(priceRes.price)
  if (currentPrice <= 0) {
    return { ok: false, message: `⚠️ Geçersiz fiyat alındı: ${priceRes.price}` }
  }

  const availUsdt = bal?.availableBalanceUsdt || 0
  if (availUsdt < 0.6) {
    return { ok: false, message: `⚠️ Yetersiz Vadeli bakiye! Serbest teminatınız: <b>$${availUsdt.toFixed(2)} USDT</b>. En az $0.60 USDT gereklidir.` }
  }

  const minNotional = filters?.minNotional || 5.0
  // Kullanıcının "ne kadar para varsa onunla al" kuralı: Serbest teminatın %96'sı
  const marginToUse = Math.max(minNotional / leverage, availUsdt * 0.96)
  let notionalUsdt = Math.max(minNotional + 0.5, marginToUse * leverage)

  if (notionalUsdt / leverage > availUsdt * 0.99) {
    notionalUsdt = (availUsdt * 0.96) * leverage
  }

  if (notionalUsdt / leverage > availUsdt) {
    return { ok: false, message: `⚠️ Bu pozisyon için gereken teminat ($${(notionalUsdt / leverage).toFixed(2)}), serbest bakiyenizden ($${availUsdt.toFixed(2)}) fazla!` }
  }

  const stepSize = filters?.stepSize || 0.001
  const rawQty = notionalUsdt / currentPrice
  const formattedQty = parseFloat(formatWithStepSize(rawQty, stepSize, filters?.basePrecision || 3))

  if (formattedQty <= 0 || (filters?.minQty && formattedQty < filters.minQty)) {
    return { ok: false, message: `⚠️ Hesaplanan miktar (${formattedQty}) minimum işlem adedinin altında kaldı.` }
  }

  const actualNotional = formattedQty * currentPrice
  const actualMargin = actualNotional / leverage

  const orderRes = await executeBinanceFuturesOrder({
    apiKey: globCreds.apiKey,
    apiSecret: globCreds.apiSecret,
    symbol: pair,
    side: "BUY",
    type: "MARKET",
    quantity: formattedQty,
    leverage,
  })

  if (!orderRes.ok) {
    return { ok: false, message: `❌ <b>Vadeli emir iletilemedi:</b> ${orderRes.error || "Bilinmeyen borsa hatası"}` }
  }

  await markFuturesBotOwned(pair)
  await setFuturesEntryTime(pair, Date.now())

  const logMsg = `🟢 [TELEGRAM MANUEL VADELİ EMİR] ${pair} ${leverage}x Long açıldı. Adet: ${formattedQty}, Giriş: ~$${currentPrice.toFixed(4)}, Teminat: ~$${actualMargin.toFixed(2)} USDT`
  await appendServerLog({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toLocaleTimeString("tr-TR"),
    type: "BUY",
    symbol: pair,
    message: logMsg,
  })

  return {
    ok: true,
    message: `🟢 <b>VADELİ LONG POZİSYONU AÇILDI!</b>\n\n` +
      `📌 <b>${pair}</b> [${leverage}x LONG]\n` +
      `• Miktar: <b>${formattedQty}</b>\n` +
      `• Giriş Fiyatı: <b>~$${currentPrice}</b>\n` +
      `• Pozisyon Büyüklüğü: <b>$${actualNotional.toFixed(2)} USDT</b>\n` +
      `• Kullanılan Teminat: <b>$${actualMargin.toFixed(2)} USDT</b> (%96 kasa)\n` +
      `• Kalan Serbest Teminat: <b>$${Math.max(0, availUsdt - actualMargin).toFixed(2)} USDT</b>\n\n` +
      `🎯 Kapatmak istersen: <code>/kapat ${cleanInput}</code> veya <code>/cik</code>`
  }
}

// ── Spot Pozisyonu Sat ──
async function sellSpotPositionBySymbol(rawSymbol: string): Promise<{ ok: boolean; message: string }> {
  const creds = await getServerBinance()
  if (!creds?.apiKey || !creds?.apiSecret) {
    return { ok: false, message: "Binance TR API anahtarları tanımlı değil!" }
  }

  const sym = rawSymbol.toUpperCase().replace(/(TRY|USDT)$/i, "").trim()
  const state = await getFullServerState()
  const pos = (state.positions || []).find((p: any) => p.symbol.toUpperCase().replace(/TRY$/, "") === sym)

  if (!pos) {
    return { ok: false, message: `Açık spot <b>${sym}</b> pozisyonu bulunamadı.` }
  }

  const pairTr = `${sym}_TRY`
  const filters = await getSymbolFilters(pairTr)
  const stepSize = filters?.stepSize || 0.0001
  const minQty = filters?.minQty || 0.0001
  const formattedQty = parseFloat(formatWithStepSize(pos.amount, stepSize, filters?.basePrecision || 8))

  if (formattedQty < minQty) {
    return { ok: false, message: `Satış miktarı min işlem sınırının altında (${formattedQty} < ${minQty}).` }
  }

  const sellRes = await executeBinanceTrSpotOrder({
    symbol: pairTr,
    side: "SELL",
    type: "MARKET",
    quantity: formattedQty,
    isPartial: false,
    apiKey: creds.apiKey,
    apiSecret: creds.apiSecret,
  })

  if (!sellRes.ok) {
    return { ok: false, message: `Borsada satış başarısız: ${sellRes.error}` }
  }

  const remaining = (state.positions || []).filter((p: any) => p.symbol.toUpperCase().replace(/TRY$/, "") !== sym)
  await setServerPositions(remaining)
  await setServerManualSellCooldown(90)

  const wallet = await getSpotAccountAssets(creds.apiKey, creds.apiSecret)
  await setServerBalance(wallet.freeTry)

  return {
    ok: true,
    message: `✅ <b>${sym}</b> spot pozisyonu satıldı. Güncel Kasa: ${wallet.freeTry.toFixed(2)} TL.`
  }
}

// ── Tüm Pozisyonlardan Çık (Acil / Manuel Çıkış: Vadeli + Spot) ──
async function closeAllPositions(): Promise<{ ok: boolean; message: string }> {
  const [globCreds, spotCreds] = await Promise.all([
    getServerBinanceGlobal(),
    getServerBinance(),
  ])

  const closedList: string[] = []

  // 1. Açık Vadeli Pozisyonları Kapat
  if (globCreds?.apiKey && globCreds?.apiSecret) {
    try {
      const positions = await getFuturesPositions(globCreds.apiKey, globCreds.apiSecret)
      for (const pos of positions) {
        if (Math.abs(pos.positionAmt) > 0) {
          const res = await closeFuturesPositionBySymbol(pos.symbol)
          if (res.ok) {
            closedList.push(`[Vadeli] ${pos.symbol}`)
          }
        }
      }
    } catch (e: any) {
      console.warn("[closeAllPositions] Vadeli kapatma hatası:", e.message)
    }
  }

  // 2. Açık Spot Pozisyonları Kapat
  if (spotCreds?.apiKey && spotCreds?.apiSecret) {
    try {
      const state = await getFullServerState()
      const spotPositions = state.positions || []
      for (const sp of spotPositions) {
        const res = await sellSpotPositionBySymbol(sp.symbol)
        if (res.ok) {
          closedList.push(`[Spot] ${sp.symbol}`)
        }
      }
    } catch (e: any) {
      console.warn("[closeAllPositions] Spot kapatma hatası:", e.message)
    }
  }

  // 1.5 dk mola ver
  await setServerManualSellCooldown(90)

  if (closedList.length === 0) {
    return {
      ok: true,
      message: "ℹ️ Açık pozisyon bulunamadı. Tüm slotlar zaten boşta ve nakitte bekleniyor.",
    }
  }

  return {
    ok: true,
    message: `🚨 <b>TÜM POZİSYONLARDAN ÇIKILDI!</b>\n\n` +
      `Kapatılan / Satılan İşlemler:\n` +
      closedList.map((c) => `• <b>${c}</b>`).join("\n") +
      `\n\n⏳ <i>1.5 dakika (90 sn) koruma molası devrede, ardından bot yeni fırsatlara devam edecek.</i>`,
  }
}

// ── Piyasadaki En İyi / En Güçlü Coini Bulup Vadeli Long Aç ──
async function buyBestCoinFutures(): Promise<{ ok: boolean; message: string }> {
  const globCreds = await getServerBinanceGlobal()
  if (!globCreds?.apiKey || !globCreds?.apiSecret) {
    return { ok: false, message: "⚠️ Binance Global API anahtarları tanımlı değil!" }
  }

  // Aday havuzu
  const CANDIDATES = [
    "SUIUSDT", "SOLUSDT", "DOGEUSDT", "1000PEPEUSDT",
    "NEARUSDT", "AVAXUSDT", "LINKUSDT", "APTUSDT", "RENDERUSDT",
  ]

  let bestCandidate = "SUI"
  let bestScore = -999

  try {
    const tickRes = await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr", { cache: "no-store", signal: AbortSignal.timeout(4000) })
    if (tickRes.ok) {
      const list24: any[] = await tickRes.json()
      const map = new Map<string, any>()
      for (const item of list24) {
        map.set(item.symbol, item)
      }

      for (const cand of CANDIDATES) {
        const d = map.get(cand)
        if (!d) continue
        const chg = parseFloat(d.priceChangePercent) || 0
        const qv = parseFloat(d.quoteVolume) || 0
        // Puan: Güçlü momentum veya dip dönüşü
        let score = (qv / 100000000) * 10
        if (chg >= 1.5 && chg <= 8.0) score += 30
        else if (chg < 0 && chg >= -10.0) score += 20
        if (cand.includes("PEPE") || cand.includes("DOGE")) score += 15
        if (score > bestScore) {
          bestScore = score
          bestCandidate = cand.replace("USDT", "")
        }
      }
    }
  } catch {}

  return openFuturesLongBySymbol(bestCandidate, "10x")
}

async function executeAgentAction(replyText: string): Promise<string> {
  let cleanedReply = replyText

  // 1. Tüm Pozisyonları Kapat / Çık (Vadeli + Spot)
  if (cleanedReply.includes("[ACTION:CLOSE_ALL]")) {
    const allRes = await closeAllPositions()
    cleanedReply = cleanedReply.replace(/\[ACTION:CLOSE_ALL\]/g, "").trim()
    cleanedReply += `\n\n${allRes.message}`
  }

  // 1b. Acil Satış (Tümünü Nakite Geçir)
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
        cleanedReply += `\n\n🚨 <b>Acil Satış Tamamlandı!</b> Tüm açık spot pozisyonlar ve emirler kapatıldı. Satılanlar: ${res.soldList.join(", ") || "Açık pozisyon yok"}. Kasa: ${wallet.freeTry.toFixed(2)} TL.`
      }
    } catch (e: any) {
      cleanedReply = cleanedReply.replace(/\[ACTION:EMERGENCY_SELL\]/g, "").trim()
      cleanedReply += `\n\n❌ Acil satış hatası: ${e.message}`
    }
  }

  // 1c. En İyi Coini Al / Slottan Al
  if (cleanedReply.includes("[ACTION:BUY_BEST_COIN]")) {
    const bestRes = await buyBestCoinFutures()
    cleanedReply = cleanedReply.replace(/\[ACTION:BUY_BEST_COIN\]/g, "").trim()
    cleanedReply += `\n\n${bestRes.message}`
  }

  // 1d. Belirli Bir Coini Vadeli Al (Örn: [ACTION:BUY_FUTURES:SOL:10x] veya [ACTION:BUY_FUTURES:SOL])
  const buyFutMatch = cleanedReply.match(/\[ACTION:BUY_FUTURES:([A-Za-z0-9]+)(?::([A-Za-z0-9]+))?\]/)
  if (buyFutMatch) {
    const coin = buyFutMatch[1]
    const lev = buyFutMatch[2] || "10x"
    const openRes = await openFuturesLongBySymbol(coin, lev)
    cleanedReply = cleanedReply.replace(/\[ACTION:BUY_FUTURES:[A-Za-z0-9]+(?::[A-Za-z0-9]+)?\]/g, "").trim()
    cleanedReply += `\n\n${openRes.message}`
  }

  // 2. Vadeli Pozisyon Kapat (Örn: [ACTION:CLOSE_FUTURES:PEPE] veya [ACTION:CLOSE_FUTURES:1000PEPE])
  const closeFutMatch = cleanedReply.match(/\[ACTION:CLOSE_FUTURES:([A-Za-z0-9]+)\]/)
  if (closeFutMatch) {
    const sym = closeFutMatch[1]
    const futRes = await closeFuturesPositionBySymbol(sym)
    cleanedReply = cleanedReply.replace(/\[ACTION:CLOSE_FUTURES:[A-Za-z0-9]+\]/g, "").trim()
    cleanedReply += `\n\n${futRes.message}`
  }

  // 3. Belirli Bir Spot Coini Sat (Örn: [ACTION:SELL_COIN:EIGEN])
  const sellMatch = cleanedReply.match(/\[ACTION:SELL_COIN:([A-Za-z0-9]+)\]/)
  if (sellMatch) {
    const sym = sellMatch[1]
    const spotRes = await sellSpotPositionBySymbol(sym)
    cleanedReply = cleanedReply.replace(/\[ACTION:SELL_COIN:[A-Za-z0-9]+\]/g, "").trim()
    cleanedReply += `\n\n${spotRes.message}`
  }

  // 4. Fırsat Tarama / Snipe Tetikleme
  if (cleanedReply.includes("[ACTION:SCAN_MARKET]")) {
    try {
      fetch("https://frborsam.vercel.app/api/bot/cron?snipe=1").catch(() => {})
      cleanedReply = cleanedReply.replace(/\[ACTION:SCAN_MARKET\]/g, "").trim()
      cleanedReply += `\n\n🎯 <b>Piyasa taraması başlatıldı.</b> Bot en yüksek sinyal puanına sahip coinleri denetliyor.`
    } catch {}
  }

  // 5. Slot Değiştirme
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
      cleanedReply += `\n\n⚙️ <b>Kasa Slot Ayarı Güncellendi:</b> ${num} Slot moduna geçildi.`
    }
  }

  // 6. Botu Durdurma
  if (cleanedReply.includes("[ACTION:PAUSE_BOT]")) {
    await setServerActive(false)
    cleanedReply = cleanedReply.replace(/\[ACTION:PAUSE_BOT\]/g, "").trim()
    cleanedReply += `\n\n⏸️ <b>Bot durduruldu (STOP).</b> Yeni alım yapılmayacak.`
  }

  // 7. Botu Başlatma
  if (cleanedReply.includes("[ACTION:RESUME_BOT]")) {
    await setServerActive(true)
    cleanedReply = cleanedReply.replace(/\[ACTION:RESUME_BOT\]/g, "").trim()
    cleanedReply += `\n\n▶️ <b>Bot aktif edildi (START).</b> 7/24 piyasa takibi ve fırsat avı devrede.`
  }

  // 8. Geliştirici Görevi
  const devTaskMatch = cleanedReply.match(/\[ACTION:ADD_DEV_TASK:(.*?)\]/)
  if (devTaskMatch) {
    const taskDesc = devTaskMatch[1].trim()
    if (taskDesc) {
      await appendDevTask(taskDesc)
      cleanedReply = cleanedReply.replace(/\[ACTION:ADD_DEV_TASK:.*?\]/g, "").trim()
      cleanedReply += `\n\n📝 <b>Görev Kaydedildi:</b> ${taskDesc}`
    }
  }

  return cleanedReply
}

// ── FAST DIRECT COMMAND ROUTER (Sıfır Gecikme, Garantili İcra) ──
async function handleDirectCommand(cmd: string, args: string[]): Promise<string | null> {
  const c = cmd.toLowerCase().replace(/^\//, "")

  // 1. /start | /yardim | /help
  if (c === "start" || c === "yardim" || c === "yardım" || c === "help" || c === "komutlar") {
    return `🤖 <b>Pundik Finansal Trading Botu Komut Menüsü</b>\n\n` +
      `📊 <b>DURUM VE RAPORLAR:</b>\n` +
      `• /durum — Canlı genel durum, Spot & Vadeli pozisyonlar, kâr/zarar\n` +
      `• /vadeli — Açık vadeli (Futures) pozisyonlar, kaldıraç ve ROI\n` +
      `• /pepe — PEPE'nin anlık kârı, hedefi (%8 / %80 ROI) ve kural durumu\n` +
      `• /spot — Açık Spot cüzdan pozisyonları\n` +
      `• /kasa veya /bakiye — Spot TL ve Vadeli USDT toplam varlık\n\n` +
      `⚡ <b>HIZLI İŞLEMLER (AL / ÇIK):</b>\n` +
      `• /cik veya /kapat — Açık pozisyondan / slottan piyasa fiyatıyla çıkar (1.5 dk mola verir)\n` +
      `• /cik hepsi — Hem vadeli hem spot tüm açık pozisyonları anında kapatır\n` +
      `• /cik &lt;COIN&gt; veya /kapat &lt;COIN&gt; — Belirtilen vadeli/spot coini kapatır\n` +
      `• /al veya /slottan_al — Boş slot varsa tüm serbest parayla (%96) sıradaki en iyi coini anında alır\n` +
      `• /al &lt;COIN&gt; [10x] veya /long &lt;COIN&gt; — Belirtilen coini tüm serbest parayla 10x alır\n` +
      `• /sat &lt;COIN&gt; — Belirtilen spot coini piyasadan satar\n` +
      `• /tara — Piyasa fırsat taramasını tetikler\n\n` +
      `⚙️ <b>YÖNETİM:</b>\n` +
      `• /durdur — Botu durdurur (yeni alım yapmaz)\n` +
      `• /baslat — Botu aktif eder\n` +
      `• /slot 1 | 2 | 3 — Kasa slot sayısını ayarlar\n\n` +
      `🛠️ <b>SİTEYİ GELİŞTİRME & GÖREVLER:</b>\n` +
      `• /gelistir &lt;istek&gt; — Siteye veya bota yeni özellik ekleme görevi kaydeder\n` +
      `• /gorevler — Bekleyen geliştirme görevlerini listeler\n\n` +
      `💡 <i>Ayrıca doğrudan "çık", "pepeden çık", "al", "slottan al", "PEPE kârda mı?" yazabilirsin!</i>`
  }

  // 2. /kasa | /bakiye
  if (c === "kasa" || c === "bakiye") {
    const state = await getFullServerState()
    const usdtRate = await getUsdtTryRate()

    let spotTry = 0
    if (state.binance?.apiKey && state.binance?.apiSecret) {
      try {
        const b = await getSpotAccountAssets(state.binance.apiKey, state.binance.apiSecret)
        spotTry = b.freeTry || 0
      } catch {
        spotTry = state.binance?.realBalanceTry || state.balance || 0
      }
    } else {
      spotTry = state.balance || 0
    }

    let futUsdt = 0
    let futUnrealized = 0
    const globCreds = await getServerBinanceGlobal()
    if (globCreds?.apiKey && globCreds?.apiSecret) {
      try {
        const fBal = await getFuturesAccountBalance(globCreds.apiKey, globCreds.apiSecret)
        if (fBal.ok) {
          futUsdt = fBal.totalWalletBalanceUsdt || 0
          futUnrealized = fBal.totalUnrealizedPnlUsdt || 0
        }
      } catch {}
    }

    const futTryEquiv = futUsdt * usdtRate
    const totalTry = spotTry + futTryEquiv

    return `💰 <b>GÜNCEL KASA VE BAKİYE ÖZETİ</b>\n\n` +
      `🇹🇷 <b>Binance TR Spot Serbest:</b> ${spotTry.toFixed(2)} ₺\n` +
      `🌐 <b>Binance Global Vadeli Cüzdan:</b> $${futUsdt.toFixed(2)} USDT (~${futTryEquiv.toFixed(2)} ₺)\n` +
      `📈 <b>Vadeli Açık Kâr/Zarar:</b> ${futUnrealized >= 0 ? "+" : ""}$${futUnrealized.toFixed(2)} USDT\n` +
      `💵 <b>Dolar Kuru (USDT/TRY):</b> ${usdtRate.toFixed(2)} ₺\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💎 <b>TOPLAM VARLIK:</b> ~<b>${totalTry.toFixed(2)} ₺</b>`
  }

  // 3. /vadeli | /futures
  if (c === "vadeli" || c === "futures") {
    const globCreds = await getServerBinanceGlobal()
    if (!globCreds?.apiKey || !globCreds?.apiSecret) {
      return "⚠️ Binance Global API anahtarları tanımlı değil!"
    }

    const [positions, bal, usdtRate] = await Promise.all([
      getFuturesPositions(globCreds.apiKey, globCreds.apiSecret),
      getFuturesAccountBalance(globCreds.apiKey, globCreds.apiSecret),
      getUsdtTryRate(),
    ])

    if (!positions || positions.length === 0) {
      return `🌐 <b>VADELİ İŞLEMLER (FUTURES)</b>\n\n` +
        `💼 Cüzdan: $${(bal?.totalWalletBalanceUsdt || 0).toFixed(2)} USDT\n` +
        `✅ Şu an açık vadeli pozisyon bulunmuyor. Piyasa güvenle taranıyor.`
    }

    let msg = `🌐 <b>AÇIK VADELİ POZİSYONLAR (${positions.length})</b>\n\n`
    for (const p of positions) {
      const isLong = p.positionAmt > 0
      const rawGainPct = p.entryPrice > 0 ? (((p.markPrice - p.entryPrice) / p.entryPrice) * 100) : 0
      const roiPct = rawGainPct * p.leverage
      const pnlUsdt = p.unRealizedProfit || 0
      const pnlTry = pnlUsdt * usdtRate
      const sign = pnlUsdt >= 0 ? "+" : ""

      msg += `📌 <b>${p.symbol}</b> [${p.leverage}x ${isLong ? "LONG 🟢" : "SHORT 🔴"}]\n`
      msg += `• Giriş: $${p.entryPrice} | Mark: $${p.markPrice}\n`
      msg += `• Ham Fiyat Değişimi: ${sign}%${rawGainPct.toFixed(2)}\n`
      msg += `• Kaldıraçlı ROI: <b>${sign}%${roiPct.toFixed(2)} ROI</b>\n`
      msg += `• Kâr/Zarar: <b>${sign}$${pnlUsdt.toFixed(2)} USDT</b> (~${sign}${pnlTry.toFixed(1)} ₺)\n`
      if (p.symbol.includes("PEPE")) {
        msg += `🎯 <i>PEPE Özel Hedef: %8 Ham Fiyat (%80 ROI) | Kademeli Satış Kapalı</i>\n`
      }
      msg += `━━━━━━━━━━━━━━━━━━\n`
    }

    msg += `💼 Toplam Vadeli Cüzdan: $${(bal?.totalWalletBalanceUsdt || 0).toFixed(2)} USDT\n`
    msg += `👉 Pozisyon kapatmak için: <code>/kapat COIN</code> (Örn: <code>/kapat PEPE</code>)`
    return msg
  }

  // 4. /pepe | /1000pepe
  if (c === "pepe" || c === "1000pepe") {
    const globCreds = await getServerBinanceGlobal()
    if (!globCreds?.apiKey || !globCreds?.apiSecret) {
      return "⚠️ Binance Global API anahtarları tanımlı değil!"
    }

    const [positions, usdtRate] = await Promise.all([
      getFuturesPositions(globCreds.apiKey, globCreds.apiSecret),
      getUsdtTryRate(),
    ])

    const p = (positions || []).find((pos) => pos.symbol.includes("PEPE"))
    if (!p) {
      return `🐸 <b>PEPE VADELİ DURUMU</b>\n\n` +
        `Şu an açık bir PEPE vadeli pozisyonu bulunmuyor.\n\n` +
        `📌 <b>Tanımlı PEPE Stratejisi:</b>\n` +
        `• Hedef Kâr: Ham fiyat artışı <b>+%8.00</b> (10x'te <b>+%80.00 ROI</b>)\n` +
        `• Satış Şekli: Kademesiz, hedefe varınca %100 tam satış\n` +
        `• Zararına Stop-Loss: YOKTUR (iğnelerden korunur)\n` +
        `• Kâr Koruma Stopu: Fiyat +%5'i geçtikten sonra +%3.0'a (ROI +%30) koruma stopu konur, %8'e kadar koşması için pay bırakılır.`
    }

    const rawGainPct = p.entryPrice > 0 ? (((p.markPrice - p.entryPrice) / p.entryPrice) * 100) : 0
    const roiPct = rawGainPct * p.leverage
    const pnlUsdt = p.unRealizedProfit || 0
    const pnlTry = pnlUsdt * usdtRate
    const sign = pnlUsdt >= 0 ? "+" : ""
    return `🐸 <b>PEPE CANLI VADELİ TAKİP RAPORU</b>\n\n` +
      `• Parite: <b>${p.symbol}</b> (${p.leverage}x Kaldıraç)\n` +
      `• Giriş Fiyatı: $${p.entryPrice}\n` +
      `• Güncel Mark Fiyatı: $${p.markPrice}\n` +
      `• Ham Fiyat Artışı: <b>${sign}%${rawGainPct.toFixed(2)}</b>\n` +
      `• Kaldıraçlı Net Kâr: <b>${sign}%${roiPct.toFixed(2)} ROI</b>\n` +
      `• Anlık Net Kâr: <b>${sign}$${pnlUsdt.toFixed(2)} USDT</b> (~${sign}${pnlTry.toFixed(2)} ₺)\n\n` +
      `🎯 <b>HEDEF VE KURAL BİLGİSİ:</b>\n` +
      `• Standart Vadeli Kuralları Devrede (TP1: %6, Stop-Loss: -%3.5)\n\n` +
      `👉 Kapatmak istersen: <code>/kapat PEPE</code>`
  }

  // 5. /durum | /status
  if (c === "durum" || c === "status") {
    const state = await getFullServerState()
    const usdtRate = await getUsdtTryRate()

    let spotTry = state.balance || 0
    if (state.binance?.apiKey && state.binance?.apiSecret) {
      try {
        const b = await getSpotAccountAssets(state.binance.apiKey, state.binance.apiSecret)
        spotTry = b.freeTry || 0
      } catch {}
    }

    let futPositions: any[] = []
    let futBal: any = null
    const globCreds = await getServerBinanceGlobal()
    if (globCreds?.apiKey && globCreds?.apiSecret) {
      try {
        futPositions = await getFuturesPositions(globCreds.apiKey, globCreds.apiSecret)
        futBal = await getFuturesAccountBalance(globCreds.apiKey, globCreds.apiSecret)
      } catch {}
    }

    const spotPositions = state.positions || []
    let msg = `📊 <b>CANLI SİSTEM VE PORTFÖY RAPORU</b>\n\n`
    msg += `🤖 <b>Bot Durumu:</b> ${state.active ? "Aktif (7/24 Çalışıyor) 🟢" : "Durduruldu ⏸️"}\n`
    msg += `⚙️ <b>Kasa Slotu:</b> ${state.slotConfig?.targetSlots || 2} Slot\n`
    msg += `🇹🇷 <b>Spot Nakit:</b> ${spotTry.toFixed(2)} ₺\n`
    msg += `🌐 <b>Vadeli Bakiye:</b> $${(futBal?.totalWalletBalanceUsdt || 0).toFixed(2)} USDT\n\n`

    if (futPositions.length > 0) {
      msg += `🌐 <b>AÇIK VADELİ İŞLEMLER (${futPositions.length}):</b>\n`
      for (const fp of futPositions) {
        const rawDiff = fp.entryPrice > 0 ? (((fp.markPrice - fp.entryPrice) / fp.entryPrice) * 100) : 0
        const roi = rawDiff * fp.leverage
        const sign = roi >= 0 ? "+" : ""
        msg += `• <b>${fp.symbol}</b> (${fp.leverage}x): ${sign}%${roi.toFixed(2)} ROI (${sign}$${(fp.unRealizedProfit || 0).toFixed(2)})\n`
      }
      msg += `\n`
    }

    if (spotPositions.length > 0) {
      msg += `🇹🇷 <b>AÇIK SPOT İŞLEMLER (${spotPositions.length}):</b>\n`
      for (const sp of spotPositions) {
        const sym = sp.symbol === "RE" ? "RENDER" : sp.symbol
        const sign = (sp.pnlPercent || 0) >= 0 ? "+" : ""
        msg += `• <b>${sym}</b>: ${sign}%${(sp.pnlPercent || 0).toFixed(2)} (${sign}${(sp.pnl || 0).toFixed(2)} ₺)\n`
      }
      msg += `\n`
    }

    if (futPositions.length === 0 && spotPositions.length === 0) {
      msg += `✨ Açık pozisyon yok, sermaye korumada ve yeni fırsatlar taranıyor.\n\n`
    }

    msg += `💡 <i>Detay için /vadeli, /pepe veya /kasa yazabilirsiniz.</i>`
    return msg
  }

  // 6. /spot
  if (c === "spot") {
    const state = await getFullServerState()
    const positions = state.positions || []
    if (positions.length === 0) {
      return "🇹🇷 Açık spot pozisyon bulunmuyor."
    }
    let msg = `🇹🇷 <b>AÇIK SPOT POZİSYONLAR (${positions.length})</b>\n\n`
    for (const p of positions) {
      const sym = p.symbol === "RE" ? "RENDER" : p.symbol
      const sign = (p.pnlPercent || 0) >= 0 ? "+" : ""
      msg += `📌 <b>${sym}</b>\n`
      msg += `• Giriş: ${p.entryPrice} ₺ | Anlık: ${p.currentPrice?.toFixed(4)} ₺\n`
      msg += `• Kâr/Zarar: <b>${sign}%${(p.pnlPercent || 0).toFixed(2)} (${sign}${(p.pnl || 0).toFixed(2)} ₺)</b>\n`
      msg += `━━━━━━━━━━━━━━━━━━\n`
    }
    msg += `👉 Satmak için: <code>/sat COIN</code>`
    return msg
  }

  // 7. /al | /slottan_al | /long <COIN> [KALDIRAÇ] | /vadeli_al | /gir
  if (c === "al" || c === "slottan_al" || c === "slottanal" || c === "long" || c === "vadeli_al" || c === "vadelial" || c === "gir") {
    const targetCoin = args[0]
    // Coin belirtilmediyse (Örn: /al veya /slottan_al veya "al"): En güçlü coini bulup tüm bakiyeyle (%96) al!
    if (!targetCoin || ["slot", "slottan", "eniyi", "hepsi", "otomatik"].includes(targetCoin.toLowerCase())) {
      const bestRes = await buyBestCoinFutures()
      return bestRes.message
    }
    const targetLev = args[1] || "10x"
    const res = await openFuturesLongBySymbol(targetCoin, targetLev)
    return res.message
  }

  // 8. /cik | /kapat | /cikis | /sat (Vadeli / Spot Pozisyondan Çık)
  if (c === "cik" || c === "çık" || c === "kapat" || c === "cikis" || c === "çıkış" || c === "sat") {
    const targetCoin = args[0]

    // A) "hepsi", "tümü", "tum" dediyse tüm pozisyonları kapat:
    if (targetCoin && ["hepsi", "tümü", "tumu", "tum", "all"].includes(targetCoin.toLowerCase())) {
      const allRes = await closeAllPositions()
      return allRes.message
    }

    // B) Coin belirtilmişse: Önce Vadeli'de ara, yoksa Spot'ta ara ve kapat
    if (targetCoin) {
      const futRes = await closeFuturesPositionBySymbol(targetCoin)
      if (futRes.ok) {
        return futRes.message
      }
      // Vadelide yoksa Spot dene
      const spotRes = await sellSpotPositionBySymbol(targetCoin)
      if (spotRes.ok) {
        return spotRes.message
      }
      return `⚠️ <b>${targetCoin}</b> adında açık vadeli veya spot pozisyon bulunamadı.`
    }

    // C) Parametresiz /cik veya /kapat: Açık vadeli pozisyonları kontrol et
    const globCreds = await getServerBinanceGlobal()
    let openPositions: any[] = []
    if (globCreds?.apiKey && globCreds?.apiSecret) {
      try {
        openPositions = (await getFuturesPositions(globCreds.apiKey, globCreds.apiSecret)) || []
      } catch {}
    }

    // Tek bir açık pozisyon varsa doğrudan onu kapat:
    if (openPositions.length === 1) {
      const onlyPos = openPositions[0]
      const res = await closeFuturesPositionBySymbol(onlyPos.symbol)
      return res.message
    }

    // Birden fazla açık pozisyon varsa:
    if (openPositions.length > 1) {
      const coins = openPositions.map((p) => p.symbol.replace(/USDT$/, "")).join(", ")
      return `⚠️ Birden fazla açık pozisyon var (${coins}).\n` +
        `• Hepsinden çıkmak için: <code>/cik hepsi</code>\n` +
        `• Belirli bir coinden çıkmak için: <code>/cik PEPE</code> veya <code>/cik SOL</code>`
    }

    // Vadeli açık pozisyon yoksa spot pozisyonları kontrol et:
    const state = await getFullServerState()
    const spotPos = state.positions || []
    if (spotPos.length === 1) {
      const res = await sellSpotPositionBySymbol(spotPos[0].symbol)
      return res.message
    } else if (spotPos.length > 1) {
      return `⚠️ Birden fazla spot pozisyon var. Hepsinden çıkmak için: <code>/cik hepsi</code>`
    }

    return "ℹ️ Şu anda açık vadeli veya spot pozisyon bulunmuyor."
  }

  // 9. /tara | /snipe
  if (c === "tara" || c === "snipe") {
    fetch("https://frborsam.vercel.app/api/bot/cron?snipe=1").catch(() => {})
    return `🎯 <b>Piyasa taraması başlatıldı!</b> Bot hem Spot hem Vadeli piyasaları tarayarak en güçlü formasyonları denetliyor.`
  }

  // 10. /durdur | /pause | /stop
  if (c === "durdur" || c === "pause" || c === "stop") {
    await setServerActive(false)
    return `⏸️ <b>Bot durduruldu!</b> Yeni pozisyon alımları kapatıldı. Açık pozisyonlar ve stop kuralları korunmaya devam ediyor.`
  }

  // 11. /baslat | /startbot | /resume
  if (c === "baslat" || c === "startbot" || c === "resume") {
    await setServerActive(true)
    return `▶️ <b>Bot aktif edildi!</b> 7/24 piyasa takibi, fırsat taraması ve otomatik kâr alma sistemi devrede.`
  }

  // 12. /slot <N>
  if (c === "slot") {
    const n = parseInt(args[0], 10)
    if (n >= 1 && n <= 3) {
      const mode = n === 1 ? "fixed_1" : n === 3 ? "fixed_3" : "hybrid_2_slot"
      const desc =
        n === 1
          ? "🎯 Tek Slot Odak Modu: Tüm sermaye tek bir yüksek potansiyelli coinde toplanır."
          : n === 3
          ? "🌐 3 Slot Geniş Portföy: Risk 3 farklı varlığa dağıtılır."
          : "🛡️ 2 Slot Dengeli Hibrit Kasa: Biri düşerken diğeri portföyü tutan, Meme + DeFi dengesi."
      await setServerSlotConfig({ targetSlots: n, maxSlots: n, mode: mode as any, description: desc })
      return `⚙️ <b>Kasa Slot Ayarı Güncellendi:</b> ${n} Slot moduna geçildi.`
    }
    return "⚠️ Geçerli bir slot sayısı girin: <code>/slot 1</code>, <code>/slot 2</code> veya <code>/slot 3</code>"
  }

  // 13. /gelistir <talimat> | /gorev <talimat>
  if (c === "gelistir" || c === "geliştir" || c === "gorev" || c === "görev") {
    const taskDesc = args.join(" ").trim()
    if (!taskDesc) {
      return "⚠️ Lütfen geliştirilmesini istediğin özelliği yaz.\nÖrnek: <code>/gelistir Pepe kâr hedefini %10 yap</code>\nÖrnek: <code>/gorev Terminale RSI 14 grafiği ekle</code>"
    }
    const t = await appendDevTask(taskDesc)
    return `🛠️ <b>Geliştirme Görevi Sisteme Kaydedildi!</b>\n\n` +
      `📋 <b>Talimat:</b> ${taskDesc}\n` +
      `🆔 <b>ID:</b> <code>${t.id}</code>\n\n` +
      `💡 <i>Antigravity IDE'ye geçtiğinde "Telegram görevlerini yap" dediğin anda bu geliştirme projeye kodlanıp yayına alınacaktır.</i>`
  }

  // 14. /gorevler | /görevler | /gelistirmeler
  if (c === "gorevler" || c === "görevler" || c === "gelistirmeler") {
    const tasks = await getDevTasks()
    if (tasks.length === 0) {
      return "📋 Bekleyen bir geliştirme görevi bulunmuyor. Yeni eklemek için: <code>/gelistir &lt;istek&gt;</code>"
    }
    let msg = `📋 <b>BEKLEYEN GELİŞTİRME GÖREVLERİ (${tasks.length})</b>\n\n`
    for (const t of tasks.slice(0, 10)) {
      const timeStr = new Date(t.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
      const statusIcon = t.status === "completed" ? "✅" : t.status === "in_progress" ? "⏳" : "📌"
      msg += `${statusIcon} <b>${t.task}</b>\n` +
        `   └ <i>${timeStr} (${t.status})</i>\n\n`
    }
    return msg
  }

  return null
}

// ── TELEGRAM WEBHOOK HANDLER ──
export async function POST(req: NextRequest) {
  try {
    const update = await req.json().catch(() => null)
    if (!update || !update.message) {
      return NextResponse.json({ ok: true, note: "no message" })
    }

    const message = update.message
    const userText: string = (message.text || "").trim()
    const senderChatId = String(message.chat?.id || "")

    if (!userText) {
      return NextResponse.json({ ok: true, note: "empty text" })
    }

    const config = await getTelegramConfig()
    if (!config?.botToken) {
      return NextResponse.json({ ok: false, error: "no bot token" })
    }

    // Güvenlik kontrolü
    const isOwner = !config.chatId || config.chatId === senderChatId

    // ── Hızlı Komut ve Doğrudan Eylem Kontrolü (Sıfır Gecikme) ──
    const tokens = userText.split(/\s+/)
    const firstWord = tokens[0].toLowerCase().replace(/^\//, "")
    const fullNormalized = userText.toLowerCase().replace(/[^a-z0-9ğüşıöç\s]/gi, " ").trim()

    // 1. Doğrudan Komutlar veya Tek Kelimelik Tetikleyiciler
    const directKeywords = [
      "durum", "vadeli", "futures", "pepe", "1000pepe", "kasa", "bakiye",
      "yardim", "yardım", "komutlar", "help", "tara", "snipe",
      "long", "kapat", "sat", "cik", "çık", "cikis", "çıkış",
      "al", "gir", "slottan_al", "slottanal", "durdur", "baslat", "başlat", "slot"
    ]

    if (tokens[0].startsWith("/") || directKeywords.includes(firstWord)) {
      const directResponse = await handleDirectCommand(tokens[0], tokens.slice(1))
      if (directResponse) {
        await sendTelegramMessage(directResponse, {
          botToken: config.botToken,
          chatId: senderChatId,
        })
        return NextResponse.json({ ok: true, direct: true })
      }
    }

    // 2. Doğal Dil Eylemleri ("çık", "pepeden çık", "hepsinden çık", "slottan al", "al bana bir coin")
    if (fullNormalized === "cik" || fullNormalized === "çık" || fullNormalized.includes("hepsinden cik") || fullNormalized.includes("hepsinden çık") || fullNormalized.includes("tumunu kapat") || fullNormalized.includes("tümünü kapat")) {
      const allRes = await closeAllPositions()
      await sendTelegramMessage(allRes.message, { botToken: config.botToken, chatId: senderChatId })
      return NextResponse.json({ ok: true, directAction: "CLOSE_ALL" })
    }

    if (fullNormalized.includes("pepeden cik") || fullNormalized.includes("pepeden çık") || fullNormalized.includes("pepe kapat") || fullNormalized.includes("pepeyi kapat") || fullNormalized.includes("pepe sat") || fullNormalized.includes("pepeyi sat")) {
      const res = await closeFuturesPositionBySymbol("PEPE")
      await sendTelegramMessage(res.message, { botToken: config.botToken, chatId: senderChatId })
      return NextResponse.json({ ok: true, directAction: "CLOSE_PEPE" })
    }

    if (fullNormalized === "al" || fullNormalized === "slottan al" || fullNormalized === "slot al" || fullNormalized === "en iyi coini al" || fullNormalized === "gir") {
      const bestRes = await buyBestCoinFutures()
      await sendTelegramMessage(bestRes.message, { botToken: config.botToken, chatId: senderChatId })
      return NextResponse.json({ ok: true, directAction: "BUY_BEST_COIN" })
    }

    // ── Canlı Spot ve Vadeli Durumu Çek ──
    const [state, globCreds, usdtRate] = await Promise.all([
      getFullServerState(),
      getServerBinanceGlobal(),
      getUsdtTryRate(),
    ])

    // Spot Kasa
    let realTryBalance = state.balance || 0
    if (state.binance?.apiKey && state.binance?.apiSecret) {
      try {
        const b = await getSpotAccountAssets(state.binance.apiKey, state.binance.apiSecret)
        realTryBalance = b.freeTry || 0
      } catch {
        realTryBalance = state.binance?.realBalanceTry || state.balance || 0
      }
    }

    const spotPositions = state.positions || []
    const spotContext = spotPositions.length > 0
      ? spotPositions.map((p: any) => {
          const sym = p.symbol === "RE" ? "RENDER" : p.symbol
          return `[SPOT] ${sym}: Giriş=${p.entryPrice} ₺, Anlık=${p.currentPrice?.toFixed(4)} ₺, K/Z=%${(p.pnlPercent || 0).toFixed(2)} (${(p.pnl || 0).toFixed(2)} ₺)`
        }).join("\n")
      : "Açık spot pozisyon yok."

    // Vadeli Kasa ve Pozisyonlar
    let futPositions: any[] = []
    let futBal: any = null
    if (globCreds?.apiKey && globCreds?.apiSecret) {
      try {
        futPositions = await getFuturesPositions(globCreds.apiKey, globCreds.apiSecret)
        futBal = await getFuturesAccountBalance(globCreds.apiKey, globCreds.apiSecret)
      } catch (err: any) {
        console.warn("[Telegram Futures Fetch Error]", err?.message || err)
      }
    }

    const futContext = futPositions.length > 0
      ? futPositions.map((fp: any) => {
          const rawGain = fp.entryPrice > 0 ? (((fp.markPrice - fp.entryPrice) / fp.entryPrice) * 100) : 0
          const roi = rawGain * fp.leverage
          const isPepe = fp.symbol.includes("PEPE")
          const pepeExtra = isPepe ? " (ÖZEL KURAL: Hedef %8 Ham / %80 ROI, SL Yok, %5 sonrası %4.5 Kâr Stopu)" : ""
          return `[FUTURES] ${fp.symbol} (${fp.leverage}x Kaldıraç): Giriş=$${fp.entryPrice}, Mark=$${fp.markPrice}, Ham=%${rawGain.toFixed(2)}, ROI=%${roi.toFixed(2)}, Kâr=$${(fp.unRealizedProfit || 0).toFixed(2)}${pepeExtra}`
        }).join("\n")
      : "Açık vadeli pozisyon yok."

    const totalEquityTry = realTryBalance + ((futBal?.totalWalletBalanceUsdt || 0) * usdtRate)

    // ── Doğal Dil & Yapay Zekâ Yanıtı (Gemini) ──
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ""

    const pendingLimitOrdersTelegram = await getPendingLimitOrders().catch(() => [])
    const firstFutOrder = pendingLimitOrdersTelegram.find(
      (o) => o.exchange === "BINANCE_GLOBAL_FUTURES" && o.side === "BUY"
    )
    const nextCandTelegram = firstFutOrder?.symbol || null
    const nextLevTelegram = firstFutOrder?.leverage || 5

    const systemPrompt = `Sen kullanıcının kişisel kripto işlem ortağı, tecrübeli trader dostu ve bot operatörüsün.
Kullanıcı seninle konuştuğunda bürokratik, soğuk devlet dairesi ağzıyla ("Bilgi alınmıştır", "Sistem mimarimize teyit edilmiştir", "Başka bir talimatınız var mı") KESİNLİKLE KONUŞMA!
Sen gerçek bir masa arkadaşısın: Dobra, cana yakın ("kanka", "dostum" diyen), ne yaptığını anlık bilen, piyasa koklayan canlı bir tradersın.

CANLI KASA VE PORTFÖY DURUMU:
- Binance TR Spot Serbest Nakit: ${realTryBalance.toFixed(2)} ₺
- Binance Global Vadeli Cüzdan: $${(futBal?.totalWalletBalanceUsdt || 0).toFixed(2)} USDT (~${((futBal?.totalWalletBalanceUsdt || 0) * usdtRate).toFixed(2)} ₺)
- Dolar Kuru (USDT/TRY): ${usdtRate.toFixed(2)} ₺
- Toplam Varlık Değeri: ~${totalEquityTry.toFixed(2)} ₺
- Bot Durumu: ${state.active ? "Aktif (7/24 Piyasa Taramasında)" : "Durduruldu"}
- Kasa Slotu: ${state.slotConfig?.targetSlots || 2} Slot
- Pusuya Yatan / Sıradaki Futures Adayı: ${nextCandTelegram ? `${nextCandTelegram} (${nextLevTelegram}x kaldıraç ile limit emrinde pusu bekliyor)` : "Pusuda bekleyen yeni aday yok, tarama devam ediyor."}

AÇIK VADELİ (FUTURES) POZİSYONLAR:
${futContext}

AÇIK SPOT POZİSYONLAR:
${spotContext}

PEPE ÖZEL KURALI:
- PEPE (1000PEPE) için hedef: Ham fiyat artışı %8.00 (10x kaldıraçta net %80.00 ROI). Hedefe ulaştığında %100 tam satışla kâr kilitlenir. Kademeli satış kapalıdır.
- Zararına stop-loss PEPE için yoktur. Fiyat %5 kârı geçerse +%4.5 seviyesine kâr koruma stopu konur.

ÖNEMLİ KURALLAR:
1. Kullanıcı kaldıraç veya vadeli işlem sorduğunda, yukarıdaki Binance Global cüzdanını ($${(futBal?.totalWalletBalanceUsdt || 0).toFixed(2)} USDT) ve açık vadeli pozisyonları doğrudan net rakamlarla anlat!
2. Kullanıcı "fırsat arıyor mu / ne yapıyor" dediğinde, neyi beklediğini (RSI dip teyidi, dip dönüş mumu, best-bid limit emri) bir trader gibi somut ve net anlat.
3. Asla boş laf yapma, her cevabın gerçek bir işlem aksiyonu hissettirsin.

TAM YETKİLİ KOMUT AKSİYONLARIN (Kullanıcı bir işlem talep ettiğinde cevabının en sonuna uygun etiketi ekle):
- "Çık", "kapat", "pozisyondan çık", "slottan çık", "hepsinden çık" dediyse: [ACTION:CLOSE_ALL]
- Belirli bir vadeli pozisyonu kapat dediyse (Örn: PEPE'yi kapat): [ACTION:CLOSE_FUTURES:PEPE]
- "Al", "slottan al", "en iyi coini al", "bir şey al" dediyse: [ACTION:BUY_BEST_COIN]
- Belirli bir coini vadeli al / long aç dediyse (Örn: SOL al, DOGE long): [ACTION:BUY_FUTURES:SOL:10x]
- Spot coini sat dediyse (Örn: ETH'yi sat): [ACTION:SELL_COIN:ETH]
- Tüm spotu acil sat dediyse: [ACTION:EMERGENCY_SELL]
- Piyasa tara / fırsat ara dediyse: [ACTION:SCAN_MARKET]
- Slot sayısını değiştir dediyse: [ACTION:SET_SLOT:1], [ACTION:SET_SLOT:2], [ACTION:SET_SLOT:3]
- Botu durdur dediyse: [ACTION:PAUSE_BOT]
- Botu başlat dediyse: [ACTION:RESUME_BOT]
- Bir not/görev kaydet dediyse: [ACTION:ADD_DEV_TASK:özet]`

    let reply = await callGeminiForTelegram(geminiKey, systemPrompt, userText)

    if (reply) {
      if (isOwner) {
        reply = await executeAgentAction(reply)
      } else {
        reply = reply.replace(/\[ACTION:.*?\]/g, "").trim()
      }
      reply = reply.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    } else {
      reply = `Kanka mesajını aldım! Anlık kasamızda <b>${realTryBalance.toFixed(2)} ₺</b> spot ve <b>$${(futBal?.totalWalletBalanceUsdt || 0).toFixed(2)} USDT</b> vadeli varlık var.\n\n` +
        `Açık Vadeli: ${futContext}\n` +
        `Komut listesi için /yardim yazabilirsin!`
    }

    // ── Telegram'a Mesajı Gönder ──
    await sendTelegramMessage(reply, {
      botToken: config.botToken,
      chatId: senderChatId,
    })

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error("[Telegram Webhook Error]", error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 200 })
  }
}

// ── GET HANDLER: Webhook Kurulumu ve Bilgi ──
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get("action")
  const config = await getTelegramConfig()

  if (!config?.botToken) {
    return NextResponse.json({ error: "Telegram bot token bulunamadı" }, { status: 400 })
  }

  const webhookUrl = `${url.origin}/api/telegram/webhook`

  if (action === "register" || action === "set") {
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`)
      const data = await res.json()
      return NextResponse.json({ success: true, webhookUrl, telegramResponse: data })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/getWebhookInfo`)
    const info = await res.json()
    return NextResponse.json({ webhookUrl, webhookInfo: info })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
