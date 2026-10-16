const TARGET = "https://frborsam.vercel.app/api/bot/cron";

async function tick() {
  try {
    const res = await fetch(TARGET);
    const data = await res.json();
    const time = new Date().toLocaleTimeString("tr-TR");
    console.log(`[${time}] Cron OK | Open: ${data.openPositions} | Bal: ${data.balance?.toFixed(2)} TL | Duration: ${data.duration}ms`);
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString("tr-TR")}] Cron error:`, err.message);
  }
}

console.log("[BOT WORKER] Arka plan döngüsü başlatıldı. 15 saniyede bir /api/bot/cron tetikleniyor...");
tick();
setInterval(tick, 15000);
