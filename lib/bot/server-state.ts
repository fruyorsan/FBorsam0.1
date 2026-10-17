/**
 * lib/bot/server-state.ts
 * Sunucu taraflı bot durumu — Upstash Redis üzerinden kalıcı depolama.
 * Vercel Cron ve UI /api/bot/state endpoint'leri bu modülü kullanır.
 */

import type { Position, BotStrategy, TradeLog, BinanceCredentials } from "./engine"
import { DEFAULT_BOT_STRATEGY } from "./engine"
import { encryptVaultData, decryptVaultData } from "./security-config"

// ── Redis İstemcisi & Akıllı Bellek Kalkanı (Kota Dostu 24/7) ──────────────
const _mem: Record<string, string> = {}
const _memExpire: Record<string, number> = {} // TTL takibi
let _quotaBlockedUntil = 0 // Kota dolduğunda Redis'i darlamayı durduran kalkan
let _lastRedisError: any = null
let _lastRedisOp: any = null

export async function redisCmd(...args: (string | number)[]): Promise<any> {
  const now = Date.now()
  const cmd = String(args[0] || "").toUpperCase()
  if (cmd === "DEL") {
    for (let i = 1; i < args.length; i++) {
      delete _mem[String(args[i])]
      delete _memExpire[String(args[i])]
    }
  }

  if (now < _quotaBlockedUntil) {
    // Kota bloklandı, Redis'e boşuna istek atıp hata alma
    return null
  }

  const rawUrl = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!rawUrl || !token) {
    _lastRedisError = "No env vars"
    return null
  }
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
    _lastRedisOp = { cmd: args[0], key: args[1], status: res.status }
    if (!res.ok) {
      const errText = await res.text()
      _lastRedisError = { cmd: args[0], key: args[1], status: res.status, text: errText }
      
      // Kota dolduysa (429 veya Max Daily Requests) 10 dakika boyunca Redis çağrılarını kes, hafızadan çalış!
      if (res.status === 429 || errText.includes("quota") || errText.includes("limit") || errText.includes("exceeded")) {
        console.warn("[Redis Kota Kalkanı] Günlük kota aşıldı! Sistem 10 dakika boyunca yerel bellekle (RAM) kesintisiz devam ediyor.")
        _quotaBlockedUntil = now + 10 * 60 * 1000
      } else {
        console.error("[Redis CMD Failed]", args[0], args[1], res.status, errText)
      }
      return null
    }
    const json = await res.json()
    return json.result
  } catch (e: any) {
    _lastRedisError = { cmd: args[0], key: args[1], error: e?.message || String(e) }
    console.error("[Redis CMD Error]", args[0], args[1], e)
    return null
  }
}

async function redisGet(key: string): Promise<string | null> {
  const now = Date.now()
  // 1. Önce yerel bellekte taze (son 60 saniyede okunmuş) veri var mı bak -> Redis isteklerini %95 AZALTIR!
  if (_mem[key] !== undefined && _memExpire[key] && now < _memExpire[key]) {
    return _mem[key]
  }

  const rawUrl = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!rawUrl || !token || now < _quotaBlockedUntil) return _mem[key] ?? null

  // 2. Upstash REST Command Array format: POST / with ["GET", key]
  const cmdRes = await redisCmd("GET", key)
  if (cmdRes !== null && cmdRes !== undefined) {
    const val = typeof cmdRes === "string" ? cmdRes : String(cmdRes)
    _mem[key] = val
    _memExpire[key] = now + 60 * 1000 // 60 saniye boyunca hafızada tut
    return val
  }

  // 3. Fallback: GET /get/{key}
  try {
    const url = rawUrl.replace(/\/+$/, "")
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (res.ok) {
      const json = await res.json()
      if (json.result != null) {
        const val = typeof json.result === "string" ? json.result : String(json.result)
        _mem[key] = val
        _memExpire[key] = now + 60 * 1000
        return val
      }
    } else if (res.status === 429) {
      _quotaBlockedUntil = now + 10 * 60 * 1000
    }
  } catch {}

  return _mem[key] ?? null
}

async function redisSet(key: string, value: string): Promise<void> {
  const now = Date.now()
  _mem[key] = value
  _memExpire[key] = now + 60 * 1000 // Belleği hemen güncelle
  
  if (now < _quotaBlockedUntil) return // Kota blokluysa Redis'e yazmayı deneme

  const rawUrl = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!rawUrl || !token) return

  // Upstash REST: POST / with body ["SET", key, value, "EX", 2592000]
  await redisCmd("SET", key, value, "EX", 2592000)
}

async function get<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await redisGet(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch { return fallback }
}

async function set(key: string, value: unknown) {
  await redisSet(key, JSON.stringify(value))
}

// ── Keys ──────────────────────────────────────────────────────
const K = {
  positions: "bot:positions",
  history: "bot:history",
  balance: "bot:balance",
  initialBalance: "bot:initialBalance",
  strategy: "bot:strategy",
  logs: "bot:logs",
  dlStart: "bot:dl:start",
  dlDate: "bot:dl:date",
  active: "bot:active",
  binance: "bot:binance",
  sniperTarget: "bot:sniper_target",
}

