import { NextResponse, type NextRequest } from "next/server"

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 1. Cron, API veya statik dosyalara dokunma
  if (
    pathname.startsWith("/api/bot/cron") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico")
  ) {
    return NextResponse.next()
  }

  const sessionCookie = req.cookies.get("f_borsam_session")?.value
  const isOwnerAuthenticated = Boolean(
    sessionCookie && sessionCookie.startsWith("owner_session_")
  )

  // 2. Ana sayfa koruması: Sadece geçerli yönetici oturumu olanlar girebilir
  if (pathname === "/") {
    if (!isOwnerAuthenticated) {
      const loginUrl = new URL("/auth/sign-in", req.url)
      return NextResponse.redirect(loginUrl)
    }
  }

  // 3. Zaten giriş yapmışsa /auth/sign-in sayfasına girince tekrar şifre sormadan ana sayfaya at
  if (pathname.startsWith("/auth/sign-in")) {
    if (isOwnerAuthenticated) {
      const homeUrl = new URL("/", req.url)
      return NextResponse.redirect(homeUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/", "/auth/sign-in"],
}
