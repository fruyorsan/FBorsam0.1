/**
 * lib/bot/liquidation-tracker.ts
 * Binance Futures Gerçek Zamanlı Likidasyon Takipçisi (WebSocket + REST Fallback)
 * 
 * - WebSocket Market Stream: wss://fstream.binance.com/ws/!forceOrder@arr
 * - Zorunlu Long Tasfiyeleri (Force Order SELL): Long pozisyon patlayıp borsa tarafından piyasaya satıldı.
 * - Zorunlu Short Tasfiyeleri (Force Order BUY): Short pozisyon patlayıp borsa tarafından piyasadan alındı.
 * - SFP Dip Avcısı teyidi: Dip mumunun fitilinde panik tasfiye satışlarının emildiğini doğrular.
 * - Sıfır Gecikme (0ms in-memory cache) + Otomatik Yeniden Bağlanma (Auto-reconnect).
 */

import { BINANCE_FUTURES_BASE, futuresProxyFetch } from "../binance-helpers"

export interface LiquidationEvent {
  symbol: string
  side: "SELL" | "BUY" // SELL = Long tasfiyesi, BUY = Short tasfiyesi
  price: number
  quantity: number
  notionalUsdt: number
  timestamp: number
}

export interface SymbolLiquidationStats {
  symbol: string
  longLiquidationUsdt: number
  shortLiquidationUsdt: number
  longCount: number
  shortCount: number
  hasLongFlush: boolean
  latestLongLiquidationTime?: number
}

// Global RAM sliding-window tamponu (Son 60 dakika)
const BUFFER_TTL_MS = 60 * 60 * 1000
const _events: LiquidationEvent[] = []
let _ws: any = null
let _wsConnecting = false
let _reconnectTimer: any = null
let _lastWsMessageTime = 0

// REST önbelleği (sembol başına 30 saniye)
const _restCache = new Map<string, { stats: SymbolLiquidationStats; expiresAt: number }>()

function pruneBuffer() {
  const cutoff = Date.now() - BUFFER_TTL_MS
  while (_events.length > 0 && _events[0].timestamp < cutoff) {
    _events.shift()
  }
}

/**
 * WebSocket bağlantısını başlatır veya canlı tutar.
 */
export function ensureLiquidationWebSocket(): void {
  if (typeof globalThis.WebSocket !== "function") return
  if (_ws && (_ws.readyState === 1 || _ws.readyState === 0)) return
  if (_wsConnecting) return

  _wsConnecting = true
  try {
    const wsUrl = "wss://fstream.binance.com/ws/!forceOrder@arr"
    const socket = new globalThis.WebSocket(wsUrl)

    socket.onopen = () => {
      _wsConnecting = false
      _ws = socket
      _lastWsMessageTime = Date.now()
      console.log("[LiquidationTracker] ⚡ Binance forceOrder WebSocket akışı başarıyla bağlandı (!forceOrder@arr).")
    }

    socket.onmessage = (event: any) => {
      _lastWsMessageTime = Date.now()
      try {
        const raw = typeof event.data === "string" ? JSON.parse(event.data) : null
        if (!raw) return
        
        // Tekli veya toplu forceOrder paketi
        const orderData = raw.o || (raw.data && raw.data.o)
        if (!orderData) return

        const symbol = String(orderData.s || "").toUpperCase()
        const side = orderData.S === "SELL" ? "SELL" : "BUY"
        const price = parseFloat(orderData.p) || parseFloat(orderData.ap) || 0
        const qty = parseFloat(orderData.q) || 0
        const notional = price > 0 && qty > 0 ? price * qty : 0
        const timestamp = Number(orderData.T || raw.E || Date.now())

        if (symbol && price > 0) {
          _events.push({
            symbol,
            side,
            price,
            quantity: qty,
            notionalUsdt: notional,
            timestamp,
          })
          pruneBuffer()
        }
      } catch (err: any) {
        // Sessiz hata yönetimi
      }
    }

    socket.onerror = (err: any) => {
      _wsConnecting = false
      // Hata durumunda yeniden bağlanma planla
      scheduleReconnect()
    }

    socket.onclose = () => {
      _wsConnecting = false
      _ws = null
      scheduleReconnect()
    }
  } catch (err: any) {
    _wsConnecting = false
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (_reconnectTimer) return
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null
    ensureLiquidationWebSocket()
  }, 5000)
}

/**
 * REST API üzerinden belirli bir sembolün geçmiş son tasfiyelerini çeker (Fallback).
 */
