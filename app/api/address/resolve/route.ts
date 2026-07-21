import { NextResponse } from "next/server"
import {
  DEFAULT_CONFIG,
  IS_DEPLOYED_COMPANY_SITE,
  matchConfiguredServiceCounty,
  matchCountyNameForState,
  STATE_NAMES,
  type CompanyConfig,
} from "@/lib/company-config"
import { createAddressToken } from "@/lib/address-verification"
import { contractorTenantId } from "@/lib/contractor-platform"
import { resolveGoogleAddress } from "@/lib/google-places"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ResolveBody = {
  placeId?: string
  sessionToken?: string
  quoteSessionId?: string
  testMode?: boolean
  testServiceArea?: { state?: string; counties?: string[] }
}

function previewConfig(body: ResolveBody): CompanyConfig {
  if (!body.testMode || IS_DEPLOYED_COMPANY_SITE || !body.testServiceArea) return DEFAULT_CONFIG
  const state = typeof body.testServiceArea.state === "string" && STATE_NAMES[body.testServiceArea.state]
    ? body.testServiceArea.state
    : DEFAULT_CONFIG.state
  const counties = Array.isArray(body.testServiceArea.counties)
    ? body.testServiceArea.counties.flatMap((county) => {
        if (typeof county !== "string") return []
        const canonical = matchCountyNameForState(state, county)
        return canonical ? [canonical] : []
      }).slice(0, 400)
    : []
  return { ...DEFAULT_CONFIG, state, counties }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as ResolveBody
    const placeId = body.placeId?.trim() || ""
    const sessionToken = body.sessionToken?.trim() || ""
    const quoteSessionId = body.quoteSessionId?.trim() || ""
    if (
      !placeId || placeId.length > 300 ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(sessionToken) ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(quoteSessionId)
    ) {
      return NextResponse.json({ error: "Select a valid property address from the Google suggestions." }, { status: 400 })
    }

    const resolved = await resolveGoogleAddress(placeId, sessionToken)
    const config = previewConfig(body)
    const canonicalCounty = matchCountyNameForState(resolved.state, resolved.county)
    const county = matchConfiguredServiceCounty(config, resolved.state, resolved.county)
    if (!county) {
      const displayCounty = canonicalCounty || resolved.county
      return NextResponse.json({
        address: resolved.formattedAddress,
        state: resolved.state,
        county: displayCounty,
        error: `This property is in ${displayCounty}, ${resolved.state}, outside this contractor's configured service area. Please contact us to ask about service availability.`,
      }, { status: 422 })
    }

    const verifiedAddress = { ...resolved, county }
    return NextResponse.json({
      address: verifiedAddress.formattedAddress,
      state: verifiedAddress.state,
      county: verifiedAddress.county,
      placeId: verifiedAddress.placeId,
      token: createAddressToken(verifiedAddress, contractorTenantId(), quoteSessionId),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The property address could not be verified."
    const status = message.includes("not configured") ? 503 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
