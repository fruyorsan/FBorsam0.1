import { NextRequest, NextResponse } from "next/server"
import { getServerPositions, setServerPositions, appendServerLog } from "@/lib/bot/server-state"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function formatSmartPrice(price: number): number {
  if (!price || isNaN(price) || price <= 0) return 0
  if (price < 0.001) return Number(price.toFixed(8))
  if (price < 1) return Number(price.toFixed(6))
  if (price < 10) return Number(price.toFixed(4))
  return Number(price.toFixed(2))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { symbol, takeProfitPct, takeProfitPrice } = body

    if (!symbol) {
      return NextResponse.json({ ok: false, error: "Sembol zorunludur" }, { status: 400 })
    }

    const clean = String(symbol).toUpperCase().replace(/(_TRY|TRY|_USDT|USDT)$/i, "")
    const positions = await getServerPositions()
    const targetIdx = positions.findIndex(
      (p) => p.symbol.toUpperCase().replace(/(_TRY|TRY)$/i, "") === clean
    )

    if (targetIdx === -1) {
      const { getServerBinanceGlobal, setFuturesCustomTp } = await import("@/lib/bot/server-state")
      const { getFuturesPositions } = await import("@/lib/binance-helpers")
      const globalCreds = await getServerBinanceGlobal()
      if (globalCreds?.apiKey && globalCreds?.apiSecret) {
        const futuresPositions = await getFuturesPositions(globalCreds.apiKey, globalCreds.apiSecret)
        const fPos = futuresPositions.find(p => {
          const s = p.symbol.replace(/USDT$/i, "").toUpperCase()
          return s === clean || s.replace(/^1000/, "") === clean.replace(/^1000/, "")
        })
        if (fPos) {
          const entry = fPos.entryPrice || 1
          let finalPct = 3.0
          let finalTpPrice = entry * 1.03
          if (typeof takeProfitPct === "number" && !isNaN(takeProfitPct) && takeProfitPct > 0) {
            finalPct = Number(takeProfitPct.toFixed(2))
            finalTpPrice = formatSmartPrice(entry * (1 + takeProfitPct / 100))
          } else if (typeof takeProfitPrice === "number" && !isNaN(takeProfitPrice) && takeProfitPrice > entry) {
            finalTpPrice = formatSmartPrice(takeProfitPrice)
            finalPct = Number((((takeProfitPrice - entry) / entry) * 100).toFixed(2))
          }
          await setFuturesCustomTp(clean, finalPct)
          const actualSym = fPos.symbol.replace(/USDT$/i, "").toUpperCase()
          if (actualSym !== clean) {
            await setFuturesCustomTp(actualSym, finalPct)
          }
          await appendServerLog({
            id: `log-tp-update-${Date.now()}`,
            time: new Date().toLocaleTimeString("tr-TR"),
            type: "ALERT",
            symbol: clean,
            message: `🎯 [FUTURES HEDEF TP GÜNCELLENDİ]: ${clean} 5x Vadeli yeni hedefi: +%${finalPct} ($${finalTpPrice}). Bot bu hedefte otomatik kâr alacak!`,
          })
          return NextResponse.json({
            ok: true,
            message: `${clean} vadeli hedef kârı başarıyla güncellendi: +%${finalPct} ($${finalTpPrice})`,
            manualTpPct: finalPct,
            takeProfitPrice: finalTpPrice,
          })
        }
      }

      return NextResponse.json(
        { ok: false, error: `${clean} sembolüne ait açık spot veya vadeli pozisyon bulunamadı` },
        { status: 404 }
      )
    }

    const pos = { ...positions[targetIdx] }
    const entry = pos.entryPrice || 1

    if (typeof takeProfitPct === "number" && !isNaN(takeProfitPct) && takeProfitPct > 0) {
      pos.manualTpPct = Number(takeProfitPct.toFixed(2))
      pos.takeProfitPrice = formatSmartPrice(entry * (1 + takeProfitPct / 100))
    } else if (typeof takeProfitPrice === "number" && !isNaN(takeProfitPrice) && takeProfitPrice > entry) {
      pos.takeProfitPrice = formatSmartPrice(takeProfitPrice)
      pos.manualTpPct = Number((((takeProfitPrice - entry) / entry) * 100).toFixed(2))
    } else {
      return NextResponse.json(
        { ok: false, error: "Geçersiz hedef kâr değeri. Giriş fiyatından yüksek bir değer girin." },
        { status: 400 }
      )
    }

    positions[targetIdx] = pos
    await setServerPositions(positions)

    await appendServerLog({
      id: `log-tp-update-${Date.now()}`,
      time: new Date().toLocaleTimeString("tr-TR"),
      type: "ALERT",
      symbol: clean,
      message: `🎯 [MANUEL HEDEF TP GÜNCELLENDİ]: ${clean} yeni hedefi: +%${pos.manualTpPct} (${pos.takeProfitPrice} ₺). Bot bu hedefi 7/24 takip edecek!`,
    })

    return NextResponse.json({
      ok: true,
      message: `${clean} hedef kârı başarıyla güncellendi: +%${pos.manualTpPct} (${pos.takeProfitPrice} ₺)`,
      position: pos,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Güncelleme hatası" }, { status: 500 })
  }
}
