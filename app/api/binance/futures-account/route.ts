import { NextResponse } from "next/server"
import { getFuturesAccountBalance } from "@/lib/binance-helpers"
import { getServerBinanceGlobal, setServerBinanceGlobal } from "@/lib/bot/server-state"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const globalCreds = await getServerBinanceGlobal()
    if (!globalCreds?.apiKey || !globalCreds?.apiSecret) {
      return NextResponse.json(
        { ok: false, message: "Binance Global API anahtarları henüz girilmemiş." },
        { status: 400 }
      )
    }
    const balance = await getFuturesAccountBalance(globalCreds.apiKey, globalCreds.apiSecret)
    if (!balance.ok) {
      return NextResponse.json({ ok: false, message: balance.error || "Futures bağlantı hatası" }, { status: 400 })
    }
    return NextResponse.json({ ok: true, balances: balance })
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
        { ok: false, message: "Binance Global API Key ve API Secret zorunludur." },
        { status: 400 }
      )
    }

    const cleanKey = String(apiKey).trim()
    const cleanSecret = String(apiSecret).trim()

    const balance = await getFuturesAccountBalance(cleanKey, cleanSecret)
    if (!balance.ok) {
      return NextResponse.json(
        { ok: false, message: balance.error || "Binance Global Futures doğrulanamadı. API izinlerini kontrol edin (Futures yetkisi açık olmalı)." },
        { status: 400 }
      )
    }

    // 🚀 Otomatik kalıcı kayıt: Doğrulanmış anahtarları doğrudan cron için kaydet
    await setServerBinanceGlobal({
      apiKey: cleanKey,
      apiSecret: cleanSecret,
      accountName: "Binance Global Futures",
      accountType: "REAL",
      exchangeType: "BINANCE_GLOBAL",
      connected: true,
      realBalanceTry: 0,
    })

    return NextResponse.json({ ok: true, balances: balance })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error?.message || "Sunucu hatası" },
      { status: 500 }
    )
  }
}
