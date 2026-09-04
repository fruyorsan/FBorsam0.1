import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

// Upstash Redis helper
async function redisCmd(command: string, ...args: (string | number)[]) {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  try {
    const parts = [command, ...args].map(encodeURIComponent).join("/")
    const res = await fetch(`${url}/${parts}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    console.error("[Redis OTP]", e)
    return null
  }
}

// In-memory fallback
const otpMemoryStore: Record<string, { code: string; expires: number; name?: string }> = {}

/**
 * POST /api/auth/otp
 * action: "send" | "verify"
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, email, code, name } = body

    const cleanEmail = String(email || "").trim().toLowerCase()
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return NextResponse.json({ error: "Geçerli bir e-posta adresi giriniz." }, { status: 400 })
    }

    // 1. KOD GÖNDERME
    if (action === "send") {
      const generatedCode = Math.floor(100000 + Math.random() * 900000).toString()
      const redisKey = `otp:${cleanEmail}`

      const redisRes = await redisCmd("set", redisKey, JSON.stringify({ code: generatedCode, name }), "EX", 300)
      if (!redisRes) {
        otpMemoryStore[cleanEmail] = {
          code: generatedCode,
          expires: Date.now() + 5 * 60 * 1000,
          name,
        }
      }

      console.log(`[DOĞRULAMA KODU] ${cleanEmail} -> KOD: ${generatedCode}`)

      let mailSent = false
      if (process.env.RESEND_API_KEY) {
        try {
          const resendRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "FBorsam Güvenlik <onboarding@resend.dev>",
              to: cleanEmail,
              subject: `${generatedCode} - FBorsam Giriş Doğrulama Kodunuz`,
              html: `
                <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 30px; border-radius: 12px; max-width: 500px; margin: auto;">
                  <h2 style="color: #38bdf8; margin-bottom: 8px;">FBorsam Terminal</h2>
                  <p style="color: #94a3b8; font-size: 14px;">Giriş yapmak veya hesap oluşturmak için doğrulama kodunuz:</p>
                  <div style="background-color: #1e293b; padding: 18px; border-radius: 8px; text-align: center; margin: 24px 0; border: 1px solid #334155;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #4ade80;">${generatedCode}</span>
                  </div>
                  <p style="color: #64748b; font-size: 12px;">Bu kod 5 dakika boyunca geçerlidir. Siz talep etmediyseniz bu e-postayı dikkate almayınız.</p>
                </div>
              `,
            }),
          })
          if (resendRes.ok) mailSent = true
        } catch (mailErr) {
          console.error("Mail gönderim hatası:", mailErr)
        }
      }

      return NextResponse.json({
        ok: true,
        message: mailSent 
          ? "Doğrulama kodu e-posta adresinize gönderildi." 
          : "Doğrulama kodu oluşturuldu.",
        mailSent,
        previewCode: !process.env.RESEND_API_KEY ? generatedCode : undefined,
      })
    }

    // 2. KOD DOĞRULAMA
    if (action === "verify") {
      const cleanCode = String(code || "").trim()
      if (!cleanCode) {
        return NextResponse.json({ error: "Lütfen 6 haneli doğrulama kodunu giriniz." }, { status: 400 })
      }

      const redisKey = `otp:${cleanEmail}`
      let savedData: { code: string; name?: string } | null = null

      const redisGet = await redisCmd("get", redisKey)
      if (redisGet && redisGet.result) {
        try {
          savedData = JSON.parse(redisGet.result)
        } catch {
          savedData = { code: String(redisGet.result) }
        }
      } else if (otpMemoryStore[cleanEmail]) {
        const mem = otpMemoryStore[cleanEmail]
        if (Date.now() <= mem.expires) {
          savedData = { code: mem.code, name: mem.name }
        } else {
          delete otpMemoryStore[cleanEmail]
        }
      }

      if (!savedData) {
        return NextResponse.json({ error: "Kodun süresi dolmuş veya hiç talep edilmemiş. Lütfen yeni kod isteyin." }, { status: 400 })
      }

      if (savedData.code !== cleanCode) {
        return NextResponse.json({ error: "Geçersiz doğrulama kodu. Lütfen kontrol edip tekrar deneyin." }, { status: 400 })
      }

      await redisCmd("del", redisKey)
      delete otpMemoryStore[cleanEmail]

      const response = NextResponse.json({
        ok: true,
        verified: true,
        email: cleanEmail,
        name: savedData.name || cleanEmail.split("@")[0],
      })

      response.cookies.set("f_borsam_session", `auth_${Date.now()}`, {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
      })

      return response
    }

    return NextResponse.json({ error: "Geçersiz istek türü." }, { status: 400 })
  } catch (err: any) {
    console.error("OTP API hatası:", err)
    return NextResponse.json({ error: "Sunucu hatası oluştu." }, { status: 500 })
  }
}
