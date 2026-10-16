import { NextResponse } from "next/server"
import { getHalkaArzCalendar, formatHalkaArzTelegramMessage } from "@/lib/halka-arz"
import { sendTelegramMessage } from "@/lib/telegram"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const refresh = searchParams.get("refresh") === "true"

    const ipos = await getHalkaArzCalendar(refresh)
    return NextResponse.json({
      ok: true,
      count: ipos.length,
      ipos,
      updatedAt: new Date().toISOString(),
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Halka arz verileri çekilemedi" },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const code = body.code?.toUpperCase()

    const ipos = await getHalkaArzCalendar(false)
    const target = code ? ipos.find((i) => i.code === code) : ipos[0]

    if (!target) {
      return NextResponse.json({ ok: false, error: "Halka arz bulunamadı" }, { status: 404 })
    }

    const message = formatHalkaArzTelegramMessage(target)
    const sendRes = await sendTelegramMessage(message)

    return NextResponse.json({
      ok: sendRes.ok,
      targetCode: target.code,
      telegramResult: sendRes,
      preview: message,
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Bildirim gönderilemedi" },
      { status: 500 }
    )
  }
}
