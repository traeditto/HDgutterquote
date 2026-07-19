import { NextResponse } from "next/server"
import {
  addRenderCredits,
  claimWebhookEvent,
  releaseWebhookEvent,
  verifyStripeSignature,
} from "@/lib/contractor-platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type StripeCheckoutEvent = {
  id?: string
  type?: string
  data?: {
    object?: {
      payment_status?: string
      metadata?: { tenant_id?: string }
    }
  }
}

export async function POST(request: Request) {
  const payload = await request.text()
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"))) {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 })
  }
  let event: StripeCheckoutEvent
  try {
    event = JSON.parse(payload) as StripeCheckoutEvent
  } catch {
    return NextResponse.json({ error: "Invalid Stripe event." }, { status: 400 })
  }
  const checkout = event.data?.object
  const isPaidCheckout =
    (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") &&
    checkout?.payment_status === "paid"
  if (!isPaidCheckout) {
    return NextResponse.json({ received: true })
  }
  const eventId = event.id || ""
  const tenantId = checkout?.metadata?.tenant_id || ""
  if (!eventId || !/^[a-zA-Z0-9._/-]{3,160}$/.test(tenantId)) {
    return NextResponse.json({ error: "Stripe event metadata is incomplete." }, { status: 400 })
  }
  if (!(await claimWebhookEvent(eventId))) return NextResponse.json({ received: true, duplicate: true })
  const credits = Math.max(1, Math.min(10000, Number(process.env.RENDER_CREDITS_PER_PACK || 100) || 100))
  try {
    await addRenderCredits(credits, tenantId)
  } catch (error) {
    await releaseWebhookEvent(eventId).catch(() => undefined)
    throw error
  }
  return NextResponse.json({ received: true })
}
