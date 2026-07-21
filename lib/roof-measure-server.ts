// Server-only roof measurement using free, keyless public data sources.
//
// Strategy (Duval / Clay / St. Johns / Nassau service area):
//   1. Geocode the address with the US Census Geocoder (lat/lon + county FIPS)
//      and gate to the service-area counties.
//   2. If the county publishes a property-appraiser layer with living area +
//      stories, derive the footprint directly (most authoritative).
//   3. Else if it publishes a building-footprint layer, use the real polygon.
//   4. Else look up the county PARCEL polygon at the address and "snap" the
//      OpenStreetMap building(s) that actually sit on that lot — this fixes the
//      geocoder landing in the street and grabbing the wrong structure.
//   5. Else fall back to the nearest plausible OSM building near the point.
//   6. If nothing is found, return `not-found` (UI captures the lead).
//
// All of these are free and require no API key. None of this runs in the browser.

import type { RoofMeasurement } from "./roof-quote"
import { DEFAULT_CONFIG, matchCountyNameForState } from "./company-config"
import { STATE_FIPS } from "./us-geography"

const SQM_TO_SQFT = 10.7639
const EARTH_RADIUS_M = 6378137

// --- Calibrated roof-area model -------------------------------------------
// Tuned against 5 GAF QuickMeasure reports across simple → complex Jacksonville
// roofs. Two independent sources fail in OPPOSITE directions:
//   • the county footprint model reads low on complex homes (small under-roof
//     footprint for a heavily-cut-up roof), and
//   • Google Solar reads low under tree cover (it silently drops occluded
//     segments) and can mis-match the building on a big road.
// On every verified home at least one source was accurate and neither ran
// wildly high, so we take the MAX of the two estimates (never the silently-low
// one) and then apply a global haircut to recentre the mild overage that max
// introduces. Result across the 5 homes: ~ -9% … +4% vs GAF, and it never
// under-quotes catastrophically the way county-only did (-27% worst case).

/**
 * Google Solar reports the ground-projected roof plan ~12% larger than the true
 * horizontal roof plan (verified vs GAF), so divide solar's plan by this before
 * applying pitch.
 */
const SOLAR_PLAN_BIAS = 1.12

/**
 * Haircut applied to max(county, solar). The county model and the max operation
 * both skew a bit hot on normal homes; 0.90 recentres the estimate so errors
 * straddle zero instead of always over-quoting.
 */
const MODEL_HAIRCUT = 0.9

/** Roof-surface multiplier for an x/12 pitch (√(rise² + 12²) / 12). */
function pitchMultiplier(rise: number): number {
  return Math.sqrt(rise * rise + 144) / 12
}

type LonLat = [number, number] // [lon, lat]

interface GeocodeResult {
  lat: number
  lon: number
  /** 5-digit state+county FIPS, when available. */
  countyFips?: string
  /** Human-readable county name, when available. */
  countyName?: string
  matchedAddress?: string
}

/**
 * A county property-appraiser parcel layer (ArcGIS FeatureServer/MapServer).
 * We read living/building square footage and the number of stories, then derive
 * the ground footprint as `livingArea / stories`. Field names differ by county,
 * so they are configurable.
 */
interface AppraiserLayer {
  /** ArcGIS layer endpoint (…/FeatureServer/0). */
  url: string
  /** Attribute holding heated/living/building square footage. */
  areaField: string
  /** Attribute holding the number of stories/floors. */
  storiesField: string
}

/**
 * A county GIS building-footprint layer that returns real building polygons.
 * We compute the true footprint area from the returned geometry.
 */
interface FootprintLayer {
  /** ArcGIS layer endpoint that returns building polygons. */
  url: string
}

/**
 * A county parcel-boundary layer (ArcGIS FeatureServer/MapServer). We use the
 * parcel polygon to "snap" — keeping only the OSM building(s) that sit on the
 * addressed lot, which avoids grabbing a neighbor's house or a commercial
 * building when the geocoder lands off the rooftop.
 */
interface ParcelLayer {
  /** ArcGIS layer endpoint that returns parcel polygons. */
  url: string
}

interface CountyConfig {
  name: string
  /** Preferred: property appraiser parcel attributes. */
  appraiser?: AppraiserLayer
  /** Alternative/secondary: GIS building footprints. */
  footprint?: FootprintLayer
  /** Parcel boundaries used to snap OSM buildings to the correct lot. */
  parcel?: ParcelLayer
}

/**
 * Per-county authoritative building-data sources, keyed by 5-digit FIPS.
 *
 * The public GIS layers for the NE Florida counties currently expose parcel-lot
 * polygons only (no building footprint or heated-area fields), so measurement
 * falls back to OpenStreetMap building footprints for now. When a county
 * publishes a building-footprint layer or an appraiser parcel layer with living
 * area + stories, drop it in here and it is used automatically ahead of OSM.
 */
const COUNTY_SOURCES: Record<string, CountyConfig> = {
  // Duval County (Jacksonville) — City of Jacksonville property appraiser parcels.
  "12031": {
    name: "Duval County",
    parcel: {
      url: "https://maps.coj.net/coj/rest/services/CityBiz/Parcels/MapServer/0",
    },
  },
  // St. Johns County — county GIS parcel layer.
  "12109": {
    name: "St. Johns County",
    parcel: {
      url: "https://www.gis.sjcfl.us/portal_sjcgis/rest/services/Parcel/MapServer/0",
    },
  },
  // Clay County (12019) and Nassau County (12089): no public parcel endpoint
  // wired yet, so they use the OpenStreetMap nearest-building fallback. Add a
  // `parcel` (or `appraiser`/`footprint`) layer here to enable snapping.
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Spherical polygon area in square meters for a ring of [lon, lat] points. */
function ringAreaSqMeters(ring: LonLat[]): number {
  const n = ring.length
  if (n < 3) return 0
  let area = 0
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = ring[i]
    const [lon2, lat2] = ring[(i + 1) % n]
    area += toRad(lon2 - lon1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)))
  }
  return Math.abs((area * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2)
}

