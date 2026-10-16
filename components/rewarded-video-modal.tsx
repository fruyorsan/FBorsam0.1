"use client"

import React, { useState, useEffect } from "react"
import { Play, ShieldAlert, Sparkles, X, Volume2, VolumeX, CheckCircle, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"

interface RewardedVideoModalProps {
  isOpen: boolean
  onClose: () => void
  onRewardGranted: () => void
  newsTitle?: string
  source?: string
}

export function RewardedVideoModal({
  isOpen,
  onClose,
  onRewardGranted,
  newsTitle,
  source
}: RewardedVideoModalProps) {
  const [countdown, setCountdown] = useState(15) // Maks CPM için 15 saniye ideal süre
  const [isPlaying, setIsPlaying] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)
  const [isMuted, setIsMuted] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setCountdown(15)
      setIsPlaying(false)
      setIsCompleted(false)
      return
    }

    // Modal açıldığında reklam başlar
    setIsPlaying(true)
  }, [isOpen])

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (isOpen && isPlaying && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            setIsCompleted(true)
            clearInterval(timer)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(timer)
  }, [isOpen, isPlaying, countdown])

  if (!isOpen) return null

  const handleClaimReward = () => {
    onRewardGranted()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-primary/40 bg-zinc-950 text-white shadow-2xl shadow-primary/20">
        
        {/* Üst Bilgi Başlığı */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded bg-primary/20 text-xs font-bold text-primary">
              <Sparkles className="size-3.5" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-primary">
                Sponsorlu Piyasa Analiz Yayını
              </p>
              <p className="text-[10px] text-zinc-400">Yüksek Getirili Sponsor Gösterimi</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Sessize Alma */}
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
              title={isMuted ? "Sesi Aç" : "Sessize Al"}
            >
              {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>

            {/* İptal / Kapat Butonu (Sadece reklam bittiğinde veya ceza uyarısıyla) */}
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
              title="Kapat"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Video Oynatıcı Alanı (Buraya Google Ad Manager veya VAST/Adsterra video etiketleri de bağlanabilir) */}
        <div className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden">
          {/* Arka plan video canlandırması / Gerçek Sponsor Video */}
          <div className="absolute inset-0 bg-gradient-to-tr from-emerald-950/40 via-zinc-900 to-indigo-950/50 flex flex-col items-center justify-center p-6 text-center">
            
            {/* Animasyonlu Sponsor Kartı */}
            <div className="relative z-10 flex flex-col items-center space-y-3">
              <div className="size-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center shadow-lg shadow-primary/20 animate-pulse">
                <Play className="size-8 text-primary fill-primary ml-1" />
              </div>
              <div className="space-y-1">
                <span className="inline-block rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-bold text-emerald-400 border border-emerald-500/30">
                  Global Finans & Borsa Partneri
                </span>
                <h4 className="text-sm font-semibold text-zinc-200">
                  Tier-1 Sponsorlu İçerik Yayınlanıyor
                </h4>
              </div>
            </div>

            {/* Arka plan dekoratif çizgiler */}
            <div className="absolute -inset-10 opacity-20 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:16px_16px]" />
          </div>

          {/* Sayaç Rozeti (Geri Sayım) */}
          <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 rounded-full bg-black/80 backdrop-blur-md px-3 py-1 border border-zinc-700 text-xs font-mono font-bold">
            {countdown > 0 ? (
              <>
                <span className="size-2 rounded-full bg-amber-400 animate-ping" />
                <span className="text-amber-300">Ödül için: {countdown} sn</span>
              </>
            ) : (
              <>
                <CheckCircle className="size-3.5 text-emerald-400" />
                <span className="text-emerald-300">Ödül Hak Edildi!</span>
              </>
            )}
          </div>

          {/* İlerleme Çubuğu */}
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-800 z-20">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-primary transition-all duration-1000"
              style={{ width: `${((15 - countdown) / 15) * 100}%` }}
            />
          </div>
        </div>

        {/* Alt İçerik Bilgisi */}
        <div className="p-4 space-y-3 bg-zinc-950">
          <div className="flex items-start gap-2.5">
            <Lock className="size-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <span className="font-bold text-zinc-300">Açılacak Haber & Özel Analiz:</span>
              <p className="text-zinc-400 line-clamp-1 italic">
                "{newsTitle || "Finans ve Borsa Özel Analizi"}"
              </p>
            </div>
          </div>

          {/* Buton Alanı */}
          <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
            <p className="text-[11px] text-zinc-500">
              {countdown > 0
                ? "Videoyu tamamlayarak haber analizinin kilidini açın."
                : "Tebrikler! Analizin kilidi açıldı."}
            </p>

            {countdown > 0 ? (
              <Button disabled size="sm" variant="outline" className="text-xs border-zinc-700 text-zinc-400">
                Lütfen Bekleyin ({countdown}s)
              </Button>
            ) : (
              <Button
                onClick={handleClaimReward}
                size="sm"
                className="text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950"
              >
                Haberin Kilidini Aç
              </Button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
