import { NextRequest, NextResponse } from "next/server"
import {
  getFullServerState,
  setServerStrategy,
  setServerActive,
  setServerBalance,
  setServerInitialBalance,
  setServerBinance,
  setServerBinanceGlobal,
  setServerMexc,
  setServerPositions,
  getServerPositions,
  setServerHistory,
  appendServerHistory,
  setServerLogs,
  setDailyLoss,
  setCoinGeckoPrefilterState,
  getRedisDebugInfo,
  setServerSlotConfig,
  setServerExchangeSettings,
  getPendingLimitOrders,
} from "@/lib/bot/server-state"
import { getClientIp, checkRateLimit, rateLimitResponse } from "@/lib/security"
import { getSpotAccountAssets, getFuturesAccountBalance, getFuturesPositions, getFuturesRecentIncome, getFuturesUserTrades, futuresProxyFetch } from "@/lib/binance-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let cachedUsdtTry: { rate: number; updatedAt: number } | null = null

async function getUsdtTryRate(): Promise<number> {
  const now = Date.now()
  if (cachedUsdtTry && now - cachedUsdtTry.updatedAt < 60 * 1000) return cachedUsdtTry.rate
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=USDTTRY", {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    })
    const json = await res.json()
    const rate = parseFloat(json?.price)
    if (rate > 0) {
      cachedUsdtTry = { rate, updatedAt: now }
      return rate
    }
  } catch {}
  return cachedUsdtTry?.rate ?? 49.12
}

let cachedFearGreed: { value: number; classification: string; updatedAt: number } | null = null

async function getFearGreedIndex() {
  const now = Date.now()
  if (cachedFearGreed && now - cachedFearGreed.updatedAt < 5 * 60 * 1000) {
    return cachedFearGreed
  }
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    })
    if (res.ok) {
      const d = await res.json()
      if (d?.data?.[0]) {
        cachedFearGreed = {
          value: parseInt(d.data[0].value, 10) || 50,
          classification: d.data[0].value_classification || "Neutral",
          updatedAt: now,
        }
        return cachedFearGreed
      }
    }
  } catch {}
  return cachedFearGreed || { value: 50, classification: "Neutral", updatedAt: now }
}

let cachedTrPriceMap: { map: Record<string, number>; updatedAt: number } | null = null

async function getCachedTrPriceMap(): Promise<Record<string, number>> {
  const now = Date.now()
  if (cachedTrPriceMap && now - cachedTrPriceMap.updatedAt < 15 * 1000) {
    return cachedTrPriceMap.map
  }
  try {
    const priceRes = await fetch("https://api.binance.com/api/v3/ticker/price", {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    })
    if (priceRes.ok) {
      const prices: Array<{ symbol: string; price: string }> = await priceRes.json()
      const pMap: Record<string, number> = {}
      for (const p of prices) {
        if (p.symbol.endsWith("TRY")) pMap[p.symbol] = parseFloat(p.price) || 0
      }
      cachedTrPriceMap = { map: pMap, updatedAt: now }
      return pMap
    }
  } catch {}
  return cachedTrPriceMap?.map || {}
}