/** Ray-casting point-in-polygon test. point/ring are [lon, lat]. */
function pointInRing(point: LonLat, ring: LonLat[]): boolean {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function centroid(ring: LonLat[]): LonLat {
  let x = 0
  let y = 0
  for (const [lon, lat] of ring) {
    x += lon
    y += lat
  }
  return [x / ring.length, y / ring.length]
}

/** Approx distance in meters between two [lon, lat] points (equirectangular). */
function distanceMeters(a: LonLat, b: LonLat): number {
  const x = toRad(b[0] - a[0]) * Math.cos(toRad((a[1] + b[1]) / 2))
  const y = toRad(b[1] - a[1])
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_M
}

/** Extract the outer ring from an ArcGIS/GeoJSON Polygon or MultiPolygon. */
function outerRing(geometry: any): LonLat[] | null {
  const coords = geometry?.coordinates
  if (!Array.isArray(coords)) return null
  const ring = geometry.type === "MultiPolygon" ? coords[0]?.[0] : coords[0]
  if (!Array.isArray(ring) || ring.length < 3) return null
  return ring as LonLat[]
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": "GutterQuoteTemplate/1.0 (instant gutter estimate)",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    // These public services can be slow; give them room but don't hang forever.
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "GutterQuoteTemplate/1.0 (instant gutter estimate)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.text()
}

/**
 * In-memory geocode cache. A single address flows through several steps in one
 * session — the aerial confirmation image, then the roof measurement — and each
 * previously re-geocoded independently. Caching the result means we geocode a
 * given address once and reuse those exact coordinates everywhere, which both
 * cuts external API calls and guarantees the aerial pin and the measured parcel
 * are the same point. Entries expire after a day; the map is capped so a
 * long-lived server instance can't grow unbounded.
 */
const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000
const GEOCODE_CACHE_MAX = 500
const geocodeCache = new Map<string, { value: GeocodeResult | null; at: number }>()

const geocodeKey = (address: string) => address.trim().toLowerCase().replace(/\s+/g, " ")

/**
 * Step 1 — geocode via Google rooftop data when configured, falling back to
 * the US Census Geocoder (free, no key), memoized.
 * Exported so other server routes (e.g. the aerial image) share the same cache.
 */
export async function geocode(address: string): Promise<GeocodeResult | null> {
  const key = geocodeKey(address)
  const cached = geocodeCache.get(key)
  if (cached && Date.now() - cached.at < GEOCODE_TTL_MS) return cached.value

  const value = await geocodeUncached(address)

  // Only cache successful hits; a transient failure shouldn't poison the cache.
  if (value) {
    if (geocodeCache.size >= GEOCODE_CACHE_MAX) {
      const oldest = geocodeCache.keys().next().value
      if (oldest !== undefined) geocodeCache.delete(oldest)
    }
    geocodeCache.set(key, { value, at: Date.now() })
  }
  return value
}

async function geocodeUncached(address: string): Promise<GeocodeResult | null> {
  const google = await googleRooftopGeocode(address)
  if (google) return google

  const url =
    "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress" +
    `?address=${encodeURIComponent(address)}` +
    "&benchmark=Public_AR_Current&vintage=Current_Current&format=json"

  try {
    const data = await fetchJson(url)
    const match = data?.result?.addressMatches?.[0]
    if (!match?.coordinates) return null

    const lon = Number(match.coordinates.x)
    const lat = Number(match.coordinates.y)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

    const county = match.geographies?.["Counties"]?.[0]
    const countyFips =
      county?.STATE && county?.COUNTY ? `${county.STATE}${county.COUNTY}` : undefined

    return {
      lat,
      lon,
      countyFips,
      countyName: county?.NAME,
      matchedAddress: match.matchedAddress,
    }
  } catch {
    return null
  }
}

async function googleRooftopGeocode(address: string): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  try {
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json" +
      `?address=${encodeURIComponent(address)}` +
      "&region=us" +
      `&key=${apiKey}`
    const data = await fetchJson(url)
    const result = data?.results?.[0]
    const loc = result?.geometry?.location
    const locType = result?.geometry?.location_type
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null
    if (locType !== "ROOFTOP" && locType !== "GEOMETRIC_CENTER") return null

    const county = await reverseGeocodeCounty(loc.lat, loc.lng)
    return {
      lat: loc.lat,
      lon: loc.lng,
      countyFips: county.countyFips,
      countyName: county.countyName,
      matchedAddress: result.formatted_address ?? address,
    }
  } catch {
    return null
  }
}

type SourceHit = {
  footprintSqFt: number
  source: RoofMeasurement["source"]
  /** Number of stories, when the source could determine it. */
  stories?: number
}

