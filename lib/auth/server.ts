import { createNeonAuth } from "@neondatabase/auth/next/server"
import { NextResponse, type NextRequest } from "next/server"

const hasNeonConfig = Boolean(
  process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET
)

export const isNeonConfigured = hasNeonConfig

export const auth = hasNeonConfig
  ? createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL!,
      cookies: {
        secret: process.env.NEON_AUTH_COOKIE_SECRET!,
      },
      logLevel: process.env.NODE_ENV === "development" ? "warn" : "error",
    })
  : {
      handler: () => ({
        GET: async (req: NextRequest) => {
          return NextResponse.json({
            status: "ready",
            configured: false,
            message: "Neon Auth ortam değişkenleri tanımlanmamış. Yerel demo oturumu aktiftir.",
          })
        },
        POST: async (req: NextRequest) => {
          try {
            const body = await req.json().catch(() => ({}))
            const email = body?.email || "demo@f-borsam.com"
            const name = body?.name || "Piyasa Analisti"
            
            const response = NextResponse.json({
              user: {
                id: "user_demo_session",
                email,
                name,
              },
              session: {
                id: "session_demo_123",
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              },
            })

            response.cookies.set("f_borsam_session", "demo_authenticated", {
              path: "/",
              httpOnly: true,
              sameSite: "lax",
              maxAge: 60 * 60 * 24 * 7,
            })

            return response
          } catch {
            return NextResponse.json(
              { error: { message: "Giriş işlemi gerçekleştirilemedi." } },
              { status: 400 }
            )
          }
        },
      }),
      middleware: () => {
        return (req: NextRequest) => {
          return NextResponse.next()
        }
      },
    }
