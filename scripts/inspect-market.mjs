async function inspect() {
  const res = await fetch("https://api.binance.com/api/v3/ticker/24hr")
  const data = await res.json()
  const tryPairs = data.filter(d => d.symbol.endsWith("TRY"))
  console.log("Total TRY Pairs on Binance:", tryPairs.length)

  const topGainers = [...tryPairs]
    .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
    .slice(0, 15)

  console.log("\nTop 15 Gainers (24h):")
  topGainers.forEach(g => {
    console.log(`- ${g.symbol.padEnd(12)}: %${parseFloat(g.priceChangePercent).toFixed(1).padStart(5)} | Hacim: ${(parseFloat(g.quoteVolume) / 1e6).toFixed(1)}M TL | High: ${g.highPrice} | Low: ${g.lowPrice} | Now: ${g.lastPrice}`)
  })

  // AKE veya benzeri ara
  const akeMatch = data.filter(d => d.symbol.includes("AKE") || d.symbol.includes("ARK") || d.symbol.includes("ACA"))
  console.log("\nAKE / Benzer Ticker Arama:")
  akeMatch.forEach(m => console.log(`- ${m.symbol}: %${parseFloat(m.priceChangePercent).toFixed(1)} | High: ${m.highPrice} | Now: ${m.lastPrice}`))
}

inspect().catch(console.error)