// ── Public API ────────────────────────────────────────────────
export async function getServerPositions(): Promise<Position[]> { return get<Position[]>(K.positions, []) }
export async function setServerPositions(v: Position[]) { await set(K.positions, v) }
export async function getServerBalance(): Promise<number> { return get<number>(K.balance, 0) }
export async function setServerBalance(v: number) { await set(K.balance, v) }
export async function getServerInitialBalance(): Promise<number> { return get<number>(K.initialBalance, 0) }
export async function setServerInitialBalance(v: number) { await set(K.initialBalance, v) }
export async function getServerStrategy(): Promise<BotStrategy> {
  const saved = await get<Partial<BotStrategy> | null>(K.strategy, null)
  if (!saved) return DEFAULT_BOT_STRATEGY
  return { ...DEFAULT_BOT_STRATEGY, ...saved }
}
export async function setServerStrategy(v: BotStrategy) { await set(K.strategy, v) }
export async function getServerActive(): Promise<boolean> { return get<boolean>(K.active, true) }
export async function setServerActive(v: boolean) { await set(K.active, v) }
export async function getServerBinance(): Promise<BinanceCredentials | null> {
  // GÜVENLİK: Bu anahtar ASLA GET /api/bot/state üzerinden dışarı verilmez.
  // Yalnızca sunucu içinde çalışan Vercel Cron (7/24 işlem) tarafından okunur.
  const envKey = process.env.BINANCE_TR_API_KEY
  const envSecret = process.env.BINANCE_TR_API_SECRET
  if (envKey && envSecret) {
    return {
      apiKey: envKey,
      apiSecret: envSecret,
      accountName: "Sistem Sahibi (Vercel Env)",
      accountType: "REAL",
      connected: true,
      realBalanceTry: 0,
    }
  }
  const saved = await get<BinanceCredentials | null>("cron:owner_binance", null)
  if (saved && saved.apiKey && saved.apiSecret) {
    return {
      ...saved,
      apiKey: decryptVaultData(saved.apiKey),
      apiSecret: decryptVaultData(saved.apiSecret),
    }
  }
  return null
}

export async function setServerBinance(v: any) {
  // GÜVENLİK: Sadece Vercel Cron'un gece 7/24 işlem yapabilmesi için iç izole anahtarda saklanır.
  // API anahtarı ve secret AES-256-GCM ile şifrelenir.
  if (v && v.apiKey && v.apiSecret) {
    await set("cron:owner_binance", {
      apiKey: encryptVaultData(String(v.apiKey).trim()),
      apiSecret: encryptVaultData(String(v.apiSecret).trim()),
      accountName: v.accountName || "Owner TR",
      accountType: "REAL",
      connected: true,
      realBalanceTry: v.realBalanceTry || 0,
    })
  } else {
    try { await redisCmd("DEL", "cron:owner_binance") } catch {}
  }
  try {
    await redisCmd("DEL", K.binance)
  } catch {}
}

/** 🌐 Binance Global (USDⓈ-M Futures / Kaldıraçlı) Anahtarları */
export async function getServerBinanceGlobal(): Promise<BinanceCredentials | null> {
  const saved = await get<BinanceCredentials | null>("cron:owner_binance_global", null)
  if (saved && saved.apiKey && saved.apiSecret) {
    return {
      ...saved,
      apiKey: decryptVaultData(saved.apiKey),
      apiSecret: decryptVaultData(saved.apiSecret),
    }
  }
  const envKey = process.env.BINANCE_GLOBAL_API_KEY
  const envSecret = process.env.BINANCE_GLOBAL_API_SECRET
  if (envKey && envSecret) {
    return {
      apiKey: envKey,
      apiSecret: envSecret,
      accountName: "Binance Global (Vercel Env)",
      accountType: "REAL",
      exchangeType: "BINANCE_GLOBAL",
      connected: true,
      realBalanceTry: 0,
    }
  }
  return null
}

export async function setServerBinanceGlobal(v: any) {
  if (v && v.apiKey && v.apiSecret) {
    await set("cron:owner_binance_global", {
      apiKey: encryptVaultData(String(v.apiKey).trim()),
      apiSecret: encryptVaultData(String(v.apiSecret).trim()),
      accountName: v.accountName || "Binance Global Futures",
      accountType: "REAL",
      exchangeType: "BINANCE_GLOBAL",
      connected: true,
      realBalanceTry: v.realBalanceTry || 0,
    })
  } else {
    try { await redisCmd("DEL", "cron:owner_binance_global") } catch {}
  }
  try {
    await redisCmd("DEL", "bot:binance_global")
  } catch {}
}

/** 🚀 MEXC Global (USDT-M Futures / Kaldıraçlı) Anahtarları */
export async function getServerMexc(): Promise<BinanceCredentials | null> {
  const envKey = process.env.MEXC_API_KEY
  const envSecret = process.env.MEXC_API_SECRET
  if (envKey && envSecret) {
    return {
      apiKey: envKey,
      apiSecret: envSecret,
      accountName: "MEXC Global (Vercel Env)",
      accountType: "REAL",
      connected: true,
      realBalanceTry: 0,
    }
  }
  const saved = await get<BinanceCredentials | null>("cron:owner_mexc", null)
  if (saved && saved.apiKey && saved.apiSecret) {
    return saved
  }
  return null
}

export async function setServerMexc(v: any) {
  if (v && v.apiKey && v.apiSecret) {
    await set("cron:owner_mexc", {
      apiKey: String(v.apiKey).trim(),
      apiSecret: String(v.apiSecret).trim(),
      accountName: v.accountName || "MEXC Global Futures",
      accountType: "REAL",
      connected: true,
      realBalanceTry: v.realBalanceTry || 0,
    })
  } else {
    try { await redisCmd("DEL", "cron:owner_mexc") } catch {}
  }
}

