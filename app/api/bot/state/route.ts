import { NextRequest, NextResponse } from "next/server"
import {
  getFullServerState,
  setServerStrategy,
  setServerActive,
  setServerBalance,
  setServerInitialBalance,
} from "@/lib/bot/server-state"
import { getClientIp, checkRateLimit, rateLimitResponse } from "@/lib/security"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET — UI'ın sunucudan mevcut bot durumunu çektiği endpoint */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = checkRateLimit(`botstate:${ip}`, 30, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  try {
    const state = await getFullServerState()
    return NextResponse.json({ ok: true, ...state, fetchedAt: Date.now() })
  } catch (e) {
    return NextResponse.json({ ok: false, error: "State okunamadı" }, { status: 500 })
  }
}

/** POST — UI'ın strateji/aktiflik güncellemesi gönderdiği endpoint */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = checkRateLimit(`botstate:post:${ip}`, 20, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  try {
    const body = await request.json()
    const updates: string[] = []

    if (body.strategy !== undefined) {
      await setServerStrategy(body.strategy)
      updates.push("strategy")
    }
    if (body.active !== undefined) {
      await setServerActive(body.active)
      updates.push("active")
    }
    if (body.balance !== undefined) {
      await setServerBalance(body.balance)
      updates.push("balance")
    }
    if (body.initialBalance !== undefined) {
      await setServerInitialBalance(body.initialBalance)
      updates.push("initialBalance")
    }

    return NextResponse.json({ ok: true, updated: updates })
  } catch (e) {
    return NextResponse.json({ ok: false, error: "State güncellenemedi" }, { status: 500 })
  }
}