/** Step 2 — county property appraiser: footprint = living area / stories. */
async function fromCountyAppraiser(geo: GeocodeResult): Promise<SourceHit | null> {
  if (!geo.countyFips) return null
  const layer = COUNTY_SOURCES[geo.countyFips]?.appraiser
  if (!layer) return null

  const url =
    `${layer.url}/query?where=1%3D1` +
    `&geometry=${geo.lon},${geo.lat}` +
    "&geometryType=esriGeometryPoint&inSR=4326" +
    "&spatialRel=esriSpatialRelIntersects" +
    `&outFields=${encodeURIComponent(`${layer.areaField},${layer.storiesField}`)}` +
    "&returnGeometry=false&f=json"

  try {
    const data = await fetchJson(url)
    const attrs = data?.features?.[0]?.attributes
    if (!attrs) return null

    const livingArea = Number(attrs[layer.areaField])
    if (!Number.isFinite(livingArea) || livingArea <= 0) return null

    // Stories may be missing or fractional (e.g. 1.5); default to 1 story.
    let stories = Number(attrs[layer.storiesField])
    if (!Number.isFinite(stories) || stories < 1) stories = 1

    const footprintSqFt = livingArea / stories
    return { footprintSqFt, source: "county-appraiser", stories }
  } catch {
    return null
  }
}

/** Step 3 — county GIS / ArcGIS building footprint (if configured for this county). */
async function fromCountyGis(geo: GeocodeResult): Promise<SourceHit | null> {
  if (!geo.countyFips) return null
  const layer = COUNTY_SOURCES[geo.countyFips]?.footprint
  if (!layer) return null

  const url =
    `${layer.url}/query?where=1%3D1` +
    `&geometry=${geo.lon},${geo.lat}` +
    "&geometryType=esriGeometryPoint&inSR=4326" +
    "&spatialRel=esriSpatialRelIntersects" +
    "&outFields=*&returnGeometry=true&outSR=4326&f=geojson"

  try {
    const data = await fetchJson(url)
    const feature = data?.features?.[0]
    const coords = feature?.geometry?.coordinates
    if (!coords) return null

    // GeoJSON Polygon -> first ring; MultiPolygon -> first polygon's first ring.
    const ring: LonLat[] =
      feature.geometry.type === "MultiPolygon" ? coords[0][0] : coords[0]
    const areaSqM = ringAreaSqMeters(ring)
    if (areaSqM <= 0) return null

    return { footprintSqFt: areaSqM * SQM_TO_SQFT, source: "county-gis" }
  } catch {
    return null
  }
}

/** Leading house number from an address string, e.g. "2186 CYPRESS LN" -> "2186". */
function houseNumber(address?: string): string | null {
  if (!address) return null
  const m = address.trim().match(/^(\d+)\b/)
  return m ? m[1] : null
}

const DUVAL_FIPS = "12031"

/**
 * Duval County property appraiser (authoritative). The City of Jacksonville
 * PAO publishes each parcel's building sub-area table (Base / Garage / Porch,
 * etc.) with gross (under-roof) and heated square footage. This is the ground
 * truth for the actual footprint — far better than a traced building polygon,
 * which routinely undercounts attached garages on newer homes.
 *
 * Flow: match the parcel's RE (real-estate) number by house number from the
 * CityBiz parcel layer, then read the PAO detail page and derive the
 * ground-level under-roof footprint from the building sub-area totals:
 *
 *   footprint = grossArea − heatedArea × (1 − 1/stories)
 *
 * Non-heated roofed areas (garage, porch, carport) are single-story and stay
 * in full; heated living area is divided across the number of stories. For a
 * 1-story home this is simply the gross under-roof area.
 */
async function fromDuvalAppraiser(geo: GeocodeResult): Promise<SourceHit | null> {
  const parcelUrl = COUNTY_SOURCES[DUVAL_FIPS]?.parcel?.url
  if (!parcelUrl) return null
  const house = houseNumber(geo.matchedAddress)
  if (!house) return null

  try {
    // 1. Resolve the parcel RE number by matching the house number within a
    // small envelope around the geocoded point (the geocode often lands in the
    // street, so a point query alone misses the parcel).
    const d = 0.0006
    const env = `${geo.lon - d},${geo.lat - d},${geo.lon + d},${geo.lat + d}`
    const parcelQuery =
      `${parcelUrl}/query?geometry=${env}` +
      "&geometryType=esriGeometryEnvelope&inSR=4326" +
      "&spatialRel=esriSpatialRelIntersects" +
      "&outFields=RE_NOSPACE,STREET_NO&returnGeometry=false&f=json"
    const parcelData = await fetchJson(parcelQuery)
    const match = (parcelData?.features ?? []).find(
      (f: any) => String(f?.attributes?.STREET_NO) === house,
    )
    const re = match?.attributes?.RE_NOSPACE
    if (!re) return null

    // 2. Read the PAO detail page and parse the building sub-area totals.
    const html = await fetchText(
      `https://paopropertysearch.coj.net/Basic/Detail.aspx?RE=${encodeURIComponent(re)}`,
    )
    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
    const toNum = (s?: string) => (s ? Number(s.replace(/,/g, "")) : NaN)

    // The sub-area table ends in a "Total <gross> <heated> <effective>" row.
    let gross = NaN
    let heated = NaN
    for (const m of text.matchAll(/Total\s+([0-9,]+)\s+([0-9,]+)\s+([0-9,]+)/g)) {
      const g = toNum(m[1])
      const h = toNum(m[2])
      if (Number.isFinite(g) && Number.isFinite(h) && g > 200 && g >= h) {
        gross = g
        heated = h
        break
      }
    }
    if (!Number.isFinite(gross)) return null

    let stories = toNum((text.match(/Stories\s+([0-9.]+)/) ?? [])[1])
    if (!Number.isFinite(stories) || stories < 1) stories = 1

    const footprintSqFt = gross - heated * (1 - 1 / stories)
    if (!Number.isFinite(footprintSqFt) || footprintSqFt <= 200) return null

    return { footprintSqFt, source: "county-appraiser", stories }
  } catch {
    return null
  }
}

