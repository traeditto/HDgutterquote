import { NextResponse } from "next/server"
import { DEFAULT_CONFIG } from "@/lib/company-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STATE_CENTERS: Record<string, { lat: number; lon: number }> = {
  FL: { lat: 28.1, lon: -81.6 },
  GA: { lat: 32.7, lon: -83.3 },
  NC: { lat: 35.5, lon: -79.4 },
  SC: { lat: 33.8, lon: -80.9 },
  TX: { lat: 31.0, lon: -99.2 },
}
const bias = STATE_CENTERS[DEFAULT_CONFIG.state] ?? STATE_CENTERS.FL
const BIAS_LAT = bias.lat
const BIAS_LON = bias.lon

/**
 * Address autocomplete. Prefers Google Places Autocomplete (New) — which
 * returns precise, house-number-level predictions as the user types — and
 * falls back to the free/keyless Photon geocoder when no Google key is set or
 * the Google request fails. Results are biased toward the configured state.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? ""
  if (q.length < 3) return NextResponse.json({ suggestions: [] })

  // 1. Google Places Autocomplete (New), when a key is configured.
  const google = await googleAutocomplete(q)
  if (google && google.length > 0) {
    return NextResponse.json({ suggestions: rankServiceArea(google, q) })
  }

  // 2. Fallback: Photon (Komoot), free and keyless.
  return photonSuggest(q)
}

/**
 * Google Places Autocomplete (New). Returns full-address predictions (with
 * house numbers) biased to the configured state. Returns null when no key is set or the
 * request fails, so the caller can fall back to Photon.
 *
 * Requires the "Places API (New)" product to be enabled on the Google Cloud
 * project (it is a separate SKU from the legacy "Places API"). If it is ever
 * disabled the request returns 403 and we fall through to Photon, which lacks
 * house-number data for many Clay / St. Johns streets — so keep Places API
 * (New) enabled to ensure in-service-area addresses resolve.
 */
async function googleAutocomplete(q: string): Promise<string[] | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify({
        input: q,
        includedRegionCodes: ["us"],
        // Bias (not restrict) toward the configured state; 50km is the max.
        locationBias: {
          circle: {
            center: { latitude: BIAS_LAT, longitude: BIAS_LON },
            radius: 50000,
          },
        },
      }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null

    const data = await res.json()
    const suggestions: any[] = data?.suggestions ?? []
    const out: string[] = []
    const seen = new Set<string>()
    for (const s of suggestions) {
      const text: string | undefined = s?.placePrediction?.text?.text
      if (!text) continue
      // Predictions come as "120 Jackson Rd, Atlantic Beach, FL, USA".
      // Drop the trailing country.
      const address = text.replace(/,\s*USA$/i, "").trim()
      if (!address || seen.has(address)) continue
      seen.add(address)
      out.push(address)
    }
    return out
  } catch {
    return null
  }
}

/**
 * Rank a list of ready-made address strings so service-area results come first
 * and, when the user typed a house number, complete street addresses lead.
 */
function rankServiceArea(addresses: string[], q: string): string[] {
  const wantsNumber = /^\d/.test(q)
  return addresses
    .map((address, i) => ({ address, i }))
    .sort((a, b) => {
      const aIn = isInServiceArea(a.address) ? 0 : 1
      const bIn = isInServiceArea(b.address) ? 0 : 1
      if (aIn !== bIn) return aIn - bIn
      if (wantsNumber) {
        const aNum = /^\d/.test(a.address) ? 0 : 1
        const bNum = /^\d/.test(b.address) ? 0 : 1
        if (aNum !== bNum) return aNum - bNum
      }
      return a.i - b.i
    })
    .slice(0, 5)
    .map((x) => x.address)
}

/** Photon (Komoot) fallback — free, keyless typeahead geocoder. */
async function photonSuggest(q: string) {
  const url =
    "https://photon.komoot.io/api/" +
    `?q=${encodeURIComponent(q)}` +
    `&lat=${BIAS_LAT}&lon=${BIAS_LON}` +
    "&limit=8&lang=en"

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "GutterQuoteTemplate/1.0 (quote tool)" },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return NextResponse.json({ suggestions: [] })

    const data = await res.json()
    const features: any[] = data?.features ?? []

    // Free OSM geocoders often lack individual house numbers for suburban
    // streets, so they return the street without the number the user typed.
    // Capture a leading house number from the query and carry it onto street
    // matches; the measurement step re-geocodes precisely on selection.
    const queryHouseNumber = q.match(/^(\d+[a-z]?)\s+/i)?.[1]

    const seen = new Set<string>()
    const formatted: { address: string; hasNumber: boolean }[] = []
    for (const f of features) {
      const p = f?.properties ?? {}
      // US only, and only rows that resolve to a real street address.
      if (p.countrycode && p.countrycode !== "US") continue
      const street = p.street || p.name
      if (!street || !p.city || !p.state) continue

      // Only carry the typed number onto plain streets (not ones that already
      // start with a number, which would produce a doubled house number).
      const isStreet = p.osm_key === "highway" && !/^\d/.test(street)
      const houseNumber =
        p.housenumber || (isStreet && queryHouseNumber ? queryHouseNumber : "")
      const line1 = houseNumber ? `${houseNumber} ${street}` : street
      const stateAbbr = STATE_ABBR[p.state] ?? p.state
      const cityState = p.postcode
        ? `${p.city}, ${stateAbbr} ${p.postcode}`
        : `${p.city}, ${stateAbbr}`
      const address = `${line1}, ${cityState}`

      if (seen.has(address)) continue
      seen.add(address)
      formatted.push({ address, hasNumber: Boolean(houseNumber) })
    }

    // If the user typed a house number, rank complete street addresses first.
    const wantsNumber = Boolean(queryHouseNumber)

    // Prioritize the configured state and complete addresses; stable-sort keeps
    // original order within a tier.
    const suggestions = formatted
      .map((entry, i) => ({ ...entry, i }))
      .sort((a, b) => {
        const aIn = isInServiceArea(a.address) ? 0 : 1
        const bIn = isInServiceArea(b.address) ? 0 : 1
        if (aIn !== bIn) return aIn - bIn
        if (wantsNumber) {
          const aNum = a.hasNumber ? 0 : 1
          const bNum = b.hasNumber ? 0 : 1
          if (aNum !== bNum) return aNum - bNum
        }
        return a.i - b.i
      })
      .slice(0, 5)
      .map((x) => x.address)

    return NextResponse.json({ suggestions })
  } catch {
    return NextResponse.json({ suggestions: [] })
  }
}

/** Photon returns full state names; map the supported setup states to abbreviations. */
const STATE_ABBR: Record<string, string> = {
  Florida: "FL",
  Georgia: "GA",
  "North Carolina": "NC",
  "South Carolina": "SC",
  Texas: "TX",
}

function isInServiceArea(address: string): boolean {
  return new RegExp(`,\\s*${DEFAULT_CONFIG.state}(?:\\s|\\d|,|$)`, "i").test(address)
}
