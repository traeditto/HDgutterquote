import { NextResponse } from "next/server"
import {
  allowPlatformRequest,
  platformStorageConfigured,
  recordQuoteActivity,
  type QuoteActivityStage,
} from "@/lib/contractor-platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STAGES = new Set<QuoteActivityStage>([
  "address-entered",
  "measurement-started",
  "measured",
  "measurement-unavailable",
  "out-of-area",
  "lead-submitted",
  "quote-viewed",
])

export async function POST(request: Request) {
  if (!platformStorageConfigured()) return NextResponse.json({ ok: true, stored: false })
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  if (!(await allowPlatformRequest("address-events", client, 60, 60))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 })
  }
  try {
    const body = await request.json()
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : ""
    const address = typeof body?.address === "string" ? body.address.trim() : ""
    const stage = body?.stage as QuoteActivityStage
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(sessionId) || address.length < 5 || address.length > 240 || !STAGES.has(stage)) {
      return NextResponse.json({ error: "Invalid address activity." }, { status: 400 })
    }
    await recordQuoteActivity({
      sessionId,
      address,
      stage,
      name: typeof body?.name === "string" ? body.name.trim().slice(0, 120) : undefined,
      email: typeof body?.email === "string" ? body.email.trim().slice(0, 200) : undefined,
      phone: typeof body?.phone === "string" ? body.phone.trim().slice(0, 40) : undefined,
    })
    return NextResponse.json({ ok: true, stored: true })
  } catch {
    return NextResponse.json({ error: "Address activity could not be recorded." }, { status: 502 })
  }
}
