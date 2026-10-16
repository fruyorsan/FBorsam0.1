import { NextResponse } from "next/server"
import { getMexcAccountBalance } from "@/lib/mexc-helpers"
import { getServerMexc } from "@/lib/bot/server-state"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const creds = await getServerMexc()
    if (!creds?.apiKey || !creds?.apiSecret) {
      return NextResponse.json(
        { ok: false, message: "MEXC API anahtarları henüz girilmemiş." },
        { status: 400 }
      )
    }
    const balance = await getMexcAccountBalance(creds.apiKey, creds.apiSecret)
    if (!balance.ok) {
      return NextResponse.json({ ok: false, message: balance.error || "MEXC bağlantı hatası" }, { status: 400 })
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
        { ok: false, message: "MEXC API Key ve Secret Key zorunludur." },
        { status: 400 }
      )
    }

    const cleanKey = String(apiKey).trim()
    const cleanSecret = String(apiSecret).trim()

    const balance = await getMexcAccountBalance(cleanKey, cleanSecret)
    if (!balance.ok) {
      return NextResponse.json(
        { ok: false, message: balance.error || "MEXC vadeli hesabı doğrulanamadı. API izinlerini kontrol edin." },
        { status: 400 }
      )
    }

    return NextResponse.json({ ok: true, balances: balance })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error?.message || "Sunucu hatası" },
      { status: 500 }
    )
  }
}
