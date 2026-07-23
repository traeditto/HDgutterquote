import { NextRequest, NextResponse } from "next/server"
import {
  CONTRACTOR_COOKIE,
  readContractorSession,
} from "@/lib/contractor-auth"
import {
  contractorTenantId,
  getRenderCredits,
  listQuoteActivity,
  platformStorageConfigured,
} from "@/lib/contractor-platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
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
  const storageConfigured = platformStorageConfigured()
  const [activities, renderCredits] = await Promise.all([
    listQuoteActivity(100),
    getRenderCredits(),
  ])
  return NextResponse.json({
    activities,
    renderCredits,
    storageConfigured,
    billingConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_RENDER_CREDIT_PRICE_ID),
    retentionDays: Math.max(1, Math.min(365, Number(process.env.ADMIN_LEAD_RETENTION_DAYS || 30) || 30)),
  })
}