/**
 * Counties whose property appraiser sites are bot-protected (Cloudflare 403),
 * so we can't scrape them like Duval. Instead we use the Florida Department of
 * Revenue statewide cadastral layer — the aggregated county tax rolls — which
 * exposes each parcel's total heated living area (`TOT_LVG_AR`). This is still
 * authoritative property-appraiser data, just delivered through the state roll.
 */
const STATEWIDE_CADASTRAL_FIPS = new Set([
  "12019", // Clay
  "12089", // Nassau
  "12109", // St. Johns
])

const FL_STATEWIDE_CADASTRAL =
  "https://services9.arcgis.com/Gh9awoU677aKree0/ArcGIS/rest/services/" +
  "Florida_Statewide_Cadastral/FeatureServer/0"

/**
 * Convert per-story heated living area to an estimated ground (under-roof)
 * footprint. Heated living area excludes the garage, covered porches/lanais,
 * and eave overhangs, so the real under-roof footprint is a bit larger. This
 * factor plus the downstream roof-plan/pitch conversion was calibrated against
 * GAF QuickMeasure reports across Duval/Clay/Nassau/St. Johns (typical homes
 * land within ~5%; unusually low-slope or very large homes vary more).
 */
const LIVING_TO_FOOTPRINT_FACTOR = 1.1

/**
 * Property appraiser building area via the FDOR statewide cadastral roll, for
 * counties we can't scrape directly (Clay, Nassau, St. Johns).
 *
 * The tax roll gives total HEATED living area, which counts every floor, so a
 * 2-story home reports ~2x its footprint. We infer the number of stories by
 * comparing living area to the measured building-footprint polygon (passed in
 * from USA Structures / OSM), then derive the ground footprint:
 *
 *   footprint ≈ (livingArea / stories) × LIVING_TO_FOOTPRINT_FACTOR
 */
async function fromStatewideCadastral(
  geo: GeocodeResult,
  targetHouseNo: string | null,
  polygonFootprintSqFt: number | null,
): Promise<SourceHit | null> {
  try {
    const d = 0.0007
    const env = `${geo.lon - d},${geo.lat - d},${geo.lon + d},${geo.lat + d}`
    const url =
      `${FL_STATEWIDE_CADASTRAL}/query?geometry=${env}` +
      "&geometryType=esriGeometryEnvelope&inSR=4326" +
      "&spatialRel=esriSpatialRelIntersects" +
      "&outFields=PHY_ADDR1,TOT_LVG_AR&returnGeometry=false&f=json"
    const data = await fetchJson(url)
    const features: any[] = data?.features ?? []
    if (features.length === 0) return null

    // Prefer the parcel whose physical address house number matches; otherwise
    // fall back to the first parcel in the envelope.
    const matched =
      (targetHouseNo &&
        features.find((f) => {
          const addr = String(f?.attributes?.PHY_ADDR1 ?? "").trim()
          return new RegExp(`^0*${targetHouseNo}\\b`).test(addr)
        })) ||
      features[0]

    const livingArea = Number(matched?.attributes?.TOT_LVG_AR)
    if (!Number.isFinite(livingArea) || livingArea < 300) return null

    // Infer stories from the footprint polygon when we have one. A 2-story home
    // reports roughly double its footprint as living area. Clamp to 1–3.
    let stories = 1
    if (polygonFootprintSqFt && polygonFootprintSqFt > 200) {
      stories = Math.min(3, Math.max(1, Math.round(livingArea / polygonFootprintSqFt)))
    }

    const footprintSqFt = (livingArea / stories) * LIVING_TO_FOOTPRINT_FACTOR
    if (!Number.isFinite(footprintSqFt) || footprintSqFt <= 200) return null

    return { footprintSqFt, source: "county-appraiser", stories }
  } catch {
    return null
  }
}

/**
 * FEMA / Oak Ridge "USA Structures" — a national building-footprint layer
 * (ArcGIS, free, no key). It returns real building polygons plus an attached
 * property address and occupancy class, and covers newer construction that
 * OpenStreetMap has not mapped yet. This is our primary footprint source.
 *
 * Selection priority within a ~100m envelope around the geocoded point:
 *   1. Building whose PROP_ADDR house number matches the addressed home.
 *   2. Building that contains the geocoded point.
 *   3. When a county parcel polygon is available, the largest building that
 *      sits on the addressed lot (returns nothing if the lot has no mapped
 *      building, rather than grabbing a neighbor's much larger house).
 *   4. Only when no parcel is available, the nearest residential building
 *      within a tight distance and plausible size range.
 */
