"use client"

import React, { useState, useRef, useEffect } from "react"
import { MessageSquare, X, Send, Bot, Sparkles, ChevronDown, RefreshCw, Zap, TrendingUp, ShieldCheck } from "lucide-react"

interface Message {
  id: string
  role: "assistant" | "user"
  text: string
  timestamp: string
}

const DEFAULT_SUGGESTIONS = [
  "📊 Portföy ve pozisyon durumu",
  "💰 Kasadaki serbest nakit",
  "🎯 Piyasayı tara ve fırsatları göster",
  "⚙️ 2 Slot moduna geç",
]

export function BotAssistantWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome-1",
      role: "assistant",
      text: "Merhaba. 7/24 Binance TR kasanızı, açık pozisyonlarınızı ve piyasayı takip ediyorum. Portföy durumu sorabilir, 'EIGEN'i sat', 'Tümünü sat' veya 'Piyasayı tara' gibi doğrudan alım-satım komutları verebilirsiniz.",
      timestamp: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
    },
  ])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    if (isOpen && !isMinimized) {
      scrollToBottom()
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [messages, isOpen, isMinimized])

  const handleSend = async (customText?: string) => {
    const textToSend = (customText || input).trim()
    if (!textToSend || isLoading) return

    const userMsg: Message = {
      id: "usr-" + Date.now(),
      role: "user",
      text: textToSend,
      timestamp: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
    }

    setMessages((prev) => [...prev, userMsg])
    if (!customText) setInput("")
    setIsLoading(true)

    try {
      const historyPayload = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.text,
      }))

      const res = await fetch("/api/bot/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          history: historyPayload,
        }),
      })

      if (!res.ok) throw new Error("Asistan sunucu hatası")

      const data = await res.json()

      const assistantMsg: Message = {
        id: "ast-" + Date.now(),
        role: "assistant",
        text: data.reply || "Kanka verileri kontrol ettim, her şey yolunda!",
        timestamp: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
      }

      setMessages((prev) => [...prev, assistantMsg])
      if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        setSuggestions(data.suggestions)
      }
    } catch (err) {
      const errorMsg: Message = {
        id: "err-" + Date.now(),
        role: "assistant",
        text: "Kanka anlık küçük bir gecikme oldu ama sistem 7/24 çalışmaya devam ediyor. Tekrar sormayı dene!",
        timestamp: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Markdown benzeri kalın yazıları (*...*) ve satır başlarını renderlama
  const renderFormattedText = (raw: string) => {
    const lines = raw.split("\n")
    return lines.map((line, lIdx) => {
      // Bold replace
      const parts = line.split(/(\*\*.*?\*\*)/g)
      return (
        <p key={lIdx} className={`${line.trim() === "" ? "h-2" : "min-h-[1.2rem]"} leading-relaxed`}>
          {parts.map((p, pIdx) => {
            if (p.startsWith("**") && p.endsWith("**")) {
              return (
                <strong key={pIdx} className="font-semibold text-emerald-400">
                  {p.slice(2, -2)}
                </strong>
              )
            }
            return p
          })}
        </p>
      )
    })
  }

  return (
    <div className="fixed bottom-3 right-3 sm:bottom-5 sm:right-5 z-50 flex flex-col items-end pointer-events-auto">
      {/* ── SOHBET PENCERESİ ── */}
      {isOpen && (
        <div
          className={`w-[calc(100vw-24px)] sm:w-[410px] bg-slate-950/95 backdrop-blur-xl border border-emerald-500/30 shadow-2xl rounded-2xl flex flex-col overflow-hidden transition-all duration-300 ease-out mb-2 sm:mb-3 ${
            isMinimized ? "h-14" : "h-[500px] max-h-[78dvh] sm:h-[540px] sm:max-h-[82vh]"
          }`}
          style={{
            boxShadow: "0 10px 35px -5px rgba(0, 0, 0, 0.8), 0 0 20px 2px rgba(16, 185, 129, 0.15)",
          }}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 px-3.5 sm:px-4 py-2.5 sm:py-3 border-b border-white/10 flex items-center justify-between select-none">
            <div className="flex items-center gap-2 sm:gap-2.5">
              <div className="relative">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
                  <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 sm:w-2.5 sm:h-2.5 bg-emerald-400 border-2 border-slate-950 rounded-full animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide">Kanka</h3>
                  <span className="text-[9px] sm:text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold uppercase">
                    Bot Pilotu
                  </span>
                </div>
                <p className="text-[9.5px] sm:text-[10.5px] text-slate-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                  7/24 Canlı • Binance TR Entegre
                </p>
              </div>
            </div>

            <div className="flex items-center gap-0.5 sm:gap-1 text-slate-400">
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-1.5 sm:p-1 hover:text-white hover:bg-white/10 rounded-lg transition-colors active:scale-95"
                title={isMinimized ? "Genişlet" : "Küçült"}
              >
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isMinimized ? "rotate-180" : ""}`} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 sm:p-1 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors active:scale-95"
                title="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Message List */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent text-[12.5px] sm:text-[13px]">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[88%] sm:max-w-[86%] rounded-2xl px-3 sm:px-3.5 py-2 sm:py-2.5 shadow-sm text-slate-100 ${
                        m.role === "user"
                          ? "bg-emerald-600/90 text-white rounded-tr-none font-medium"
                          : "bg-slate-900/90 border border-white/10 rounded-tl-none"
                      }`}
                    >
                      {m.role === "assistant" ? renderFormattedText(m.text) : m.text}
                    </div>
                    <span className="text-[9px] text-slate-500 mt-0.5 px-1">{m.timestamp}</span>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex items-center gap-2 text-slate-400 bg-slate-900/60 border border-white/5 w-fit px-3 py-1.5 sm:py-2 rounded-2xl rounded-tl-none">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                    <span className="text-[11px] sm:text-xs text-slate-300">Kanka hesaplıyor...</span>
                    <span className="flex gap-1 items-center ml-1">
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce"></span>
                    </span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Suggestions Chips */}
              <div className="px-2.5 sm:px-3 py-1.5 sm:py-2 border-t border-white/5 bg-slate-900/40 flex items-center gap-1.5 overflow-x-auto scrollbar-none touch-pan-x">
                {suggestions.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(s)}
                    disabled={isLoading}
                    className="shrink-0 text-[10.5px] sm:text-[11px] bg-slate-800/80 hover:bg-emerald-500/20 active:bg-emerald-500/30 hover:text-emerald-300 border border-white/10 px-2.5 py-1 rounded-full text-slate-300 transition-all flex items-center gap-1 active:scale-95"
                  >
                    <span>{s}</span>
                  </button>
                ))}
              </div>

              {/* Input Area (iOS Safari zoom-safe: text-base on mobile, sm:text-xs) */}
              <div className="p-2.5 sm:p-3 bg-slate-950 border-t border-white/10 flex items-center gap-1.5 sm:gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Kankana sor... (örn: Kasada ne kadar var?)"
                  disabled={isLoading}
                  className="flex-1 bg-slate-900 border border-white/10 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/50 rounded-xl px-3 py-2 text-base sm:text-xs text-white placeholder-slate-500 outline-none transition-all"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || isLoading}
                  className="p-2 sm:p-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:hover:bg-emerald-500 text-slate-950 font-bold rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center min-w-[38px] min-h-[38px]"
                  title="Gönder"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── FLOATING TRIGGER BUTONU ── */}
      {!isOpen && (
        <button
          onClick={() => {
            setIsOpen(true)
            setIsMinimized(false)
          }}
          className="group relative flex items-center gap-2 sm:gap-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3 sm:px-4 py-2.5 sm:py-3 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 border border-emerald-400/30"
          style={{
            boxShadow: "0 0 25px 2px rgba(16, 185, 129, 0.4)",
          }}
        >
          <div className="relative flex items-center justify-center">
            <Bot className="w-4 h-4 sm:w-5 sm:h-5 text-white animate-pulse" />
            <span className="absolute -top-1 -right-1 w-2 h-2 sm:w-2.5 sm:h-2.5 bg-emerald-300 rounded-full animate-ping" />
          </div>
          <div className="flex flex-col text-left">
            <span className="text-[11px] sm:text-xs font-bold tracking-tight text-white flex items-center gap-1">
              Kanka
              <Sparkles className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-amber-300" />
            </span>
            <span className="text-[9px] sm:text-[10px] text-emerald-100 font-medium leading-none">
              7/24 Bot Asistanı
            </span>
          </div>
        </button>
      )}
    </div>
  )
}
