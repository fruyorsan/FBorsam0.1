async function getTopGainers() {
  const res = await fetch("https://api.binance.com/api/v3/ticker/24hr")
  const data = await res.json()
  const tryPairs = data.filter(x => x.symbol.endsWith("TRY"))
  tryPairs.sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
  console.log("TOP 20 TRY GAINERS:")
  for (const p of tryPairs.slice(0, 20)) {
    console.log(`${p.symbol.padEnd(12)}: ${parseFloat(p.priceChangePercent).toFixed(2)}% | 24h Vol: ${(parseFloat(p.quoteVolume)/1e6).toFixed(2)}M TRY | High: ${p.highPrice} | Low: ${p.lowPrice}`)
  }
}
getTopGainers()