export type ExchangeMode = "BINANCE_TR" | "MEXC" | "BINANCE_GLOBAL" | "HYBRID"

export interface ExchangeSettings {
  mode: ExchangeMode
  leverage: number // örn. 5x
  marginType: "ISOLATED" | "CROSSED"
  tp1Pct: number // %1.5 fiyat artışında %50 sat, SL'i maliyete çek
  tp2Pct: number // %3.0 fiyatta kalan %50 kapat
  stopLossPct: number // -%1.8 sert sermaye koruma stopu
  maxSlots?: number // 0: Otomatik (1 veya 2 slot), 1: Sabit 1 slot, 2: Sabit 2 slot
  maxPositionSizeUsdt?: number // 🛡️ Tavan: Maksimum pozisyon büyüklüğü (notional veya marjin tavanı)
  maxLeverageCap?: number // 🛡️ Tavan: İzin verilen maksimum kaldıraç tavanı (örn. 10x)
  maxConcurrentPositionsCap?: number // 🛡️ Tavan: Maksimum eşzamanlı pozisyon sayısı (örn. 2)
  useNewExitRules?: boolean // 🧪 Yeni Çıkış Kuralı Bayrağı: false = Mevcut, true = +%2.5 BE / %1.5 Trailing / +%8 TP / -%3.5 SL
  updatedAt?: number
}

export async function getServerExchangeSettings(): Promise<ExchangeSettings> {
  const s = await get<ExchangeSettings>("bot:exchange_settings", {
    mode: "BINANCE_GLOBAL",
    leverage: 10,
    marginType: "ISOLATED",
    tp1Pct: 5.0,
    tp2Pct: 10.0,
    stopLossPct: 3.5,
    maxSlots: 3, // Varsayılan 3 Slot
    maxPositionSizeUsdt: 20, // 🛡️ Varsayılan tavan: Tek pozisyonda maks 20 USDT notional
    maxLeverageCap: 10, // 🛡️ Varsayılan tavan: Maksimum 10x kaldıraç
    maxConcurrentPositionsCap: 3, // 🛡️ Varsayılan tavan: Maksimum 3 eşzamanlı pozisyon
    useNewExitRules: false, // 🧪 Varsayılan KAPALI
    updatedAt: Date.now(),
  })
  if (s && (!s.maxSlots || s.maxSlots < 1)) {
    s.maxSlots = 3
  }
  if (!s.maxPositionSizeUsdt || s.maxPositionSizeUsdt <= 0) {
    s.maxPositionSizeUsdt = 20
  }
  if (!s.maxLeverageCap || s.maxLeverageCap <= 0) {
    s.maxLeverageCap = 10
  }
  if (!s.maxConcurrentPositionsCap || s.maxConcurrentPositionsCap <= 0) {
    s.maxConcurrentPositionsCap = 3
  }
  if (typeof s.useNewExitRules !== "boolean") {
    s.useNewExitRules = false
  }
  return s
}

export async function setServerExchangeSettings(s: Partial<ExchangeSettings>): Promise<void> {
  const current = await getServerExchangeSettings()
  await set("bot:exchange_settings", { ...current, ...s, updatedAt: Date.now() })
}
export async function getServerHistory(): Promise<Position[]> { return get<Position[]>(K.history, []) }
export async function setServerHistory(v: Position[]) { await set(K.history, v) }
export async function appendServerHistory(pos: Position) {
  const h = await getServerHistory()
  await set(K.history, [pos, ...h].slice(0, 500))
}
export async function getServerLogs(): Promise<TradeLog[]> { return get<TradeLog[]>(K.logs, []) }
export async function setServerLogs(v: TradeLog[]) { await set(K.logs, v) }
export async function appendServerLog(log: TradeLog) {
  const logs = await getServerLogs()
  await set(K.logs, [log, ...logs].slice(0, 200))
}
export async function getDailyLoss(currentBalance?: number): Promise<{ startBalance: number; date: string }> {
  const today = new Date().toISOString().split("T")[0]
  const [s, d] = await Promise.all([get<number>(K.dlStart, 0), get<string>(K.dlDate, "")])
  if (d !== today) {
    const newStart = (typeof currentBalance === "number" && currentBalance > 0) ? currentBalance : (typeof s === "number" && s > 0 ? s : 0)
    if (typeof currentBalance === "number" && currentBalance > 0) {
      await setDailyLoss(newStart, today).catch(() => {})
    }
    return { startBalance: newStart, date: today }
  }
  return { startBalance: s, date: d }
}
export async function setDailyLoss(startBalance: number, date: string) {
  await Promise.all([set(K.dlStart, startBalance), set(K.dlDate, date)])
}

export interface SniperTargetInfo {
  symbol: string
  name: string
  score: number
  reason: string
  dipPrice: number
  selectedAt: number
}

export async function getSniperTarget(): Promise<SniperTargetInfo | null> {
  return get<SniperTargetInfo | null>(K.sniperTarget, null)
}

export async function setSniperTarget(target: SniperTargetInfo | null) {
  if (!target) {
    try { await redisCmd("DEL", K.sniperTarget) } catch {}
  } else {
    await set(K.sniperTarget, target)
  }
}

