"use client"

import React, { useState, useMemo } from "react"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts"
import { TrendingUp, TrendingDown, Clock, ShieldCheck, Calendar } from "lucide-react"
import { cn } from "@/lib/utils"

interface MidasChartProps {
  data: {
    symbol: string
    name?: string
    price: number
    change: number
    currency?: string
    technical: {
      signal: string
      confidence: number
      support: number
      resistance: number
      chart: Array<{ date: string; price: number; sma?: number }>
    }
  }
  timeframe: string
  onTimeframeChange: (tf: string) => void
}

const MIDAS_TIMEFRAMES = [
  { id: "1d", label: "1G", title: "1 Günlük", desc: "Bugünün seansı" },
  { id: "1w", label: "1H", title: "1 Haftalık", desc: "Son 1 hafta" },
  { id: "1mo", label: "1A", title: "1 Aylık", desc: "Son 1 ay" },
  { id: "3mo", label: "3A", title: "3 Aylık", desc: "Son 3 ay" },
  { id: "1y", label: "1Y", title: "1 Yıllık", desc: "Son 1 yıl" },
  { id: "all", label: "TÜMÜ", title: "Tüm Zamanlar", desc: "Tüm geçmiş" },
]

const INTRADAY_TIMEFRAMES = [
  { id: "1m", label: "1dk" },
  { id: "5m", label: "5dk" },
  { id: "15m", label: "15dk" },
  { id: "1h", label: "1s" },
]

