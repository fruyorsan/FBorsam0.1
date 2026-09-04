import { NextResponse, type NextRequest } from "next/server"

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Sadece ana sayfayı koru
  if (pathname === "/") {
    // Oturum çerezlerini kontrol et
    const sessionCookie = req.cookies.get("f_borsam_session")?.value ||
      req.cookies.get("__session")?.value ||
      req.cookies.get("neon_auth_session")?.value

    if (!sessionCookie) {
      const loginUrl = new URL("/auth/sign-in", req.url)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/"],
}