export interface BotSlotConfig {
  targetSlots: number // Hedeflenen slot sayısı (Varsayılan 2: Dengeli Hibrit Kasa)
  maxSlots: number // İzin verilen azami slot sınırı (2 Slot)
  mode: "hybrid_2_slot" | "fixed_1" | "fixed_2" | "fixed_3"
  description: string
  updatedAt?: number
}

export async function getServerSlotConfig(): Promise<BotSlotConfig> {
  const cfg = await get<BotSlotConfig>("bot:slot_config", {
    targetSlots: 2,
    maxSlots: 2,
    mode: "hybrid_2_slot",
    description: "🛡️ 2 Slot Dengeli Hibrit Kasa: Biri düşerken diğeri portföyü tutan, risk dağıtılmış güvenli büyüme stratejisi (Meme + DeFi dengesi).",
    updatedAt: Date.now(),
  })
  if (cfg && (!cfg.targetSlots || cfg.targetSlots < 1)) {
    cfg.targetSlots = 2
    cfg.maxSlots = Math.max(1, cfg.maxSlots || 2)
  }
  return cfg
}

export async function setServerSlotConfig(cfg: Partial<BotSlotConfig>): Promise<void> {
  const current = await getServerSlotConfig()
  await set("bot:slot_config", { ...current, ...cfg, updatedAt: Date.now() })
}

/** Tek seferde tüm bot state'ini okur (UI sync için) */
export async function getFullServerState() {
  const [
    positions,
    balance,
    initialBalance,
    strategy,
    logs,
    active,
    history,
    daily,
    binance,
    binanceGlobal,
    mexc,
    exchangeSettings,
    sniperTarget,
    manualSellCooldown,
    slotConfig,
  ] = await Promise.all([
    getServerPositions(),
    getServerBalance(),
    getServerInitialBalance(),
    getServerStrategy(),
    getServerLogs(),
    getServerActive(),
    getServerHistory(),
    getDailyLoss(),
    getServerBinance(),
    getServerBinanceGlobal(),
    getServerMexc(),
    getServerExchangeSettings(),
    getSniperTarget(),
    isServerManualSellCooldown(),
    getServerSlotConfig(),
  ])
  return {
    positions,
    balance,
    initialBalance,
    strategy,
    logs,
    active,
    history,
    binance,
    binanceGlobal,
    mexc,
    exchangeSettings,
    dailyLossStartBalance: daily.startBalance || balance,
    dailyLossDate: daily.date,
    sniperTarget,
    manualSellCooldown,
    slotConfig,
  }
}

export async function checkRedisHealth(): Promise<{ ok: boolean; hasEnv: boolean; error?: string; pingResult?: any }> {
  const rawUrl = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!rawUrl || !token) {
    return { ok: false, hasEnv: false, error: "UPSTASH env missing" }
  }
  try {
    const res = await redisCmd("PING")
    return { ok: res === "PONG", hasEnv: true, pingResult: res }
  } catch (e: any) {
    return { ok: false, hasEnv: true, error: e?.message || String(e) }
  }
}

export async function getRedisDebugInfo() {
  const ping = await redisCmd("PING")
  const allKeys = await redisCmd("KEYS", "*")
  return {
    ping,
    connected: ping === "PONG",
    hasEnv: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
    lastError: _lastRedisError,
    allKeys,
  }
}

// 🛡️ Sembol Bazlı Cooldown (Soğuma) Yönetimi
// Stop-Loss: 60 dakika (4 x 15m mum)
// Time-Stop / Manuel Satış / Başabaş: 30 dakika (2 x 15m mum)
// TP: 15 dakika (1 x 15m mum)
export type CooldownReason = "SL" | "TIME_STOP" | "MANUAL" | "TP" | "BREAKEVEN"

const _memSymbolCooldown = new Map<string, { expireTimestamp: number; reason: CooldownReason }>()

export async function setSymbolCooldown(
  symbol: string,
  reason: CooldownReason,
  durationSec?: number
): Promise<void> {
  const cleanSym = symbol.replace(/USDT$/i, "").toUpperCase()
  const defaultDuration =
    reason === "SL" ? 3600 :
    reason === "TP" ? 900 : 1800
  const finalDuration = durationSec || defaultDuration
  const expireTimestamp = Date.now() + finalDuration * 1000
  const payload = JSON.stringify({ expireTimestamp, reason, setAt: Date.now() })

  _memSymbolCooldown.set(cleanSym, { expireTimestamp, reason })

  const key = `bot:cooldown:${cleanSym}`
  await redisSet(key, payload)
  await redisCmd("EXPIRE", key, finalDuration).catch(() => {})

  if (reason === "SL") {
    await setServerLossCooldown(cleanSym, finalDuration).catch(() => {})
  }
}

export async function isSymbolInCooldown(symbol: string): Promise<{
  active: boolean
  remainingSec: number
  reason?: CooldownReason
}> {
  const cleanSym = symbol.replace(/USDT$/i, "").toUpperCase()
  const now = Date.now()

  // 1. RAM kontrolü
  const mem = _memSymbolCooldown.get(cleanSym)
  if (mem && mem.expireTimestamp > now) {
    return {
      active: true,
      remainingSec: Math.ceil((mem.expireTimestamp - now) / 1000),
      reason: mem.reason,
    }
  }

  // 2. Redis kontrolü
  try {
    const key = `bot:cooldown:${cleanSym}`
    const val = await redisGet(key)
    if (val) {
      const parsed = JSON.parse(val)
      const remaining = parsed.expireTimestamp - now
      if (remaining > 0) {
        _memSymbolCooldown.set(cleanSym, { expireTimestamp: parsed.expireTimestamp, reason: parsed.reason })
        return {
          active: true,
          remainingSec: Math.ceil(remaining / 1000),
          reason: parsed.reason,
        }
      }
    }
  } catch {}

  // 3. Eski loss cooldown kontrolü
  const oldLoss = await isServerLossCooldown(cleanSym)
  if (oldLoss) {
    return { active: true, remainingSec: 3600, reason: "SL" }
  }

  return { active: false, remainingSec: 0 }
}