async function fromUsaStructures(
  geo: GeocodeResult,
  targetHouseNo: string | null,
  parcelRing: LonLat[] | null,
): Promise<SourceHit | null> {
  const d = 0.0009 // ~100m envelope
  const env = `${geo.lon - d},${geo.lat - d},${geo.lon + d},${geo.lat + d}`
  const url =
    "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/" +
    "USA_Structures_View/FeatureServer/0/query" +
    `?geometry=${encodeURIComponent(env)}` +
    "&geometryType=esriGeometryEnvelope&inSR=4326" +
    "&spatialRel=esriSpatialRelIntersects" +
    "&outFields=PROP_ADDR,OCC_CLS&returnGeometry=true&outSR=4326&f=geojson"

  try {
    const data = await fetchJson(url)
    const point: LonLat = [geo.lon, geo.lat]

    type Cand = {
      ring: LonLat[]
      areaSqM: number
      sqFt: number
      addr: string
      residential: boolean
      dist: number
    }
    const candidates: Cand[] = []
    for (const f of data?.features ?? []) {
      const ring = outerRing(f?.geometry)
      if (!ring) continue
      const areaSqM = ringAreaSqMeters(ring)
      if (areaSqM <= 0) continue
      candidates.push({
        ring,
        areaSqM,
        sqFt: areaSqM * SQM_TO_SQFT,
        addr: String(f?.properties?.PROP_ADDR ?? ""),
        residential: /residential/i.test(String(f?.properties?.OCC_CLS ?? "")),
        dist: distanceMeters(point, centroid(ring)),
      })
    }
    if (candidates.length === 0) return null

    const hit = (c: Cand): SourceHit => ({
      footprintSqFt: c.sqFt,
      source: "usa-structures",
    })

    // 1. Exact house-number match (strongest signal).
    if (targetHouseNo) {
      const byAddr = candidates
        .filter((c) => houseNumber(c.addr) === targetHouseNo)
        .sort((a, b) => a.dist - b.dist)[0]
      if (byAddr) return hit(byAddr)
    }

    // 2. Building the geocoded point falls inside.
    const containing = candidates
      .filter((c) => pointInRing(point, c.ring))
      .sort((a, b) => a.areaSqM - b.areaSqM)[0]
    if (containing) return hit(containing)

    // 3. Parcel-aware: the largest building sitting on the addressed lot. If the
    // lot has no mapped building, return null so we don't grab a neighbor.
    if (parcelRing) {
      const onLot = candidates
        .filter((c) => pointInRing(centroid(c.ring), parcelRing))
        .sort((a, b) => b.areaSqM - a.areaSqM)[0]
      return onLot ? hit(onLot) : null
    }

    // 4. No parcel data (e.g. Clay / Nassau): nearest residential building of a
    // plausible single-home size, within a tight radius.
    const nearest = candidates
      .filter((c) => c.residential && c.sqFt >= 300 && c.sqFt <= 6000)
      .sort((a, b) => a.dist - b.dist)[0]
    if (nearest && nearest.dist <= 35) return hit(nearest)

    return null
  } catch {
    return null
  }
}

/**
 * Look up the county PARCEL polygon that the address sits on. Because the
 * geocoder can land in the street, we query an envelope around the point and
 * pick the parcel that contains the point, else the nearest parcel.
 */
async function fetchParcelRing(geo: GeocodeResult): Promise<LonLat[] | null> {
  if (!geo.countyFips) return null
  const layer = COUNTY_SOURCES[geo.countyFips]?.parcel
  if (!layer) return null

  // ~70m envelope around the geocoded point.
  const d = 0.0007
  const env = `${geo.lon - d},${geo.lat - d},${geo.lon + d},${geo.lat + d}`
  const url =
    `${layer.url}/query?geometry=${env}` +
    "&geometryType=esriGeometryEnvelope&inSR=4326" +
    "&spatialRel=esriSpatialRelIntersects" +
    "&outFields=&returnGeometry=true&outSR=4326&f=geojson"

  try {
    const data = await fetchJson(url)
    const point: LonLat = [geo.lon, geo.lat]
    const rings: LonLat[][] = []
    for (const f of data?.features ?? []) {
      const ring = outerRing(f?.geometry)
      if (ring) rings.push(ring)
    }
    if (rings.length === 0) return null

    const containing = rings.find((r) => pointInRing(point, r))
    if (containing) return containing

    // Nearest parcel by centroid distance (fronting lot when point is in street).
    return rings
      .map((r) => ({ r, dist: distanceMeters(point, centroid(r)) }))
      .sort((a, b) => a.dist - b.dist)[0].r
  } catch {
    return null
  }
}

/**
 * OpenStreetMap building footprint via Overpass (free, no key).
 *
 * If a parcel ring is supplied, we keep only the buildings that sit on that lot
 * and use the largest as the primary structure. Otherwise the Census geocoder
 * can sit 60–150m from the rooftop, so we pick the nearest plausible house.
 */
