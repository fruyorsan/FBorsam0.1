/**
 * lib/telegram.ts
 * Pundik Telegram Bildirim & Günlük Kâr Raporlama Motoru
 * Upstash Redis veya process.env üzerinden Telegram Bot yapılandırması.
 */

import {
  getServerHistory,
  getServerBalance,
  getDailyLoss,
  getServerPositions,
} from "./bot/server-state"
import type { Position } from "./bot/engine"

export interface TelegramConfig {
  botToken: string
  chatId: string
  enabled: boolean
  notifyOnBuy?: boolean
  notifyOnSell?: boolean
}

// In-memory fallback
let _memTelegramConfig: TelegramConfig | null = null

const REDIS_TELEGRAM_KEY = "bot:telegram:config"

/**
 * Upstash Redis komut çalıştırıcı (server-state ile aynı)
 */
async function redisCmd(...args: (string | number)[]): Promise<any> {
  const rawUrl = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!rawUrl || !token) return null
  const url = rawUrl.replace(/\/+$/, "")
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    })
    if (!res.ok) return null
    const json = await res.json()
    return json.result
  } catch {
    return null
  }
}

/**
 * Telegram yapılandırmasını oku
 */
export async function getTelegramConfig(): Promise<TelegramConfig | null> {
  // 1. Redis'ten kontrol et
  try {
    const raw = await redisCmd("GET", REDIS_TELEGRAM_KEY)
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
      if (parsed?.botToken && parsed?.chatId) {
        return parsed as TelegramConfig
      }
    }
  } catch {}

  // 2. Env fallback
  const envToken = process.env.TELEGRAM_BOT_TOKEN
  const envChatId = process.env.TELEGRAM_CHAT_ID
  if (envToken && envChatId) {
    return {
      botToken: envToken,
      chatId: envChatId,
      enabled: true,
      notifyOnBuy: true,
      notifyOnSell: true,
    }
  }

  return _memTelegramConfig
}

/**
 * Telegram yapılandırmasını kaydet
 */
export async function setTelegramConfig(config: Partial<TelegramConfig>): Promise<TelegramConfig> {
  const current = (await getTelegramConfig()) || {
    botToken: "",
    chatId: "",
    enabled: true,
    notifyOnBuy: true,
    notifyOnSell: true,
  }

  const updated: TelegramConfig = {
    ...current,
    ...config,
    botToken: (config.botToken ?? current.botToken).trim(),
    chatId: (config.chatId ?? current.chatId).trim(),
    enabled: config.enabled ?? current.enabled ?? true,
    notifyOnBuy: config.notifyOnBuy ?? current.notifyOnBuy ?? true,
    notifyOnSell: config.notifyOnSell ?? current.notifyOnSell ?? true,
  }

  _memTelegramConfig = updated
  try {
    await redisCmd("SET", REDIS_TELEGRAM_KEY, JSON.stringify(updated), "EX", 2592000)
  } catch {}

  return updated
}

/**
 * Telegram API üzerinden mesaj gönder
 */
