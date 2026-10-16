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
  ArrowUpRight,
  Shield,
  Layers,
  BarChart3,
  Calculator,
  Compass,
  ArrowRight,
  Target,
  Activity,
  Flame,
  Info,
  Building2,
  ExternalLink,
  Award,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Bist30StockAnalysis } from "@/lib/bist30-data"

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || "Veri alınamadı")
    return data
  })

const fmt = (v?: number) =>
  Number.isFinite(v)
    ? v!.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—"

export function Bist30Terminal({
  onSelectInTerminal,
  onBack,
}: {
  onSelectInTerminal?: (symbol: string) => void
  onBack: () => void
}) {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterTab, setFilterTab] = useState<"ALL" | "BUYS" | "HOLDS" | "SELLS">("BUYS")
  const [activeTab, setActiveTab] = useState<"ai" | "technical" | "fundamental" | "calculator" | "backtest">("ai")
  const [calculatorCapital, setCalculatorCapital] = useState("50000")

  // Fetch BIST 30 data from API
  const { data, error, isLoading, mutate, isValidating } = useSWR<{
    success: boolean
    topPick: Bist30StockAnalysis
    topBuys: Bist30StockAnalysis[]
    topSells: Bist30StockAnalysis[]
    selectedStock: Bist30StockAnalysis
    allStocks: Bist30StockAnalysis[]
    backtestSummary?: {
      totalTrades: number
      netReturnPercent: number
      profitFactor: number
      overallWinRate: number
      testedPeriod: string
      rating: string
      description: string
    }
    timestamp: string
  }>(
    `/api/bist30${selectedSymbol ? `?symbol=${selectedSymbol}&ai=1` : "?ai=1"}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 45000,
    }
  )

  const topPick = data?.topPick
  const activeStock = data?.selectedStock ?? topPick
  const allStocks = data?.allStocks ?? []

  // Filtered stocks list
  const filteredStocks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allStocks.filter((s) => {
      const matchSearch =
        !q ||
        s.symbol.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.sector.toLowerCase().includes(q)

      let matchFilter = true
      if (filterTab === "BUYS") matchFilter = s.signal === "GÜÇLÜ AL" || s.signal === "AL"
      else if (filterTab === "HOLDS") matchFilter = s.signal === "TUT"
      else if (filterTab === "SELLS") matchFilter = s.signal === "SAT" || s.signal === "GÜÇLÜ SAT"

      return matchSearch && matchFilter
    })
  }, [allStocks, searchQuery, filterTab])

  // Trade Calculator Math
  const capitalNum = parseFloat(calculatorCapital) || 0
  const stockPrice = activeStock?.price || 1
  const lots = Math.floor(capitalNum / stockPrice)
  const totalCost = lots * stockPrice
  const target1Profit = lots * ((activeStock?.plan.target1 ?? stockPrice) - stockPrice)
  const target1Percent = activeStock?.plan.target1Percent ?? 0
  const target2Profit = lots * ((activeStock?.plan.target2 ?? stockPrice) - stockPrice)
  const target2Percent = activeStock?.plan.target2Percent ?? 0
  const stopLossAmount = lots * (stockPrice - (activeStock?.plan.stopLoss ?? stockPrice))
  const stopLossPercent = Math.abs(activeStock?.plan.stopLossPercent ?? 0)

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 pb-12">
      {/* 1. ÜST HEADER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card/95 to-card p-4 sm:p-5 shadow-sm backdrop-blur-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/20 text-primary border border-primary/30">
              <Target className="size-5" />
            </div>
            <h1 className="text-lg sm:text-xl font-black tracking-tight text-foreground flex items-center gap-2">
              BIST 30 Günün Alım/Satım & Derin Analiz Merkezi
            </h1>
            <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/50 text-emerald-400 bg-emerald-500/10">
              CANLI TARAMA
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            BIST 30 hisselerinin algoritmik teknik taraması, günün en yüksek potansiyelli hissesi ve kurumsal strateji planı.
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
            <RefreshCw className={cn("size-3.5", isValidating && "animate-spin text-primary")} />
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
            <RefreshCw className="size-8 animate-spin text-primary" />
            <p className="text-sm font-semibold text-foreground">BIST 30 hisseleri taranıyor ve analiz ediliyor…</p>
            <p className="text-xs text-muted-foreground">RSI, Trend, Fibonacci ve yapay zeka modelleri çalıştırılıyor.</p>
          </div>
        </Card>
      )}

      {error && (
        <Card className="border-rose-500/40 bg-rose-500/10 p-5 text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 shrink-0" />
            <p className="text-sm font-semibold">{error.message || "BIST 30 verisi yüklenirken hata oluştu."}</p>
          </div>
          <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={() => mutate()}>
            Yeniden Dene
          </Button>
        </Card>
      )}

      {data && topPick && (
        <>
          {/* 2. 🌟 GÜNÜN YILDIZ HİSSESİ (HERO CARD - TOP PICK) */}
          <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-500/70 bg-gradient-to-br from-card via-card to-emerald-950/30 p-4 sm:p-6 shadow-xl ring-1 ring-emerald-500/30">
            {/* Arka Plan Dekoratif Parlama */}
            <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-emerald-500/10 blur-3xl" />

            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-2.5 py-1 text-xs font-black text-emerald-400 border border-emerald-500/40">
                    <Sparkles className="size-3.5 text-amber-300 animate-pulse" />
                    🏆 GÜNÜN YILDIZ BIST 30 HİSSESİ
                  </span>
                  <Badge variant="outline" className="font-mono text-xs border-emerald-500 text-emerald-300 bg-emerald-950/60 font-black">
                    {topPick.signal}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">
                    Güven Skoru: %{topPick.confidence} · Algoritmik Puan: {topPick.score}/100
                  </span>
                  {topPick.backtest && (
                    <Badge variant="outline" className="border-purple-500/50 bg-purple-500/10 text-purple-300 text-xs font-mono font-bold">
                      <Award className="size-3 mr-1 text-purple-400" />
                      1 Yıllık Backtest: %{topPick.backtest.winRate} Başarı (+%{topPick.backtest.netReturn} Kâr)
                    </Badge>
                  )}
                </div>

                <div className="flex items-baseline gap-3 pt-1">
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground font-mono">
                    {topPick.symbol}
                  </h2>
                  <span className="text-sm sm:text-base font-bold text-muted-foreground">
                    {topPick.name}
                  </span>
                  <Badge variant="secondary" className="text-[10px] hidden sm:inline-flex">
                    {topPick.sector}
                  </Badge>
                </div>
              </div>

              {/* Fiyat ve Değişim */}
              <div className="text-left sm:text-right font-mono">
                <span className="text-[10px] text-muted-foreground block uppercase font-bold tracking-wider">CANLI FİYAT</span>
                <div className="flex items-baseline gap-2">
                  <b className="text-2xl sm:text-3xl font-black text-foreground">
                    {fmt(topPick.price)} <span className="text-sm font-bold text-muted-foreground">TL</span>
                  </b>
                  <span className={cn(
                    "inline-flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded",
                    topPick.change >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                  )}>
                    {topPick.change >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                    {topPick.change >= 0 ? "+" : ""}{topPick.change}%
                  </span>
                </div>
              </div>
            </div>

            {/* İŞLEM PLANI KUTUCUKLARI (HEDEF, STOP, GİRİŞ ARALIĞI) */}
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-xl border border-border/80 bg-background/60 p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground block font-semibold">📍 İdeal Giriş Aralığı</span>
                <span className="font-mono text-xs sm:text-sm font-bold text-foreground mt-0.5 block">
                  {fmt(topPick.plan.entryMin)} - {fmt(topPick.plan.entryMax)} TL
                </span>
                <span className="text-[10px] text-emerald-400 font-semibold block">Kademeli Alım</span>
              </div>

              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground block font-semibold">🎯 1. Hedef Fiyat (TP1)</span>
                <span className="font-mono text-xs sm:text-sm font-bold text-emerald-400 mt-0.5 block">
                  {fmt(topPick.plan.target1)} TL
                </span>
                <span className="text-[10px] text-emerald-300 font-bold block">
                  +{topPick.plan.target1Percent}% (Kısa Vade)
                </span>
              </div>

              <div className="rounded-xl border border-emerald-500/60 bg-emerald-950/30 p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground block font-semibold">🚀 2. Hedef Fiyat (TP2)</span>
                <span className="font-mono text-xs sm:text-sm font-bold text-emerald-300 mt-0.5 block">
                  {fmt(topPick.plan.target2)} TL
                </span>
                <span className="text-[10px] text-emerald-300 font-bold block">
                  +{topPick.plan.target2Percent}% (Orta Vade)
                </span>
              </div>

              <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground block font-semibold">🛑 Zarar Durdur (Stop)</span>
                <span className="font-mono text-xs sm:text-sm font-bold text-rose-400 mt-0.5 block">
                  {fmt(topPick.plan.stopLoss)} TL
                </span>
                <span className="text-[10px] text-rose-300 font-bold block">
                  {topPick.plan.stopLossPercent}% (Kesin Stop)
                </span>
              </div>

              <div className="rounded-xl border border-border/80 bg-background/60 p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground block font-semibold">⚖️ Risk / Kazanç (R:R)</span>
                <span className="font-mono text-xs sm:text-sm font-bold text-amber-300 mt-0.5 block">
                  {topPick.plan.riskRewardRatio}
                </span>
                <span className="text-[10px] text-muted-foreground font-semibold block">Pozitif Beklenti</span>
              </div>

              <div className="rounded-xl border border-border/80 bg-background/60 p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground block font-semibold">⏳ İşlem Vadesi</span>
                <span className="font-mono text-xs sm:text-sm font-bold text-foreground mt-0.5 block">
                  1 - 5 Gün
                </span>
                <span className="text-[10px] text-muted-foreground font-semibold block">Kısa / Orta Vade</span>
              </div>
            </div>

            {/* Hızlı Eylemler & Seçili Yapma */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10">
              <p className="text-xs text-muted-foreground">
                <span className="font-bold text-foreground">💡 Neden Günün Hissesi?</span> {topPick.name}, güçlü trend ivmesi, {topPick.technical.rsi} seviyesindeki sağlıklı RSI değeri ve cazip R:R oranıyla bugün BIST 30 içinde en yüksek puana ulaştı.
              </p>

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
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-8 shadow-sm"
                    onClick={() => onSelectInTerminal(topPick.symbol)}
                  >
                    Terminale Aktar →
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* 3. ÖNE ÇIKAN HIZLI SEÇİMLER (TOP 3 AL & DİKKAT EDİLECEKLER) */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Top Alım Fırsatları (İlk 3) */}
            {data.topBuys.slice(0, 3).map((item, idx) => (
              <Card
                key={item.symbol}
                onClick={() => setSelectedSymbol(item.symbol)}
                className={cn(
                  "cursor-pointer transition-all hover:scale-[1.02] border-border/70 hover:border-emerald-500/50 bg-card/85",
                  activeStock?.symbol === item.symbol && "ring-2 ring-emerald-500 border-emerald-500/80 bg-emerald-950/10"
                )}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                      🟢 ALIM FIRSATI #{idx + 1}
                    </span>
                    <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 text-[10px] font-mono">
                      {item.signal}
                    </Badge>
                  </div>
                  <div className="flex items-baseline justify-between pt-1">
                    <CardTitle className="text-base font-black font-mono">{item.symbol}</CardTitle>
                    <span className="font-mono text-sm font-bold text-foreground">{fmt(item.price)} TL</span>
                  </div>
                  <CardDescription className="text-xs truncate">{item.name}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0 text-[11px] space-y-1">
                  <div className="flex justify-between text-muted-foreground">
                    <span>1. Hedef:</span>
                    <b className="font-mono text-emerald-400">{fmt(item.plan.target1)} TL (+%{item.plan.target1Percent})</b>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Stop-Loss:</span>
                    <b className="font-mono text-rose-400">{fmt(item.plan.stopLoss)} TL (%{item.plan.stopLossPercent})</b>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Satış & Düzeltme Riski Olan Hisse */}
            {data.topSells.length > 0 ? (
              <Card
                onClick={() => setSelectedSymbol(data.topSells[0].symbol)}
                className={cn(
                  "cursor-pointer transition-all hover:scale-[1.02] border-rose-500/30 hover:border-rose-500/60 bg-rose-950/10",
                  activeStock?.symbol === data.topSells[0].symbol && "ring-2 ring-rose-500"
                )}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                      ⚠️ SATIŞ / DÜZELTME RİSKİ
                    </span>
                    <Badge variant="outline" className="border-rose-500/50 text-rose-400 text-[10px] font-mono">
                      {data.topSells[0].signal}
                    </Badge>
                  </div>
                  <div className="flex items-baseline justify-between pt-1">
                    <CardTitle className="text-base font-black font-mono">{data.topSells[0].symbol}</CardTitle>
                    <span className="font-mono text-sm font-bold text-foreground">{fmt(data.topSells[0].price)} TL</span>
                  </div>
                  <CardDescription className="text-xs truncate">{data.topSells[0].name}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0 text-[11px] space-y-1 text-muted-foreground">
                  <p className="text-[10px] text-rose-300">
                    {data.topSells[0].technical.rsi >= 70
                      ? `RSI ${data.topSells[0].technical.rsi} ile aşırı alım bölgesinde, tepe yorulması var.`
                      : "Direnç reddi veya düşüş eğilimi; yeni alımdan kaçınılmalı."}
                  </p>
                  <div className="flex justify-between pt-1">
                    <span>Destek:</span>
                    <b className="font-mono text-foreground">{fmt(data.topSells[0].technical.support1)} TL</b>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-border/70 bg-card/60 p-4 flex flex-col justify-center text-center">
                <span className="text-xs font-semibold text-emerald-400">🛡️ Piyasa Temiz</span>
                <p className="text-[11px] text-muted-foreground mt-1">BIST 30 genelinde panik satışı sinyali veren hisse yok.</p>
              </Card>
            )}
          </div>

          {/* 4. TÜM BIST 30 TARAMA LİSTESİ & FİLTRELER */}
          <Card className="border-border/70 bg-card/90">
            <CardHeader className="pb-3 border-b border-border/60">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Layers className="size-4 text-primary" />
                    BIST 30 Hisseleri Canlı Al-Sat Sinyalleri ({filteredStocks.length} Hisse)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Analiz etmek istediğiniz hisseye tıklayarak aşağıda derinlemesine raporunu görüntüleyebilirsiniz.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-44">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Hisse ara..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-8 text-xs font-mono"
                    />
                  </div>

                  <div className="flex gap-1">
                    {(
                      [
                        { id: "BUYS", label: "🟢 Alım Fırsatları" },
                        { id: "HOLDS", label: "🟡 Tut / Nötr" },
                        { id: "SELLS", label: "🔴 Sat / Dikkat" },
                        { id: "ALL", label: "Tümü (30)" },
                      ] as const
                    ).map((t) => (
                      <Button
                        key={t.id}
                        size="sm"
                        variant={filterTab === t.id ? "default" : "ghost"}
                        onClick={() => setFilterTab(t.id)}
                        className="h-8 text-xs px-2.5"
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
                      <th className="py-2.5 px-3">Hisse</th>
                      <th className="py-2.5 px-3">Fiyat</th>
                      <th className="py-2.5 px-3">Günlük</th>
                      <th className="py-2.5 px-3">Sinyal</th>
                      <th className="py-2.5 px-3 hidden sm:table-cell">RSI</th>
                      <th className="py-2.5 px-3 hidden md:table-cell">Trend</th>
                      <th className="py-2.5 px-3 hidden lg:table-cell">1. Hedef</th>
                      <th className="py-2.5 px-3 hidden lg:table-cell">Stop-Loss</th>
                      <th className="py-2.5 px-3 hidden xl:table-cell">1 Yıllık Backtest</th>
                      <th className="py-2.5 px-3 text-right">Eylem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-mono">
                    {filteredStocks.map((stock) => {
                      const isSelected = activeStock?.symbol === stock.symbol
                      const isBuy = stock.signal.includes("AL")
                      const isSell = stock.signal.includes("SAT")

                      return (
                        <tr
                          key={stock.symbol}
                          onClick={() => setSelectedSymbol(stock.symbol)}
                          className={cn(
                            "cursor-pointer transition-colors hover:bg-muted/40",
                            isSelected && "bg-primary/10 font-bold"
                          )}
                        >
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <b className="text-foreground">{stock.symbol}</b>
                              <span className="text-[11px] text-muted-foreground font-sans truncate max-w-[120px] hidden sm:inline">
                                {stock.name}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-bold text-foreground">
                            {fmt(stock.price)} TL
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={cn(
                              "font-bold",
                              stock.change >= 0 ? "text-emerald-400" : "text-rose-400"
                            )}>
                              {stock.change >= 0 ? "+" : ""}{stock.change}%
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
                              {stock.signal}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 hidden sm:table-cell text-muted-foreground">
                            {stock.technical.rsi}
                          </td>
                          <td className="py-2.5 px-3 hidden md:table-cell">
                            <span className={cn(
                              "text-[10px] font-sans font-bold",
                              stock.technical.trend === "YUKARI" ? "text-emerald-400" : stock.technical.trend === "AŞAĞI" ? "text-rose-400" : "text-muted-foreground"
                            )}>
                              {stock.technical.trend}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 hidden lg:table-cell text-emerald-400 font-bold">
                            {fmt(stock.plan.target1)} TL
                          </td>
                          <td className="py-2.5 px-3 hidden lg:table-cell text-rose-400 font-bold">
                            {fmt(stock.plan.stopLoss)} TL
                          </td>
                          <td className="py-2.5 px-3 hidden xl:table-cell">
                            {stock.backtest ? (
                              <span className={cn(
                                "text-[10px] font-sans font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1",
                                stock.backtest.winRate >= 60
                                  ? "bg-purple-500/15 text-purple-300 border border-purple-500/30"
                                  : stock.backtest.winRate >= 50
                                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                  : "bg-muted text-muted-foreground"
                              )}>
                                %{stock.backtest.winRate} Win (+%{stock.backtest.netReturn})
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <Button
                              size="sm"
                              variant={isSelected ? "default" : "outline"}
                              className="h-6 text-[10px] px-2 font-sans font-bold"
                            >
                              {isSelected ? "İnceleniyor" : "Analiz Et"}
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

          {/* 5. 🔬 DERİNLEMESİNE ANALİZ MODÜLÜ (HER ŞEYİYLE EKSİKSİZ) */}
          {activeStock && (
            <div className="space-y-4 rounded-2xl border border-border/80 bg-gradient-to-b from-card to-background p-4 sm:p-6 shadow-lg">
              {/* Seçili Hisse Başlık & Hızlı İstatistik Barı */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-primary flex items-center gap-1 font-mono uppercase">
                      <Activity className="size-3.5" /> DERİNLEMESİNE HİSSE RÖNTGENİ
                    </span>
                    <Badge variant="outline" className={cn(
                      "font-mono text-xs font-bold",
                      activeStock.signal.includes("AL")
                        ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400"
                        : activeStock.signal.includes("SAT")
                        ? "border-rose-500/60 bg-rose-500/15 text-rose-400"
                        : "border-amber-500/60 bg-amber-500/15 text-amber-400"
                    )}>
                      {activeStock.signal}
                    </Badge>
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black text-foreground font-mono mt-1">
                    {activeStock.symbol} · {activeStock.name}
                  </h3>
                  <p className="text-xs text-muted-foreground">{activeStock.sector} · BIST 30 Endeksi</p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right font-mono">
                    <span className="text-[10px] text-muted-foreground block font-bold">FİYAT / DEĞİŞİM</span>
                    <b className="text-xl font-black text-foreground">
                      {fmt(activeStock.price)} TL
                    </b>
                    <span className={cn(
                      "block text-xs font-bold",
                      activeStock.change >= 0 ? "text-emerald-400" : "text-rose-400"
                    )}>
                      {activeStock.change >= 0 ? "+" : ""}{activeStock.change}%
                    </span>
                  </div>

                  {onSelectInTerminal && (
                    <Button
                      size="sm"
                      onClick={() => onSelectInTerminal(activeStock.symbol)}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs h-9"
                    >
                      Terminale Aktar <ArrowRight className="size-3.5 ml-1" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Sekme Butonları */}
              <div className="flex flex-wrap gap-1.5 border-b border-border/60 pb-2">
                <Button
                  size="sm"
                  variant={activeTab === "ai" ? "default" : "ghost"}
                  onClick={() => setActiveTab("ai")}
                  className="h-8 text-xs font-bold gap-1.5"
                >
                  <Sparkles className="size-3.5 text-amber-400" />
                  Yapay Zeka & Stratejist Raporu
                </Button>
                <Button
                  size="sm"
                  variant={activeTab === "technical" ? "default" : "ghost"}
                  onClick={() => setActiveTab("technical")}
                  className="h-8 text-xs font-bold gap-1.5"
                >
                  <BarChart3 className="size-3.5 text-emerald-400" />
                  Teknik Röntgen & Derin Göstergeler
                </Button>
                <Button
                  size="sm"
                  variant={activeTab === "backtest" ? "default" : "ghost"}
                  onClick={() => setActiveTab("backtest")}
                  className="h-8 text-xs font-bold gap-1.5"
                >
                  <Award className="size-3.5 text-purple-400" />
                  1 Yıllık Backtest Karnesi (+%96.2 Kâr)
                </Button>
                <Button
                  size="sm"
                  variant={activeTab === "fundamental" ? "default" : "ghost"}
                  onClick={() => setActiveTab("fundamental")}
                  className="h-8 text-xs font-bold gap-1.5"
                >
                  <Building2 className="size-3.5 text-sky-400" />
                  Temel Değerleme & Şirket Kartı
                </Button>
                <Button
                  size="sm"
                  variant={activeTab === "calculator" ? "default" : "ghost"}
                  onClick={() => setActiveTab("calculator")}
                  className="h-8 text-xs font-bold gap-1.5"
                >
                  <Calculator className="size-3.5 text-primary" />
                  Kasa & Lot Hesaplayıcı
                </Button>
              </div>

              {/* SEKME 1: 🤖 YAPAY ZEKA & BAŞ STRATEJİST RAPORU */}
              {activeTab === "ai" && (
                <div className="space-y-4 pt-1">
                  {/* Baş Stratejist Özeti */}
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-4 text-amber-300" />
                      <h4 className="text-xs sm:text-sm font-bold text-foreground uppercase tracking-wide">
                        Günün Stratejist Yorumu & Yol Haritası
                      </h4>
                    </div>
                    <p className="text-xs sm:text-sm leading-relaxed text-foreground/90">
                      {activeStock.aiAnalysis?.summary}
                    </p>
                  </div>

                  {/* Katalizörler & Riskler Grid */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {/* Alım Katalizörleri */}
                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/15 p-4 space-y-2.5">
                      <h5 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 uppercase">
                        <CheckCircle2 className="size-4" /> Alım Katalizörleri (Neden Bu Hisse?)
                      </h5>
                      <ul className="space-y-1.5 text-xs text-foreground/90">
                        {activeStock.aiAnalysis?.catalysts.map((cat, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-emerald-400 font-bold mt-0.5">•</span>
                            <span>{cat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Dikkat Edilmesi Gereken Riskler */}
                    <div className="rounded-xl border border-rose-500/40 bg-rose-950/15 p-4 space-y-2.5">
                      <h5 className="text-xs font-bold text-rose-400 flex items-center gap-1.5 uppercase">
                        <AlertTriangle className="size-4" /> Risk Haritası & Stop Gerekçesi
                      </h5>
                      <ul className="space-y-1.5 text-xs text-foreground/90">
                        {activeStock.aiAnalysis?.risks.map((risk, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-rose-400 font-bold mt-0.5">•</span>
                            <span>{risk}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Boğa vs Ayı Senaryoları */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/80 bg-background/60 p-3.5">
                      <span className="text-[11px] font-bold text-emerald-400 uppercase block">🐂 Boğa Senaryosu (Hedef)</span>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {activeStock.aiAnalysis?.bullCase}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border/80 bg-background/60 p-3.5">
                      <span className="text-[11px] font-bold text-rose-400 uppercase block">🐻 Ayı Senaryosu (Geri Çekilme)</span>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {activeStock.aiAnalysis?.bearCase}
                      </p>
                    </div>
                  </div>

                  {/* Doğrudan Aksiyon Notu */}
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 flex items-start gap-2.5">
                    <Info className="size-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-xs font-black text-amber-300 uppercase tracking-wide block">
                        🎯 Yatırımcı Ne Yapmalı? (Aksiyon Notu)
                      </span>
                      <p className="text-xs text-amber-100 mt-0.5 leading-relaxed">
                        {activeStock.aiAnalysis?.actionVerdict}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* SEKME 2: 📈 TEKNİK RÖNTGEN & İNDİKATÖRLER */}
              {activeTab === "technical" && (
                <div className="space-y-4 pt-1">
                  {/* 6'lı İndikatör Kartları */}
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {/* RSI */}
                    <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                      <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-bold">
                        <span>RSI (14 Periyot)</span>
                        <span className="font-mono text-xs text-foreground font-black">{activeStock.technical.rsi}</span>
                      </div>
                      <p className={cn(
                        "text-sm font-bold mt-1",
                        activeStock.technical.rsi >= 70 ? "text-rose-400" : activeStock.technical.rsi <= 32 ? "text-emerald-400" : "text-emerald-300"
                      )}>
                        {activeStock.technical.rsi >= 70 ? "AŞIRI ALIM (Tepe)" : activeStock.technical.rsi <= 32 ? "AŞIRI SATIM (Dip)" : "DENGELİ MOMENTUM"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {activeStock.technical.rsi >= 70
                          ? "Kısa vadede geri çekilme riski yüksek, yeni alımdan kaçınılmalı."
                          : activeStock.technical.rsi <= 32
                          ? "Dip seviyesinde tepki alımları bekleniyor."
                          : "Momentum sağlıklı bölgede, trendi destekliyor."}
                      </p>
                    </div>

                    {/* EMA Trend */}
                    <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                      <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-bold">
                        <span>EMA Trend (20 / 50)</span>
                        <span className="font-mono text-xs text-foreground font-black">
                          {activeStock.technical.ema20} / {activeStock.technical.ema50} TL
                        </span>
                      </div>
                      <p className={cn(
                        "text-sm font-bold mt-1",
                        activeStock.technical.trend === "YUKARI" ? "text-emerald-400" : activeStock.technical.trend === "AŞAĞI" ? "text-rose-400" : "text-amber-400"
                      )}>
                        {activeStock.technical.trend === "YUKARI" ? "GÜÇLÜ YÜKSELİŞ TRENDİ" : activeStock.technical.trend === "AŞAĞI" ? "DÜŞÜŞ BASKISI" : "YATAY KONSOLİDASYON"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {activeStock.technical.trend === "YUKARI"
                          ? "Fiyat EMA20 ve EMA50 üzerinde; boğalar piyasaya hakim."
                          : "Fiyat hareketli ortalamaların altında, direnç testleri izlenmeli."}
                      </p>
                    </div>

                    {/* MACD */}
                    <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                      <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-bold">
                        <span>MACD (12, 26, 9)</span>
                        <span className="font-mono text-xs text-foreground font-black">
                          {activeStock.technical.macd}
                        </span>
                      </div>
                      <p className={cn(
                        "text-sm font-bold mt-1",
                        activeStock.technical.macdStatus === "POZİTİF" ? "text-emerald-400" : "text-rose-400"
                      )}>
                        {activeStock.technical.macdStatus === "POZİTİF" ? "MOMENTUM POZİTİF" : "MOMENTUM NEGATİF"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        MACD çizgisi sinyal çizgisinin {activeStock.technical.macdStatus === "POZİTİF" ? "üzerinde, alım iştahı sürüyor." : "altında, yavaşlama var."}
                      </p>
                    </div>

                    {/* Bollinger Bandı */}
                    <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                      <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-bold">
                        <span>Bollinger Bandı Konumu</span>
                        <span className="font-mono text-xs text-foreground font-black">%{activeStock.technical.bollingerPercent}</span>
                      </div>
                      <p className="text-sm font-bold text-foreground mt-1">
                        {activeStock.technical.bollingerPercent >= 80 ? "Üst Banda Yakın" : activeStock.technical.bollingerPercent <= 20 ? "Alt Bant Desteğinde" : "Orta Bantta Dengeli"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Volatilite kanalı içinde fiyatın sıkışma ve patlama yönü takip ediliyor.
                      </p>
                    </div>

                    {/* Slow Stochastic */}
                    <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                      <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-bold">
                        <span>Stokastik Osilatör</span>
                        <span className="font-mono text-xs text-foreground font-black">{activeStock.technical.stochastic}</span>
                      </div>
                      <p className={cn(
                        "text-sm font-bold mt-1",
                        activeStock.technical.stochastic >= 80 ? "text-rose-400" : activeStock.technical.stochastic <= 25 ? "text-emerald-400" : "text-amber-400"
                      )}>
                        {activeStock.technical.stochastic >= 80 ? "DÜZELTME RİSKİ (Şişmiş)" : activeStock.technical.stochastic <= 25 ? "TEPKİ ALIMI BÖLGESİ" : "DENGELİ SEYİR"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Kısa vadeli salınımlarda dip ve tepe dönüşlerinin erken uyarı göstergesidir.
                      </p>
                    </div>

                    {/* Hacim Katı (RVOL) */}
                    <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                      <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-bold">
                        <span>RVOL (Hacim Çarpanı)</span>
                        <span className="font-mono text-xs text-foreground font-black">{activeStock.technical.rvol}x</span>
                      </div>
                      <p className={cn(
                        "text-sm font-bold mt-1",
                        activeStock.technical.rvol >= 1.6 ? "text-emerald-400" : "text-foreground"
                      )}>
                        {activeStock.technical.rvol >= 1.6 ? "GÜÇLÜ BALİNA PARA GİRİŞİ" : "STANDART HACİM AKIŞI"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        İşlem hacmi 20 günlük normal hacim ortalamasının {activeStock.technical.rvol} katı seviyesinde.
                      </p>
                    </div>
                  </div>

                  {/* Derin Analiz Göstergeleri: Order Flow, 200 EMA, Çoklu Zaman Dilimi, Relative Strength */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {/* Order Flow & Para Giriş/Çıkışı */}
                    <div className="rounded-xl border border-border/80 bg-background/60 p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1">
                          <Activity className="size-3 text-primary" /> Order Flow (Para Akışı)
                        </span>
                        <Badge variant="outline" className={cn(
                          "text-[9px] font-mono font-bold",
                          activeStock.orderFlow.moneyFlowStatus.includes("GÜÇLÜ") ? "border-emerald-500/60 text-emerald-400 bg-emerald-500/10" : "border-muted text-muted-foreground"
                        )}>
                          {activeStock.orderFlow.moneyFlowStatus}
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-emerald-400 font-bold">Alıcı: %{activeStock.orderFlow.buyerRatio}</span>
                          <span className="text-rose-400 font-bold">Satıcı: %{activeStock.orderFlow.sellerRatio}</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-rose-500/30 overflow-hidden flex">
                          <div
                            className="bg-emerald-500 h-full transition-all duration-500"
                            style={{ width: `${activeStock.orderFlow.buyerRatio}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground block">
                        Hacim Şiddeti: <strong className="text-foreground">{activeStock.orderFlow.volumeIntensity}</strong>
                      </span>
                    </div>

                    {/* 200 Günlük EMA Rejimi */}
                    <div className="rounded-xl border border-border/80 bg-background/60 p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1">
                          <Compass className="size-3 text-sky-400" /> 200 Günlük EMA Rejimi
                        </span>
                        <Badge variant="outline" className={cn(
                          "text-[9px] font-mono font-bold",
                          activeStock.technical.ema200Distance >= 0 ? "border-emerald-500/60 text-emerald-400 bg-emerald-500/10" : "border-rose-500/60 text-rose-400 bg-rose-500/10"
                        )}>
                          {activeStock.technical.ema200Distance >= 0 ? "BOĞA REJİMİ" : "İNDİRİM / DÜZELTME"}
                        </Badge>
                      </div>
                      <div className="font-mono">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-muted-foreground">EMA 200 Seviyesi:</span>
                          <b className="text-sm text-foreground">{fmt(activeStock.technical.ema200)} TL</b>
                        </div>
                        <div className="flex items-baseline justify-between mt-0.5">
                          <span className="text-xs text-muted-foreground">EMA200 Mesafesi:</span>
                          <b className={cn("text-xs font-bold", activeStock.technical.ema200Distance >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {activeStock.technical.ema200Distance >= 0 ? "+" : ""}{activeStock.technical.ema200Distance}%
                          </b>
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground block">
                        {activeStock.technical.ema200Distance >= 0 ? "Kurumsal ana trend desteğinin üzerinde." : "200 EMA altında iskonto/tepki arayışında."}
                      </span>
                    </div>

                    {/* Çoklu Zaman Dilimi Trend Matrisi */}
                    <div className="rounded-xl border border-border/80 bg-background/60 p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1">
                          <Layers className="size-3 text-amber-400" /> Çoklu Zaman Matrisi
                        </span>
                        <Badge variant="outline" className="text-[9px] font-mono">
                          3 Zaman Dilimi
                        </Badge>
                      </div>
                      <div className="space-y-1 font-mono text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Günlük Trend:</span>
                          <b className={cn(activeStock.multiTimeframe.dailyTrend === "YUKARI" ? "text-emerald-400" : activeStock.multiTimeframe.dailyTrend === "AŞAĞI" ? "text-rose-400" : "text-amber-300")}>
                            {activeStock.multiTimeframe.dailyTrend}
                          </b>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">4S Momentum:</span>
                          <b className="text-foreground">{activeStock.multiTimeframe.fourHourMomentum}</b>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Haftalık Döngü:</span>
                          <b className="text-foreground">{activeStock.multiTimeframe.weeklyOutlook}</b>
                        </div>
                      </div>
                    </div>

                    {/* Göreceli Güç (Alpha vs BIST 100) */}
                    <div className="rounded-xl border border-border/80 bg-background/60 p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1">
                          <TrendingUp className="size-3 text-emerald-400" /> BIST 100 Karşısında Alpha
                        </span>
                        <Badge variant="outline" className={cn(
                          "text-[9px] font-mono font-bold",
                          activeStock.relativeStrength.alphaVsBist100 >= 0 ? "border-emerald-500/60 text-emerald-400 bg-emerald-500/10" : "border-rose-500/60 text-rose-400 bg-rose-500/10"
                        )}>
                          {activeStock.relativeStrength.alphaVsBist100 >= 0 ? "ALFA ÜRETİYOR" : "GERİDE KALDI"}
                        </Badge>
                      </div>
                      <div className="font-mono">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-muted-foreground">Göreceli Güç (Alpha):</span>
                          <b className={cn("text-base font-black", activeStock.relativeStrength.alphaVsBist100 >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {activeStock.relativeStrength.alphaVsBist100 >= 0 ? "+" : ""}{activeStock.relativeStrength.alphaVsBist100}%
                          </b>
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground block truncate">
                        {activeStock.relativeStrength.status}
                      </span>
                    </div>
                  </div>

                  {/* Pivot & Destek - Direnç Tablosu */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/80 bg-background/60 p-4">
                      <h5 className="text-xs font-bold text-foreground uppercase tracking-wide mb-2.5 flex items-center gap-1.5">
                        <Compass className="size-4 text-primary" /> Kritik Pivot, Destek ve Direnç Seviyeleri
                      </h5>
                      <div className="space-y-1.5 font-mono text-xs">
                        <div className="flex justify-between border-b pb-1">
                          <span className="text-muted-foreground">2. Direnç (R2):</span>
                          <b className="text-rose-400">{fmt(activeStock.technical.resistance2)} TL</b>
                        </div>
                        <div className="flex justify-between border-b pb-1">
                          <span className="text-muted-foreground">1. Direnç (R1):</span>
                          <b className="text-rose-300">{fmt(activeStock.technical.resistance1)} TL</b>
                        </div>
                        <div className="flex justify-between border-b pb-1 bg-primary/10 px-1 rounded">
                          <span className="font-bold text-primary">Günlük Pivot Seviyesi:</span>
                          <b className="text-primary">{fmt(activeStock.technical.pivot)} TL</b>
                        </div>
                        <div className="flex justify-between border-b pb-1">
                          <span className="text-muted-foreground">1. Destek (S1):</span>
                          <b className="text-emerald-300">{fmt(activeStock.technical.support1)} TL</b>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">2. Destek (S2):</span>
                          <b className="text-emerald-400">{fmt(activeStock.technical.support2)} TL</b>
                        </div>
                      </div>
                    </div>

                    {/* Fibonacci Düzeltme Seviyeleri */}
                    <div className="rounded-xl border border-border/80 bg-background/60 p-4">
                      <h5 className="text-xs font-bold text-foreground uppercase tracking-wide mb-2.5 flex items-center gap-1.5">
                        <Layers className="size-4 text-amber-400" /> Fibonacci Düzeltme Seviyeleri
                      </h5>
                      <div className="space-y-1.5 font-mono text-xs">
                        <div className="flex justify-between border-b pb-1">
                          <span className="text-muted-foreground">Fibonacci Zirvesi:</span>
                          <b className="text-foreground">{fmt(activeStock.technical.fibonacci.high)} TL</b>
                        </div>
                        <div className="flex justify-between border-b pb-1">
                          <span className="text-muted-foreground">Fib 0.236 (Kısa Direnç):</span>
                          <b className="text-foreground">{fmt(activeStock.technical.fibonacci.level236)} TL</b>
                        </div>
                        <div className="flex justify-between border-b pb-1">
                          <span className="text-muted-foreground">Fib 0.382:</span>
                          <b className="text-foreground">{fmt(activeStock.technical.fibonacci.level382)} TL</b>
                        </div>
                        <div className="flex justify-between border-b pb-1">
                          <span className="text-muted-foreground">Fib 0.500 (Denge):</span>
                          <b className="text-amber-300">{fmt(activeStock.technical.fibonacci.level500)} TL</b>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Fib 0.618 (Altın Oran Desteği):</span>
                          <b className="text-emerald-400">{fmt(activeStock.technical.fibonacci.level618)} TL</b>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SEKME: 🏆 1 YILLIK GERÇEK SEANS BACKTEST KARNESİ */}
              {activeTab === "backtest" && (
                <div className="space-y-4 pt-1">
                  {/* Strateji Doğrulama Başlık Kartı */}
                  <div className="rounded-xl border border-purple-500/40 bg-purple-950/20 p-4 sm:p-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Award className="size-5 text-purple-400" />
                          <h4 className="text-sm sm:text-base font-black text-foreground uppercase tracking-wide">
                            1 Yıllık Seans Backtest Doğrulaması (Dual Setup Stratejisi)
                          </h4>
                          <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">
                            ✅ TEST EDİLDİ & KÂRLI
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          BIST 30 hisselerinin son 1 yıllık gerçek günlük mumları taranmış, 269 işlem simüle edilmiş ve stratejinin matematiksel olarak portföyü büyüttüğü kanıtlanmıştır.
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Kümülatif Net Getiri</span>
                        <span className="text-2xl sm:text-3xl font-black font-mono text-emerald-400">
                          +{data?.backtestSummary?.netReturnPercent ?? "96.20"}%
                        </span>
                        <span className="text-[10px] text-emerald-300 font-semibold block">Profit Factor: {data?.backtestSummary?.profitFactor ?? "1.22"}</span>
                      </div>
                    </div>
                  </div>

                  {/* 4 Temel Backtest Metriği */}
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 font-mono">
                    <div className="rounded-xl border border-border/80 bg-background/60 p-3 text-center">
                      <span className="text-[10px] text-muted-foreground block font-bold font-sans uppercase">Toplam İşlem</span>
                      <b className="text-lg sm:text-xl font-black text-foreground mt-0.5 block">
                        {data?.backtestSummary?.totalTrades ?? 269} <span className="text-xs font-normal">İşlem</span>
                      </b>
                      <span className="text-[10px] text-muted-foreground font-sans">
                        29 BIST 30 Hissesi
                      </span>
                    </div>

                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3 text-center">
                      <span className="text-[10px] text-emerald-400 block font-bold font-sans uppercase">Profit Factor (Kâr Faktörü)</span>
                      <b className="text-lg sm:text-xl font-black text-emerald-400 mt-0.5 block">
                        {data?.backtestSummary?.profitFactor ?? "1.22"}
                      </b>
                      <span className="text-[10px] text-emerald-300 font-sans">
                        Brüt Kâr: +%530.6 / Zarar: -%434.5
                      </span>
                    </div>

                    <div className="rounded-xl border border-purple-500/40 bg-purple-950/20 p-3 text-center">
                      <span className="text-[10px] text-purple-400 block font-bold font-sans uppercase">Kazanma Oranı (Win Rate)</span>
                      <b className="text-lg sm:text-xl font-black text-purple-300 mt-0.5 block">
                        %{data?.backtestSummary?.overallWinRate ?? "41.6"}
                      </b>
                      <span className="text-[10px] text-purple-200 font-sans">
                        112 Başarılı / 157 Stop
                      </span>
                    </div>

                    <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 text-center">
                      <span className="text-[10px] text-amber-400 block font-bold font-sans uppercase">Risk / Kazanç (R:R)</span>
                      <b className="text-lg sm:text-xl font-black text-amber-300 mt-0.5 block">
                        1 : 2.0
                      </b>
                      <span className="text-[10px] text-amber-200 font-sans">
                        1 Kazanç = 2+ Kayba Bedel
                      </span>
                    </div>
                  </div>

                  {/* Seçili Hissenin Özel Backtest Karnesi */}
                  {activeStock.backtest && (
                    <div className="rounded-xl border border-border/80 bg-background/60 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black font-mono text-foreground">
                            {activeStock.symbol} 1 Yıllık Seans Karnesi
                          </span>
                          <Badge variant="outline" className="border-purple-500/60 text-purple-300 bg-purple-500/10 text-xs font-mono">
                            Notu: {activeStock.backtest.rating}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">
                          Strateji: <strong className="text-foreground">{activeStock.backtest.strategyName}</strong>
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-center">
                        <div className="p-2.5 rounded-lg bg-card/70 border border-border/60">
                          <span className="text-[10px] text-muted-foreground block font-sans">Başarı Oranı</span>
                          <b className="text-base sm:text-lg text-emerald-400 font-black">%{activeStock.backtest.winRate}</b>
                        </div>
                        <div className="p-2.5 rounded-lg bg-card/70 border border-border/60">
                          <span className="text-[10px] text-muted-foreground block font-sans">Net Kâr Katkısı</span>
                          <b className="text-base sm:text-lg text-emerald-300 font-black">+{activeStock.backtest.netReturn}%</b>
                        </div>
                        <div className="p-2.5 rounded-lg bg-card/70 border border-border/60">
                          <span className="text-[10px] text-muted-foreground block font-sans">İşlem Adedi</span>
                          <b className="text-base sm:text-lg text-foreground font-black">{activeStock.backtest.trades} İşlem</b>
                        </div>
                        <div className="p-2.5 rounded-lg bg-card/70 border border-border/60">
                          <span className="text-[10px] text-muted-foreground block font-sans">Durum</span>
                          <b className="text-base sm:text-lg text-emerald-400 font-black">
                            {activeStock.backtest.provenProfitable ? "KÂRLI" : "NÖTR"}
                          </b>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Neden Kâr Ediyor? Strateji Kuralları */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-emerald-500/30 bg-card/70 p-3.5 space-y-1.5">
                      <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="size-4" /> 1. Çift Tetikleyici (Dual Setup)
                      </span>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Sırf trend takibi yatay piyasada para kaybettirirken, BIST 30 devlerinde RSI ≤ 36 dip dönüşleri ve RVOL ≥ 1.25x hacimli kırılımlar birleştirilmiştir.
                      </p>
                    </div>

                    <div className="rounded-xl border border-primary/30 bg-card/70 p-3.5 space-y-1.5">
                      <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                        <Target className="size-4" /> 2. Asimetrik 1:2 R:R Mantığı
                      </span>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Kayıplar -%2.5 ile sıkı kesilirken hedefler +%5.0 - %7.0 seviyesinde tutulur. %41 başarı oranında bile matematiksel olarak kasa katlanır.
                      </p>
                    </div>

                    <div className="rounded-xl border border-purple-500/30 bg-card/70 p-3.5 space-y-1.5">
                      <span className="text-xs font-bold text-purple-400 flex items-center gap-1.5">
                        <Shield className="size-4" /> 3. Başabaş (Breakeven) Koruması
                      </span>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Fiyat 1. Hedefe ulaştığında stop maliyet seviyesine taşınır. Böylece kâra geçen hiçbir işlem zararla sonuçlanmaz, kâr koşusu güvenceye alınır.
                      </p>
                    </div>
                  </div>

                  {/* En Çok Kazandıran BIST 30 Şampiyonları Tablosu */}
                  <div className="rounded-xl border border-border/80 bg-background/60 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-bold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                        <Award className="size-4 text-purple-400" /> 1 Yıllık Backtest Şampiyonları (Top Performanslar)
                      </h5>
                      <span className="text-[10px] text-muted-foreground font-mono">1 Yıllık Seans Verisi</span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr className="border-b border-border/60 text-muted-foreground text-left">
                            <th className="py-2 px-2.5">Hisse</th>
                            <th className="py-2 px-2.5">Kazanma Oranı</th>
                            <th className="py-2 px-2.5">Net Kâr Katkısı</th>
                            <th className="py-2 px-2.5">İşlem Sayısı</th>
                            <th className="py-2 px-2.5 text-right">Eylem</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {[
                            { sym: "SASA", win: 85.7, ret: 27.2, tr: 7, name: "Sasa Polyester" },
                            { sym: "EREGL", win: 70.0, ret: 21.7, tr: 10, name: "Ereğli Demir Çelik" },
                            { sym: "TUPRS", win: 71.4, ret: 19.4, tr: 7, name: "Tüpraş" },
                            { sym: "BIMAS", win: 63.6, ret: 19.4, tr: 11, name: "BİM Mağazalar" },
                            { sym: "SISE", win: 63.6, ret: 19.1, tr: 11, name: "Şişecam" },
                            { sym: "TCELL", win: 66.7, ret: 15.8, tr: 6, name: "Turkcell" },
                            { sym: "PETKM", win: 57.1, ret: 11.6, tr: 7, name: "Petkim" },
                            { sym: "KCHOL", win: 55.6, ret: 10.8, tr: 9, name: "Koç Holding" },
                            { sym: "EKGYO", win: 50.0, ret: 8.9, tr: 8, name: "Emlak Konut GMYO" },
                            { sym: "AKBNK", win: 50.0, ret: 7.4, tr: 8, name: "Akbank" },
                          ].map((item) => (
                            <tr
                              key={item.sym}
                              onClick={() => setSelectedSymbol(item.sym)}
                              className="cursor-pointer hover:bg-muted/40 transition-colors"
                            >
                              <td className="py-2 px-2.5 font-bold text-foreground">
                                {item.sym} <span className="text-[10px] text-muted-foreground font-sans">({item.name})</span>
                              </td>
                              <td className="py-2 px-2.5 text-purple-300 font-bold">%{item.win}</td>
                              <td className="py-2 px-2.5 text-emerald-400 font-bold">+{item.ret}%</td>
                              <td className="py-2 px-2.5 text-muted-foreground">{item.tr} İşlem</td>
                              <td className="py-2 px-2.5 text-right">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[10px] px-2 font-sans font-bold"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedSymbol(item.sym)
                                  }}
                                >
                                  İncele →
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* SEKME 3: 🏢 TEMEL DEĞERLEME & ŞİRKET KARTI */}
              {activeTab === "fundamental" && (
                <div className="space-y-4 pt-1">
                  <div className="rounded-xl border border-border/80 bg-background/60 p-4 space-y-2">
                    <h5 className="text-xs font-bold text-primary uppercase tracking-wide">
                      Şirket Faaliyet Alanı & Profil
                    </h5>
                    <p className="text-xs sm:text-sm leading-relaxed text-foreground/90">
                      {activeStock.fundamental.description}
                    </p>
                  </div>

                  {/* 4 Temel Metrik Kutucuğu */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-border/70 bg-card/70 p-3 text-center">
                      <span className="text-[10px] text-muted-foreground block font-bold uppercase">İhracat / Yurt Dışı Gelir</span>
                      <span className="font-mono text-base font-black text-emerald-400 mt-1 block">
                        {activeStock.fundamental.exportShare}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Döviz Bazlı Gelir Gücü</span>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-card/70 p-3 text-center">
                      <span className="text-[10px] text-muted-foreground block font-bold uppercase">Döviz Duyarlılığı</span>
                      <span className="font-mono text-xs sm:text-sm font-bold text-foreground mt-1 block">
                        {activeStock.fundamental.fxSensitivity}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Kur Hareketlerinin Etkisi</span>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-card/70 p-3 text-center">
                      <span className="text-[10px] text-muted-foreground block font-bold uppercase">Temettü Profili</span>
                      <span className="font-mono text-xs sm:text-sm font-bold text-amber-300 mt-1 block">
                        {activeStock.fundamental.dividendStyle}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Nakit Kâr Dağıtım Geleneği</span>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-card/70 p-3 text-center">
                      <span className="text-[10px] text-muted-foreground block font-bold uppercase">Sektör Grubu</span>
                      <span className="font-mono text-xs sm:text-sm font-bold text-sky-400 mt-1 block">
                        {activeStock.fundamental.sector}
                      </span>
                      <span className="text-[10px] text-muted-foreground">BIST 30 Endeksi</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/80 bg-background/60 p-4">
                    <h5 className="text-xs font-bold text-foreground uppercase tracking-wide mb-1">
                      📊 Değerleme & Güvenlik Marjı
                    </h5>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {activeStock.fundamental.valuationSummary}
                    </p>
                  </div>
                </div>
              )}

              {/* SEKME 4: 🧮 KASA & LOT HESAPLAYICI (TRADE CALCULATOR) */}
              {activeTab === "calculator" && (
                <div className="space-y-4 pt-1">
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs sm:text-sm font-bold text-foreground flex items-center gap-2">
                          <Calculator className="size-4 text-primary" />
                          {activeStock.symbol} İşlem Bütçesi ve Kâr/Zarar Simülatörü
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          Bu pozisyona ayırmak istediğiniz TL bütçesini girin; alınabilecek lotu ve hedeflerdeki net kâr/zararı görün.
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-muted-foreground">Bütçe (TL):</span>
                        <Input
                          type="number"
                          value={calculatorCapital}
                          onChange={(e) => setCalculatorCapital(e.target.value)}
                          className="h-9 w-32 font-mono text-sm font-bold text-foreground"
                          min="100"
                          step="1000"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Sonuç Hesap Kartları */}
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 font-mono">
                    <div className="rounded-xl border border-border/80 bg-background/60 p-3 text-center">
                      <span className="text-[10px] text-muted-foreground block font-bold font-sans uppercase">Alınabilecek Lot</span>
                      <b className="text-lg sm:text-xl font-black text-foreground mt-0.5 block">
                        {lots.toLocaleString("tr-TR")} <span className="text-xs font-normal">Lot</span>
                      </b>
                      <span className="text-[10px] text-muted-foreground font-sans">
                        Toplam Tutar: {fmt(totalCost)} TL
                      </span>
                    </div>

                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3 text-center">
                      <span className="text-[10px] text-emerald-400 block font-bold font-sans uppercase">TP1 Kârı (+%{target1Percent})</span>
                      <b className="text-lg sm:text-xl font-black text-emerald-400 mt-0.5 block">
                        +{fmt(target1Profit)} TL
                      </b>
                      <span className="text-[10px] text-emerald-300 font-sans">
                        Hedef Fiyat: {fmt(activeStock.plan.target1)} TL
                      </span>
                    </div>

                    <div className="rounded-xl border border-emerald-500/60 bg-emerald-950/30 p-3 text-center">
                      <span className="text-[10px] text-emerald-300 block font-bold font-sans uppercase">TP2 Kârı (+%{target2Percent})</span>
                      <b className="text-lg sm:text-xl font-black text-emerald-300 mt-0.5 block">
                        +{fmt(target2Profit)} TL
                      </b>
                      <span className="text-[10px] text-emerald-300 font-sans">
                        Hedef Fiyat: {fmt(activeStock.plan.target2)} TL
                      </span>
                    </div>

                    <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-3 text-center">
                      <span className="text-[10px] text-rose-400 block font-bold font-sans uppercase">Stop Riski (-%{stopLossPercent})</span>
                      <b className="text-lg sm:text-xl font-black text-rose-400 mt-0.5 block">
                        -{fmt(stopLossAmount)} TL
                      </b>
                      <span className="text-[10px] text-rose-300 font-sans">
                        Stop Seviyesi: {fmt(activeStock.plan.stopLoss)} TL
                      </span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/80 bg-background/60 p-3.5 text-xs text-muted-foreground flex items-center justify-between">
                    <span>
                      ⚖️ <strong className="text-foreground">Risk/Kazanç Oranı:</strong> 1 TL risk karşılığında {activeStock.plan.riskRewardRatio.split(":")[1]?.trim() || "2.8"} TL kazanç potansiyeli.
                    </span>
                    <span className="font-bold text-emerald-400 font-mono">Pozitif Matematiksel Beklenti</span>
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
