import { NextResponse } from "next/server"
import {
  measureRoofFromAddress,
  measureRoofFromLatLon,
} from "@/lib/roof-measure-server"
import { verifyAddressToken } from "@/lib/address-verification"
import { contractorTenantId } from "@/lib/contractor-platform"

export const runtime = "nodejs"
// External public GIS/OSM requests vary per address — never cache.
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  let sessionId = ""
  let addressToken = ""
  let lat = NaN
  let lon = NaN
  try {
    const body = await request.json()
    sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : ""
    addressToken = typeof body?.addressToken === "string" ? body.addressToken.trim() : ""
    // Optional corrected coordinates from the aerial confirmation pin.
    if (typeof body?.lat === "number") lat = body.lat
    if (typeof body?.lon === "number") lon = body.lon
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon)
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(sessionId) || addressToken.length < 20 || addressToken.length > 2_000) {
    return NextResponse.json({ error: "A verified property address is required." }, { status: 400 })
  }

  try {
    const verified = verifyAddressToken(addressToken, contractorTenantId(), sessionId)
    if (!verified) {
      return NextResponse.json({ error: "The verified property address is invalid or expired." }, { status: 400 })
    }
    const serviceArea = { state: verified.state, county: verified.county }
    // When the customer has repositioned the pin, measure the corrected point;
    // otherwise measure by address.
    const result = hasCoords
      ? await measureRoofFromLatLon(lat, lon, verified.formattedAddress, serviceArea)
      : await measureRoofFromAddress(verified.formattedAddress, serviceArea)
    if (result.status === "out-of-area") {
      return NextResponse.json(
        {
          reason: "out-of-area",
          county: result.county ?? null,
          matchedAddress: result.matchedAddress ?? null,
        },
        { status: 422 },
      )
    }
    if (result.status === "not-found") {
      return NextResponse.json(
        { error: "No building footprint found for this address." },
        { status: 404 },
      )
    }
    return NextResponse.json({
      ...result.measurement,
      matchedAddress: result.matchedAddress,
    })
  } catch {
    return NextResponse.json(
      { error: "Measurement service is temporarily unavailable." },
      { status: 502 },
    )
  }
}
