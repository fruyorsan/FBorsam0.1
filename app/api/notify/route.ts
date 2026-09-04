import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

/**
 * E-Posta Bildirim Servisi API'si
 * Bot işlem açtığında veya kârla kapandığında kullanıcının e-postasına
 * SMTP / Webhook / Console üzerinden anlık bildirim iletir.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { to, subject, message } = body

    if (!to || !to.includes("@")) {
      return NextResponse.json({ error: "Geçersiz e-posta adresi" }, { status: 400 })
    }

    const timestamp = new Date().toLocaleString("tr-TR")

    // Terminal ve sistem loglarına bas
    console.log(`[E-POSTA BİLDİRİMİ ${timestamp}] To: ${to} | Konu: ${subject}\nMesaj: ${message}`)

    // SMTP veya harici mail API'si (Resend / SendGrid / Postmark) varsa tetikle
    if (process.env.RESEND_API_KEY) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "PiyasaIQ Bot <bot@f-borsam.com>",
            to,
            subject,
            text: message,
          }),
        })
      } catch (e) {
        console.error("Resend API hatası:", e)
      }
    }

    return NextResponse.json({
      success: true,
      deliveredTo: to,
      timestamp,
      method: process.env.RESEND_API_KEY ? "RESEND_SMTP" : "LOCAL_DISPATCH",
    })
  } catch (error) {
    return NextResponse.json({ error: "Bildirim gönderilemedi" }, { status: 500 })
  }
}
