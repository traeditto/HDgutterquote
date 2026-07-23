import { NextRequest, NextResponse } from "next/server"
import { verifyAddressToken } from "@/lib/address-verification"
import {
  contractorTenantId,
  platformStorageConfigured,
  quoteSessionExists,
} from "@/lib/contractor-platform"
import { fetchStreetViewMetadata } from "@/lib/roof-imagery"
import {
  checkRateLimit,
  rateLimitResponse,
  sameOrigin,
} from "@/lib/request-security"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Body = { sessionId?: string; addressToken?: string }

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-site Street View requests are not allowed." },
      { status: 403 },
    )
  }

  let body: Body
  try {
    body = await request.json() as Body
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const sessionId = body.sessionId?.trim() || ""
  const addressToken = body.addressToken?.trim() || ""
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(sessionId) || addressToken.length < 20 || addressToken.length > 2_000) {
    return NextResponse.json({ error: "A verified quote session is required." }, { status: 400 })
  }

  try {
    const verified = verifyAddressToken(addressToken, contractorTenantId(), sessionId)
    if (!verified) {
      return NextResponse.json({ error: "The verified quote session is invalid or expired." }, { status: 400 })
    }
    if (!platformStorageConfigured()) {
      return NextResponse.json(
        { error: "Rendering session storage is not configured." },
        { status: 503 },
      )
    }
    if (!(await quoteSessionExists(sessionId))) {
      return NextResponse.json(
        { error: "Save the property address before requesting Street View." },
        { status: 400 },
      )
    }
    const rate = await checkRateLimit({
      request,
      scope: "streetview-metadata",
      identifier: `${contractorTenantId()}:${sessionId}`,
      limit: 12,
      windowSeconds: 3600,
    })
    if (!rate.allowed) return rateLimitResponse(rate.retryAfter)

    const metadata = await fetchStreetViewMetadata(verified.formattedAddress)
    return NextResponse.json(metadata)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Street View availability could not be checked."
    return NextResponse.json({ available: false, error: message }, { status: 503 })
  }
}
