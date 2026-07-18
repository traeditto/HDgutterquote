import { NextResponse } from "next/server"
import { geocode } from "@/lib/roof-measure-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Aerial (satellite) image proxy. The browser requests
 * `/api/aerial?lat=..&lon=..` and we fetch a Google Maps Static satellite tile
 * server-side so the API key is never exposed to the client. Returns a PNG.
 *
 * A pin is dropped on the exact coordinates so the customer can confirm the
 * measurement is centered on their house before we run the estimate.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const zoom = Number(params.get("zoom")) || 20
  // Cap the requested size to keep costs and payloads sane.
  const width = Math.min(Number(params.get("w")) || 640, 640)
  const height = Math.min(Number(params.get("h")) || 400, 640)

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "Aerial view is not configured" }, { status: 503 })
  }

  // Guard against absent params: Number(null) === 0, which would falsely pass
  // isFinite and produce a "0,0" center in the Atlantic. Only treat lat/lon as
  // provided when the raw params are actually present.
  const latRaw = params.get("lat")
  const lonRaw = params.get("lon")
  const lat = latRaw !== null ? Number(latRaw) : NaN
  const lon = lonRaw !== null ? Number(lonRaw) : NaN
  const address = params.get("address")?.trim()

  // Resolve the center the pin sits on. Order of preference (most → least
  // precise), each falling through to the next on a miss:
  //   1. Explicit lat/lon passed by the caller.
  //   2. Google Solar building centroid — the dead-center of the analyzed roof.
  //      This is the tightest "on the house" point and fixes large lots where a
  //      parcel-center geocode lands the pin in the yard.
  //   3. Google rooftop geocode (ROOFTOP / GEOMETRIC_CENTER) — on the building
  //      or at least on the property, vs the Census street-interpolated point.
  //   4. The shared Census geocode (roughly right; warms the measurement cache).
  //   5. Let Static Maps geocode the raw address string itself.
  //
  // We keep the numeric coordinate whenever we have one (centerLat/centerLon) so
  // it can be returned as JSON to the client, which needs the exact center to
  // convert a dragged-pin pixel offset back into a corrected lat/lon.
  let center: string | undefined
  let centerLat: number | undefined
  let centerLon: number | undefined
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    centerLat = lat
    centerLon = lon
  } else if (address) {
    // Prefer Google's precise rooftop/geometric result as the seed. Census can
    // land in the street or one parcel over, which then makes Solar faithfully
    // choose the wrong nearby roof.
    const rooftop = await rooftopGeocode(address, apiKey)
    const base = rooftop ? null : await geocode(address)
    const seed = rooftop ?? base
    const solarCenter = seed
      ? await solarBuildingCenter(seed.lat, seed.lon, apiKey)
      : null
    const sameHouseSolar =
      solarCenter && seed
        ? distanceMeters([seed.lon, seed.lat], [solarCenter.lon, solarCenter.lat]) <= 35
        : false

    if (solarCenter && sameHouseSolar) {
      centerLat = solarCenter.lat
      centerLon = solarCenter.lon
    } else if (rooftop) {
      centerLat = rooftop.lat
      centerLon = rooftop.lon
    } else if (base) {
      centerLat = base.lat
      centerLon = base.lon
    } else {
      // No numeric coordinate available — let Static Maps geocode the string.
      center = address
    }
  }

  if (centerLat !== undefined && centerLon !== undefined) {
    center = `${centerLat},${centerLon}`
  }

  if (!center) {
    return NextResponse.json(
      { error: "A valid address or lat/lon is required" },
      { status: 400 },
    )
  }

  // format=json: return the resolved center + zoom instead of an image. The
  // client uses this to place a draggable pin and compute corrected coordinates.
  if (params.get("format") === "json") {
    if (centerLat === undefined || centerLon === undefined) {
      return NextResponse.json(
        { error: "Could not resolve exact coordinates for this address" },
        { status: 404 },
      )
    }
    return NextResponse.json({ lat: centerLat, lon: centerLon, zoom })
  }

  // pin=off suppresses the baked-in marker so the client can overlay its own
  // draggable pin; otherwise we drop an orange marker on the center.
  const showPin = params.get("pin") !== "off"

  // scale=2 renders retina-sharp imagery. maptype=satellite for pure aerial.
  const url =
    "https://maps.googleapis.com/maps/api/staticmap" +
    `?center=${encodeURIComponent(center)}` +
    `&zoom=${zoom}` +
    `&size=${width}x${height}` +
    "&scale=2" +
    "&maptype=satellite" +
    (showPin ? `&markers=${encodeURIComponent(`color:0xF97316|${center}`)}` : "") +
    `&key=${apiKey}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const contentType = res.headers.get("content-type") ?? ""
    // Static Maps returns a PNG on success; on error it returns text/plain or
    // an HTTP error with a human-readable reason. Surface that for debugging.
    if (!res.ok || !contentType.startsWith("image")) {
      const detail = await res.text()
      console.error("aerial staticmap error:", res.status, detail.slice(0, 200))
      return NextResponse.json({ error: "Could not load aerial view" }, { status: 502 })
    }
    const buffer = await res.arrayBuffer()
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType || "image/png",
        // Cache per-coordinate image at the edge for a day.
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    })
  } catch (err) {
    console.error("aerial fetch threw:", (err as Error).message)
    return NextResponse.json({ error: "Could not load aerial view" }, { status: 502 })
  }
}

/** Approx distance in meters between two [lon, lat] points. */
function distanceMeters(a: [number, number], b: [number, number]): number {
  const earthRadiusM = 6378137
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const x = toRad(b[0] - a[0]) * Math.cos(toRad((a[1] + b[1]) / 2))
  const y = toRad(b[1] - a[1])
  return Math.sqrt(x * x + y * y) * earthRadiusM
}

/**
 * Query the Google Solar API for the centroid of the building nearest a
 * coordinate. `buildingInsights` analyzes the actual roof from aerial imagery
 * and returns its `center` — the most precise "on the roof" point available.
 * Returns null when Solar has no coverage for the location (common enough that
 * the caller must fall back), so we never block the aerial view on it.
 */
async function solarBuildingCenter(
  lat: number,
  lon: number,
  apiKey: string,
): Promise<{ lat: number; lon: number } | null> {
  try {
    const url =
      "https://solar.googleapis.com/v1/buildingInsights:findClosest" +
      `?location.latitude=${lat}` +
      `&location.longitude=${lon}` +
      "&requiredQuality=BASE" +
      `&key=${apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null

    const data = await res.json()
    const c = data?.center
    if (!c || typeof c.latitude !== "number" || typeof c.longitude !== "number") return null

    return { lat: c.latitude, lon: c.longitude }
  } catch {
    return null
  }
}

/**
 * Geocode an address with Google's Geocoding API and return the coordinate only
 * when it is precise enough to sit on the building. Google tags each result with
 * a `location_type`:
 *   - ROOFTOP            → exact building location (what we want)
 *   - GEOMETRIC_CENTER   → center of a parcel/segment, still on-property
 *   - RANGE_INTERPOLATED → guessed along the street centerline (the old problem)
 *   - APPROXIMATE        → city/zip level
 * We accept ROOFTOP and GEOMETRIC_CENTER (both land on the property) and reject
 * the interpolated/approximate ones so the caller can fall back gracefully.
 */
async function rooftopGeocode(
  address: string,
  apiKey: string,
): Promise<{ lat: number; lon: number } | null> {
  try {
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json" +
      `?address=${encodeURIComponent(address)}` +
      "&region=us" +
      `&key=${apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null

    const data = await res.json()
    const result = data?.results?.[0]
    const loc = result?.geometry?.location
    const locType = result?.geometry?.location_type
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null
    if (locType !== "ROOFTOP" && locType !== "GEOMETRIC_CENTER") return null

    return { lat: loc.lat, lon: loc.lng }
  } catch {
    return null
  }
}
