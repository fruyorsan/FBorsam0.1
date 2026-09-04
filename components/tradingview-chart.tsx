"use client"

import React, { memo, useMemo } from "react"

interface TradingViewChartProps {
  symbol: string
  market?: string
  height?: number | string
}

const CRYPTO_MAP: Record<string, string> = {
  PEPE: "BINANCE:PEPEUSDT",
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

export function TradingViewChart({
  symbol,
  market = "Kripto",
  height = 360,
}: TradingViewChartProps) {
  const cleanSymbol = symbol.toUpperCase().replace("CRYPTO:", "")
  
  const tvSymbol = useMemo(() => {
    if (CRYPTO_MAP[cleanSymbol]) {
      return CRYPTO_MAP[cleanSymbol]
    }
    if (market === "Kripto") {
      return "BINANCE:" + cleanSymbol + "USDT"
    }
    if (market === "BIST") {
      return "BIST:" + cleanSymbol
    }
    if (market === "ABD") {
      return "NASDAQ:" + cleanSymbol
    }
    return "BINANCE:" + cleanSymbol + "USDT"
  }, [cleanSymbol, market])

  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams({
      symbol: tvSymbol,
      interval: "60",
      hidesidetoolbar: "0",
      symboledit: "1",
      saveimage: "0",
      toolbarbg: "rgba(0,0,0,0)",
      theme: "dark",
      style: "1",
      timezone: "Europe/Istanbul",
      locale: "tr",
      withdateranges: "1",
      hideideas: "1",
    })
    return "https://s.tradingview.com/widgetembed/?" + params.toString()
  }, [tvSymbol])

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-border/60 bg-card/90">
      <div className="flex items-center justify-between border-b border-border/40 bg-muted/40 px-3 py-1.5 text-[11px] font-mono">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-semibold text-foreground">TradingView Canlı Veri</span>
          <span className="text-muted-foreground font-normal">· {tvSymbol}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
          Canlı Akış
        </div>
      </div>
      <iframe
        key={tvSymbol}
        title={"TradingView " + tvSymbol}
        src={iframeSrc}
        className="w-full border-none"
        style={{ height: typeof height === "number" ? height + "px" : height }}
        allowTransparency
        scrolling="no"
      />
    </div>
  )
}

export default memo(TradingViewChart)
