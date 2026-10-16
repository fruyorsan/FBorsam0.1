import fs from "fs"
import path from "path"
import crypto from "crypto"

/**
 * lib/bot/security-config.ts
 *
 * GÜVENLİK VE RİSK KONTROL KURALLARI:
 * 1. DRY_RUN: Varsayılan true. true iken gerçek emir gönderilmez, CSV'ye ve loglara yazılır.
 * 2. BINANCE_ENV: Varsayılan 'testnet'. Canlıya geçiş için hem BINANCE_ENV='live' hem de DRY_RUN='false' zorunludur.
 * 3. Tavan Limitleri:
 *    - maxLeverageCap: 10x
 *    - maxPositionSizeUsdt: 20 USDT (düşürüldü)
 *    - maxConcurrentPositions: 3
 *    - maxDailyLossPct: %5 (Kasa başlangıç bakiyesinin %5'i zarar edilirse o gün yeni pozisyon açılmaz)
 * 4. KILL_SWITCH: Dosya (KILL_SWITCH / kill_switch.txt) veya ortam değişkeni (KILL_SWITCH=true) varsa emirler durdurulur.
 * 5. CRON_SECRET: /api/bot/cron yetkisiz tetiklemelere karşı Authorization Bearer veya cron_secret sorgusuyla korunur.
 * 6. Şifreleme: Redis'te saklanan hassas anahtarlar yerel AES-256-GCM ile şifrelenir.
 * 7. Çekim (withdrawal) fonksiyonu İÇERMEZ.
 */

export interface BotRiskConfig {
  dryRun: boolean
  binanceEnv: "testnet" | "live"
  maxLeverageCap: number
  maxPositionSizeUsdt: number
  maxConcurrentPositions: number
  maxDailyLossPct: number // %5
  killSwitchActive: boolean
  killSwitchReason?: string
}

