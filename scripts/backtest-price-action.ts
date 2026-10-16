// node scripts/backtest-price-action.ts
// Parametre OPTİMİZE EDİLMEDİ. Sabit kurallar; ilk 60 gün (in-sample) / son 30 gün (out-of-sample) ayrı raporlanır.
import { writeFileSync } from "node:fs"
import { atrSeries, detectDivergence, detectSweep, rsiSeries, type Candle } from "../lib/bot/price-action"

const SYMBOLS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","SUIUSDT","INJUSDT","AAVEUSDT"]
const BASE = "https://fapi.binance.com"
const DAYS = 90, INTERVAL_MS = 15 * 60 * 1000
const FEE_ROUNDTRIP = 0.0008 + 0.0004 // taker 2x0.04% + slippage 0.04% (notional üzerinden)
const RR = 2, TIMEOUT_BARS = 32, MIN_RISK = 0.003, MAX_RISK = 0.04

async function fetchKlines(symbol: string): Promise<Candle[]> {
  const end = Date.now(); let start = end - DAYS * 86400000
  const out: Candle[] = []
  while (start < end) {
    const r = await fetch(`${BASE}/fapi/v1/klines?symbol=${symbol}&interval=15m&startTime=${start}&limit=1500`)
    if (!r.ok) throw new Error(`${symbol} HTTP ${r.status}`)
    const rows: any[] = await r.json()
    if (!rows.length) break
    for (const k of rows) out.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })
    start = rows[rows.length - 1][0] + INTERVAL_MS
    if (rows.length < 1500) break
  }
  return out
}

type Trade = { sym: string; type: string; t: number; r: number; ret: number }

function simulate(c: Candle[], entryIdx: number, sl: number, sym: string, type: string): { trade: Trade; exitIdx: number } | null {
  const entry = c[entryIdx].o
  const risk = (entry - sl) / entry
  if (risk < MIN_RISK || risk > MAX_RISK) return null
  const tp = entry + RR * (entry - sl)
  for (let j = entryIdx; j < Math.min(c.length, entryIdx + TIMEOUT_BARS); j++) {
    const bar = c[j]
    let exit: number | null = null
    if (bar.l <= sl) exit = sl            // aynı mumda ikisi de olursa SL (muhafazakâr)
    else if (bar.h >= tp) exit = tp
    else if (j === entryIdx + TIMEOUT_BARS - 1) exit = bar.c
    if (exit !== null) {
      const gross = (exit - entry) / entry
      const net = gross - FEE_ROUNDTRIP
      return { trade: { sym, type, t: c[entryIdx].t, r: net / risk, ret: net }, exitIdx: j }
    }
  }
  return null
}

function stats(ts: Trade[]) {
  const n = ts.length
  if (!n) return { n: 0 }
  const wins = ts.filter(t => t.ret > 0).length
  const gp = ts.filter(t => t.ret > 0).reduce((a, t) => a + t.ret, 0)
  const gl = -ts.filter(t => t.ret <= 0).reduce((a, t) => a + t.ret, 0)
  const avgR = ts.reduce((a, t) => a + t.r, 0) / n
  const sdR = Math.sqrt(ts.reduce((a, t) => a + (t.r - avgR) ** 2, 0) / Math.max(1, n - 1))
  return {
    n, winRate: +(wins / n * 100).toFixed(1), avgR: +avgR.toFixed(3),
    profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : null,
    avgNetPctOfNotional: +(ts.reduce((a, t) => a + t.ret, 0) / n * 100).toFixed(3),
    avgR95CI: [+(avgR - 1.96 * sdR / Math.sqrt(n)).toFixed(3), +(avgR + 1.96 * sdR / Math.sqrt(n)).toFixed(3)],
  }
}

async function main() {
  const all: Trade[] = []
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  for (const sym of SYMBOLS) {
    let c: Candle[]
    try { c = await fetchKlines(sym) } catch (e: any) { console.error("SKIP", sym, e.message); continue }
    const rsi = rsiSeries(c.map(x => x.c)); const atr = atrSeries(c)
    let busyUntil = -1, busyUntilCtl = -1
    for (let t = 60; t < c.length - TIMEOUT_BARS - 2; t++) {
      const avgVol = c.slice(t - 20, t).reduce((a, x) => a + x.v, 0) / 20
      if (t > busyUntil) {
        const sig = detectSweep(c, t, avgVol) || detectDivergence(c, rsi, t)
        if (sig) {
          const res = simulate(c, t + 1, sig.slPrice, sym, sig.type)
          if (res) { all.push(res.trade); busyUntil = res.exitIdx }
        }
      }
      // Kontrol grubu: rastgele giriş, aynı çıkış/RR, SL = 1.2*ATR (sinyalsiz taban çizgisi)
      if (t > busyUntilCtl && rnd() < 0.004 && atr[t] > 0) {
        const sl = c[t + 1].o - 1.2 * atr[t]
        const res = simulate(c, t + 1, sl, sym, "RANDOM")
        if (res) { all.push(res.trade); busyUntilCtl = res.exitIdx }
      }
    }
    console.log("OK", sym, c.length, "mum")
  }
  const t0 = Math.min(...all.map(t => t.t)); const split = t0 + 60 * 86400000
  const groups = ["SWEEP", "DIVERGENCE", "RANDOM"]
  const report: any = {}
  for (const g of groups) {
    const ts = all.filter(t => t.type === g)
    report[g] = { all: stats(ts), inSample60d: stats(ts.filter(t => t.t < split)), outOfSample30d: stats(ts.filter(t => t.t >= split)) }
  }
  const sig = all.filter(t => t.type !== "RANDOM")
  report.SIGNALS_COMBINED = { all: stats(sig), outOfSample30d: stats(sig.filter(t => t.t >= split)) }
  report.assumptions = { days: DAYS, tf: "15m", feeRoundTripPctNotional: FEE_ROUNDTRIP * 100, RR, timeoutBars: TIMEOUT_BARS, note: "Kaldıraç sadece marj getirisini çarpar (5x → ret*5), kaybı da. Funding/likidasyon dahil değil." }
  writeFileSync("scratch/price-action-backtest.json", JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
main()
