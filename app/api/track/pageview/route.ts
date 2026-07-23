import { NextRequest, NextResponse } from "next/server"
import { sendCapiEvent } from "@/lib/meta-capi"
import {
  checkRateLimit,
  rateLimitResponse,
  sameOrigin,
} from "@/lib/request-security"

export const runtime = "nodejs"

interface PageViewPayload {
  /** Shared id so Meta dedupes this against the browser pixel PageView. */
  eventId?: string
  /** URL the visit happened on, for attribution. */
  eventSourceUrl?: string
}

/** Read a single cookie value from a Cookie header string. */
function readCookie(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return undefined
}

/**
 * Fires a server-side Meta Conversions API "PageView" on website visit. Shares
 * an eventId with the browser pixel PageView so Meta collapses them into one.
 * Fire-and-forget: always returns ok so it never affects the page.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-site tracking requests are not allowed." },
      { status: 403 },
    )
  }
  const rate = await checkRateLimit({
    request,
    scope: "pageview",
    limit: 120,
    windowSeconds: 60,
  })
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter)

  let payload: PageViewPayload = {}
  try {
    payload = (await request.json()) as PageViewPayload
  } catch {
    // Empty/invalid body is fine — we still fire with a generated id below.
  }

  const cookieHeader = request.headers.get("cookie") ?? ""
  const forwardedFor = request.headers.get("x-forwarded-for") ?? ""
  const ip = forwardedFor.split(",")[0]?.trim() || undefined

  void sendCapiEvent({
    eventName: "PageView",
    eventId: payload.eventId || crypto.randomUUID(),
    eventSourceUrl: payload.eventSourceUrl,
    user: {
      fbp: readCookie(cookieHeader, "_fbp"),
      fbc: readCookie(cookieHeader, "_fbc"),
      ip,
      userAgent: request.headers.get("user-agent") ?? undefined,
    },
  })

  return NextResponse.json({ ok: true })
}
