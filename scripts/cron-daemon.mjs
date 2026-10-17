// scripts/cron-daemon.mjs
// Local 24/7 background worker that pings https://frborsam.vercel.app/api/bot/cron every 30s
// 🛡️ NOT: /api/bot/cron FAIL-CLOSED korumalıdır; Authorization gönderilmezse 401 döner.
// Daha önce başlıksız çağrılar sessizce reddedilip "7/24 Takip Aktif" gibi görünüyordu.
const CRON_URL = "https://frborsam.vercel.app/api/bot/cron"
const INTERVAL_MS = 30000
const CRON_SECRET = (process.env.CRON_SECRET || process.env.BOT_CRON_SECRET || "").trim()

if (!CRON_SECRET) {
  console.error(
    "[DAEMON] HATA: CRON_SECRET/BOT_CRON_SECRET tanımlı değil! Yetkisiz çağrılar 401 ile reddedilir.\n" +
      "Başlatma örneği: CRON_SECRET=<gizli-anahtar> node scripts/cron-daemon.mjs"
  )
}

console.log(`[DAEMON] Starting 24/7 Bot Cron Ping Worker -> ${CRON_URL}`)

async function tick() {
  try {
    const res = await fetch(CRON_URL, {
      signal: AbortSignal.timeout(55000),
      cache: "no-store",
      headers: CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {},
    })

    if (res.status === 401) {
      console.error(`[${new Date().toLocaleTimeString("tr-TR")}] 🔒 [DAEMON] 401 YETKİ REDDEDİLDİ: CRON_SECRET eksik veya yanlış! Bot hiçbir işlem yapmıyor.`)
      return
    }

    const data = await res.json().catch(() => null)
    if (data && data.ok === false && data.error === "Unauthorized") {
      console.error(`[${new Date().toLocaleTimeString("tr-TR")}] 🔒 [DAEMON] YETKİSİZ çağrı: CRON_SECRET eksik veya yanlış!`)
      return
    }

    const now = new Date().toLocaleTimeString("tr-TR")
    if (data?.actions && data.actions.length > 0) {
      console.log(`[${now}] 🔥 İŞLEM GERÇEKLEŞTİ:`, data.actions)
    } else {
      console.log(`[${now}] 🟢 7/24 Takip Aktif:`, data?.message || "OK")
    }
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString("tr-TR")}] ⚠️ Ping uyarısı:`, err.message)
  }
}

// First tick immediately
tick()
setInterval(tick, INTERVAL_MS)
