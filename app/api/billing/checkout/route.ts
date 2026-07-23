import { NextRequest, NextResponse } from "next/server"
import {
  CONTRACTOR_COOKIE,
  readContractorSession,
} from "@/lib/contractor-auth"
import { contractorTenantId } from "@/lib/contractor-platform"
import {
  checkRateLimit,
  rateLimitResponse,
  sameOrigin,
} from "@/lib/request-security"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-site checkout requests are not allowed." },
      { status: 403 },
    )
  }
  let sessionTenant: string | null = null
  try {
    sessionTenant = readContractorSession(
      request.cookies.get(CONTRACTOR_COOKIE)?.value,
    )
  } catch {
    sessionTenant = null
  }
  if (sessionTenant !== contractorTenantId()) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }
  const rate = await checkRateLimit({
    request,
    scope: "billing-checkout",
    identifier: contractorTenantId(),
    limit: 10,
    windowSeconds: 600,
  })
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter)

  const secret = process.env.STRIPE_SECRET_KEY
  const priceId = process.env.STRIPE_RENDER_CREDIT_PRICE_ID
  if (!secret || !priceId) {
    return NextResponse.json({ error: "Rendering payments are not configured yet." }, { status: 503 })
  }
  const origin = new URL(request.url).origin
  const tenant = contractorTenantId()
  const params = new URLSearchParams({
    mode: "payment",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/contractor?payment=success`,
    cancel_url: `${origin}/contractor?payment=cancelled`,
    client_reference_id: tenant,
    "metadata[tenant_id]": tenant,
    "payment_intent_data[metadata][tenant_id]": tenant,
    allow_promotion_codes: "true",
  })
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
    cache: "no-store",
  })
  const data = await response.json() as { url?: string; error?: { message?: string } }
  if (!response.ok || !data.url) {
    return NextResponse.json({ error: data.error?.message || "Checkout could not be started." }, { status: 502 })
  }
  return NextResponse.json({ url: data.url })
}
