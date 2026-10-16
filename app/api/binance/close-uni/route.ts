import { NextResponse } from "next/server"
import { getServerBinanceGlobal, clearFuturesPositionMeta } from "@/lib/bot/server-state"
import { executeBinanceFuturesOrder, cancelFuturesAllOpenOrders, getFuturesPositions } from "@/lib/binance-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const creds = await getServerBinanceGlobal()
    if (!creds?.apiKey || !creds?.apiSecret) {
      return NextResponse.json({ ok: false, message: "Binance Global API anahtarları bulunamadı." }, { status: 400 })
    }

    // 1. Önce aktif futures pozisyonlarını çek
    const positions = await getFuturesPositions(creds.apiKey, creds.apiSecret)
    const uniPos = Array.isArray(positions) ? positions.find((p: any) => p.symbol === "UNIUSDT") : null

    if (!uniPos || Math.abs(uniPos.positionAmt) === 0) {
      await clearFuturesPositionMeta("UNI")
      await cancelFuturesAllOpenOrders(creds.apiKey, creds.apiSecret, "UNIUSDT").catch(() => {})
      return NextResponse.json({ ok: true, message: "UNI pozisyonu zaten kapalı." })
    }

    // 2. Bekleyen tüm açık emirleri iptal et
    await cancelFuturesAllOpenOrders(creds.apiKey, creds.apiSecret, "UNIUSDT").catch(() => {})

    // 3. Ters yönde MARKET emri atarak pozisyonu anında kapat
    const amt = Math.abs(uniPos.positionAmt)
    const side = uniPos.positionAmt > 0 ? "SELL" : "BUY"

    const orderRes = await executeBinanceFuturesOrder({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      symbol: "UNIUSDT",
      side,
      type: "MARKET",
      quantity: amt,
      reduceOnly: true,
      leverage: uniPos.leverage || 10,
    })

    if (!orderRes.ok) {
      return NextResponse.json({ ok: false, message: orderRes.error || "UNI kapatma emri başarısız oldu." }, { status: 500 })
    }

    await clearFuturesPositionMeta("UNI")

    return NextResponse.json({
      ok: true,
      message: `UNI/USDT ${amt} adet ${uniPos.leverage}x vadeli pozisyonu başarıyla kapatıldı!`,
      order: orderRes,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, message: err.message }, { status: 500 })
  }
}

export async function GET(req: Request) {
  return POST(req)
}