// 🛡️ Stop-Loss Cooldown: Stop olan coini 60 dakika boyunca tekrar alma!
export async function setServerLossCooldown(symbol: string, durationSec: number = 3600): Promise<void> {
  const key = `bot:loss_cd:${symbol.toUpperCase()}`
  const expireTimestamp = Date.now() + durationSec * 1000
  await redisSet(key, String(expireTimestamp))
  await redisCmd("EXPIRE", key, durationSec).catch(() => {})
}

export async function isServerLossCooldown(symbol: string): Promise<boolean> {
  const key = `bot:loss_cd:${symbol.toUpperCase()}`
  const val = await redisGet(key)
  if (!val) return false
  const expireTimestamp = Number(val)
  return Date.now() < expireTimestamp
}

// ⏸️ Manuel Satış Molası: Kullanıcı elle satış yapınca bot en az 30 dakika (1800 saniye / 2 mum) bekler
export async function setServerManualSellCooldown(durationSec: number = 1800): Promise<void> {
  const key = "bot:manual_sell_pause"
  const expireTimestamp = Date.now() + durationSec * 1000
  await redisSet(key, String(expireTimestamp))
  await redisCmd("EXPIRE", key, durationSec).catch(() => {})
}

export async function isServerManualSellCooldown(): Promise<{ active: boolean; remainingSec: number }> {
  const key = "bot:manual_sell_pause"
  const val = await redisGet(key)
  if (!val) return { active: false, remainingSec: 0 }
  const expireTimestamp = Number(val)
  const remainingMs = expireTimestamp - Date.now()
  if (remainingMs <= 0) return { active: false, remainingSec: 0 }
  return { active: true, remainingSec: Math.ceil(remainingMs / 1000) }
}

// ⏳ Otomatik İşlem Molası: Stop-loss sonrası bot 15 dakika yeni otomatik alım yapmaz (Overtrading & İntikam İşlemi Kalkanı)
export async function setServerTradeCooldown(durationSec: number = 900): Promise<void> {
  const key = "bot:auto_trade_cooldown"
  const expireTimestamp = Date.now() + durationSec * 1000
  await redisSet(key, String(expireTimestamp))
  await redisCmd("EXPIRE", key, durationSec).catch(() => {})
}

export async function isServerTradeCooldown(): Promise<{ active: boolean; remainingSec: number }> {
  const key = "bot:auto_trade_cooldown"
  const val = await redisGet(key)
  if (!val) return { active: false, remainingSec: 0 }
  const expireTimestamp = Number(val)
  const remainingMs = expireTimestamp - Date.now()
  if (remainingMs <= 0) return { active: false, remainingSec: 0 }
  return { active: true, remainingSec: Math.ceil(remainingMs / 1000) }
}

// 🌐 L2 Redis Önbelleği: Serverless cold-start sırasında proxy bandını ve limitleri korur
export async function getL2PublicCache(cacheKey: string): Promise<string | null> {
  const key = `bot:public_cache:${cacheKey}`
  return redisGet(key)
}

export async function setL2PublicCache(cacheKey: string, body: string, ttlSec: number): Promise<void> {
  const key = `bot:public_cache:${cacheKey}`
  await redisSet(key, body)
  await redisCmd("EXPIRE", key, ttlSec).catch(() => {})
}

// 🔓 Dinamik Token Kilit Açılımı (Token Unlock) VETO Listesi
export async function getDynamicUnlockVetoes(): Promise<Set<string>> {
  const raw = await get<string[]>("bot:dynamic_unlock_vetoes", [])
  return new Set((raw || []).map(s => s.toUpperCase()))
}

export async function setDynamicUnlockVetoes(tokens: string[]): Promise<void> {
  const clean = Array.from(new Set(tokens.map(s => s.toUpperCase())))
  await set("bot:dynamic_unlock_vetoes", clean)
}


// 🔒 Cron Kilidi: Aynı anda tek bir bot döngüsü çalışsın (çift alım / pozisyon ezilmesi önlenir)
let _memLockUntil = 0
export async function acquireCronLock(ttlSec: number = 55): Promise<string | null> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const hasEnv = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  if (!hasEnv) {
    if (Date.now() < _memLockUntil) return null
    _memLockUntil = Date.now() + ttlSec * 1000
    return token
  }
  const res = await redisCmd("SET", "bot:cron_lock", token, "NX", "EX", ttlSec)
  return res === "OK" ? token : null
}

export async function releaseCronLock(token: string | null): Promise<void> {
  if (!token) return
  const hasEnv = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  if (!hasEnv) {
    _memLockUntil = 0
    return
  }
  try {
    const current = await redisCmd("GET", "bot:cron_lock")
    if (current === token) await redisCmd("DEL", "bot:cron_lock")
  } catch {}
}
export async function isFuturesTp1Taken(symbol: string): Promise<boolean> {
  const val = await redisGet(`bot:futures_tp1:${symbol.toUpperCase()}`)
  return Boolean(val)
}

