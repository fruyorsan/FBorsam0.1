"use client"

import { useState, useMemo } from "react"
import useSWR from "swr"
import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Zap,
  Layers,
  BarChart3,
  Calculator,
  ArrowRight,
  Target,
  Activity,
  Bot,
  ExternalLink,
  ShieldCheck,
  Clock,
  Compass,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { CryptoStockAnalysis, CryptoScanResult } from "@/lib/crypto-scanner-data"

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || "Kripto verisi alınamadı")
    return data
  })

const fmt = (v?: number) =>
  Number.isFinite(v)
    ? v!.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—"

export function CryptoScannerTerminal({
  onSelectInTerminal,
  onBack,
}: {
  onSelectInTerminal?: (symbol: string) => void
  onBack: () => void
}) {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterTab, setFilterTab] = useState<"ALL" | "EXPLOSIONS" | "WEEKLY" | "BUYS" | "SELLS">("EXPLOSIONS")
  const [activeTab, setActiveTab] = useState<"signal" | "ai" | "technical" | "calculator">("signal")
  const [calculatorCapitalUsdt, setCalculatorCapitalUsdt] = useState("1000")

  // SWR: fetch crypto scanner data
  const { data, error, isLoading, mutate, isValidating } = useSWR<{
    success: boolean
    topPick: CryptoStockAnalysis
    topBuys: CryptoStockAnalysis[]
    topSells: CryptoStockAnalysis[]
    dailyExplosions: CryptoStockAnalysis[]
    weeklySwings: CryptoStockAnalysis[]
    selectedCoin: CryptoStockAnalysis
    allCoins: CryptoStockAnalysis[]
    timestamp: string
  }>(
    `/api/crypto/scanner${selectedSymbol ? `?symbol=${selectedSymbol}&ai=1` : "?ai=1"}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 25000,
    }
  )

  const topPick = data?.topPick
  const activeCoin = data?.selectedCoin ?? topPick
  const allCoins = data?.allCoins ?? []

  // Filtered coins list
  const filteredCoins = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allCoins.filter((c) => {
      const matchSearch =
        !q ||
        c.symbol.toLowerCase().includes(q) ||
        c.displaySymbol.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q)

      let matchFilter = true
      if (filterTab === "EXPLOSIONS") {
        matchFilter = c.timeHorizon === "GÜN İÇİ (BUGÜN PATLAMA)" && (c.signal === "GÜÇLÜ AL" || c.signal === "AL")
      } else if (filterTab === "WEEKLY") {
        matchFilter = c.timeHorizon === "HAFTALIK (YARI OTOMASYON)" && (c.signal === "GÜÇLÜ AL" || c.signal === "AL")
      } else if (filterTab === "BUYS") {
        matchFilter = c.signal === "GÜÇLÜ AL" || c.signal === "AL"
      } else if (filterTab === "SELLS") {
        matchFilter = c.signal === "SAT" || c.signal === "GÜÇLÜ SAT" || c.isSellWarning
      }

      return matchSearch && matchFilter
    })
  }, [allCoins, searchQuery, filterTab])

  // Trade Calculator Math in USDT
  const capitalNum = parseFloat(calculatorCapitalUsdt) || 0
  const coinPrice = activeCoin?.price || 1
  const quantity = coinPrice > 0 ? capitalNum / coinPrice : 0
  const target1ProfitUsdt = quantity * ((activeCoin?.plan.target1 ?? coinPrice) - coinPrice)
  const target1Percent = activeCoin?.plan.target1Percent ?? 0
  const target2ProfitUsdt = quantity * ((activeCoin?.plan.target2 ?? coinPrice) - coinPrice)
  const target2Percent = activeCoin?.plan.target2Percent ?? 0
  const stopLossAmountUsdt = quantity * (coinPrice - (activeCoin?.plan.stopLoss ?? coinPrice))
  const stopLossPercent = Math.abs(activeCoin?.plan.stopLossPercent ?? 0)

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 pb-12">
      {/* 1. ÜST HEADER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-gradient-to-r from-card via-card/95 to-amber-950/20 p-4 sm:p-5 shadow-sm backdrop-blur-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Flame className="size-5" />
            </div>
            <h1 className="text-lg sm:text-xl font-black tracking-tight text-foreground flex items-center gap-2">
              Kripto & Coin Seçici (Günün Patlaması & Haftalık Yarı Otomasyon)
            </h1>
            <Badge variant="outline" className="text-[10px] font-mono border-amber-500/50 text-amber-400 bg-amber-500/10 font-bold">
              BINANCE CANLI
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Karmaşık grafiklere boğulmadan; gün içinde patlama yapacak coinler, haftalık yarı otomasyon hedefleri ve net giriş-çıkış fiyatları.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => mutate()}
            disabled={isValidating}
            className="h-8 gap-1.5 text-xs font-semibold"
          >
            <RefreshCw className={cn("size-3.5", isValidating && "animate-spin text-amber-400")} />
            {isValidating ? "Taranıyor…" : "Yenile"}
          </Button>
          <Button variant="secondary" size="sm" onClick={onBack} className="h-8 text-xs font-semibold">
            Terminale Dön
          </Button>
        </div>
      </div>

      {isLoading && !data && (
        <Card className="p-16 text-center">
          <div className="flex flex-col items-center justify-center gap-3">
            <RefreshCw className="size-8 animate-spin text-amber-400" />
            <p className="text-sm font-semibold text-foreground">Binance kripto evreni taranıyor ve analiz ediliyor…</p>
            <p className="text-xs text-muted-foreground">RVOL (hacim katı), RSI, trend ve gün içi patlama algoritmaları devrede.</p>
          </div>
        </Card>
      )}

      {error && (
        <Card className="border-rose-500/40 bg-rose-500/10 p-5 text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 shrink-0" />
            <p className="text-sm font-semibold">{error.message || "Kripto verisi yüklenirken hata oluştu."}</p>
          </div>
          <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={() => mutate()}>
            Yeniden Dene
          </Button>
        </Card>
      )}

      {data && topPick && (
        <>
          {/* 2. 🌟 GÜNÜN YILDIZ KRİPTO COİNİ (HERO CARD - TOP PICK) */}
          <div className={cn(
            "relative overflow-hidden rounded-2xl border-2 p-4 sm:p-6 shadow-xl backdrop-blur-md",
            topPick.timeHorizon === "GÜN İÇİ (BUGÜN PATLAMA)"
              ? "border-amber-500/80 bg-gradient-to-br from-card via-card to-amber-950/30 ring-1 ring-amber-500/40"
              : "border-emerald-500/80 bg-gradient-to-br from-card via-card to-emerald-950/30 ring-1 ring-emerald-500/40"
          )}>
            <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-amber-500/10 blur-3xl" />

            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-black border",
                    topPick.timeHorizon === "GÜN İÇİ (BUGÜN PATLAMA)"
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse"
                      : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  )}>
                    <Sparkles className="size-3.5 text-amber-300" />
                    {topPick.timeHorizon === "GÜN İÇİ (BUGÜN PATLAMA)"
                      ? "⚡ BUGÜN PATLAMA BEKLENEN 1 NUMARALI COİN"
                      : "🏆 GÜNÜN YILDIZ KRİPTO SEÇİMİ"}
                  </span>

                  <Badge variant="outline" className="font-mono text-xs border-amber-500/60 text-amber-300 bg-amber-950/60 font-black">
                    {topPick.signal}
                  </Badge>

                  <Badge variant="outline" className="font-mono text-xs border-sky-500/50 text-sky-300 bg-sky-950/50 font-bold">
                    {topPick.timeHorizon}
                  </Badge>

                  <span className="text-xs text-muted-foreground font-mono">
                    Güven: %{topPick.confidence} · Algoritmik Puan: {topPick.score}/100
                  </span>
                </div>

                <div className="flex items-baseline gap-3 pt-1">
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground font-mono flex items-center gap-2">
                    {topPick.displaySymbol}
                    <span className="text-xs font-normal text-muted-foreground">/ USDT</span>
                  </h2>
                  <span className="text-sm sm:text-base font-bold text-muted-foreground">
                    {topPick.name}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {topPick.badge}
                  </Badge>
                </div>
              </div>

              {/* Fiyat ve Değişim */}
              <div className="text-left sm:text-right font-mono">
                <span className="text-[10px] text-muted-foreground block uppercase font-bold tracking-wider">CANLI FİYAT</span>
                <div className="flex items-baseline gap-2">
                  <b className="text-2xl sm:text-3xl font-black text-foreground">
                    ${topPick.priceFormatted}
                  </b>
                  <span className={cn(
                    "inline-flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded",
                    topPick.change >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                  )}>
                    {topPick.change >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                    {topPick.change >= 0 ? "+" : ""}{topPick.change}%
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground block font-mono mt-0.5">
                  24s Hacim: {topPick.volumeFormatted} · Hacim Katı: {topPick.technical.rvol}x
                </span>
              </div>
            </div>

            {/* İŞLEM PLANI KUTUCUKLARI (HEDEF, STOP, GİRİŞ ARALIĞI) */}
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 font-mono">
              <div className="rounded-xl border border-border/80 bg-background/60 p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground block font-semibold font-sans">📍 İdeal Giriş Aralığı</span>
                <span className="text-xs sm:text-sm font-bold text-foreground mt-0.5 block truncate">
                  ${topPick.plan.entryMin} - ${topPick.plan.entryMax}
                </span>
                <span className="text-[10px] text-emerald-400 font-semibold block font-sans">Bu Fiyattan Al</span>
              </div>

              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground block font-semibold font-sans">🎯 1. Hedef Fiyat (TP1)</span>
                <span className="text-xs sm:text-sm font-bold text-emerald-400 mt-0.5 block truncate">
                  ${topPick.plan.target1}
                </span>
                <span className="text-[10px] text-emerald-300 font-bold block font-sans">
                  +{topPick.plan.target1Percent}% (İlk Kâr Alma)
                </span>
              </div>

              <div className="rounded-xl border border-emerald-500/60 bg-emerald-950/30 p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground block font-semibold font-sans">🚀 2. Hedef Fiyat (TP2)</span>
                <span className="text-xs sm:text-sm font-bold text-emerald-300 mt-0.5 block truncate">
                  ${topPick.plan.target2}
                </span>
                <span className="text-[10px] text-emerald-300 font-bold block font-sans">
                  +{topPick.plan.target2Percent}% (Ana Patlama)
                </span>
              </div>

              <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground block font-semibold font-sans">🛑 Zarar Durdur (Stop)</span>
                <span className="text-xs sm:text-sm font-bold text-rose-400 mt-0.5 block truncate">
                  ${topPick.plan.stopLoss}
                </span>
                <span className="text-[10px] text-rose-300 font-bold block font-sans">
                  %{topPick.plan.stopLossPercent} (Kesin Stop)
                </span>
              </div>

              <div className="rounded-xl border border-border/80 bg-background/60 p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground block font-semibold font-sans">⚖️ Risk / Kazanç (R:R)</span>
                <span className="text-xs sm:text-sm font-bold text-amber-300 mt-0.5 block">
                  {topPick.plan.riskRewardRatio}
                </span>
                <span className="text-[10px] text-muted-foreground font-semibold block font-sans">Cazip Oran</span>
              </div>

              <div className="rounded-xl border border-border/80 bg-background/60 p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground block font-semibold font-sans">⏳ Tavsiye Vade</span>
                <span className="text-xs sm:text-sm font-bold text-sky-400 mt-0.5 block font-sans">
                  {topPick.timeHorizon === "GÜN İÇİ (BUGÜN PATLAMA)" ? "Bugün İçi ⚡" : "1 - 7 Gün 📅"}
                </span>
                <span className="text-[10px] text-muted-foreground font-semibold block font-sans">
                  {topPick.timeHorizon === "GÜN İÇİ (BUGÜN PATLAMA)" ? "Hızlı Çıkış" : "Yarı Otomasyon"}
                </span>
              </div>
            </div>

            {/* Taktik Kılavuzu & Doğrudan Aksiyon Notu */}
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Sparkles className="size-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-foreground/90 leading-relaxed font-sans">
                  <strong className="text-amber-300 uppercase">⚡ SEN DİCEN BEN ALCAM PLANI: </strong>
                  {topPick.plan.tacticalNote}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSelectedSymbol(topPick.symbol)}
                  className="text-xs font-bold h-8"
                >
                  <Search className="size-3.5 mr-1" />
                  Derin Analizi Aç
                </Button>
                {onSelectInTerminal && (
                  <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-8 shadow-sm"
                    onClick={() => onSelectInTerminal(`crypto:${topPick.symbol.replace("USDT","").toLowerCase()}`)}
                  >
                    Grafiğe Git →
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* 3. İKİ TEMEL SEÇİM KANALI: GÜN İÇİ PATLAMA vs HAFTALIK YARI OTOMASYON */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Gün İçi Patlama Listesi (İlk 2) */}
            {data.dailyExplosions.slice(0, 2).map((item, idx) => (
              <Card
                key={item.symbol}
                onClick={() => setSelectedSymbol(item.symbol)}
                className={cn(
                  "cursor-pointer transition-all hover:scale-[1.02] border-amber-500/40 hover:border-amber-500/80 bg-card/90",
                  activeCoin?.symbol === item.symbol && "ring-2 ring-amber-400 border-amber-500 bg-amber-950/20"
                )}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30 flex items-center gap-1">
                      <Flame className="size-3 text-amber-400" />
                      GÜN İÇİ PATLAMA #{idx + 1}
                    </span>
                    <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 text-[10px] font-mono">
                      {item.signal}
                    </Badge>
                  </div>
                  <div className="flex items-baseline justify-between pt-1">
                    <CardTitle className="text-base font-black font-mono">
                      {item.displaySymbol}
                    </CardTitle>
                    <span className="font-mono text-sm font-bold text-foreground">${item.priceFormatted}</span>
                  </div>
                  <CardDescription className="text-xs truncate">{item.name} · {item.badge}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0 text-[11px] space-y-1">
                  <div className="flex justify-between text-muted-foreground font-mono">
                    <span>Bugün TP1:</span>
                    <b className="text-emerald-400 font-bold">${item.plan.target1} (+%{item.plan.target1Percent})</b>
                  </div>
                  <div className="flex justify-between text-muted-foreground font-mono">
                    <span>Kesin Stop:</span>
                    <b className="text-rose-400 font-bold">${item.plan.stopLoss} (%{item.plan.stopLossPercent})</b>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Haftalık Yarı Otomasyon Listesi (İlk 2) */}
            {data.weeklySwings.slice(0, 2).map((item, idx) => (
              <Card
                key={item.symbol}
                onClick={() => setSelectedSymbol(item.symbol)}
                className={cn(
                  "cursor-pointer transition-all hover:scale-[1.02] border-sky-500/40 hover:border-sky-500/80 bg-card/90",
                  activeCoin?.symbol === item.symbol && "ring-2 ring-sky-400 border-sky-500 bg-sky-950/20"
                )}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-sky-300 bg-sky-500/15 px-2 py-0.5 rounded border border-sky-500/30 flex items-center gap-1">
                      <Clock className="size-3 text-sky-400" />
                      HAFTALIK OTOMASYON #{idx + 1}
                    </span>
                    <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 text-[10px] font-mono">
                      {item.signal}
                    </Badge>
                  </div>
                  <div className="flex items-baseline justify-between pt-1">
                    <CardTitle className="text-base font-black font-mono">
                      {item.displaySymbol}
                    </CardTitle>
                    <span className="font-mono text-sm font-bold text-foreground">${item.priceFormatted}</span>
                  </div>
                  <CardDescription className="text-xs truncate">{item.name} · {item.badge}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0 text-[11px] space-y-1">
                  <div className="flex justify-between text-muted-foreground font-mono">
                    <span>Haftalık TP2:</span>
                    <b className="text-emerald-400 font-bold">${item.plan.target2} (+%{item.plan.target2Percent})</b>
                  </div>
                  <div className="flex justify-between text-muted-foreground font-mono">
                    <span>Stop Seviyesi:</span>
                    <b className="text-rose-400 font-bold">${item.plan.stopLoss} (%{item.plan.stopLossPercent})</b>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* 4. TÜM KRİPTO TARAMA LİSTESİ & FİLTRELER */}
          <Card className="border-border/70 bg-card/90">
            <CardHeader className="pb-3 border-b border-border/60">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Layers className="size-4 text-amber-400" />
                    Kripto Para Canlı Sinyalleri & Vade Seçimi ({filteredCoins.length} Coin)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Listeden coine tıklayarak doğrudan giriş-çıkış fiyatlarını, yapay zekâ stratejisini ve hesaplayıcıyı görebilirsiniz.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-44">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Coin ara (SOL, PEPE...)"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-8 text-xs font-mono"
                    />
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        { id: "EXPLOSIONS", label: "⚡ Gün İçi Patlama" },
                        { id: "WEEKLY", label: "📅 Haftalık Otomasyon" },
                        { id: "BUYS", label: "🟢 Tüm Alımlar" },
                        { id: "SELLS", label: "🔴 Sat / Dikkat" },
                        { id: "ALL", label: "Tümü" },
                      ] as const
                    ).map((t) => (
                      <Button
                        key={t.id}
                        size="sm"
                        variant={filterTab === t.id ? "default" : "ghost"}
                        onClick={() => setFilterTab(t.id)}
                        className={cn(
                          "h-8 text-xs px-2.5 font-semibold",
                          t.id === "EXPLOSIONS" && filterTab === "EXPLOSIONS" && "bg-amber-600 text-white hover:bg-amber-700"
                        )}
                      >
                        {t.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[340px] overflow-y-auto">
                <table className="w-full text-left text-xs font-sans">
                  <thead className="sticky top-0 bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground backdrop-blur-md border-b">
                    <tr>
                      <th className="py-2.5 px-3">Coin</th>
                      <th className="py-2.5 px-3">Fiyat</th>
                      <th className="py-2.5 px-3">24s Değişim</th>
                      <th className="py-2.5 px-3">Sinyal</th>
                      <th className="py-2.5 px-3 hidden sm:table-cell">Vade / Strateji</th>
                      <th className="py-2.5 px-3 hidden md:table-cell">RVOL (Hacim Katı)</th>
                      <th className="py-2.5 px-3 hidden lg:table-cell">TP1 Hedef</th>
                      <th className="py-2.5 px-3 hidden lg:table-cell">Stop-Loss</th>
                      <th className="py-2.5 px-3 text-right">Eylem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-mono">
                    {filteredCoins.map((coin) => {
                      const isSelected = activeCoin?.symbol === coin.symbol
                      const isBuy = coin.signal.includes("AL")
                      const isSell = coin.signal.includes("SAT")
                      const isExplosion = coin.timeHorizon === "GÜN İÇİ (BUGÜN PATLAMA)"

                      return (
                        <tr
                          key={coin.symbol}
                          onClick={() => setSelectedSymbol(coin.symbol)}
                          className={cn(
                            "cursor-pointer transition-colors hover:bg-muted/40",
                            isSelected && "bg-amber-500/10 font-bold"
                          )}
                        >
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <b className="text-foreground">{coin.displaySymbol}</b>
                              <span className="text-[11px] text-muted-foreground font-sans truncate max-w-[120px] hidden sm:inline">
                                {coin.name}
                              </span>
                              <Badge variant="secondary" className="text-[9px] py-0 px-1 hidden md:inline-flex">
                                {coin.badge}
                              </Badge>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-bold text-foreground">
                            ${coin.priceFormatted}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={cn(
                              "font-bold",
                              coin.change >= 0 ? "text-emerald-400" : "text-rose-400"
                            )}>
                              {coin.change >= 0 ? "+" : ""}{coin.change}%
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] font-bold px-1.5 py-0",
                                isBuy
                                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                                  : isSell
                                  ? "border-rose-500/50 bg-rose-500/10 text-rose-400"
                                  : "border-amber-500/50 bg-amber-500/10 text-amber-400"
                              )}
                            >
                              {coin.signal}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 hidden sm:table-cell">
                            <span className={cn(
                              "text-[10px] font-sans font-bold px-1.5 py-0.5 rounded",
                              isExplosion
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                : "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                            )}>
                              {isExplosion ? "⚡ Gün İçi Patlama" : "📅 Haftalık"}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 hidden md:table-cell text-muted-foreground">
                            {coin.technical.rvol}x
                          </td>
                          <td className="py-2.5 px-3 hidden lg:table-cell text-emerald-400 font-bold truncate">
                            ${coin.plan.target1} (+%{coin.plan.target1Percent})
                          </td>
                          <td className="py-2.5 px-3 hidden lg:table-cell text-rose-400 font-bold truncate">
                            ${coin.plan.stopLoss} (%{coin.plan.stopLossPercent})
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <Button
                              size="sm"
                              variant={isSelected ? "default" : "outline"}
                              className={cn(
                                "h-6 text-[10px] px-2 font-sans font-bold",
                                isSelected && "bg-amber-600 text-white hover:bg-amber-700"
                              )}
                            >
                              {isSelected ? "İnceleniyor" : "Planı Gör"}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* 5. 🔬 DERİNLEMESİNE COİN İŞLEM PLANI VE ANALİZ MODÜLÜ */}
          {activeCoin && (
            <div className="space-y-4 rounded-2xl border border-border/80 bg-gradient-to-b from-card to-background p-4 sm:p-6 shadow-lg">
              {/* Başlık & Fiyat Barı */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-amber-400 flex items-center gap-1 font-mono uppercase">
                      <Target className="size-3.5" /> SEÇİLİ COİN İŞLEM PLANI
                    </span>
                    <Badge variant="outline" className={cn(
                      "font-mono text-xs font-bold",
                      activeCoin.signal.includes("AL")
                        ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400"
                        : activeCoin.signal.includes("SAT")
                        ? "border-rose-500/60 bg-rose-500/15 text-rose-400"
                        : "border-amber-500/60 bg-amber-500/15 text-amber-400"
                    )}>
                      {activeCoin.signal}
                    </Badge>
                    <Badge variant="outline" className={cn(
                      "text-xs font-bold font-sans",
                      activeCoin.timeHorizon === "GÜN İÇİ (BUGÜN PATLAMA)"
                        ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                        : "border-sky-500/50 bg-sky-500/15 text-sky-300"
                    )}>
                      {activeCoin.horizonBadgeText}
                    </Badge>
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black text-foreground font-mono mt-1">
                    {activeCoin.displaySymbol} · {activeCoin.name}
                  </h3>
                  <p className="text-xs text-muted-foreground">{activeCoin.description}</p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right font-mono">
                    <span className="text-[10px] text-muted-foreground block font-bold">CANLI FİYAT</span>
                    <b className="text-xl font-black text-foreground">
                      ${activeCoin.priceFormatted}
                    </b>
                    <span className={cn(
                      "block text-xs font-bold",
                      activeCoin.change >= 0 ? "text-emerald-400" : "text-rose-400"
                    )}>
                      {activeCoin.change >= 0 ? "+" : ""}{activeCoin.change}%
                    </span>
                  </div>

                  {onSelectInTerminal && (
                    <Button
                      size="sm"
                      onClick={() => onSelectInTerminal(`crypto:${activeCoin.symbol.replace("USDT","").toLowerCase()}`)}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-9"
                    >
                      Grafiğe Git <ArrowRight className="size-3.5 ml-1" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Sekme Butonları */}
              <div className="flex flex-wrap gap-1.5 border-b border-border/60 pb-2">
                <Button
                  size="sm"
                  variant={activeTab === "signal" ? "default" : "ghost"}
                  onClick={() => setActiveTab("signal")}
                  className={cn("h-8 text-xs font-bold gap-1.5", activeTab === "signal" && "bg-amber-600 hover:bg-amber-700")}
                >
                  <Target className="size-3.5 text-amber-300" />
                  Alım / Satım Planı ("Sen Dicen Ben Alcam")
                </Button>
                <Button
                  size="sm"
                  variant={activeTab === "ai" ? "default" : "ghost"}
                  onClick={() => setActiveTab("ai")}
                  className="h-8 text-xs font-bold gap-1.5"
                >
                  <Sparkles className="size-3.5 text-amber-400" />
                  Yapay Zekâ Stratejist Raporu
                </Button>
                <Button
                  size="sm"
                  variant={activeTab === "technical" ? "default" : "ghost"}
                  onClick={() => setActiveTab("technical")}
                  className="h-8 text-xs font-bold gap-1.5"
                >
                  <BarChart3 className="size-3.5 text-emerald-400" />
                  Teknik Göstergeler (RSI, Trend, RVOL)
                </Button>
                <Button
                  size="sm"
                  variant={activeTab === "calculator" ? "default" : "ghost"}
                  onClick={() => setActiveTab("calculator")}
                  className="h-8 text-xs font-bold gap-1.5"
                >
                  <Calculator className="size-3.5 text-sky-400" />
                  USDT Kasa & Kâr Hesaplayıcı
                </Button>
              </div>

              {/* SEKME 1: 🎯 NET İŞLEM PLANI */}
              {activeTab === "signal" && (
                <div className="space-y-4 pt-1">
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
                    <span className="text-xs font-black text-amber-300 uppercase tracking-wide block">
                      ⚡ DOĞRUDAN EMRİNİZ & KURALINIZ:
                    </span>
                    <p className="text-xs sm:text-sm text-foreground/95 leading-relaxed font-semibold">
                      {activeCoin.plan.tacticalNote}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono">
                    <div className="rounded-xl border border-border/80 bg-background/60 p-3 text-center">
                      <span className="text-[10px] text-muted-foreground block font-bold font-sans uppercase">Giriş Aralığı</span>
                      <b className="text-sm sm:text-base font-black text-foreground mt-0.5 block truncate">
                        ${activeCoin.plan.entryMin} - ${activeCoin.plan.entryMax}
                      </b>
                      <span className="text-[10px] text-emerald-400 font-sans">Bu Fiyattan Emri Ver</span>
                    </div>

                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3 text-center">
                      <span className="text-[10px] text-emerald-400 block font-bold font-sans uppercase">1. Hedef (TP1)</span>
                      <b className="text-sm sm:text-base font-black text-emerald-400 mt-0.5 block truncate">
                        ${activeCoin.plan.target1}
                      </b>
                      <span className="text-[10px] text-emerald-300 font-sans">
                        +%{activeCoin.plan.target1Percent} Kâr
                      </span>
                    </div>

                    <div className="rounded-xl border border-emerald-500/60 bg-emerald-950/30 p-3 text-center">
                      <span className="text-[10px] text-emerald-300 block font-bold font-sans uppercase">2. Hedef (TP2)</span>
                      <b className="text-sm sm:text-base font-black text-emerald-300 mt-0.5 block truncate">
                        ${activeCoin.plan.target2}
                      </b>
                      <span className="text-[10px] text-emerald-300 font-sans">
                        +%{activeCoin.plan.target2Percent} Patlama Hedefi
                      </span>
                    </div>

                    <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-3 text-center">
                      <span className="text-[10px] text-rose-400 block font-bold font-sans uppercase">Stop-Loss (Zarar Durdur)</span>
                      <b className="text-sm sm:text-base font-black text-rose-400 mt-0.5 block truncate">
                        ${activeCoin.plan.stopLoss}
                      </b>
                      <span className="text-[10px] text-rose-300 font-sans">
                        %{activeCoin.plan.stopLossPercent} Kesin Kural
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3.5 space-y-1.5">
                      <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 uppercase">
                        <CheckCircle2 className="size-4" /> Alım Katalizörleri
                      </span>
                      <ul className="space-y-1 text-xs text-foreground/90">
                        {activeCoin.catalysts.map((c, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-emerald-400 font-bold">•</span>
                            <span>{c}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-xl border border-rose-500/30 bg-rose-950/15 p-3.5 space-y-1.5">
                      <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5 uppercase">
                        <AlertTriangle className="size-4" /> Dikkat Edilecek Riskler
                      </span>
                      <ul className="space-y-1 text-xs text-foreground/90">
                        {activeCoin.risks.map((r, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-rose-400 font-bold">•</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* SEKME 2: 🤖 YAPAY ZEKA RAPORU */}
              {activeTab === "ai" && (
                <div className="space-y-4 pt-1">
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-4 text-amber-300" />
                      <h4 className="text-xs sm:text-sm font-bold text-foreground uppercase tracking-wide">
                        Yapay Zekâ Baş Stratejist Yorumu
                      </h4>
                    </div>
                    <p className="text-xs sm:text-sm leading-relaxed text-foreground/90">
                      {activeCoin.aiAnalysis?.summary}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/80 bg-background/60 p-3.5">
                      <span className="text-[11px] font-bold text-emerald-400 uppercase block">🐂 Boğa Senaryosu (Hedef)</span>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {activeCoin.aiAnalysis?.bullCase}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border/80 bg-background/60 p-3.5">
                      <span className="text-[11px] font-bold text-rose-400 uppercase block">🐻 Ayı Senaryosu (Geri Çekilme)</span>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {activeCoin.aiAnalysis?.bearCase}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 flex items-start gap-2.5">
                    <Target className="size-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-xs font-black text-amber-300 uppercase tracking-wide block">
                        🎯 Net Aksiyon Tavsiyesi
                      </span>
                      <p className="text-xs text-foreground/90 mt-0.5 font-medium">
                        {activeCoin.aiAnalysis?.actionVerdict}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* SEKME 3: 📊 TEKNİK GÖSTERGELER */}
              {activeTab === "technical" && (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 font-mono">
                    <div className="rounded-xl border border-border/80 bg-background/60 p-3 text-center">
                      <span className="text-[10px] text-muted-foreground block font-bold font-sans uppercase">RSI (14)</span>
                      <b className={cn(
                        "text-lg font-black mt-0.5 block",
                        activeCoin.technical.rsi >= 70 ? "text-rose-400" : activeCoin.technical.rsi <= 35 ? "text-amber-400" : "text-emerald-400"
                      )}>
                        {activeCoin.technical.rsi}
                      </b>
                      <span className="text-[10px] text-muted-foreground font-sans">
                        {activeCoin.technical.rsi >= 70 ? "Aşırı Alım" : activeCoin.technical.rsi <= 35 ? "Aşırı Satım" : "Sağlıklı Bölge"}
                      </span>
                    </div>

                    <div className="rounded-xl border border-border/80 bg-background/60 p-3 text-center">
                      <span className="text-[10px] text-muted-foreground block font-bold font-sans uppercase">RVOL (Hacim Katı)</span>
                      <b className="text-lg font-black text-amber-400 mt-0.5 block">
                        {activeCoin.technical.rvol}x
                      </b>
                      <span className="text-[10px] text-muted-foreground font-sans">
                        {activeCoin.technical.rvol >= 1.5 ? "Balina Hacmi" : "Normal Hacim"}
                      </span>
                    </div>

                    <div className="rounded-xl border border-border/80 bg-background/60 p-3 text-center">
                      <span className="text-[10px] text-muted-foreground block font-bold font-sans uppercase">Trend Yönü</span>
                      <b className={cn(
                        "text-lg font-black mt-0.5 block font-sans",
                        activeCoin.technical.trend === "YUKARI" ? "text-emerald-400" : activeCoin.technical.trend === "AŞAĞI" ? "text-rose-400" : "text-amber-400"
                      )}>
                        {activeCoin.technical.trend}
                      </b>
                      <span className="text-[10px] text-muted-foreground font-sans">
                        EMA 20 & 50 Kesişimi
                      </span>
                    </div>

                    <div className="rounded-xl border border-border/80 bg-background/60 p-3 text-center">
                      <span className="text-[10px] text-muted-foreground block font-bold font-sans uppercase">MACD Durumu</span>
                      <b className={cn(
                        "text-lg font-black mt-0.5 block font-sans",
                        activeCoin.technical.macdStatus === "POZİTİF" ? "text-emerald-400" : "text-rose-400"
                      )}>
                        {activeCoin.technical.macdStatus}
                      </b>
                      <span className="text-[10px] text-muted-foreground font-sans">
                        Momentum İvmesi
                      </span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/80 bg-background/60 p-3.5 font-mono text-xs text-muted-foreground grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>Destek 1: <strong className="text-foreground">${activeCoin.technical.support1}</strong></div>
                    <div>Direnç 1: <strong className="text-foreground">${activeCoin.technical.resistance1}</strong></div>
                    <div>Destek 2: <strong className="text-foreground">${activeCoin.technical.support2}</strong></div>
                    <div>Direnç 2: <strong className="text-foreground">${activeCoin.technical.resistance2}</strong></div>
                  </div>
                </div>
              )}

              {/* SEKME 4: 🧮 USDT KASA & HESAPLAYICI */}
              {activeTab === "calculator" && (
                <div className="space-y-4 pt-1">
                  <div className="rounded-xl border border-border/80 bg-background/60 p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-bold text-foreground uppercase tracking-wide">
                          İşleme Ayrılacak Kasa (USDT)
                        </h4>
                        <p className="text-[11px] text-muted-foreground">
                          Bu pozisyona bağlamak istediğiniz USDT miktarını girin, kâr ve stop miktarınızı hesaplayalım.
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={calculatorCapitalUsdt}
                          onChange={(e) => setCalculatorCapitalUsdt(e.target.value)}
                          className="h-9 w-32 font-mono text-sm font-bold text-right"
                        />
                        <span className="text-xs font-bold font-mono text-muted-foreground">USDT</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 font-mono">
                    <div className="rounded-xl border border-border/80 bg-background/60 p-3 text-center">
                      <span className="text-[10px] text-muted-foreground block font-bold font-sans uppercase">Alınacak Adet</span>
                      <b className="text-sm sm:text-base font-black text-foreground mt-0.5 block truncate">
                        {quantity.toLocaleString("en-US", { maximumFractionDigits: activeCoin.decimals > 4 ? 4 : 2 })}
                      </b>
                      <span className="text-[10px] text-muted-foreground font-sans">
                        ${capitalNum} USDT Tutarı
                      </span>
                    </div>

                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3 text-center">
                      <span className="text-[10px] text-emerald-400 block font-bold font-sans uppercase">TP1 Kârı (+%{target1Percent})</span>
                      <b className="text-sm sm:text-base font-black text-emerald-400 mt-0.5 block truncate">
                        +${target1ProfitUsdt.toFixed(2)} USDT
                      </b>
                      <span className="text-[10px] text-emerald-300 font-sans">
                        Hedef: ${activeCoin.plan.target1}
                      </span>
                    </div>

                    <div className="rounded-xl border border-emerald-500/60 bg-emerald-950/30 p-3 text-center">
                      <span className="text-[10px] text-emerald-300 block font-bold font-sans uppercase">TP2 Kârı (+%{target2Percent})</span>
                      <b className="text-sm sm:text-base font-black text-emerald-300 mt-0.5 block truncate">
                        +${target2ProfitUsdt.toFixed(2)} USDT
                      </b>
                      <span className="text-[10px] text-emerald-300 font-sans">
                        Hedef: ${activeCoin.plan.target2}
                      </span>
                    </div>

                    <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-3 text-center">
                      <span className="text-[10px] text-rose-400 block font-bold font-sans uppercase">Stop Riski (-%{stopLossPercent})</span>
                      <b className="text-sm sm:text-base font-black text-rose-400 mt-0.5 block truncate">
                        -${stopLossAmountUsdt.toFixed(2)} USDT
                      </b>
                      <span className="text-[10px] text-rose-300 font-sans">
                        Stop: ${activeCoin.plan.stopLoss}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
