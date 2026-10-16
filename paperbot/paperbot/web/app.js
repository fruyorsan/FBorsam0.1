/* PaperBot panel — tüm veri /api REST ucundan gelir (backend ile tamamen ayrı). */
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const fmt = (n, d = 2) => (n === null || n === undefined || isNaN(n)) ? "—"
  : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n, d = 1) => (n === null || n === undefined || isNaN(n)) ? "—" : "%" + fmt(n * 100, d);
const cls = (n) => n > 0 ? "pos" : (n < 0 ? "neg" : "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const short = (t) => { t = String(t ?? ""); return t.length > 19 ? t.slice(0, 16) + "…" : (t || "—"); };

function toast(msg, err = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = err ? "err" : "";
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), err ? 6000 : 3200);
}

async function api(method, url, body) {
  const opt = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(url, opt);
  let data = null;
  try { data = await r.json(); } catch (e) { /* boş gövde */ }
  if (!r.ok) {
    const detail = data && (data.detail || data.error);
    throw new Error(detail || `${r.status} ${r.statusText}`);
  }
  return data;
}

/* ---------------------------------------------------------------- sekmeler */
$$("#tabs button").forEach(b => b.addEventListener("click", () => {
  $$("#tabs button").forEach(x => x.classList.remove("active"));
  $$(".tab").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  $("#tab-" + b.dataset.tab).classList.add("active");
  loadTab(b.dataset.tab);
}));

function loadTab(name) {
  ({ overview: loadOverview, assets: loadAssets, positions: loadPositions,
     signals: loadSignals, performance: loadPerformance, backtest: () => {},
     wallets: loadWallets, settings: loadSettings }[name] || (() => {}))();
}

/* ------------------------------------------------------------- skor hücreleri */
function scoreCell(v, source, title) {
  if (v === null || v === undefined) return "—";
  const badge = source === "live" ? '<span class="badge live">canlı</span>'
    : (source === "mock" ? '<span class="badge mock">mock</span>' : "");
  const w = Math.max(0, Math.min(100, v));
  const color = w >= 65 ? "#3fb950" : (w >= 45 ? "#4f9cf9" : "#f85149");
  const t = title ? ` title="${esc(title)}"` : "";
  return `<span${t}>${fmt(v, 0)} <span class="scorebar"><i style="width:${w}%;background:${color}"></i></span> ${badge}</span>`;
}
function decisionBadge(a, executed, skip) {
  const label = { open: "GİRİŞ", exit: "ÇIKIŞ", hold: "İZLE", risk_block: "RİSK BLOĞU" }[a] || a;
  let extra = "";
  if (a === "open" && executed === false) extra = ' <span class="badge">açılmadı</span>';
  if (skip) extra += ` <span class="muted" title="${esc(skip)}">(${esc(short(skip))})</span>`;
  return `<span class="badge ${esc(a)}">${label}</span>${extra}`;
}

/* ============================================================ GENEL BAKIŞ */
let equityChart = null, btChart = null;

async function loadOverview() {
  await Promise.all([refreshStatus(), loadEquityChart(), loadEvents(), loadOverviewAssets(), loadPerfMini()]);
}

async function refreshStatus() {
  try {
    const s = await api("GET", "/api/status");
    $("#ver").textContent = "v" + (s.version || "");
    $("#modePill").textContent = s.mode + (s.paper_only ? " (sanal)" : " (CANLI!)");
    const fw = $("#footWarn");
    if (fw) {
      fw.textContent = s.paper_only
        ? "⚠ SANAL TEST MODU — Yatırım tavsiyesi değildir. Tüm işlemler simülasyondur."
        : "🔴 CANLI İŞLEM MODU — GERÇEK PARAYLA İŞLEM YAPILIYOR. Yatırım tavsiyesi değildir.";
      fw.style.color = s.paper_only ? "" : "#ff6b6b";
      fw.style.fontWeight = s.paper_only ? "" : "700";
    }
    $("#feedPill").textContent = "veri: " + (s.last_price_feed || s.price_source || "—");
    $("#feedPill").className = "pill " + (s.last_price_feed === "mock" ? "" : "ok");
    $("#cyclePill").textContent = s.scheduler_running
      ? `döngü: ${s.cycle_seconds}s` : "⏰ zamanlayıcı duruyor";
    $("#haltPill").classList.toggle("hidden", !s.daily_halt);
    $("#killPill").classList.toggle("hidden", !s.kill_switch);
    $("#lastCycle").textContent = s.last_cycle_at
      ? "son çevrim: " + new Date(s.last_cycle_at).toLocaleString("tr-TR") : "henüz çevrim yok";

    $("#kEquity").textContent = fmt(s.equity) + " $";
    $("#kEquitySub").textContent = "gün başı: " + fmt(s.day_start_equity);
    $("#kCash").textContent = fmt(s.cash);
    $("#kOpen").textContent = s.open_count;
    $("#kOpenSub").textContent = "maks " + (await maxOpen()) ;
    const d = $("#kDay");
    d.textContent = fmt(s.daily_pnl_pct, 2) + " %";
    d.className = "v " + cls(s.daily_pnl_pct);
    $("#kDaySub").textContent = `limit -%${fmt(s.daily_loss_limit_pct, 0)}${s.daily_halt ? " — AŞILDI" : ""}`;

    // sağ üstteki durum özeti (Ayarlar sekmesi)
    $("#statusKv").innerHTML = [
      ["Çalışma modu", s.mode + (s.paper_only ? " (gerçek para KAPALI)" : " ⚠ CANLI")],
      ["Kill switch", s.kill_switch ? "🛑 AKTİF" : "kapalı"],
      ["Günlük zarar duraklatması", s.daily_halt ? "⚠ EVET" : "hayır"],
      ["Fiyat kaynağı", (s.last_price_feed || s.price_source)],
      ["Telegram bildirimi", s.telegram_enabled ? "✅ aktif" : "❌ kapalı (.env)"],
      ["LLM gerekçe", s.llm_enabled ? ("✅ aktif · " + (s.llm_model || "LLM")) : "❌ şablon modu (.env)"],
      ["Zamanlayıcı", s.scheduler_running ? "✅ çalışıyor" : "❌ duruyor"],
      ["Son hata", s.scheduler_error || "yok"],
      ["Sunucu saati (UTC)", new Date(s.server_time).toLocaleString("tr-TR")],
    ].map(([k, v]) => `<div><span>${k}</span><span>${esc(String(v))}</span></div>`).join("");
  } catch (e) { console.warn("status:", e); }
}

