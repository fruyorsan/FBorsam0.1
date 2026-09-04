"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Cpu,
  Flame,
  Globe2,
  KeyRound,
  Mail,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  User,
  Zap,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

type Mode = "sign-in" | "sign-up"

// Floating market arrows (using negative delays so on F5 they are already scattered across the screen)
const MARKET_FLOW_ARROWS = [
  // Rising (Green) Arrows
  { id: "u1", dir: "up", left: "5%",  dur: "13s", delay: "-3.2s",  size: 64, blur: "5px", op: 0.35, val: "+3.8% ▲" },
  { id: "u2", dir: "up", left: "22%", dur: "16s", delay: "-9.5s",  size: 80, blur: "7px", op: 0.40, val: "+5.2% ▲" },
  { id: "u3", dir: "up", left: "38%", dur: "14s", delay: "-6.1s",  size: 72, blur: "6px", op: 0.30, val: "+2.1% ▲" },
  { id: "u4", dir: "up", left: "62%", dur: "18s", delay: "-13.4s", size: 90, blur: "8px", op: 0.38, val: "+4.6% ▲" },
  { id: "u5", dir: "up", left: "82%", dur: "15s", delay: "-4.8s",  size: 68, blur: "5px", op: 0.32, val: "+1.9% ▲" },
  
  // Falling (Red) Arrows
  { id: "d1", dir: "down", left: "14%", dur: "17s", delay: "-7.4s",  size: 58, blur: "6px", op: 0.28, val: "-1.4% ▼" },
  { id: "d2", dir: "down", left: "31%", dur: "15s", delay: "-12.0s", size: 74, blur: "7px", op: 0.32, val: "-2.8% ▼" },
  { id: "d3", dir: "down", left: "50%", dur: "19s", delay: "-2.5s",  size: 82, blur: "8px", op: 0.26, val: "-0.9% ▼" },
  { id: "d4", dir: "down", left: "74%", dur: "16s", delay: "-10.8s", size: 66, blur: "5px", op: 0.30, val: "-3.2% ▼" },
  { id: "d5", dir: "down", left: "92%", dur: "20s", delay: "-5.0s",  size: 78, blur: "7px", op: 0.25, val: "-1.7% ▼" },
]