export async function sendTelegramMessage(
  text: string,
  customConfig?: { botToken?: string; chatId?: string; pin?: boolean }
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  try {
    const config = (await getTelegramConfig()) || null
    const token = customConfig?.botToken || config?.botToken
    const chatId = customConfig?.chatId || config?.chatId

    if (!token || !chatId) {
      return { ok: false, error: "Telegram Bot Token veya Chat ID eksik" }
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`

    const sendAttempt = async (useHtml: boolean) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 6000)
      try {
        const payload: Record<string, any> = {
          chat_id: chatId,
          text: useHtml ? text : text.replace(/<[^>]*>/g, ""),
          disable_web_page_preview: true,
        }
        if (useHtml) {
          payload.parse_mode = "HTML"
        }
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => null)
        return { res, data }
      } finally {
        clearTimeout(timeout)
      }
    }

    // İlk deneme: HTML modunda gönder
    let { res, data } = await sendAttempt(true)

    // Eğer HTML parse hatası verirse, HTML taglerini temizleyip düz metin olarak tekrar dene
    if (!res.ok && data?.description && data.description.includes("can't parse entities")) {
      const fallback = await sendAttempt(false)
      res = fallback.res
      data = fallback.data
    }

    // Geçici ağ hatası durumunda 1 saniye sonra 1 kez daha dene
    if (!res.ok && res.status >= 500) {
      await new Promise(r => setTimeout(r, 1000))
      const retry = await sendAttempt(true)
      res = retry.res
      data = retry.data
    }

    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.description || `HTTP ${res.status}` }
    }

    // İsteğe bağlı: Mesajı Telegram sohbetinde sabitle (pin)
    if (customConfig?.pin && data?.result?.message_id) {
      try {
        await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: data.result.message_id,
            disable_notification: false,
          }),
        })
      } catch {}
    }

    return { ok: true, messageId: data?.result?.message_id }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) }
  }
}

/**
 * Bugünün kâr / zarar istatistiklerini hesapla
 */
export async function calculateTodayStats() {
  const [history, balance, dailyLoss, positions] = await Promise.all([
    getServerHistory(),
    getServerBalance(),
    getDailyLoss(),
    getServerPositions(),
  ])

  // Bugünün Türkiye saatiyle tarihi (YYYY-MM-DD)
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())

  // Bugün kapanan işlemler
  const todayClosed = history.filter((p) => {
    if (!p.openedTimestamp) return false
    const posDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(p.openedTimestamp))
    return posDate === todayStr && p.status === "CLOSED"
  })

  let totalNetPnlTry = 0
  let wins = 0
  let losses = 0

  for (const pos of todayClosed) {
    const pnl = pos.netPnlTry ?? pos.pnl ?? 0
    totalNetPnlTry += pnl
    if (pnl > 0.05) {
      wins++
    } else if (pnl < -0.05) {
      losses++
    }
  }

  const totalTrades = todayClosed.length
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0
  const startBalance = dailyLoss.startBalance > 0 ? dailyLoss.startBalance : balance
  const dailyReturnPct = startBalance > 0 ? (totalNetPnlTry / startBalance) * 100 : 0

  return {
    todayStr,
    totalTrades,
    wins,
    losses,
    winRate: Number(winRate.toFixed(1)),
    totalNetPnlTry: Number(totalNetPnlTry.toFixed(2)),
    dailyReturnPct: Number(dailyReturnPct.toFixed(2)),
    currentBalance: Number(balance.toFixed(2)),
    openPositionsCount: positions.length,
  }
}

/**
 * Günlük Seans Raporunu Telegram'a gönder
 */
export async function sendTelegramDailySummary(customConfig?: { botToken?: string; chatId?: string }): Promise<{ ok: boolean; error?: string }> {
  const stats = await calculateTodayStats()
  const sign = stats.totalNetPnlTry >= 0 ? "+" : ""
  const pctSign = stats.dailyReturnPct >= 0 ? "+" : ""
  const emoji = stats.totalNetPnlTry >= 0 ? "🟢" : "🔴"

  const message = `🤖 <b>[Pundik Günlük Seans Bülteni]</b> 📊
📅 <b>Tarih:</b> ${stats.todayStr}

🎯 <b>Bugün Kapanan İşlem:</b> ${stats.totalTrades} adet
✅ <b>Kârla Kapanan:</b> ${stats.wins}
❌ <b>Zarar / Stop:</b> ${stats.losses}
🏆 <b>Kazanma Oranı (Win Rate):</b> %${stats.winRate}

${emoji} <b>Günlük Net Kâr:</b> <code>${sign}${stats.totalNetPnlTry} TL</code>
📈 <b>Günlük Yüzdelik Kâr:</b> <code>${pctSign}%${stats.dailyReturnPct}</code>
🏦 <b>Güncel Kasa Bakiyesi:</b> <code>${stats.currentBalance} TL</code>
💼 <b>Açık İşlem Sayısı:</b> ${stats.openPositionsCount} adet

<i>"Disiplinle kasayı büyütmeye devam patron! 🚀"</i>`

  return sendTelegramMessage(message, customConfig)
}

function formatCurrency(p: number): string {
  if (!p || isNaN(p)) return "0.00 ₺"
  if (p < 0.001) {
    return `${p.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} ₺`
  }
  if (p < 1) {
    return `${p.toFixed(4)} ₺`
  }
  if (p >= 1000) {
    return `${p.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`
  }
  return `${p.toFixed(2)} ₺`
}

/**
 * Yeni Alım İşlemi Bildirimi Gönder (Kilit Ekranı Uyumlu)
 */
export async function notifyTradeEntry(pos: Position, reason?: string): Promise<void> {
  const config = await getTelegramConfig()
  if (!config || !config.enabled || config.notifyOnBuy === false) return

  const entryStr = formatCurrency(pos.entryPrice || 0)
  const tpStr = formatCurrency(pos.takeProfitPrice || 0)
  const slStr = formatCurrency(pos.stopLossPrice || 0)
  const totalStr = (pos.totalTry ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const whaleIcon = pos.isMegaWhale ? " 🚀 [Mega Balina]" : pos.isWhale ? " 🐋 [Balina]" : ""

  const message = `🟢 <b>YENİ ALIM: ${pos.symbol} / TRY${whaleIcon}</b>
━━━━━━━━━━━━━━━━━━
💵 <b>Tutar:</b> <code>${totalStr} TL</code>
📥 <b>Alış Fiyatı:</b> <code>${entryStr}</code>
🎯 <b>Hedef Kâr (TP):</b> <code>${tpStr}</code>
🛡️ <b>Koruma (SL):</b> <code>${slStr}</code>
${reason ? `💡 <b>Gerekçe:</b> <i>${reason}</i>` : ""}`

  await sendTelegramMessage(message)
}

/**
 * 1. Kademe Kısmi Kâr Bildirimi Gönder (%50 Kâr Satışı - Kilit Ekranında 1 Saniyede Anlaşılır)
 */
export async function notifyPartialExit(
  pos: Position,
  gainedTry: number,
  pnlPct: number,
  newBalance?: number
): Promise<void> {
  const config = await getTelegramConfig()
  if (!config || !config.enabled || config.notifyOnSell === false) return

  const sign = gainedTry >= 0 ? "+" : ""
  const pctSign = pnlPct >= 0 ? "+" : ""
  const exitStr = formatCurrency(pos.partialSoldPrice || pos.currentPrice || 0)
  const entryStr = formatCurrency(pos.entryPrice || 0)
  const slStr = formatCurrency(pos.stopLossPrice || 0)
  const tpStr = formatCurrency(pos.takeProfitPrice || 0)

  const message = `🎯 <b>KÂR ALINDI (%50): ${pos.symbol} / TRY</b>
━━━━━━━━━━━━━━━━━━
💰 <b>Net Kâr:</b> <code>${sign}${gainedTry.toFixed(2)} TL (${pctSign}%${pnlPct.toFixed(2)})</code>
💵 <b>Çıkış Fiyatı:</b> <code>${exitStr}</code>
📥 <b>Giriş Fiyatı:</b> <code>${entryStr}</code>
━━━━━━━━━━━━━━━━━━
🛡️ <b>Kalan %50 Pozisyon:</b>
Stop-Loss <code>${slStr}</code> seviyesine kilitlendi. Kalan miktar sıfır riskle tavan hedefine (<code>${tpStr}</code>) koşuyor! 🚀${
    typeof newBalance === "number"
      ? `\n━━━━━━━━━━━━━━━━━━\n🏦 <b>Güncel Kasa:</b> <code>${newBalance.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL</code>`
      : ""
  }`

  await sendTelegramMessage(message)
}

/**
 * Pozisyon Kapanış Bildirimi Gönder (Kısa, Net, Kilit Ekranında Tek Bakışta Anlaşılır)
 */
export async function notifyTradeExit(
  pos: Position,
  reason: string,
  newBalance?: number
): Promise<void> {
  const config = await getTelegramConfig()
  if (!config || !config.enabled || config.notifyOnSell === false) return

  const pnl = pos.netPnlTry ?? pos.pnl ?? 0
  const pnlPct = pos.pnlPercent ?? 0
  const isWin = pnl >= 0
  const emoji = isWin ? "🎯" : "🛑"
  const title = isWin ? "KÂRLA KAPANDI" : "STOP-LOSS ÇIKIŞI"
  const sign = pnl >= 0 ? "+" : ""
  const pctSign = pnlPct >= 0 ? "+" : ""
  const exitStr = formatCurrency(pos.closePrice || pos.currentPrice || 0)
  const entryStr = formatCurrency(pos.entryPrice || 0)

  const message = `${emoji} <b>${title}: ${pos.symbol} / TRY</b>
━━━━━━━━━━━━━━━━━━
${isWin ? "💰" : "📉"} <b>Net Sonuç:</b> <code>${sign}${pnl.toFixed(2)} TL (${pctSign}%${pnlPct.toFixed(2)})</code>
🏷️ <b>Çıkış Fiyatı:</b> <code>${exitStr}</code>
📥 <b>Giriş Fiyatı:</b> <code>${entryStr}</code>
📝 <b>Neden:</b> <i>${reason}</i>
━━━━━━━━━━━━━━━━━━
${typeof newBalance === "number" ? `🏦 <b>Güncel Kasa:</b> <code>${newBalance.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL</code>` : ""}`

  await sendTelegramMessage(message)
}

// Akıllı fiyat formatlayıcı (Meme coinler vs.)
function fmtSmartFuturesPrice(price: number): string {
  if (!price || isNaN(price) || price <= 0) return "0.00"
  if (price < 0.0001) return price.toFixed(8)
  if (price < 0.01) return price.toFixed(6)
  if (price < 1) return price.toFixed(4)
  return price.toFixed(2)
}

let cachedTelegramUsdtTry: { rate: number; updatedAt: number } | null = null
async function getTelegramUsdtTry(): Promise<number> {
  const now = Date.now()
  if (cachedTelegramUsdtTry && now - cachedTelegramUsdtTry.updatedAt < 60 * 1000) {
    return cachedTelegramUsdtTry.rate
  }
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=USDTTRY", {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    })
    const json = await res.json()
    const rate = parseFloat(json?.price)
    if (rate > 0) {
      cachedTelegramUsdtTry = { rate, updatedAt: now }
      return rate
    }
  } catch {}
  return cachedTelegramUsdtTry?.rate ?? 49.14
}

function fmtUsdtPnlWithTry(pnl: number, rate: number): string {
  const sign = pnl >= 0 ? "+" : ""
  const abs = Math.abs(pnl)
  const valStr = abs < 0.1 && abs > 0 ? pnl.toFixed(4) : pnl.toFixed(2)
  const tryVal = pnl * rate
  const tryStr = tryVal.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${sign}${valStr} USDT (≈ ${sign}${tryStr} ₺)`
}

/**
 * Binance Global Futures Yeni Alım Bildirimi
 */
export async function notifyFuturesTradeEntry(params: {
  symbol: string
  leverage: number
  entryPrice: number
  marginUsdt: number
  reason?: string
}): Promise<void> {
  const config = await getTelegramConfig()
  if (!config || !config.enabled || config.notifyOnBuy === false) return

  const clean = params.symbol.replace(/USDT$/i, "").toUpperCase()
  const tp1P = fmtSmartFuturesPrice(params.entryPrice * 1.015)
  const tp2P = fmtSmartFuturesPrice(params.entryPrice * 1.03)
  const slP = fmtSmartFuturesPrice(params.entryPrice * (1 - 0.018))
  const entryP = fmtSmartFuturesPrice(params.entryPrice)
  const tryRate = await getTelegramUsdtTry()
  const marginTry = (params.marginUsdt * tryRate).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const message = `⚡ <b>YENİ KALDIRAÇLI İŞLEM: ${clean} / USDT (${params.leverage}x Long)</b>
━━━━━━━━━━━━━━━━━━
🌐 <b>Borsa:</b> Binance Global Futures
💵 <b>Kullanılan Marjin:</b> <code>${params.marginUsdt.toFixed(2)} USDT (≈ ${marginTry} ₺)</code>
📥 <b>Giriş Fiyatı:</b> <code>$${entryP}</code>
🎯 <b>TP1 (+%1.5):</b> <code>$${tp1P} (+%${(1.5 * params.leverage).toFixed(1)} ROI)</code>
🚀 <b>TP2 (+%3.0):</b> <code>$${tp2P} (+%${(3.0 * params.leverage).toFixed(1)} ROI)</code>
🛡️ <b>Stop Loss (-%1.8):</b> <code>$${slP} (-%${(1.8 * params.leverage).toFixed(1)} ROI)</code>
${params.reason ? `💡 <b>Strateji:</b> <i>${params.reason}</i>` : ""}`

  await sendTelegramMessage(message)
}

/**
 * Binance Global Futures Kısmi Kâr Bildirimi (TP1 - %50 Satış)
 */
export async function notifyFuturesPartialExit(params: {
  symbol: string
  leverage: number
  pnlUsdt: number
  leveragedRoiPct: number
  exitPrice: number
  entryPrice: number
}): Promise<void> {
  const config = await getTelegramConfig()
  if (!config || !config.enabled || config.notifyOnSell === false) return

  const clean = params.symbol.replace(/USDT$/i, "").toUpperCase()
  const tryRate = await getTelegramUsdtTry()
  const pnlDisplay = fmtUsdtPnlWithTry(params.pnlUsdt, tryRate)

  const message = `🎯 <b>FUTURES KÂR ALINDI (TP1): ${clean} / USDT</b>
━━━━━━━━━━━━━━━━━━
🌐 <b>Borsa:</b> Binance Global Futures (${params.leverage}x)
💰 <b>Gerçekleşen Kâr (%50):</b> <code>${pnlDisplay} (+%${params.leveragedRoiPct.toFixed(2)} ROI)</code>
🏷️ <b>Satış Fiyatı:</b> <code>$${fmtSmartFuturesPrice(params.exitPrice)}</code>
📥 <b>Giriş Fiyatı:</b> <code>$${fmtSmartFuturesPrice(params.entryPrice)}</code>
━━━━━━━━━━━━━━━━━━
🛡️ <b>Sıfır Risk Güvencesi:</b>
Kalan %50 pozisyonun stopu başabaşa (giriş fiyatına) kilitlendi. Kâr cepte, kalan miktar dev TP2 hedefine koşuyor! 🚀`

  await sendTelegramMessage(message)
}

/**
 * Binance Global Futures Tam Kapanış Bildirimi (TP2, Trailing Stop, Breakeven, SL)
 */
export async function notifyFuturesTradeExit(params: {
  symbol: string
  leverage: number
  pnlUsdt: number
  leveragedRoiPct: number
  exitPrice: number
  entryPrice: number
  reason: string
  newBalanceUsdt?: number
}): Promise<void> {
  const config = await getTelegramConfig()
  if (!config || !config.enabled || config.notifyOnSell === false) return

  const clean = params.symbol.replace(/USDT$/i, "").toUpperCase()
  const isWin = params.leveragedRoiPct >= 0
  const emoji = isWin ? "🎉" : "🛑"
  const title = isWin ? "FUTURES KÂRLA KAPATILDI" : "FUTURES SERMAYE KORUMA STOPU"
  const sign = params.leveragedRoiPct >= 0 ? "+" : ""
  const tryRate = await getTelegramUsdtTry()
  const pnlDisplay = fmtUsdtPnlWithTry(params.pnlUsdt, tryRate)

  const newBalStr = typeof params.newBalanceUsdt === "number"
    ? `🏦 <b>Güncel Vadeli Kasa:</b> <code>${params.newBalanceUsdt.toFixed(2)} USDT (≈ ${(params.newBalanceUsdt * tryRate).toFixed(2)} ₺)</code>`
    : ""

  const message = `${emoji} <b>${title}: ${clean} / USDT</b>
━━━━━━━━━━━━━━━━━━
🌐 <b>Borsa:</b> Binance Global Futures (${params.leverage}x)
${isWin ? "💰" : "📉"} <b>Net Sonuç:</b> <code>${pnlDisplay} (${sign}%${params.leveragedRoiPct.toFixed(2)} ROI)</code>
🏷️ <b>Kapanış Fiyatı:</b> <code>$${fmtSmartFuturesPrice(params.exitPrice)}</code>
📥 <b>Giriş Fiyatı:</b> <code>$${fmtSmartFuturesPrice(params.entryPrice)}</code>
📝 <b>İşlem Nedeni:</b> <i>${params.reason}</i>
━━━━━━━━━━━━━━━━━━
${newBalStr}`

  await sendTelegramMessage(message)
}

/**
 * Proxy Kotası / IP Uyarısı Bildirimi
 * Eğer Webshare proxy kotası biterse veya IP bağlantısı koparsa kullanıcıyı anında uyarır.
 */
let _lastProxyQuotaAlert = 0
export async function notifyProxyQuotaExceeded(errorMsg?: string): Promise<void> {
  const now = Date.now()
  // Kullanıcıyı mesaj yağmuruna tutmamak için 2 saatte bir uyar
  if (now - _lastProxyQuotaAlert < 2 * 60 * 60 * 1000) return
  _lastProxyQuotaAlert = now

  const message = `⚠️ <b>DİKKAT: VADELİ PROXY / IP KOTASI UYARISI!</b>
━━━━━━━━━━━━━━━━━━
🌐 <b>Durum:</b> Binance Global bağlantısı için kullanılan Frankfurt sabit IP proxy kotası tükendi veya bağlantı reddedildi!
📡 <b>Detay:</b> <code>${errorMsg || "Bandwidth limit reached"}</code>

🛠️ <b>Ne Yapılmalı?</b>
Webshare.io paneline girip ücretsiz 1 GB kotayı yenileyebilir veya yeni ücretsiz proxy ekleyebilirsiniz.
(Spot işlemler Binance TR üzerinden direkt çalıştığı için bundan etkilenmez, sadece vadeli alım/satım duraklar).
━━━━━━━━━━━━━━━━━━`

  await sendTelegramMessage(message).catch(() => {})
}
