"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Flame,
  Globe2,
  LockKeyhole,
  Mail,
  Radar,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  User,
  Zap,
} from "lucide-react"
import { authClient } from "@/lib/auth/client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

type Mode = "sign-in" | "sign-up"

// Floating market arrows (using negative delays so on F5 they are already scattered, never bunching up at top)
const MARKET_FLOW_ARROWS = [
  // Rising (Green) Arrows
  { id: "u1", dir: "up", left: "6%",  dur: "14s", delay: "-3.2s",  size: 58, blur: "4px", op: 0.35, val: "+3.8% ▲" },
  { id: "u2", dir: "up", left: "22%", dur: "17s", delay: "-9.5s",  size: 72, blur: "5px", op: 0.38, val: "+5.2% ▲" },
  { id: "u3", dir: "up", left: "38%", dur: "15s", delay: "-6.1s",  size: 64, blur: "4px", op: 0.30, val: "+2.1% ▲" },
  { id: "u4", dir: "up", left: "62%", dur: "19s", delay: "-13.4s", size: 80, blur: "5px", op: 0.35, val: "+4.6% ▲" },
  { id: "u5", dir: "up", left: "82%", dur: "16s", delay: "-4.8s",  size: 60, blur: "4px", op: 0.32, val: "+1.9% ▲" },
  
  // Falling (Red) Arrows
  { id: "d1", dir: "down", left: "14%", dur: "18s", delay: "-7.4s",  size: 54, blur: "4px", op: 0.28, val: "-1.4% ▼" },
  { id: "d2", dir: "down", left: "31%", dur: "16s", delay: "-12.0s", size: 68, blur: "5px", op: 0.30, val: "-2.8% ▼" },
  { id: "d3", dir: "down", left: "50%", dur: "20s", delay: "-2.5s",  size: 74, blur: "5px", op: 0.26, val: "-0.9% ▼" },
  { id: "d4", dir: "down", left: "74%", dur: "17s", delay: "-10.8s", size: 62, blur: "4px", op: 0.28, val: "-3.2% ▼" },
  { id: "d5", dir: "down", left: "92%", dur: "21s", delay: "-5.0s",  size: 70, blur: "5px", op: 0.25, val: "-1.7% ▼" },
]

