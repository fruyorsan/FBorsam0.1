"use client"

import { useState, useRef, useEffect } from "react"
import {
  Bot,
  Send,
  RefreshCw,
  RotateCcw,
  Sparkles,
  MessageSquare,
  FileText,
  Copy,
  Check,
  KeyRound,
  X,
  ExternalLink,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface Message {
  role: "user" | "assistant"
  content: string
  source?: string
  time: string
}

interface ClaudeChatCardProps {
  data: any
  quotes?: any[]
  autoAI?: { text: string; source: string }
  aiLoading: boolean
  onRefreshAI: () => void
}

function RichMessage({ text }: { text: string }) {
  const lines = text.split("\n").filter(l => l.trim().length > 0)
  return (
    <div className="space-y-1.5 text-xs leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) {
          return (
            <h4 key={i} className="font-bold text-foreground text-sm mt-2 mb-1 flex items-center gap-1.5">
              {line.replace("### ", "")}
            </h4>
          )
        }
        if (line.startsWith("#### ")) {
          return (
            <h5 key={i} className="font-semibold text-foreground text-xs mt-1.5 mb-0.5">
              {line.replace("#### ", "")}
            </h5>
          )
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          const itemText = line.slice(2)
          return (
            <div key={i} className="flex items-start gap-1.5 pl-1.5 text-muted-foreground">
              <span className="text-primary font-bold">•</span>
              <div>
                {itemText.split(/(\?\*\*[^\*]+\*\*)/g).map((part, j) =>
                  part.startsWith("**") && part.endsWith("**") ? (
                    <strong key={j} className="font-bold text-foreground">
                      {part.slice(2, -2)}
                    </strong>
                  ) : (
                    <span key={j}>{part}</span>
                  )
                )}
              </div>
            </div>
          )
        }
        return (
          <p key={i} className="text-muted-foreground">
            {line.split(/(\?\*\*[^\*]+\*\*)/g).map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <strong key={j} className="font-bold text-foreground">
                  {part.slice(2, -2)}
                </strong>
              ) : (
                <span key={j}>{part}</span>
              )
            )}
          </p>
        )
      })}
    </div>
  )
}

const CHAT_STORAGE_KEY = "piyasaiq:ai_chat_history_v3"
const USER_KEY_STORAGE = "piyasaiq:user_ai_key_v1"
const USER_PROVIDER_STORAGE = "piyasaiq:user_ai_provider_v1"

