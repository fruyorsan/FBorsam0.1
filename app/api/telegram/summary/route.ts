import { NextRequest, NextResponse } from "next/server"
import { sendTelegramDailySummary, calculateTodayStats } from "@/lib/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const stats = await calculateTodayStats()
    return NextResponse.json({ ok: true, stats })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { botToken, chatId } = body

    const res = await sendTelegramDailySummary(
      botToken && chatId ? { botToken: String(botToken).trim(), chatId: String(chatId).trim() } : undefined
    )

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error || "Özet gönderilemedi" }, { status: 400 })
    }

    const stats = await calculateTodayStats()
    return NextResponse.json({ ok: true, message: "Günlük seans bülteni Telegram'a gönderildi!", stats })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Özet gönderilemedi" }, { status: 500 })
  }
}
