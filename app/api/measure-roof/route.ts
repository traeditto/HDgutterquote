import { NextResponse } from "next/server"
import {
  measureRoofFromAddress,
  measureRoofFromLatLon,
} from "@/lib/roof-measure-server"

export const runtime = "nodejs"
// External public GIS/OSM requests vary per address — never cache.
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  let address = ""
  let lat = NaN
  let lon = NaN
  try {
    const body = await request.json()
    address = typeof body?.address === "string" ? body.address.trim() : ""
    // Optional corrected coordinates from the aerial confirmation pin.
    if (typeof body?.lat === "number") lat = body.lat
    if (typeof body?.lon === "number") lon = body.lon
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon)

  if (!hasCoords && address.length < 5) {
    return NextResponse.json({ error: "Please enter a full address." }, { status: 400 })
  }

  try {
    // When the customer has repositioned the pin, measure the corrected point;
    // otherwise measure by address.
    const result = hasCoords
      ? await measureRoofFromLatLon(lat, lon, address || undefined)
      : await measureRoofFromAddress(address)
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
