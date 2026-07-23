import "server-only"

export interface StreetViewMetadata {
  available: boolean
  year?: number
}

export interface BasePhoto {
  bytes: Uint8Array
  mediaType: string
  source: "streetview" | "upload"
  year?: number
}

type GoogleStreetViewMetadata = {
  status?: string
  date?: string
}

function mapsApiKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) throw new Error("Google Street View is not configured.")
  return key
}

/**
 * Check outdoor Street View coverage without requesting a billable image.
 * Google recommends this metadata request before every Static Street View
 * request so addresses without imagery never incur an image charge.
 */
export async function fetchStreetViewMetadata(address: string): Promise<StreetViewMetadata> {
  const url =
    "https://maps.googleapis.com/maps/api/streetview/metadata" +
    `?location=${encodeURIComponent(address)}` +
    "&source=outdoor" +
    `&key=${mapsApiKey()}`
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  })
  if (!response.ok) throw new Error("Google Street View metadata is temporarily unavailable.")
  const metadata = await response.json() as GoogleStreetViewMetadata
  if (metadata.status !== "OK") return { available: false }
  return {
    available: true,
    year: typeof metadata.date === "string" ? Number(metadata.date.slice(0, 4)) || undefined : undefined,
  }
}

/**
 * Fetch a curb-level outdoor image for a verified address. Metadata is always
 * checked first and the image endpoint is never called unless coverage is OK.
 */
export async function fetchStreetViewPhoto(
  address: string,
  knownMetadata?: StreetViewMetadata,
): Promise<BasePhoto | null> {
  const metadata = knownMetadata ?? await fetchStreetViewMetadata(address)
  if (!metadata.available) return null

  const url =
    "https://maps.googleapis.com/maps/api/streetview" +
    `?location=${encodeURIComponent(address)}` +
    "&size=640x480" +
    "&fov=80" +
    "&pitch=10" +
    "&source=outdoor" +
    "&return_error_code=true" +
    `&key=${mapsApiKey()}`
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  })
  const mediaType = response.headers.get("content-type") ?? ""
  if (!response.ok || !mediaType.startsWith("image/")) {
    throw new Error("Google Street View could not provide the property image.")
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mediaType,
    source: "streetview",
    year: metadata.year,
  }
}