/** GET — UI'ın sunucudan mevcut bot durumunu çektiği endpoint */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = checkRateLimit(`botstate:${ip}`, 60, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  try {
    const [state, fearGreed, redisDebug, pendingOrders] = await Promise.all([
      getFullServerState(),
      getFearGreedIndex(),
      getRedisDebugInfo(),
      getPendingLimitOrders(),
    ])

    const serverBinance = state.binance
    let realBalanceTry = 0
    let freeTry = 0
    let lockedTry = 0
    let spotAssetsList: Array<{ asset: string; free: number; locked: number; total: number }> = []

    if (serverBinance && serverBinance.apiKey && serverBinance.apiSecret) {
      try {
        const spotAssets = await getSpotAccountAssets(serverBinance.apiKey, serverBinance.apiSecret)
        freeTry = spotAssets.freeTry || 0
        lockedTry = spotAssets.lockedTry || 0
        spotAssetsList = spotAssets.assets || []
        if (freeTry > 0) {
          state.balance = freeTry
        }

        // 💰 Bütün kripto varlıkların anlık piyasa değerini hesapla ve toplam bakiyeye ekle
        let cryptoTotalTry = 0
        if (spotAssetsList.length > 0) {
          const pMap = await getCachedTrPriceMap()
          for (const a of spotAssetsList) {
            const pr = pMap[`${a.asset}TRY`] || 0
            cryptoTotalTry += a.total * pr
          }
        }
        realBalanceTry = freeTry + lockedTry + cryptoTotalTry
      } catch (err) {
        console.warn("State route binance asset fetch warning:", err)
      }
    }

    const sessionCookie = request.cookies.get("f_borsam_session")?.value
    const isOwner = Boolean(
      sessionCookie && (
        sessionCookie.startsWith("owner_session_") ||
        sessionCookie.startsWith("active_session") ||
        sessionCookie.startsWith("auth_")
      )
    )

    const binanceInfo = (serverBinance && serverBinance.apiKey) ? {
      connected: true,
      accountName: serverBinance.accountName || "Binance TR",
      accountType: serverBinance.accountType || "REAL",
      maskedKey: `${serverBinance.apiKey.slice(0, 4)}••••${serverBinance.apiKey.slice(-4)}`,
      realBalanceTry,
      freeTry,
      lockedTry,
      assets: spotAssetsList,
    } : null

    // 🌐 Binance Global (Futures / Kaldıraçlı) Cüzdan & Açık Pozisyon Sorgulama
    const serverBinanceGlobal = state.binanceGlobal
    let binanceGlobalInfo: any = null
    if (serverBinanceGlobal && serverBinanceGlobal.apiKey && serverBinanceGlobal.apiSecret) {
      try {
        const [futuresAcc, openFuturesPos, recentIncomes] = await Promise.all([
          getFuturesAccountBalance(serverBinanceGlobal.apiKey, serverBinanceGlobal.apiSecret),
          getFuturesPositions(serverBinanceGlobal.apiKey, serverBinanceGlobal.apiSecret),
          getFuturesRecentIncome(serverBinanceGlobal.apiKey, serverBinanceGlobal.apiSecret, 25),
        ])
        const isConnected = futuresAcc.ok || openFuturesPos.length > 0 || (futuresAcc.availableBalanceUsdt || 0) > 0
        binanceGlobalInfo = {
          connected: isConnected,
          accountName: serverBinanceGlobal.accountName || "Binance Global Futures",
          accountType: "REAL",
          exchangeType: "BINANCE_GLOBAL",
          maskedKey: `${serverBinanceGlobal.apiKey.slice(0, 4)}••••${serverBinanceGlobal.apiKey.slice(-4)}`,
          totalWalletBalanceUsdt: futuresAcc.totalWalletBalanceUsdt || 0,
          availableBalanceUsdt: futuresAcc.availableBalanceUsdt || 0,
          totalUnrealizedPnlUsdt: futuresAcc.totalUnrealizedPnlUsdt || 0,
          activePositionsCount: openFuturesPos.filter(p => Math.abs(p.positionAmt) > 0).length,
          positions: openFuturesPos.filter(p => Math.abs(p.positionAmt) > 0),
          error: futuresAcc.error,
        }

        // 📜 Otomatik Vadeli İşlem Geçmişi Senkronizasyonu (Binance Global'de kapanan her işlemi doğrulanmış verilerle geçmişe ekle)
        if (Array.isArray(recentIncomes) && recentIncomes.length > 0) {
          const currentHist = Array.isArray(state.history) ? [...state.history] : []
          const activeFuturesSymbols = new Set(
            openFuturesPos.filter(p => Math.abs(p.positionAmt) > 0).map(p => p.symbol.replace(/USDT$/i, "").toUpperCase())
          )

          for (const inc of recentIncomes) {
            if (!inc.symbol?.endsWith("USDT") || Math.abs(inc.income) < 0.00001 || (inc.incomeType && inc.incomeType !== "REALIZED_PNL")) continue
            const cSym = inc.symbol.replace(/USDT$/i, "").toUpperCase()
            const incTime = Number(inc.time) || Date.now()

            // Eğer şu an açık bir pozisyon değilse ve geçmişte bu işlem yoksa kaydet
            const isAlreadyRecorded = currentHist.some(h =>
              (h as any).isFutures && (
                (inc.tranId && h.id?.includes(String(inc.tranId))) ||
                (Math.abs((h.closedTimestamp || 0) - incTime) < 30000 && h.symbol === cSym)
              )
            )

            if (!isAlreadyRecorded && !activeFuturesSymbols.has(cSym)) {
              let verifiedEntryPrice = 0
              let verifiedExitPrice = 0
              let verifiedAmount = 0
              let verifiedPnlPercent: number | null = null
              let isVerifiedTrade = false

              try {
                const trades = await getFuturesUserTrades(serverBinanceGlobal.apiKey, serverBinanceGlobal.apiSecret, cSym, 10)
                if (Array.isArray(trades) && trades.length > 0) {
                  const matchingSell = trades.find((t: any) =>
                    Math.abs(Number(t.time) - incTime) <= 60000 && t.side === "SELL"
                  ) || trades[0]

                  if (matchingSell) {
                    verifiedExitPrice = parseFloat(matchingSell.price || "0")
                    verifiedAmount = parseFloat(matchingSell.qty || "0")

                    const priorBuys = trades.filter((t: any) => t.side === "BUY" && Number(t.time) <= Number(matchingSell.time))
                    if (priorBuys.length > 0) {
                      const totalBuyQty = priorBuys.reduce((sum: number, b: any) => sum + parseFloat(b.qty || "0"), 0)
                      const totalBuyCost = priorBuys.reduce((sum: number, b: any) => sum + (parseFloat(b.qty || "0") * parseFloat(b.price || "0")), 0)
                      if (totalBuyQty > 0) {
                        verifiedEntryPrice = totalBuyCost / totalBuyQty
                      }
                    }

                    if (verifiedEntryPrice > 0 && verifiedExitPrice > 0) {
                      isVerifiedTrade = true
                      const priceDiffPct = ((verifiedExitPrice - verifiedEntryPrice) / verifiedEntryPrice) * 100
                      // Kaldıraç sabit 5x varsayılmaz; bilinen kaldıraçla ROI tahmini yapılır.
                      const levForRoi = Number((state as any)?.strategy?.leverage) || 3
                      verifiedPnlPercent = Number((priceDiffPct * levForRoi).toFixed(2))
                    }
                  }
                }
              } catch {}

              // Sadece doğrulanmış gerçek işlemleri geçmişe ekle (0 fiyatlı sahte kayıt oluşturma!)
              if (isVerifiedTrade && verifiedEntryPrice > 0 && verifiedExitPrice > 0) {
                const usdtRate = cachedUsdtTry?.rate || 49.14
                const netTry = inc.income * usdtRate
                const isProfit = inc.income >= 0
                // ⚠️ DÜRÜSTLÜK NOTU: Bu kayıtta açılış zamanı borsadan alınamaz; eskiden
                // `kapanış - 1 saat` diye UYDURULUYORDU ve bu yüzden "ortalama tutma süresi"
                // her zaman tam 1 saat çıkıyordu. Artık tahmin olduğu açıkça işaretlenir ve
                // analitik bu kayıtları tutma-süresi istatistiğinden dışlar.
                const estLeverage = Number((state as any)?.strategy?.leverage) || 3
                const newClosedPos: any = {
                  id: `futures-income-${inc.tranId || incTime}`,
                  symbol: cSym,
                  name: `${cSym} (Vadeli)`,
                  side: "BUY",
                  entryPrice: verifiedEntryPrice,
                  currentPrice: verifiedExitPrice,
                  closePrice: verifiedExitPrice,
                  amount: verifiedAmount,
                  totalTry: verifiedAmount * verifiedEntryPrice * usdtRate,
                  pnl: inc.income,
                  netPnlTry: netTry,
                  pnlPercent: verifiedPnlPercent,
                  openedAt: new Date(incTime - 3600000).toLocaleTimeString("tr-TR"),
                  openedTimestamp: incTime - 3600000,
                  openTimeEstimated: true,
                  status: "CLOSED",
                  closeReason: isProfit ? "Binance Global Kâr Satışı (Doğrulandı)" : "Binance Global Stop Loss (Doğrulandı)",
                  closedAt: new Date(incTime).toISOString(),
                  closedTimestamp: incTime,
                  triggerType: "MANUAL",
                  orderType: "MARKET",
                  isFutures: true,
                  leverage: estLeverage,
                  exchange: "BINANCE_GLOBAL_FUTURES",
                }
                currentHist.unshift(newClosedPos)
                appendServerHistory(newClosedPos).catch(() => {})
              }
            }
          }
          // Giriş fiyatı ve miktarı 0 olan hayalet/bozuk kayıtları arayüzden ve geçmişten temizle
          state.history = currentHist.filter((h: any) => !(h.isFutures && (!h.entryPrice || h.entryPrice <= 0) && (!h.amount || h.amount <= 0)))
        }
      } catch (err: any) {
        binanceGlobalInfo = {
          connected: false,
          maskedKey: `${serverBinanceGlobal.apiKey.slice(0, 4)}••••${serverBinanceGlobal.apiKey.slice(-4)}`,
          error: err.message,
        }
      }
    }

    // Dinamik Piyasa Rejimi (Ayı / Boğa / Dengeli)
    const fearVal = fearGreed?.value ?? 50
    let marketRegime: "BEAR" | "BULL" | "NEUTRAL" = "NEUTRAL"
    let adaptiveTpPct = 6.50
    let regimeLabel = "⚖️ DENGELİ PİYASA (Swing Hedef: +%6.50)"
    let marketRedRatioPct = 40
    let isBloodbathActive = false

    try {
      const [btcRes, all24Res] = await Promise.all([
        fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCTRY", {
          signal: AbortSignal.timeout(2000),
        }),
        fetch("https://api.binance.com/api/v3/ticker/24hr", {
          signal: AbortSignal.timeout(2500),
          cache: "no-store",
        }),
      ])

      let btc24h = 0
      if (btcRes.ok) {
        const btcData = await btcRes.json()
        btc24h = parseFloat(btcData.priceChangePercent) || 0
      }

      if (all24Res.ok) {
        const all24: any[] = await all24Res.json()
        let redCount = 0
        let totalLiquid = 0
        for (const item of all24) {
          if (!item.symbol || (!item.symbol.endsWith("TRY") && !item.symbol.endsWith("USDT"))) continue
          const qv = parseFloat(item.quoteVolume) || 0
          if (qv >= 1000000) {
            totalLiquid++
            const chg = parseFloat(item.priceChangePercent) || 0
            if (chg < 0) redCount++
          }
        }
        if (totalLiquid > 0) {
          marketRedRatioPct = Math.round((redCount / totalLiquid) * 100)
        }
      }

      isBloodbathActive = marketRedRatioPct >= 60 || btc24h <= -1.2
      if (isBloodbathActive) {
        marketRegime = "BEAR"
        adaptiveTpPct = 5.00
        regimeLabel = `🐻 %60+ AYI PİYASASI / DİP AVCISI (%${marketRedRatioPct} Kırmızı - Normal Alımlar Durduruldu, Alttan Toplama Pususu Devrede)`
      } else if (marketRedRatioPct <= 45 && btc24h >= 0.5) {
        marketRegime = "BULL"
        adaptiveTpPct = 8.50
        regimeLabel = `🐂 BOĞA PİYASASI (%${100 - marketRedRatioPct} Yeşil - İvme Güçlü)`
      } else {
        marketRegime = "NEUTRAL"
        adaptiveTpPct = 6.50
        regimeLabel = `⚖️ DENGELİ PİYASA (%${marketRedRatioPct} Kırmızı / %${100 - marketRedRatioPct} Yeşil)`
      }
    } catch {}

    // Canlı Açık Pozisyon Fiyatlarını ve K/Z'yi Binance'dan Anlık Güncelle
    if (Array.isArray(state.positions) && state.positions.length > 0) {
      try {
        const updatedPositions = await Promise.all(
          state.positions.map(async (pos: any) => {
            const pair = pos.symbol.endsWith("TRY") ? pos.symbol : `${pos.symbol}TRY`
            try {
              const pRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`, {
                signal: AbortSignal.timeout(2000),
                cache: "no-store",
              })
              if (pRes.ok) {
                const pData = await pRes.json()
                const curPrice = parseFloat(pData.price) || pos.currentPrice || pos.entryPrice
                const rawDiff = curPrice - pos.entryPrice
                const pnlPct = pos.entryPrice > 0 ? (rawDiff / pos.entryPrice) * 100 : 0
                const pnlTry = (pos.totalTry || 0) * (pnlPct / 100)
                const highestPrice = Math.max(pos.highestPrice || pos.entryPrice, curPrice)
                return {
                  ...pos,
                  currentPrice: curPrice,
                  highestPrice,
                  pnl: pnlTry,
                  pnlPercent: pnlPct,
                }
              }
            } catch {}
            return pos
          })
        )
        state.positions = updatedPositions
      } catch (err) {
        console.warn("Live position price update error:", err)
      }
    }

    // 🎯 Bekleyen Futures Emri — Ana Ekranda Seçili Coin Göstergesi İçin
    const firstFuturesBuy = pendingOrders.find(
      (o) => o.exchange === "BINANCE_GLOBAL_FUTURES" && o.side === "BUY"
    )
    const nextCandidate = firstFuturesBuy?.symbol ?? null
    const nextCandidatePrice = firstFuturesBuy?.price ?? null
    const nextCandidateLeverage = firstFuturesBuy?.leverage ?? null

    const usdtTryRate = await getUsdtTryRate()
    const sanitizedState = {
      ...state,
      binance: binanceInfo,
      binanceGlobal: binanceGlobalInfo,
      mexc: null,
      exchangeSettings: state.exchangeSettings,
      marketRegime,
      adaptiveTpPct,
      regimeLabel,
      marketRedRatioPct,
      isBloodbathActive,
      nextCandidate,
      nextCandidatePrice,
      nextCandidateLeverage,
      usdtTryRate,
    }
    return NextResponse.json({ ok: true, ...sanitizedState, fearGreed, redisDebug, fetchedAt: Date.now() })
  } catch (e) {
    return NextResponse.json({ ok: false, error: "State okunamadı" }, { status: 500 })
  }
}

/** POST — UI'ın strateji/aktiflik/pozisyon güncellemesi gönderdiği endpoint */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = checkRateLimit(`botstate:post:${ip}`, 30, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetTime)

  try {
    const body = await request.json()
    const sessionCookie = request.cookies.get("f_borsam_session")?.value
    const isOwner = Boolean(
      sessionCookie && (
        sessionCookie.startsWith("owner_session_") ||
        sessionCookie.startsWith("active_session") ||
        sessionCookie.startsWith("auth_")
      )
    )
    const cronSecret = process.env.CRON_SECRET || process.env.BOT_CRON_SECRET
    const authHeader = request.headers.get("authorization") || ""
    const isCronAuthorized = Boolean(cronSecret && (authHeader === `Bearer ${cronSecret}` || body?.secret === cronSecret))
    const hasValidGlobalCreds = Boolean(body?.binanceGlobal?.apiKey && body?.binanceGlobal?.apiSecret)
    // 🔒 GÜVENLİK (Seçenek A): "reset_clean_slate" anahtarı repo'da açık yazılıydı; bu anahtarı bilen
    // herkes strateji/kaldıraç/bakiye değiştirebiliyor ya da botu kapatabiliyordu.
    // Artık reset yolu YALNIZCA panelden (aynı köken) VE geçerli oturum çerezi varken geçerlidir.
    // (Cross-site CSRF istekleri "sec-fetch-site: cross-site" ile, dış istemciler ise oturumsuz gelir.)
    const secFetchSite = request.headers.get("sec-fetch-site") || ""
    const referer = request.headers.get("referer") || ""
    const isSameOrigin = secFetchSite === "same-origin" || referer.includes("frborsam.vercel.app") || referer.includes("localhost")
    const hasSession = Boolean(sessionCookie && sessionCookie.length > 0)
    const isResetAuthorized = body?.resetKey === "reset_clean_slate" && isSameOrigin && hasSession
    if (!isOwner && !hasValidGlobalCreds && !isCronAuthorized && !isResetAuthorized) {
      console.warn(`🚨 [YETKİSİZ STATE POST] ip=${ip} resetKey=${body?.resetKey ? "var" : "yok"} sameOrigin=${isSameOrigin} oturum=${hasSession}`)
      return NextResponse.json({ ok: false, error: "Yetkisiz işlem! Yönetici girişi gereklidir." }, { status: 403 })
    }
    if (isResetAuthorized && !isOwner) {
      console.warn(`⚠️ [RESET ANAHTARI KULLANILDI] ip=${ip} — panel oturumu ile state sıfırlama yapıldı.`)
    }

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
    if (body.binance !== undefined) {
      await setServerBinance(body.binance)
      updates.push("binance")
    }
    if (body.binanceGlobal !== undefined) {
      await setServerBinanceGlobal(body.binanceGlobal)
      updates.push("binanceGlobal")
    }
    if (body.mexc !== undefined) {
      await setServerMexc(body.mexc)
      updates.push("mexc")
    }
    if (body.exchangeSettings !== undefined) {
      await setServerExchangeSettings(body.exchangeSettings)
      updates.push("exchangeSettings")
    }
    if (body.positions !== undefined && Array.isArray(body.positions)) {
      // 10 TL altı satılamaz artık bakiyeleri aktif işlem slotundan arındır
      const cleanPositions = body.positions.filter((p: any) => !p?.isRealOrder || (p?.totalTry || 0) >= 10 || body.forceKeepDust)
      await setServerPositions(cleanPositions)
      updates.push("positions")
    }
    if (body.history !== undefined && Array.isArray(body.history)) {
      await setServerHistory(body.history)
      updates.push("history")
    }
    if (body.logs !== undefined && Array.isArray(body.logs)) {
      await setServerLogs(body.logs)
      updates.push("logs")
    }
    if (body.clearAllHistoryAndLogs === true) {
      await setServerHistory([])
      await setServerLogs([])
      await setServerPositions([])
      await setServerInitialBalance(0)
      updates.push("cleared_all_history_and_logs")
    }
    if (body.coingeckoPrefilter !== undefined) {
      await setCoinGeckoPrefilterState(body.coingeckoPrefilter)
      updates.push("coingeckoPrefilter")
    }
    if (body.slotConfig !== undefined) {
      await setServerSlotConfig(body.slotConfig)
      updates.push("slotConfig")
    }
    if (body.resetDailyLoss) {
      const state = await getFullServerState()
      const currentEquity = state.balance + (state.positions || []).reduce((s, p) => s + (p.totalTry || 0), 0)
      const today = new Date().toISOString().slice(0, 10)
      await setDailyLoss(currentEquity, today)
      updates.push("dailyLossReset")
    }

    return NextResponse.json({ ok: true, updated: updates })
  } catch (e) {
    return NextResponse.json({ ok: false, error: "State güncellenemedi" }, { status: 500 })
  }
}