export async function setFuturesTp1Taken(symbol: string, taken: boolean): Promise<void> {
  const key = `bot:futures_tp1:${symbol.toUpperCase()}`
  if (taken) {
    await redisSet(key, "1")
    await redisCmd("EXPIRE", key, 86400).catch(() => {})
  } else {
    try { await redisCmd("DEL", key) } catch {}
  }
}

export async function isMexcTp1Taken(symbol: string): Promise<boolean> {
  const val = await redisGet(`bot:mexc_tp1:${symbol.toUpperCase()}`)
  return Boolean(val)
}

export async function setMexcTp1Taken(symbol: string, taken: boolean): Promise<void> {
  const key = `bot:mexc_tp1:${symbol.toUpperCase()}`
  if (taken) {
    await redisSet(key, "1")
    await redisCmd("EXPIRE", key, 86400).catch(() => {})
  } else {
    try { await redisCmd("DEL", key) } catch {}
  }
}

// 🎯 Binance Global Futures Zirve Kâr (Trailing Stop) & Giriş Zamanı Takibi
export async function getFuturesPeakPnl(symbol: string): Promise<number> {
  const val = await redisGet(`bot:futures_peak:${symbol.toUpperCase()}`)
  return val ? parseFloat(val) : 0
}

export async function setFuturesPeakPnl(symbol: string, pnl: number): Promise<void> {
  const key = `bot:futures_peak:${symbol.toUpperCase()}`
  await redisSet(key, String(pnl))
  await redisCmd("EXPIRE", key, 86400 * 3).catch(() => {})
}

export async function getFuturesEntryTime(symbol: string): Promise<number> {
  const val = await redisGet(`bot:futures_entry_time:${symbol.toUpperCase()}`)
  return val ? parseInt(val, 10) : 0
}

export async function setFuturesEntryTime(symbol: string, timeMs: number): Promise<void> {
  const key = `bot:futures_entry_time:${symbol.toUpperCase()}`
  await redisSet(key, String(timeMs))
  await redisCmd("EXPIRE", key, 86400 * 3).catch(() => {})
}

export async function getFuturesCustomTp(symbol: string): Promise<number | null> {
  const val = await redisGet(`bot:futures_custom_tp:${symbol.toUpperCase()}`)
  return val ? parseFloat(val) : null
}

export async function setFuturesCustomTp(symbol: string, tpPct: number): Promise<void> {
  const key = `bot:futures_custom_tp:${symbol.toUpperCase()}`
  await redisSet(key, String(tpPct))
  await redisCmd("EXPIRE", key, 86400 * 7).catch(() => {})
}

export async function markFuturesBotOwned(symbol: string): Promise<void> {
  const sym = symbol.toUpperCase()
  await redisSet(`bot:futures_bot_owned:${sym}`, "1")
  await redisCmd("EXPIRE", `bot:futures_bot_owned:${sym}`, 86400 * 30).catch(() => {})
}

export async function isFuturesBotOwned(symbol: string): Promise<boolean> {
  const sym = symbol.toUpperCase()
  const val = await redisGet(`bot:futures_bot_owned:${sym}`)
  return Boolean(val)
}

export async function setFuturesSmartMoneyRegime(symbol: string, regime: string, isShortCovering: boolean): Promise<void> {
  const sym = symbol.toUpperCase()
  await Promise.all([
    redisSet(`bot:futures_regime:${sym}`, regime),
    isShortCovering ? redisSet(`bot:futures_short_covering:${sym}`, "1") : redisCmd("DEL", `bot:futures_short_covering:${sym}`),
  ])
  await Promise.all([
    redisCmd("EXPIRE", `bot:futures_regime:${sym}`, 86400 * 3).catch(() => {}),
    isShortCovering ? redisCmd("EXPIRE", `bot:futures_short_covering:${sym}`, 86400 * 3).catch(() => {}) : Promise.resolve(),
  ])
}

export async function isFuturesShortCovering(symbol: string): Promise<boolean> {
  const sym = symbol.toUpperCase()
  const val = await redisGet(`bot:futures_short_covering:${sym}`)
  return Boolean(val)
}

export async function getFuturesSmartMoneyRegime(symbol: string): Promise<string | null> {
  const sym = symbol.toUpperCase()
  return await redisGet(`bot:futures_regime:${sym}`)
}

export async function clearFuturesPositionMeta(symbol: string): Promise<void> {
  const sym = symbol.toUpperCase()
  await Promise.all([
    redisCmd("DEL", `bot:futures_tp1:${sym}`).catch(() => {}),
    redisCmd("DEL", `bot:futures_peak:${sym}`).catch(() => {}),
    redisCmd("DEL", `bot:futures_peak_price:${sym}`).catch(() => {}),
    redisCmd("DEL", `bot:futures_entry_time:${sym}`).catch(() => {}),
    redisCmd("DEL", `bot:futures_custom_tp:${sym}`).catch(() => {}),
    redisCmd("DEL", `bot:futures_bot_owned:${sym}`).catch(() => {}),
    redisCmd("DEL", `bot:futures_passed_2pct:${sym}`).catch(() => {}),
    redisCmd("DEL", `bot:futures_short_covering:${sym}`).catch(() => {}),
    redisCmd("DEL", `bot:futures_regime:${sym}`).catch(() => {}),
  ])
}

export async function getFuturesPeakPricePct(symbol: string): Promise<number> {
  const val = await redisGet(`bot:futures_peak_price:${symbol.toUpperCase()}`)
  return val ? parseFloat(val) : 0
}

