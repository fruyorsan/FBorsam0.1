import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

// Sistem Sahibi / Yönetici Kimlik Bilgileri
const VALID_USERNAME = "fruyorsan"
const VALID_PASSWORD = "Babacık4__"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { username, password } = body

    const cleanUser = String(username || "").trim().toLowerCase()
    const cleanPass = String(password || "").trim()

    if (!cleanUser || !cleanPass) {
      return NextResponse.json(
        { ok: false, error: "Kullanıcı adı ve şifre gereklidir." },
        { status: 400 }
      )
    }

    if (cleanUser !== VALID_USERNAME || cleanPass !== VALID_PASSWORD) {
      return NextResponse.json(
        { ok: false, error: "Hatalı kullanıcı adı veya şifre!" },
        { status: 401 }
      )
    }

    // Doğrulama başarılı — 1 yıllık güvenli Yönetici Oturum Tokenı
    const sessionToken = `owner_session_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`

    const res = NextResponse.json({
      ok: true,
      user: {
        username: "Fruyorsan",
        role: "owner",
      },
    })

    // 1 Yıl (31536000 saniye) kalıcı çerez — her girişte tekrar sormaz
    res.cookies.set("f_borsam_session", sessionToken, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 31536000,
      secure: process.env.NODE_ENV === "production",
    })

    return res
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Sunucu hatası oluştu." },
      { status: 500 }
    )
  }
}