export function AuthTerminal({ initialMode = "sign-in" }: { initialMode?: Mode }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [otpCode, setOtpCode] = useState("")
  const [step, setStep] = useState<"input" | "verify">("input")
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState("")
  const [infoMsg, setInfoMsg] = useState("")
  const [isShaking, setIsShaking] = useState(false)

  function triggerShake() {
    setIsShaking(true)
    setTimeout(() => setIsShaking(false), 500)
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode)
    setStep("input")
    setError("")
    setInfoMsg("")
  }

  // 1. ADIM: KODU İSTE
  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setInfoMsg("")

    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Lütfen geçerli bir e-posta adresi yazın.")
      triggerShake()
      return
    }

    if (mode === "sign-up" && !name.trim()) {
      setError("Lütfen adınızı ve soyadınızı girin.")
      triggerShake()
      return
    }

    setIsPending(true)
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          email: cleanEmail,
          name: name.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error || "Kod gönderilemedi. Lütfen tekrar deneyin.")
        triggerShake()
        return
      }

      setStep("verify")
      if (data.mailSent) {
        setInfoMsg(`📬 Doğrulama kodunuz ${cleanEmail} adresine iletildi. Lütfen gelen kutunuzu (ve spam klasörünü) kontrol ediniz.`)
      } else if (data.previewCode) {
        setInfoMsg(`ℹ️ Doğrulama Kodunuz: ${data.previewCode} (E-posta sunucusu bağlı değilken test için ekranda görünür).`)
        setOtpCode(data.previewCode)
      } else {
        setInfoMsg("Doğrulama kodu oluşturuldu. Lütfen 6 haneli kodu giriniz.")
      }
    } catch {
      setError("Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.")
      triggerShake()
    } finally {
      setIsPending(false)
    }
  }

  // 2. ADIM: KODU DOĞRULA VE GİRİŞ YAP
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    const cleanCode = otpCode.trim()
    if (cleanCode.length !== 6) {
      setError("Lütfen 6 haneli doğrulama kodunu eksiksiz girin.")
      triggerShake()
      return
    }

    setIsPending(true)
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          email: email.trim().toLowerCase(),
          code: cleanCode,
        }),
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error || "Geçersiz doğrulama kodu.")
        triggerShake()
        return
      }

      try {
        localStorage.setItem("f_borsam_nickname", data.name || email.split("@")[0])
        localStorage.setItem("f_borsam_email", data.email || email.trim().toLowerCase())
        document.cookie = "f_borsam_session=active_session; path=/; max-age=2592000; SameSite=Lax"
      } catch {}

      router.push("/")
      router.refresh()
    } catch {
      setError("Doğrulama sırasında bağlantı hatası oluştu.")
      triggerShake()
    } finally {
      setIsPending(false)
    }
  }

  return (
    <main className="auth-terminal relative min-h-svh overflow-hidden text-foreground">
      {/* ── Soft Deep Glow Ambient Orbs ── */}
      <div className="auth-orb pointer-events-none absolute -left-36 -top-28 size-[620px] rounded-full bg-positive/15" aria-hidden="true" />
      <div className="auth-orb-2 pointer-events-none absolute -bottom-48 right-8 size-[580px] rounded-full bg-primary/15" aria-hidden="true" />
      <div className="auth-orb-cyan pointer-events-none absolute left-1/3 top-1/4 size-[460px] rounded-full bg-negative/10" aria-hidden="true" />

      {/* ── Rising & Falling Market Arrows Background ── */}
      {MARKET_FLOW_ARROWS.map((item) => (
        <div
          key={item.id}
          aria-hidden="true"
          className={cn(
            "flex flex-col items-center justify-center gap-1 font-mono select-none pointer-events-none",
            item.dir === "up" ? "auth-arrow-up text-positive" : "auth-arrow-down text-negative"
          )}
          style={{
            left: item.left,
            animationDuration: item.dur,
            animationDelay: item.delay,
            filter: `blur(${item.blur})`,
            // @ts-expect-error custom css variable
            "--op": item.op,
          }}
        >
          <svg
            viewBox="0 0 32 32"
            fill="none"
            className="drop-shadow-[0_0_18px_currentColor]"
            style={{ width: `${item.size}px`, height: `${item.size}px` }}
          >
            {item.dir === "up" ? (
              <path
                d="M16 4L28 17H19V28H13V17H4L16 4Z"
                fill="currentColor"
              />
            ) : (
              <path
                d="M16 28L4 15H13V4H19V15H28L16 28Z"
                fill="currentColor"
              />
            )}
          </svg>
          <span className="text-[11px] font-bold tracking-wider opacity-85">
            {item.val}
          </span>
        </div>
      ))}

      <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-[1440px] flex-col lg:flex-row overflow-x-hidden">
        {/* ══════════════════════════════════════════════
            LEFT PANEL — Borsa Radarı & Boğa/Ayı Nabzı
        ══════════════════════════════════════════════ */}
        <section className="relative hidden min-h-svh flex-1 flex-col justify-between overflow-hidden border-r border-border/60 p-10 xl:p-14 lg:flex">
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex size-12 items-center justify-center rounded-2xl border border-primary/40 bg-primary/15 text-primary shadow-[0_0_26px_color-mix(in_oklch,var(--primary)_30%,transparent)] backdrop-blur-md">
                <BarChart3 className="size-6 animate-pulse" aria-hidden="true" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-black tracking-[0.26em] text-foreground">F-BORSAM</span>
                  <span className="rounded bg-primary/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">TERMINAL</span>
                </div>
                <p className="text-xs text-muted-foreground">Algoritmik Piyasa İstihbaratı</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 rounded-full border border-primary/30 bg-card/70 px-3.5 py-1.5 text-xs font-semibold text-primary backdrop-blur-md shadow-inner">
              <span className="auth-live-dot size-2 rounded-full bg-primary" />
              <span>PİYASA RADARI AKTİF</span>
            </div>
          </div>

          <div className="relative z-10 my-auto py-6 max-w-2xl space-y-6">
            <div>
              <div className="mb-3.5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-card/70 px-3.5 py-1 text-xs font-medium text-primary backdrop-blur-md shadow-sm">
                <Sparkles className="size-3.5 text-primary animate-spin" />
                <span>Gerçek Zamanlı Piyasa Derinliği</span>
              </div>

              <h1 className="text-5xl font-extrabold tracking-[-0.04em] leading-[1.08] lg:text-6xl xl:text-7xl text-foreground">
                Piyasaya daha <br />
                <span className="bg-gradient-to-r from-positive via-primary to-[oklch(0.72_0.18_190)] bg-clip-text text-transparent drop-shadow-sm">
                  hakim ol.
                </span>
              </h1>

              <p className="mt-4 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground xl:text-base">
                F-Borsam; borsa hareketlerini, trend kırılımlarını ve anlık hacim dalgalarını akıllı bir çalışma masasında birleştirir.
              </p>
            </div>

            {/* Fütüristik Borsa Radar Kartı (Boğa / Ayı Sentiment & Dinamik Mumlar) */}
            <div className="auth-card-neon rounded-2xl bg-card/85 p-5 backdrop-blur-2xl shadow-2xl space-y-4.5">
              <div className="flex items-center justify-between border-b border-border/60 pb-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-positive/15 text-positive">
                    <Radar className="size-4.5 animate-spin" />
                  </div>
                  <div>
                    <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">Piyasa Hacim & Trend Nabzı</h3>
                    <p className="text-[11px] text-muted-foreground">Canlı Alıcı/Satıcı Baskı Analizi</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 rounded-full bg-positive/15 px-2.5 py-1 text-[11px] font-mono font-bold text-positive">
                  <TrendingUp className="size-3.5" />
                  <span>GÜÇLÜ BOĞA PİYASASI</span>
                </div>
              </div>

              {/* Dinamik Mum Grafiği & Piyasa Dalgası Görseli */}
              <div className="rounded-xl border border-border/70 bg-background/60 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-muted-foreground">Piyasa Dağılım Oranı</span>
                  <span className="text-positive font-bold">%76 Boğa (Alıcı) · %24 Ayı (Satıcı)</span>
                </div>

                {/* Sentiment Bar */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-negative/30 flex">
                  <div className="h-full bg-positive rounded-l-full transition-all duration-500 shadow-[0_0_12px_currentColor]" style={{ width: "76%" }} />
                  <div className="h-full bg-negative rounded-r-full transition-all duration-500 shadow-[0_0_12px_currentColor]" style={{ width: "24%" }} />
                </div>

                {/* Animated Candlestick Wave Graphic */}
                <div className="flex items-end justify-between h-14 pt-2 px-1">
                  {[
                    { h: "55%", isUp: true },
                    { h: "70%", isUp: true },
                    { h: "45%", isUp: false },
                    { h: "85%", isUp: true },
                    { h: "60%", isUp: false },
                    { h: "92%", isUp: true },
                    { h: "78%", isUp: true },
                    { h: "50%", isUp: false },
                    { h: "96%", isUp: true },
                    { h: "88%", isUp: true },
                    { h: "65%", isUp: false },
                    { h: "100%", isUp: true },
                  ].map((candle, idx) => (
                    <div key={idx} className="flex flex-col items-center justify-end h-full w-2">
                      <div
                        className={cn(
                          "w-1.5 rounded-sm auth-candle-anim transition-all",
                          candle.isUp ? "bg-positive shadow-[0_0_8px_color-mix(in_oklch,var(--positive)_40%,transparent)]" : "bg-negative shadow-[0_0_8px_color-mix(in_oklch,var(--negative)_40%,transparent)]"
                        )}
                        style={{
                          height: candle.h,
                          animationDelay: `${idx * 150}ms`,
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Radar Özellikleri Grid */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-xl border border-border/60 bg-background/40 p-2.5">
                  <div className="flex items-center gap-1.5 text-primary mb-1">
                    <Globe2 className="size-3.5" />
                    <span className="font-mono text-[10px] font-bold uppercase">650+ Varlık</span>
                  </div>
                  <p className="text-[11px] font-semibold text-foreground">BIST, Kripto, Döviz</p>
                  <p className="text-[10px] text-muted-foreground">Eş zamanlı veri taraması</p>
                </div>

                <div className="rounded-xl border border-border/60 bg-background/40 p-2.5">
                  <div className="flex items-center gap-1.5 text-primary mb-1">
                    <Cpu className="size-3.5" />
                    <span className="font-mono text-[10px] font-bold uppercase">Algoritmik</span>
                  </div>
                  <p className="text-[11px] font-semibold text-foreground">14 İndikatör Sinyali</p>
                  <p className="text-[10px] text-muted-foreground">RSI, MACD, Bollinger</p>
                </div>

                <div className="rounded-xl border border-border/60 bg-background/40 p-2.5">
                  <div className="flex items-center gap-1.5 text-primary mb-1">
                    <Bot className="size-3.5" />
                    <span className="font-mono text-[10px] font-bold uppercase">Claude AI</span>
                  </div>
                  <p className="text-[11px] font-semibold text-foreground">Otomatik Şirket Özeti</p>
                  <p className="text-[10px] text-muted-foreground">Bilanço & Haber Analizi</p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 flex items-center justify-between text-xs text-muted-foreground border-t border-border/40 pt-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              <span>Borsa İstanbul & Yahoo Finance Lisanslı Veri Akışı</span>
            </div>
            <div className="font-mono text-[11px]">GÜVENLİ PROTOKOL // TLS 1.3</div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════
            RIGHT PANEL — Form & OTP Kartı (Mobil Uyumlu)
        ══════════════════════════════════════════════ */}
        <section
          className="relative flex w-full flex-col items-center justify-center overflow-y-auto px-4 py-6 sm:px-6 sm:py-10 lg:w-[490px] lg:min-h-svh lg:px-10 xl:w-[540px] xl:px-14"
          style={{
            paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
            paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))'
          }}
        >
          <div className={cn("auth-card-neon relative w-full max-w-md rounded-2xl bg-card/90 p-5 backdrop-blur-2xl sm:p-8", isShaking && "auth-shake")}>
            <div className="mb-4 sm:mb-6">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex size-7 sm:size-8 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/30 shadow-inner">
                  <Flame className="size-4" />
                </div>
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-primary">Giriş Terminali</span>
              </div>
              <h2 className="text-xl font-black tracking-tight text-foreground sm:text-3xl">
                {mode === "sign-in" ? "Terminale Giriş Yap" : "Yeni Hesap Oluştur"}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {step === "input"
                  ? "E-posta adresinize tek kullanımlık 6 haneli güvenlik kodu gönderilecektir."
                  : `${email} adresine gönderilen 6 haneli kodu giriniz.`}
              </p>
            </div>

            {/* Mode Switcher Tabs */}
            {step === "input" && (
              <div className="relative mb-4 sm:mb-6 grid grid-cols-2 rounded-xl border border-border bg-muted/60 p-1" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "sign-in"}
                  className={cn(
                    "auth-tab-pill relative z-10 rounded-lg py-2.5 text-xs font-bold sm:text-sm",
                    mode === "sign-in" ? "bg-background text-foreground shadow-md" : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => switchMode("sign-in")}
                >
                  Giriş Yap
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "sign-up"}
                  className={cn(
                    "auth-tab-pill relative z-10 rounded-lg py-2.5 text-xs font-bold sm:text-sm",
                    mode === "sign-up" ? "bg-background text-foreground shadow-md" : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => switchMode("sign-up")}
                >
                  Hesap Oluştur
                </button>
              </div>
            )}

            {/* 1. ADIM: E-POSTA FORMU */}
            {step === "input" ? (
              <form onSubmit={handleSendCode} className="space-y-3 sm:space-y-4">
                <FieldGroup className="gap-3">
                  {mode === "sign-up" && (
                    <Field>
                      <FieldLabel htmlFor="name" className="text-xs font-semibold">Ad Soyad</FieldLabel>
                      <div className="relative mt-1">
                        <User className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
                        <Input
                          id="name"
                          name="name"
                          autoComplete="name"
                          className="h-11 pl-9.5 text-sm transition-all focus-visible:ring-2 focus-visible:ring-primary/50"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Örn: Ahmet Yılmaz"
                          required
                        />
                      </div>
                    </Field>
                  )}

                  <Field>
                    <FieldLabel htmlFor="email" className="text-xs font-semibold">Gerçek E-posta Adresi</FieldLabel>
                    <div className="relative mt-1">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        className="h-11 pl-9.5 text-sm transition-all focus-visible:ring-2 focus-visible:ring-primary/50"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="adiniz@gmail.com"
                        required
                      />
                    </div>
                  </Field>

                  {error && (
                    <Alert variant="destructive" className="py-2.5 px-3.5 text-xs">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    type="submit"
                    size="lg"
                    className="auth-shimmer-btn mt-2 w-full h-11 font-bold text-sm shadow-xl transition-all active:scale-[0.98]"
                    disabled={isPending}
                  >
                    {isPending ? (
                      <>
                        <Spinner className="mr-2 size-4" />
                        <span>Kod Gönderiliyor...</span>
                      </>
                    ) : (
                      <>
                        <Mail className="mr-2 size-4" />
                        <span>Doğrulama Kodu Gönder</span>
                        <ArrowRight className="ml-2 size-4" />
                      </>
                    )}
                  </Button>

                  <div className="mt-2 flex items-center justify-center gap-5 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5 text-primary" />
                      <span>E-Posta Onaylı</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="size-3.5 text-primary" />
                      <span>Şifresiz & Güvenli</span>
                    </div>
                  </div>
                </FieldGroup>
              </form>
            ) : (
              /* 2. ADIM: 6 HANELİ KODU GİRME FORMU */
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <FieldGroup className="gap-3.5">
                  {infoMsg && (
                    <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-xs leading-relaxed text-foreground">
                      {infoMsg}
                    </div>
                  )}

                  <Field>
                    <div className="flex items-center justify-between">
                      <FieldLabel htmlFor="otp" className="text-xs font-semibold">6 Haneli Doğrulama Kodu</FieldLabel>
                      <button
                        type="button"
                        onClick={() => { setStep("input"); setError(""); }}
                        className="text-[11px] text-primary hover:underline font-medium"
                      >
                        E-postayı Değiştir
                      </button>
                    </div>
                    <div className="relative mt-1">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-primary" aria-hidden="true" />
                      <Input
                        id="otp"
                        name="otp"
                        type="text"
                        maxLength={6}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        className="h-12 pl-10 text-center font-mono text-xl tracking-[0.35em] font-bold text-foreground transition-all focus-visible:ring-2 focus-visible:ring-primary/50"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••••"
                        autoFocus
                        required
                      />
                    </div>
                  </Field>

                  {error && (
                    <Alert variant="destructive" className="py-2.5 px-3.5 text-xs">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    type="submit"
                    size="lg"
                    className="auth-shimmer-btn mt-2 w-full h-11 font-bold text-sm shadow-xl transition-all active:scale-[0.98] bg-positive hover:bg-positive/90 text-positive-foreground"
                    disabled={isPending || otpCode.length !== 6}
                  >
                    {isPending ? (
                      <>
                        <Spinner className="mr-2 size-4" />
                        <span>Doğrulanıyor...</span>
                      </>
                    ) : (
                      <>
                        <TrendingUp className="mr-2 size-4" />
                        <span>Kodu Onayla & Terminale Gir</span>
                        <ArrowRight className="ml-2 size-4" />
                      </>
                    )}
                  </Button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <RefreshCw className="size-3" />
                      <span>Kodu almadınız mı? Tekrar Gönder</span>
                    </button>
                  </div>
                </FieldGroup>
              </form>
            )}

            <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
              F-Borsam analiz araçları yatırım tavsiyesi içermez. Veriler piyasa sağlayıcılarından alınmaktadır.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
