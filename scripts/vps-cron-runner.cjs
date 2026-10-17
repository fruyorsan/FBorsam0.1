/**
 * scripts/vps-cron-runner.cjs
 * VPS ortamında /api/bot/cron endpoint'ini periyodik ve güvenli olarak tetikleyen PM2 işçisi.
 *
 * 🛡️ CRON_SECRET kaynağı sırasıyla:
 *   1) PM2/process ortamı (CRON_SECRET veya BOT_CRON_SECRET)
 *   2) Proje kökündeki .env.production.local / .env.production / .env.local dosyaları
 * (Next.js sağlansın yalnızca kendi sürecine yükler; bu işçi ayrı PM2 prosesidir.)
 */

const fs = require("fs")
const path = require("path")

const CRON_INTERVAL_MS = 60 * 1000 // 60 saniyede bir
const PORT = process.env.PORT || 3000

function loadEnvFileIfMissing(fileName) {
  const filePath = path.join(process.cwd(), fileName)
  try {
    if (!fs.existsSync(filePath)) return
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/)
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const eq = line.indexOf("=")
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      const val = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "")
      if (!key || process.env[key]) continue // PM2/gerçek ortam önceliğidir
      process.env[key] = val
    }
  } catch (err) {
    console.warn(`[VPS CRON WORKER] ${fileName} okunamadı:`, err.message)
  }
}

// Env dosyalarını tara (eksik process.env değerlerini doldurur; PM2/gerçek ortam önceliklidir)
for (const file of [".env.production.local", ".env.production", ".env.local", ".env"]) {
  loadEnvFileIfMissing(file)
}

const CRON_SECRET = process.env.CRON_SECRET || process.env.BOT_CRON_SECRET

if (!CRON_SECRET) {
  console.error(
    "🚨 [VPS CRON WORKER] HATA: CRON_SECRET tanımlı değil! İşçi başlatılamaz.\n" +
      "→ PM2 ortamına (ecosystem/config veya export CRON_SECRET=…) veya .env.production dosyasına BOT_CRON_SECRET yazın."
  )
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
    if (res.status === 401) {
      console.error(`[${new Date().toISOString()}] 🔒 Cron YETKİ HATASI (401): CRON_SECRET uygulamanınkiyle uyuşmuyor! Bot hiçbir işlem yapmıyor.`)
      return
    }
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
