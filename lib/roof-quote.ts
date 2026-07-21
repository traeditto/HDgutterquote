// Core domain logic for the instant gutter quote tool. Company-specific
// products and prices are supplied by the white-label configuration.

import {
  DEFAULT_CONFIG,
  storyTier,
  type GutterProduct,
  type StoryPrices,
} from "@/lib/company-config"

export type MaterialId = string
export type RoofMaterial = GutterProduct

export interface RoofMeasurement {
  /** Total roof surface area in square feet (accounts for pitch). */
  roofAreaSqFt: number
  /** Building footprint in square feet. */
  footprintSqFt: number
  /** Number of distinct roof facets/segments detected. */
  segments: number
  /** Estimated roof pitch, e.g. "6/12". */
  pitch: string
  /**
   * Number of building stories, when it could be detected/derived. Drives
   * height-based gutter and downspout pricing. Undefined means unknown, which
   * the pricing model treats as a single story until the customer adjusts it.
   */
  stories?: number
  /** Confidence of the measurement, 0-1. */
  confidence: number
  /** Source of the measurement, useful for analytics/debugging. */
  source:
    | "county-appraiser"
    | "county-gis"
    | "usa-structures"
    | "osm"
    | "solar"
    | "solar-hybrid"
    | "manual"
  /** Normalized address returned by the geocoder, when available. */
  matchedAddress?: string
}

/** Human-readable label for where a measurement came from. */
export function sourceLabel(source: RoofMeasurement["source"]): string {
  switch (source) {
    case "county-appraiser":
      return "county property appraiser records"
    case "county-gis":
      return "county GIS building footprints"
    case "usa-structures":
      return "national building-footprint records"
    case "osm":
      return "OpenStreetMap building footprints"
    case "solar":
      return "aerial roof imagery"
    case "solar-hybrid":
      return "county records cross-checked with aerial roof imagery"
    case "manual":
      return "the home details you entered"
  }
}

/** Common roof pitches offered in the manual estimate form. */
export const PITCH_OPTIONS = [
  { value: "4/12", label: "Low slope (4/12)" },
  { value: "6/12", label: "Average slope (6/12)" },
  { value: "8/12", label: "Steep slope (8/12)" },
  { value: "10/12", label: "Very steep (10/12)" },
] as const

/**
 * Builds a roof measurement from homeowner-entered details when we can't
 * measure automatically. Footprint = living area / stories; roof area applies
 * the pitch multiplier. The material waste factor is applied later during
 * pricing, not baked into the displayed measurement.
 */
export function measurementFromManualInput(input: {
  livingAreaSqFt: number
  stories: number
  pitch: string
}): RoofMeasurement {
  const stories = Math.max(1, input.stories)
  const footprintSqFt = Math.round(input.livingAreaSqFt / stories)

  // Heated living area excludes the garage, covered porches/lanais, and eave
  // overhangs, so it under-captures the true roof plan area. Apply a ~28% plan
  // factor (garage/porch + overhang + roof complexity) before the homeowner-
  // selected pitch, matching the address-based roof-plan factor so both paths
  // land in the same ballpark.
  const roofPlanSqFt = footprintSqFt * 1.28

  const rise = Number.parseInt(input.pitch.split("/")[0], 10) || 6
  const pitchMultiplier = Math.sqrt(rise * rise + 144) / 12
  const roofAreaSqFt = Math.round(roofPlanSqFt * pitchMultiplier)

  const segments = Math.min(8, Math.max(2, 2 + Math.round(footprintSqFt / 1400)))

  return {
    roofAreaSqFt,
    footprintSqFt,
    segments,
    pitch: input.pitch,
    stories,
    confidence: 0.5,
    source: "manual",
  }
}

export interface MaterialQuote {
  material: RoofMaterial
  low: number
  high: number
}

export type MeasureResult =
  | { status: "ok"; measurement: RoofMeasurement }
  | { status: "out-of-area"; county?: string }
  | { status: "not-found" }
  | { status: "error"; message: string }

