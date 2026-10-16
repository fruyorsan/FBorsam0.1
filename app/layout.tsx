import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Script from 'next/script'

import { BotAssistantWidget } from '@/components/bot-assistant-widget'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'F-Borsam | Piyasa Analiz Terminali',
  description: 'BIST hisseleri, endeksler, teknik indikatörler, haber akışı ve yapay zekâ destekli F-Borsam piyasa analizi.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#080d12',
  userScalable: true,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="tr" className="dark bg-background">
      <head />
      <body className={`${geist.variable} ${geistMono.variable} font-sans antialiased`}>
        {/* Google AdSense: lazyOnload ile sayfa etkileşiminden sonra yüklenir */}
        <Script
          id="google-adsense"
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7408039647903472"
          strategy="lazyOnload"
          crossOrigin="anonymous"
        />
        {children}
        <BotAssistantWidget />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}

