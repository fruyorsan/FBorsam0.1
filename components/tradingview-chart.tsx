"use client"

import React, { memo, useMemo, useState } from "react"
import { bistStocks } from "@/lib/bist-stocks"
import { Maximize2, Minimize2, ExternalLink } from "lucide-react"

interface TradingViewChartProps {
  symbol: string
  market?: "Tümü" | "BIST" | "ABD" | "Kripto" | string
  currency?: string
  height?: number | string
  isExpanded?: boolean
  onToggleExpand?: () => void
}

const CRYPTO_MAP: Record<string, string> = {
  PEPE: "BINANCE:PEPEUSDT",
  "1000PEPE": "BINANCE:1000PEPEUSDT",
  PENGU: "BINANCE:PENGUUSDT",
  FLOKI: "BINANCE:FLOKIUSDT",
  DOGE: "BINANCE:DOGEUSDT",
  SHIB: "BINANCE:SHIBUSDT",
  BONK: "BINANCE:BONKUSDT",
  WIF: "BINANCE:WIFUSDT",
  BOME: "BINANCE:BOMEUSDT",
  BTC: "BINANCE:BTCUSDT",
  ETH: "BINANCE:ETHUSDT",
  SOL: "BINANCE:SOLUSDT",
  BNB: "BINANCE:BNBUSDT",
  XRP: "BINANCE:XRPUSDT",
  SUI: "BINANCE:SUIUSDT",
  AVAX: "BINANCE:AVAXUSDT",
  ADA: "BINANCE:ADAUSDT",
  NEAR: "BINANCE:NEARUSDT",
  RENDER: "BINANCE:RENDERUSDT",
  FET: "BINANCE:FETUSDT",
  LINK: "BINANCE:LINKUSDT",
}

export function resolveTradingViewSymbol(
  rawSymbol: string,
  marketHint?: string,
  currency?: string
): string {
  const clean = rawSymbol
    .toUpperCase()
    .replace(/^CRYPTO:/i, "")
    .replace(/\.IS$/i, "")
    .trim()

  // 1. Doğrudan Kripto Haritası
  if (CRYPTO_MAP[clean]) {
    return CRYPTO_MAP[clean]
  }

  // 2. Kripto ipucu veya USDT/BTC paritesi
  if (
    marketHint === "Kripto" ||
    rawSymbol.toLowerCase().startsWith("crypto:") ||
    clean.endsWith("USDT")
  ) {
    const base = clean.replace(/USDT$/i, "")
    return `BINANCE:${base}USDT`
  }

  // 3. Borsa İstanbul (BIST)
  if (
    marketHint === "BIST" ||
    clean in bistStocks ||
    currency === "TRY" ||
    rawSymbol.toUpperCase().endsWith(".IS")
  ) {
    return `BIST:${clean}`
  }

  // 4. ABD Borsaları (NASDAQ / NYSE)
  if (marketHint === "ABD" || currency === "USD") {
    const nyseStocks = new Set(["KO", "DIS", "JNJ", "WMT", "JPM", "PG", "V", "MA", "UNH", "HD", "BA", "NKE"])
    if (nyseStocks.has(clean)) {
      return `NYSE:${clean}`
    }
    return `NASDAQ:${clean}`
  }

  // 5. Fallback: BIST kontrolü (5 harf ve altı Türk hissesi varsayımı)
  if (clean.length <= 5 && !clean.includes("USD")) {
    return `BIST:${clean}`
  }

  return `BINANCE:${clean}USDT`
}

export function TradingViewChart({
  symbol,
  market = "BIST",
  currency,
  height = 420,
  isExpanded = false,
  onToggleExpand,
}: TradingViewChartProps) {
  const [activeInterval, setActiveInterval] = useState<string>("D")

  const tvSymbol = useMemo(() => {
    return resolveTradingViewSymbol(symbol, market, currency)
  }, [symbol, market, currency])

  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams({
      symbol: tvSymbol,
      interval: activeInterval,
      hidesidetoolbar: "0",
      symboledit: "1",
      saveimage: "1",
      toolbarbg: "rgba(15,23,42,1)",
      theme: "dark",
      style: "1", // 1 = Mum Grafik (Candlestick)
      timezone: "Europe/Istanbul",
      locale: "tr",
      withdateranges: "1",
      hideideas: "1",
      studies: "Volume@tv-basicstudies",
    })
    return "https://s.tradingview.com/widgetembed/?" + params.toString()
  }, [tvSymbol, activeInterval])

  const effectiveHeight = isExpanded ? 580 : typeof height === "number" ? `${height}px` : height

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-border/70 bg-card/95 shadow-md transition-all">
      {/* Üst Bar: Canlı Gösterge & Kontroller */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-muted/40 px-3 py-2 text-[11px] font-mono">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-bold text-foreground">TradingView Canlı Mum Grafiği</span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            {tvSymbol}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Hızlı Aralık Seçici */}
          <div className="flex items-center rounded-md border border-border/60 bg-background/60 p-0.5">
            {[
              { id: "1", label: "1dk" },
              { id: "5", label: "5dk" },
              { id: "15", label: "15dk" },
              { id: "60", label: "1s" },
              { id: "240", label: "4s" },
              { id: "D", label: "1G" },
              { id: "W", label: "1H" },
            ].map((tf) => (
              <button
                key={tf.id}
                type="button"
                onClick={() => setActiveInterval(tf.id)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-all ${
                  activeInterval === tf.id
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Büyüt / Küçült */}
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="flex size-7 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
              title={isExpanded ? "Grafiği Küçült" : "Grafiği Büyüt"}
            >
              {isExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </button>
          )}

          {/* TradingView'de Aç */}
          <a
            href={`https://tr.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex size-7 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            title="TradingView'de Tam Sayfa Aç"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>

      {/* İframe Grafik Alanı */}
      <iframe
        key={`${tvSymbol}-${activeInterval}`}
        title={`TradingView ${tvSymbol}`}
        src={iframeSrc}
        className="w-full border-none transition-all"
        style={{ height: effectiveHeight }}
        allowTransparency
        scrolling="no"
      />
    </div>
  )
}

export default memo(TradingViewChart)
