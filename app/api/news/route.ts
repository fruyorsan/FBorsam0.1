import { NextRequest, NextResponse } from "next/server"
import { getLiveNews, getMacroBarometer } from "@/lib/news-feed"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get("refresh") === "1"
    const news = await getLiveNews(force)
    const barometer = await getMacroBarometer(news)

    return NextResponse.json({
      ok: true,
      news,
      barometer,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Haberler yüklenemedi", news: [], barometer: null },
      { status: 500 }
    )
  }
}
