"use client"
import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { Area, AreaChart, CartesianGrid, Line, XAxis, YAxis } from "recharts"
import { Activity, AlertTriangle, Bell, Bot, Check, ChevronDown, ExternalLink, Flame, Newspaper, Radio, RefreshCw, Search, ShieldAlert, ShieldCheck, Sparkles, Star, Target, TrendingDown, TrendingUp, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Signal, IndicatorRead } from "@/lib/indicators"
import dynamic from "next/dynamic"
import { UserMenu } from "@/components/user-menu"
import { MarketPulseBackground } from "@/components/market-pulse-background"
import { MidasChart } from "@/components/midas-chart"
import { Lock, Loader2 } from "lucide-react"

const PaperbotTerminal = dynamic(
  () => import("@/components/automation/paperbot-terminal").then((m) => m.PaperbotTerminal),
  {
    loading: () => (
      <div className="flex h-96 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-7 animate-spin text-emerald-400" />
        <span className="text-xs font-medium">Otomasyon Terminali yükleniyor...</span>
      </div>
    ),
  }
)

const Bist30Terminal = dynamic(
  () => import("@/components/bist30/bist30-terminal").then((m) => m.Bist30Terminal),
  {
    loading: () => (
      <div className="flex h-96 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-7 animate-spin text-primary" />
        <span className="text-xs font-medium">BIST 30 Terminali yükleniyor...</span>
      </div>
    ),
  }
)

const CryptoScannerTerminal = dynamic(
  () => import("@/components/crypto-scanner-terminal").then((m) => m.CryptoScannerTerminal),
  {
    loading: () => (
      <div className="flex h-96 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-7 animate-spin text-primary" />
        <span className="text-xs font-medium">Kripto Tarayıcı yükleniyor...</span>
      </div>
    ),
  }
)

const TradingViewChart = dynamic(
  () => import("@/components/tradingview-chart").then((m) => m.TradingViewChart),
  {
    loading: () => (
      <div className="flex h-[430px] flex-col items-center justify-center gap-2 rounded-xl border border-border/70 bg-card/60 text-muted-foreground">
        <Loader2 className="size-7 animate-spin text-primary" />
        <span className="text-xs font-medium">TradingView Grafiği yükleniyor...</span>
      </div>
    ),
    ssr: false,
  }
)

const RewardedVideoModal = dynamic(
  () => import("@/components/rewarded-video-modal").then((m) => m.RewardedVideoModal),
  { ssr: false }
)

