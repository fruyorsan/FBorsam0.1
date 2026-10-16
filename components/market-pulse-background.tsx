"use client"

import { useEffect, useRef } from "react"

// Fast Perlin Noise implementation for Topographic Contour lines
class FastPerlin {
  private p: Uint8Array

  constructor(seed = 42) {
    this.p = new Uint8Array(512)
    const perm = new Uint8Array(256)
    for (let i = 0; i < 256; i++) perm[i] = i
    let s = seed
    for (let i = 255; i > 0; i--) {
      s = (s * 16807 + 11) % 2147483647
      const j = s % (i + 1)
      const tmp = perm[i]
      perm[i] = perm[j]
      perm[j] = tmp
    }
    for (let i = 0; i < 512; i++) {
      this.p[i] = perm[i & 255]
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10)
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a)
  }

  private grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15
    const u = h < 8 ? x : y
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
  }

  noise3D(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const Z = Math.floor(z) & 255

    x -= Math.floor(x)
    y -= Math.floor(y)
    z -= Math.floor(z)

    const u = this.fade(x)
    const v = this.fade(y)
    const w = this.fade(z)

    const p = this.p
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z

    return this.lerp(
      w,
      this.lerp(
        v,
        this.lerp(u, this.grad(p[AA], x, y, z), this.grad(p[BA], x - 1, y, z)),
        this.lerp(u, this.grad(p[AB], x, y - 1, z), this.grad(p[BB], x - 1, y - 1, z))
      ),
      this.lerp(
        v,
        this.lerp(u, this.grad(p[AA + 1], x, y, z - 1), this.grad(p[BA + 1], x - 1, y, z - 1)),
        this.lerp(u, this.grad(p[AB + 1], x, y - 1, z - 1), this.grad(p[BB + 1], x - 1, y - 1, z - 1))
      )
    )
  }

  // Fractal Brownian Motion for multi-scale natural topography
  fbm(x: number, y: number, z: number): number {
    const n1 = this.noise3D(x, y, z)
    const n2 = this.noise3D(x * 2.1, y * 2.1, z * 1.5) * 0.45
    return (n1 + n2) / 1.45
  }
}