async function fromOsm(
  geo: GeocodeResult,
  parcelRing: LonLat[] | null,
): Promise<SourceHit | null> {
  // Always search a generous radius around the point so the nearest-building
  // fallback has candidates even when no building is mapped on the parcel.
  const query =
    "[out:json][timeout:25];" +
    `way["building"](around:180,${geo.lat},${geo.lon});` +
    "out geom;"

  // Overpass mirrors, tried in order. The main endpoint is frequently rate
  // limited (HTTP 429/406) from server IPs, so we fall through to community
  // mirrors until one returns usable JSON. This keeps OSM (our last-resort
  // footprint source) from being a single point of failure.
  const overpassEndpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ]

  try {
    let data: any = null
    for (const endpoint of overpassEndpoints) {
      try {
        const res = await fetchJson(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
        })
        if (Array.isArray(res?.elements)) {
          data = res
          break
        }
      } catch {
        // Try the next mirror.
      }
    }
    if (!data) return null

    const point: LonLat = [geo.lon, geo.lat]
    const candidates: { ring: LonLat[]; areaSqM: number }[] = []

    for (const el of data?.elements ?? []) {
      if (el.type !== "way" || !Array.isArray(el.geometry)) continue
      const ring: LonLat[] = el.geometry.map((g: any) => [g.lon, g.lat])
      if (ring.length < 3) continue
      candidates.push({ ring, areaSqM: ringAreaSqMeters(ring) })
    }
    if (candidates.length === 0) return null

    // With a parcel: keep buildings whose centroid is on the lot, take the
    // largest (the primary residence, excluding detached sheds/garages).
    if (parcelRing) {
      const onLot = candidates
        .filter((c) => pointInRing(centroid(c.ring), parcelRing))
        .sort((a, b) => b.areaSqM - a.areaSqM)
      const primary = onLot[0]
      if (primary && primary.areaSqM > 0) {
        return { footprintSqFt: primary.areaSqM * SQM_TO_SQFT, source: "osm" }
      }
      // Parcel found but no building mapped on it — fall through to nearest.
    }

    // No parcel (or nothing on it): point inside a building wins, else nearest.
    const containing = candidates
      .filter((c) => pointInRing(point, c.ring))
      .sort((a, b) => a.areaSqM - b.areaSqM)
    let chosen = containing[0]

    if (!chosen) {
      const nearest = candidates
        .filter((c) => c.areaSqM * SQM_TO_SQFT >= 300)
        .map((c) => ({ c, d: distanceMeters(point, centroid(c.ring)) }))
        .sort((a, b) => a.d - b.d)[0]
      if (nearest && nearest.d <= 120) chosen = nearest.c
    }

    if (!chosen || chosen.areaSqM <= 0) return null
    return { footprintSqFt: chosen.areaSqM * SQM_TO_SQFT, source: "osm" }
  } catch {
    return null
  }
}

/** Raw roof geometry read from the Google Solar API, before any modeling. */
interface SolarRaw {
  /** Ground-projected (horizontal) roof plan area in sq ft, summed over segments. */
  groundPlanSqFt: number
  /** Area-weighted roof pitch, expressed as the familiar x/12 rise. */
  pitchRise: number
  /** Number of roof segments Solar could analyze. */
  segments: number
}

/**
 * Fetch raw roof geometry from Google Solar `buildingInsights` (keyed by
 * lat/lon). Returns the ground-projected plan area and an AREA-WEIGHTED pitch,
 * which benchmarked far more reliably than the single dominant-segment pitch.
 * Modeling (bias correction, pitch, haircut) is applied by the callers.
 */
async function fetchSolarRaw(geo: GeocodeResult): Promise<SolarRaw | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  try {
    const url =
      "https://solar.googleapis.com/v1/buildingInsights:findClosest" +
      `?location.latitude=${geo.lat}` +
      `&location.longitude=${geo.lon}` +
      "&requiredQuality=BASE" +
      `&key=${apiKey}`
    const data = await fetchJson(url)
    const segments: any[] = data?.solarPotential?.roofSegmentStats ?? []
    if (segments.length === 0) return null

    let groundSqM = 0
    let pitchAreaWeighted = 0
    for (const s of segments) {
      const area = s?.stats?.areaMeters2 ?? 0
      groundSqM += area
      pitchAreaWeighted += (s?.pitchDegrees ?? 0) * area
    }
    if (groundSqM <= 0) return null

    const avgPitchDeg = pitchAreaWeighted / groundSqM
    const pitchRise = Math.round(Math.tan((avgPitchDeg * Math.PI) / 180) * 12)

    return {
      groundPlanSqFt: groundSqM * SQM_TO_SQFT,
      pitchRise,
      segments: segments.length,
    }
  } catch {
    return null
  }
}

/**
 * Last-resort fallback: a full measurement from Google Solar alone.
 *
 * Only used when NO property-appraiser, GIS, or building-footprint record can
 * be found �� i.e. the alternative is returning nothing at all. With no county
 * footprint to cross-check against we can't run the max-of-both model, so we
 * just apply the solar bias correction and pitch. (No haircut here: the haircut
 * exists to recentre the max operation, which isn't used on this path.)
 */
async function fromGoogleSolar(geo: GeocodeResult): Promise<RoofMeasurement | null> {
  const solar = await fetchSolarRaw(geo)
  if (!solar || solar.pitchRise < 2) return null

  const rise = Math.min(Math.max(solar.pitchRise, 1), 12)
  const roofPlanSqFt = solar.groundPlanSqFt / SOLAR_PLAN_BIAS
  const roofAreaSqFt = Math.round(roofPlanSqFt * pitchMultiplier(rise))

  return {
    roofAreaSqFt,
    footprintSqFt: Math.round(solar.groundPlanSqFt),
    segments: Math.min(12, Math.max(2, solar.segments)),
    pitch: `${rise}/12`,
    // Lowest confidence of any automated source — it's the safety net.
    confidence: 0.6,
    source: "solar",
  }
}

/**
 * Combine the county footprint estimate with a bias-corrected Google Solar
 * estimate using the calibrated max-of-both model (see SOLAR_PLAN_BIAS /
 * MODEL_HAIRCUT). When solar data is missing or fails its sanity checks we fall
 * back to the county estimate alone (still haircut, since county runs hot too).
 */
