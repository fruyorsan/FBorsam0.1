const fs = require('fs');

async function fetchFullTop100() {
  const url = 'https://mcp.api.coingecko.com/mcp';
  const initRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'antigravity', version: '1.0.0' } }
    })
  });
  const sessionId = initRes.headers.get('mcp-session-id');
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  });

  console.log('Fetching top 100 markets data...');
  const codeMarkets = `
async function run(client) {
  const p1 = await client.coins.markets.get({
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: 100,
    page: 1,
    sparkline: true,
    price_change_percentage: '24h,7d,30d'
  });
  return p1;
}
  `;

  const toolRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'execute', arguments: { code: codeMarkets } } })
  });
  const txt = await toolRes.text();
  const line = txt.split('\n').find(l => l.startsWith('data: '));
  const parsed = JSON.parse(line.slice(6));
  const coins = JSON.parse(parsed.result.content[0].text).result;
  console.log('Fetched', coins.length, 'coins.');

  // Now fetch 7d volume history for all 100 coins
  const ids = coins.map(c => c.id);
  const volumeData = {};
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    console.log(`Fetching 7d volume for chunk ${i/10 + 1}/10...`);
    const codeVol = `
async function run(client) {
  const ids = ${JSON.stringify(chunk)};
  const results = {};
  for (const id of ids) {
    try {
      const res = await client.coins.marketChart.get(id, { vs_currency: 'usd', days: '7', interval: 'daily' });
      results[id] = res.total_volumes;
    } catch (e) {
      results[id] = null;
    }
  }
  return results;
}
    `;
    const resChunk = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', id: i + 10, method: 'tools/call', params: { name: 'execute', arguments: { code: codeVol } } })
    });
    const cTxt = await resChunk.text();
    const cLine = cTxt.split('\n').find(l => l.startsWith('data: '));
    if (cLine) {
      const cParsed = JSON.parse(cLine.slice(6));
      const cInner = JSON.parse(cParsed.result.content[0].text);
      Object.assign(volumeData, cInner.result || cInner);
    }
  }

  // Also fetch first price timestamp (listing start date) for all 100 coins using days: 'max'
  const historyStartData = {};
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    console.log(`Fetching history start for chunk ${i/10 + 1}/10...`);
    const codeHist = `
async function run(client) {
  const ids = ${JSON.stringify(chunk)};
  const results = {};
  for (const id of ids) {
    try {
      const res = await client.coins.marketChart.get(id, { vs_currency: 'usd', days: 'max', interval: 'daily' });
      if (res.prices && res.prices.length > 0) {
        results[id] = {
          firstTimestamp: res.prices[0][0],
          firstDate: new Date(res.prices[0][0]).toISOString(),
          pointCount: res.prices.length
        };
      } else {
        results[id] = null;
      }
    } catch (e) {
      results[id] = null;
    }
  }
  return results;
}
    `;
    const resHist = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', id: i + 30, method: 'tools/call', params: { name: 'execute', arguments: { code: codeHist } } })
    });
    const hTxt = await resHist.text();
    const hLine = hTxt.split('\n').find(l => l.startsWith('data: '));
    if (hLine) {
      const hParsed = JSON.parse(hLine.slice(6));
      const hInner = JSON.parse(hParsed.result.content[0].text);
      Object.assign(historyStartData, hInner.result || hInner);
    }
  }

  fs.writeFileSync('top100_coins.json', JSON.stringify(coins, null, 2));
  fs.writeFileSync('all_volumes.json', JSON.stringify(volumeData, null, 2));
  fs.writeFileSync('all_histories.json', JSON.stringify(historyStartData, null, 2));
  console.log('All data fetched and saved successfully.');
}

fetchFullTop100().catch(console.error);
