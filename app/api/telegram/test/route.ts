import { NextRequest, NextResponse } from "next/server"
import { sendTelegramMessage, getTelegramConfig } from "@/lib/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { botToken, chatId, text, pin } = body

    const defaultMessage = `🤖 <b>[Pundik Bağlandı!]</b> 🚀
Patron selam! Telegram bildirimlerin başarıyla aktif edildi.

Bundan sonra:
• Her yeni işlem açıldığında 🚀
• Hedef kâr veya stop alındığında 🎯
• 4 saatlik sermaye koruma çıkışlarında 🛡️
• Gün sonu kâr ve yüzdelik getiri bülteninde 📊

Anında cebinde olacağım. Bol kazançlar dilerim! 💰`

    const message = text || defaultMessage

    const res = await sendTelegramMessage(message, {
      botToken: botToken ? String(botToken).trim() : undefined,
      chatId: chatId ? String(chatId).trim() : undefined,
      pin: Boolean(pin),
    })

    if (!res.ok) {
      let errMsg = res.error || "Mesaj gönderilemedi"
      if (errMsg.toLowerCase().includes("chat not found")) {
        errMsg = "Telegram Hatası (Chat Not Found): Botunuzla henüz Telegram'da konuşma başlatmadınız! Lütfen Telegram'da oluşturduğunuz botun içine girip bir kez alttaki 'BAŞLAT' (Start) butonuna tıklayın, ardından tekrar 'Test Mesajı Gönder' butonuna basın."
      }
      return NextResponse.json({ ok: false, error: errMsg }, { status: 400 })
    }

    return NextResponse.json({ ok: true, message: "Test mesajı Telegram'a başarıyla iletildi!" })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Test başarısız" }, { status: 500 })
  }
}
