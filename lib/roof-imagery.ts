import { geocode } from "@/lib/roof-measure-server"

export type ImageryAngle = "street" | "satellite"

export interface BasePhoto {
  /** Raw image bytes of the house photo. */
  bytes: Uint8Array
  mediaType: string
  /** Which kind of imagery we ended up with. */
  angle: ImageryAngle
  /** Capture year, when the provider reports it. */
  year?: number
}

/**
 * Fetches the best available photo of the house at `address` to use as the base
 * for the shingle visualizer.
 *
 * Preference order:
 *   1. Google Street View Static — a real curb-level front photo. Most
 *      relatable "this is my house" view. Requires the Street View Static API
 *      to be enabled on the key; when it is not (or the address has no
 *      panorama), we fall back.
 *   2. Google Maps Static satellite — the top-down aerial, centered on the
 *      building via the Solar centroid / rooftop geocode we already use for the
 *      confirmation image. Universal coverage.
 *
 * Returns null only when neither provider can produce an image.
 */
export async function fetchBasePhoto(
  address: string,
  prefer: ImageryAngle = "street",
  coords?: { lat: number; lon: number } | null,
): Promise<BasePhoto | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  // Satellite requested explicitly (e.g. tree-covered lot where the street view
  // hides the roof) — go straight to the overhead image.
  if (prefer === "satellite") {
    return fetchSatellite(address, apiKey, coords)
  }

  const street = await fetchStreetView(address, apiKey, coords)
  if (street) return street

  return fetchSatellite(address, apiKey, coords)
}

/** Street View Static front photo, if the address has panorama coverage. */
async function fetchStreetView(
  address: string,
  apiKey: string,
  coords?: { lat: number; lon: number } | null,
): Promise<BasePhoto | null> {
  try {
    const location = coords ? `${coords.lat},${coords.lon}` : address
    // Cheap coverage/metadata check first — it's free and tells us whether a
    // panorama exists before we spend a (billed) image request.
    const metaUrl =
      "https://maps.googleapis.com/maps/api/streetview/metadata" +
      `?location=${encodeURIComponent(location)}` +
      `&source=outdoor` +
      `&key=${apiKey}`
    const meta = await (await fetch(metaUrl, { signal: AbortSignal.timeout(6000) })).json()
    if (meta?.status !== "OK") return null

    const imgUrl =
      "https://maps.googleapis.com/maps/api/streetview" +
      `?location=${encodeURIComponent(location)}` +
      "&size=640x480" +
      "&fov=80" + // slightly wide so the whole roof/facade fits
      "&pitch=10" + // tilt up a touch toward the roofline
      "&source=outdoor" +
      `&key=${apiKey}`
    const res = await fetch(imgUrl, { signal: AbortSignal.timeout(8000) })
    const mediaType = res.headers.get("content-type") ?? ""
    if (!res.ok || !mediaType.startsWith("image")) return null

    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mediaType,
      angle: "street",
      year: typeof meta?.date === "string" ? Number(meta.date.slice(0, 4)) : undefined,
    }
  } catch {
    return null
  }
}

/** Top-down satellite image centered on the building. */
async function fetchSatellite(
  address: string,
  apiKey: string,
  coords?: { lat: number; lon: number } | null,
): Promise<BasePhoto | null> {
  try {
    const geo = coords ? null : await geocode(address)
    const center = coords ? `${coords.lat},${coords.lon}` : geo ? `${geo.lat},${geo.lon}` : address
    const url =
      "https://maps.googleapis.com/maps/api/staticmap" +
      `?center=${encodeURIComponent(center)}` +
      "&zoom=20" +
      "&size=640x480" +
      "&scale=2" +
      "&maptype=satellite" +
      `&key=${apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const mediaType = res.headers.get("content-type") ?? ""
    if (!res.ok || !mediaType.startsWith("image")) return null

    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mediaType,
      angle: "satellite",
    }
  } catch {
    return null
  }
}