export async function fetchRecentLiquidationsFromRest(
  symbol: string,
  limit = 50
): Promise<LiquidationEvent[]> {
  const cleanSym = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"
  try {
    const url = `${BINANCE_FUTURES_BASE}/fapi/v1/allForceOrders?symbol=${cleanSym}&limit=${limit}`
    const res = await futuresProxyFetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []

    const parsed: LiquidationEvent[] = []
    const now = Date.now()
    for (const item of data) {
      const side = item.side === "SELL" ? "SELL" : "BUY"
      const price = parseFloat(item.price) || parseFloat(item.avgPrice) || 0
      const qty = parseFloat(item.executedQty) || parseFloat(item.origQty) || 0
      const notional = price * qty
      const timestamp = Number(item.time || now)

      const evt: LiquidationEvent = {
        symbol: cleanSym,
        side,
        price,
        quantity: qty,
        notionalUsdt: notional,
        timestamp,
      }
      parsed.push(evt)
      
      // Bellekte yoksa ekle
      const exists = _events.some(e => e.symbol === cleanSym && e.timestamp === timestamp && Math.abs(e.price - price) < 0.0001)
      if (!exists) {
        _events.push(evt)
      }
    }
    pruneBuffer()
    return parsed
  } catch {
    return []
  }
}

/**
 * Belirli bir zaman penceresindeki (örneğin son 15 dakika) likidasyon istatistiklerini hesaplar.
 */
export async function getSymbolLiquidationStats(
  symbol: string,
  windowMs = 15 * 60 * 1000,
  minFlushThresholdUsdt = 1000
): Promise<SymbolLiquidationStats> {
  const cleanSym = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"
  const now = Date.now()

  // 1. Önce taze REST önbelleğinde var mı bak (30 sn TTL)
  const cached = _restCache.get(cleanSym)
  if (cached && cached.expiresAt > now) {
    return cached.stats
  }

  // WebSocket henüz başlamadıysa arka planda başlat
  ensureLiquidationWebSocket()

  // 2. Bellekteki (WebSocket) kayıtları tara
  const startTime = now - windowMs
  let matching = _events.filter(e => e.symbol === cleanSym && e.timestamp >= startTime)

  // Bellekte hiç kayıt yoksa ve WebSocket boşsa REST'ten tamamla
  if (matching.length === 0) {
    const restEvents = await fetchRecentLiquidationsFromRest(cleanSym, 30)
    matching = restEvents.filter(e => e.timestamp >= startTime)
  }

  let longLiquidationUsdt = 0
  let shortLiquidationUsdt = 0
  let longCount = 0
  let shortCount = 0
  let latestLongLiquidationTime: number | undefined = undefined

  for (const ev of matching) {
    if (ev.side === "SELL") {
      // Long tasfiyesi
      longLiquidationUsdt += ev.notionalUsdt
      longCount++
      if (!latestLongLiquidationTime || ev.timestamp > latestLongLiquidationTime) {
        latestLongLiquidationTime = ev.timestamp
      }
    } else {
      // Short tasfiyesi
      shortLiquidationUsdt += ev.notionalUsdt
      shortCount++
    }
  }

  const hasLongFlush = longCount > 0 && (longLiquidationUsdt >= minFlushThresholdUsdt || longCount >= 2)

  const stats: SymbolLiquidationStats = {
    symbol: cleanSym,
    longLiquidationUsdt: Number(longLiquidationUsdt.toFixed(2)),
    shortLiquidationUsdt: Number(shortLiquidationUsdt.toFixed(2)),
    longCount,
    shortCount,
    hasLongFlush,
    latestLongLiquidationTime,
  }

  _restCache.set(cleanSym, { stats, expiresAt: now + 30 * 1000 })
  return stats
}

/**
 * Belirli bir mum aralığında gerçekleşen Long tasfiyelerini filtreler (SFP mum teyidi için).
 */
export function getCandleLongLiquidations(
  symbol: string,
  candleStartMs: number,
  candleEndMs: number
): { longLiquidationUsdt: number; longCount: number } {
  const cleanSym = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase() + "USDT"
  const matching = _events.filter(
    e => e.symbol === cleanSym && e.side === "SELL" && e.timestamp >= candleStartMs && e.timestamp <= candleEndMs
  )

  const totalUsdt = matching.reduce((sum, e) => sum + e.notionalUsdt, 0)
  return {
    longLiquidationUsdt: Number(totalUsdt.toFixed(2)),
    longCount: matching.length,
  }
}
