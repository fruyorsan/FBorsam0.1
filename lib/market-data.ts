export type Signal = "GÜÇLÜ AL" | "AL" | "TUT" | "SAT" | "GÜÇLÜ SAT"

export const markets = [
  { symbol: "XU100", name: "BIST 100", price: 11891.42, change: 0.84 },
  { symbol: "XU030", name: "BIST 30", price: 13042.18, change: 0.71 },
  { symbol: "USDTRY", name: "Dolar / TL", price: 44.1872, change: 0.12 },
  { symbol: "EURTRY", name: "Euro / TL", price: 51.7764, change: -0.08 },
  { symbol: "ALTIN", name: "Gram Altın", price: 6378.22, change: 1.14 },
  { symbol: "XAUUSD", name: "Ons Altın", price: 4486.74, change: 0.66 },
  { symbol: "BRENT", name: "Brent Petrol", price: 68.42, change: -0.43 },
]

export const equities = [
  { symbol: "THYAO", name: "Türk Hava Yolları", price: 328.75, change: 1.62, volume: "4,82 Mr", score: 72, signal: "AL" as Signal },
  { symbol: "TUPRS", name: "Tüpraş", price: 189.40, change: 0.96, volume: "2,14 Mr", score: 68, signal: "AL" as Signal },
  { symbol: "BIMAS", name: "BİM Mağazalar", price: 548.50, change: -0.54, volume: "1,07 Mr", score: 51, signal: "TUT" as Signal },
  { symbol: "ASELS", name: "Aselsan", price: 213.10, change: 2.31, volume: "5,31 Mr", score: 79, signal: "GÜÇLÜ AL" as Signal },
  { symbol: "KCHOL", name: "Koç Holding", price: 174.80, change: -1.12, volume: "1,76 Mr", score: 39, signal: "SAT" as Signal },
  { symbol: "EREGL", name: "Ereğli Demir Çelik", price: 27.84, change: 0.29, volume: "2,88 Mr", score: 55, signal: "TUT" as Signal },
  { symbol: "AKBNK", name: "Akbank", price: 78.65, change: 1.18, volume: "3,12 Mr", score: 66, signal: "AL" as Signal },
]

export function makeCandles(symbol: string, base: number) {
  const seed = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  return Array.from({ length: 60 }, (_, i) => {
    const drift = Math.sin((i + seed) / 5) * base * 0.018 + i * base * 0.0011
    const noise = Math.sin((i + seed) * 1.71) * base * 0.006
    const price = base * 0.91 + drift + noise
    return { date: `${i + 1} Ağu`, price: Number(price.toFixed(2)), sma: Number((price * (0.995 + Math.sin(i / 9) * 0.004)).toFixed(2)), volume: Math.round(12 + Math.abs(Math.sin(i * 1.3)) * 38) }
  })
}

export const indicators = [
  { name: "RSI (14)", value: "62,4", signal: "AL", detail: "Momentum pozitif, aşırı alım altında" },
  { name: "MACD (12,26,9)", value: "+2,84", signal: "AL", detail: "Sinyal çizgisi üzerinde" },
  { name: "Hareketli Ort. 20", value: "321,16", signal: "AL", detail: "Fiyat ortalamanın %2,4 üzerinde" },
  { name: "Hareketli Ort. 50", value: "309,82", signal: "GÜÇLÜ AL", detail: "Orta vadeli trend yukarı" },
  { name: "Bollinger Bantları", value: "%73", signal: "TUT", detail: "Üst banda yakın, alan daralıyor" },
  { name: "Stochastic (14,3,3)", value: "71,8", signal: "TUT", detail: "Momentum güçlü fakat yoruluyor" },
  { name: "ADX (14)", value: "28,6", signal: "AL", detail: "Trend gücü teyit ediliyor" },
  { name: "OBV", value: "+4,7%", signal: "AL", detail: "Hacim fiyatı destekliyor" },
]

export const news = [
  { source: "KAP", time: "8 dk", title: "Tüpraş kapasite kullanım ve bakım takvimine ilişkin açıklama yayımladı", tag: "TUPRS", sentiment: "Pozitif" },
  { source: "Reuters", time: "21 dk", title: "Petrol fiyatları OPEC+ arz görünümüyle yatay seyrediyor", tag: "BRENT", sentiment: "Nötr" },
  { source: "Bloomberg HT", time: "34 dk", title: "Borsa İstanbul güne alıcılı başladı; bankacılık öne çıkıyor", tag: "XU100", sentiment: "Pozitif" },
  { source: "KAP", time: "52 dk", title: "Aselsan yeni yurt dışı sözleşmesini duyurdu", tag: "ASELS", sentiment: "Pozitif" },
]
