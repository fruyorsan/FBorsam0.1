"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Star, Search, TrendingUp, TrendingDown, ArrowUpRight, Zap,
  Flame, Sparkles, Filter, RefreshCw, Layers, ShieldCheck
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface CoinTicker {
  symbol: string
  name: string
  baseAsset: string
  pair: string
  price: number
  priceFormatted: string
  change24h: number
  high24h: number
  low24h: number
  quoteVolume: number
  volumeFormatted: string
  isMeme?: boolean
  isDefi?: boolean
  isTier1?: boolean
  category: "L1/L2" | "Meme" | "DeFi" | "AI/Gaming" | "Diğer"
}

// Popüler Kripto Veritabanı ve Türkçe İsimleri
const COIN_METADATA: Record<string, { name: string; category: "L1/L2" | "Meme" | "DeFi" | "AI/Gaming" | "Diğer"; color: string }> = {
  BTC: { name: "Bitcoin", category: "L1/L2", color: "from-amber-500 to-orange-600" },
  ETH: { name: "Ethereum", category: "L1/L2", color: "from-blue-500 to-indigo-600" },
  SOL: { name: "Solana", category: "L1/L2", color: "from-purple-500 to-emerald-500" },
  GALA: { name: "Gala Games", category: "AI/Gaming", color: "from-blue-600 to-cyan-500" },
  PEPE: { name: "Pepe", category: "Meme", color: "from-emerald-500 to-green-600" },
  DOGE: { name: "Dogecoin", category: "Meme", color: "from-amber-400 to-yellow-600" },
  SHIB: { name: "Shiba Inu", category: "Meme", color: "from-orange-500 to-rose-600" },
  BONK: { name: "Bonk", category: "Meme", color: "from-amber-500 to-yellow-500" },
  FLOKI: { name: "Floki", category: "Meme", color: "from-yellow-500 to-amber-600" },
  PENGU: { name: "Pudgy Penguins", category: "Meme", color: "from-cyan-400 to-blue-500" },
  WIF: { name: "dogwifhat", category: "Meme", color: "from-amber-600 to-orange-700" },
  TURBO: { name: "Turbo", category: "Meme", color: "from-yellow-400 to-amber-500" },
  NEIRO: { name: "First Neiro", category: "Meme", color: "from-rose-500 to-pink-600" },
  AVAX: { name: "Avalanche", category: "L1/L2", color: "from-red-500 to-rose-600" },
  NEAR: { name: "NEAR Protocol", category: "L1/L2", color: "from-emerald-400 to-teal-600" },
  SUI: { name: "Sui Network", category: "L1/L2", color: "from-cyan-500 to-blue-600" },
  APT: { name: "Aptos", category: "L1/L2", color: "from-teal-400 to-emerald-600" },
  XRP: { name: "Ripple", category: "L1/L2", color: "from-slate-400 to-slate-600" },
  BNB: { name: "BNB", category: "L1/L2", color: "from-yellow-500 to-amber-500" },
  ADA: { name: "Cardano", category: "L1/L2", color: "from-blue-600 to-indigo-700" },
  DOT: { name: "Polkadot", category: "L1/L2", color: "from-pink-500 to-rose-600" },
  LINK: { name: "Chainlink", category: "DeFi", color: "from-blue-500 to-sky-600" },
  RENDER: { name: "Render Network", category: "AI/Gaming", color: "from-red-500 to-orange-600" },
  FET: { name: "Artificial Superintelligence", category: "AI/Gaming", color: "from-indigo-500 to-purple-600" },
  UNI: { name: "Uniswap", category: "DeFi", color: "from-pink-500 to-rose-500" },
  AAVE: { name: "Aave", category: "DeFi", color: "from-purple-500 to-indigo-600" },
  PENDLE: { name: "Pendle", category: "DeFi", color: "from-cyan-500 to-teal-600" },
  INJ: { name: "Injective", category: "DeFi", color: "from-blue-500 to-cyan-500" },
  RAY: { name: "Raydium", category: "DeFi", color: "from-purple-400 to-indigo-500" },
  JUP: { name: "Jupiter", category: "DeFi", color: "from-emerald-400 to-teal-500" },
  ENA: { name: "Ethena", category: "DeFi", color: "from-slate-400 to-slate-700" },
  COW: { name: "CoW Protocol", category: "DeFi", color: "from-amber-600 to-orange-700" },
  SAND: { name: "The Sandbox", category: "AI/Gaming", color: "from-blue-400 to-cyan-500" },
  MANA: { name: "Decentraland", category: "AI/Gaming", color: "from-rose-500 to-pink-600" },
  AXS: { name: "Axie Infinity", category: "AI/Gaming", color: "from-blue-600 to-indigo-600" },
  WLD: { name: "Worldcoin", category: "AI/Gaming", color: "from-slate-700 to-black" },
  TAO: { name: "Bittensor", category: "AI/Gaming", color: "from-neutral-700 to-neutral-900" },
  ARB: { name: "Arbitrum", category: "L1/L2", color: "from-sky-500 to-blue-600" },
  OP: { name: "Optimism", category: "L1/L2", color: "from-red-500 to-rose-600" },
  TIA: { name: "Celestia", category: "L1/L2", color: "from-purple-500 to-violet-600" },
  SEI: { name: "Sei Network", category: "L1/L2", color: "from-red-600 to-rose-700" },
}