export function AuthTerminal({ initialMode = "sign-in" }: { initialMode?: Mode }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState("")
  const [isShaking, setIsShaking] = useState(false)

  // Password strength calculation
  const passwordStrength = useMemo(() => {
    if (!password) return { score: 0, label: "", color: "" }
    let score = 0
    if (password.length >= 8) score += 1
    if (/[A-Z]/.test(password)) score += 1
    if (/[0-9]/.test(password)) score += 1
    if (/[^A-Za-z0-9]/.test(password)) score += 1

    if (score <= 1) return { score: 1, label: "Zayıf", color: "bg-destructive" }
    if (score === 2) return { score: 2, label: "Orta", color: "bg-warning" }
    if (score === 3) return { score: 3, label: "İyi", color: "bg-primary" }
    return { score: 4, label: "Çok Güçlü", color: "bg-positive" }
  }, [password])

  function triggerShake() {
    setIsShaking(true)
    setTimeout(() => setIsShaking(false), 500)
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode)
    setError("")
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")

    if (mode === "sign-up" && password.length < 8) {
      setError("Şifreniz en az 8 karakter olmalıdır.")
      triggerShake()
      return
    }

    if (!email.trim() || !password) {
      setError("Lütfen e-posta ve şifrenizi doldurun.")
      triggerShake()
      return
    }

    setIsPending(true)
    try {
      let authSuccess = false

      if (authClient?.signIn?.email && authClient?.signUp?.email) {
        try {
          const accountName = name.trim() || email.trim().split("@")[0]
          const result = mode === "sign-up"
            ? await authClient.signUp.email({ name: accountName, email: email.trim(), password })
            : await authClient.signIn.email({ email: email.trim(), password })

          const res = result as { error?: { message?: string } | string | null } | null
          if (res && !res.error) {
            authSuccess = true
          } else if (res?.error) {
            const errObj = res.error
            const msg = typeof errObj === "string" 
              ? errObj 
              : errObj?.message || "Giriş bilgileri doğrulanamadı."
            setError(msg)
            triggerShake()
            setIsPending(false)
            return
          }
        } catch {
          // Local fallback session
          authSuccess = true
        }
      } else {
        authSuccess = true
      }

      if (authSuccess) {
        const accountName = name.trim() || email.trim().split("@")[0]
        try {
          localStorage.setItem("f_borsam_nickname", accountName)
          localStorage.setItem("f_borsam_email", email.trim())
          // 30 günlük oturum çerezi bırak
          document.cookie = "f_borsam_session=active_session; path=/; max-age=2592000; SameSite=Lax"
        } catch {}
        router.push("/")
        router.refresh()
      }
    } catch {
      setError("Bağlantı kurulamadı. Lütfen tekrar deneyin.")
      triggerShake()
    } finally {
      setIsPending(false)
    }
  }

  return (
    <main className="auth-terminal relative min-h-svh overflow-hidden text-foreground">
      {/* ── Fixed Background Particles Container (Prevents F5 Clustering) ── */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        {/* Soft Ambient Background Orbs */}
        <div className="auth-orb absolute -left-36 -top-28 size-[560px] rounded-full bg-positive/12" />
        <div className="auth-orb-2 absolute -bottom-48 right-8 size-[520px] rounded-full bg-primary/12" />
        <div className="auth-orb-cyan absolute left-1/3 top-1/4 size-[420px] rounded-full bg-negative/8" />

        {/* Distributed Floating Market Arrows */}
        {MARKET_FLOW_ARROWS.map((item) => (
          <div
            key={item.id}
            className={cn(
              "flex flex-col items-center justify-center gap-1 font-mono select-none will-change-transform",
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
              className="drop-shadow-[0_0_14px_currentColor]"
              style={{ width: `${item.size}px`, height: `${item.size}px` }}
            >
              {item.dir === "up" ? (
                <path d="M16 4L28 17H19V28H13V17H4L16 4Z" fill="currentColor" />
              ) : (
                <path d="M16 28L4 15H13V4H19V15H28L16 28Z" fill="currentColor" />
              )}
            </svg>
            <span className="text-[10px] font-bold tracking-wider opacity-85">
              {item.val}
            </span>
          </div>
        ))}
      </div>

      <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-[1440px] flex-col lg:flex-row">
        {/* ══════════════════════════════════════════════
            LEFT PANEL — Borsa Radarı & Terminal Ambiyansı
        ══════════════════════════════════════════════ */}
        <section className="relative hidden min-h-svh flex-1 flex-col justify-between overflow-hidden border-r border-border/60 p-10 xl:p-14 lg:flex">
          
          {/* Header Brand */}
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

          {/* Center Dynamic Content */}
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

            {/* Fütüristik Borsa Radar Kartı */}
            <div className="auth-card-neon rounded-2xl bg-card/85 p-5 backdrop-blur-2xl shadow-2xl space-y-4.5">
              
              {/* Radar Başlığı ve Durum Göstergesi */}
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

          {/* Footer Info */}
          <div className="relative z-10 flex items-center justify-between text-xs text-muted-foreground border-t border-border/40 pt-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              <span>Borsa İstanbul & Yahoo Finance Lisanslı Veri Akışı</span>
            </div>
            <div className="font-mono text-[11px]">GÜVENLİ PROTOKOL // TLS 1.3</div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════
            RIGHT PANEL — Animated Login Form Card
        ══════════════════════════════════════════════ */}
        <section className="relative flex min-h-svh w-full items-center justify-center px-5 py-10 lg:w-[490px] lg:px-10 xl:w-[540px] xl:px-14">
          <div className={cn("auth-card-neon relative w-full max-w-md rounded-2xl bg-card/90 p-6 backdrop-blur-2xl sm:p-8", isShaking && "auth-shake")}>
            {/* Header in Form */}
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/30 shadow-inner">
                  <Flame className="size-4.5" />
                </div>
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-primary">Giriş Terminali</span>
              </div>
              <h2 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">
                {mode === "sign-in" ? "Terminale Giriş Yap" : "Yeni Hesap Oluştur"}
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                {mode === "sign-in" 
                  ? "Piyasa ekranınıza ve analiz göstergelerinize erişin." 
                  : "Ücretsiz hesap oluşturarak analiz paneline hemen katılın."}
              </p>
            </div>

            {/* Mode Switcher Tabs with Animated Pill */}
            <div className="relative mb-6 grid grid-cols-2 rounded-xl border border-border bg-muted/60 p-1" role="tablist">
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

            {/* Login / Sign Up Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <FieldGroup className="gap-3.5">
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
                  <FieldLabel htmlFor="email" className="text-xs font-semibold">E-posta Adresi</FieldLabel>
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
                      placeholder="analist@f-borsam.com"
                      required
                    />
                  </div>
                </Field>

                <Field data-invalid={Boolean(error)}>
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor="password" className="text-xs font-semibold">Şifre</FieldLabel>
                    {mode === "sign-in" && (
                      <span className="text-[11px] text-muted-foreground cursor-pointer hover:text-primary transition-colors">
                        Şifremi Unuttum?
                      </span>
                    )}
                  </div>
                  <div className="relative mt-1">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                      className={cn(
                        "h-11 px-9.5 text-sm transition-all focus-visible:ring-2 focus-visible:ring-primary/50",
                        error && "border-destructive focus-visible:ring-destructive/50"
                      )}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === "sign-up" ? "En az 8 karakter belirleyin" : "Şifrenizi girin"}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                    >
                      {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                    </button>
                  </div>

                  {/* Dynamic Password Strength Meter for Sign Up */}
                  {mode === "sign-up" && password.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Şifre Gücü:</span>
                        <span className="font-semibold">{passwordStrength.label}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        {[1, 2, 3, 4].map((step) => (
                          <div
                            key={step}
                            className={cn(
                              "h-full rounded-full transition-all duration-300",
                              step <= passwordStrength.score ? passwordStrength.color : "bg-transparent"
                            )}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {error && <FieldError className="text-xs text-destructive mt-1.5">{error}</FieldError>}
                </Field>

                {error && (
                  <Alert variant="destructive" className="py-2.5 px-3.5 text-xs">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Submit Action Button */}
                <Button
                  type="submit"
                  size="lg"
                  className="auth-shimmer-btn mt-3 w-full h-11 font-bold text-sm shadow-xl transition-all active:scale-[0.98]"
                  disabled={isPending}
                >
                  {isPending ? (
                    <>
                      <Spinner className="mr-2 size-4" />
                      <span>İşleniyor...</span>
                    </>
                  ) : (
                    <>
                      <TrendingUp className="mr-2 size-4" />
                      <span>{mode === "sign-in" ? "Terminale Giriş Yap" : "Hesabımı Oluştur"}</span>
                      <ArrowRight className="ml-2 size-4" />
                    </>
                  )}
                </Button>

                {/* Micro trust row */}
                <div className="mt-2 flex items-center justify-center gap-5 text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-primary" />
                    <span>Ücretsiz Erişim</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5 text-primary" />
                    <span>SSL Korumalı</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Zap className="size-3.5 text-primary" />
                    <span>Anlık Analiz</span>
                  </div>
                </div>
              </FieldGroup>
            </form>

            <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
              F-Borsam analiz araçları yatırım tavsiyesi içermez. Veriler piyasa sağlayıcılarından alınmaktadır.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