export async function setFuturesPeakPricePct(symbol: string, pct: number): Promise<void> {
  const key = `bot:futures_peak_price:${symbol.toUpperCase()}`
  await redisSet(key, String(pct))
  await redisCmd("EXPIRE", key, 86400 * 3).catch(() => {})
}

export async function setFuturesPassed2Pct(symbol: string): Promise<void> {
  const sym = symbol.toUpperCase()
  await redisSet(`bot:futures_passed_2pct:${sym}`, "1")
  await redisCmd("EXPIRE", `bot:futures_passed_2pct:${sym}`, 86400 * 7).catch(() => {})
}

export async function isFuturesPassed2Pct(symbol: string): Promise<boolean> {
  const sym = symbol.toUpperCase()
  const val = await redisGet(`bot:futures_passed_2pct:${sym}`)
  return val === "1"
}

// 🛡️ BOT KAPANIŞI TAKİBİ (ClientOrderId & Pending Closing Eşleşmesi)
export async function markFuturesClosing(symbol: string, meta: { clientOrderId?: string; orderId?: string | number; reason?: string }): Promise<void> {
  const sym = symbol.toUpperCase()
  const payload = JSON.stringify({ ...meta, timestamp: Date.now() })
  await redisSet(`bot:futures_closing:${sym}`, payload)
  await redisCmd("EXPIRE", `bot:futures_closing:${sym}`, 300).catch(() => {}) // 5 dk TTL
  if (meta.clientOrderId) {
    await redisSet(`bot:closing_cid:${meta.clientOrderId}`, sym)
    await redisCmd("EXPIRE", `bot:closing_cid:${meta.clientOrderId}`, 300).catch(() => {})
  }
}

export async function getFuturesClosing(symbol: string): Promise<{ clientOrderId?: string; orderId?: string | number; reason?: string; timestamp?: number } | null> {
  const sym = symbol.toUpperCase()
  const val = await redisGet(`bot:futures_closing:${sym}`)
  if (!val) return null
  try {
    return JSON.parse(val)
  } catch {
    return null
  }
}

export async function clearFuturesClosing(symbol: string, clientOrderId?: string): Promise<void> {
  const sym = symbol.toUpperCase()
  await redisCmd("DEL", `bot:futures_closing:${sym}`).catch(() => {})
  if (clientOrderId) {
    await redisCmd("DEL", `bot:closing_cid:${clientOrderId}`).catch(() => {})
  }
}

// 🛠️ Siteden Geliştirici Görev Kaydı (Kanka Web Asistanı İstekleri)
export interface DevTask {
  id: string
  task: string
  createdAt: number
  status: "pending" | "in_progress" | "completed"
}

export async function getDevTasks(): Promise<DevTask[]> {
  return get<DevTask[]>("bot:dev_tasks", [])
}

export async function appendDevTask(taskDesc: string): Promise<DevTask> {
  const tasks = await getDevTasks()
  const newTask: DevTask = {
    id: "task-" + Date.now(),
    task: taskDesc,
    createdAt: Date.now(),
    status: "pending",
  }
  await set("bot:dev_tasks", [newTask, ...tasks].slice(0, 50))
  return newTask
}

// ⏳ BEKLEYEN LİMİT EMİRLER (Dolum Doğrulama & 60-90s Zaman Aşımı Takibi)
export interface PendingLimitOrder {
  id: string | number
  symbol: string
  pair: string
  side: "BUY" | "SELL"
  price: number
  quantity: number
  costTryOrUsdt: number
  createdAt: number
  exchange: "BINANCE_TR" | "BINANCE_GLOBAL_FUTURES"
  orderId?: string | number
  tpPrice?: number
  slPrice?: number
  tpRatio?: number
  slRatio?: number
  reason?: string
  leverage?: number
  isWhale?: boolean
  isMegaWhale?: boolean
  isBounce?: boolean
}

export async function getPendingLimitOrders(): Promise<PendingLimitOrder[]> {
  return get<PendingLimitOrder[]>("bot:pending_limit_orders", [])
}

export async function setPendingLimitOrders(orders: PendingLimitOrder[]): Promise<void> {
  await set("bot:pending_limit_orders", orders)
}

export async function addPendingLimitOrder(order: PendingLimitOrder): Promise<void> {
  const current = await getPendingLimitOrders()
  const filtered = current.filter((o) => String(o.id) !== String(order.id))
  filtered.push(order)
  await setPendingLimitOrders(filtered)
}

export async function removePendingLimitOrder(id: string | number): Promise<void> {
  const current = await getPendingLimitOrders()
  const filtered = current.filter((o) => String(o.id) !== String(id))
  await setPendingLimitOrders(filtered)
}

// 🏛️ HALKA ARZ BİLDİRİM GEÇMİŞİ (Mükerrer Telegram Bildirimlerini Önleme)
export async function isHalkaArzNotified(code: string): Promise<boolean> {
  const key = `bot:ipo:notified:${code.toUpperCase()}`
  const val = await redisGet(key)
  return Boolean(val)
}

export async function markHalkaArzNotified(code: string): Promise<void> {
  const key = `bot:ipo:notified:${code.toUpperCase()}`
  await redisSet(key, String(Date.now()))
}

// 🌐 CoinGecko Ön Filtreleme Önbelleği (Günde birkaç kez çalışır, 6 saat TTL)
export async function getCoinGeckoPrefilterState(): Promise<any | null> {
  return get<any | null>("bot:coingecko_prefilter", null)
}