function combineEstimates(
  county: RoofMeasurement,
  solar: SolarRaw | null,
  footprintSqFt: number,
): RoofMeasurement {
  let bestArea = county.roofAreaSqFt
  let pitch = county.pitch
  let segments = county.segments
  let source = county.source
  let confidence = county.confidence

  // Solar is only trustworthy when it "sees" the whole roof: its ground plan
  // must be at least the building footprint (otherwise trees dropped segments)
  // and its pitch must be a real sloped reading (guards a wrong building match).
  const solarSane =
    !!solar && solar.groundPlanSqFt >= footprintSqFt && solar.pitchRise >= 2

  if (solar && solarSane) {
    const solarArea = Math.round(
      (solar.groundPlanSqFt / SOLAR_PLAN_BIAS) * pitchMultiplier(solar.pitchRise),
    )

    // Take the larger estimate — the source that didn't silently miss roof
    // area. When solar wins we also adopt its real measured pitch/segments.
    // NOTE: pitch is deliberately tied to whichever source wins the AREA rather
    // than taken from solar on some looser condition. Solar's pitch is excellent
    // on some homes but mis-reads others when it matches the wrong building
    // (verified: 2/12 on a true 4/12 roof) — and that mis-read can happen even
    // when solar's AREA agrees with county within 15%, so area-agreement is NOT
    // a safe gate for trusting solar's pitch. Adopting solar pitch on agreement
    // was tested and merely relocated the error (fixed one home, broke another)
    // for zero net gain, so we keep pitch tied to the area winner.
    if (solarArea > bestArea) {
      bestArea = solarArea
      pitch = `${Math.min(Math.max(solar.pitchRise, 1), 12)}/12`
      segments = Math.min(12, Math.max(2, solar.segments))
      source = "solar-hybrid"
    }

    // Confidence rises when the two independent sources agree closely.
    const disagreement =
      Math.abs(solarArea - county.roofAreaSqFt) / Math.max(county.roofAreaSqFt, 1)
    confidence = disagreement <= 0.15 ? 0.9 : 0.7
  }

  return {
    roofAreaSqFt: Math.round(bestArea * MODEL_HAIRCUT),
    footprintSqFt: Math.round(footprintSqFt),
    segments,
    pitch,
    stories: county.stories,
    confidence,
    source,
  }
}

/** Convert a measured building footprint into a full roof measurement. */
function buildMeasurement(
  footprintSqFt: number,
  source: RoofMeasurement["source"],
  stories?: number,
): RoofMeasurement {
  const footprint = Math.round(footprintSqFt)

  // Convert the ground (under-roof) footprint to the roof PLAN area (still
  // before pitch). This accounts for eave/rake overhangs on every side plus the
  // extra plan area of hips, valleys, and dormers that a flat footprint misses.
  //
  // The factor depends on how the footprint was sourced:
  //   • Authoritative county footprints (property appraiser gross under-roof
  //     area, or county GIS building polygons) are true ground footprints.
  //     Benchmarked against GAF QuickMeasure "Roof Area" vs. the Duval PAO gross
  //     footprint, measured roof area runs ~1.28x the footprint before pitch,
  //     tightly and consistently (Clemson 4/12, Dijon 5/12, Pablo Point 5/12
  //     all within ~±3% with this factor and a 5/12 pitch assumption).
  //   • USA Structures / OSM outlines are imagery-traced and noisy — they
  //     already approximate roof extent and, in counties with no parcel to snap
  //     to, can over-capture adjacent structures. A modest 1.10 factor avoids
  //     amplifying that noise into wild overestimates.
  const isTrueFootprint = source === "county-appraiser" || source === "county-gis"
  const roofPlanFactor = isTrueFootprint ? 1.28 : 1.1
  const roofPlanSqFt = footprint * roofPlanFactor

  // We can't read true pitch from a 2D footprint, so assume a 5/12 slope — the
  // predominant pitch across the benchmark reports. This is the true measured
  // roof surface area; the material waste factor is a pricing concept applied
  // later, and is NOT baked into the displayed measurement.
  const pitch = "5/12"
  const pitchMultiplier = Math.sqrt(5 * 5 + 12 * 12) / 12 // ≈ 1.083
  const roofAreaSqFt = Math.round(roofPlanSqFt * pitchMultiplier)

  const segments = Math.min(8, Math.max(2, 2 + Math.round(footprint / 1400)))

  const confidence =
    source === "county-appraiser"
      ? 0.9
      : source === "county-gis"
        ? 0.85
        : source === "usa-structures"
          ? 0.82
          : 0.7

  return {
    roofAreaSqFt,
    footprintSqFt: footprint,
    segments,
    pitch,
    stories,
    confidence,
    source,
  }
}

export type ServerMeasureResult =
  | { status: "ok"; measurement: RoofMeasurement; matchedAddress?: string }
  | { status: "out-of-area"; county?: string; matchedAddress?: string }
  | { status: "not-found" }

/** Counties this tool currently serves, for display in the UI. */
export const SERVICE_AREA_COUNTIES = DEFAULT_CONFIG.counties

type VerifiedServiceArea = { state: string; county: string }

/**
 * Measure a roof from a street address using only free public data.
 * Returns `out-of-area` outside the service area and `not-found` when no
 * building footprint can be located.
 */
export async function measureRoofFromAddress(
  address: string,
  serviceArea: VerifiedServiceArea,
): Promise<ServerMeasureResult> {
  const geo = await geocode(address)
  if (!geo) return { status: "not-found" }
  return measureRoofFromGeo(geo, serviceArea)
}

/**
 * Reverse-geocode a coordinate to its county FIPS via the US Census Geocoder
 * (free, no key). Used when the customer repositions the confirmation pin onto
 * the correct house — the corrected point may sit in a different parcel (or, at
 * a boundary, a different county), so we re-derive the service-area county from
 * the moved coordinate rather than trusting the original address geocode.
 */
