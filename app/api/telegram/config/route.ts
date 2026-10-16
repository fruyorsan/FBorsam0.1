import { NextRequest, NextResponse } from "next/server"
import { getTelegramConfig, setTelegramConfig } from "@/lib/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const config = await getTelegramConfig()
    if (!config || !config.botToken) {
      return NextResponse.json({
        configured: false,
        enabled: false,
        maskedToken: "",
        chatId: "",
      })
    }
    // Güvenlik için token'ı maskele (123456...abcd)
    const token = config.botToken
    const masked = token.length > 10 ? token.slice(0, 6) + "••••••••" + token.slice(-4) : "••••••••"

    return NextResponse.json({
      configured: true,
      enabled: config.enabled ?? true,
      maskedToken: masked,
      chatId: config.chatId || "",
      notifyOnBuy: config.notifyOnBuy ?? true,
      notifyOnSell: config.notifyOnSell ?? true,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Hata oluştu" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { botToken, chatId, enabled, notifyOnBuy, notifyOnSell } = body

    const updated = await setTelegramConfig({
      botToken,
      chatId,
      enabled: enabled ?? true,
      notifyOnBuy: notifyOnBuy ?? true,
      notifyOnSell: notifyOnSell ?? true,
    })

    return NextResponse.json({
      ok: true,
      message: "Telegram ayarları başarıyla kaydedildi.",
      enabled: updated.enabled,
      chatId: updated.chatId,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Ayarlar kaydedilemedi" }, { status: 500 })
  }
}
