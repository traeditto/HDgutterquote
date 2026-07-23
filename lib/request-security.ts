import "server-only"

import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import {
  allowPlatformRequest,
  platformStorageConfigured,
} from "@/lib/contractor-platform"

const localBuckets = new Map<string, { count: number; resetAt: number }>()

export function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    request.headers.get("x-real-ip") ||
    "unknown"
  )
    .trim()
    .slice(0, 100)
}

function privacyHash(value: string) {
  const pepper = process.env.PLATFORM_SESSION_SECRET || "development-only"
  return createHash("sha256").update(`${pepper}:${value}`).digest("hex")
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) return process.env.NODE_ENV !== "production"

  try {
    const expectedHost =
      request.headers.get("x-forwarded-host") || request.headers.get("host")
    return Boolean(
      expectedHost &&
        new URL(origin).host.toLowerCase() === expectedHost.toLowerCase(),
    )
  } catch {
    return false
  }
}

export async function checkRateLimit(input: {
  request: Request
  scope: string
  identifier?: string
  limit: number
  windowSeconds: number
}) {
  const identity = input.identifier || clientIp(input.request)

  if (platformStorageConfigured()) {
    try {
      const allowed = await allowPlatformRequest(
        `request:${input.scope}`,
        identity,
        input.limit,
        input.windowSeconds,
      )
      return {
        allowed,
        remaining: allowed ? 1 : 0,
        retryAfter: input.windowSeconds,
      }
    } catch {
      // Preserve request protection during a transient Redis outage by using
      // the per-instance limiter below.
    }
  }

  const key = `${input.scope}:${privacyHash(identity)}`
  const now = Date.now()
  const current = localBuckets.get(key)

  if (!current || current.resetAt <= now) {
    localBuckets.set(key, {
      count: 1,
      resetAt: now + input.windowSeconds * 1000,
    })
    return {
      allowed: true,
      remaining: input.limit - 1,
      retryAfter: input.windowSeconds,
    }
  }

  current.count += 1
  return {
    allowed: current.count <= input.limit,
    remaining: Math.max(0, input.limit - current.count),
    retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  }
}

export function rateLimitResponse(retryAfter: number) {
  return NextResponse.json(
    {
      code: "RATE_LIMITED",
      error: "Too many requests. Please wait and try again.",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    },
  )
}
