import { NextResponse } from "next/server"
import {
  allowPlatformRequest,
  contractorTenantId,
  platformStorageConfigured,
  recordQuoteActivity,
  type QuoteActivityStage,
} from "@/lib/contractor-platform"
import { verifyAddressToken } from "@/lib/address-verification"

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
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  if (!(await allowPlatformRequest("address-events", client, 60, 60))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 })
  }
  try {
    const body = await request.json()
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : ""
    const addressToken = typeof body?.addressToken === "string" ? body.addressToken.trim() : ""
    const stage = body?.stage as QuoteActivityStage
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(sessionId) || addressToken.length < 20 || addressToken.length > 2_000 || !STAGES.has(stage)) {
      return NextResponse.json({ error: "Invalid address activity." }, { status: 400 })
    }
    const verified = verifyAddressToken(addressToken, contractorTenantId(), sessionId)
    if (!verified) {
      return NextResponse.json({ error: "The verified property address is invalid or expired." }, { status: 400 })
    }
    if (!platformStorageConfigured()) return NextResponse.json({ ok: true, stored: false })
    await recordQuoteActivity({
      sessionId,
      address: verified.formattedAddress,
      state: verified.state,
      county: verified.county,
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
