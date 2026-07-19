import { NextResponse } from "next/server"
import { generateText } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { fetchBasePhoto, type ImageryAngle } from "@/lib/roof-imagery"
import { allowPlatformRequest, consumeRenderCredit } from "@/lib/contractor-platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
})
// Nano Banana Pro (Gemini 3 Pro Image) — a reasoning-driven image-edit model
// that honors spatial placement rules (e.g. "gutters only on horizontal
// eaves") far more reliably than the older gemini-2.5-flash-image.
const IMAGE_MODEL = "gemini-3-pro-image-preview"
// Fallback if the primary model is unavailable (e.g. after its retirement).
const FALLBACK_IMAGE_MODEL = "gemini-2.5-flash-image"

interface Body {
  address?: string
  material?: string
  color?: string
  colorHex?: string
  coords?: { lat: number; lon: number }
  angle?: ImageryAngle
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { address, material, color, colorHex, coords, angle } = body
  if (!address || !material || !color) {
    return NextResponse.json(
      { error: "address, material, and color are required" },
      { status: 400 },
    )
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json(
      { error: "The visualizer isn't configured yet (missing Gemini API key)." },
      { status: 503 },
    )
  }

  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const hourlyLimit = Math.max(4, Math.min(100, Number(process.env.RENDER_MAX_PER_IP_HOUR || 12) || 12))
  if (!(await allowPlatformRequest("render", client, hourlyLimit, 3600))) {
    return NextResponse.json(
      { error: "Too many AI preview requests. Please try again later." },
      { status: 429 },
    )
  }

  const base = await fetchBasePhoto(
    address,
    angle === "satellite" ? "satellite" : "street",
    coords,
  )
  if (!base) {
    return NextResponse.json(
      { error: "We couldn't find a usable photo of this home." },
      { status: 404 },
    )
  }

  const credit = await consumeRenderCredit()
  if (!credit.allowed) {
    return NextResponse.json(
      { error: "AI home previews are temporarily unavailable." },
      { status: 402 },
    )
  }

  const prompt = buildPrompt(base.angle, material, color, colorHex)

  const messages = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: prompt },
        {
          type: "image" as const,
          image: base.bytes,
          mediaType: base.mediaType,
        },
      ],
    },
  ]

  try {
    let result
    try {
      result = await generateText({ model: google(IMAGE_MODEL), messages })
    } catch (primaryErr) {
      // Primary model unavailable (e.g. retired/rate-limited) — fall back to
      // the older image model so the visualizer keeps working.
      console.error(
        `primary image model ${IMAGE_MODEL} failed, falling back:`,
        (primaryErr as Error).message,
      )
      result = await generateText({
        model: google(FALLBACK_IMAGE_MODEL),
        messages,
      })
    }

    const file = result.files.find((f) => f.mediaType.startsWith("image/"))
    if (!file) {
      return NextResponse.json(
        { error: "The visualizer didn't return an image. Please try again." },
        { status: 502 },
      )
    }

    // Post-process: strip the faint color the model bleeds onto diagonal
    // gable/rake edges. Only strongly-changed pixels (the real gutter run and
    // downspouts) survive; everything the model touched only faintly reverts to
    // the original photo. Falls back to the raw render if compositing fails.
    let afterDataUrl = `data:${file.mediaType};base64,${file.base64}`
    try {
      // Lazy-load so a sharp/native-binary load failure is caught here and
      // safely falls back to the raw render instead of crashing the function.
      const { suppressFaintBleed } = await import("@/lib/gutter-composite")
      const cleaned = await suppressFaintBleed(
        base.bytes,
        Buffer.from(file.base64, "base64"),
      )
      afterDataUrl = `data:${cleaned.mediaType};base64,${cleaned.bytes.toString("base64")}`
    } catch (err) {
      console.error("gutter composite cleanup failed:", (err as Error).message)
    }

    return NextResponse.json({
      before: `data:${base.mediaType};base64,${Buffer.from(base.bytes).toString("base64")}`,
      after: afterDataUrl,
      angle: base.angle,
      year: base.year,
      rendersRemaining: credit.remaining,
    })
  } catch (err) {
    console.error("visualize-gutters generation failed:", (err as Error).message)
    return NextResponse.json(
      { error: "We couldn't generate the preview right now. Please try again." },
      { status: 502 },
    )
  }
}

function buildPrompt(
  angle: ImageryAngle,
  material: string,
  color: string,
  colorHex: string | undefined,
): string {
  const colorNote = colorHex
    ? ` The gutters MUST be painted the exact color ${colorHex} — treat this hex ` +
      `value as the authoritative target and match its hue, lightness, and ` +
      `saturation precisely rather than approximating it.`
    : ""

  if (angle === "street") {
    return (
      `Edit this real street-level photo of a house to add ${material} rain ` +
      `gutters and downspouts in the Spectra color "${color}".${colorNote}\n\n` +
      `THE SINGLE MOST IMPORTANT RULE — WHERE GUTTERS GO:\n` +
      `A real gutter is a straight, HORIZONTAL, perfectly LEVEL trough. It is ` +
      `only ever installed along roof edges that run flat and level with the ` +
      `ground (the eaves, where the low side of the roof meets the top of the ` +
      `wall). \n` +
      `You must ONLY add the colored gutter to these flat, horizontal, level roof ` +
      `edges.\n\n` +
      `ABSOLUTELY FORBIDDEN: Do NOT add any colored gutter to a roof edge that is ` +
      `diagonal, slanted, angled, or sloped. The triangular gable peaks — ` +
      `including the pointed roof edges over the front entryway, porch, and ` +
      `windows — have slanted rake edges that climb up to a point. These slanted ` +
      `edges must remain their ORIGINAL color with NO gutter on them whatsoever. ` +
      `If a roof edge forms any part of a triangle or points upward toward a ` +
      `peak, it gets NO gutter. Only the flat, level bottom edges get a gutter.\n` +
      `Do NOT let the color bleed, trace, taper, or fade onto the slanted rake ` +
      `edges even faintly. Where a horizontal gutter meets a slanted peak, the ` +
      `color must STOP CLEANLY at that corner — zero colored pixels of any ` +
      `opacity may appear on the diagonal edges going up to the peak. The ` +
      `slanted edges keep their exact original roof/trim color.\n\n` +
      `Add natural one-story vertical downspouts running straight down from the ` +
      `ends of the horizontal gutters to the ground. ` +
      `Keep the roof, shingles, siding, brick, trim, windows, doors, garage ` +
      `doors, driveway, landscaping, trees, sky, vehicles, camera angle, ` +
      `lighting, perspective, and shadows completely unchanged. Return a single ` +
      `photorealistic image of the same house.`
    )
  }

  return (
    `Edit this top-down satellite image of a house to add ${material} rain ` +
    `gutters in the Spectra color "${color}".${colorNote}\n\n` +
    `WHERE GUTTERS GO: Add the colored gutter ONLY along the eave edges — the ` +
    `roof edges that run parallel to the long roof ridge. Do NOT add gutters to ` +
    `the sloped rake edges at the gable ends (the shorter edges that angle in ` +
    `toward the ridge line). Only the two long edges running parallel to the ` +
    `ridge get a gutter. ` +
    `Keep the exact roof shape, roof material, driveway, yard, trees, pool, ` +
    `shadows, and neighboring structures unchanged. Return a single ` +
    `photorealistic overhead image.`
  )
}
