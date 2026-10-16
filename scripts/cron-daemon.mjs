// scripts/cron-daemon.mjs
// Local 24/7 background worker that pings https://frborsam.vercel.app/api/bot/cron every 15s

const CRON_URL = "https://frborsam.vercel.app/api/bot/cron"
const INTERVAL_MS = 30000

console.log(`[DAEMON] Starting 24/7 Bot Cron Ping Worker -> ${CRON_URL}`)

async function tick() {
  try {
    const res = await fetch(CRON_URL, {
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    })
    const data = await res.json()
    const now = new Date().toLocaleTimeString("tr-TR")
    if (data.actions && data.actions.length > 0) {
      console.log(`[${now}] 🔥 İŞLEM GERÇEKLEŞTİ:`, data.actions)
    } else {
      console.log(`[${now}] 🟢 7/24 Takip Aktif:`, data.message || "OK")
    }
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString("tr-TR")}] ⚠️ Ping uyarısı:`, err.message)
  }
}

// First tick immediately
tick()
setInterval(tick, INTERVAL_MS)