export function MarketPulseBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d", { alpha: true }) as CanvasRenderingContext2D
    if (!ctx) return

    let animationFrameId: number
    let width = 0
    let height = 0
    let dpr = 1

    // Noise Generator for Topographic Contour Waves
    const perlin = new FastPerlin(888)

    // Topographic Grid configuration
    const cellSize = 22
    let topoCols = 0
    let topoRows = 0
    let topoGrid = new Float32Array(0)

    // 14 Smooth Contour Elevation Levels
    const contourLevels = [
      0.12, 0.18, 0.24, 0.30, 0.37, 0.44, 0.51,
      0.58, 0.65, 0.72, 0.79, 0.85, 0.91, 0.96,
    ]

    function initChart() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas!.width = width * dpr
      canvas!.height = height * dpr
      canvas!.style.width = `${width}px`
      canvas!.style.height = `${height}px`

      // Setup Topographic Grid
      topoCols = Math.ceil(width / cellSize) + 2
      topoRows = Math.ceil(height / cellSize) + 2
      topoGrid = new Float32Array(topoCols * topoRows)
    }

    initChart()

    const handleResize = () => {
      initChart()
    }
    window.addEventListener("resize", handleResize)

    let lastTime = 0
    function render(currentTime: number) {
      animationFrameId = requestAnimationFrame(render)

      // Sekme arka planda ise veya 30 FPS (~33ms) geçmediyse CPU harcama
      if (typeof document !== "undefined" && document.hidden) return
      if (currentTime - lastTime < 33) return
      lastTime = currentTime

      const timeSec = currentTime * 0.001

      // Clear Canvas
      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, width, height)

      // ----------------------------------------------------------------------
      // TOPOGRAPHIC CONTOUR WAVES (Sadece bu saf dalga modeli - mousepad deseni)
      // ----------------------------------------------------------------------
      const topoTime = timeSec * 0.15
      const driftX = timeSec * 0.035
      const driftY = Math.sin(timeSec * 0.08) * 0.14

      for (let y = 0; y < topoRows; y++) {
        const rowOffset = y * topoCols
        const ny = (y / topoRows) * 2.4 + driftY
        for (let x = 0; x < topoCols; x++) {
          const nx = (x / topoCols) * 3.6 + driftX
          const h = (perlin.fbm(nx, ny, topoTime) + 1) * 0.5
          topoGrid[rowOffset + x] = h
        }
      }

      ctx.lineCap = "round"
      ctx.lineJoin = "round"

      const majorPath = new Path2D()
      const minorPath = new Path2D()

      for (let y = 0; y < topoRows - 1; y++) {
        const r0 = y * topoCols
        const r1 = (y + 1) * topoCols
        const y0 = y * cellSize
        const y1 = (y + 1) * cellSize

        for (let x = 0; x < topoCols - 1; x++) {
          const x0 = x * cellSize
          const x1 = (x + 1) * cellSize

          const vTL = topoGrid[r0 + x]
          const vTR = topoGrid[r0 + x + 1]
          const vBL = topoGrid[r1 + x]
          const vBR = topoGrid[r1 + x + 1]

          const minV = Math.min(vTL, vTR, vBL, vBR)
          const maxV = Math.max(vTL, vTR, vBL, vBR)

          for (let l = 0; l < contourLevels.length; l++) {
            const k = contourLevels[l]
            if (k < minV || k > maxV) continue

            const bTL = vTL >= k ? 8 : 0
            const bTR = vTR >= k ? 4 : 0
            const bBR = vBR >= k ? 2 : 0
            const bBL = vBL >= k ? 1 : 0
            const cellCase = bTL | bTR | bBR | bBL

            if (cellCase === 0 || cellCase === 15) continue

            const tTop = (k - vTL) / (vTR - vTL || 0.0001)
            const pTopX = x0 + tTop * cellSize
            const pTopY = y0

            const tRight = (k - vTR) / (vBR - vTR || 0.0001)
            const pRightX = x1
            const pRightY = y0 + tRight * cellSize

            const tBottom = (k - vBL) / (vBR - vBL || 0.0001)
            const pBottomX = x0 + tBottom * cellSize
            const pBottomY = y1

            const tLeft = (k - vTL) / (vBL - vTL || 0.0001)
            const pLeftX = x0
            const pLeftY = y0 + tLeft * cellSize

            const targetPath = l % 3 === 0 ? majorPath : minorPath

            switch (cellCase) {
              case 1:
              case 14:
                targetPath.moveTo(pBottomX, pBottomY)
                targetPath.lineTo(pLeftX, pLeftY)
                break
              case 2:
              case 13:
                targetPath.moveTo(pRightX, pRightY)
                targetPath.lineTo(pBottomX, pBottomY)
                break
              case 3:
              case 12:
                targetPath.moveTo(pLeftX, pLeftY)
                targetPath.lineTo(pRightX, pRightY)
                break
              case 4:
              case 11:
                targetPath.moveTo(pTopX, pTopY)
                targetPath.lineTo(pRightX, pRightY)
                break
              case 5:
                targetPath.moveTo(pTopX, pTopY)
                targetPath.lineTo(pLeftX, pLeftY)
                targetPath.moveTo(pBottomX, pBottomY)
                targetPath.lineTo(pRightX, pRightY)
                break
              case 6:
              case 9:
                targetPath.moveTo(pTopX, pTopY)
                targetPath.lineTo(pBottomX, pBottomY)
                break
              case 7:
              case 8:
                targetPath.moveTo(pTopX, pTopY)
                targetPath.lineTo(pLeftX, pLeftY)
                break
              case 10:
                targetPath.moveTo(pTopX, pTopY)
                targetPath.lineTo(pRightX, pRightY)
                targetPath.moveTo(pBottomX, pBottomY)
                targetPath.lineTo(pLeftX, pLeftY)
                break
            }
          }
        }
      }

      // Draw Minor Topographic Lines (Hassas, ince izohips çizgileri)
      ctx.strokeStyle = "rgba(255, 255, 255, 0.20)"
      ctx.lineWidth = 1.0
      ctx.stroke(minorPath)

      // Draw Major Topographic Lines (Görseldeki belirgin, parlak beyaz izohips çizgileri)
      ctx.strokeStyle = "rgba(255, 255, 255, 0.50)"
      ctx.lineWidth = 1.8
      ctx.stroke(majorPath)

      ctx.restore()
    }

    animationFrameId = requestAnimationFrame(render)

    return () => {
      window.removeEventListener("resize", handleResize)
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none"
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full opacity-90 transition-opacity duration-700"
      />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background via-background/40 to-transparent pointer-events-none" />
    </div>
  )
}
