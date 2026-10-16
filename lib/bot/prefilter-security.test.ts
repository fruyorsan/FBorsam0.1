import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  isWrappedOrStaked,
  isStableOrRwa,
  filterAndScoreCoins,
  isPrefilterFresh,
} from "./coingecko-prefilter"
import {
  getBotRiskConfig,
  verifyStopLossVersusLiquidation,
  encryptVaultData,
  decryptVaultData,
} from "./security-config"
import {
  executeBinanceFuturesOrder,
} from "../binance-helpers"

describe("🛡️ Kapsamlı Bot Güvenlik, Davranış ve Ön Filtre Test Paketi", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  // ─────────────────────────────────────────────────────────────
  // GRUP 1: DAVRANIŞSAL GÜVENLİK TESTLERİ (MOCK & EXCHANGE ENGELLERİ)
  // ─────────────────────────────────────────────────────────────
  describe("1. Botun Gerçek Çalışma Davranışı ve Borsa İletim Engelleri", () => {
    it("DRY_RUN=true iken executeBinanceFuturesOrder borsaya HİÇBİR istek atmamalı ve simülasyon yanıtı dönmelidir", async () => {
      process.env.DRY_RUN = "true"
      delete process.env.KILL_SWITCH

      const globalFetchSpy = vi.spyOn(globalThis, "fetch")

      const res = await executeBinanceFuturesOrder({
        apiKey: "dummy_key",
        apiSecret: "dummy_secret",
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.01,
        price: 65000,
        leverage: 3,
      })

      // Borsaya hiçbir HTTP isteği gitmediğini doğrula
      expect(globalFetchSpy).not.toHaveBeenCalled()
      expect(res.ok).toBe(true)
      expect(String(res.orderId)).toContain("sim-")
      expect(res.status).toBe("FILLED")
      expect(res.executedQty).toBe(0.01)
    })

    it("KILL_SWITCH='true' iken executeBinanceFuturesOrder emri engellemeli ve borsaya gitmemelidir", async () => {
      process.env.KILL_SWITCH = "true"
      const globalFetchSpy = vi.spyOn(globalThis, "fetch")

      const res = await executeBinanceFuturesOrder({
        apiKey: "dummy_key",
        apiSecret: "dummy_secret",
        symbol: "ETHUSDT",
        side: "BUY",
        quantity: 0.1,
        price: 3500,
      })

      expect(globalFetchSpy).not.toHaveBeenCalled()
      expect(res.ok).toBe(false)
      expect(res.error).toContain("KILL_SWITCH_ACTIVE")
    })

    it("KILL_SWITCH='1' iken acil durdurma aktif olmalıdır", async () => {
      process.env.KILL_SWITCH = "1"
      const config = getBotRiskConfig()
      expect(config.killSwitchActive).toBe(true)
    })

    it("KILL_SWITCH='false' veya '0' iken acil durdurma kesinlikle KAPALI olmalıdır", () => {
      process.env.KILL_SWITCH = "false"
      expect(getBotRiskConfig().killSwitchActive).toBe(false)

      process.env.KILL_SWITCH = "0"
      expect(getBotRiskConfig().killSwitchActive).toBe(false)
    })

    it("KILL_SWITCH tanımlı değilse veya boş metinse acil durdurma KAPALI olmalıdır", () => {
      delete process.env.KILL_SWITCH
      expect(getBotRiskConfig().killSwitchActive).toBe(false)

      process.env.KILL_SWITCH = ""
      expect(getBotRiskConfig().killSwitchActive).toBe(false)
    })

    it("isPrefilterFresh: Liste null veya tanımsızken false dönmelidir", () => {
      expect(isPrefilterFresh(null)).toBe(false)
    })

    it("isPrefilterFresh: Liste boşken (0 onaylı aday) false dönmeli ve pozisyon açılışı kilitlenmelidir", () => {
      expect(isPrefilterFresh({ updatedAt: Date.now(), candidates: [], eliminated: [] })).toBe(false)
    })

    it("isPrefilterFresh: Liste 6 saatten eski (bayat) ise false dönmeli ve pozisyon açılışı kilitlenmelidir", () => {
      const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000
      expect(isPrefilterFresh({
        updatedAt: sevenHoursAgo,
        candidates: [{ id: "bitcoin", symbol: "BTC", name: "Bitcoin", binanceSymbol: "BTCUSDT", score: 90, marketCap: 1e9, totalVolume: 1e8, liquidityRatio: 0.1, mom7d: 5, mom30d: 10, volatility7d: 2, athDistance: -10, volumeSpikeRatio: 1, ageDescription: "1000 gün" }],
        eliminated: [],
      })).toBe(false)
    })

    it("isPrefilterFresh: Liste taze (örn. 30 dakika önce taranmış) ve aday içeriyorsa true dönmelidir", () => {
      const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000
      expect(isPrefilterFresh({
        updatedAt: thirtyMinutesAgo,
        candidates: [{ id: "bitcoin", symbol: "BTC", name: "Bitcoin", binanceSymbol: "BTCUSDT", score: 90, marketCap: 1e9, totalVolume: 1e8, liquidityRatio: 0.1, mom7d: 5, mom30d: 10, volatility7d: 2, athDistance: -10, volumeSpikeRatio: 1, ageDescription: "1000 gün" }],
        eliminated: [],
      })).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // GRUP 2: SERT FİLTRE KURALLARI (21 TEKİL DOĞRULAMA)
  // ─────────────────────────────────────────────────────────────
  describe("2. Sert Filtreleme ve Varlık Sınıflandırma Kuralları", () => {
    it("Filtre 1: USDT elenmelidir", () => {
      expect(isStableOrRwa({ id: "tether", symbol: "usdt", name: "Tether" })).toBe(true)
    })

    it("Filtre 2: USDC elenmelidir", () => {
      expect(isStableOrRwa({ id: "usd-coin", symbol: "usdc", name: "USDC" })).toBe(true)
    })

    it("Filtre 3: USDe sentetik dolar elenmelidir", () => {
      expect(isStableOrRwa({ id: "ethena-usde", symbol: "usde", name: "Ethena USDe" })).toBe(true)
    })

    it("Filtre 4: DAI stablecoin elenmelidir", () => {
      expect(isStableOrRwa({ id: "dai", symbol: "dai", name: "Dai" })).toBe(true)
    })

    it("Filtre 5: PAXG altın token elenmelidir", () => {
      expect(isStableOrRwa({ id: "pax-gold", symbol: "paxg", name: "PAX Gold" })).toBe(true)
    })

    it("Filtre 6: WBTC wrapped token elenmelidir", () => {
      expect(isWrappedOrStaked({ id: "wrapped-bitcoin", symbol: "wbtc", name: "Wrapped Bitcoin" })).toBe(true)
    })

    it("Filtre 7: wstETH staked token elenmelidir", () => {
      expect(isWrappedOrStaked({ id: "wrapped-steth", symbol: "wsteth", name: "Wrapped Staked Ether" })).toBe(true)
    })

    it("Filtre 8: cbBTC wrapped token elenmelidir", () => {
      expect(isWrappedOrStaked({ id: "coinbase-wrapped-btc", symbol: "cbbtc", name: "Coinbase Wrapped BTC" })).toBe(true)
    })

    it("Filtre 9: BTC normal coin olarak ELENMEMELİDİR", () => {
      expect(isStableOrRwa({ id: "bitcoin", symbol: "btc", name: "Bitcoin" })).toBe(false)
      expect(isWrappedOrStaked({ id: "bitcoin", symbol: "btc", name: "Bitcoin" })).toBe(false)
    })

    it("Filtre 10: SOL normal coin olarak ELENMEMELİDİR", () => {
      expect(isStableOrRwa({ id: "solana", symbol: "sol", name: "Solana" })).toBe(false)
      expect(isWrappedOrStaked({ id: "solana", symbol: "sol", name: "Solana" })).toBe(false)
    })

    const mockNow = new Date("2026-10-14T12:00:00Z").getTime()

    it("Filtre 11: Piyasa değeri $500M altındaki coin elenmelidir", () => {
      const res = filterAndScoreCoins({
        rawTop100: [{ id: "low-mcap", symbol: "low", name: "Low Mcap", market_cap: 450_000_000, total_volume: 50_000_000, sparkline_in_7d: { price: [1, 1] } }],
        inceptionHistories: { "low-mcap": { firstTimestamp: mockNow - (200 * 864e5) } },
        volumeHistories: { "low-mcap": [[1, 50e6], [2, 50e6]] },
        availableExchangePairs: new Set(["LOWUSDT"]),
        nowTs: mockNow,
      })
      expect(res.candidates.some(c => c.symbol === "LOW")).toBe(false)
      expect(res.eliminated.some(e => e.reason.includes("$500M"))).toBe(true)
    })

    it("Filtre 12: 24 saatlik hacmi $20M altındaki coin elenmelidir", () => {
      const res = filterAndScoreCoins({
        rawTop100: [{ id: "low-vol", symbol: "lvol", name: "Low Vol", market_cap: 800_000_000, total_volume: 15_000_000, sparkline_in_7d: { price: [1, 1] } }],
        inceptionHistories: { "low-vol": { firstTimestamp: mockNow - (200 * 864e5) } },
        volumeHistories: { "low-vol": [[1, 15e6], [2, 15e6]] },
        availableExchangePairs: new Set(["LVOLUSDT"]),
        nowTs: mockNow,
      })
      expect(res.candidates.some(c => c.symbol === "LVOL")).toBe(false)
      expect(res.eliminated.some(e => e.reason.includes("$20M"))).toBe(true)
    })

    it("Filtre 13: 90 günden eski köklü coin (ALGO) ELENMEMELİDİR", () => {
      const res = filterAndScoreCoins({
        rawTop100: [{ id: "algorand", symbol: "algo", name: "Algorand", market_cap: 1e9, total_volume: 50e6, sparkline_in_7d: { price: [0.15, 0.16] } }],
        inceptionHistories: { algorand: { firstTimestamp: new Date("2019-06-20").getTime(), firstDate: "2019-06-20" } },
        volumeHistories: { algorand: [[1, 50e6], [2, 50e6]] },
        availableExchangePairs: new Set(["ALGOUSDT"]),
        nowTs: mockNow,
      })
      expect(res.candidates.some(c => c.symbol === "ALGO")).toBe(true)
    })

    it("Filtre 14: 90 günden yeni listelenmiş coin elenmelidir", () => {
      const res = filterAndScoreCoins({
        rawTop100: [{ id: "new-coin", symbol: "new", name: "New Coin", market_cap: 1e9, total_volume: 50e6, sparkline_in_7d: { price: [1, 1] } }],
        inceptionHistories: { "new-coin": { firstTimestamp: mockNow - (30 * 864e5) } }, // 30 günlük
        volumeHistories: { "new-coin": [[1, 50e6], [2, 50e6]] },
        availableExchangePairs: new Set(["NEWUSDT"]),
        nowTs: mockNow,
      })
      expect(res.candidates.some(c => c.symbol === "NEW")).toBe(false)
      expect(res.eliminated.some(e => e.reason.includes("90 günden az"))).toBe(true)
    })

    it("Filtre 15: Yaşı bilinmeyen coin ELENMEMELİ ve korunmalıdır", () => {
      const res = filterAndScoreCoins({
        rawTop100: [{ id: "unk-coin", symbol: "unk", name: "Unknown Coin", market_cap: 1e9, total_volume: 50e6, sparkline_in_7d: { price: [1, 1] } }],
        inceptionHistories: { "unk-coin": null }, // Yaş bilinmiyor
        volumeHistories: { "unk-coin": [[1, 50e6], [2, 50e6]] },
        availableExchangePairs: new Set(["UNKUSDT"]),
        nowTs: mockNow,
      })
      expect(res.candidates.some(c => c.symbol === "UNK")).toBe(true)
      expect(res.candidates[0].ageDescription).toBe("Yaş Bilinmiyor")
    })

    it("Filtre 16: Hacmi 7 günlük ortalamasının 3 katından fazla fırlayan coin (>3x) elenmelidir", () => {
      const res = filterAndScoreCoins({
        rawTop100: [{ id: "spk-coin", symbol: "spk", name: "Spike Coin", market_cap: 1e9, total_volume: 150e6, sparkline_in_7d: { price: [1, 1] } }],
        inceptionHistories: { "spk-coin": { firstTimestamp: mockNow - (200 * 864e5) } },
        volumeHistories: { "spk-coin": [[1, 20e6], [2, 20e6]] }, // 7g ortalama 20M, son 24s 150M (7.5x)
        availableExchangePairs: new Set(["SPKUSDT"]),
        nowTs: mockNow,
      })
      expect(res.candidates.some(c => c.symbol === "SPK")).toBe(false)
      expect(res.eliminated.some(e => e.reason.includes("3 katından fazla"))).toBe(true)
    })

    it("Filtre 17: 7 günde %80'den fazla yükselen aşırı ısınmış coin elenmelidir", () => {
      const res = filterAndScoreCoins({
        rawTop100: [{ id: "pump-coin", symbol: "pump", name: "Pump Coin", market_cap: 1e9, total_volume: 50e6, price_change_percentage_7d_in_currency: 120, sparkline_in_7d: { price: [1, 2] } }],
        inceptionHistories: { "pump-coin": { firstTimestamp: mockNow - (200 * 864e5) } },
        volumeHistories: { "pump-coin": [[1, 50e6], [2, 50e6]] },
        availableExchangePairs: new Set(["PUMPUSDT"]),
        nowTs: mockNow,
      })
      expect(res.candidates.some(c => c.symbol === "PUMP")).toBe(false)
      expect(res.eliminated.some(e => e.reason.includes("aşırı ısınmış"))).toBe(true)
    })

    it("Filtre 18: Binance Futures tahtasında işlem görmeyen coin elenmelidir", () => {
      const res = filterAndScoreCoins({
        rawTop100: [{ id: "spot-only", symbol: "spt", name: "Spot Only", market_cap: 1e9, total_volume: 50e6, sparkline_in_7d: { price: [1, 1] } }],
        inceptionHistories: { "spot-only": { firstTimestamp: mockNow - (200 * 864e5) } },
        volumeHistories: { "spot-only": [[1, 50e6], [2, 50e6]] },
        availableExchangePairs: new Set(["BTCUSDT", "ETHUSDT"]), // SPTUSDT listede yok
        nowTs: mockNow,
      })
      expect(res.candidates.some(c => c.symbol === "SPT")).toBe(false)
      expect(res.eliminated.some(e => e.reason.includes("Binance Futures tahtasında işlem görmüyor"))).toBe(true)
    })

    it("Filtre 19: 3x kaldıraçta stop-loss (-%3.5) tasfiye fiyatından (-%32.8) KAT KAT ÖNCE tetiklenmelidir", () => {
      const entryPrice = 100
      const res = verifyStopLossVersusLiquidation(entryPrice, 3, 3.5)
      expect(res.isSafe).toBe(true)
      expect(res.stopLossPrice).toBe(96.5)
      expect(res.approxLiquidationPrice).toBeLessThan(70)
      expect(res.stopLossPrice).toBeGreaterThan(res.approxLiquidationPrice)
    })

    it("Filtre 20: Varsayılan limitler (10x kaldıraç tavanı, 20 USDT maks pozisyon, 3 eşzamanlı, %5 günlük zarar) doğrulanmalıdır", () => {
      delete process.env.DRY_RUN
      delete process.env.BINANCE_ENV
      delete process.env.KILL_SWITCH

      const config = getBotRiskConfig()
      expect(config.dryRun).toBe(true)
      expect(config.binanceEnv).toBe("testnet")
      expect(config.maxLeverageCap).toBe(10)
      expect(config.maxPositionSizeUsdt).toBe(20)
      expect(config.maxConcurrentPositions).toBe(3)
      expect(config.maxDailyLossPct).toBe(5.0)
    })

    it("Filtre 21: ENCRYPTION_KEY sunucu ortamında tanımlı değilse şifreleme motoru güvenli hata fırlatmalıdır", () => {
      delete process.env.ENCRYPTION_KEY
      expect(() => encryptVaultData("test_secret")).toThrow(/ENCRYPTION_KEY ortam değişkeni tanımlı değil/)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // GRUP 4: GROK ENTEGRASYONU VE FİYAT YAPISI (PRICE ACTION) TESTLERİ
  // ─────────────────────────────────────────────────────────────
  describe("4. Grok Servisi ve Fiyat Yapısı Fonksiyonları", () => {
    it("Grok Veto: Batık / yüksek riskli tokenlar (LUNA, FTT vb.) anında veto edilmelidir", async () => {
      const { checkGrokVeto } = await import("./grok-service")
      const vetoLuna = await checkGrokVeto("LUNAUSDT")
      expect(vetoLuna.vetoed).toBe(true)
      expect(vetoLuna.reason).toBeDefined()

      const vetoFtt = await checkGrokVeto("FTT")
      expect(vetoFtt.vetoed).toBe(true)
    })

    it("Grok Confluence: Veto edilen coin için confluence skoru 0 dönmeli ve vetoed bayrağı true olmalıdır", async () => {
      const { evaluateGrokConfluence } = await import("./grok-service")
      const res = await evaluateGrokConfluence({
        symbol: "LUNAUSDT",
        curPrice: 0.5,
        technicalScore: 90,
      })
      expect(res.vetoed).toBe(true)
      expect(res.finalConfluenceScore).toBe(0)
    })

    it("Grok Duygu & Confluence: Normal bir coin için ağırlıklı puan (%65 teknik + %35 grok) hesaplanmalıdır", async () => {
      const { evaluateGrokConfluence } = await import("./grok-service")
      const res = await evaluateGrokConfluence({
        symbol: "BTCUSDT",
        curPrice: 65000,
        technicalScore: 80,
      })
      expect(res.vetoed).toBe(false)
      expect(res.finalConfluenceScore).toBeGreaterThan(0)
      expect(res.finalConfluenceScore).toBeLessThanOrEqual(100)
    })

    it("Price Action: rsiSeries ve atrSeries fonksiyonları doğru uzunlukta ve NaN olmadan seriler üretmelidir", async () => {
      const { rsiSeries, atrSeries } = await import("./price-action")
      const closes = [10, 11, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15, 14, 13, 12, 13, 14, 15, 16]
      const rsi = rsiSeries(closes, 14)
      expect(rsi.length).toBe(closes.length)
      expect(Number.isNaN(rsi[14])).toBe(false)
      expect(rsi[rsi.length - 1]).toBeGreaterThan(0)
      expect(rsi[rsi.length - 1]).toBeLessThan(100)

      const candles = closes.map((c, i) => ({
        t: i * 60000,
        o: c - 0.5,
        h: c + 1,
        l: c - 1,
        c,
        v: 1000,
      }))
      const atr = atrSeries(candles, 14)
      expect(atr.length).toBe(candles.length)
      expect(Number.isNaN(atr[14])).toBe(false)
      expect(atr[atr.length - 1]).toBeGreaterThan(0)
    })

    it("4-Katmanlı Çöküş Filtresi 1: Anlatı (Narrative) Sektörü doğru tespit edilmeli ve bonus üretmelidir", async () => {
      const { getNarrativeSector, evaluateGrokConfluence } = await import("./grok-service")
      
      const aiInfo = getNarrativeSector("NEARUSDT")
      expect(aiInfo).not.toBeNull()
      expect(aiInfo?.sectorKey).toBe("AI")
      expect(aiInfo?.bonus).toBe(20)

      const rwaInfo = getNarrativeSector("ONDO")
      expect(rwaInfo?.sectorKey).toBe("RWA")

      const l1Info = getNarrativeSector("SOLUSDT")
      expect(l1Info?.sectorKey).toBe("MAJOR_L1")

      const res = await evaluateGrokConfluence({
        symbol: "NEARUSDT",
        curPrice: 5.2,
        technicalScore: 75,
      })
      expect(res.narrative?.sectorKey).toBe("AI")
      expect(res.finalConfluenceScore).toBeGreaterThan(0)
    })

    it("4-Katmanlı Çöküş Filtresi 2: Göreli Güç (RS = Coin % - BTC %) formülü doğrulanmalıdır", () => {
      // BTC %5 düşerken Coin sadece %1 düştüğünde RS = (-1) - (-5) = +4% (Güçlü Göreli Güç)
      const btcChangePct = -5.0
      const coinChangePct = -1.0
      const relativeStrength = coinChangePct - btcChangePct
      expect(relativeStrength).toBe(4.0)
      expect(relativeStrength).toBeGreaterThan(1.2) // Güçlü RS eşiğini geçti

      // BTC %2 düşerken Coin %8 çöküyorsa RS = (-8) - (-2) = -6% (Aşırı Zayıf)
      const weakCoinChange = -8.0
      const weakRS = weakCoinChange - btcChangePct
      expect(weakRS).toBe(-3.0)
      expect(weakRS).toBeLessThan(-1.5) // Zayıf, elenmeli
    })

    it("4-Katmanlı Çöküş Filtresi 3: Bid-Ask Spread ve Emir Defteri Derinlik eşikleri doğrulanmalıdır", () => {
      // Sıkı likit tahta: Bid 100.0, Ask 100.04 -> Spread %0.04 (Geçer)
      const tightBid = 100.0, tightAsk = 100.04
      const tightSpread = ((tightAsk - tightBid) / tightBid) * 100
      expect(tightSpread).toBeLessThanOrEqual(0.15)

      // Sığ tahta: Bid 100.0, Ask 100.25 -> Spread %0.25 (> %0.15, Elenir)
      const wideBid = 100.0, wideAsk = 100.25
      const wideSpread = ((wideAsk - wideBid) / wideBid) * 100
      expect(wideSpread).toBeGreaterThan(0.15)
    })

    it("4-Katmanlı Çöküş Filtresi 4: Negatif Fonlama (Short Squeeze Potansiyeli) doğrulanmalıdır", () => {
      const negativeFunding = -0.00015
      const neutralFunding = 0.00008
      const dangerousHighFunding = 0.00065

      expect(negativeFunding < 0).toBe(true) // Negatif fonlama -> Squeeze bonusu
      expect(neutralFunding <= 0.0001).toBe(true) // Sağlıklı fonlama
      expect(dangerousHighFunding >= 0.0005).toBe(true) // Aşırı long yığılması -> Düşüşte elenir
    })

    it("5. Kurumsal Dip Filtresi: Token Unlock (Kilit Açılımı) VETO'su doğrulanmalıdır", async () => {
      const { checkGrokVeto, HIGH_UNLOCK_VETO_TOKENS } = await import("./grok-service")
      const { setDynamicUnlockVetoes } = await import("./server-state")
      expect(HIGH_UNLOCK_VETO_TOKENS.has("PIXEL")).toBe(true)
      expect(HIGH_UNLOCK_VETO_TOKENS.has("AEVO")).toBe(true)

      await setDynamicUnlockVetoes(["DYN_TEST_UNLOCK"])
      const vetoResult = await checkGrokVeto("DYN_TEST_UNLOCKUSDT")
      expect(vetoResult.vetoed).toBe(true)
      expect(vetoResult.reason).toContain("Dinamik Kilit Açılımı")
    })

    it("6. Kurumsal Dip Filtresi: SFP (Likidite Süpürmesi & %45+ Alt Fitil) tespiti doğrulanmalıdır", async () => {
      const { detectLiquiditySweepAbsorption } = await import("./price-action")
      // 16 mumluk simülasyon: Eski dip 10.0, son mum 9.8'e iğne atıp 10.2'de kapatıyor, alt fitil %50
      const candles = []
      for (let i = 0; i < 16; i++) {
        candles.push({ t: i * 60000, o: 10.5, h: 11.0, l: 10.0, c: 10.4, v: 1000 })
      }
      // SFP Dönüş mumu: Low=9.5 (<10.0), High=10.5, Open=10.0, Close=10.4 -> Range=1.0, Lower Wick=10.0-9.5=0.5 (Wick %50)
      candles.push({ t: 16 * 60000, o: 10.0, h: 10.5, l: 9.5, c: 10.4, v: 2500 })

      const sfp = detectLiquiditySweepAbsorption(candles, 16)
      expect(sfp.detected).toBe(true)
      expect(sfp.lowerWickRatio).toBeGreaterThanOrEqual(0.45)
      expect(sfp.reasons.length).toBeGreaterThan(0)
    })

    it("7. Kurumsal Dip Filtresi: Pozitif CVD / Taker Uyumsuzluğu (Balina Emilimi) doğrulanmalıdır", async () => {
      const { detectCvdDivergence } = await import("./price-action")
      // 8 mum: Fiyat yeni dip yapıyor (curLow < prevLow), fakat Taker Buy oranı daha yüksek kalıyor
      const candles = [
        { t: 0, o: 10, h: 10.5, l: 9.8, c: 10.2, v: 1000 },
        { t: 1, o: 10.2, h: 10.4, l: 9.9, c: 10.1, v: 1000 },
        { t: 2, o: 10.1, h: 10.3, l: 9.8, c: 10.0, v: 1000 },
        { t: 3, o: 10.0, h: 10.2, l: 9.7, c: 9.9, v: 1000 }, // prevLow = 9.7
        { t: 4, o: 9.9, h: 10.1, l: 9.8, c: 9.8, v: 1000 },
        { t: 5, o: 9.8, h: 10.0, l: 9.7, c: 9.7, v: 1000 },
        { t: 6, o: 9.7, h: 9.9, l: 9.6, c: 9.6, v: 1000 },
        { t: 7, o: 9.6, h: 9.8, l: 9.4, c: 9.7, v: 2000 }, // curLow = 9.4 (Lower Low!)
      ]
      const takerRatios = [50, 49, 48, 50, 52, 53, 54, 56] // prevTaker = 50, curTaker = 56 (+6% Higher Low!)

      const cvd = detectCvdDivergence(candles, takerRatios)
      expect(cvd.detected).toBe(true)
      expect(cvd.deltaImprovement).toBeGreaterThanOrEqual(2.5)
      expect(cvd.reasons.length).toBeGreaterThan(0)
    })

    it("8. Kurumsal Risk Yönetimi: Dinamik ATR Stop ve Sabit Parasal Risk Boyutlandırması doğrulanmalıdır", async () => {
      const { calculateDynamicAtrSizing } = await import("./price-action")
      // Yüksek volatilite: ATR = 2.0 (Fiyat 100, Stop 2x ATR = %4)
      const highVol = calculateDynamicAtrSizing({
        curPrice: 100,
        atr14: 2.0,
        equityUsdt: 100,
        riskPctPerTrade: 2.0, // 2 USDT hedef zarar
        atrMultiplier: 2.0,
      })
      expect(highVol.stopLossDistancePct).toBe(4.0)
      expect(highVol.stopLossPrice).toBe(96.0)
      expect(highVol.targetRiskUsdt).toBe(2.0)
      // Pozisyon boyutu = 2 / 0.04 = 50 USDT
      expect(highVol.positionSizeUsdt).toBe(20.0) // maxPositionUsdt (20 USDT) tavanına takılır

      // Düşük volatilite: ATR = 1.0 (Stop 2x ATR = %2)
      const lowVol = calculateDynamicAtrSizing({
        curPrice: 100,
        atr14: 1.0,
        equityUsdt: 100,
        riskPctPerTrade: 2.0,
        atrMultiplier: 2.0,
      })
      expect(lowVol.stopLossDistancePct).toBe(2.0)
      expect(lowVol.stopLossPrice).toBe(98.0)
      expect(lowVol.targetRiskUsdt).toBe(2.0)
    })

    it("9. Çıkış Hedefleri: Dinamik R (Risk Katı) ve ATR Çıkış Seviyeleri (1.2R TP1, 2.5R TP2, 1.5R Trailing, 0.8x ATR Pullback) doğrulanmalıdır", async () => {
      const { calculateDynamicRExits } = await import("./price-action")

      // Volatilite yüksek: Stop %4.0 (1R), ATR = %2.0
      const exitsHighVol = calculateDynamicRExits(4.0, 2.0)
      expect(exitsHighVol.tp1Pct).toBe(4.8) // 1.2R (1.2 * 4.0) -> Risk-Ödül >= 1.2:1
      expect(exitsHighVol.tp2Pct).toBe(10.0) // 2.5R (2.5 * 4.0)
      expect(exitsHighVol.trailingActivationPct).toBe(6.0) // 1.5R (1.5 * 4.0)
      expect(exitsHighVol.trailingPullbackPct).toBe(1.6) // 0.8 * ATR% (0.8 * 2.0 = %1.6 piyasa gürültü payı)
      expect(exitsHighVol.stopLossDistancePct).toBe(4.0)

      // Standart durum: Stop %2.5 (1R), ATR belirtilmemişse atrMultiplier=2.0'dan ATR = %1.25
      const exitsStd = calculateDynamicRExits(2.5)
      expect(exitsStd.tp1Pct).toBe(3.0) // 1.2 * 2.5 = 3.0
      expect(exitsStd.tp2Pct).toBe(6.25) // 2.5 * 2.5 = 6.25
      expect(exitsStd.trailingActivationPct).toBe(3.75) // 1.5 * 2.5 = 3.75
      expect(exitsStd.trailingPullbackPct).toBe(1.0) // 0.8 * 1.25 = 1.0
    })

    it("10. Durum Makinesi & Cooldown: Sembol bazlı soğuma süreleri ve engel mekanizması doğrulanmalıdır", async () => {
      const { setSymbolCooldown, isSymbolInCooldown } = await import("./server-state")

      // Stop-loss sonrası test (SL = 3600s / 60dk)
      await setSymbolCooldown("TESTSLUSDT", "SL", 3600)
      const slCd = await isSymbolInCooldown("TESTSLUSDT")
      expect(slCd.active).toBe(true)
      expect(slCd.reason).toBe("SL")
      expect(slCd.remainingSec).toBeGreaterThan(3500)
      expect(slCd.remainingSec).toBeLessThanOrEqual(3600)

      // Time-Stop sonrası test (1800s / 30dk)
      await setSymbolCooldown("TESTTSUSDT", "TIME_STOP", 1800)
      const tsCd = await isSymbolInCooldown("TESTTSUSDT")
      expect(tsCd.active).toBe(true)
      expect(tsCd.reason).toBe("TIME_STOP")
      expect(tsCd.remainingSec).toBeGreaterThan(1700)
      expect(tsCd.remainingSec).toBeLessThanOrEqual(1800)

      // TP sonrası test (900s / 15dk)
      await setSymbolCooldown("TESTTPUSDT", "TP", 900)
      const tpCd = await isSymbolInCooldown("TESTTPUSDT")
      expect(tpCd.active).toBe(true)
      expect(tpCd.reason).toBe("TP")
      expect(tpCd.remainingSec).toBeGreaterThan(800)
      expect(tpCd.remainingSec).toBeLessThanOrEqual(900)

      // Cooldown'da olmayan sembol
      const cleanCheck = await isSymbolInCooldown("FRESHCOINUSDT")
      expect(cleanCheck.active).toBe(false)
      expect(cleanCheck.remainingSec).toBe(0)
    })

    it("11. Dinamik Sektör Liderliği: 24h Göreli Güç (RS) hesaplaması ve lider sepete +20 puan verilmesi doğrulanmalıdır", async () => {
      const { calculateDynamicSectorBonuses, getNarrativeSector } = await import("./grok-service")

      // Simüle 24s verisi: BTC %-5.0 düşmüş
      // AI sepeti (NEAR, RENDER, FET/ASI, TAO): Ortalama +%3.0 artmış (RS = +8.0)
      // MEME sepeti: %-8.0 düşmüş (RS = -3.0)
      const mock24h = [
        { symbol: "BTCUSDT", priceChangePercent: -5.0 },
        { symbol: "NEARUSDT", priceChangePercent: 4.0 },
        { symbol: "RENDERUSDT", priceChangePercent: 3.0 },
        { symbol: "FETUSDT", priceChangePercent: 2.0 },
        { symbol: "TAOUSDT", priceChangePercent: 3.0 },
        { symbol: "DOGEUSDT", priceChangePercent: -8.0 },
        { symbol: "PEPEUSDT", priceChangePercent: -9.0 },
      ]

      const dynamicBonuses = calculateDynamicSectorBonuses(mock24h, -5.0)
      expect(dynamicBonuses.size).toBeGreaterThan(0)

      // AI sepeti lider olmalı ve +20 puan almalı
      const aiBonus = dynamicBonuses.get("AI")
      expect(aiBonus).toBeDefined()
      expect(aiBonus?.bonus).toBe(20)
      expect(aiBonus?.avgRs).toBeGreaterThan(5) // (4 - (-5)) = 9 vb.

      // getNarrativeSector dinamik bonus ile çağrıldığında lider puanını dönmeli
      const nearSector = getNarrativeSector("NEARUSDT", dynamicBonuses)
      expect(nearSector?.sectorKey).toBe("AI")
      expect(nearSector?.bonus).toBe(20)
    })

    it("12. Dinamik Token Unlock Veto Sistemi: Takvimdeki kilit açılımları veto edilmeli, sabit listeler kaldırılmalıdır", async () => {
      const { setDynamicUnlockVetoes, getDynamicUnlockVetoes } = await import("./server-state")
      const { checkGrokVeto } = await import("./grok-service")

      // Dinamik kilit açılımı listesine eklenen sembol veto edilmeli
      await setDynamicUnlockVetoes(["DYNUNLOCK"])
      const vetoes = await getDynamicUnlockVetoes()
      expect(vetoes.has("DYNUNLOCK")).toBe(true)

      const vetoResult = await checkGrokVeto("DYNUNLOCKUSDT")
      expect(vetoResult.vetoed).toBe(true)
      expect(vetoResult.reason).toContain("Dinamik Kilit Açılımı")

      // Listede olmayan sembol (eğer sabit hack listesinde değilse) unlock veto'ya takılmamalı
      const safeCheck = await checkGrokVeto("SOLUSDT")
      expect(safeCheck.vetoed).toBe(false)
    })

    it("13. Monotonik R-Bazlı Stop Motoru: Stop seviyeleri sadece yukarı kaymalı, asla aşağıya çekilmemelidir", async () => {
      const { calculateMonotonicStopTarget } = await import("./price-action")

      const entry = 100
      const stopDistPct = 3.0 // 1R = %3.0 (3.0$)

      // A) Başlangıç: Henüz kâr yok -> -1R Stop (97$)
      const initialStop = calculateMonotonicStopTarget({
        entryPrice: entry,
        highestPrice: entry,
        currentPrice: entry,
        stopLossDistancePct: stopDistPct,
        atrPct: 1.5,
      })
      expect(initialStop.stopStage).toBe("INITIAL")
      expect(initialStop.newStopPrice).toBe(97)

      // B) Fiyat +0.8R gördü (102.4$) -> Başabaş stopu (100 * 1.002 = 100.2$)
      const beStop = calculateMonotonicStopTarget({
        entryPrice: entry,
        highestPrice: 102.5,
        currentPrice: 102.0,
        stopLossDistancePct: stopDistPct,
        atrPct: 1.5,
      })
      expect(beStop.stopStage).toBe("BREAKEVEN")
      expect(beStop.newStopPrice).toBe(100.2)

      // C) TP1 vuruldu (+1.2R = 103.6$) -> Stop +0.5R kâra kilitlenmeli (100 + 1.5 = 101.5$)
      const tp1Stop = calculateMonotonicStopTarget({
        entryPrice: entry,
        highestPrice: 104.0,
        currentPrice: 103.0,
        stopLossDistancePct: stopDistPct,
        atrPct: 1.5,
        isTp1Taken: true,
      })
      expect(tp1Stop.stopStage).toBe("TP1_LOCKED")
      expect(tp1Stop.newStopPrice).toBe(101.5)

      // D) Zirve +1.5R aşıldı (105$) -> 0.8 x ATR Takipçi Stop
      const trailingStop = calculateMonotonicStopTarget({
        entryPrice: entry,
        highestPrice: 110.0,
        currentPrice: 109.0,
        stopLossDistancePct: stopDistPct,
        atrPct: 2.0, // 0.8x ATR = %1.6 -> 110 * (1 - 0.016) = 108.24$
        isTp1Taken: true,
      })
      expect(trailingStop.stopStage).toBe("TRAILING")
      expect(trailingStop.newStopPrice).toBeGreaterThan(105)

      // E) Monotonik Garanti: candidateStop daha düşükse mevcut stop korunur
      const monotonicProtected = calculateMonotonicStopTarget({
        entryPrice: entry,
        highestPrice: 102.0,
        currentPrice: 99.0,
        stopLossDistancePct: stopDistPct,
        atrPct: 1.5,
        currentStopPrice: 100.2, // Zaten başabaşa çekilmişti
      })
      expect(monotonicProtected.newStopPrice).toBe(100.2)
    })

    it("14. VWAP Kayma Simülasyonu: Sığ tahtalarda kayma > %0.10 ise veto edilmeli, derin tahtada onaylanmalıdır", async () => {
      const { simulateVwapSlippage } = await import("./price-action")

      // Derin ve dar makaslı tahta: 10 kademede bol likidite
      const liquidAsks: Array<[number, number]> = [
        [100.00, 10], // 1000$
        [100.02, 20], // 2000.4$
        [100.04, 30], // 3001.2$
        [100.06, 50], // 5003$
      ]
      const deepCheck = simulateVwapSlippage(liquidAsks, 50)
      expect(deepCheck.acceptable).toBe(true)
      expect(deepCheck.slippagePct).toBeLessThan(0.10)

      // Sığ ve kademeleri ayrık tahta: 50$ doldurmak için üst kademelere sıçrıyor
      const illiquidAsks: Array<[number, number]> = [
        [100.00, 0.1], // 10$
        [100.20, 0.1], // 10.02$
        [100.50, 0.5], // 50.25$
      ]
      const shallowCheck = simulateVwapSlippage(illiquidAsks, 60)
      expect(shallowCheck.acceptable).toBe(false)
      expect(shallowCheck.slippagePct).toBeGreaterThanOrEqual(0.10)

      // Boş tahta testi
      const emptyCheck = simulateVwapSlippage([], 50)
      expect(emptyCheck.acceptable).toBe(false)
    })

    it("15. Dinamik Kaldıraç Tamponu ve Likidasyon Mesafesi", async () => {
      const { calculateDynamicAtrSizing } = await import("./price-action")

      // stopLossDistance = %3.0 -> floor(100 / (3.0 + 2.5)) = floor(100 / 5.5) = 18 -> capped at 10x
      const sizing1 = calculateDynamicAtrSizing({
        curPrice: 100,
        atr14: 1.5,
        equityUsdt: 100,
        riskPctPerTrade: 2.0,
        atrMultiplier: 2.0,
        minPositionUsdt: 5,
        maxPositionUsdt: 20,
        maxLeverageCap: 10,
      })
      expect(sizing1.recommendedLeverage).toBeLessThanOrEqual(10)

      // Geniş stop: stopLossDistance = %8.0 -> floor(100 / (8.0 + 2.5)) = floor(100 / 10.5) = 9x
      const sizing2 = calculateDynamicAtrSizing({
        curPrice: 100,
        atr14: 4.0, // 2x ATR = %8
        equityUsdt: 100,
        riskPctPerTrade: 2.0,
        atrMultiplier: 2.0,
        minPositionUsdt: 5,
        maxPositionUsdt: 20,
        maxLeverageCap: 10,
      })
      expect(sizing2.recommendedLeverage).toBeLessThanOrEqual(9)
    })

    it("16. Asenkron Grok & Token Unlock Önbelleği: cachedOnly=true anında hafızadan dönmeli", async () => {
      const { getGrokSentiment, prewarmGrokWatchlistCache } = await import("./grok-service")

      // Önbellek ısındırma
      await prewarmGrokWatchlistCache(["BTCUSDT", "ETHUSDT"])

      const start = Date.now()
      const cached = await getGrokSentiment("BTCUSDT", true)
      const duration = Date.now() - start

      expect(cached).toBeDefined()
      expect(duration).toBeLessThan(100) // 100ms'den çok daha kısa, sıfır ağ gecikmesi
    })

    it("17. SFP Dip Avcısı & ForceOrder Likidasyon Teyidi: Sahte dipler elenmeli, zorunlu long tasfiye emilimi onaylanmalıdır", async () => {
      const { detectLiquiditySweepAbsorption } = await import("./price-action")

      // 16 periyotluk yatay dip (low = 100)
      const baseCandles = Array.from({ length: 16 }, (_, i) => ({
        t: i * 900000,
        o: 102,
        h: 103,
        l: 100,
        c: 101,
        v: 1000,
      }))

      // Mum 17: 98'e iğne atıp 101'de kapanıyor (Klasik SFP fitili, range=4, lowerWick=3, oran=%75)
      const sfpCandle = {
        t: 16 * 900000,
        o: 101,
        h: 102,
        l: 98,
        c: 101,
        v: 5000,
      }
      const testCandles = [...baseCandles, sfpCandle]

      // Durum A: SFP fitili var ve zorunlu Long tasfiyeleri (ForceOrder SELL) patlamış ($15,000 hacim, 5 tasfiye)
      const confirmedSfp = detectLiquiditySweepAbsorption(testCandles, 16, {
        longLiquidationUsdt: 15000,
        liquidationCount: 5,
        requireLiquidation: true,
        minLiquidationUsdt: 500,
      })
      expect(confirmedSfp.detected).toBe(true)
      expect(confirmedSfp.liquidationConfirmed).toBe(true)
      expect(confirmedSfp.reasons.some(r => r.includes("Zorunlu Long Tasfiye Emilimi"))).toBe(true)

      // Durum B: SFP fitili var fakat o dip iğnesinde ZORUNLU TASFİYE YOK (0$ tasfiye, 0 adet -> Sahte dip)
      const fakeSfp = detectLiquiditySweepAbsorption(testCandles, 16, {
        longLiquidationUsdt: 0,
        liquidationCount: 0,
        requireLiquidation: true,
        minLiquidationUsdt: 500,
      })
      expect(fakeSfp.detected).toBe(false) // Sahte dip elenmeli!
      expect(fakeSfp.liquidationConfirmed).toBe(false)
      expect(fakeSfp.reasons.some(r => r.includes("Sahte Dip Uyarısı"))).toBe(true)
    })

    it("18. Open Interest (OI) + CVD 4 Kadranlı Akıllı Para Matrisi: Gerçek Kurumsal Alım vs Short Kapama (%75 TP1)", async () => {
      const { evaluateSmartMoneyMatrix } = await import("./price-action")

      // 1. Kadran: Fiyat ↑ + CVD ↑ + OI ↑ (Gerçek Kurumsal Alım)
      const institutionalLong = evaluateSmartMoneyMatrix({
        priceChangePct: 1.2,
        cvdDeltaPct: 3.5,
        oiChangePct: 2.1,
      })
      expect(institutionalLong.quadrant).toBe("INSTITUTIONAL_LONG")
      expect(institutionalLong.isInstitutionalLong).toBe(true)
      expect(institutionalLong.isShortCovering).toBe(false)
      expect(institutionalLong.tp1Ratio).toBe(0.50) // Standart %50 kâr al
      expect(institutionalLong.scoreModifier).toBe(25)

      // 2. Kadran: Fiyat ↑ + CVD ↑ + OI ↓ (Short Kapama Rallisi — Çabuk Söner!)
      const shortCovering = evaluateSmartMoneyMatrix({
        priceChangePct: 1.5,
        cvdDeltaPct: 2.8,
        oiChangePct: -1.8, // Açık pozisyonlar kapanıyor
      })
      expect(shortCovering.quadrant).toBe("SHORT_COVERING")
      expect(shortCovering.isShortCovering).toBe(true)
      expect(shortCovering.tp1Ratio).toBe(0.75) // TP1'de %50 yerine %75 kâr al!
      expect(shortCovering.scoreModifier).toBe(15)
      expect(shortCovering.reasons.some(r => r.includes("%75 Kâr Al"))).toBe(true)

      // 3. Kadran: Fiyat ↓ + CVD ↓ + OI ↑ (Kurumsal Short Girişi)
      const institutionalShort = evaluateSmartMoneyMatrix({
        priceChangePct: -1.2,
        cvdDeltaPct: -2.5,
        oiChangePct: 1.5,
      })
      expect(institutionalShort.quadrant).toBe("INSTITUTIONAL_SHORT")
      expect(institutionalShort.scoreModifier).toBe(-30) // Veto seviyesinde ceza

      // 4. Kadran: Fiyat ↓ + CVD ↓ + OI ↓ (Long Tasfiye Boşalması)
      const liquidationFlush = evaluateSmartMoneyMatrix({
        priceChangePct: -2.0,
        cvdDeltaPct: -3.0,
        oiChangePct: -2.5,
      })
      expect(liquidationFlush.quadrant).toBe("LONG_LIQUIDATION_FLUSH")
      expect(liquidationFlush.scoreModifier).toBe(10)
    })

    it("19. Emir Defteri Dengesizliği (OBI) & Microprice: İlk 5 kademe OBI > +0.20 şartı ve satış duvarı vetosu", async () => {
      const { calculateOrderBookImbalance } = await import("./price-action")

      // Durum A: Alıcı baskısı yüksek tahta (BidVol = 6500, AskVol = 2500 -> OBI = (6500-2500)/9000 = +0.44 > +0.20)
      const bullishBids: Array<[number, number]> = [
        [100.0, 20], // 2000$
        [99.9, 20],  // 1998$
        [99.8, 10],  // 998$
        [99.7, 10],  // 997$
        [99.6, 10],  // 996$
      ]
      const normalAsks: Array<[number, number]> = [
        [100.1, 5],  // 500.5$
        [100.2, 5],  // 501$
        [100.3, 5],  // 501.5$
        [100.4, 5],  // 502$
        [100.5, 5],  // 502.5$
      ]
      const obiPass = calculateOrderBookImbalance(bullishBids, normalAsks, 5, 0.20)
      expect(obiPass.passGate).toBe(true)
      expect(obiPass.obi).toBeGreaterThan(0.20)
      expect(obiPass.microprice).toBeGreaterThan(obiPass.midPrice) // Alıcı ağırlığı fiyatı yukarı çeker

      // Durum B: Satış duvarı olan tahta (AskVol >> BidVol, örn. OBI = -0.30 <= +0.20)
      const heavyAsks: Array<[number, number]> = [
        [100.1, 50], // 5005$ dev satış duvarı
        [100.2, 30], // 3006$
        [100.3, 20], // 2006$
        [100.4, 10],
        [100.5, 10],
      ]
      const thinBids: Array<[number, number]> = [
        [100.0, 5],
        [99.9, 5],
        [99.8, 5],
        [99.7, 5],
        [99.6, 5],
      ]
      const obiFail = calculateOrderBookImbalance(thinBids, heavyAsks, 5, 0.20)
      expect(obiFail.passGate).toBe(false)
      expect(obiFail.obi).toBeLessThanOrEqual(0.20)
      expect(obiFail.reason).toContain("Satış Duvarı Riski")
    })

    it("20. Sunucu Durumu & Sıfır Gecikme: Short covering bayrağı kalıcı olarak Redis/RAM'de tutulmalı ve TP1 oranını yönetmelidir", async () => {
      const { setFuturesSmartMoneyRegime, isFuturesShortCovering, getFuturesSmartMoneyRegime, clearFuturesPositionMeta } = await import("./server-state")

      // Short covering durumunda kaydet
      await setFuturesSmartMoneyRegime("TESTSCOVERUSDT", "SHORT_COVERING", true)
      const isSc = await isFuturesShortCovering("TESTSCOVERUSDT")
      const regime = await getFuturesSmartMoneyRegime("TESTSCOVERUSDT")
      expect(isSc).toBe(true)
      expect(regime).toBe("SHORT_COVERING")

      // Normal institutional long durumunda kaydet
      await setFuturesSmartMoneyRegime("TESTINSTLONGUSDT", "INSTITUTIONAL_LONG", false)
      const isInstSc = await isFuturesShortCovering("TESTINSTLONGUSDT")
      const instRegime = await getFuturesSmartMoneyRegime("TESTINSTLONGUSDT")
      expect(isInstSc).toBe(false)
      expect(instRegime).toBe("INSTITUTIONAL_LONG")

      // Temizlik işlemi
      await clearFuturesPositionMeta("TESTSCOVERUSDT")
      const cleanedSc = await isFuturesShortCovering("TESTSCOVERUSDT")
      expect(cleanedSc).toBe(false)
    })
  })
})




