import { NextRequest, NextResponse } from "next/server"
import {
  getServerBinance,
  setServerPositions,
  setServerBalance,
  appendServerLog,
  getFullServerState,
  setServerManualSellCooldown,
  setPendingLimitOrders,
} from "@/lib/bot/server-state"
import { emergencySellAll, getSpotAccountAssets } from "@/lib/binance-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(_req: NextRequest) {
  try {
    const creds = await getServerBinance()
    let soldList: string[] = []
    let totalGained = 0
    let finalBalance = 0

    if (creds?.connected && creds?.apiKey && creds?.apiSecret) {
      const res = await emergencySellAll(creds.apiKey, creds.apiSecret)
      soldList = res.soldList
      totalGained = res.totalGainedTry

      // Güncel serbest TRY bakiyesini çek
      const wallet = await getSpotAccountAssets(creds.apiKey, creds.apiSecret)
      finalBalance = wallet.freeTry
      await setServerBalance(finalBalance)
    } else {
      // Simülasyon hesabı ise tüm pozisyonları kapat ve parayı iade et
      const state = await getFullServerState()
      const totalPosVal = (state.positions || []).reduce((sum, p) => sum + (p.totalTry || 0), 0)
      finalBalance = (state.balance || 0) + totalPosVal
      await setServerBalance(finalBalance)
    }

    // Pozisyon listesini ve bekleyen limit emirleri tamamen sıfırla
    await setServerPositions([])
    await setPendingLimitOrders([])

    // ⏸️ Acil satış sonrası botun karışıklığı önlemek için 1.5 dakika (90s) beklemesi
    await setServerManualSellCooldown(90)

    await appendServerLog({
      id: `log-emergency-${Date.now()}`,
      time: new Date().toLocaleTimeString("tr-TR"),
      type: "SELL",
      message: `[ACİL SATIŞ TAMAMLANDI] Bütün açık emirler iptal edildi. Satılan varlıklar: ${
        soldList.length > 0 ? soldList.join(", ") : "Açık coin bulunamadı"
      }. Kasa serbest nakit TRY: ${finalBalance.toFixed(2)} ₺`,
    })

    return NextResponse.json({
      ok: true,
      soldList,
      totalGained,
      finalBalance,
      message: `Tüm açık pozisyonlar ve varlıklar satıldı! Kasa: ${finalBalance.toFixed(2)} TL`,
    })
  } catch (error: any) {
    console.error("[EMERGENCY SELL] Error:", error)
    return NextResponse.json(
      { ok: false, message: error?.message || "Acil satış sırasında bir hata oluştu." },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
