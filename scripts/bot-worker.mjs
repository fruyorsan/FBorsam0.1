const TARGET = "https://frborsam.vercel.app/api/bot/cron"
// 🛡️ /api/bot/cron FAIL-CLOSED korumalıdır: Authorization: Bearer <CRON_SECRET> gönderilmezse 401 döner.
// Daha önce bu işçi başlık göndermediği için komutlar sessizce 401 ile reddediliyordu.
const CRON_SECRET = (process.env.CRON_SECRET || process.env.BOT_CRON_SECRET || "").trim()

if (!CRON_SECRET) {
  console.error(
    "[BOT WORKER] HATA: CRON_SECRET/BOT_CRON_SECRET tanımlı değil! Yetkisiz çağrılar 401 ile reddedilir.\n" +
      "Başlatma örneği: CRON_SECRET=<gizli-anahtar> node scripts/bot-worker.mjs"
  )
}

async function tick() {
  try {
    const res = await fetch(TARGET, {
      cache: "no-store",
      signal: AbortSignal.timeout(55000),
      headers: CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {},
    })

    if (res.status === 401) {
      console.error(`[${new Date().toLocaleTimeString("tr-TR")}] 🔒 401 YETKİ REDDEDİLDİ: CRON_SECRET eksik veya yanlış! Bot hiçbir işlem yapmıyor.`)
      return
    }

    const data = await res.json().catch(() => null)
    if (data && data.ok === false && data.error === "Unauthorized") {
      console.error(`[${new Date().toLocaleTimeString("tr-TR")}] 🔒 YETKİSİZ çağrı: CRON_SECRET eksik veya yanlış!`)
      return
    }
    const time = new Date().toLocaleTimeString("tr-TR")
    console.log(
      `[${time}] Cron OK | Open: ${data?.openPositions} | Bal: ${typeof data?.balance === "number" ? data.balance.toFixed(2) : "-"} TL | Duration: ${data?.duration}ms`
    )
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString("tr-TR")}] Cron error:`, err.message)
  }
}

console.log("[BOT WORKER] Arka plan döngüsü başlatıldı. 15 saniyede bir /api/bot/cron tetikleniyor...")
tick()
setInterval(tick, 15000)