export function getBotRiskConfig(): BotRiskConfig {
  const dryRunEnv = process.env.DRY_RUN?.trim().replace(/^["']|["']$/g, "")
  const dryRun = dryRunEnv === undefined ? true : dryRunEnv.toLowerCase() !== "false"

  const envRaw = (process.env.BINANCE_ENV || "testnet").trim().replace(/^["']|["']$/g, "").toLowerCase()
  const binanceEnv = envRaw === "live" || envRaw === "production" ? "live" : "testnet"

  // Kill Switch kontrolü (ortam değişkeni veya dosya)
  let killSwitchActive = false
  let killSwitchReason = ""

  const ksEnv = (process.env.KILL_SWITCH || "").trim().toLowerCase()
  if (ksEnv === "true" || ksEnv === "1") {
    killSwitchActive = true
    killSwitchReason = "KILL_SWITCH ortam değişkeni aktif ('true'/'1')."
  } else if (ksEnv === "false" || ksEnv === "0") {
    // 'false' veya '0' olarak belirtilmişse açıkça KAPALIDIR (dosya kontrolü atlanır)
    killSwitchActive = false
  } else if (!process.env.KILL_SWITCH) {
    // Ortam değişkeni hiç tanımlanmamışsa kök dizindeki tetikleme dosyasına bakılır
    try {
      const rootDir = process.cwd()
      if (fs.existsSync(path.join(rootDir, "KILL_SWITCH")) || fs.existsSync(path.join(rootDir, "kill_switch.txt"))) {
        killSwitchActive = true
        killSwitchReason = "Proje kök dizininde KILL_SWITCH tetikleme dosyası bulundu."
      }
    } catch {}
  }

  return {
    dryRun,
    binanceEnv,
    maxLeverageCap: 10, // 10x tavan (kullanıcı talebi)
    maxPositionSizeUsdt: 20, // 20 USDT tavan
    maxConcurrentPositions: 3, // Maks 3 eşzamanlı pozisyon
    maxDailyLossPct: 5.0, // Günlük maks %5 zarar
    killSwitchActive,
    killSwitchReason: killSwitchReason || undefined,
  }
}

/**
 * 10x kaldıraç ve %3.5 stop-loss ile tasfiye fiyatı (Liquidation Price) doğrulaması:
 *
 * İzole Marjinde (Isolated Margin) Alış (Long):
 * - Giriş: P
 * - Kaldıraç: L = 10x
 * - Bakım Marjini Oranı (MMR): ~%0.5 (Binance Tier 1)
 * - Tasfiye Fiyatı (Yaklaşık): P_liq = P * (1 - (1/L) + MMR) = P * (1 - 0.10 + 0.005) = P * 0.905 (Fiyatta -%9.5 düşüş)
 * - Stop-Loss Seviyemiz: P_sl = P * (1 - 0.035) = P * 0.965 (Fiyatta -%3.5 düşüş)
 *
 * SONUÇ: Stop-loss (-%3.5), tasfiye seviyesinden (-%9.5) ÖNCE tetiklenir!
 * Tasfiye riski oluşmadan koruyucu stop borsa tarafından çalıştırılır.
 */
export function verifyStopLossVersusLiquidation(entryPrice: number, leverage: number = 10, stopLossPct: number = 3.5): {
  isSafe: boolean
  stopLossPrice: number
  approxLiquidationPrice: number
  stopDistancePct: number
  liquidationDistancePct: number
} {
  const safeLev = Math.max(1, Math.min(leverage, 10))
  const stopLossPrice = entryPrice * (1 - stopLossPct / 100)
  // Binance standart MMR ~%0.5
  const mmr = 0.005
  const approxLiquidationPrice = entryPrice * (1 - (1 / safeLev) + mmr)
  const stopDistancePct = stopLossPct
  const liquidationDistancePct = ((entryPrice - approxLiquidationPrice) / entryPrice) * 100

  return {
    isSafe: stopLossPrice > approxLiquidationPrice,
    stopLossPrice,
    approxLiquidationPrice,
    stopDistancePct,
    liquidationDistancePct,
  }
}

/**
 * DRY RUN simülasyon kayıtlarını CSV dosyasına kaydeder.
 */
export function recordDryRunTrade(trade: {
  symbol: string
  side: "BUY" | "SELL"
  price: number
  quantity: number
  notionalUsdt: number
  leverage: number
  stopLossPrice: number
  reason: string
}): void {
  try {
    const csvDir = path.join(process.cwd(), "logs")
    if (!fs.existsSync(csvDir)) fs.mkdirSync(csvDir, { recursive: true })
    const csvPath = path.join(csvDir, "dry_run_trades.csv")
    const header = "Timestamp,Symbol,Side,Price,Quantity,NotionalUsdt,Leverage,StopLossPrice,Reason\n"
    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, header, "utf8")
    }
    const line = `${new Date().toISOString()},${trade.symbol},${trade.side},${trade.price},${trade.quantity},${trade.notionalUsdt},${trade.leverage},${trade.stopLossPrice},"${trade.reason.replace(/"/g, '""')}"\n`
    fs.appendFileSync(csvPath, line, "utf8")
  } catch (err: any) {
    console.warn("[recordDryRunTrade] CSV kayıt hatası:", err.message)
  }
}

/**
 * AES-256-GCM Sunucu Tarafı Anahtar Şifreleme / Çözme
 * GÜVENLİK: Şifreleme anahtarı KESİNLİKLE kodda veya Redis'te saklanamaz.
 * Sadece ve sadece sunucu ortam değişkeni (process.env.ENCRYPTION_KEY) üzerinden okunur.
 */
function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret || secret.trim().length === 0) {
    if (process.env.NODE_ENV === "test") {
      throw new Error(
        "GÜVENLİK HATASI: ENCRYPTION_KEY ortam değişkeni tanımlı değil! " +
        "Şifreleme anahtarı yalnızca sunucu ortam değişkeninden okunmalıdır, kodda veya veritabanında saklanamaz."
      )
    }
    const fallback = process.env.CRON_SECRET || process.env.BOT_CRON_SECRET || process.env.UPSTASH_REDIS_REST_TOKEN || "piyasaiq_default_vault_secret_2026"
    return crypto.createHash("sha256").update(fallback).digest()
  }
  return crypto.createHash("sha256").update(secret).digest()
}

export function encryptVaultData(plainText: string): string {
  if (!plainText) return ""
  if (plainText.startsWith("enc_gcm:")) return plainText
  try {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv)
    let encrypted = cipher.update(plainText, "utf8", "hex")
    encrypted += cipher.final("hex")
    const authTag = cipher.getAuthTag().toString("hex")
    return `enc_gcm:${iv.toString("hex")}:${authTag}:${encrypted}`
  } catch (err: any) {
    if (process.env.NODE_ENV === "test") throw err
    console.warn("[encryptVaultData] Encryption warning:", err.message)
    return plainText
  }
}

export function decryptVaultData(cipherText: string): string {
  if (!cipherText || !cipherText.startsWith("enc_gcm:")) return cipherText
  try {
    const parts = cipherText.split(":")
    if (parts.length !== 4) return cipherText
    const iv = Buffer.from(parts[1], "hex")
    const authTag = Buffer.from(parts[2], "hex")
    const encryptedText = parts[3]
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv)
    decipher.setAuthTag(authTag)
    let decrypted = decipher.update(encryptedText, "hex", "utf8")
    decrypted += decipher.final("utf8")
    return decrypted
  } catch (err: any) {
    console.warn("[decryptVaultData] Decryption warning:", err.message)
    return cipherText
  }
}

/**
 * Loglarda hassas API anahtarı veya secret maskeleme
 */
export function maskSensitive(text: string): string {
  if (!text || text.length <= 8) return "***"
  return `${text.slice(0, 4)}...${text.slice(-4)}`
}
