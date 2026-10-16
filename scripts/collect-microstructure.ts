// Canlı mikroyapı toplayıcı: her 60 sn'de funding, OI, emir defteri dengesizliği, fiyat → scratch/microstructure.jsonl
// Binance bunların uzun geçmişini vermediği için (özellikle emir defteri) biriktirip sonra ölçeceğiz.
// node scripts/collect-microstructure.ts   (durdurmak için süreci kapat)
import { appendFileSync, mkdirSync } from "node:fs"

const SYMBOLS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","SUIUSDT","INJUSDT","AAVEUSDT"]
const B = "https://fapi.binance.com"
mkdirSync("scratch", { recursive: true })

async function j(url: string) { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(r.status + ""); return r.json() }

async function tick() {
  const ts = Date.now()
  for (const s of SYMBOLS) {
    try {
      const [pi, oi, d] = await Promise.all([
        j(`${B}/fapi/v1/premiumIndex?symbol=${s}`),
        j(`${B}/fapi/v1/openInterest?symbol=${s}`),
        j(`${B}/fapi/v1/depth?symbol=${s}&limit=20`),
      ])
      const bid = d.bids.reduce((a: number, x: any) => a + +x[0] * +x[1], 0)
      const ask = d.asks.reduce((a: number, x: any) => a + +x[0] * +x[1], 0)
      appendFileSync("scratch/microstructure.jsonl", JSON.stringify({
        ts, s, mark: +pi.markPrice, funding: +pi.lastFundingRate, oi: +oi.openInterest, imb: (bid - ask) / (bid + ask),
      }) + "\n")
    } catch (e: any) { console.error(new Date().toISOString(), s, e.message) }
  }
}
console.log("collector started")
tick()
setInterval(tick, 60000)
