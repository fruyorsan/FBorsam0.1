// Öncü veri analizi: OI değişimi / taker alış-satış oranı / fiyat momentumu → İLERİ getiri.
// Binance'in verdiği son ~30 günlük 1s geçmiş veriyle. Sabit kural, optimizasyon yok.
// node scripts/analyze-leading-data.ts
import { writeFileSync } from "node:fs"

const SYMBOLS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","SUIUSDT","INJUSDT","AAVEUSDT"]
const B = "https://fapi.binance.com"
const H = 4          // ileri getiri ufku (saat)
const FEE = 0.0012   // gidiş-dönüş

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function j(url: string) { const r = await fetch(url); if (!r.ok) throw new Error(url + " " + r.status); return r.json() }

type Row = { sym: string; ts: number; oiChg: number; taker: number; mom: number; fwd: number }

async function load(sym: string): Promise<Row[]> {
  const end = Date.now()
  const start = end - 29 * 86400000
  const oi: any[] = [], tk: any[] = [], kl: any[] = []
  for (let s = start; s < end; s += 500 * 3600000) {
    const e = Math.min(end, s + 500 * 3600000)
    oi.push(...await j(`${B}/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=500&startTime=${s}&endTime=${e}`))
    tk.push(...await j(`${B}/futures/data/takerlongshortRatio?symbol=${sym}&period=1h&limit=500&startTime=${s}&endTime=${e}`))
    kl.push(...await j(`${B}/fapi/v1/klines?symbol=${sym}&interval=1h&limit=500&startTime=${s}&endTime=${e}`))
    await sleep(150)
  }
  const oiMap = new Map(oi.map(x => [x.timestamp, +x.sumOpenInterest]))
  const tkMap = new Map(tk.map(x => [x.timestamp, +x.buySellRatio]))
  const kls = kl.map(k => ({ ts: k[0], c: +k[4] }))
  const rows: Row[] = []
  for (let i = 4; i + H < kls.length; i += H) { // örtüşmeyen örnekler
    const ts = kls[i].ts
    const o1 = oiMap.get(ts), o0 = oiMap.get(kls[i - 4].ts), t = tkMap.get(ts)
    if (!o1 || !o0 || !t) continue
    rows.push({ sym, ts, oiChg: o1 / o0 - 1, taker: t, mom: kls[i].c / kls[i - 4].c - 1, fwd: kls[i + H].c / kls[i].c - 1 })
  }
  return rows
}

function pct(vals: number[], v: number) { return vals.filter(x => x <= v).length / vals.length }

function bucketReport(rows: Row[], key: "oiChg" | "taker" | "mom") {
  // sembol içi yüzdelik dilim (semboller arası ölçek farkını yok eder)
  const bySym = new Map<string, number[]>()
  for (const r of rows) (bySym.get(r.sym) ?? bySym.set(r.sym, []).get(r.sym)!).push(r[key])
  const tagged = rows.map(r => ({ q: Math.min(4, Math.floor(pct(bySym.get(r.sym)!, r[key]) * 5)), fwd: r.fwd }))
  const out: any[] = []
  for (let q = 0; q < 5; q++) {
    const f = tagged.filter(t => t.q === q).map(t => t.fwd)
    const m = f.reduce((a, b) => a + b, 0) / f.length
    const sd = Math.sqrt(f.reduce((a, b) => a + (b - m) ** 2, 0) / (f.length - 1))
    out.push({ quintile: q + 1, n: f.length, meanFwdPct: +(m * 100).toFixed(3), tStat: +(m / (sd / Math.sqrt(f.length))).toFixed(2) })
  }
  const top = tagged.filter(t => t.q === 4).map(t => t.fwd), bot = tagged.filter(t => t.q === 0).map(t => t.fwd)
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  const v = (a: number[]) => a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / (a.length - 1)
  const spread = mean(top) - mean(bot)
  const se = Math.sqrt(v(top) / top.length + v(bot) / bot.length)
  return { feature: key, quintiles: out, longTopMinusShortBottomPct: +(spread * 100).toFixed(3), spreadTStat: +(spread / se).toFixed(2), feeHurdlePct: FEE * 100 }
}

async function main() {
  const rows: Row[] = []
  for (const s of SYMBOLS) { try { rows.push(...await load(s)); console.log("OK", s) } catch (e: any) { console.error("SKIP", s, e.message) } }
  const rep = { samples: rows.length, horizonH: H, features: (["oiChg", "taker", "mom"] as const).map(k => bucketReport(rows, k)) }
  writeFileSync("scratch/leading-data-analysis.json", JSON.stringify(rep, null, 2))
  console.log(JSON.stringify(rep, null, 2))
}
main()