/**
 * Measures a roof for the given address by calling the server API, which uses
 * free public data (US Census geocoder -> county property appraiser -> county
 * GIS footprints -> OpenStreetMap). When no data can be found, returns
 * `not-found` so the UI can capture the lead for manual follow-up instead of
 * inventing a number.
 *
 * The UI only depends on the returned `RoofMeasurement` shape, so swapping in a
 * different/commercial provider later means changing only the server module.
 */
export async function measureRoof(
  sessionId: string,
  addressToken: string,
  coords?: { lat: number; lon: number },
): Promise<MeasureResult> {
  try {
    const res = await fetch("/api/measure-roof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Include corrected coordinates when the customer has moved the aerial pin
      // onto the right house; the server then measures that exact point.
      body: JSON.stringify(
        coords
          ? { sessionId, addressToken, lat: coords.lat, lon: coords.lon }
          : { sessionId, addressToken },
      ),
    })

    if (res.status === 422) {
      const data = await res.json().catch(() => null)
      return { status: "out-of-area", county: data?.county ?? undefined }
    }
    if (res.status === 404) return { status: "not-found" }
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      return {
        status: "error",
        message: data?.error ?? "We couldn't reach the measurement service.",
      }
    }

    const measurement = (await res.json()) as RoofMeasurement
    return { status: "ok", measurement }
  } catch {
    return { status: "error", message: "Network error while measuring your home." }
  }
}

/** A "roofing square" is 100 sq ft. Kept for legacy lead reporting. */
export function squares(roofAreaSqFt: number): number {
  return roofAreaSqFt / 100
}

export const DOWNSPOUT_SPACING_FT = 35

/** Installed gutter price per linear foot for a product line at a given height. */
export function gutterPricePerFoot(
  material: RoofMaterial,
  stories: number | undefined | null,
): number {
  return material.pricePerFoot[storyTier(stories)]
}

/** Installed price per downspout at a given height. */
export function downspoutPrice(
  stories: number | undefined | null,
  prices: StoryPrices = DEFAULT_CONFIG.downspoutPrice,
): number {
  return prices[storyTier(stories)]
}

/**
 * Estimate gutter run length from the measured footprint. For now this quotes
 * eaves only by approximating the building perimeter.
 */
export function estimatedGutterLength(measurement: RoofMeasurement): number {
  const footprint = Math.max(measurement.footprintSqFt, 400)
  const width = Math.sqrt(footprint * 1.45)
  const depth = footprint / width
  return Math.round(2 * (width + depth))
}

export function billableRoofArea(roofAreaSqFt: number): number {
  return Math.round(roofAreaSqFt * 1.15)
}

export function billableGutterLength(measurement: RoofMeasurement): number {
  return estimatedGutterLength(measurement)
}

export function downspoutCount(linearFeet: number): number {
  return Math.max(1, Math.ceil(linearFeet / DOWNSPOUT_SPACING_FT))
}

/**
 * Builds a low/high installed-price range for a gutter system. The spread
 * reflects downspout count, fascia condition, access, and corner complexity.
 */
export function quoteForMaterial(
  measurement: RoofMeasurement,
  material: RoofMaterial,
  linearFeet = billableGutterLength(measurement),
  stories: number | undefined | null = measurement.stories,
  downspoutPrices: StoryPrices = DEFAULT_CONFIG.downspoutPrice,
): MaterialQuote {
  const downspouts = downspoutCount(linearFeet)
  const total =
    linearFeet * gutterPricePerFoot(material, stories) +
    (material.kind === "guard-only" ? 0 : downspouts * downspoutPrice(stories, downspoutPrices))

  return {
    material,
    low: Math.round(total),
    high: Math.round(total),
  }
}

export function quoteAll(
  measurement: RoofMeasurement,
  materials: RoofMaterial[],
  linearFeet = billableGutterLength(measurement),
  stories: number | undefined | null = measurement.stories,
  downspoutPrices: StoryPrices = DEFAULT_CONFIG.downspoutPrice,
): MaterialQuote[] {
  return materials.map((material) =>
    quoteForMaterial(measurement, material, linearFeet, stories, downspoutPrices),
  )
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}
