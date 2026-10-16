import { NextResponse } from "next/server"
import crypto from "node:crypto"
import { getSymbolFilters, formatWithStepSize } from "@/lib/binance-helpers"
import { getServerBinance } from "@/lib/bot/server-state"

const BINANCE_TR_BASE = "https://www.trbinance.com"

function signQuery(query: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(query).digest("hex")
}

export async function GET() {
  try {
    const binance = await getServerBinance()
    if (!binance?.apiKey || !binance?.apiSecret) {
      return NextResponse.json({ ok: false, message: "Binance TR API anahtarları henüz girilmemiş." }, { status: 400 })
    }
    return fetchAccount(binance.apiKey, binance.apiSecret)
  } catch (err: any) {
    return NextResponse.json({ ok: false, message: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { apiKey, apiSecret } = body

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { ok: false, message: "API Key ve API Secret zorunludur." },
        { status: 400 }
      )
    }

    return fetchAccount(apiKey, apiSecret)
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error?.message || "Bilinmeyen sunucu hatası" },
      { status: 500 }
    )
  }
}

async function fetchAccount(apiKey: string, apiSecret: string) {
  try {
    const cleanKey = String(apiKey).trim()
    const cleanSecret = String(apiSecret).trim()
    const timestamp = Date.now()
    const recvWindow = 60000
    const queryString = `recvWindow=${recvWindow}&timestamp=${timestamp}`
    const signature = signQuery(queryString, cleanSecret)

    // Binance TR: GET /open/v1/account/spot
    const url = `${BINANCE_TR_BASE}/open/v1/account/spot?${queryString}&signature=${signature}`
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": cleanKey,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    })

    const json = await res.json()

    // Binance TR response: { code: 0, msg: "success", data: { accountAssets: [...] } }
    if (json.code === 0 && json.data) {
      const accountData = json.data
      const balances: Record<string, { free: number; locked: number; total: number }> = {}
      let freeTry = 0
      let lockedTry = 0
      const nonTryAssets: { asset: string; total: number }[] = []

      if (Array.isArray(accountData.accountAssets)) {
        for (const b of accountData.accountAssets) {
          const free = parseFloat(b.free) || 0
          const locked = parseFloat(b.locked) || 0
          const total = free + locked
          const assetName = String(b.asset || "").trim().toUpperCase()
          if (assetName === "TRY" || assetName === "TL") {
            freeTry = free
            lockedTry = locked
          } else if (total > 0.00000001) {
            nonTryAssets.push({ asset: assetName, total })
          }
          if (total > 0.00000001) {
            balances[assetName] = { free, locked, total }
          }
        }
      }

      // Coin varlıklarını TRY'ye çevir (Binance canlı fiyatlarıyla)
      let coinValueTry = 0
      const priceMap = new Map<string, number>()
      if (nonTryAssets.length > 0) {
        try {
          const tickerRes = await fetch("https://api.binance.com/api/v3/ticker/price", {
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
          })
          if (tickerRes.ok) {
            const allPrices: Array<{ symbol: string; price: string }> = await tickerRes.json()
            for (const item of allPrices) {
              if (item.symbol.endsWith("TRY")) {
                const base = item.symbol.slice(0, -3)
                priceMap.set(base, parseFloat(item.price) || 0)
              }
            }
            for (const { asset, total } of nonTryAssets) {
              const p = priceMap.get(asset.toUpperCase())
              if (p && p > 0) {
                coinValueTry += total * p
              }
            }
          }
        } catch (e) {
          console.error("[BINANCE ACCOUNT] Price fetch error:", e)
        }
      }

      const assetDetails = (await Promise.all(
        nonTryAssets.map(async ({ asset, total }) => {
          const p = priceMap.get(asset.toUpperCase()) || 0
          const free = balances[asset]?.free || 0
          const valueTry = total * p

          let canSell = false
          if (free > 0 && p > 0) {
            try {
              const filters = await getSymbolFilters(asset.toUpperCase() + "_TRY")
              const stepSize = filters?.stepSize || 0.0001
              const minQty = filters?.minQty || 0.0001
              const minNotional = filters?.minNotional || 10
              const basePrecision = filters?.basePrecision || 8
              const formattedQty = formatWithStepSize(free, stepSize, basePrecision)
              const execQty = parseFloat(formattedQty)
              canSell = execQty >= minQty && (execQty * p) >= minNotional
            } catch {}
          }

          return {
            asset,
            free,
            total,
            priceTry: p,
            valueTry: Math.round(valueTry * 100) / 100,
            canSell,
          }
        })
      )).filter((a) => a.valueTry >= 0.5)

      const totalTryValue = Math.round((freeTry + lockedTry + coinValueTry) * 100) / 100
      // tryBalance backward compat = freeTry
      const tryBalance = freeTry

      const usdtFree = balances["USDT"]?.free || 0
      const usdtLocked = balances["USDT"]?.locked || 0
      const usdtTotal = Math.round((usdtFree + usdtLocked) * 100) / 100
      const usdtPriceTry = priceMap.get("USDT") || 38.30
      const usdtTryValue = Math.round(usdtTotal * usdtPriceTry * 100) / 100

      let statusSummary = `Toplam Portföy: ${totalTryValue.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺ (Serbest TRY: ${freeTry.toFixed(2)} ₺`
      if (lockedTry > 0) statusSummary += `, Açık Emirde: ${lockedTry.toFixed(2)} ₺`
      if (usdtTotal > 0.1) statusSummary += `, Cüzdanda: $${usdtTotal.toFixed(2)} USDT`
      statusSummary += ")"

      return NextResponse.json({
        ok: true,
        exchange: "BINANCE_TR",
        canTrade: accountData.canTrade === 1 || accountData.canTrade === true,
        accountType: "SPOT",
        tryBalance,          // serbest TRY (eski compat)
        freeTry,             // serbest TRY nakit
        lockedTry,           // kilitli TRY (açık emirlerde)
        coinValueTry,        // coin varlıkların TRY karşılığı
        totalTryValue,       // TOPLAM portföy değeri (Binance'da görünen rakam)
        usdtFree,            // serbest USDT nakit
        usdtLocked,          // kilitli USDT
        usdtTotal,           // toplam USDT
        usdtPriceTry,        // USDT/TRY kuru
        usdtTryValue,        // USDT'nin TRY karşılığı
        balances,
        assetDetails,
        message: `Binance TR bağlantısı başarılı! ${statusSummary}`,
      })
    } else {
      const rawErr = json.msg || JSON.stringify(json)
      const httpStatus = res.status
      const keyPreview = cleanKey.length > 8 ? `${cleanKey.slice(0, 4)}...${cleanKey.slice(-4)} (uzunluk: ${cleanKey.length})` : cleanKey
      let userFriendlyMessage = `Binance TR Hata (HTTP ${httpStatus}, code: ${json.code}). Key: ${keyPreview}. Raw: ${rawErr}`
      if (json.code === -2015 || json.code === 3700 || (json.msg && json.msg.includes("Invalid API-key"))) {
        userFriendlyMessage = `Geçersiz API Anahtarı (code: ${json.code}). Gönderilen Key: ${keyPreview}. Raw: ${rawErr}`
      } else if (json.code === -1021) {
        userFriendlyMessage = "Zaman Aşımı / Sistem Saati Uyuşmazlığı."
      }
      return NextResponse.json(
        { ok: false, message: userFriendlyMessage, rawError: json.msg || JSON.stringify(json) },
        { status: 400 }
      )
    }
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error?.message || "Bilinmeyen sunucu hatası" },
      { status: 500 }
    )
  }
}
