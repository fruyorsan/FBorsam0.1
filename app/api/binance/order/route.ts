import { NextResponse } from "next/server"
import { executeBinanceTrSpotOrder, executeBinanceFuturesOrder, getSpotAccountAssets, getFuturesRecentIncome } from "@/lib/binance-helpers"
import { getServerBinance, getServerBinanceGlobal, getServerPositions, setServerPositions, setServerBalance, appendServerLog, appendServerHistory, setServerManualSellCooldown, setServerLossCooldown, clearFuturesPositionMeta, getFuturesEntryTime } from "@/lib/bot/server-state"
import { notifyTradeExit, notifyFuturesTradeExit } from "@/lib/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      symbol,         // "CHZ", "CHZ_TRY", "PENGU", "BTCUSDT" etc.
      side,           // "BUY" | "SELL"
      type = "MARKET",
      quoteOrderQty,  // TRY amount for BUY
      quantity,       // Coin amount for SELL
      price,          // For LIMIT orders
      isPartial,
      apiKey,
      apiSecret,
      exchangeType = "BINANCE_TR", // "BINANCE_TR" | "BINANCE_FUTURES" | "BINANCE_GLOBAL"
      leverage = 1,
    } = body

    if (!symbol || !side) {
      return NextResponse.json(
        { ok: false, message: "Sembol ve işlem yönü (BUY/SELL) zorunludur." },
        { status: 400 }
      )
    }

    let cleanKey = String(apiKey || "").trim()
    let cleanSecret = String(apiSecret || "").trim()

    if (!cleanKey || !cleanSecret) {
      if (exchangeType === "BINANCE_FUTURES" || leverage > 1) {
        const serverGlobal = await getServerBinanceGlobal()
        if (serverGlobal?.apiKey && serverGlobal?.apiSecret) {
          cleanKey = serverGlobal.apiKey.trim()
          cleanSecret = serverGlobal.apiSecret.trim()
        }
      } else {
        const serverBinance = await getServerBinance()
        if (serverBinance?.apiKey && serverBinance?.apiSecret) {
          cleanKey = serverBinance.apiKey.trim()
          cleanSecret = serverBinance.apiSecret.trim()
        }
      }
    }

    if (!cleanKey || !cleanSecret) {
      return NextResponse.json(
        { ok: false, message: "Binance API Key ve API Secret bulunamadı. Lütfen ayarlardan bağlayın." },
        { status: 400 }
      )
    }

    // ⚡ BINANCE GLOBAL FUTURES (KALDIRAÇLI İŞLEM)
    if (exchangeType === "BINANCE_FUTURES" || leverage > 1) {
      const isSell = side.toUpperCase() === "SELL"
      const cleanSym = symbol.replace(/(_TRY|TRY|_USDT|USDT)$/i, "").toUpperCase()

      const futuresRes = await executeBinanceFuturesOrder({
        apiKey: cleanKey,
        apiSecret: cleanSecret,
        symbol,
        side: side.toUpperCase() as "BUY" | "SELL",
        type: type.toUpperCase() as "MARKET" | "LIMIT",
        quantity: quantity ? Number(quantity) : undefined,
        price: price ? Number(price) : undefined,
        leverage: Number(leverage),
        reduceOnly: isSell,
      })

      if (!futuresRes.ok) {
        return NextResponse.json(
          { ok: false, message: futuresRes.error || "Futures emri gerçekleştirilemedi." },
          { status: 400 }
        )
      }

      // Satış başarılıysa meta temizle, geçmişe ve loglara kaydet
      if (isSell) {
        try {
          const entryTime = (await getFuturesEntryTime(cleanSym)) || Date.now()
          await clearFuturesPositionMeta(cleanSym)
          await setServerManualSellCooldown(90) // 1.5 dakika (90s) manuel mola

          // Kısa bir bekleme ile Binance'ten gerçekleşen PnL'i çek
          await new Promise((r) => setTimeout(r, 600))
          const incomes = await getFuturesRecentIncome(cleanKey, cleanSecret, 5)
          const matchedIncome = incomes.find((inc) => inc.symbol.replace(/USDT$/i, "").toUpperCase() === cleanSym)
          const pnlUsdt = matchedIncome ? matchedIncome.income : 0
          const closePrice = futuresRes.avgPrice || price || 0
          const executedAmt = futuresRes.executedQty || quantity || 0

          // USDT/TRY kuru
          let usdtTryRate = 49.14
          try {
            const rRes = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=USDTTRY", { signal: AbortSignal.timeout(2000) })
            const rJson = await rRes.json()
            if (parseFloat(rJson?.price) > 0) usdtTryRate = parseFloat(rJson.price)
          } catch {}

          const netPnlTry = pnlUsdt * usdtTryRate
          const marginUsdt = (executedAmt * closePrice) / (leverage || 5)
          const roiPct = marginUsdt > 0 ? (pnlUsdt / marginUsdt) * 100 : 0

          await appendServerHistory({
            id: `futures-closed-${cleanSym}-${Date.now()}`,
            symbol: cleanSym,
            name: `${cleanSym} (${leverage || 5}x Vadeli)`,
            side: "BUY",
            entryPrice: closePrice,
            currentPrice: closePrice,
            closePrice: closePrice,
            amount: executedAmt,
            totalTry: marginUsdt,
            pnl: pnlUsdt,
            netPnlTry,
            pnlPercent: roiPct,
            openedAt: new Date(entryTime).toLocaleTimeString("tr-TR"),
            openedTimestamp: entryTime,
            status: "CLOSED",
            closeReason: "Kullanıcı Manuel Çıkış (Futures)",
            closedAt: new Date().toISOString(),
            closedTimestamp: Date.now(),
            triggerType: "MANUAL",
            orderType: "MARKET",
            isFutures: true,
            leverage: Number(leverage || 5),
            exchange: "BINANCE_GLOBAL_FUTURES",
          } as any)

          await appendServerLog({
            id: `log-futures-sell-${Date.now()}`,
            time: new Date().toLocaleTimeString("tr-TR"),
            type: "SELL",
            symbol: cleanSym,
            message: `⏸️ [MANUEL FUTURES SATIŞ] ${cleanSym} ${leverage}x pozisyonu kapatıldı. PnL: ${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt.toFixed(4)} USDT (≈ ${netPnlTry >= 0 ? "+" : ""}${netPnlTry.toFixed(2)} ₺).`,
          })

          notifyFuturesTradeExit({
            symbol: cleanSym,
            leverage: Number(leverage || 5),
            pnlUsdt,
            leveragedRoiPct: roiPct,
            exitPrice: closePrice,
            entryPrice: closePrice,
            reason: "Kullanıcı Arayüzünden Manuel Olarak Nakite Geçildi",
          }).catch(() => {})
        } catch (e: any) {
          console.error("Manual futures sell sync error:", e)
        }
      }

      return NextResponse.json({
        ok: true,
        orderId: futuresRes.orderId,
        executedQty: futuresRes.executedQty,
        avgPrice: futuresRes.avgPrice,
        mode: "FUTURES",
        leverage,
      })
    }

    const res = await executeBinanceTrSpotOrder({
      symbol,
      side: side.toUpperCase() as "BUY" | "SELL",
      type: type.toUpperCase() as "MARKET" | "LIMIT",
      quoteOrderQty: quoteOrderQty ? Number(quoteOrderQty) : undefined,
      quantity: quantity ? Number(quantity) : undefined,
      price: price ? Number(price) : undefined,
      isPartial: Boolean(isPartial),
      apiKey: cleanKey,
      apiSecret: cleanSecret,
    })

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: res.error || "Emir borsada gerçekleştirilemedi." },
        { status: 400 }
      )
    }

    // Satış başarılıysa sunucu pozisyonunu ve bakiyesini anında senkronize et
    const cleanSym = symbol.replace(/(_TRY|TRY)$/i, "").toUpperCase()
    if (side.toUpperCase() === "SELL") {
      try {
        const positions = await getServerPositions()
        const targetPos = positions.find((p) => p.symbol.toUpperCase() === cleanSym)
        const nextPositions = positions.filter((p) => p.symbol.toUpperCase() !== cleanSym)
        await setServerPositions(nextPositions)

        const wallet = await getSpotAccountAssets(cleanKey, cleanSecret)
        if (typeof wallet.freeTry === "number") {
          await setServerBalance(wallet.freeTry)
        }

        if (targetPos) {
          const closePrice = res.cummulativeQuoteQty && res.executedQty && res.executedQty > 0
            ? res.cummulativeQuoteQty / res.executedQty
            : targetPos.currentPrice

          const currentLegPnl = (res.cummulativeQuoteQty || targetPos.totalTry) - targetPos.totalTry
          const totalPnlTry = (targetPos.partialSold ? (targetPos.partialSoldPnl || 0) : 0) + currentLegPnl
          const fullAmount = (targetPos.amount || 0) + (targetPos.partialSold ? (targetPos.partialSoldAmount || 0) : 0)
          const initialInvested = targetPos.initialTotalTry || (fullAmount * targetPos.entryPrice)
          const pnlPct = initialInvested > 0 ? (totalPnlTry / initialInvested) * 100 : 0

          await appendServerHistory({
            ...targetPos,
            status: "CLOSED",
            amount: fullAmount,
            totalTry: initialInvested,
            closePrice,
            closeReason: "Kullanıcı Manuel Çıkış",
            closedAt: new Date().toLocaleTimeString("tr-TR"),
            closedTimestamp: Date.now(),
            pnl: totalPnlTry,
            pnlPercent: pnlPct,
            netPnlTry: totalPnlTry,
          })

          notifyTradeExit(
            {
              ...targetPos,
              status: "CLOSED",
              amount: fullAmount,
              totalTry: initialInvested,
              closePrice,
              closeReason: "Kullanıcı Manuel Çıkış",
              pnl: totalPnlTry,
              pnlPercent: pnlPct,
              netPnlTry: totalPnlTry,
            },
            "Kullanıcı Manuel Çıkış",
            typeof wallet.freeTry === "number" ? wallet.freeTry : undefined
          ).catch(() => {})
        }

        // ⏸️ Kullanıcı manuel satış yaptı: Bot karışıklığı önlemek için yeni alımlara 1.5 dakika (90s) mola verir
        await setServerManualSellCooldown(90)
        // 🛡️ Kullanıcının manuel kapattığı coini en az 30 dakika tekrar alma! (Kullanıcı kararına saygı)
        await setServerLossCooldown(cleanSym, 1800)

        await appendServerLog({
          id: `log-sell-${Date.now()}`,
          time: new Date().toLocaleTimeString("tr-TR"),
          type: "SELL",
          symbol: cleanSym,
          message: `[MANUEL SATIŞ] ${cleanSym} pozisyonu kapatıldı! Karışıklığı önlemek için bot yeni alımlara 1 dakika mola verdi. (Emir ID: ${res.orderId})`,
        })
      } catch (syncErr) {
        console.warn("Sell sync error:", syncErr)
      }
    }

    return NextResponse.json({
      ok: true,
      orderId: res.orderId,
      status: res.status,
      executedQty: res.executedQty,
      cummulativeQuoteQty: res.cummulativeQuoteQty,
      message: `${symbol} için ${side} emri başarıyla iletildi.`,
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, message: `Borsa bağlantı hatası: ${err?.message || err}` },
      { status: 500 }
    )
  }
}