let _maxOpen = 5;
async function maxOpen() {
  if (_maxOpen === 5) {
    try { const st = await api("GET", "/api/settings");
      _maxOpen = st.settings.max_open_positions.value; } catch (e) {}
  }
  return _maxOpen;
}

async function loadPerfMini() {
  try {
    const m = await api("GET", "/api/metrics");
    const o = m.overall;
    const p = $("#kPnl");
    p.textContent = (o.total_pnl >= 0 ? "+" : "") + fmt(o.total_pnl) + " $";
    p.className = "v " + cls(o.total_pnl);
    $("#kPnlSub").textContent = `isabet ${pct(o.win_rate, 0)} · ${o.trade_count} işlem`;
    $("#kSharpe").textContent = fmt(o.sharpe, 2);
    $("#kSharpeSub").textContent = `MaxDD ${pct(o.max_drawdown, 1)}`;
  } catch (e) {}
}

async function loadEquityChart() {
  try {
    const d = await api("GET", "/api/equity?limit=500");
    const pts = d.curve || [];
    if (!window.__chartReady || !pts.length) return;
    const labels = pts.map(p => new Date(p.ts).toLocaleString("tr-TR",
      { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));
    const data = pts.map(p => p.equity);
    if (equityChart) { equityChart.data.labels = labels;
      equityChart.data.datasets[0].data = data; equityChart.update(); return; }
    equityChart = new Chart($("#equityChart"), {
      type: "line",
      data: { labels, datasets: [{ label: "Portföy (USDT)", data,
        borderColor: "#4f9cf9", backgroundColor: "rgba(79,156,249,.12)",
        fill: true, tension: .25, pointRadius: 0, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#8b98a9" } } },
        scales: { x: { ticks: { color: "#8b98a9", maxTicksLimit: 8 },
                       grid: { color: "#232b3a" } },
                  y: { ticks: { color: "#8b98a9" }, grid: { color: "#232b3a" } } } },
    });
  } catch (e) { console.warn("equity:", e); }
}

async function loadEvents() {
  try {
    const d = await api("GET", "/api/notifications?limit=40");
    $("#eventFeed").innerHTML = (d.notifications || []).map(n =>
      `<div><span class="t">${new Date(n.ts).toLocaleString("tr-TR")} · ${esc(n.kind)}</span><br>${esc(n.message)}</div>`
    ).join("") || "<span class='muted'>henüz olay yok</span>";
  } catch (e) {}
}

async function loadOverviewAssets() {
  try {
    const d = await api("GET", "/api/assets");
    const tb = $("#overviewAssets tbody");
    tb.innerHTML = (d.assets || []).map(a => {
      const s = a.scores || {};
      return `<tr>
        <td><b>${esc(a.symbol)}</b></td><td>${a.price ? fmt(a.price, a.price < 1 ? 4 : 2) : "—"}</td>
        <td>${scoreCell(s.technical, a.sources.technical)}</td>
        <td>${scoreCell(s.onchain, a.sources.onchain)}</td>
        <td>${scoreCell(s.defi, a.sources.defi, (a.defi_evidence || []).join("\n"))}</td>
        <td>${scoreCell(s.risk, a.sources.risk, (a.risk_evidence || []).join("\n"))}</td>
        <td>${scoreCell(s.sentiment, a.sources.sentiment, (a.sentiment_evidence || []).join("\n"))}</td>
        <td>${scoreCell(s.macro, a.sources.macro, (a.macro_evidence || []).join("\n"))}</td>
        <td><b>${fmt(a.final_score, 1)}</b></td>
        <td class="risk-${esc(a.risk_level)}">${esc(a.risk_level || "—")}</td>
        <td>${decisionBadge(a.action)}</td></tr>`;
    }).join("") || "<tr><td colspan=11 class='muted'>veri yok — 'Şimdi Analiz Et' butonuna bas</td></tr>";
  } catch (e) {}
}

/* ================================================================= VARLIKLAR */
async function loadAssets() {
  const d = await api("GET", "/api/assets");
  $("#assetsTable tbody").innerHTML = (d.assets || []).map(a => {
    const s = a.scores || {};
    return `<tr>
      <td><b>${esc(a.symbol)}</b><br><span class="muted">${esc(a.name)}</span></td>
      <td>${esc(a.category)}</td>
      <td>${a.price ? fmt(a.price, a.price < 1 ? 4 : 2) : "—"}</td>
      <td>${scoreCell(s.technical, a.sources.technical)}</td>
      <td>${scoreCell(s.onchain, a.sources.onchain)}</td>
      <td>${scoreCell(s.defi, a.sources.defi, (a.defi_evidence || []).join("\n"))}</td>
      <td>${scoreCell(s.risk, a.sources.risk, (a.risk_evidence || []).join("\n"))}</td>
      <td>${scoreCell(s.sentiment, a.sources.sentiment, (a.sentiment_evidence || []).join("\n"))}</td>
      <td>${scoreCell(s.macro, a.sources.macro, (a.macro_evidence || []).join("\n"))}</td>
      <td><b>${fmt(a.final_score, 1)}</b></td>
      <td class="risk-${esc(a.risk_level)}">${esc(a.risk_level || "—")}</td>
      <td>${decisionBadge(a.action)}</td>
      <td>${a.has_position ? "<span class='badge open'>POZİSYON AÇIK</span>"
            : (a.enabled ? "" : "<span class='badge'>pasif</span>")}</td>
    </tr>`;
  }).join("") || "<tr><td colspan=13 class='muted'>varlık yok</td></tr>";
}

/* =============================================================== POZİSYONLAR */
async function loadPositions() {
  const [o, c] = await Promise.all([
    api("GET", "/api/positions?status=open"),
    api("GET", "/api/positions?status=closed&limit=100")]);
  const eng = await api("GET", "/api/status").catch(() => null);

  $("#openPos tbody").innerHTML = (o.positions || []).map(p => `
    <tr>
      <td><b>${esc(p.symbol)}</b></td><td>${fmt(p.qty, 6)}</td>
      <td>${fmt(p.entry_price, p.entry_price < 1 ? 5 : 2)}
        <br><span class="muted">gerçek: ${fmt(p.exec_entry_price, p.entry_price < 1 ? 5 : 2)}</span></td>
      <td class="muted">${fmt(p.stop_loss, 4)} / ${fmt(p.take_profit, 4)}</td>
      <td>${p.last_price ? fmt(p.last_price, p.entry_price < 1 ? 5 : 2) : "—"}</td>
      <td class="${cls(p.unrealized_pnl)}">${p.unrealized_pnl !== undefined
        ? `${(p.unrealized_pnl >= 0 ? "+" : "") + fmt(p.unrealized_pnl)} (${fmt(p.unrealized_pct, 1)}%)`
        : "—"}</td>
      <td>${fmt(p.final_score, 1)}</td>
      <td class="wrap"><details><summary>gerekçe</summary><pre style="white-space:pre-wrap;font-size:11.5px">${esc(p.rationale)}</pre></details></td>
    </tr>`).join("") || "<tr><td colspan=8 class='muted'>açık pozisyon yok</td></tr>";

  $("#closedPos tbody").innerHTML = (c.positions || []).map(p => `<tr>
      <td><b>${esc(p.symbol)}</b></td>
      <td>${fmt(p.exec_entry_price, p.entry_price < 1 ? 5 : 2)}<br><span class="muted">${p.opened_at ? new Date(p.opened_at).toLocaleString("tr-TR") : ""}</span></td>
      <td>${fmt(p.exit_price, p.entry_price < 1 ? 5 : 2)}<br><span class="muted">${p.closed_at ? new Date(p.closed_at).toLocaleString("tr-TR") : ""}</span></td>
      <td><span class="badge">${esc(p.exit_reason)}</span></td>
      <td class="${cls(p.pnl)}"><b>${(p.pnl >= 0 ? "+" : "") + fmt(p.pnl)}</b></td>
      <td class="muted">${fmt(p.fees)}+${fmt(p.gas)}+${fmt(p.slippage)}</td>
      <td>${fmt(p.final_score, 1)}</td>
      <td class="wrap"><details><summary>gerekçe</summary><pre style="white-space:pre-wrap;font-size:11.5px">${esc(p.rationale)}</pre></details></td>
    </tr>`).join("") || "<tr><td colspan=8 class='muted'>kapanan işlem yok</td></tr>";
}

/* ================================================================== SİNYALLER */
async function loadSignals() {
  const action = $("#sigAction").value, sym = $("#sigSymbol").value.trim().toUpperCase();
  let url = "/api/signals?limit=200";
  if (action) url += "&action=" + action;
  if (sym) url += "&symbol=" + encodeURIComponent(sym);
  const d = await api("GET", url);
  const list = d.signals || [];
  $("#sigCount").textContent = list.length + " kayıt";
  $("#signalList").innerHTML = list.map(s => `
    <div class="sig ${s.rationale ? "" : "norat"}" onclick="this.classList.toggle('open')">
      <div class="head">
        <b>${esc(s.symbol)}</b>
        ${decisionBadge(s.action, s.executed, s.skip_reason)}
        <span class="badge">skor ${fmt(s.final_score, 1)}</span>
        <span class="badge">güven ${pct(s.confidence, 0)}</span>
        <span class="badge">olasılık ${pct(s.probability, 0)} (${pct(s.prob_low, 0)}–${pct(s.prob_high, 0)})</span>
        <span class="badge risk-${esc(s.risk_level)}">risk: ${esc(s.risk_level)}</span>
        <span class="muted">${new Date(s.created_at).toLocaleString("tr-TR")}</span>
        <span class="muted">▸ gerekçe</span>
      </div>
      <div class="rationale">${esc(s.rationale || "(gerekçe yok)")}</div>
    </div>`).join("") || "<span class='muted'>sinyal yok</span>";
}
$("#btnSigFilter").addEventListener("click", loadSignals);

/* ================================================================ PERFORMANS */
async function loadPerformance() {
  const m = await api("GET", "/api/metrics");
  const o = m.overall;
  const p = $("#pPnl");
  p.textContent = (o.total_pnl >= 0 ? "+" : "") + fmt(o.total_pnl) + " $";
  p.className = "v " + cls(o.total_pnl);
  $("#pWin").textContent = pct(o.win_rate, 1);
  $("#pAvg").textContent = `${(o.avg_win >= 0 ? "+" : "") + fmt(o.avg_win)} / -${fmt(o.avg_loss)}`;
  $("#pCount").textContent = o.trade_count;
  $("#pDd").textContent = pct(o.max_drawdown, 2);
  $("#pSharpe").textContent = fmt(o.sharpe, 2);

  $("#stratTable tbody").innerHTML = Object.entries(m.by_strategy || {}).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${v.trade_count}</td><td>${pct(v.win_rate, 1)}</td>
     <td class="${cls(v.total_pnl)}">${fmt(v.total_pnl)}</td>
     <td class="${cls(v.avg_pnl)}">${fmt(v.avg_pnl)}</td><td>${fmt(v.profit_factor)}</td></tr>`
  ).join("") || "<tr><td colspan=6 class='muted'>veri yok</td></tr>";

  $("#exitTable tbody").innerHTML = Object.entries(m.by_exit_reason || {}).map(([k, v]) =>
    `<tr><td><span class="badge">${esc(k)}</span></td><td>${v.trade_count}</td>
     <td>${pct(v.win_rate, 1)}</td><td class="${cls(v.total_pnl)}">${fmt(v.total_pnl)}</td></tr>`
  ).join("") || "<tr><td colspan=4 class='muted'>veri yok</td></tr>";

  const names = { technical: "Piyasa & Teknik", onchain: "On-chain & Akıllı Para",
    defi: "DeFi", risk: "Risk & Güvenlik", sentiment: "Duygu & Haber", macro: "Makro" };
  $("#layerTable tbody").innerHTML = Object.entries(m.by_layer || {}).map(([k, v]) => {
    const w = v.with_signal, wo = v.without_signal;
    const contrib = v.contributes === true ? '<span class="badge open">✅ katkı var</span>'
      : v.contributes === false ? '<span class="badge risk_block">❌ katkı yok</span>'
      : '<span class="badge">örnek yetersiz</span>';
    return `<tr><td><b>${esc(v.label || names[k] || k)}</b></td>
      <td>${w.trade_count} / ${pct(w.win_rate, 0)} / <span class="${cls(w.avg_pnl)}">${fmt(w.avg_pnl)}</span></td>
      <td>${wo.trade_count} / ${pct(wo.win_rate, 0)} / <span class="${cls(wo.avg_pnl)}">${fmt(wo.avg_pnl)}</span></td>
      <td>${contrib} <span class="muted">edge: ${fmt(v.edge_pnl_per_trade)} $/işlem, ${fmt(v.edge_win_rate, 1)} puan isabet</span></td></tr>`;
  }).join("");
}

/* ================================================================== BACKTEST */
$("#btnBacktest").addEventListener("click", async () => {
  const btn = $("#btnBacktest");
  btn.disabled = true;
  $("#btStatus").textContent = "Çalışıyor… (1 yıl × 20 varlık ~1-2 dk sürebilir)";
  try {
    const res = await api("POST", "/api/backtest", {
      days: parseInt($("#btDays").value || "180", 10),
      interval: $("#btInterval").value,
    });
    if (res.error) throw new Error(res.error);
    renderBacktest(res);
    $("#btStatus").textContent = `Tamamlandı (${res.duration_seconds}s, ${res.bars} bar)`;
  } catch (e) {
    $("#btStatus").textContent = "";
    toast("Backtest hatası: " + e.message, true);
  } finally { btn.disabled = false; }
});

function renderBacktest(res) {
  $("#btCards").classList.remove("hidden");
  $("#btPanel").classList.remove("hidden");
  const o = res.metrics.overall;
  const p = $("#btPnl");
  p.textContent = (o.total_pnl >= 0 ? "+" : "") + fmt(o.total_pnl) + " $";
  p.className = "v " + cls(o.total_pnl);
  $("#btWin").textContent = pct(o.win_rate, 1);
  $("#btCount").textContent = o.trade_count;
  $("#btDd").textContent = pct(o.max_drawdown, 2);
  $("#btSharpe").textContent = fmt(o.sharpe, 2);
  $("#btDur").textContent = res.duration_seconds + " sn";

  const curve = res.equity_curve || [];
  if (window.__chartReady && curve.length) {
    const labels = curve.map(c => new Date(c.t).toLocaleDateString("tr-TR",
      { day: "2-digit", month: "2-digit" }));
    const data = curve.map(c => c.equity);
    if (btChart) btChart.destroy();
    btChart = new Chart($("#btChart"), {
      type: "line",
      data: { labels, datasets: [{ label: "Backtest portföy (USDT)", data,
        borderColor: "#3fb950", backgroundColor: "rgba(63,185,80,.10)",
        fill: true, pointRadius: 0, borderWidth: 2, tension: .2 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#8b98a9" } } },
        scales: { x: { ticks: { color: "#8b98a9", maxTicksLimit: 10 },
                       grid: { color: "#232b3a" } },
                  y: { ticks: { color: "#8b98a9" }, grid: { color: "#232b3a" } } } },
    });
  }
  $("#btTrades tbody").innerHTML = (res.trades || []).slice(0, 150).map(t => `
    <tr><td>${esc(t.symbol)}</td>
    <td class="muted">${fmt(t.entry_price, t.entry_price < 1 ? 5 : 2)}</td>
    <td class="muted">${fmt(t.exit_price, t.exit_price < 1 ? 5 : 2)}</td>
    <td><span class="badge">${esc(t.exit_reason)}</span></td>
    <td class="${cls(t.pnl)}"><b>${(t.pnl >= 0 ? "+" : "") + fmt(t.pnl)}</b></td>
    <td>${fmt(t.final_score, 1)}</td></tr>`).join("");
  $("#btWarnings").innerHTML = (res.warnings || []).map(w =>
    `<p class="muted">⚠ ${esc(w)}</p>`).join("");
}

/* =================================================================== CÜZDANLAR */
const WT_LABEL = { smart_money: "akıllı para", individual_whale: "bireysel whale",
  fund: "fon", exchange: "borsa", market_maker: "market maker",
  team_vesting: "ekip/vesting" };

async function loadWallets() {
  try {
    const [d, sm] = await Promise.all([
      api("GET", "/api/wallets"), api("GET", "/api/smart-money").catch(() => ({ signals: [] }))]);
    $("#walletStatus").textContent = "Katman durumu: " + (d.layer_status || "—") +
      (d.last_refresh ? " · son tazeleme: " + new Date(d.last_refresh).toLocaleString("tr-TR") : "");

    $("#walletTable tbody").innerHTML = (d.wallets || []).map(w => `
      <tr style="cursor:pointer" onclick="walletDetail(${w.id})">
      <td><b>${esc(w.label || "—")}</b></td>
      <td class="muted">${esc(w.address.slice(0, 12))}…${esc(w.address.slice(-6))}</td>
      <td><span class="badge ${w.qualifying ? "open" : (w.wallet_type === "exchange" ? "risk_block" : "")}">${esc(WT_LABEL[w.wallet_type] || w.wallet_type)}</span></td>
      <td>${fmt(w.portfolio_usd, 0)} $</td>
      <td>${w.hit_rate !== null && w.hit_rate !== undefined
          ? `<b>${pct(w.hit_rate, 0)}</b> <span class="muted">(${w.signals_hit} sinyal)</span>`
          : "<span class='muted'>değerlendirilmedi</span>"}</td>
      <td><span class="badge ${w.data_source === "etherscan" ? "live" : "mock"}">${esc(w.data_source)}</span></td>
      <td class="muted">${w.last_snapshot_at ? new Date(w.last_snapshot_at).toLocaleTimeString("tr-TR") : "—"}</td>
      <td>${w.is_active ? "✅" : "—"}</td>
      <td onclick="event.stopPropagation()">
        <button class="btn" onclick="walletToggle(${w.id},${w.is_active ? 0 : 1})">${w.is_active ? "pasif" : "aktif"}</button>
        <button class="btn danger" onclick="walletDelete(${w.id})">sil</button></td></tr>`
    ).join("") || "<tr><td colspan=9 class='muted'>cüzdan eklenmedi</td></tr>";

    $("#smTable tbody").innerHTML = (sm.signals || []).map(x => {
      const ev = (x.evidence || []).map(e =>
        `${esc(e.label)} <span class="muted">[${esc(e.type)}] ${fmt(e.net_usd, 0)}$` +
        `${e.hit_rate !== null && e.hit_rate !== undefined ? " · isabet " + pct(e.hit_rate, 0) : ""}</span>`
      ).join("<br>") || "<span class='muted'>birikim yok</span>";
      const ex = (x.excluded || []).map(e => `${esc(e.label)} <span class="muted">[${esc(e.type)}]</span>`).join(", ")
        || "<span class='muted'>—</span>";
      return `<tr><td><b>${esc(x.symbol)}</b></td>
        <td>${fmt(x.score, 1)} <span class="scorebar"><i style="width:${x.score}%;background:${x.score >= 65 ? "#3fb950" : (x.score >= 45 ? "#4f9cf9" : "#f85149")}"></i></span></td>
        <td>${x.strong ? '<span class="badge open">GÜÇLÜ</span>'
              : (x.verdict === "no_data" ? '<span class="badge">veri yok</span>'
                 : '<span class="badge">zayıf/tek</span>')}</td>
        <td class="${cls(x.net_usd)}">${fmt(x.net_usd, 0)} $</td>
        <td class="wrap">${ev}</td>
        <td class="muted wrap">${ex}</td></tr>`;
    }).join("") || "<tr><td colspan=6 class='muted'>sinyal yok — 'Portföyleri Hemen Tazele'ye bas</td></tr>";

    $("#walletActs tbody").innerHTML = (d.recent_activities || []).map(a => {
      const hit = a.detail && a.detail.hit;
      return `<tr><td class="muted">${new Date(a.ts).toLocaleString("tr-TR")}</td>
      <td>${esc(a.label || "#" + a.wallet_id)}</td>
      <td><b>${esc(a.token)}</b></td>
      <td><span class="badge ${a.action === "buy" || a.action === "increase" ? "open" : "risk_block"}">${esc(a.action)}</span></td>
      <td class="${cls(a.qty_usd)}"><b>${fmt(a.qty_usd, 0)} $</b></td>
      <td>${hit ? `<span class="badge ${hit.result === "hit" ? "open" : (hit.result === "miss" ? "risk_block" : "")}">${esc(hit.result)}${hit.return_pct !== undefined ? " (" + fmt(hit.return_pct, 1) + "%)" : ""}</span>` : "<span class='muted'>—</span>"}</td></tr>`;
    }).join("") || "<tr><td colspan=6 class='muted'>hareket yok — tazele</td></tr>";
  } catch (e) { toast("Cüzdanlar yüklenemedi: " + e.message, true); }
}

window.walletDetail = async (id) => {
  try {
    const d = await api("GET", `/api/wallets/${id}/portfolio`);
    const holds = Object.entries(d.holdings || {}).sort((a, b) => b[1] - a[1]);
    $("#walletDetail").innerHTML = `
      <b>${esc(d.wallet.label)}</b> <span class="badge">${esc(WT_LABEL[d.wallet.wallet_type] || d.wallet.wallet_type)}</span>
      — toplam <b>${fmt(d.total_usd, 0)} $</b>
      ${d.snapshot_at ? " · anlık görüntü: " + new Date(d.snapshot_at).toLocaleString("tr-TR") : ""}
      <div class="tablewrap" style="margin-top:8px"><table>
      <thead><tr><th>Token</th><th>USD</th><th>Pay %</th></tr></thead><tbody>
      ${holds.map(([t, v]) => `<tr><td>${esc(t)}</td><td>${fmt(v, 0)}</td>
        <td>${fmt(d.total_usd ? v / d.total_usd * 100 : 0, 1)}</td></tr>`).join("")}
      </tbody></table></div>
      <details><summary>Son hareketler (${(d.activities || []).length})</summary>
      <div class="tablewrap"><table><thead><tr><th>Zaman</th><th>Token</th><th>Hareket</th><th>Delta</th></tr></thead><tbody>
      ${(d.activities || []).map(a => `<tr><td class="muted">${new Date(a.ts).toLocaleString("tr-TR")}</td>
        <td>${esc(a.token)}</td><td><span class="badge">${esc(a.action)}</span></td>
        <td class="${cls(a.qty_usd)}">${fmt(a.qty_usd, 0)} $</td></tr>`).join("")}
      </tbody></table></div></details>`;
  } catch (e) { toast(e.message, true); }
};

$("#btnWalletRefresh").addEventListener("click", async () => {
  const b = $("#btnWalletRefresh"); b.disabled = true;
  try {
    const r = await api("POST", "/api/wallets/refresh");
    toast(`Tazelendi: ${r.wallets} cüzdan, ${r.activities} yeni hareket (kaynak: ${r.source})`);
    loadWallets();
  } catch (e) { toast(e.message, true); }
  finally { b.disabled = false; }
});

$("#btnHitEval").addEventListener("click", async () => {
  const b = $("#btnHitEval"); b.disabled = true;
  try {
    const r = await api("POST", "/api/wallets/refresh?evaluate_hits=true");
    const h = r.hit_eval || {};
    toast(h.skipped ? "Bugün zaten değerlendirildi: " + (h.reason || "")
      : `İsabet: ${h.hit || 0} isabetli, ${h.miss || 0} isabetsiz, ${h.neutral || 0} nötr, ${h.no_data || 0} verisiz`);
    loadWallets();
  } catch (e) { toast(e.message, true); }
  finally { b.disabled = false; }
});

$("#btnAddWallet").addEventListener("click", async () => {
  const address = $("#wAddress").value.trim();
  if (!address) return toast("Adres gir", true);
  try {
    await api("POST", "/api/wallets", { address, label: $("#wLabel").value.trim(),
      wallet_type: $("#wType").value });
    $("#wAddress").value = ""; $("#wLabel").value = "";
    loadWallets(); toast("Cüzdan eklendi");
  } catch (e) { toast(e.message, true); }
});
window.walletToggle = async (id, active) => {
  try { await api("PATCH", "/api/wallets/" + id, { is_active: !!active }); loadWallets(); }
  catch (e) { toast(e.message, true); }
};
window.walletDelete = async (id) => {
  if (!confirm("Bu cüzdan takip listesinden silinsin mi?")) return;
  try { await api("DELETE", "/api/wallets/" + id); loadWallets(); }
  catch (e) { toast(e.message, true); }
};

/* =================================================================== AYARLAR */
const SET_GROUPS = [
  ["Sanal İşlem & Bakiye", ["trading_mode", "live_trading_enabled", "start_balance", "cycle_seconds"]],
  ["Gerçekçilik: Ücret / Slippage / Gas", ["fee_rate", "slippage_rate", "gas_per_trade", "min_notional"]],
  ["Pozisyon Büyüklüğü & Risk Kuralları",
    ["max_position_pct", "max_open_positions", "daily_max_loss_pct",
     "stop_loss_pct", "take_profit_pct", "adaptive_tp", "risk_min_score"]],
  ["Katman Ağırlıkları (AI birleştirmesi)",
    ["w_technical", "w_onchain", "w_defi", "w_risk", "w_sentiment", "w_macro"]],
  ["Karar Eşikleri & Teyit Kuralları",
    ["entry_threshold", "exit_threshold", "technical_min",
     "confirmations_required", "confirmation_score"]],
  ["Veri Kaynakları & Backtest",
    ["price_source", "risk_source", "defi_source", "sentiment_source",
     "macro_source", "http_timeout", "max_retries", "cache_ttl",
     "backtest_days", "backtest_interval"]],
  ["Özet Raporlama (UTC)", ["summary_hour", "weekly_summary_weekday"]],
  ["Sistem", ["app_host", "app_port", "log_level", "database_url"]],
];
const ENUMS = {
  price_source: ["auto", "mock", "binance", "coingecko"],
  risk_source: ["auto", "live", "mock"],
  defi_source: ["auto", "live", "mock", "off"],
  sentiment_source: ["auto", "live", "mock", "off"],
  macro_source: ["auto", "live", "mock", "off"],
  backtest_interval: ["1h", "4h", "1d"],
  log_level: ["DEBUG", "INFO", "WARNING", "ERROR"],
  trading_mode: ["paper"],
};
const LABELS = {
  trading_mode: ["İşlem modu", "paper = sanal; canlı mod Ayarlar'daki Binance kartından açılır (.env: TRADING_MODE)"],
  live_trading_enabled: ["Canlı işlem (KORUMALI)", "Sadece .env'den değiştirilebilir"],
  start_balance: ["Başlangıç sanal bakiyesi (USDT)", "Sıfırlama butonunda kullanılır"],
  cycle_seconds: ["Çevrim sıklığı (saniye)", "300 = 5 dakikada bir analiz+karar"],
  fee_rate: ["Komisyon oranı (işlem başına)", "0.0012 = %0.12 (kötümser)"],
  slippage_rate: ["Slippage (kötümser)", "0.0035 = %0.35 fiyat kayması"],
  gas_per_trade: ["Gas maliyeti (USDT/işlem)", "DeFi/ağ maliyeti benzetimi"],
  min_notional: ["Minimum işlem tutarı (USDT)", ""],
  max_position_pct: ["Tek varlya maks sermaye oranı", "0.10 = portföyün %10'u"],
  max_open_positions: ["Maks eşzamanlı açık pozisyon", ""],
  daily_max_loss_pct: ["Günlük maks zarar limiti", "Aşılırsa giriş durur + bildirim"],
  stop_loss_pct: ["Stop-loss (%)", "taban değer — SL girişte varlığa göre kesinleşir"],
  take_profit_pct: ["Take-profit (%)", "taban değer — TP girişte varlığa göre kesinleşir"],
  adaptive_tp: ["Akıllı TP/SL (Faz 8)", "Açıkken TP/SL volatilite + güven + balina sinyali + risk'e göre hesaplanır; TP açık pozisyonda yalnızca yukarı revize edilir"],
  risk_min_score: ["Güvenlik skoru eşiği (RİSK FİLTRESİ)", "Altında kesinlikle işlem yok"],
  w_technical: ["Ağırlık: Teknik", ""], w_onchain: ["Ağırlık: On-chain/Akıllı para", ""],
  w_defi: ["Ağırlık: DeFi", ""], w_risk: ["Ağırlık: Risk & Güvenlik", ""],
  w_sentiment: ["Ağırlık: Duygu", ""], w_macro: ["Ağırlık: Makro", ""],
  entry_threshold: ["Giriş skor eşiği", ""],
  exit_threshold: ["Çıkış skor eşiği", "Altında açık pozisyon kapatılır"],
  technical_min: ["Teknik minimum (giriş için)", "Akıllı para tek başına açtıramaz"],
  confirmations_required: ["Gerekli teyit katmanı sayısı", "≥ eşiğinde olan katmanlardan"],
  confirmation_score: ["Teyit skor eşiği", "Karşılaştırma raporunda da kullanılır"],
  price_source: ["Fiyat kaynağı", "auto: halka açık API → mock"],
  risk_source: ["Risk/güvenlik kaynağı (Faz 4)", "auto: DefiLlama+GoPlus canlı → mock"],
  defi_source: ["DeFi metrik kaynağı (Faz 3)", "auto: DefiLlama canlı; off = katman devre dışı"],
  sentiment_source: ["Duygu/haber kaynağı (Faz 5)", "auto: Google News+FNG+trend canlı; off = devre dışı"],
  macro_source: ["Makro kaynağı (Faz 6)", "auto: CoinGecko+stablecoin+ECB canlı; off = devre dışı"],
  http_timeout: ["HTTP zaman aşımı (sn)", ""], max_retries: ["Yeniden deneme hakkı", ""],
  cache_ttl: ["Önbellek süresi (sn)", ""],
  backtest_days: ["Varsayılan backtest gün sayısı", ""],
  backtest_interval: ["Backtest zaman dilimi", ""],
  summary_hour: ["Günlük özet saati", "UTC"],
  weekly_summary_weekday: ["Haftalık özet günü", "0=Pzt … 6=Cmt"],
  app_host: ["Sunucu host", ".env ile de değiştirilebilir"],
  app_port: ["Sunucu portu", ""],
  log_level: ["Log seviyesi", ""],
  database_url: ["Veritabanı URL (KORUMALI)", "SQLite → PostgreSQL taşınması buradan"],
};

let _settings = null;
async function loadSettings() {
  const [sd, ad] = await Promise.all([api("GET", "/api/settings"), api("GET", "/api/assets")]);
  _settings = sd.settings;
  renderSettings();
  renderAssetMgr(ad.assets || []);
  loadBinance();
}

function renderSettings() {
  const host = $("#settingsGroups");
  host.innerHTML = "";
  const shown = new Set();
  SET_GROUPS.forEach(([title, keys]) => {
    const rows = keys.filter(k => _settings[k]).map(k => settingRow(k)).join("");
    if (!rows) return;
    keys.forEach(k => shown.add(k));
    const div = document.createElement("div");
    div.className = "sgroup";
    div.innerHTML = `<h4>${esc(title)}</h4>` + rows;
    host.appendChild(div);
  });
  // grupsuz kalanlar (sırlar hariç)
  const rest = Object.keys(_settings).filter(k => !shown.has(k)
    && !/token|api_key|_key$/.test(k));
  if (rest.length) {
    const div = document.createElement("div");
    div.className = "sgroup";
    div.innerHTML = `<h4>Diğer</h4>` + rest.map(k => settingRow(k)).join("");
    host.appendChild(div);
  }
  const sec = document.createElement("div");
  sec.className = "sgroup";
  sec.innerHTML = `<h4>Gizli anahtarlar — sadece .env üzerinden yönetilir</h4>
    <div class="srow"><div class="lbl">TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID<br>
      <small>Bildirim için .env'e ekleyin</small></div>
      <div class="prot" id="tgState">…</div><div></div></div>
    <div class="srow"><div class="lbl">OPENAI_API_KEY<br>
      <small>LLM gerekçe üretimi için (yoksa şablon)</small></div>
      <div class="prot" id="llmState">…</div><div></div></div>`;
  host.appendChild(sec);
  api("GET", "/api/status").then(s => {
    $("#tgState").textContent = s.telegram_enabled ? "✅ bağlı" : "❌ boş";
    $("#llmState").textContent = s.llm_enabled ? "✅ bağlı" : "❌ boş";
  }).catch(() => {});
}

function settingRow(k) {
  const it = _settings[k];
  const [label, hint] = LABELS[k] || [k, ""];
  let control;
  if (it.protected) {
    control = `<span class="prot">🔒 korumalı: ${esc(String(it.value))}</span>`;
  } else if (typeof it.value === "boolean") {
    control = `<input type="checkbox" data-key="${k}" ${it.value ? "checked" : ""}>`;
  } else if (ENUMS[k]) {
    control = `<select data-key="${k}">${ENUMS[k].map(o =>
      `<option ${String(it.value) === o ? "selected" : ""}>${o}</option>`).join("")}</select>`;
  } else if (typeof it.value === "number") {
    const [lo, hi] = it.range || [0, 1e12];
    const step = Number.isInteger(it.value) ? 1 : (Math.abs(it.value) < 1 ? 0.0001 : 0.01);
    control = `<input type="number" data-key="${k}" value="${it.value}"
      step="${step}" min="${lo}" max="${hi}">`;
  } else {
    control = `<input type="text" data-key="${k}" value="${esc(String(it.value))}">`;
  }
  return `<div class="srow"><div class="lbl">${esc(label)}<small>${esc(hint)}</small></div>
    <div>${control}</div><div class="muted">${esc(k)}${it.override ? " · (DB override)" : ""}</div></div>`;
}

$("#btnSaveSettings").addEventListener("click", async () => {
  const values = {};
  $$("#settingsGroups [data-key]").forEach(el => {
    const k = el.dataset.key;
    if (!_settings[k] || _settings[k].protected) return;
    if (el.type === "checkbox") values[k] = el.checked;
    else if (el.type === "number") values[k] = parseFloat(el.value);
    else values[k] = el.value;
  });
  try {
    const r = await api("PUT", "/api/settings", { values });
    const msg = `Kaydedildi: ${Object.keys(r.saved).length} ayar` +
      (r.errors.length ? ` · hatalar: ${r.errors.join(", ")}` : "");
    $("#setMsg").textContent = msg;
    toast(r.errors.length ? msg : "Ayarlar kaydedildi ✅", !!r.errors.length);
    loadSettings();
  } catch (e) { toast("Ayar kaydedilemedi: " + e.message, true); }
});
$("#btnReloadSettings").addEventListener("click", loadSettings);

/* ================================================== BINANCE / CANLI MOD */
async function loadBinance() {
  const el = $("#bnStatus");
  if (!el) return;
  try {
    const s = await api("GET", "/api/binance/status");
    const bits = [`anahtar: ${s.key_present && s.secret_present ? "✅ var" : "❌ yok"}`,
      `mod: ${s.mode}${s.live_enabled ? " · 🔴 CANLI" : " · sanal"}`,
      s.testnet ? "testnet (kağıt para)" : "gerçek borsa"];
    if (s.connected === true) bits.push(`bakiye: ${fmt(s.usdt_free)} USDT ✅`);
    if (s.connected === false) bits.push(`❌ ${s.error || "bağlantı yok"}`);
    el.textContent = bits.join(" · ");
    el.style.color = s.live_enabled ? "#ff8a8a" : "";
  } catch (e) { el.textContent = "Binance durumu alınamadı: " + e.message; }
}

$("#btnBnSetup").addEventListener("click", async () => {
  const key = $("#bnKey").value.trim(), secret = $("#bnSecret").value.trim();
  if (!key || !secret) return toast("API key ve secret birlikte girilmeli", true);
  const testnet = $("#bnTestnet").checked;
  const msg = testnet
    ? "TESTNET (kağıt para) moduna bağlanacak ve CANLI MOD açılacak.\nDevam?"
    : "⚠ GERÇEK BORSA: canlı mod açılacak, emirler GERÇEK PARAYLA verilecek!\nDevam?";
  if (!confirm(msg)) return;
  const b = $("#btnBnSetup"); b.disabled = true; b.textContent = "Doğrulanıyor…";
  try {
    const r = await api("POST", "/api/binance/setup",
      { api_key: key, api_secret: secret, testnet, enable_live: true });
    toast(`Binance bağlandı ✅ USDT: ${fmt(r.usdt_free)} · mod: ${r.mode}`);
    $("#bnKey").value = ""; $("#bnSecret").value = "";
    loadBinance(); refreshStatus();
  } catch (e) { toast("Binance hatası: " + e.message, true); }
  finally { b.disabled = false; b.textContent = "🔑 Anahtarları Kaydet & Canlı Modu Aç"; }
});

$("#btnBnCheck").addEventListener("click", async () => {
  try {
    const s = await api("GET", "/api/binance/status?check=1");
    toast(s.connected ? `Bağlı ✅ USDT: ${fmt(s.usdt_free)}`
      : `Başarısız: ${s.error || "anahtar yok"}`, !s.connected);
    loadBinance();
  } catch (e) { toast(e.message, true); }
});

$("#btnBnDisable").addEventListener("click", async () => {
  if (!confirm("Canlı mod kapatılsın mı?\n\n• Sistem kağıt moda döner\n• " +
    "Borsadaki GERÇEK varlıklar SATILMADI — onları manuel yönetmelisin")) return;
  try {
    await api("POST", "/api/binance/disable", {});
    toast("Canlı mod kapatıldı — kağıt moda dönüldü ✅");
    loadBinance(); refreshStatus();
  } catch (e) { toast(e.message, true); }
});

function renderAssetMgr(list) {
  $("#assetMgr tbody").innerHTML = list.map(a => `
    <tr><td><b>${esc(a.symbol)}</b></td><td>${esc(a.category)}</td>
    <td><input type="checkbox" ${a.enabled ? "checked" : ""}
      onchange="assetToggle('${esc(a.symbol)}', this.checked)"></td>
    <td><button class="btn danger" onclick="assetDelete('${esc(a.symbol)}')">sil</button></td></tr>`
  ).join("");
}
$("#btnAddAsset").addEventListener("click", async () => {
  const symbol = $("#aSymbol").value.trim().toUpperCase();
  if (!symbol) return toast("Sembol gir", true);
  try {
    await api("POST", "/api/assets", { symbol, name: $("#aName").value.trim(),
      category: $("#aCat").value });
    $("#aSymbol").value = ""; $("#aName").value = "";
    loadSettings(); toast(symbol + " eklendi");
  } catch (e) { toast(e.message, true); }
});
window.assetToggle = async (symbol, enabled) => {
  try { await api("PUT", "/api/assets", { symbol, enabled }); toast(symbol + (enabled ? " aktif" : " pasif")); }
  catch (e) { toast(e.message, true); }
};
window.assetDelete = async (symbol) => {
  if (!confirm(symbol + " takip listesinden silinsin mi? (geçmiş işlemler korunur)")) return;
  try { await api("DELETE", "/api/assets/" + symbol); loadSettings(); }
  catch (e) { toast(e.message, true); }
};

/* ============================================================ SİSTEM BUTONLARI */
$("#btnCycle").addEventListener("click", async () => {
  const b = $("#btnCycle"); b.disabled = true; b.textContent = "Analiz ediliyor…";
  try {
    const r = await api("POST", "/api/system/cycle");
    const ev = (r.events || []).map(e => e.message).join(" | ");
    toast(`Çevrim bitti: ${r.opened} giriş, ${r.closed} çıkış, ${r.decisions} karar` +
      (ev ? " — " + ev.slice(0, 200) : ""));
    loadOverview();
  } catch (e) { toast("Çevrim hatası: " + e.message, true); }
  finally { b.disabled = false; b.textContent = "▶ Şimdi Analiz Et"; }
});

$("#btnKill").addEventListener("click", async () => {
  if (!confirm("🛑 KILL SWITCH:\n\n• Tüm sistem durdurulacak\n• Açık TÜM sanal pozisyonlar kapatılacak\n• Yeni işlem açılmayacak\n\nDevam?")) return;
  try {
    const r = await api("POST", "/api/system/kill-switch", { enable: true });
    toast(`Kill switch aktif — ${r.closed} pozisyon kapatıldı, bakiye ${fmt(r.equity)} $`);
    loadOverview();
  } catch (e) { toast(e.message, true); }
});

$("#btnResume").addEventListener("click", async () => {
  try {
    await api("POST", "/api/system/resume");
    toast("Sistem normale döndürüldü ▶");
    refreshStatus();
  } catch (e) { toast(e.message, true); }
});

$("#btnReset").addEventListener("click", async () => {
  const v = prompt("Sanal bakiyeyi kaç USDT olarak sıfırlayalım?", "10000");
  if (v === null) return;
  const balance = parseFloat(v);
  if (isNaN(balance) || balance <= 0) return toast("Geçersiz bakiye", true);
  if (!confirm(`Açık pozisyonlar kapatılıp bakiye ${balance} USDT olacak. Emin misin?`)) return;
  try {
    const r = await api("POST", "/api/system/reset", { balance });
    toast(`Sıfırlandı: bakiye ${fmt(r.cash)} $, ${r.closed_positions} pozisyon kapatıldı`);
    loadOverview();
  } catch (e) { toast(e.message, true); }
});

/* ==================================================================== BAŞLANGIÇ */
loadOverview();
setInterval(() => {
  refreshStatus();
  if ($("#tab-overview").classList.contains("active")) {
    loadEquityChart(); loadEvents(); loadOverviewAssets(); loadPerfMini();
  }
}, 20000);