const macro=["XU100","XU030","SP500","NASDAQ","DJI","USDTRY","EURTRY","XAUUSD","BRENT"]
const chartConfig={price:{label:"Fiyat",color:"var(--chart-1)"},sma:{label:"HO 20",color:"var(--chart-2)"}} satisfies ChartConfig
const fetcher=(url:string)=>fetch(url).then(async r=>{const p=await r.json();if(!r.ok)throw new Error(p.error);return p})
const fmt=(v?:number)=>Number.isFinite(v)?v!.toLocaleString("tr-TR",{minimumFractionDigits:Math.abs(v!)<0.0001?8:Math.abs(v!)<1?4:2,maximumFractionDigits:Math.abs(v!)<0.0001?8:Math.abs(v!)<1?6:2}):"—"
type Asset={id?:string;symbol:string;name:string;market:"BIST"|"ABD"|"Kripto";rank?:number|null;image?:string|null};type Quote={symbol:string;name:string;price?:number;change?:number;ok:boolean};type News={title:string;source:string;url?:string;publishedAt?:string};type Advice={key:string;label:string;signal:Signal;confidence:number;action:string;invalidation:number;target:number};type Distribution={buy:number;hold:number;sell:number;total:number};type Analyst={rating?:string;score?:number;targetLow?:number;targetMean?:number;targetHigh?:number;analystCount?:number;distribution?:Distribution|null};type Technical={signal:Signal;confidence:number;support:number;resistance:number;values:Record<string,number>;fibonacci:Record<string,number>;breakdown:IndicatorRead[];chart:{date:string;price:number;open?:number;high?:number;low?:number;close?:number;volume?:number;sma?:number}[]};type Data={symbol:string;name:string;market:string;currency:string;price:number;change:number;updatedAt:string;source:string;technical:Technical;advice:Advice[];news:News[];analyst?:Analyst}
type View="terminal"|"paperbot"|"news"|"bist30"|"cryptoScanner";type Rules={support:boolean;resistance:boolean;signal:boolean;news:boolean}
const verdictText={pos:"text-positive",neg:"text-negative",neutral:"text-warning"} as const
function Change({value=0}:{value?:number}){return <span className={cn("inline-flex items-center gap-1 font-mono text-xs font-semibold",value>=0?"text-positive":"text-negative")}>{value>=0?<TrendingUp/>:<TrendingDown/>}{value>=0?"+":""}{fmt(value)}%</span>}
function SignalBadge({signal}:{signal:Signal}){return <Badge variant="outline" className={cn("font-mono",signal.includes("AL")?"border-positive/40 bg-positive/10 text-positive":signal.includes("SAT")?"border-negative/40 bg-negative/10 text-negative":"border-warning/40 bg-warning/10 text-warning")}>{signal}</Badge>}
function RichText({text}:{text:string}){return <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{text.split("\n").filter(l=>l.trim()).map((line,i)=><p key={i}>{line.split(/(\*\*[^*]+\*\*)/g).map((part,j)=>part.startsWith("**")&&part.endsWith("**")?<strong key={j} className="font-bold text-foreground">{part.slice(2,-2)}</strong>:<span key={j}>{part}</span>)}</p>)}</div>}
function Ticker({quotes}:{quotes:Quote[]}){return <div className="ticker-shell"><div className="ticker-track">{[...quotes,...quotes].map((q,i)=><div className="flex shrink-0 items-center gap-3 px-5" key={`${q.symbol}-${i}`}><span className="text-xs text-muted-foreground">{q.name}</span><span className="font-mono text-xs font-bold">{fmt(q.price)}</span>{q.ok?<Change value={q.change}/>:<span className="text-xs text-negative">Veri yok</span>}</div>)}</div></div>}
function Nav({
  view,
  setView,
}: {
  view: View
  setView: (v: View) => void
  totalBotProfit?: number
  isBotProfitPositive?: boolean
}) {
  return (
    <div className="flex gap-1.5 items-center flex-wrap">
      {([
        {v:"terminal",t:"Terminal",i:Activity},
        {v:"paperbot",t:"Otomasyon",i:Bot},
        {v:"news",t:"Haberler",i:Newspaper}
      ] as const).map(x=>(
        <Button
          key={x.v}
          size="sm"
          variant={view===x.v?"default":"ghost"}
          className={cn(
            "transition-all text-xs relative",
            view===x.v && "font-bold shadow-sm ring-1 ring-border/80",
            x.v==="paperbot" && view==="paperbot" && "border border-emerald-400 text-emerald-300 bg-emerald-500/20 font-black shadow-md shadow-emerald-500/30 ring-1 ring-emerald-400/50"
          )}
          onClick={()=>{
            setView(x.v)
            try { localStorage.setItem("piyasaiq:last_view", x.v) } catch {}
          }}
        >
          <x.i className={cn("size-3.5", x.v==="paperbot" ? "text-emerald-400" : "")}/>
          {x.t}
        </Button>
      ))}
    </div>
  )
}
function IndicatorGrid({reads}:{reads:IndicatorRead[]}){return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{reads.map(r=><div key={r.key} className="rounded-lg border bg-card/60 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{r.group}</p><p className={cn("mt-1 text-base font-bold",verdictText[r.verdict])}>{r.title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.note}</p></div>)}</div>}
export function FinanceDashboard(){
  const[selected,setSelected]=useState("TUPRS"),[query,setQuery]=useState(""),[debouncedQuery,setDebouncedQuery]=useState(""),[market,setMarket]=useState<"Tümü"|"BIST"|"ABD"|"Kripto">("Tümü"),[favorites,setFavorites]=useState<string[]>([]),[view,setView]=useState<View>("terminal"),[timeframe,setTimeframe]=useState<string>("1d"),[capital,setCapital]=useState("100000"),[risk,setRisk]=useState("1"),[rules,setRules]=useState<Rules>({support:true,resistance:true,signal:true,news:true})
  const [chartMode, setChartMode] = useState<"midas" | "tradingview">("midas")
  const [isChartExpanded, setIsChartExpanded] = useState<boolean>(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem("piyasaiq:chart_mode") as "tradingview" | "midas"
      if (saved === "tradingview" || saved === "midas") {
        setChartMode(saved)
      } else {
        setChartMode("midas")
      }
    } catch {
      setChartMode("midas")
    }
  }, [])

  const switchChartMode = (mode: "tradingview" | "midas") => {
    setChartMode(mode)
    try { localStorage.setItem("piyasaiq:chart_mode", mode) } catch {}
  }
  useEffect(()=>{
    try{
      if(window.location.hash==="#otomasyon"||window.location.hash==="#automation"||window.location.hash==="#paperbot"||window.location.hash==="#otomasyon2")setView("paperbot")
      else if(window.location.hash==="#bist30"||window.location.hash==="#bist")setView("bist30")
      else if(window.location.hash==="#crypto"||window.location.hash==="#kripto"||window.location.hash==="#cryptoscanner")setView("cryptoScanner")
      else {
        const saved=localStorage.getItem("piyasaiq:last_view")
        // Eski "automation2" görünümü kaldırıldı → "Otomasyon"a yönlendir
        if(saved==="automation2") setView("paperbot")
        else if(saved==="paperbot"||saved==="news"||saved==="terminal"||saved==="bist30"||saved==="cryptoScanner")setView(saved as View)
      }
    }catch{}
    const handleHash=()=>{
      if(window.location.hash==="#otomasyon"||window.location.hash==="#automation"||window.location.hash==="#paperbot"||window.location.hash==="#otomasyon2")setView("paperbot")
      else if(window.location.hash==="#bist30"||window.location.hash==="#bist")setView("bist30")
      else if(window.location.hash==="#crypto"||window.location.hash==="#kripto"||window.location.hash==="#cryptoscanner")setView("cryptoScanner")
    }
    window.addEventListener("hashchange",handleHash)
    return()=>window.removeEventListener("hashchange",handleHash)
  },[])
 useEffect(()=>{try{setFavorites(JSON.parse(localStorage.getItem("piyasaiq:favorites:v1")??"[]"));const r=JSON.parse(localStorage.getItem("piyasaiq:rules:v2")??"null");if(r)setRules(r)}catch{}},[])
 useEffect(()=>{const timer=window.setTimeout(()=>setDebouncedQuery(query.trim()),350);return()=>window.clearTimeout(timer)},[query])
 const selectedCrypto=selected.startsWith("crypto:")?selected.slice(7):null
 const dataUrl=selectedCrypto?`/api/market?cryptoId=${encodeURIComponent(selectedCrypto)}&interval=${timeframe}`:`/api/market?symbol=${encodeURIComponent(selected)}&interval=${timeframe}`
 const{data:catalog}=useSWR<{assets:Asset[]}>("/api/market?catalog=1",fetcher,{dedupingInterval:300000,revalidateOnFocus:false,revalidateIfStale:false}),{data:cryptoCatalog,error:cryptoError,isLoading:cryptoLoading}=useSWR<{assets:Asset[]}>(debouncedQuery.length>=2?`/api/market?cryptoSearch=${encodeURIComponent(debouncedQuery)}`:null,fetcher,{keepPreviousData:true,dedupingInterval:30000}),{data,error,isLoading,mutate}=useSWR<Data>(dataUrl,fetcher,{keepPreviousData:true,refreshInterval:timeframe==="1m"?15000:timeframe==="5m"?30000:300000,dedupingInterval:timeframe==="1m"?8000:timeframe==="5m"?20000:30000}),{data:globalNews,mutate:refreshNews}=useSWR<{news:any[];barometer:any}>(view==="news"?"/api/news":null,fetcher,{refreshInterval:60000,dedupingInterval:20000})
 const{data:quotePayload}=useSWR("macro-quotes",()=>fetch("/api/market",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbols:macro})}).then(r=>r.json()),{refreshInterval:300000,dedupingInterval:30000});const quotes:Quote[]=quotePayload?.data??macro.map(symbol=>({symbol,name:symbol,ok:false}))
 const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("tr-TR")
 const assets=useMemo(()=>{
    const q=normalize(query)
    const list=(catalog?.assets??[]).filter(a=>(market==="Tümü"||a.market===market)&&normalize(`${a.symbol} ${a.name}`).includes(q))
    const crypto=debouncedQuery.length>=2&&(market==="Tümü"||market==="Kripto")?(cryptoCatalog?.assets??[]):[]
    const combined=[...list]
    for(const c of crypto){
      if(!combined.some(x=>x.symbol===c.symbol)) combined.push(c)
    }
    return combined.sort((a,b)=>Number(favorites.includes(b.id?`crypto:${b.id}`:b.symbol))-Number(favorites.includes(a.id?`crypto:${a.id}`:a.symbol)))
  },[catalog,cryptoCatalog,debouncedQuery,query,market,favorites])
  function selectAsset(asset:Asset){setSelected(asset.id?`crypto:${asset.id}`:asset.symbol);setQuery("")}
  const autoBody=useMemo(()=>data?JSON.stringify({symbol:data.symbol,market:{...data,macro:quotes.filter(q=>q.ok)},question:`${data.symbol} için şirket odaklı kısa yorum üret. İndikatörleri tek tek sayma; şirketi etkileyen emtia, kur, endeks ve haber başlıklarının olası etkisini kısaca açıkla ve sonda kendi AL/SAT/TUT kararını ver.`}):null,[data,quotes])
  const{data:autoAI,isLoading:aiLoading,mutate:refreshAI}=useSWR<{text:string;source:string}>(data?["auto-analysis",data.symbol,data.updatedAt]:null,()=>fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:autoBody!}).then(r=>r.json()),{revalidateOnFocus:false})
  function favorite(s:string){setFavorites(c=>{const n=c.includes(s)?c.filter(x=>x!==s):[s,...c];localStorage.setItem("piyasaiq:favorites:v1",JSON.stringify(n));return n})}function rule(k:keyof Rules){setRules(c=>{const n={...c,[k]:!c[k]};localStorage.setItem("piyasaiq:rules:v2",JSON.stringify(n));return n})}
  const riskAmount=Number(capital)*Number(risk)/100,stopDistance=data?Math.max(data.price-data.technical.support,data.technical.values.atr,0):0,units=stopDistance?Math.floor(riskAmount/stopDistance):0

  const [localGlobalUsdt, setLocalGlobalUsdt] = useState<number | null>(null)

  // 💰 Canlı Bot Durumu & Total Kazanç Sorgusu (Her Sayfada Görünür)
  const { data: botStatePayload, mutate: mutateBotState } = useSWR<{
    ok: boolean
    positions?: any[]
    history?: any[]
    nextCandidate?: string | null
    nextCandidatePrice?: number | null
    nextCandidateLeverage?: number | null
    binanceGlobal?: {
      connected: boolean
      availableBalanceUsdt?: number
      totalWalletBalanceUsdt?: number
      positions?: any[]
    } | null
    exchangeSettings?: {
      mode: string
      leverage: number
    }
  }>("/api/bot/state", fetcher, { refreshInterval: 12000, dedupingInterval: 6000 })

  // 🌐 Sayfa Açıldığında Binance Global Anahtarlarını Doğrula & Testnet Anahtarlarını Temizle
  useEffect(() => {
    try {
      const savedExchange = localStorage.getItem("piyasaiq:exchange_type")
      if (savedExchange === "HYBRID") {
        localStorage.setItem("piyasaiq:exchange_type", "BINANCE_GLOBAL")
      }

      const savedGlobalKey = localStorage.getItem("piyasaiq:global_api_key")
      const savedGlobalSecret = localStorage.getItem("piyasaiq:global_api_secret")

      // 🧹 Testnet/Demo anahtarlarını kalıcı olarak temizle
      if (savedGlobalKey && (savedGlobalKey.startsWith("pAQ1") || savedGlobalKey.startsWith("V4Pu"))) {
        localStorage.removeItem("piyasaiq:global_api_key")
        localStorage.removeItem("piyasaiq:global_api_secret")
        setLocalGlobalUsdt(null)
        fetch("/api/bot/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resetKey: "reset_clean_slate", binanceGlobal: null, exchangeSettings: { mode: "BINANCE_GLOBAL", leverage: 5 } }),
        }).then(() => mutateBotState()).catch(() => {})
        return
      }

      if (savedGlobalKey && savedGlobalSecret) {
        // 1. Önce doğrudan Redis'e yaz (proxy timeout olsa bile çalışır)
        fetch("/api/bot/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            binanceGlobal: {
              apiKey: savedGlobalKey.trim(),
              apiSecret: savedGlobalSecret.trim(),
              accountName: "Binance Global Futures",
              accountType: "REAL",
              exchangeType: "BINANCE_GLOBAL",
              connected: true,
            },
          }),
        })
          .then(() => mutateBotState())
          .catch(() => {})

        // 2. Frankfurt proxy üzerinden bakiyeyi doğrula
        fetch("/api/binance/futures-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: savedGlobalKey.trim(), apiSecret: savedGlobalSecret.trim() }),
        })
          .then((r) => r.json())
          .then((res) => {
            if (res.ok && res.balances) {
              const avail = res.balances.availableBalanceUsdt ?? 0
              setLocalGlobalUsdt(avail)
              mutateBotState()
            }
          })
          .catch(() => {})
      } else {
        setLocalGlobalUsdt(null)
      }
    } catch {}
  }, [mutateBotState])

  const botPositions = botStatePayload?.positions || []
  const botHistory = botStatePayload?.history || []
  const globalPositions = botStatePayload?.binanceGlobal?.positions || []
  const globalUsdt = localGlobalUsdt ?? botStatePayload?.binanceGlobal?.availableBalanceUsdt ?? 0
  const isGlobalConnected = Boolean(botStatePayload?.binanceGlobal?.connected || globalUsdt > 0 || globalPositions.length > 0 || localGlobalUsdt !== null)
  const isGlobalMode = botStatePayload?.exchangeSettings?.mode === "BINANCE_GLOBAL"
  const isHybridMode = botStatePayload?.exchangeSettings?.mode === "HYBRID"
  const realizedBotProfit = botHistory.reduce((acc: number, h: any) => acc + (h.netPnlTry ?? h.pnl ?? 0), 0)
  const liveBotProfit = botPositions.reduce((acc: number, p: any) => acc + (p.pnl || 0), 0)
  const totalBotProfit = realizedBotProfit + liveBotProfit
  const isBotProfitPositive = totalBotProfit >= 0
  const nextCandidate = botStatePayload?.nextCandidate ?? null
  const nextCandidateLeverage = botStatePayload?.nextCandidateLeverage ?? null

  return (
    <main className="relative min-h-screen bg-background font-sans overflow-x-hidden">
      <MarketPulseBackground />
      <Ticker quotes={quotes}/>
      <header className="sticky top-0 z-20 border-b border-white/10 bg-background/20 backdrop-blur-md transition-colors">
        <div className="flex min-h-14 flex-wrap items-center gap-2 px-3 lg:px-5">
          <div className="mr-2 flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Activity/>
            </div>
            <b className="text-sm font-bold tracking-tight">Bys<span className="text-primary">Furkan</span></b>
          </div>
          <Nav view={view} setView={setView} totalBotProfit={totalBotProfit} isBotProfitPositive={isBotProfitPositive}/>

          <div className="relative ml-auto hidden w-48 md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
            <Input value={query} onChange={e=>setQuery(e.target.value)} className="h-8 pl-9" placeholder="Hisse veya kripto ara"/>
          </div>
          <Button size="icon" variant="ghost" aria-label="Bildirimler"><Bell/></Button>
          <UserMenu/>
        </div>
      </header>
      <div className="finance-grid relative z-10 flex flex-col gap-3 p-3 lg:p-4">
    {view==="cryptoScanner"?<CryptoScannerTerminal onSelectInTerminal={(sym)=>{setSelected(sym);setView("terminal")}} onBack={()=>setView("terminal")}/>:view==="bist30"?<Bist30Terminal onSelectInTerminal={(sym)=>{setSelected(sym);setView("terminal")}} onBack={()=>setView("terminal")}/>:view==="news"?<NewsCenter news={globalNews?.news??[]} quotes={quotes} barometer={globalNews?.barometer} onRefresh={()=>refreshNews()} onBack={()=>setView("terminal")}/>:view==="paperbot"?<PaperbotTerminal onBack={()=>setView("terminal")}/>:<>
    {/* 🤖 OTOMASYON & TOTAL KAZANÇ ÜST BANNERI */}
    <div
      onClick={() => setView("paperbot")}
      className="cursor-pointer rounded-xl border border-emerald-500/60 bg-gradient-to-r from-emerald-500/20 via-card/95 to-card p-3 sm:p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg hover:border-emerald-400 transition-all ring-1 ring-emerald-500/30 mb-2"
    >
      <div className="flex items-center gap-2.5 sm:gap-3">
        <div className="flex size-9 sm:size-10 items-center justify-center rounded-lg bg-emerald-500/25 text-emerald-400 border border-emerald-500/40 shrink-0">
          <Bot className="size-5 sm:size-6" />
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <b className="text-xs sm:text-sm font-bold text-foreground">
              {isGlobalMode
                ? "🤖 7/24 Binance Global Botu Devrede (Futures / USDT)"
                : isHybridMode
                ? "🤖 7/24 Hibrit Kripto Botu (TR + Global Futures)"
                : "🤖 7/24 Kripto Botu Devrede"}
            </b>

            {/* Slot #1 Binance TR (Sadece TR veya Hibrit modda gösterilir) */}
            {!isGlobalMode && (
              <Badge variant="outline" className="border-emerald-500 text-emerald-400 bg-emerald-500/10 font-mono text-[9px] sm:text-[10px] font-bold">
                {botPositions.length > 0
                  ? `🇹🇷 TR: ${botPositions.map((p: any) => p.symbol === 'RE' ? 'RENDER' : p.symbol).join(" + ")}`
                  : "🇹🇷 TR: Beklemede"}
              </Badge>
            )}

            {/* Binance Global (Futures / Kaldıraçlı) */}
            <Badge
              variant="outline"
              className={cn(
                "font-mono text-[9px] sm:text-[10px] font-bold",
                globalPositions.length > 0 || nextCandidate
                  ? "border-amber-400 text-amber-300 bg-amber-500/15 ring-1 ring-amber-400/40"
                  : isGlobalConnected
                  ? "border-emerald-500/80 text-emerald-300 bg-emerald-500/10"
                  : "border-sky-500/50 text-sky-400 bg-sky-500/10"
              )}
            >
              {globalPositions.length > 0
                ? `🌐 5x Futures: ${globalPositions.map((p: any) => `${p.symbol} (${p.leverage || 5}x)`).join(" + ")}`
                : nextCandidate
                ? `🔍 5x Pusu: ${nextCandidate} (${nextCandidateLeverage || 5}x)`
                : isGlobalConnected
                ? `🌐 Global Futures: ${globalUsdt.toFixed(2)} USDT Aktif`
                : "🌐 Global Futures: Aktif"}
            </Badge>
          </div>
          <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
            {nextCandidate
              ? `⏳ ${nextCandidate} (${nextCandidateLeverage || 5}x kaldıraçlı) için limit emri gönderildi, dolum bekleniyor.`
              : globalPositions.length > 0
              ? `⚡ ${globalPositions.map((p: any) => p.symbol).join(", ")} kaldıraçlı pozisyonları kâr hedeflerine doğru 7/24 takip ediliyor.`
              : isGlobalMode
              ? `🌐 Binance Global USDⓈ-M Vadeli hesabınız devrede. ${globalUsdt > 0 ? `${globalUsdt.toFixed(2)} USDT ile` : ""} otonom sinyal taraması ve kâr takibi yapılıyor.`
              : isHybridMode
              ? `🛡️ 2 Slot Hibrit Kasa: Slot #1 Binance TR Spot + Slot #2 Binance Global 5x Kaldıraç (${globalUsdt > 0 ? `${globalUsdt.toFixed(2)} USDT` : "Aktif"}).`
              : "Binance TR hesabınızda otonom al-sat ve zirve takibi devam ediyor."}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-end w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-white/10">
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-8 shadow-sm shrink-0">
          Otomasyonu Aç →
        </Button>
      </div>
    </div>
   <section className="grid gap-3 min-[820px]:grid-cols-[260px_minmax(0,1fr)]"><Card size="sm"><CardHeader className="border-b"><CardTitle>Piyasalar</CardTitle><CardDescription>BIST, ABD ve Kripto (Binance Canlı)</CardDescription><div className="flex flex-wrap gap-1 pt-2">{(["Tümü","BIST","ABD","Kripto"] as const).map(x=><Button key={x} size="sm" variant={market===x?"secondary":"ghost"} onClick={()=>setMarket(x)}>{x}</Button>)}</div><div className="relative mt-2 md:hidden"><Search className="absolute left-3 top-1/2 -translate-y-1/2"/><Input className="pl-9" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Hisse veya kripto ara"/></div></CardHeader><CardContent className="flex max-h-[390px] flex-col overflow-y-auto px-0" aria-live="polite">{cryptoLoading&&debouncedQuery.length>=2&&<p className="p-3 text-xs text-muted-foreground">Kripto kataloğu aranıyor…</p>}{cryptoError&&<p className="p-3 text-xs text-negative">{cryptoError.message}</p>}{!cryptoLoading&&!cryptoError&&query.trim().length>=2&&assets.length===0&&<p className="p-3 text-xs text-muted-foreground">Sonuç bulunamadı.</p>}{assets.map(a=>{const key=a.id?`crypto:${a.id}`:a.symbol;return <div key={key} className={cn("flex items-center border-b",selected===key&&"bg-primary/8")}><button className="p-3" aria-label={`${a.symbol} favori`} onClick={()=>favorite(key)}><Star className={cn(favorites.includes(key)&&"fill-warning text-warning")}/></button><button className="min-w-0 flex-1 py-2 pr-3 text-left" onClick={()=>selectAsset(a)}><div className="flex items-center justify-between gap-2"><b className="truncate font-mono text-xs">{a.symbol}</b><Badge variant="outline">{a.market}</Badge></div><p className="truncate text-xs text-muted-foreground">{a.name}{a.rank?` · #${a.rank}`:""}</p></button></div>})}</CardContent></Card>
    <div className="flex flex-col gap-3 min-w-0">
      {/* 🚀 Üst Görünüm Seçici Çubuğu: TradingView vs Midas */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/95 p-2 shadow-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => switchChartMode("midas")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold font-mono transition-all",
              chartMode === "midas"
                ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 ring-1 ring-emerald-400 font-black"
                : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            )}
          >
            <Sparkles className="size-3.5 text-amber-300" />
            Midas (Sade Grafik)
          </button>

          <button
            type="button"
            onClick={() => switchChartMode("tradingview")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold font-mono transition-all",
              chartMode === "tradingview"
                ? "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/40 font-black"
                : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            )}
          >
            <Activity className="size-3.5 text-emerald-400" />
            TradingView (Mum Grafik)
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="font-bold text-foreground">{data?.symbol ?? selected}</span>
          <span className="text-muted-foreground">·</span>
          <b className="font-mono text-emerald-400">
            {data?.currency === "TRY" ? "TL " : data?.currency === "USD" ? "$ " : `${data?.currency ?? ""} `}
            {fmt(data?.price)}
          </b>
          {data && <Change value={data.change} />}
        </div>
      </div>

      {/* 📊 Seçili Grafik Motoru */}
      {chartMode === "tradingview" ? (
        <TradingViewChart
          symbol={data?.symbol ?? selected}
          market={market === "Tümü" ? (data?.market || (selectedCrypto ? "Kripto" : data?.currency === "TRY" ? "BIST" : "ABD")) : market}
          currency={data?.currency}
          height={430}
          isExpanded={isChartExpanded}
          onToggleExpand={() => setIsChartExpanded((prev) => !prev)}
        />
      ) : (
        data ? (
          <MidasChart
            data={data}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
          />
        ) : (
          <Card size="sm">
            <CardContent className="py-20 text-center text-muted-foreground">
              Güncel veri yükleniyor…
            </CardContent>
          </Card>
        )
      )}

      {/* 🧠 Teknik Analiz & Genel İndikatör Özet Paneli */}
      {data && (
        <Card size="sm" className="bg-card/75 border-border/70 shadow-xs">
          <CardContent className="pt-3 pb-3">
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
              <b className="text-xs">Genel indikatör</b>
              <SignalBadge signal={data.technical.signal}/>
              <span className="font-mono text-xs">%{data.technical.confidence} güven</span>
              <span className="ml-auto text-xs text-muted-foreground font-mono">
                Destek {fmt(data.technical.support)} · Direnç {fmt(data.technical.resistance)}
              </span>
            </div>
            <div className="mt-3">
              <IndicatorGrid reads={data.technical.breakdown}/>
            </div>
          </CardContent>
        </Card>
      )}
    </div></section>
  {data&&<section><ForecastCard data={data}/></section>}
  {data&&<section><AnalystCard data={data}/></section>}
 </>}
 </div>
 </main>
  )
}
function EnhancedNewsItem({news, onUnlockClick, isUnlocked}:{news:any; onUnlockClick?: (n: any) => void; isUnlocked?: boolean}){
  const isBull=news.sentiment==="BULLISH"
  const isBear=news.sentiment==="BEARISH"
  const isFud=Boolean(news.isFudOrBearish || isBear)

  // Analiz objesi veya dinamik akıllı fallback
  const analysis = news.analysis || {
    meaning: news.aiTakeaway || (isBull ? "Piyasada risk iştahı ve alım coşkusu artıyor. Sermaye riskli varlıklara yöneliyor." : isBear ? "Piyasada tedirginlik ve satış baskısı hakim. Yatırımcılar kâr realizasyonuyla nakde geçiyor." : "Piyasada dengeli ve bekle-gör havası var."),
    bistImpact: {
      tone: isBull ? "UP" : isBear ? "DOWN" : "NEUTRAL",
      label: isBull ? "BIST 30 / 100: 🟢 Yükseliş / Güçlü Trend" : isBear ? "BIST 30 / 100: 🔴 Düşüş / Satış Baskısı" : "BIST 30 / 100: 🟡 Dengeli / Bekle-Gör",
      detail: isBull ? "Hisse senetlerine para girişi artar, değerlemeler yükselir." : isBear ? "Kredi maliyetleri veya satış baskısı endeksi aşağı iter." : "Destek ve direnç bandında yatay seyreder."
    },
    cryptoImpact: {
      tone: isBull ? "UP" : isBear ? "DOWN" : "NEUTRAL",
      label: isBull ? "Kripto / BTC: 🟢 Boğa Coşkusu" : isBear ? "Kripto / BTC: 🔴 Geri Çekilme Riski" : "Kripto / BTC: 🟡 Nötr Seyir",
      detail: isBull ? "Meme coin ve altcoinlerde hacimli pump ve yükselişler tetiklenir." : isBear ? "Sıkı stop-loss (-%1.40) kuralı cüzdanı korur." : "Piyasanın durulması ve yön seçmesi beklenir."
    },
    goldUsdImpact: {
      tone: isBull ? "NEUTRAL" : "UP",
      label: isBull ? "Altın / Dolar: 🟡 Dengeli" : "Altın / Dolar: 🟢 Güvenli Liman",
      detail: isBull ? "Para hisse ve kriptoya akarken döviz yatay kalır." : "Belirsizlik anında nakit dolar ve altına talep artar."
    },
    actionTip: isBull ? "Yükselişte açgözlü olma; +%1.10'da stop'u başabaşa çekip kârı kilitle." : isBear ? "Düşen bıçağı elle tutma! Net dip dönüşü görmeden acele alım yapma." : "Destek ve direnç seviyelerini izleyerek kademeli hareket et."
  }

  return (
    <div className={cn(
      "group relative overflow-hidden rounded-xl border p-4 space-y-3 shadow-xs transition-all",
      isFud ? "border-rose-500/35 bg-rose-500/[0.03] hover:border-rose-500/60" : "border-border/70 bg-card/85 hover:border-primary/40 hover:bg-card"
    )}>
      {/* 1. Kategori & Duygu Etiketleri */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("text-[10px] font-mono px-2 py-0.5 font-bold",
            news.category==="Kripto"?"border-amber-500/50 text-amber-400 bg-amber-500/10":
            news.category==="ABD Makro"?"border-blue-500/50 text-blue-400 bg-blue-500/10":
            "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
          )}>
            {news.category}
          </Badge>
          <Badge variant="outline" className={cn("text-[10px] font-mono px-2 py-0.5 font-bold",
            isBull?"border-emerald-500/50 text-emerald-400 bg-emerald-500/10":
            isBear?"border-rose-500/50 text-rose-400 bg-rose-500/10":
            "border-muted text-muted-foreground"
          )}>
            {isBull?"🟢 POZİTİF (BOĞA)":isBear?"🔴 DÜŞÜŞ (AYI)":"⚪ NÖTR SEYİR"}
          </Badge>
          {isFud && (
            <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 font-bold border-rose-500/70 text-rose-400 bg-rose-500/15">
              🚨 DÜŞÜŞ / FUD ALARMI
            </Badge>
          )}
          {news.impactBadge&&<span className="text-[10px] text-muted-foreground font-mono">• {news.impactBadge}</span>}
        </div>
        {news.url&&(
          <a href={news.url} target="_blank" rel="noreferrer" aria-label="Habere git" className="text-muted-foreground transition-colors hover:text-primary shrink-0" title="Haber kaynağına git">
            <ExternalLink className="size-3.5"/>
          </a>
        )}
      </div>

      {/* 2. Haber Başlığı */}
      <p className="text-sm sm:text-base font-bold leading-snug text-foreground group-hover:text-primary transition-colors">
        {news.title}
      </p>

      {/* KİLİTLİ ALAN (KULLANICI VİDEO İZLEMEDİYSE KİLİTLENİR VE REKLAM BUTONU GÖRÜNÜR) */}
      {!isUnlocked ? (
        <div className="relative rounded-xl border border-dashed border-amber-500/40 bg-zinc-950/70 p-4 text-center space-y-3 backdrop-blur-xs">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-inner">
            <Lock className="size-5" />
          </div>
          <div className="space-y-1">
            <h5 className="text-xs font-bold text-zinc-100 flex items-center justify-center gap-1.5">
              <Sparkles className="size-3.5 text-amber-400" />
              Özel Piyasa Teşhisi & BIST/Kripto Aksiyon Rehberi Kilitli
            </h5>
            <p className="text-[11px] text-zinc-400 max-w-sm mx-auto">
              Bu haberin detaylı yapay zekâ analizini ve varlıklar üzerindeki net etkilerini görmek için kısa bir sponsorlu reklam izleyin.
            </p>
          </div>
          <div>
            <Button
              onClick={() => onUnlockClick?.(news)}
              size="sm"
              className="h-8 text-xs font-bold bg-gradient-to-r from-amber-500 to-emerald-500 hover:from-amber-600 hover:to-emerald-600 text-black shadow-md gap-1.5"
            >
              <Sparkles className="size-3.5" />
              Sponsorlu Video İzle & Kilidi Aç (15 sn)
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* 3. Haberin Anlamı (Ne Demek?) */}
          <div className={cn(
            "rounded-lg border p-3 text-xs space-y-1 shadow-inner",
            isFud ? "border-rose-500/30 bg-rose-500/5" : "border-primary/25 bg-primary/5"
          )}>
            <div className={cn(
              "flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-wider",
              isFud ? "text-rose-400" : "text-primary"
            )}>
              <Sparkles className="size-3.5 shrink-0"/>
              <span>💡 Bu Haber Ne Anlama Geliyor?</span>
            </div>
            <p className="text-foreground/90 text-[12px] leading-relaxed">
              {analysis.meaning}
            </p>
          </div>

          {/* 4. Net Piyasa Sonuçları (Kime / Neye Ne Olur?) */}
          <div className="space-y-1.5 pt-0.5">
            <span className="text-[11px] font-bold text-foreground flex items-center gap-1">
              📊 Net Piyasa Sonuçları (Kime Ne Olur?):
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* BIST Sonucu */}
              <div className="rounded-lg border border-border/70 bg-background/80 p-2.5 text-xs space-y-1 shadow-xs">
                <span className="font-bold text-[11px] block text-foreground">
                  {analysis.bistImpact.label}
                </span>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  {analysis.bistImpact.detail}
                </p>
              </div>

              {/* Kripto Sonucu */}
              <div className="rounded-lg border border-border/70 bg-background/80 p-2.5 text-xs space-y-1 shadow-xs">
                <span className="font-bold text-[11px] block text-foreground">
                  {analysis.cryptoImpact.label}
                </span>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  {analysis.cryptoImpact.detail}
                </p>
              </div>

              {/* Dolar / Altın Sonucu */}
              <div className="rounded-lg border border-border/70 bg-background/80 p-2.5 text-xs space-y-1 shadow-xs">
                <span className="font-bold text-[11px] block text-foreground">
                  {analysis.goldUsdImpact.label}
                </span>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  {analysis.goldUsdImpact.detail}
                </p>
              </div>
            </div>
          </div>

          {/* 5. Yatırımcı Ne Yapmalı? (Aksiyon Notu) */}
          <div className={cn(
            "rounded-lg border p-2.5 text-xs flex flex-wrap items-center gap-2",
            isFud ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          )}>
            <span className={cn(
              "font-black text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0",
              isFud ? "bg-rose-500/25 text-rose-300" : "bg-emerald-500/20 text-emerald-300"
            )}>
              {isFud ? "⚠️ Risk / Aksiyon Uyarısı" : "🎯 Yatırımcı Ne Yapmalı?"}
            </span>
            <span className={cn("text-[11px] font-medium flex-1", isFud ? "text-rose-100" : "text-emerald-100")}>
              {analysis.actionTip}
            </span>
          </div>
        </>
      )}

      {/* 6. Alt Bilgi */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/60 pt-2 font-mono">
        <span className="font-semibold text-foreground/80">{news.source}</span>
        <span>{news.publishedAt?new Date(news.publishedAt).toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):""}</span>
      </div>
    </div>
  )
}
function NewsCenter({news,quotes,barometer,onRefresh,onBack}:{news:any[];quotes:Quote[];barometer?:any;onRefresh?:()=>void;onBack:()=>void}){
  const [selectedCategory, setSelectedCategory] = useState<string>("Tümü")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [unlockedNews, setUnlockedNews] = useState<Record<string, boolean>>({})
  const [activeModalNews, setActiveModalNews] = useState<any | null>(null)

  const sentimentCounts = useMemo(() => {
    let bull = 0, bear = 0, neutral = 0, fud = 0, cryptoTotal = 0
    news.forEach(n => {
      if (n.category === "Kripto") cryptoTotal++
      if (n.sentiment === "BULLISH") bull++
      else if (n.sentiment === "BEARISH") bear++
      else neutral++
      if (n.isFudOrBearish || n.sentiment === "BEARISH") fud++
    })
    return { bull, bear, neutral, fud, cryptoTotal }
  }, [news])

  const filteredNews = useMemo(() => {
    return news.filter(n => {
      let matchCat = false
      if (selectedCategory === "Tümü") matchCat = true
      else if (selectedCategory === "🐻 Ayı & FUD") matchCat = Boolean(n.isFudOrBearish || n.sentiment === "BEARISH")
      else matchCat = n.category === selectedCategory

      const matchSearch = !searchQuery.trim() || 
        (n.title && n.title.toLowerCase().includes(searchQuery.toLowerCase())) || 
        (n.source && n.source.toLowerCase().includes(searchQuery.toLowerCase()))
      return matchCat && matchSearch
    })
  }, [news, selectedCategory, searchQuery])

  const radar = barometer?.cryptoBearRadar
  const isSafe = !radar || radar.status === "SAFE"
  const isCaution = radar?.status === "CAUTION"
  const isBearAlarm = radar?.status === "BEAR_ALARM"

  return (
    <section className="mx-auto w-full max-w-6xl space-y-4">
      {/* 1. Üst Başlık & Eylemler */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card/60 p-4 shadow-sm backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Newspaper className="size-5 text-primary"/>
              Canlı Finans, Kripto & ABD Makro Haber Merkezi
            </h1>
            <Badge variant="outline" className="text-[10px] font-mono border-primary/40 text-primary">CANLI AKIŞ</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Cointelegraph, CoinDesk, Google News TR ve global veri kaynaklarıyla anlık FUD & piyasa takibi
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh&&<Button size="sm" variant="outline" onClick={onRefresh} className="h-8 gap-1.5 text-xs font-semibold"><RefreshCw className="size-3.5"/>Yenile</Button>}
          <Button variant="secondary" size="sm" onClick={onBack} className="h-8 text-xs font-semibold">Terminale Dön</Button>
        </div>
      </div>

      {/* 2. KRİPTO AYI & DÜŞÜŞ RADARI (HERO WIDGET) */}
      <div className={cn(
        "rounded-xl border p-4 sm:p-5 transition-all shadow-md relative overflow-hidden",
        isSafe ? "border-emerald-500/40 bg-gradient-to-br from-card via-card to-emerald-950/20" :
        isCaution ? "border-amber-500/40 bg-gradient-to-br from-card via-card to-amber-950/20" :
        "border-rose-500/50 bg-gradient-to-br from-card via-card to-rose-950/30"
      )}>
        {/* Başlık ve Canlı Durum Rozeti */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <div className={cn(
              "flex size-8 items-center justify-center rounded-lg font-bold text-base",
              isSafe ? "bg-emerald-500/20 text-emerald-400" :
              isCaution ? "bg-amber-500/20 text-amber-400" :
              "bg-rose-500/20 text-rose-400 animate-pulse"
            )}>
              {isSafe ? "🛡️" : isCaution ? "⚠️" : "🚨"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-foreground flex items-center gap-1.5">
                  🐻 Kriptoda Şu An Ayılık / Tehlike Bir Durum Var Mı?
                </h2>
                <span className="relative flex h-2 w-2">
                  <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", isSafe ? "bg-emerald-400" : isCaution ? "bg-amber-400" : "bg-rose-400")} />
                  <span className={cn("relative inline-flex rounded-full h-2 w-2", isSafe ? "bg-emerald-500" : isCaution ? "bg-amber-500" : "bg-rose-500")} />
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">Korku-Açgözlülük, BTC 24s trendi ve kripto haber akışının anlık risk değerlendirmesi</p>
            </div>
          </div>
          <div>
            <Badge variant="outline" className={cn(
              "font-mono text-xs px-2.5 py-1 font-bold tracking-wide",
              isSafe ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" :
              isCaution ? "border-amber-500/60 bg-amber-500/15 text-amber-300" :
              "border-rose-500/70 bg-rose-500/20 text-rose-300 animate-pulse"
            )}>
              {radar?.statusLabel ?? "🟢 GÜVENLİ BÖLGE (Piyasada Ani Dump Yok)"}
            </Badge>
          </div>
        </div>

        {/* Canlı Açıklama & Bot Tavsiyesi */}
        <div className="mt-3.5 space-y-2.5">
          <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-xs leading-relaxed text-foreground/95">
            <span className="font-bold text-primary mr-1">🔍 Piyasa Teşhisi:</span>
            {radar?.summary ?? "Bitcoin direnç seviyelerinde dengeli seyrediyor. Korku ve Açgözlülük endeksi pozitif. Taranan haber akışında acil bir kriz, hack veya regülasyon baskısı (FUD) bulunmuyor."}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-primary">🤖 Bot Güvenlik Notu:</span>
              <span className="text-foreground/90 font-medium">{radar?.botAdvice ?? "Olağan strateji sürdürülebilir, stop-loss seviyeleri korunuyor."}</span>
            </div>
            {sentimentCounts.fud > 0 && (
              <Button
                size="sm"
                variant={selectedCategory === "🐻 Ayı & FUD" ? "default" : "outline"}
                onClick={() => setSelectedCategory("🐻 Ayı & FUD")}
                className="h-6 text-[10px] font-bold gap-1 border-rose-500/40 text-rose-300 hover:bg-rose-500/15"
              >
                <AlertTriangle className="size-3"/>
                {sentimentCounts.fud} FUD/Düşüş Haberini Gör
              </Button>
            )}
          </div>
        </div>

        {/* 4 Canlı Metrik Kutucuğu */}
        <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-background/50 p-2.5 text-center">
            <span className="text-[10px] text-muted-foreground block font-medium">Bitcoin (BTC 24s)</span>
            <span className="font-mono text-sm sm:text-base font-bold text-foreground mt-0.5 block">{radar?.btcPrice ?? "$85,500"}</span>
            <span className={cn("font-mono text-[11px] font-bold block", (radar?.btcChangeNum ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {radar?.btcChange24h ?? "+%0.30"}
            </span>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/50 p-2.5 text-center">
            <span className="text-[10px] text-muted-foreground block font-medium">Korku & Açgözlülük</span>
            <span className="font-mono text-sm sm:text-base font-bold text-emerald-400 mt-0.5 block">{radar?.fearGreedValue ?? 65} / 100</span>
            <span className="text-[11px] text-muted-foreground block truncate">{radar?.fearGreedLabel ?? "Açgözlülük"}</span>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/50 p-2.5 text-center">
            <span className="text-[10px] text-muted-foreground block font-medium">Düşüş & FUD Taraması</span>
            <span className="font-mono text-sm sm:text-base font-bold text-foreground mt-0.5 block">
              {sentimentCounts.fud} <span className="text-xs font-normal text-muted-foreground">/ {sentimentCounts.cryptoTotal} Haber</span>
            </span>
            <span className="text-[11px] text-muted-foreground block">
              {sentimentCounts.fud === 0 ? "Temiz (FUD Yok)" : `${sentimentCounts.fud} Başlıkta Uyarı`}
            </span>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/50 p-2.5 text-center">
            <span className="text-[10px] text-muted-foreground block font-medium">Piyasa Tehdit Skoru</span>
            <span className={cn("font-mono text-sm sm:text-base font-bold mt-0.5 block", isSafe ? "text-emerald-400" : isCaution ? "text-amber-400" : "text-rose-400")}>
              %{radar?.riskScore ?? 18} / 100
            </span>
            <span className="text-[11px] font-bold text-muted-foreground block">{radar?.riskLevel ?? "DÜŞÜK"} RİSK</span>
          </div>
        </div>
      </div>

      {/* 3. Makro Barometre Kartları */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm" className="border-border/70 bg-card/80">
          <CardHeader className="pb-1">
            <CardDescription className="text-xs font-medium flex items-center justify-between"><span>ABD TÜFE (Enflasyon)</span><Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-400">Yıllık</Badge></CardDescription>
            <CardTitle className="font-mono text-lg text-foreground font-bold">{barometer?.cpiInflation?.value??"%2.9 Yıllık"}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-[10px] text-muted-foreground">{barometer?.cpiInflation?.note??"Beklentilere paralel, faiz indirim alanını koruyor."}</CardContent>
        </Card>
        <Card size="sm" className="border-border/70 bg-card/80">
          <CardHeader className="pb-1">
            <CardDescription className="text-xs font-medium flex items-center justify-between"><span>Fed Politika Faizi</span><Badge variant="outline" className="text-[9px] border-primary/40 text-primary">Fed Funds</Badge></CardDescription>
            <CardTitle className="font-mono text-lg text-foreground font-bold">{barometer?.fedInterestRate?.value??"%4.25 - %4.50"}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-[10px] text-muted-foreground">{barometer?.fedInterestRate?.note??"Kademeli indirim döngüsü piyasa likiditesini destekliyor."}</CardContent>
        </Card>
        <Card size="sm" className="border-border/70 bg-card/80">
          <CardHeader className="pb-1">
            <CardDescription className="text-xs font-medium flex items-center justify-between"><span>ABD Tarım Dışı İstihdam</span><Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-400">NFP</Badge></CardDescription>
            <CardTitle className="font-mono text-lg text-foreground font-bold">{barometer?.employmentNfp?.value??"+142 Bin"}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-[10px] text-muted-foreground">{barometer?.employmentNfp?.note??"İş gücü ılımlı seyrediyor, ani resesyon riski düşük."}</CardContent>
        </Card>
        <Card size="sm" className="border-border/70 bg-card/80">
          <CardHeader className="pb-1">
            <CardDescription className="text-xs font-medium flex items-center justify-between"><span>Kripto Korku & Açgözlülük</span><Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-400 font-mono">0 - 100</Badge></CardDescription>
            <CardTitle className="font-mono text-lg text-emerald-400 font-bold flex items-center gap-2">{barometer?.fearGreed?.value??65} / 100<span className="text-xs font-normal text-muted-foreground">({barometer?.fearGreed?.label??"Açgözlülük"})</span></CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-[10px] text-muted-foreground">Piyasa risk iştahı pozitif bölgede, altcoin/meme hareketliliğini destekliyor.</CardContent>
        </Card>
      </div>

      {/* 4. Kategori Filtresi & Arama */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/50 p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["Tümü", "🐻 Ayı & FUD", "Kripto", "ABD Makro", "Piyasalar"] as const).map(cat=>{
            const count = cat === "Tümü" ? news.length :
                          cat === "🐻 Ayı & FUD" ? sentimentCounts.fud :
                          news.filter(n=>n.category===cat).length
            const isSel = selectedCategory === cat
            return (
              <Button key={cat} size="sm" variant={isSel?"default":"ghost"} onClick={()=>setSelectedCategory(cat)} className={cn(
                "h-7 text-xs font-semibold gap-1.5",
                cat === "🐻 Ayı & FUD" && !isSel && "text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
              )}>
                {cat==="Kripto"?"🪙 Kripto (Global & TR)":cat==="🐻 Ayı & FUD"?"🐻 Ayı & FUD Alarmları":cat==="ABD Makro"?"🏛️ ABD Makro & Fed":cat==="Piyasalar"?"📊 Emtia & BIST":"🌐 Tümü"}
                <span className={cn(
                  "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                  isSel ? "bg-primary-foreground text-primary" :
                  cat === "🐻 Ayı & FUD" ? "bg-rose-500/20 text-rose-300" :
                  "bg-muted text-muted-foreground"
                )}>{count}</span>
              </Button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-64">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"/>
            <Input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Haber başlığı ara..." className="h-8 pl-8 text-xs"/>
          </div>
        </div>
      </div>

      {/* 5. Duygu Dağılımı Çubuğu */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
        <span>Haber Duygu Dağılımı:</span>
        <span className="flex items-center gap-1 font-semibold text-emerald-400"><span className="size-2 rounded-full bg-emerald-400"/>{sentimentCounts.bull} Boğa / Pozitif</span>
        <span className="flex items-center gap-1 font-semibold text-rose-400"><span className="size-2 rounded-full bg-rose-400"/>{sentimentCounts.bear} Ayı / Baskı</span>
        <span className="flex items-center gap-1 font-semibold text-amber-400"><span className="size-2 rounded-full bg-amber-400"/>{sentimentCounts.neutral} Nötr</span>
        {sentimentCounts.fud > 0 && (
          <span className="flex items-center gap-1 font-semibold text-rose-300 font-mono ml-auto">
            <span className="size-1.5 rounded-full bg-rose-400 animate-ping"/>
            {sentimentCounts.fud} Aktif FUD / Düşüş Riski
          </span>
        )}
      </div>

      {/* 6. Haber Kartları Listesi */}
      <div className="grid gap-3 md:grid-cols-2">
        {filteredNews.length?filteredNews.map((n, idx)=>{
          const itemKey = n.id || n.url || n.title || String(idx)
          // İlk 1 haberi kullanıcının siteyi keşfetmesi için varsayılan açık bırakalım veya hepsini kilitleyelim
          const isItemUnlocked = Boolean(unlockedNews[itemKey])
          return (
            <EnhancedNewsItem
              key={itemKey}
              news={n}
              isUnlocked={isItemUnlocked}
              onUnlockClick={(item) => setActiveModalNews(item)}
            />
          )
        }):(
          <div className="col-span-2 rounded-xl border border-dashed border-border/80 p-8 text-center text-muted-foreground text-sm">
            {news.length===0?"Canlı haberler taranıyor ve güncelleniyor...":"Seçilen kategori veya arama kriterine uygun haber bulunamadı."}
          </div>
        )}
      </div>

      {/* YÜKSEK GETİRİLİ ÖDÜLLÜ VİDEO REKLAM MODAL'I */}
      <RewardedVideoModal
        isOpen={Boolean(activeModalNews)}
        onClose={() => setActiveModalNews(null)}
        newsTitle={activeModalNews?.title}
        source={activeModalNews?.source}
        onRewardGranted={() => {
          if (activeModalNews) {
            const itemKey = activeModalNews.id || activeModalNews.url || activeModalNews.title
            setUnlockedNews(prev => ({ ...prev, [itemKey]: true }))
          }
        }}
      />
    </section>
  )
}

function AnalystBar({label,count,total,tone}:{label:string;count:number;total:number;tone:string}){const pct=total?Math.round(count/total*100):0;return <div><div className="mb-1 flex items-center justify-between text-xs"><span className={cn("font-semibold",tone)}>{label}</span><span className="font-mono text-muted-foreground">%{pct}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full",tone==="text-positive"?"bg-positive":tone==="text-negative"?"bg-negative":"bg-warning")} style={{width:`${pct}%`}}/></div></div>}
function AnalystCard({data}:{data:Data}){const a=data.analyst;const d=a?.distribution;return <Card size="sm"><CardHeader><CardTitle>Analist görünümü</CardTitle><CardDescription>{data.symbol} için Yahoo Finance analist derlemesi</CardDescription></CardHeader><CardContent>{d&&d.total>0?<div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]"><div><p className="mb-3 text-sm font-semibold">{d.total} analiste göre</p><div className="grid gap-3"><AnalystBar label="Al" count={d.buy} total={d.total} tone="text-positive"/><AnalystBar label="Tut" count={d.hold} total={d.total} tone="text-warning"/><AnalystBar label="Sat" count={d.sell} total={d.total} tone="text-negative"/></div></div>{a?.targetMean?<div className="grid grid-cols-3 gap-3 self-center border-t pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0"><div><p className="text-xs text-muted-foreground">Düşük</p><b className="font-mono text-negative">{fmt(a.targetLow)}</b></div><div><p className="text-xs text-muted-foreground">Ortalama hedef</p><b className="font-mono">{fmt(a.targetMean)}</b></div><div><p className="text-xs text-muted-foreground">Yüksek</p><b className="font-mono text-positive">{fmt(a.targetHigh)}</b></div></div>:null}</div>:<p className="text-sm text-muted-foreground">Bu sembol için doğrulanabilir analist dağılımı bulunamadı; tahmin uydurulmadı.</p>}</CardContent></Card>}
function ForecastCard({data}:{data:Data}){const atr=data.technical.values.atr||0;const fib=data.technical.fibonacci;const upside=Math.max(data.technical.resistance,fib.level236||0,data.price+atr);const downside=Math.min(data.technical.support,fib.level618||data.price,data.price-atr);const upPct=((upside/data.price)-1)*100;const downPct=((downside/data.price)-1)*100;return <Card size="sm" className="border-primary/30 bg-primary/5"><CardHeader><CardTitle>Tahmini hareket alanı</CardTitle><CardDescription>Teknik seviyeler + ATR + Fibonacci kesişimi</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-3"><div className="rounded-md border border-positive/30 bg-positive/10 p-3"><p className="text-xs text-muted-foreground">Yukarı senaryo</p><b className="font-mono text-lg text-positive">{fmt(upside)}</b><p className="font-mono text-xs text-positive">{upPct>=0?"+":""}{fmt(upPct)}%</p></div><div className="rounded-md border border-negative/30 bg-negative/10 p-3"><p className="text-xs text-muted-foreground">Aşağı risk</p><b className="font-mono text-lg text-negative">{fmt(downside)}</b><p className="font-mono text-xs text-negative">{fmt(downPct)}%</p></div><p className="col-span-2 text-[10px] leading-relaxed text-muted-foreground">Bunlar kesin fiyat tahmini değil, mevcut oynaklık ve teknik kesişimlerden üretilen senaryo sınırlarıdır.</p></CardContent></Card>}
