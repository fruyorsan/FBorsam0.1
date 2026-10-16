"use client"

import { useEffect, useRef } from "react"
import { EARTH_CONTINENT_DOTS } from "./earth-data"

/**
 * DottedGlobeBackground
 * ─────────────────────────────────────────────────────────────────────────────
 * Gerçek Dünya Kıtaları (Avrupa, Asya, Amerika, Afrika) Koordinatlarından
 * Üretilen 3D Noktasal Dönen Dünya Küresi.
 * 
 * Özellikler:
 * 1. Gerçek dünya haritası silüeti (kıtalar noktasal olarak birebir görünür)
 * 2. -z-10 ile KESİNLİKLE yazıların, kartların ve butonların arkasında kalır
 * 3. Saydamlık %35-40'a çekilerek gözü yormayan siber-finansal atmosfer yaratıldı
 * 4. 0 KB harici paket, 0% CPU uyku modu
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface Point3D {
  x: number
  y: number
  z: number
  isHighlight?: boolean
  isRing?: boolean
}

interface StarNode {
  x: number
  y: number
  size: number
  baseAlpha: number
  speed: number
  phase: number
}

export function DottedGlobeBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d", { alpha: true })
    if (!ctx) return

    let animId: number
    let width = (canvas.width = window.innerWidth)
    let height = (canvas.height = window.innerHeight)

    // 1. Gerçek Dünya Kıtaları Noktaları (845 Nokta)
    const points: Point3D[] = EARTH_CONTINENT_DOTS.map(([x, y, z], i) => ({
      x,
      y,
      z,
      isHighlight: i % 8 === 0,
    }))

    // 2. Ekvator ve Enlem Halkaları (Küre hissini ve derinliği güçlendiren hafif referans çizgileri)
    const ringSteps = 48
    for (let i = 0; i < ringSteps; i++) {
      const theta = (i / ringSteps) * Math.PI * 2
      // Ekvator
      points.push({
        x: Math.cos(theta),
        y: 0,
        z: Math.sin(theta),
        isRing: true,
      })
      // Kuzey Enlemi (Yengeç)
      const rTropics = Math.cos(0.4)
      points.push({
        x: Math.cos(theta) * rTropics,
        y: Math.sin(0.4),
        z: Math.sin(theta) * rTropics,
        isRing: true,
      })
      // Güney Enlemi (Oğlak)
      points.push({
        x: Math.cos(theta) * rTropics,
        y: -Math.sin(0.4),
        z: Math.sin(theta) * rTropics,
        isRing: true,
      })
    }

    // 2. Bütün ekrana yayılan ortam parçacıkları (Tüm ekran koordinatlarına dağılır)
    const starNodes: StarNode[] = []
    const totalStars = 110
    for (let i = 0; i < totalStars; i++) {
      starNodes.push({
        x: Math.random(),
        y: Math.random(),
        size: 0.8 + Math.random() * 1.5,
        baseAlpha: 0.15 + Math.random() * 0.35,
        speed: 0.4 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
      })
    }

    let rotationY = 0
    const rotationX = 0.22
    let isVisible = true

    const handleVisibility = () => {
      isVisible = !document.hidden
      if (isVisible) {
        lastTime = performance.now()
        animId = requestAnimationFrame(render)
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)

    const handleResize = () => {
      if (!canvas) return
      width = canvas.width = window.innerWidth
      height = canvas.height = window.innerHeight
    }
    window.addEventListener("resize", handleResize, { passive: true })

    let lastTime = performance.now()

    function render(time: number) {
      if (!isVisible || !ctx) return

      const delta = Math.min((time - lastTime) / 1000, 0.1)
      lastTime = time

      rotationY += delta * 0.15

      ctx.clearRect(0, 0, width, height)

      // ─── 1. BÜTÜN EKRANA YAYILAN ARKA PLAN PARÇACIKLARI (Ekranın Dört Bir Yanı) ───
      for (let i = 0; i < starNodes.length; i++) {
        const star = starNodes[i]
        const pulse = Math.sin(time * 0.0018 * star.speed + star.phase)
        const alpha = Math.max(0.08, star.baseAlpha + pulse * 0.14)
        const px = star.x * width
        const py = star.y * height

        ctx.beginPath()
        ctx.arc(px, py, star.size, 0, Math.PI * 2)
        ctx.fillStyle = i % 4 === 0
          ? `rgba(52, 211, 153, ${alpha * 0.85})`
          : `rgba(45, 212, 191, ${alpha * 0.65})`
        ctx.fill()
      }

      // ─── 2. TAM EKRAN MERKEZLİ 3D DÜNYA KÜRESİ (Bütün Ekranı Kapsayan Büyüklük) ───
      const centerX = width * 0.5
      const centerY = height * 0.5
      const isMobile = width < 768
      const globeRadius = isMobile
        ? Math.min(width, height) * 0.48
        : Math.max(Math.min(width * 0.44, height * 0.58), 290)

      const cosY = Math.cos(rotationY)
      const sinY = Math.sin(rotationY)
      const cosX = Math.cos(rotationX)
      const sinX = Math.sin(rotationX)

      // Arka plan küresel finans aurası (tam merkezde)
      const auraGradient = ctx.createRadialGradient(
        centerX,
        centerY,
        globeRadius * 0.15,
        centerX,
        centerY,
        globeRadius * 1.25
      )
      auraGradient.addColorStop(0, "rgba(16, 185, 129, 0.06)")
      auraGradient.addColorStop(0.6, "rgba(6, 182, 212, 0.025)")
      auraGradient.addColorStop(1, "rgba(0, 0, 0, 0)")
      ctx.fillStyle = auraGradient
      ctx.beginPath()
      ctx.arc(centerX, centerY, globeRadius * 1.25, 0, Math.PI * 2)
      ctx.fill()

      const projected: Array<{
        sx: number
        sy: number
        size: number
        alpha: number
        isHighlight?: boolean
        isRing?: boolean
        depth: number
      }> = []

      for (let i = 0; i < points.length; i++) {
        const p = points[i]

        const x1 = p.x * cosY - p.z * sinY
        const z1 = p.x * sinY + p.z * cosY

        const y2 = p.y * cosX - z1 * sinX
        const z2 = p.y * sinX + z1 * cosX

        const fov = 2.4
        const scale = fov / (fov + z2)
        const sx = centerX + x1 * globeRadius * scale
        const sy = centerY + y2 * globeRadius * scale

        const depthNorm = (z2 + 1) / 2
        const alpha = Math.max(0.08, Math.pow(depthNorm, 1.6) * 0.8)
        const size = Math.max(1.0, (0.8 + depthNorm * 1.8) * (p.isHighlight ? 1.6 : 1.0))

        projected.push({
          sx,
          sy,
          size,
          alpha,
          isHighlight: p.isHighlight,
          isRing: p.isRing,
          depth: z2,
        })
      }

      projected.sort((a, b) => a.depth - b.depth)

      for (let i = 0; i < projected.length; i++) {
        const pt = projected[i]

        ctx.beginPath()
        ctx.arc(pt.sx, pt.sy, pt.size, 0, Math.PI * 2)

        if (pt.isHighlight && pt.depth > 0.1) {
          ctx.fillStyle = "rgba(52, 211, 153, " + Math.min(1.0, pt.alpha * 1.5) + ")"
          ctx.shadowColor = "rgba(52, 211, 153, 0.6)"
          ctx.shadowBlur = 5
        } else if (pt.depth > 0) {
          ctx.fillStyle = pt.isRing
            ? "rgba(148, 163, 184, " + (pt.alpha * 0.25) + ")"
            : "rgba(45, 212, 191, " + (pt.alpha * 0.85) + ")"
          ctx.shadowBlur = 0
        } else {
          ctx.fillStyle = "rgba(148, 163, 184, " + (pt.alpha * 0.2) + ")"
          ctx.shadowBlur = 0
        }

        ctx.fill()
      }

      ctx.shadowBlur = 0
      animId = requestAnimationFrame(render)
    }

    animId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener("resize", handleResize)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none -z-10 overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full opacity-45 dark:opacity-55 transition-opacity duration-1000"
      />
    </div>
  )
}