export async function setCoinGeckoPrefilterState(state: any): Promise<void> {
  await set("bot:coingecko_prefilter", state)
}

// 🪙 CoinGecko Coin Yaşı Önbelleği (Redis'te saklanır, her coin için bir kez sorgulanır)
export async function getCachedCoinAge(coinId: string): Promise<{ firstTimestamp?: number; firstDate?: string } | null> {
  return get<{ firstTimestamp?: number; firstDate?: string } | null>(`bot:coin_age:${coinId.toLowerCase()}`, null)
}

export async function setCachedCoinAge(coinId: string, data: { firstTimestamp?: number; firstDate?: string }): Promise<void> {
  // 1 yıl (31536000 sn) boyunca Redis'te kalıcı sakla
  const key = `bot:coin_age:${coinId.toLowerCase()}`
  await redisCmd("SET", key, JSON.stringify(data), "EX", 31536000)
}

// 📝 DRY RUN Kalıcı Kayıtları (Redis'te son 500 simülasyon işlemi)
export async function appendDryRunTradeToRedis(trade: any): Promise<void> {
  const current = await get<any[]>("bot:dry_run_trades", [])
  await set("bot:dry_run_trades", [trade, ...current].slice(0, 500))
}

export async function getDryRunTradesFromRedis(): Promise<any[]> {
  return get<any[]>("bot:dry_run_trades", [])
}

// 🧪 DRY RUN AÇIK SİMÜLE POZİSYONLAR (fiyat takibi + simüle kapanış için)
// DRY_RUN açıkken gerçek pozisyon açılmaz; simüle pozisyonlar burada tutulur,
// her cron turunda mark-to-market edilir ve SL/TP/trailing/time kurallarıyla
// "sanal kapanış" yapılarak sunucu geçmişine yazılır (analytics bunu okur).
export async function getDryRunPositions(): Promise<any[]> {
  return get<any[]>("bot:dry_run_positions", [])
}

export async function setDryRunPositions(v: any[]): Promise<void> {
  await set("bot:dry_run_positions", Array.isArray(v) ? v.slice(0, 200) : [])
}

// 🧠 xAI Grok Sosyal Duygu ve Haber Analizi Önbelleği
export async function getCachedGrokSentiment(symbol: string): Promise<any | null> {
  return get<any | null>(`bot:grok_sentiment:${symbol.toUpperCase()}`, null)
}

export async function setCachedGrokSentiment(symbol: string, data: any, ttlSec = 3600): Promise<void> {
  const key = `bot:grok_sentiment:${symbol.toUpperCase()}`
  await redisCmd("SET", key, JSON.stringify(data), "EX", ttlSec)
}

/**
 * 🔒 Redis'te saklanan eski düz metin (plaintext) API anahtarlarını tespit eder,
 * sunucu ortam değişkenindeki ENCRYPTION_KEY ile AES-256-GCM formatında şifreler ve günceller.
 */
export async function migratePlaintextApiKeysInRedis(): Promise<{
  success: boolean
  migrated: string[]
  message: string
}> {
  if (!process.env.ENCRYPTION_KEY) {
    return {
      success: false,
      migrated: [],
      message: "ENCRYPTION_KEY ortam değişkeni tanımlı olmadığı için migrasyon çalıştırılamadı.",
    }
  }

  const migrated: string[] = []

  // 1. Binance TR anahtarı kontrolü
  const trSaved = await get<BinanceCredentials | null>("cron:owner_binance", null)
  if (trSaved && trSaved.apiKey && trSaved.apiSecret) {
    const isKeyPlain = !trSaved.apiKey.startsWith("enc_gcm:")
    const isSecPlain = !trSaved.apiSecret.startsWith("enc_gcm:")
    if (isKeyPlain || isSecPlain) {
      await set("cron:owner_binance", {
        ...trSaved,
        apiKey: encryptVaultData(trSaved.apiKey),
        apiSecret: encryptVaultData(trSaved.apiSecret),
      })
      migrated.push("cron:owner_binance")
    }
  }

  // 2. Binance Global anahtarı kontrolü
  const globSaved = await get<BinanceCredentials | null>("cron:owner_binance_global", null)
  if (globSaved && globSaved.apiKey && globSaved.apiSecret) {
    const isKeyPlain = !globSaved.apiKey.startsWith("enc_gcm:")
    const isSecPlain = !globSaved.apiSecret.startsWith("enc_gcm:")
    if (isKeyPlain || isSecPlain) {
      await set("cron:owner_binance_global", {
        ...globSaved,
        apiKey: encryptVaultData(globSaved.apiKey),
        apiSecret: encryptVaultData(globSaved.apiSecret),
      })
      migrated.push("cron:owner_binance_global")
    }
  }

  // 3. Eski düz metin 'bot:binance' anahtarını Redis'ten temizle
  try {
    const legacy = await redisGet(K.binance)
    if (legacy) {
      await redisCmd("DEL", K.binance)
      migrated.push("bot:binance (eski düz metin anahtar silindi)")
    }
  } catch {}

  return {
    success: true,
    migrated,
    message: migrated.length > 0
      ? `Başarıyla şifrelendi: ${migrated.join(", ")}`
      : "Redis'te düz metin anahtar bulunamadı, tüm anahtarlar zaten güvenli/şifreli veya boş.",
  }
}


