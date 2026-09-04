"use client"

import { useState, useEffect, useMemo } from "react"
import useSWR from "swr"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Flame,
  Globe2,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface CryptoItem {
  symbol: string
  displaySymbol: string
  name: string
  category: "meme" | "l1" | "ai" | "defi"
  decimals: number
  badge?: string
  price: number
  priceFormatted: string
  change: number
  isUp: boolean
  high: number
  low: number
  volumeUsdt: number
  volumeFormatted: string
}

interface OrderBookRow {
  price: number
  qty: number
  total: number
}

interface RecentTrade {
  id: number
  price: number
  qty: number
  time: string
  isBuy: boolean
}

const CATEGORIES = [
  { id: "all", label: "Tüm Kriptolar", icon: Globe2 },
  { id: "meme", label: "Meme Coinler 🐸", icon: Flame },
  { id: "l1", label: "Majör & L1 ⚡", icon: Layers },
  { id: "ai", label: "Yapay Zekâ (AI) 🤖", icon: Bot },
  { id: "defi", label: "DeFi & Web3 💎", icon: Zap },
]

export function CryptoExchange() {
  const [selectedSymbol, setSelectedSymbol] = useState("PEPEUSDT")
  const [category, setCategory] = useState("all")
  const [search, setSearch] = useState("")
  const [interval, setInterval] = useState("1h")
  const [prevPrice, setPrevPrice] = useState<number | null>(null)
  const [priceFlash, setPriceFlash] = useState<"up" | "down" | null>(null)

  // Virtual Wallet Simulator state
  const [walletBalance, setWalletBalance] = useState<number>(10000)
  const [holdings, setHoldings] = useState<Record<string, number>>({})
  const [orderType, setOrderType] = useState<"buy" | "sell">("buy")
  const [orderAmount, setOrderAmount] = useState<string>("")
  const [tradeMessage, setTradeMessage] = useState<string>("")

  // SWR for List of all cryptos (fast 3s polling for live market updates)
  const { data: listPayload, isLoading: listLoading, mutate: refreshList } = useSWR<{ data: CryptoItem[] }>(
    `/api/crypto?list=1${category !== "all" ? `&category=${category}` : ""}`,
    fetcher,
    { refreshInterval: 4000 }
  )

  // SWR for Detailed Selected Coin (ticker, klines, orderbook, trades)
  const { data: detail, isLoading: detailLoading, mutate: refreshDetail } = useSWR(
    `/api/crypto?symbol=${selectedSymbol}&interval=${interval}`,
    fetcher,
    { refreshInterval: 3000 }
  )

  // Flash price when it changes
  useEffect(() => {
    if (detail?.price) {
      if (prevPrice !== null && detail.price !== prevPrice) {
        setPriceFlash(detail.price > prevPrice ? "up" : "down")
        const t = setTimeout(() => setPriceFlash(null), 900)
        return () => clearTimeout(t)
      }
      setPrevPrice(detail.price)
    }
  }, [detail?.price, prevPrice])

  // Load wallet from localStorage
  useEffect(() => {
    try {
      const savedBalance = localStorage.getItem("piyasaiq:crypto:wallet")
      const savedHoldings = localStorage.getItem("piyasaiq:crypto:holdings")
      if (savedBalance) setWalletBalance(parseFloat(savedBalance))
      if (savedHoldings) setHoldings(JSON.parse(savedHoldings))
    } catch {}
  }, [])

  // Filter list by search
  const filteredList = useMemo(() => {
    const list = listPayload?.data || []
    if (!search.trim()) return list
    const q = search.trim().toUpperCase()
    return list.filter(
      (c) =>
        c.symbol.includes(q) ||
        c.displaySymbol.includes(q) ||
        c.name.toUpperCase().includes(q)
    )
  }, [listPayload?.data, search])

  // Chart config
  const chartConfig = {
    price: {
      label: "Fiyat (USDT)",
      color: detail?.isUp ? "oklch(0.76 0.16 174)" : "oklch(0.69 0.19 25)",
    },
  } satisfies ChartConfig

  // Execute Virtual Spot Trade
  function handleExecuteTrade(e: React.FormEvent) {
    e.preventDefault()
    const amountNum = parseFloat(orderAmount)
    if (!amountNum || amountNum <= 0 || !detail?.price) {
      setTradeMessage("Geçerli bir miktar girin.")
      return
    }

    const currentPrice = detail.price
    const currentHolding = holdings[selectedSymbol] || 0

    if (orderType === "buy") {
      const totalCost = amountNum * currentPrice
      if (totalCost > walletBalance) {
        setTradeMessage("Yetersiz USDT bakiyesi!")
        return
      }
      const newBal = walletBalance - totalCost
      const newHoldings = { ...holdings, [selectedSymbol]: currentHolding + amountNum }
      setWalletBalance(newBal)
      setHoldings(newHoldings)
      localStorage.setItem("piyasaiq:crypto:wallet", newBal.toString())
      localStorage.setItem("piyasaiq:crypto:holdings", JSON.stringify(newHoldings))
      setTradeMessage(`Başarılı: ${amountNum} ${detail.meta.displaySymbol} alındı!`)
      setOrderAmount("")
    } else {
      if (amountNum > currentHolding) {
        setTradeMessage(`Yetersiz ${detail.meta.displaySymbol} bakiyesi!`)
        return
      }
      const totalReturn = amountNum * currentPrice
      const newBal = walletBalance + totalReturn
      const newHoldings = { ...holdings, [selectedSymbol]: currentHolding - amountNum }
      setWalletBalance(newBal)
      setHoldings(newHoldings)
      localStorage.setItem("piyasaiq:crypto:wallet", newBal.toString())
      localStorage.setItem("piyasaiq:crypto:holdings", JSON.stringify(newHoldings))
      setTradeMessage(`Başarılı: ${amountNum} ${detail.meta.displaySymbol} satıldı!`)
      setOrderAmount("")
    }

    setTimeout(() => setTradeMessage(""), 4000)
  }

  // Quick percent of wallet for buy or sell
  function handleQuickPercent(pct: number) {
    if (!detail?.price) return
    if (orderType === "buy") {
      const budget = (walletBalance * pct) / 100
      const qty = budget / detail.price
      setOrderAmount(qty > 10 ? Math.floor(qty).toString() : qty.toFixed(4))
    } else {
      const currentHolding = holdings[selectedSymbol] || 0
      const qty = (currentHolding * pct) / 100
      setOrderAmount(qty > 10 ? Math.floor(qty).toString() : qty.toFixed(4))
    }
  }

  return (
    <div className="flex flex-col gap-3.5 p-3 lg:p-4 animate-in fade-in-50 duration-300">
      {/* ── Top Trending Hot Coins Bar (PEPE, PENGU, FLOKI...) ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card/75 p-2.5 backdrop-blur-md shadow-md">
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto py-0.5">
          <div className="flex items-center gap-1.5 px-2 py-1 font-mono text-xs font-bold text-primary">
            <Flame className="size-4 text-positive animate-bounce" />
            <span className="hidden sm:inline">TRENDING:</span>
          </div>

          {[
            { s: "PEPEUSDT", label: "PEPE 🐸" },
            { s: "PENGUUSDT", label: "PENGU 🐧" },
            { s: "FLOKIUSDT", label: "FLOKI 🐕" },
            { s: "BTCUSDT", label: "BTC 👑" },
            { s: "SOLUSDT", label: "SOL ⚡" },
            { s: "DOGEUSDT", label: "DOGE" },
            { s: "SHIBUSDT", label: "SHIB" },
            { s: "BONKUSDT", label: "BONK" },
            { s: "WIFUSDT", label: "WIF 🧢" },
            { s: "SUIUSDT", label: "SUI" },
          ].map((c) => (
            <button
              key={c.s}
              type="button"
              onClick={() => setSelectedSymbol(c.s)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-all",
                selectedSymbol === c.s
                  ? "bg-primary text-primary-foreground shadow-md scale-105"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        {/* Live Binance Feed Pulse Indicator */}
        <div className="flex items-center gap-2 px-2 text-[11px] font-mono text-muted-foreground">
          <span className="size-2 rounded-full bg-positive animate-ping" />
          <span className="font-semibold text-foreground">BINANCE CANLI AKIŞ</span>
        </div>
      </div>

      {/* ── Main Grid Layout: Left Screener List | Center Chart & Live Board | Right Orderbook & Simulator ── */}
      <div className="grid gap-3.5 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        
        {/* ═══════════════════════════════════════
            LEFT: Live Crypto Screener & Selector
        ═══════════════════════════════════════ */}
        <Card size="sm" className="flex flex-col h-[740px] border-border/80 bg-card/85 backdrop-blur-md">
          <CardHeader className="p-3 border-b space-y-2.5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                <Globe2 className="size-4 text-primary" />
                Kripto Piyasaları
              </CardTitle>
              <Badge variant="outline" className="font-mono text-[10px] text-positive border-positive/30">
                24S CANLI
              </Badge>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Örn: PEPE, PENGU, FLOKI..."
                className="h-8 pl-8 text-xs bg-background/60"
              />
            </div>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1 pt-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors",
                    category === cat.id
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  )}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </CardHeader>

          {/* Crypto List Items */}
          <CardContent className="p-0 flex-1 overflow-y-auto divide-y divide-border/40">
            {listLoading && !listPayload ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Spinner className="size-6 mb-2" />
                <span className="text-xs">Fiyatlar güncelleniyor...</span>
              </div>
            ) : filteredList.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                Kripto bulunamadı.
              </div>
            ) : (
              filteredList.map((coin) => (
                <button
                  key={coin.symbol}
                  type="button"
                  onClick={() => setSelectedSymbol(coin.symbol)}
                  className={cn(
                    "w-full flex items-center justify-between p-3 text-left transition-colors hover:bg-muted/40",
                    selectedSymbol === coin.symbol && "bg-primary/10 border-l-2 border-primary"
                  )}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-foreground">
                        {coin.displaySymbol}
                      </span>
                      {coin.badge && (
                        <span className="rounded bg-muted px-1 py-0.2 font-mono text-[9px] text-muted-foreground">
                          {coin.badge}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[10px] text-muted-foreground">{coin.name}</p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-mono text-xs font-semibold tabular-nums">
                      ${coin.priceFormatted}
                    </p>
                    <p
                      className={cn(
                        "font-mono text-[10px] font-bold flex items-center justify-end gap-0.5",
                        coin.isUp ? "text-positive" : "text-negative"
                      )}
                    >
                      {coin.isUp ? "+" : ""}
                      {coin.change.toFixed(2)}%
                    </p>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {/* ═══════════════════════════════════════
            CENTER: Live Price Banner & Interactive Chart
        ═══════════════════════════════════════ */}
        <div className="flex flex-col gap-3.5">
          {/* Main Price & Stats Header Banner */}
          <Card size="sm" className="border-border/80 bg-card/85 backdrop-blur-md p-4 shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Coin Title & Current Price */}
              <div className="flex items-center gap-3.5">
                <div className="flex size-11 items-center justify-center rounded-2xl border border-primary/40 bg-primary/15 text-primary shadow-[0_0_20px_color-mix(in_oklch,var(--primary)_25%,transparent)] font-mono font-black text-sm">
                  {detail?.meta?.displaySymbol?.slice(0, 3) || "CRP"}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-mono text-xl font-black text-foreground">
                      {detail?.meta?.displaySymbol || "PEPE"}/USDT
                    </h2>
                    <Badge variant="outline" className="font-mono text-xs text-primary border-primary/30">
                      {detail?.meta?.name || "Pepe"}
                    </Badge>
                  </div>

                  {/* Live Price with Flash Animation */}
                  <div className="flex items-baseline gap-2.5 mt-0.5">
                    <span
                      className={cn(
                        "font-mono text-2xl lg:text-3xl font-black tabular-nums transition-colors duration-300",
                        priceFlash === "up" && "text-positive animate-pulse",
                        priceFlash === "down" && "text-negative animate-pulse",
                        !priceFlash && "text-foreground"
                      )}
                    >
                      ${detail?.priceFormatted || "0.00"}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-sm font-bold flex items-center gap-0.5 rounded px-1.5 py-0.5",
                        detail?.isUp ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative"
                      )}
                    >
                      {detail?.isUp ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                      {detail?.isUp ? "+" : ""}
                      {detail?.change?.toFixed(2) || 0}%
                    </span>
                  </div>
                </div>
              </div>

              {/* 24h Stats Badges */}
              <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
                <div className="rounded-xl border border-border/60 bg-background/50 p-2 text-right">
                  <p className="text-[10px] text-muted-foreground uppercase">24s En Yüksek</p>
                  <p className="font-semibold text-positive tabular-nums">
                    ${detail?.high?.toLocaleString("en-US", { maximumFractionDigits: detail?.meta?.decimals || 6 })}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/50 p-2 text-right">
                  <p className="text-[10px] text-muted-foreground uppercase">24s En Düşük</p>
                  <p className="font-semibold text-negative tabular-nums">
                    ${detail?.low?.toLocaleString("en-US", { maximumFractionDigits: detail?.meta?.decimals || 6 })}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/50 p-2 text-right">
                  <p className="text-[10px] text-muted-foreground uppercase">24s Hacim (USDT)</p>
                  <p className="font-semibold text-foreground tabular-nums">
                    ${detail?.volumeUsdt ? (detail.volumeUsdt / 1_000_000).toFixed(2) + "M" : "—"}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* Interactive Chart Container */}
          <Card size="sm" className="border-border/80 bg-card/85 backdrop-blur-md p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-foreground">Canlı Fiyat Grafiği</span>
                {detail?.technical && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[10px]",
                      detail.technical.signal.includes("AL")
                        ? "border-positive/40 bg-positive/10 text-positive"
                        : "border-negative/40 bg-negative/10 text-negative"
                    )}
                  >
                    {detail.technical.signal} (%{detail.technical.confidence})
                  </Badge>
                )}
              </div>

              {/* Interval Selectors */}
              <div className="flex items-center gap-1">
                {[
                  { v: "15m", l: "15d" },
                  { v: "1h", l: "1s" },
                  { v: "4h", l: "4s" },
                  { v: "1d", l: "1g" },
                ].map((item) => (
                  <Button
                    key={item.v}
                    size="sm"
                    variant={interval === item.v ? "default" : "ghost"}
                    onClick={() => setInterval(item.v)}
                    className="h-7 px-2.5 text-xs font-mono"
                  >
                    {item.l}
                  </Button>
                ))}
              </div>
            </div>

            {/* Recharts Area Chart */}
            <div className="h-[300px] w-full">
              {detailLoading && !detail ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Spinner className="size-6 mr-2" />
                  Grafik yükleniyor...
                </div>
              ) : detail?.candles?.length > 0 ? (
                <ChartContainer config={chartConfig} className="h-full w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={detail.candles} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="cryptoFill" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="5%"
                            stopColor={detail.isUp ? "oklch(0.76 0.16 174)" : "oklch(0.69 0.19 25)"}
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor={detail.isUp ? "oklch(0.76 0.16 174)" : "oklch(0.69 0.19 25)"}
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="color-mix(in oklch, var(--border) 60%, transparent)" />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={35}
                        fontSize={11}
                        tick={{ fill: "currentColor", opacity: 0.6 }}
                      />
                      <YAxis
                        orientation="right"
                        domain={["auto", "auto"]}
                        tickLine={false}
                        axisLine={false}
                        fontSize={11}
                        tick={{ fill: "currentColor", opacity: 0.6 }}
                        tickFormatter={(val) => Number(val).toLocaleString("en-US", { maximumFractionDigits: 6 })}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        type="monotone"
                        dataKey="close"
                        name="Fiyat"
                        stroke={detail.isUp ? "oklch(0.76 0.16 174)" : "oklch(0.69 0.19 25)"}
                        strokeWidth={2}
                        fill="url(#cryptoFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
                  Grafik verisi alınamadı.
                </div>
              )}
            </div>

            {/* Micro Key Indicators */}
            {detail?.technical?.breakdown && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {detail.technical.breakdown.slice(0, 3).map((ind: { key: string; title: string; note: string }) => (
                  <div key={ind.key} className="rounded-lg border border-border/60 bg-muted/30 p-2">
                    <p className="font-mono text-[10px] text-muted-foreground uppercase">{ind.key}</p>
                    <p className="font-semibold text-xs text-foreground mt-0.5">{ind.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{ind.note}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Recent Trades Table */}
          <Card size="sm" className="border-border/80 bg-card/85 backdrop-blur-md p-3.5">
            <div className="flex items-center justify-between border-b border-border/60 pb-2 mb-2">
              <span className="font-mono text-xs font-bold text-foreground flex items-center gap-1.5">
                <Zap className="size-3.5 text-primary" /> Canlı Son İşlemler (Binance)
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">ANLIK AKIŞ</span>
            </div>

            <div className="grid grid-cols-4 font-mono text-[11px] text-muted-foreground border-b border-border/40 pb-1 mb-1">
              <span>Zaman</span>
              <span>Tür</span>
              <span className="text-right">Fiyat ($)</span>
              <span className="text-right">Miktar</span>
            </div>

            <div className="divide-y divide-border/30 max-h-[140px] overflow-y-auto font-mono text-xs">
              {(detail?.recentTrades || []).slice(0, 8).map((trade: RecentTrade) => (
                <div key={trade.id} className="grid grid-cols-4 py-1 items-center hover:bg-muted/30">
                  <span className="text-muted-foreground text-[10px]">{trade.time}</span>
                  <span className={cn("text-[10px] font-bold", trade.isBuy ? "text-positive" : "text-negative")}>
                    {trade.isBuy ? "ALIM" : "SATIM"}
                  </span>
                  <span className="text-right tabular-nums font-semibold">
                    ${trade.price.toLocaleString("en-US", { maximumFractionDigits: detail?.meta?.decimals || 6 })}
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground text-[11px]">
                    {trade.qty.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ═══════════════════════════════════════
            RIGHT: Live Order Book & Spot Trade Simulator
        ═══════════════════════════════════════ */}
        <div className="flex flex-col gap-3.5">
          {/* Virtual Wallet & Trading Box */}
          <Card size="sm" className="border-border/80 bg-card/90 backdrop-blur-md p-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-border/60 pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <Wallet className="size-4 text-primary" />
                <span className="font-mono text-xs font-bold">Spot Kripto İşlemleri</span>
              </div>
              <span className="font-mono text-[10px] text-positive font-bold">SİMÜLATÖR</span>
            </div>

            {/* Wallet Balance Display */}
            <div className="rounded-xl border border-border/60 bg-muted/40 p-2.5 mb-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground">Kullanılabilir Bakiye</p>
                <p className="font-mono text-sm font-bold text-foreground tabular-nums">
                  ${walletBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">{detail?.meta?.displaySymbol} Varlığı</p>
                <p className="font-mono text-xs font-bold text-primary tabular-nums">
                  {(holdings[selectedSymbol] || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Buy / Sell Tab Buttons */}
            <div className="grid grid-cols-2 rounded-lg bg-muted/50 p-1 mb-3">
              <button
                type="button"
                onClick={() => setOrderType("buy")}
                className={cn(
                  "rounded-md py-1.5 text-xs font-bold transition-all",
                  orderType === "buy" ? "bg-positive text-white shadow" : "text-muted-foreground hover:text-foreground"
                )}
              >
                AL (BUY)
              </button>
              <button
                type="button"
                onClick={() => setOrderType("sell")}
                className={cn(
                  "rounded-md py-1.5 text-xs font-bold transition-all",
                  orderType === "sell" ? "bg-negative text-white shadow" : "text-muted-foreground hover:text-foreground"
                )}
              >
                SAT (SELL)
              </button>
            </div>

            {/* Trade Form */}
            <form onSubmit={handleExecuteTrade} className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                  İşlem Miktarı ({detail?.meta?.displaySymbol})
                </label>
                <Input
                  type="number"
                  step="any"
                  value={orderAmount}
                  onChange={(e) => setOrderAmount(e.target.value)}
                  placeholder="0.00"
                  className="font-mono text-xs h-9"
                />
              </div>

              {/* Quick Percent Buttons */}
              <div className="grid grid-cols-4 gap-1.5">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handleQuickPercent(pct)}
                    className="rounded border border-border/70 bg-muted/40 py-1 font-mono text-[10px] font-semibold hover:bg-muted hover:text-foreground transition-colors"
                  >
                    %{pct}
                  </button>
                ))}
              </div>

              {tradeMessage && (
                <div
                  className={cn(
                    "p-2 rounded text-[11px] font-medium text-center",
                    tradeMessage.includes("Başarılı")
                      ? "bg-positive/20 text-positive"
                      : "bg-negative/20 text-negative"
                  )}
                >
                  {tradeMessage}
                </div>
              )}

              <Button
                type="submit"
                className={cn(
                  "w-full font-bold text-xs h-10 shadow-lg text-white",
                  orderType === "buy"
                    ? "bg-positive hover:bg-positive/90"
                    : "bg-negative hover:bg-negative/90"
                )}
              >
                {orderType === "buy"
                  ? `${detail?.meta?.displaySymbol || "COIN"} Satın Al`
                  : `${detail?.meta?.displaySymbol || "COIN"} Sat`}
              </Button>
            </form>
          </Card>

          {/* Real Binance Order Book (Depth) */}
          <Card size="sm" className="border-border/80 bg-card/85 backdrop-blur-md p-3.5 flex-1">
            <div className="flex items-center justify-between border-b border-border/60 pb-2 mb-2">
              <span className="font-mono text-xs font-bold text-foreground">Canlı Emir Tahtası (Order Book)</span>
              <span className="font-mono text-[10px] text-muted-foreground">DERİNLİK</span>
            </div>

            <div className="grid grid-cols-3 font-mono text-[10px] text-muted-foreground border-b border-border/40 pb-1 mb-1">
              <span>Fiyat ($)</span>
              <span className="text-right">Miktar</span>
              <span className="text-right">Toplam ($)</span>
            </div>

            {/* Asks (Sell Orders - Red) */}
            <div className="space-y-0.5 divide-y divide-transparent font-mono text-[11px]">
              {(detail?.orderBook?.asks || []).slice(0, 5).reverse().map((ask: OrderBookRow, i: number) => (
                <div key={i} className="relative grid grid-cols-3 py-0.5 items-center">
                  <span className="text-negative font-semibold tabular-nums">
                    ${ask.price.toLocaleString("en-US", { maximumFractionDigits: detail?.meta?.decimals || 6 })}
                  </span>
                  <span className="text-right text-muted-foreground tabular-nums">
                    {ask.qty.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                  </span>
                  <span className="text-right tabular-nums text-foreground">
                    ${Math.round(ask.total).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            {/* Current Price Midpoint Divider */}
            <div className="my-2 py-1 px-2 rounded bg-muted/60 flex items-center justify-between font-mono text-xs font-bold">
              <span className={cn(detail?.isUp ? "text-positive" : "text-negative")}>
                ${detail?.priceFormatted}
              </span>
              <span className="text-[10px] text-muted-foreground font-normal">Piyasa Fiyatı</span>
            </div>

            {/* Bids (Buy Orders - Green) */}
            <div className="space-y-0.5 divide-y divide-transparent font-mono text-[11px]">
              {(detail?.orderBook?.bids || []).slice(0, 5).map((bid: OrderBookRow, i: number) => (
                <div key={i} className="relative grid grid-cols-3 py-0.5 items-center">
                  <span className="text-positive font-semibold tabular-nums">
                    ${bid.price.toLocaleString("en-US", { maximumFractionDigits: detail?.meta?.decimals || 6 })}
                  </span>
                  <span className="text-right text-muted-foreground tabular-nums">
                    {bid.qty.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                  </span>
                  <span className="text-right tabular-nums text-foreground">
                    ${Math.round(bid.total).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
