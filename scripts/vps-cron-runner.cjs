/**
 * scripts/vps-cron-runner.cjs
 * VPS ortamında /api/bot/cron endpoint'ini periyodik ve güvenli olarak tetikleyen PM2 işçisi.
 */

const CRON_INTERVAL_MS = 60 * 1000 // 60 saniyede bir
const PORT = process.env.PORT || 3000
const CRON_SECRET = process.env.CRON_SECRET || process.env.BOT_CRON_SECRET

if (!CRON_SECRET) {
  console.error("🚨 [VPS CRON WORKER] HATA: CRON_SECRET tanımlı değil! İşçi başlatılamaz.")
  process.exit(1)
}

async function triggerCron() {
  const url = `http://127.0.0.1:${PORT}/api/bot/cron`
  const startTime = Date.now()
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      signal: AbortSignal.timeout(55000), // 55s zaman aşımı
    })
    const duration = Date.now() - startTime
    if (res.ok) {
      const data = await res.json()
      console.log(`[${new Date().toISOString()}] ✅ Cron tamamlandı (${duration}ms): Pozisyon: ${data.openPositions ?? 0}, Eylemler: ${(data.actions || []).join(", ") || "Beklemede"}`)
    } else {
      console.error(`[${new Date().toISOString()}] ❌ Cron HTTP ${res.status}: ${res.statusText}`)
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ⚠️ Cron çağrısında hata:`, err.message)
  }
}

async function startLoop() {
  console.log(`🚀 [VPS CRON WORKER] Başlatıldı. Hedef: http://127.0.0.1:${PORT}/api/bot/cron | Periyot: ${CRON_INTERVAL_MS / 1000}s`)
  // Sunucunun ayağa kalkmasını beklemek için ilk döngüyü 5 saniye sonra başlat
  setTimeout(async () => {
    while (true) {
      await triggerCron()
      await new Promise(r => setTimeout(r, CRON_INTERVAL_MS))
    }
  }, 5000)
}

startLoop()