const FAVORITES_STORAGE_KEY = "bot:midas_favorite_coins"

function formatSmartPrice(price: number): string {
  if (!price || isNaN(price) || price <= 0) return "0.00 ₺"
  if (price < 0.001) return price.toFixed(8) + " ₺"
  if (price < 1) return price.toFixed(6) + " ₺"
  if (price < 10) return price.toFixed(4) + " ₺"
  return price.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺"
}

function formatVolume(vol: number): string {
  if (!vol || vol <= 0) return "₺0"
  if (vol >= 1_000_000_000) return `₺${(vol / 1_000_000_000).toFixed(1)} Mr`
  if (vol >= 1_000_000) return `₺${(vol / 1_000_000).toFixed(1)} Mn`
  if (vol >= 1_000) return `₺${(vol / 1_000).toFixed(0)} B`
  return `₺${vol.toFixed(0)}`
}

export function CoinsWatchlist({
  onSelectCoin,
  activePositions = [],
}: {
  onSelectCoin?: (symbol: string) => void
  activePositions?: Array<{ symbol: string }>
}) {
  const [coins, setCoins] = useState<CoinTicker[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [selectedFilter, setSelectedFilter] = useState<"all" | "favorites" | "gainers" | "losers" | "meme" | "defi">("all")
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  // Favoriler (localStorage kalıcı depolama)
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(FAVORITES_STORAGE_KEY)
        if (saved) return new Set(JSON.parse(saved))
      } catch {}
    }
    // Varsayılan favoriler: BTC, ETH, SOL, GALA, PEPE
    return new Set(["BTC", "ETH", "SOL", "GALA", "PEPE", "AVAX"])
  })

  const toggleFavorite = (symbol: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(symbol)) {
        next.delete(symbol)
      } else {
        next.add(symbol)
      }
      try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(next)))
      } catch {}
      return next
    })
  }

  // Canlı Binance 24h Ticker Çekimi
  const fetchTickers = async () => {
    try {
      const res = await fetch("https://api.binance.com/api/v3/ticker/24hr", {
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok) return
      const list: any[] = await res.json()
      if (!Array.isArray(list)) return

      // USDT/TRY kurunu çek
      let usdtTryPrice = 36.5
      const usdtTryItem = list.find((i) => i.symbol === "USDTTRY")
      if (usdtTryItem && parseFloat(usdtTryItem.lastPrice) > 0) {
        usdtTryPrice = parseFloat(usdtTryItem.lastPrice)
      }

      const tickerMap = new Map<string, any>()
      for (const item of list) {
        tickerMap.set(item.symbol, item)
      }

      const parsedCoins: CoinTicker[] = []
      const processedSymbols = new Set<string>()

      // 1. Önce tanımlı listemizdeki coinleri öncelikli çek
      for (const [sym, meta] of Object.entries(COIN_METADATA)) {
        processedSymbols.add(sym)
        // Önce TRY çiftini dene (örn: GALATRY), yoksa USDT çiftini TRY'ye çevir
        const tryItem = tickerMap.get(`${sym}TRY`)
        const usdtItem = tickerMap.get(`${sym}USDT`)

        let price = 0
        let change24h = 0
        let high24h = 0
        let low24h = 0
        let quoteVolume = 0

        if (tryItem) {
          price = parseFloat(tryItem.lastPrice) || 0
          change24h = parseFloat(tryItem.priceChangePercent) || 0
          high24h = parseFloat(tryItem.highPrice) || price
          low24h = parseFloat(tryItem.lowPrice) || price
          quoteVolume = parseFloat(tryItem.quoteVolume) || 0
        } else if (usdtItem) {
          const usdtP = parseFloat(usdtItem.lastPrice) || 0
          price = usdtP * usdtTryPrice
          change24h = parseFloat(usdtItem.priceChangePercent) || 0
          high24h = (parseFloat(usdtItem.highPrice) || usdtP) * usdtTryPrice
          low24h = (parseFloat(usdtItem.lowPrice) || usdtP) * usdtTryPrice
          quoteVolume = (parseFloat(usdtItem.quoteVolume) || 0) * usdtTryPrice
        }

        if (price > 0) {
          parsedCoins.push({
            symbol: sym,
            name: meta.name,
            baseAsset: sym,
            pair: tryItem ? `${sym}/TRY` : `${sym}/USDT`,
            price,
            priceFormatted: formatSmartPrice(price),
            change24h,
            high24h,
            low24h,
            quoteVolume,
            volumeFormatted: formatVolume(quoteVolume),
            isMeme: meta.category === "Meme",
            isDefi: meta.category === "DeFi",
            isTier1: ["BTC", "ETH", "SOL", "BNB", "XRP"].includes(sym),
            category: meta.category,
          })
        }
      }

      // 2. Binance TR'deki diğer popüler TRY çiftlerini de ekle
      for (const item of list) {
        if (!item.symbol?.endsWith("TRY")) continue
        const sym = item.symbol.replace(/TRY$/, "").toUpperCase()
        if (processedSymbols.has(sym)) continue
        if (["USDT", "BUSD", "FDUSD", "USDC", "TRY", "EUR"].includes(sym)) continue

        const qv = parseFloat(item.quoteVolume) || 0
        if (qv < 1_500_000) continue // Sadece hacmi 1.5M+ olanları listele

        const price = parseFloat(item.lastPrice) || 0
        if (price <= 0) continue

        processedSymbols.add(sym)
        parsedCoins.push({
          symbol: sym,
          name: sym,
          baseAsset: sym,
          pair: `${sym}/TRY`,
          price,
          priceFormatted: formatSmartPrice(price),
          change24h: parseFloat(item.priceChangePercent) || 0,
          high24h: parseFloat(item.highPrice) || price,
          low24h: parseFloat(item.lowPrice) || price,
          quoteVolume: qv,
          volumeFormatted: formatVolume(qv),
          category: "Diğer",
        })
      }

      setCoins(parsedCoins)
      setLastUpdated(new Date())
      setIsLoading(false)
    } catch (err) {
      console.warn("Watchlist fetch error:", err)
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTickers()
    const timer = setInterval(fetchTickers, 5000) // Her 5 saniyede bir canlı fiyat güncelleme
    return () => clearInterval(timer)
  }, [])

  // ⭐ SIRALAMA VE FİLTRELEME:
  // KURAL: Favoriler her zaman EN YUKARI ÇIKAR!
  const filteredAndSortedCoins = useMemo(() => {
    let result = [...coins]

    // 1. Arama Filtresi
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(
        (c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
      )
    }

    // 2. Kategori / Buton Filtresi
    if (selectedFilter === "favorites") {
      result = result.filter((c) => favorites.has(c.symbol))
    } else if (selectedFilter === "gainers") {
      result = result.filter((c) => c.change24h > 0)
    } else if (selectedFilter === "losers") {
      result = result.filter((c) => c.change24h < 0)
    } else if (selectedFilter === "meme") {
      result = result.filter((c) => c.isMeme || c.category === "Meme")
    } else if (selectedFilter === "defi") {
      result = result.filter((c) => c.isDefi || c.category === "DeFi")
    }

    // 3. ⭐ SIRALAMA ALGORİTMASI:
    // Favori olanlar (favorites.has(c.symbol)) EN TEPEDE!
    // Kendi aralarında da hacme göre veya seçilen filtreye göre sıralanır.
    result.sort((a, b) => {
      const aFav = favorites.has(a.symbol) ? 1 : 0
      const bFav = favorites.has(b.symbol) ? 1 : 0

      // Favori önceliği
      if (aFav !== bFav) return bFav - aFav

      // İkisi de favori veya ikisi de değilse:
      if (selectedFilter === "gainers") {
        return b.change24h - a.change24h
      }
      if (selectedFilter === "losers") {
        return a.change24h - b.change24h
      }
      // Varsayılan: En yüksek 24s hacimli olan öne geçsin
      return b.quoteVolume - a.quoteVolume
    })

    return result
  }, [coins, searchQuery, selectedFilter, favorites])

  const openHoldingsSymbols = useMemo(() => {
    return new Set(activePositions.map((p) => p.symbol.toUpperCase().replace(/TRY$/, "")))
  }, [activePositions])

  return (
    <div className="space-y-3">
      {/* 1. ÜST BAŞLIK, ARAMA VE FİLTRE ÇUBUĞU (Midas Tarzı Modern Header) */}
      <div className="rounded-xl border border-border/70 bg-gradient-to-r from-card/95 via-card to-card/90 p-3.5 shadow-md">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40 shrink-0">
              <Star className="size-5 fill-amber-400 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-black text-foreground tracking-tight">
                  Kripto Paralar & Midas Takip Listesi
                </h3>
                <Badge variant="outline" className="border-amber-500/40 text-amber-400 bg-amber-500/10 text-[10px] font-mono font-bold">
                  {favorites.size} Favori
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Yıldızladığınız coinler daima en üstte sabitlenir. Canlı Binance fiyatları anlık güncellenir.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Coin ara... (BTC, GALA, PEPE)"
                className="h-8 pl-8 text-xs bg-background/70 border-border/80 focus:border-amber-400 font-mono"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchTickers}
              className="h-8 px-2.5 text-xs font-mono border-border/70 hover:border-amber-400 shrink-0"
              title="Fiyatları Yenile"
            >
              <RefreshCw className={cn("size-3.5", isLoading && "animate-spin text-amber-400")} />
            </Button>
          </div>
        </div>

        {/* 2. KATEGORİ VE SIRALAMA FİLTRELERİ */}
        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-2.5 border-t border-border/50">
          <Button
            size="sm"
            variant={selectedFilter === "all" ? "default" : "ghost"}
            onClick={() => setSelectedFilter("all")}
            className={cn(
              "h-7 text-xs font-bold px-2.5 rounded-lg transition-all",
              selectedFilter === "all" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Tümü ({coins.length})
          </Button>

          <Button
            size="sm"
            variant={selectedFilter === "favorites" ? "default" : "ghost"}
            onClick={() => setSelectedFilter("favorites")}
            className={cn(
              "h-7 text-xs font-bold px-2.5 rounded-lg transition-all",
              selectedFilter === "favorites" ? "bg-amber-500 text-black shadow-xs font-black" : "text-amber-400 hover:bg-amber-500/10"
            )}
          >
            <Star className="size-3 fill-current mr-1" />
            Favorilerim ({favorites.size})
          </Button>

          <Button
            size="sm"
            variant={selectedFilter === "gainers" ? "default" : "ghost"}
            onClick={() => setSelectedFilter("gainers")}
            className={cn(
              "h-7 text-xs font-bold px-2.5 rounded-lg transition-all",
              selectedFilter === "gainers" ? "bg-emerald-600 text-white shadow-xs" : "text-emerald-400 hover:bg-emerald-500/10"
            )}
          >
            <TrendingUp className="size-3 mr-1" />
            En Çok Yükselenler
          </Button>

          <Button
            size="sm"
            variant={selectedFilter === "losers" ? "default" : "ghost"}
            onClick={() => setSelectedFilter("losers")}
            className={cn(
              "h-7 text-xs font-bold px-2.5 rounded-lg transition-all",
              selectedFilter === "losers" ? "bg-rose-600 text-white shadow-xs" : "text-rose-400 hover:bg-rose-500/10"
            )}
          >
            <TrendingDown className="size-3 mr-1" />
            Dipten Sekme Adayları
          </Button>

          <Button
            size="sm"
            variant={selectedFilter === "meme" ? "default" : "ghost"}
            onClick={() => setSelectedFilter("meme")}
            className={cn(
              "h-7 text-xs font-bold px-2.5 rounded-lg transition-all",
              selectedFilter === "meme" ? "bg-orange-600 text-white shadow-xs" : "text-orange-400 hover:bg-orange-500/10"
            )}
          >
            🎭 Meme Coinler
          </Button>

          <Button
            size="sm"
            variant={selectedFilter === "defi" ? "default" : "ghost"}
            onClick={() => setSelectedFilter("defi")}
            className={cn(
              "h-7 text-xs font-bold px-2.5 rounded-lg transition-all",
              selectedFilter === "defi" ? "bg-cyan-600 text-white shadow-xs" : "text-cyan-400 hover:bg-cyan-500/10"
            )}
          >
            🌐 DeFi Liderleri
          </Button>

          <span className="ml-auto text-[10px] font-mono text-muted-foreground hidden md:inline">
            Canlı Akış: {lastUpdated.toLocaleTimeString("tr-TR")}
          </span>
        </div>
      </div>

      {/* 3. MİDAS TARZI YATAY LİSTE (ALT ALTA ŞIK KARTLAR) */}
      <div className="space-y-1.5">
        {filteredAndSortedCoins.length === 0 && !isLoading && (
          <div className="p-8 text-center rounded-xl border border-dashed border-border/80 bg-card/50">
            <p className="text-xs text-muted-foreground">Aradığınız kriterlere uygun coin bulunamadı.</p>
            {selectedFilter !== "all" && (
              <Button size="sm" variant="link" onClick={() => setSelectedFilter("all")} className="text-amber-400 text-xs mt-1">
                Tüm Coinleri Göster
              </Button>
            )}
          </div>
        )}

        {filteredAndSortedCoins.map((coin, index) => {
          const isFav = favorites.has(coin.symbol)
          const isPositive = coin.change24h >= 0
          const isOpenInBot = openHoldingsSymbols.has(coin.symbol)
          const meta = COIN_METADATA[coin.symbol]
          const gradientColor = meta?.color || "from-slate-600 to-slate-800"

          // Fiyat aralığı yüzdesi (Günün dip - tepe pozisyonu)
          const range = coin.high24h - coin.low24h
          const rangePct = range > 0 ? Math.min(100, Math.max(0, ((coin.price - coin.low24h) / range) * 100)) : 50

          return (
            <div
              key={coin.symbol}
              onClick={() => onSelectCoin && onSelectCoin(coin.symbol)}
              className={cn(
                "group relative flex items-center justify-between gap-3 p-2.5 sm:p-3 rounded-xl border transition-all cursor-pointer",
                isFav
                  ? "border-amber-500/40 bg-gradient-to-r from-amber-500/[0.07] via-card to-card hover:border-amber-400/80 shadow-xs"
                  : "border-border/60 bg-card/80 hover:bg-card hover:border-primary/40",
                isOpenInBot && "ring-1 ring-emerald-500/50 border-emerald-500/60 bg-emerald-500/[0.04]"
              )}
            >
              {/* SOL KISIM: ⭐ Favori Yıldızı + Coin İkonu + İsim & Sembol */}
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                {/* ⭐ FAVORİ BUTONU */}
                <button
                  type="button"
                  onClick={(e) => toggleFavorite(coin.symbol, e)}
                  aria-label={`${coin.symbol} favori`}
                  className={cn(
                    "p-1.5 rounded-lg transition-transform hover:scale-125 focus:outline-hidden",
                    isFav ? "text-amber-400" : "text-muted-foreground/40 hover:text-amber-400/80"
                  )}
                  title={isFav ? "Favorilerden Çıkar" : "Favorilere Ekle (En Başa Sabitle)"}
                >
                  <Star className={cn("size-4 sm:size-4.5 transition-all", isFav ? "fill-amber-400 text-amber-400" : "fill-none")} />
                </button>

                {/* LOGO ROZETİ */}
                <div
                  className={cn(
                    "flex size-8 sm:size-9 items-center justify-center rounded-xl bg-gradient-to-br text-white font-black text-xs shadow-xs shrink-0 select-none",
                    gradientColor
                  )}
                >
                  {coin.symbol.slice(0, 3)}
                </div>

                {/* İSİM VE SEMBOL */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono font-black text-xs sm:text-sm text-foreground tracking-wide group-hover:text-primary transition-colors">
                      {coin.symbol}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
                      / TRY
                    </span>
                    {isOpenInBot && (
                      <Badge className="h-4 px-1.5 text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold">
                        🟢 Botta Açık
                      </Badge>
                    )}
                    {isFav && (
                      <Badge className="h-4 px-1 text-[8px] bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold hidden sm:inline-flex">
                        ⭐ Favori
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate max-w-[120px] sm:max-w-[180px]">
                    {coin.name}
                  </p>
                </div>
              </div>

              {/* ORTA KISIM: 24s Hacim & Günlük Dip/Tepe Çubuğu (Geniş Ekran) */}
              <div className="hidden md:flex flex-col items-center justify-center gap-1 px-4 min-w-[150px]">
                <div className="flex items-center justify-between w-full text-[10px] font-mono text-muted-foreground">
                  <span>D: {formatSmartPrice(coin.low24h)}</span>
                  <span className="text-foreground/80 font-bold">{coin.volumeFormatted}</span>
                  <span>Y: {formatSmartPrice(coin.high24h)}</span>
                </div>
                {/* Mini Dip-Tepe Barı */}
                <div className="w-full h-1.5 bg-muted/60 rounded-full overflow-hidden relative">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      isPositive ? "bg-emerald-400" : "bg-rose-400"
                    )}
                    style={{ width: `${Math.max(5, rangePct)}%` }}
                  />
                </div>
              </div>

              {/* SAĞ KISIM: CANLI FİYAT VE MİDAS TARZI DEĞİŞİM ROZETİ */}
              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                <div className="text-right">
                  <div className="font-mono font-black text-xs sm:text-sm text-foreground tracking-tight">
                    {coin.priceFormatted}
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground hidden sm:block">
                    24s Hacim: {coin.volumeFormatted}
                  </span>
                </div>

                {/* 🎯 MİDAS TARZI GÜNLÜK DEĞİŞİM KUTUCUĞU */}
                <div
                  className={cn(
                    "flex items-center justify-center gap-1 min-w-[72px] sm:min-w-[82px] h-7 sm:h-8 px-2 rounded-lg font-mono text-xs font-black shadow-xs border transition-transform group-hover:scale-105",
                    isPositive
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400 ring-1 ring-emerald-500/20"
                      : "bg-rose-500/15 border-rose-500/40 text-rose-400 ring-1 ring-rose-500/20"
                  )}
                >
                  {isPositive ? (
                    <TrendingUp className="size-3 sm:size-3.5 stroke-[2.5]" />
                  ) : (
                    <TrendingDown className="size-3 sm:size-3.5 stroke-[2.5]" />
                  )}
                  <span>
                    {isPositive ? "+" : ""}
                    {coin.change24h.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