export function MidasChart({
  data,
  timeframe,
  onTimeframeChange,
}: MidasChartProps) {
  const [hoveredPoint, setHoveredPoint] = useState<{
    date: string
    price: number
  } | null>(null)

  const chartData = data?.technical?.chart || []

  // İlk fiyat ve son fiyat
  const firstPrice = chartData[0]?.price || data.price
  const currentPrice = data.price

  // Hover anındaki veya güncel fiyat
  const displayPrice = hoveredPoint ? hoveredPoint.price : currentPrice
  const displayDate = hoveredPoint ? hoveredPoint.date : null

  // Değişim hesaplaması (hover anında ilk fiyata göre, normalde günlük)
  const diffFromFirst = displayPrice - firstPrice
  const diffPctFromFirst = firstPrice > 0 ? (diffFromFirst / firstPrice) * 100 : 0
  const isPositive = hoveredPoint ? diffFromFirst >= 0 : data.change >= 0

  const currencySymbol =
    data.currency === "TRY" ? "₺" : data.currency === "USD" ? "$" : `${data.currency} `

  // Aktif zaman dilimi açıklaması
  const activeTf = MIDAS_TIMEFRAMES.find((t) => t.id === timeframe)

  // En düşük & En yüksek
  const { minPrice, maxPrice } = useMemo(() => {
    if (chartData.length === 0) return { minPrice: data.price, maxPrice: data.price }
    const prices = chartData.map((d) => d.price)
    return {
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
    }
  }, [chartData, data.price])

  // Renk tanımları
  const strokeColor = isPositive ? "#10b981" : "#f43f5e"
  const gradientId = isPositive ? "midasGlowGreen" : "midasGlowRed"

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-b from-card via-card/95 to-background p-4 sm:p-5 shadow-lg transition-all">
      {/* 1. Midas Tarzı Canlı Fiyat Başlığı & Zaman Seçici */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {data.name || data.symbol}
            </h3>
            <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">
              {data.symbol}
            </span>
          </div>

          {/* Dev İnteraktif Fiyat */}
          <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
            <span className="font-mono text-3xl sm:text-4xl font-black tracking-tight text-foreground">
              {currencySymbol}
              {displayPrice.toLocaleString("tr-TR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: displayPrice < 1 ? 4 : 2,
              })}
            </span>

            {/* Midas Rozeti */}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black font-mono shadow-xs transition-colors",
                isPositive
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
              )}
            >
              {isPositive ? (
                <TrendingUp className="size-3.5 stroke-[3]" />
              ) : (
                <TrendingDown className="size-3.5 stroke-[3]" />
              )}
              {isPositive ? "+" : ""}
              {(hoveredPoint ? diffPctFromFirst : data.change).toFixed(2)}%
              <span className="text-[11px] opacity-80">
                ({isPositive ? "+" : ""}
                {currencySymbol}
                {Math.abs(hoveredPoint ? diffFromFirst : (currentPrice * (data.change / 100))).toFixed(2)})
              </span>
            </span>
          </div>

          {/* Hover Saati veya Canlı Durum */}
          <div className="mt-1 flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
            {displayDate ? (
              <span className="flex items-center gap-1 text-primary font-semibold">
                <Clock className="size-3.5" /> {displayDate} noktasındaki fiyat
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <span className="font-semibold text-foreground/80">
                  {activeTf ? `${activeTf.title} (${activeTf.desc})` : "Midas Sade Görünüm"}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* 🌟 Midas Tarzı Zaman Dilimi Pill Butonları (1G, 1H, 1A, 3A, 1Y, TÜMÜ) */}
        <div className="flex flex-col items-start sm:items-end gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-full border border-border/70 bg-muted/40 p-1 shadow-inner">
            {MIDAS_TIMEFRAMES.map((tf) => {
              const isActive = timeframe === tf.id
              return (
                <button
                  key={tf.id}
                  type="button"
                  onClick={() => onTimeframeChange(tf.id)}
                  className={cn(
                    "rounded-full px-3.5 py-1 text-xs font-mono font-black transition-all",
                    isActive
                      ? isPositive
                        ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30 ring-1 ring-emerald-400"
                        : "bg-rose-500 text-white shadow-md shadow-rose-500/30 ring-1 ring-rose-400"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  )}
                  title={`${tf.title} - ${tf.desc}`}
                >
                  {tf.label}
                </button>
              )
            })}
          </div>

          {/* Gün İçi Hassas Dakikalar (İsteğe Bağlı) */}
          <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground pl-2 sm:pl-0">
            <span className="text-[10px] opacity-75">Gün İçi Seans:</span>
            {INTRADAY_TIMEFRAMES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onTimeframeChange(m.id)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-bold transition-all",
                  timeframe === m.id
                    ? "bg-primary text-primary-foreground font-black shadow-xs"
                    : "hover:text-foreground hover:bg-muted/50"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Midas Pürüzsüz Glow Alan Grafiği */}
      <div className="mt-4 h-[300px] w-full">
        {chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Veri yükleniyor...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              onMouseMove={(e: any) => {
                if (e?.activePayload && e.activePayload.length > 0) {
                  const p = e.activePayload[0].payload
                  setHoveredPoint({ date: p.date, price: p.price })
                }
              }}
              onMouseLeave={() => setHoveredPoint(null)}
            >
              <defs>
                <linearGradient id="midasGlowGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.38} />
                  <stop offset="60%" stopColor="#10b981" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="midasGlowRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.38} />
                  <stop offset="60%" stopColor="#f43f5e" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.0} />
                </linearGradient>
                <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow
                    dx="0"
                    dy="3"
                    stdDeviation="4"
                    floodColor={isPositive ? "#10b981" : "#f43f5e"}
                    floodOpacity="0.45"
                  />
                </filter>
              </defs>

              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                minTickGap={30}
                tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10, fontFamily: "monospace" }}
              />

              <YAxis
                orientation="right"
                domain={[(dataMin: number) => dataMin * 0.995, (dataMax: number) => dataMax * 1.005]}
                axisLine={false}
                tickLine={false}
                width={58}
                tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10, fontFamily: "monospace" }}
                tickFormatter={(val: number) =>
                  val.toLocaleString("tr-TR", { maximumFractionDigits: val < 1 ? 4 : 2 })
                }
              />

              {/* İlk Fiyat Referans Çizgisi */}
              {firstPrice > 0 && (
                <ReferenceLine
                  y={firstPrice}
                  stroke="rgba(255, 255, 255, 0.15)"
                  strokeDasharray="3 3"
                />
              )}

              <Tooltip
                cursor={{
                  stroke: isPositive ? "rgba(16,185,129,0.5)" : "rgba(244,63,94,0.5)",
                  strokeWidth: 1.5,
                  strokeDasharray: "4 4",
                }}
                content={<div style={{ display: "none" }} />}
              />

              <Area
                type="monotone"
                dataKey="price"
                stroke={strokeColor}
                strokeWidth={2.8}
                fill={`url(#${gradientId})`}
                filter="url(#neonGlow)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 3. Midas Alt İstatistik Çubuğu */}
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/40 pt-3 sm:grid-cols-4 font-mono text-xs">
        <div className="rounded-xl bg-muted/30 p-2.5">
          <span className="text-[10px] text-muted-foreground block font-bold">GÜNLÜK EN DÜŞÜK</span>
          <b className="text-foreground text-sm font-black">
            {currencySymbol}{minPrice.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
          </b>
        </div>
        <div className="rounded-xl bg-muted/30 p-2.5">
          <span className="text-[10px] text-muted-foreground block font-bold">GÜNLÜK EN YÜKSEK</span>
          <b className="text-foreground text-sm font-black">
            {currencySymbol}{maxPrice.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
          </b>
        </div>
        <div className="rounded-xl bg-muted/30 p-2.5">
          <span className="text-[10px] text-muted-foreground block font-bold">DESTEK / DİRENÇ</span>
          <b className="text-foreground text-xs truncate block font-bold">
            {currencySymbol}{data.technical.support.toFixed(1)} / {currencySymbol}{data.technical.resistance.toFixed(1)}
          </b>
        </div>
        <div className="rounded-xl bg-muted/30 p-2.5">
          <span className="text-[10px] text-muted-foreground block font-bold">YAPAY ZEKA SİNYALİ</span>
          <b className="text-emerald-400 flex items-center gap-1 font-black">
            <ShieldCheck className="size-3.5" /> %{data.technical.confidence} {data.technical.signal}
          </b>
        </div>
      </div>
    </div>
  )
}
