'use client'

import { useEffect } from 'react'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Terminal runtime error caught:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center bg-background text-foreground">
      <div className="max-w-md rounded-2xl border border-border/80 bg-card/90 p-8 shadow-2xl backdrop-blur-md space-y-4">
        <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-warning/15 text-warning font-bold text-xl">
          ⚡
        </div>
        <h2 className="text-lg font-black tracking-tight text-foreground">Terminal Görünümü Yenileniyor</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Eski bir önbellek verisi nedeniyle sayfa yüklenirken geçici bir durum oluştu. Aşağıdaki butona tıklayarak terminali sıfırdan sorunsuz başlatabilirsiniz.
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.removeItem('piyasaiq:last_view')
                localStorage.removeItem('piyasaiq:crypto_bot_tl_v3')
                sessionStorage.clear()
              } catch {}
              window.location.href = '/'
            }}
            className="w-full rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground shadow-lg hover:bg-primary/90 transition-all active:scale-[0.98]"
          >
            Önbelleği Temizle & Terminali Aç
          </button>
          <button
            type="button"
            onClick={() => reset()}
            className="w-full rounded-xl border border-border/80 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
          >
            Sayfayı Yenile
          </button>
        </div>
      </div>
    </div>
  )
}
