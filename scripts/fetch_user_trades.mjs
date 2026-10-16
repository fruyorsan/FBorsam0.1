import crypto from "crypto"
import fs from "fs"

const envContent = fs.readFileSync(".env.production", "utf8")
const env = {}
envContent.split("\n").forEach(l => {
  const idx = l.indexOf("=")
  if (idx > 0) env[l.slice(0, idx).trim()] = l.slice(idx + 1).trim().replace(/^["']|["']$/g, "")
})

async function getGlobalCreds() {
  const redisUrl = env["UPSTASH_REDIS_REST_URL"]
  const redisToken = env["UPSTASH_REDIS_REST_TOKEN"]
  if (!redisUrl || !redisToken) return null
  const res = await fetch(redisUrl + "/get/cron:owner_binance_global", {
    headers: { Authorization: "Bearer " + redisToken }
  })
  const json = await res.json()
  if (json.result) return JSON.parse(json.result)
  return null
}

function signQuery(query, secret) {
  return crypto.createHmac("sha256", secret).update(query).digest("hex")
}

async function run() {
  const creds = await getGlobalCreds()
  if (!creds || !creds.apiKey) {
    console.log("Global credentials not found in Redis")
    return
  }
  const coins = ["LUMIAUSDT", "STRKUSDT", "TIAUSDT", "NEARUSDT", "UNIUSDT"]
  for (const sym of coins) {
    const ts = Date.now()
    const query = "symbol=" + sym + "&limit=20&timestamp=" + ts
    const sig = signQuery(query, creds.apiSecret.trim())
    const url = "https://fapi.binance.com/fapi/v1/userTrades?" + query + "&signature=" + sig
    const res = await fetch(url, { headers: { "X-MBX-APIKEY": creds.apiKey.trim() } })
    const trades = await res.json()
    console.log("=== " + sym + " ===")
    if (Array.isArray(trades)) {
      trades.slice(-8).forEach(t => {
        console.log(new Date(Number(t.time)).toISOString(), t.side, "Price:", t.price, "Qty:", t.qty, "PnL:", t.realizedPnl, "orderId:", t.orderId)
      })
    } else {
      console.log("API Response error:", trades)
    }
  }
}

run().catch(console.error)