async function reverseGeocodeCounty(
  lat: number,
  lon: number,
): Promise<{ countyFips?: string; countyName?: string }> {
  const url =
    "https://geocoding.geo.census.gov/geocoder/geographies/coordinates" +
    `?x=${lon}&y=${lat}` +
    "&benchmark=Public_AR_Current&vintage=Current_Current&format=json"
  try {
    const data = await fetchJson(url)
    const county = data?.result?.geographies?.["Counties"]?.[0]
    return {
      countyFips: county?.STATE && county?.COUNTY
        ? `${county.STATE}${county.COUNTY}`
        : undefined,
      countyName: county?.NAME,
    }
  } catch {
    return {}
  }
}

/**
 * Measure a roof from an exact coordinate — used when the customer drags the
 * aerial confirmation pin onto the correct roof. We reverse-geocode the moved
 * point for the service-area check, then run the same measurement pipeline as
 * the address path (every footprint source is a spatial point-query, so the
 * corrected lat/lon transparently targets the right building). The original
 * selected address is retained for display since the customer is only fixing
 * pin placement, not changing whose home it is.
 */
export async function measureRoofFromLatLon(
  lat: number,
  lon: number,
  address?: string,
  serviceArea?: VerifiedServiceArea,
): Promise<ServerMeasureResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !serviceArea) {
    return { status: "not-found" }
  }
  const county = await reverseGeocodeCounty(lat, lon)
  return measureRoofFromGeo({
    lat,
    lon,
    countyFips: county.countyFips,
    countyName: county.countyName,
    matchedAddress: address,
  }, serviceArea)
}

/**
 * Core measurement pipeline shared by the address and lat/lon entry points.
 * Takes a resolved geocode (coordinate + county) and returns a full estimate,
 * or `out-of-area` / `not-found`.
 */
async function measureRoofFromGeo(
  geo: GeocodeResult,
  serviceArea: VerifiedServiceArea,
): Promise<ServerMeasureResult> {
  const countyName = (geo.countyName || (geo.countyFips ? COUNTY_SOURCES[geo.countyFips]?.name : "") || "").trim()
  const stateMatches = Boolean(
    geo.countyFips && STATE_FIPS[serviceArea.state] === geo.countyFips.slice(0, 2),
  )
  const countyMatches = matchCountyNameForState(serviceArea.state, countyName) === serviceArea.county

  // The expected service area came from the signed Google address token. We
  // still re-derive the county here so a moved map pin cannot cross a boundary.
  if (!stateMatches || !countyMatches) {
    return {
      status: "out-of-area",
      county: countyName || undefined,
      matchedAddress: geo.matchedAddress,
    }
  }

  // Source order (most authoritative / reliable first):
  //   1. Duval County property appraiser building area (gross under-roof
  //      footprint scraped from the PAO record) — our primary market.
  //   2. FDOR statewide cadastral (property-appraiser living area) for counties
  //      whose appraiser sites are bot-blocked (Clay, Nassau, St. Johns).
  //   3. Generic county property appraiser / GIS footprints, when configured.
  //   4. National USA Structures footprints (address- and parcel-matched,
  //      keyless) — covers newer construction and does not depend on the
  //      rate-limited OSM API.
  //   5. OpenStreetMap buildings snapped to the county parcel (last resort).
  //
  // The county parcel polygon (when available) is fetched once and shared so
  // both the USA Structures and OSM steps snap buildings to the correct lot.
  let hit =
    (geo.countyFips === DUVAL_FIPS ? await fromDuvalAppraiser(geo) : null) ??
    (await fromCountyAppraiser(geo)) ??
    (await fromCountyGis(geo))
  if (!hit) {
    const targetHouseNo = houseNumber(geo.matchedAddress)
    const parcelRing = await fetchParcelRing(geo)
    const polygonHit =
      (await fromUsaStructures(geo, targetHouseNo, parcelRing)) ??
      (await fromOsm(geo, parcelRing))

    // For statewide-cadastral counties, prefer the authoritative appraiser
    // living area, using the footprint polygon (if any) to infer stories. Fall
    // back to the raw polygon footprint when the tax roll has no usable record.
    if (geo.countyFips && STATEWIDE_CADASTRAL_FIPS.has(geo.countyFips)) {
      hit =
        (await fromStatewideCadastral(
          geo,
          targetHouseNo,
          polygonHit?.footprintSqFt ?? null,
        )) ?? polygonHit
    } else {
      hit = polygonHit
    }
  }

  // Last-resort fallback: when no footprint source located the building at all,
  // try the Google Solar API, which measures the roof straight from aerial
  // imagery using only the geocoded lat/lon. Returns a complete measurement, so
  // it bypasses the footprint→roof modeling below.
  if (!hit) {
    const solar = await fromGoogleSolar(geo)
    if (solar && solar.roofAreaSqFt >= 300 && solar.roofAreaSqFt <= 30000) {
      return { status: "ok", measurement: solar, matchedAddress: geo.matchedAddress }
    }
    return { status: "not-found" }
  }

  // Sanity bounds — reject obviously-wrong footprints (tiny sheds / huge commercial).
  if (hit.footprintSqFt < 200 || hit.footprintSqFt > 20000) {
    return { status: "not-found" }
  }

  // We have an authoritative footprint. Build the county estimate, then cross-
  // check it against Google Solar and combine via the calibrated max-of-both
  // model. Solar is fetched in parallel-safe fashion (single await) and the
  // combiner degrades gracefully to county-only when solar is missing/insane.
  const county = buildMeasurement(hit.footprintSqFt, hit.source, hit.stories)
  const solar = await fetchSolarRaw(geo)

  return {
    status: "ok",
    measurement: combineEstimates(county, solar, hit.footprintSqFt),
    matchedAddress: geo.matchedAddress,
  }
}
