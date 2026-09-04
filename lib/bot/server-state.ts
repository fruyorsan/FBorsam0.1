/**
 * lib/bot/server-state.ts
 * Sunucu taraflı bot durumu — Upstash Redis üzerinden kalıcı depolama.
 * Vercel Cron ve UI /api/bot/state endpoint'leri bu modülü kullanır.
 */

import type { Position, BotStrategy, TradeLog } from "./engine"
import { DEFAULT_BOT_STRATEGY } from "./engine"

// ── Redis İstemcisi (env yoksa in-memory fallback) ──────────────
const _mem: Record<string, string> = {}

async function redisGet(key: string): Promise<string | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return _mem[key] ?? null
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!res.ok) return null
    const json = await res.json()
    return typeof json.result === "string" ? json.result : json.result != null ? String(json.result) : null
  } catch { return null }
}

async function redisSet(key: string, value: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) { _mem[key] = value; return }
  try {
    await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/EX/2592000`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
  } catch (e) { console.error("[Redis SET]", key, e) }
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
}

// ── Public API ────────────────────────────────────────────────
export async function getServerPositions(): Promise<Position[]> { return get<Position[]>(K.positions, []) }
export async function setServerPositions(v: Position[]) { await set(K.positions, v) }
export async function getServerBalance(): Promise<number> { return get<number>(K.balance, 50000) }
export async function setServerBalance(v: number) { await set(K.balance, v) }
export async function getServerInitialBalance(): Promise<number> { return get<number>(K.initialBalance, 50000) }
export async function setServerInitialBalance(v: number) { await set(K.initialBalance, v) }
export async function getServerStrategy(): Promise<BotStrategy> { return get<BotStrategy>(K.strategy, DEFAULT_BOT_STRATEGY) }
export async function setServerStrategy(v: BotStrategy) { await set(K.strategy, v) }
export async function getServerActive(): Promise<boolean> { return get<boolean>(K.active, true) }
export async function setServerActive(v: boolean) { await set(K.active, v) }
export async function getServerHistory(): Promise<Position[]> { return get<Position[]>(K.history, []) }
export async function appendServerHistory(pos: Position) {
  const h = await getServerHistory()
  await set(K.history, [pos, ...h].slice(0, 500))
}
export async function getServerLogs(): Promise<TradeLog[]> { return get<TradeLog[]>(K.logs, []) }
export async function appendServerLog(log: TradeLog) {
  const logs = await getServerLogs()
  await set(K.logs, [log, ...logs].slice(0, 200))
}
export async function getDailyLoss(): Promise<{ startBalance: number; date: string }> {
  const [s, d] = await Promise.all([get<number>(K.dlStart, 0), get<string>(K.dlDate, "")])
  return { startBalance: s, date: d }
}
export async function setDailyLoss(startBalance: number, date: string) {
  await Promise.all([set(K.dlStart, startBalance), set(K.dlDate, date)])
}

/** Tek seferde tüm bot state'ini okur (UI sync için) */
export async function getFullServerState() {
  const [positions, balance, initialBalance, strategy, logs, active, history, daily] =
    await Promise.all([
      getServerPositions(),
      getServerBalance(),
      getServerInitialBalance(),
      getServerStrategy(),
      getServerLogs(),
      getServerActive(),
      getServerHistory(),
      getDailyLoss(),
    ])
  return { positions, balance, initialBalance, strategy, logs, active, history, dailyLossStartBalance: daily.startBalance || balance, dailyLossDate: daily.date }
}
