import { type NextRequest } from "next/server"

interface RateLimitRecord {
  count: number
  resetTime: number
}

// In-memory rate limiting store
const rateLimitMap = new Map<string, RateLimitRecord>()

// Periodic garbage collection every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now()
    for (const [key, record] of rateLimitMap.entries()) {
      if (now > record.resetTime) {
        rateLimitMap.delete(key)
      }
    }
  }, 5 * 60 * 1000).unref?.()
}

/**
 * Extract client IP from headers or request
 */
export function getClientIp(request: Request | NextRequest): string {
  const headers = request.headers
  const xForwardedFor = headers.get("x-forwarded-for")
  if (xForwardedFor) {
    return xForwardedFor.split(",")[0].trim()
  }
  const cfConnectingIp = headers.get("cf-connecting-ip")
  if (cfConnectingIp) {
    return cfConnectingIp.trim()
  }
  const xRealIp = headers.get("x-real-ip")
  if (xRealIp) {
    return xRealIp.trim()
  }
  return "127.0.0.1"
}

/**
 * In-memory sliding window rate limiter
 * @param key unique identifier (e.g. "market:192.168.1.1")
 * @param limit maximum allowed requests in window
 * @param windowMs window duration in milliseconds
 */
export function checkRateLimit(
  key: string,
  limit = 60,
  windowMs = 60 * 1000
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now()
  const record = rateLimitMap.get(key)

  if (!record || now > record.resetTime) {
    const newRecord: RateLimitRecord = {
      count: 1,
      resetTime: now + windowMs,
    }
    rateLimitMap.set(key, newRecord)
    return {
      allowed: true,
      remaining: limit - 1,
      resetTime: newRecord.resetTime,
    }
  }

  record.count += 1
  const allowed = record.count <= limit
  const remaining = Math.max(0, limit - record.count)

  return {
    allowed,
    remaining,
    resetTime: record.resetTime,
  }
}

/**
 * Returns a standardized 429 Too Many Requests response
 */
export function rateLimitResponse(resetTime: number): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000))
  return Response.json(
    {
      error: "Çok fazla istek gönderildi. Lütfen bir süre bekleyin.",
      retryAfter: retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Reset": String(resetTime),
      },
    }
  )
}

/**
 * Validates and sanitizes a financial symbol
 */
export function sanitizeSymbol(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.trim().toUpperCase()
  if (/^[A-Z0-9._-]{1,20}$/.test(cleaned)) {
    return cleaned
  }
  return null
}

/**
 * Validates and sanitizes chart interval parameter
 */
export function sanitizeInterval(raw: string | null | undefined): "1m" | "5m" | "15m" | "1h" | "1d" {
  if (!raw) return "1d"
  const cleaned = raw.trim().toLowerCase()
  if (["1m", "5m", "15m", "1h", "1d"].includes(cleaned)) {
    return cleaned as "1m" | "5m" | "15m" | "1h" | "1d"
  }
  return "1d"
}

/**
 * Sanitizes search input to prevent injection
 */
export function sanitizeSearchQuery(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw.trim().slice(0, 50).replace(/[<>'"\/&;]/g, "")
}
