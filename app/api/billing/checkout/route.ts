import { NextResponse } from "next/server"
import { contractorTenantId, isContractorAuthorized } from "@/lib/contractor-platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!isContractorAuthorized(request.headers.get("x-contractor-access-key"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }
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