export function ClaudeChatCard({ data, quotes = [], autoAI, aiLoading, onRefreshAI }: ClaudeChatCardProps) {
  const [tab, setTab] = useState<"chat" | "analysis">("chat")
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [userApiKey, setUserApiKey] = useState("")
  const [userProvider, setUserProvider] = useState<"gemini" | "openai" | "groq" | "anthropic">("gemini")
  const [tempKeyInput, setTempKeyInput] = useState("")

  const activeSymbol = data?.symbol ?? "TUPRS"

  // Load user API key on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const savedKey = localStorage.getItem(USER_KEY_STORAGE)
        const savedProv = localStorage.getItem(USER_PROVIDER_STORAGE) as any
        if (savedKey) {
          setUserApiKey(savedKey)
          setTempKeyInput(savedKey)
        }
        if (savedProv) {
          setUserProvider(savedProv)
        }
      } catch {}
    }
  }, [])

  const handleSaveKey = () => {
    try {
      const cleanKey = tempKeyInput.trim()
      if (cleanKey) {
        localStorage.setItem(USER_KEY_STORAGE, cleanKey)
        localStorage.setItem(USER_PROVIDER_STORAGE, userProvider)
        setUserApiKey(cleanKey)
      } else {
        localStorage.removeItem(USER_KEY_STORAGE)
        localStorage.removeItem(USER_PROVIDER_STORAGE)
        setUserApiKey("")
      }
    } catch {}
    setShowKeyModal(false)
  }

  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(CHAT_STORAGE_KEY)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed
          }
        }
      } catch {}
    }
    const timeStr = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date())
    return [
      {
        role: "assistant",
        content: `Merhaba! Ben **BysFurkan Canlı AI Piyasa Analistinizim** 🤖. Sitedeki anlık fiyatları, indikatörleri ve şirket verilerini doğrudan okuyorum.\n\nŞu anda ekranda **${activeSymbol}** açık. İster *"Ne iş yapar?"*, *"Alınır mı?"*, *"Hedef fiyatı kaç?"* diye sor, ister aklına takılan her türlü borsa/kripto sorusunu sor!`,
        source: "BysFurkan Canlı AI",
        time: timeStr,
      },
    ]
  })

  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const isInitialMount = useRef(true)

  // Save chat history
  useEffect(() => {
    if (typeof window !== "undefined" && messages.length > 0) {
      try {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
      } catch {}
    }
  }, [messages])

  // Context-aware quick questions
  const quickQuestions = [
    `${activeSymbol} ne iş yapar, iş modeli nedir?`,
    `${activeSymbol} alınır mı, ideal giriş ve stop neresi?`,
    `${activeSymbol} hedef fiyat kaç, daha çıkar mı?`,
    `${activeSymbol} teknik seviyeleri ve indikatör durumu?`,
    "BIST 100 ve genel piyasa görünümü nasıl?",
  ]

  const handleCopyMessage = (content: string, idx: number) => {
    try {
      navigator.clipboard.writeText(content)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    } catch {}
  }

  const handleResetChat = () => {
    try {
      localStorage.removeItem(CHAT_STORAGE_KEY)
    } catch {}
    const now = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date())
    setMessages([
      {
        role: "assistant",
        content: `Sohbet sıfırlandı. **${activeSymbol}** veya dilediğiniz hisse/kripto hakkında yeni sorunuzu sorabilirsiniz.`,
        source: "BysFurkan Canlı AI",
        time: now,
      },
    ])
  }

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    // SADECE iç sohbet kutusunu aşağı kaydır; TÜM SAYFAYI (window) ASLA aşağı kaydırma!
    if (tab === "chat" && chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: "smooth",
      })
    }
  }, [messages.length, loading, tab])

  async function sendMessage(textToSend?: string) {
    const text = (textToSend ?? input).trim()
    if (!text || loading) return

    const now = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date())
    const userMsg: Message = { role: "user", content: text, time: now }
    const updatedHistory = [...messages, userMsg]
    setMessages(updatedHistory)
    setInput("")
    setLoading(true)

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          symbol: activeSymbol,
          userApiKey: userApiKey || undefined,
          userProvider: userApiKey ? userProvider : undefined,
          history: updatedHistory.slice(-6).map(m => ({ role: m.role, content: m.content })),
          marketData: {
            ...data,
            macro: quotes,
          },
        }),
      })

      if (!res.ok) throw new Error("Yanıt alınamadı")
      const result = await res.json()
      const assistantMsg: Message = {
        role: "assistant",
        content: result.reply ?? "Analiz üretilemedi.",
        source: result.model ?? "BysFurkan Canlı AI",
        time: new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date()),
      }
      setMessages([...updatedHistory, assistantMsg])
    } catch {
      setMessages([
        ...updatedHistory,
        {
          role: "assistant",
          content: "Bağlantı yenileniyor, lütfen sorunuzu tekrar gönderin.",
          source: "BysFurkan AI",
          time: now,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card size="sm" className="border-ai/40 bg-ai-surface shadow-xs transition-all relative">
      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="size-5 text-primary" />
                <h3 className="font-bold text-sm">Canlı Yapay Zeka Modeli Bağla</h3>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setShowKeyModal(false)} className="size-7">
                <X className="size-4" />
              </Button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-muted-foreground">
                Sitedeki canlı piyasa ve hisse verileriyle birebir konuşan bir yapay zeka bağlayabilirsiniz.
              </p>

              {/* Model Seçimi */}
              <div className="space-y-1.5">
                <label className="font-semibold text-foreground">Yapay Zeka Servisi:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setUserProvider("gemini")}
                    className={cn(
                      "rounded-lg border p-2 text-left transition-all",
                      userProvider === "gemini" ? "border-primary bg-primary/10 font-bold" : "border-border/60 hover:bg-muted/40"
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <span>✨ Google Gemini</span>
                    </div>
                    <span className="text-[10px] text-emerald-400 font-normal">Ücretsiz & Hızlı (Önerilen)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUserProvider("openai")}
                    className={cn(
                      "rounded-lg border p-2 text-left transition-all",
                      userProvider === "openai" ? "border-primary bg-primary/10 font-bold" : "border-border/60 hover:bg-muted/40"
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <span>⚡ OpenAI (ChatGPT)</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-normal">GPT-4o mini</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUserProvider("groq")}
                    className={cn(
                      "rounded-lg border p-2 text-left transition-all",
                      userProvider === "groq" ? "border-primary bg-primary/10 font-bold" : "border-border/60 hover:bg-muted/40"
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <span>🚀 Groq</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-normal">Llama 3.3 (Ücretsiz)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUserProvider("anthropic")}
                    className={cn(
                      "rounded-lg border p-2 text-left transition-all",
                      userProvider === "anthropic" ? "border-primary bg-primary/10 font-bold" : "border-border/60 hover:bg-muted/40"
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <span>🧠 Claude</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-normal">Claude 3.5 Sonnet</span>
                  </button>
                </div>
              </div>

              {/* API Key Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-foreground">API Anahtarı (API Key):</label>
                  {userProvider === "gemini" && (
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      Ücretsiz Anahtar Al <ExternalLink className="size-3" />
                    </a>
                  )}
                  {userProvider === "groq" && (
                    <a
                      href="https://console.groq.com/keys"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      Ücretsiz Groq Al <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <Input
                  type="password"
                  value={tempKeyInput}
                  onChange={e => setTempKeyInput(e.target.value)}
                  placeholder={userProvider === "gemini" ? "AIzaSy..." : userProvider === "groq" ? "gsk_..." : "sk-..."}
                  className="font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Anahtarınız yalnızca tarayıcınızda (localStorage) saklanır, üçüncü şahıslarla paylaşılmaz.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              {userApiKey && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setTempKeyInput("")
                    localStorage.removeItem(USER_KEY_STORAGE)
                    localStorage.removeItem(USER_PROVIDER_STORAGE)
                    setUserApiKey("")
                    setShowKeyModal(false)
                  }}
                  className="h-8 text-xs mr-auto"
                >
                  Anahtarı Kaldır
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setShowKeyModal(false)} className="h-8 text-xs">
                Vazgeç
              </Button>
              <Button size="sm" onClick={handleSaveKey} className="h-8 text-xs">
                Kaydet ve Bağla
              </Button>
            </div>
          </div>
        </div>
      )}

      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-ai/15 text-ai">
              <Bot className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-bold">🤖 Canlı AI Piyasa Analisti</CardTitle>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-ai/40 text-ai bg-ai/10 font-mono font-bold">
                  {activeSymbol}
                </Badge>
                {userApiKey ? (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-emerald-500/40 text-emerald-400 bg-emerald-500/10 font-mono flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    ⚡ {userProvider === "gemini" ? "Gemini 1.5 Flash (Canlı)" : userProvider === "groq" ? "Groq Llama 3.3 (Canlı)" : "OpenAI (Canlı)"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-primary/40 text-primary bg-primary/10 font-mono flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                    ⚡ Dahili Finansal Motor
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs">
                Sitedeki canlı fiyatları, teknik indikatörleri ve şirket verilerini anlık okuyarak analiz eder
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={userApiKey ? "outline" : "secondary"}
              onClick={() => setShowKeyModal(true)}
              className="h-7 text-xs gap-1 font-medium"
              title="Yapay zeka modeli veya API anahtarı ayarla"
            >
              <KeyRound className="size-3 text-primary" />
              <span>{userApiKey ? "Model Bağlı" : "Model / API Key"}</span>
            </Button>

            <div className="flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => setTab("chat")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                  tab === "chat"
                    ? "bg-primary text-primary-foreground font-bold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <MessageSquare className="size-3" />
                Sohbet
              </button>
              <button
                type="button"
                onClick={() => setTab("analysis")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                  tab === "analysis"
                    ? "bg-primary text-primary-foreground font-bold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <FileText className="size-3" />
                Rapor
              </button>
            </div>

            {tab === "analysis" ? (
              <Button size="sm" variant="outline" onClick={onRefreshAI} className="h-7 text-xs ml-1">
                <RefreshCw className={cn("size-3", aiLoading && "animate-spin")} />
                Yenile
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleResetChat}
                className="h-7 text-xs text-muted-foreground hover:text-foreground ml-1"
                title="Sohbeti Sıfırla ve Temizle"
              >
                <RotateCcw className="size-3" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-3">
        {tab === "analysis" ? (
          <div>
            {aiLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-2">
                <RefreshCw className="size-5 animate-spin text-ai" />
                <span>Yapay zeka şirketi etkileyen güncel verileri değerlendiriyor…</span>
              </div>
            ) : (
              <RichMessage text={autoAI?.text ?? "Analiz hazırlanamadı."} />
            )}
            <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
              <span>Model: Finansal Muhakeme Motoru · Canlı piyasa verileri</span>
              <button
                type="button"
                onClick={() => setTab("chat")}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                <Sparkles className="size-3" />
                Bu varlıkla ilgili detaylı soru sor →
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {/* Hızlı Soru Çipleri */}
            <div className="flex flex-wrap gap-1.5 pb-1">
              {quickQuestions.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => sendMessage(q)}
                  disabled={loading}
                  className="rounded-full border border-border/70 bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-foreground transition-all disabled:opacity-50 text-left"
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Mesaj Akışı */}
            <div ref={chatScrollRef} className="flex max-h-[340px] min-h-[180px] flex-col gap-2.5 overflow-y-auto pr-1 rounded-lg border border-border/50 bg-background/50 p-2.5">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex flex-col max-w-[92%] rounded-xl p-2.5 text-xs transition-all",
                    m.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground font-medium rounded-tr-none shadow-xs"
                      : "mr-auto bg-muted/60 text-foreground border border-border/60 rounded-tl-none"
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className={cn("font-bold text-[10px]", m.role === "user" ? "text-primary-foreground/80" : "text-ai")}>
                      {m.role === "user" ? "Siz" : m.source ?? "Canlı AI"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {m.role !== "user" && (
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(m.content, i)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Yanıtı Kopyala"
                        >
                          {copiedIdx === i ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                        </button>
                      )}
                      <span className="text-[9px] text-muted-foreground/70">{m.time}</span>
                    </div>
                  </div>
                  {m.role === "user" ? (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  ) : (
                    <RichMessage text={m.content} />
                  )}
                </div>
              ))}
              {loading && (
                <div className="mr-auto flex items-center gap-2 rounded-xl border border-border/60 bg-muted/60 p-2.5 text-xs text-muted-foreground rounded-tl-none">
                  <RefreshCw className="size-3.5 animate-spin text-ai" />
                  <span>{activeSymbol} verileri inceleniyor ve yanıt oluşturuluyor…</span>
                </div>
              )}
            </div>

            {/* Soru Gönderme Alanı */}
            <form
              onSubmit={e => {
                e.preventDefault()
                sendMessage()
              }}
              className="flex items-center gap-2"
            >
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={`${activeSymbol} hakkında merak ettiğiniz soruyu yazın (örn: Ne iş yapar?, Alınır mı?)... `}
                disabled={loading}
                className="h-9 text-xs"
              />
              <Button type="submit" size="sm" disabled={loading || !input.trim()} className="h-9 px-3 gap-1">
                <Send className="size-3.5" />
                <span className="hidden sm:inline">Gönder</span>
              </Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
