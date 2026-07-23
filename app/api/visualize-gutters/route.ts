import { NextRequest, NextResponse } from "next/server"
import { generateText } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { verifyAddressToken } from "@/lib/address-verification"
import {
  consumeRenderCredit,
  contractorTenantId,
  platformStorageConfigured,
  quoteSessionExists,
  refundRenderCredit,
  refundQuoteRenderAttempt,
  reserveQuoteRenderAttempt,
} from "@/lib/contractor-platform"
import {
  fetchStreetViewMetadata,
  fetchStreetViewPhoto,
  type BasePhoto,
  type StreetViewMetadata,
} from "@/lib/roof-imagery"
import {
  checkRateLimit,
  rateLimitResponse,
  sameOrigin,
} from "@/lib/request-security"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
})
const IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview"
const FALLBACK_IMAGE_MODEL = "gemini-2.5-flash-image"
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const MAX_RENDERS_PER_QUOTE = 4
const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

type RenderSource = "streetview" | "upload"

type RenderInput = {
  source: RenderSource
  sessionId: string
  addressToken: string
  product: string
  material: string
  profile: string
  size: string
  color: string
  colorHex?: string
  photo?: File
}

function formString(form: FormData, key: string) {
  const value = form.get(key)
  return typeof value === "string" ? value.trim() : ""
}

async function readInput(request: Request): Promise<RenderInput> {
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const contentLength = Number(request.headers.get("content-length") || 0)
    if (contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) throw new Error("upload-too-large")
    const form = await request.formData()
    const source = formString(form, "source") as RenderSource
    const photo = form.get("photo")
    return {
      source,
      sessionId: formString(form, "sessionId"),
      addressToken: formString(form, "addressToken"),
      product: formString(form, "product"),
      material: formString(form, "material"),
      profile: formString(form, "profile"),
      size: formString(form, "size"),
      color: formString(form, "color"),
      colorHex: formString(form, "colorHex") || undefined,
      photo: photo instanceof File ? photo : undefined,
    }
  }

  const body = await request.json() as Partial<RenderInput>
  return {
    source: body.source as RenderSource,
    sessionId: typeof body.sessionId === "string" ? body.sessionId.trim() : "",
    addressToken: typeof body.addressToken === "string" ? body.addressToken.trim() : "",
    product: typeof body.product === "string" ? body.product.trim() : "",
    material: typeof body.material === "string" ? body.material.trim() : "",
    profile: typeof body.profile === "string" ? body.profile.trim() : "",
    size: typeof body.size === "string" ? body.size.trim() : "",
    color: typeof body.color === "string" ? body.color.trim() : "",
    colorHex: typeof body.colorHex === "string" ? body.colorHex.trim() : undefined,
  }
}

function validText(value: string, maximum = 160) {
  return value.length > 0 && value.length <= maximum
}

function detectedMediaType(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png"
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp"
  return null
}

async function uploadedPhoto(file: File | undefined): Promise<BasePhoto | null> {
  if (!file || file.size <= 0 || file.size > MAX_UPLOAD_BYTES || !ALLOWED_UPLOAD_TYPES.has(file.type)) return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mediaType = detectedMediaType(bytes)
  if (!mediaType || mediaType !== file.type) return null
  return { bytes, mediaType, source: "upload" }
}

async function refundIfMetered(metered: boolean) {
  if (!metered) return
  try {
    await refundRenderCredit()
  } catch (error) {
    console.error("render credit refund failed:", (error as Error).message)
  }
}

async function refundFailedRender(
  sessionId: string,
  creditMetered: boolean,
  quoteAttemptReserved: boolean,
) {
  await Promise.all([
    refundIfMetered(creditMetered),
    quoteAttemptReserved
      ? refundQuoteRenderAttempt(sessionId).catch((error) => {
          console.error(
            "quote render attempt refund failed:",
            (error as Error).message,
          )
        })
      : Promise.resolve(),
  ])
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-site rendering requests are not allowed." },
      { status: 403 },
    )
  }

  let input: RenderInput
  try {
    input = await readInput(request)
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "upload-too-large"
    return NextResponse.json(
      { error: tooLarge ? "The photo must be 8 MB or smaller." : "Invalid request body." },
      { status: tooLarge ? 413 : 400 },
    )
  }

  if (input.source !== "streetview" && input.source !== "upload") {
    return NextResponse.json({ error: "Choose Street View or upload a photo." }, { status: 400 })
  }
  if (
    !/^[a-zA-Z0-9_-]{8,100}$/.test(input.sessionId) ||
    input.addressToken.length < 20 || input.addressToken.length > 2_000
  ) {
    return NextResponse.json({ error: "A verified quote session is required." }, { status: 400 })
  }

  let verifiedAddress
  try {
    verifiedAddress = verifyAddressToken(input.addressToken, contractorTenantId(), input.sessionId)
  } catch {
    return NextResponse.json({ error: "Address verification is not configured." }, { status: 503 })
  }
  if (!verifiedAddress) {
    return NextResponse.json({ error: "The verified quote session is invalid or expired." }, { status: 400 })
  }
  if (!platformStorageConfigured()) {
    return NextResponse.json(
      { error: "Rendering credits and quote sessions are not configured." },
      { status: 503 },
    )
  }
  if (!(await quoteSessionExists(input.sessionId))) {
    return NextResponse.json(
      { error: "Save the property address before requesting a rendering." },
      { status: 400 },
    )
  }

  if (
    !validText(input.product) || !validText(input.material) ||
    !validText(input.profile) || !validText(input.size) || !validText(input.color) ||
    (input.colorHex && !/^#[0-9a-fA-F]{6}$/.test(input.colorHex))
  ) {
    return NextResponse.json({ error: "The selected gutter details are invalid." }, { status: 400 })
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json(
      { error: "The visualizer isn't configured yet (missing Gemini API key)." },
      { status: 503 },
    )
  }

  const sessionRate = await checkRateLimit({
    request,
    scope: "gutter-render-session",
    identifier: `${contractorTenantId()}:${input.sessionId}`,
    limit: 8,
    windowSeconds: 3600,
  })
  if (!sessionRate.allowed) return rateLimitResponse(sessionRate.retryAfter)

  const hourlyLimit = Math.max(
    4,
    Math.min(
      100,
      Number(process.env.RENDER_MAX_PER_IP_HOUR || 12) || 12,
    ),
  )
  const clientRate = await checkRateLimit({
    request,
    scope: "gutter-render-ip",
    limit: hourlyLimit,
    windowSeconds: 3600,
  })
  if (!clientRate.allowed) return rateLimitResponse(clientRate.retryAfter)

  let base: BasePhoto | null = null
  let streetViewMetadata: StreetViewMetadata | undefined
  if (input.source === "streetview") {
    try {
      streetViewMetadata = await fetchStreetViewMetadata(verifiedAddress.formattedAddress)
    } catch (error) {
      return NextResponse.json({
        code: "streetview-unavailable",
        error: error instanceof Error ? error.message : "Street View is unavailable for this property.",
      }, { status: 502 })
    }
    if (!streetViewMetadata.available) {
      return NextResponse.json({
        code: "streetview-unavailable",
        error: "Street View is unavailable for this property. Upload a clear exterior photo instead.",
      }, { status: 404 })
    }
  } else {
    base = await uploadedPhoto(input.photo)
    if (!base) {
      return NextResponse.json(
        { error: "Upload a valid JPG, PNG, or WebP exterior photo no larger than 8 MB." },
        { status: 400 },
      )
    }
  }

  if (input.source === "streetview") {
    try {
      base = await fetchStreetViewPhoto(verifiedAddress.formattedAddress, streetViewMetadata)
    } catch (error) {
      return NextResponse.json({
        code: "streetview-unavailable",
        error: error instanceof Error ? error.message : "Street View is unavailable for this property.",
      }, { status: 502 })
    }
  }
  if (!base) {
    return NextResponse.json({ error: "The source photo could not be loaded." }, { status: 400 })
  }

  const prompt = buildPrompt(input)
  const messages = [{
    role: "user" as const,
    content: [
      { type: "text" as const, text: prompt },
      { type: "image" as const, image: base.bytes, mediaType: base.mediaType },
    ],
  }]

  // All validation and source-image work is complete. Reserve one of the
  // quote's four preview attempts, then consume exactly one paid credit
  // immediately before the first Gemini call.
  const quoteAttempt = await reserveQuoteRenderAttempt(
    input.sessionId,
    MAX_RENDERS_PER_QUOTE,
  )
  if (!quoteAttempt.ok && quoteAttempt.reason === "missing_session") {
    return NextResponse.json(
      { error: "Save the property address before requesting a rendering." },
      { status: 400 },
    )
  }
  if (!quoteAttempt.ok && quoteAttempt.reason === "quote_limit") {
    return NextResponse.json(
      {
        code: "quote-render-limit",
        error: `This instant quote has reached its ${MAX_RENDERS_PER_QUOTE}-preview limit.`,
        quoteRendersRemaining: 0,
      },
      { status: 429 },
    )
  }

  let credit
  try {
    credit = await consumeRenderCredit()
  } catch (error) {
    await refundQuoteRenderAttempt(input.sessionId).catch(() => undefined)
    console.error("render credit reservation failed:", (error as Error).message)
    return NextResponse.json(
      { error: "Rendering credits are temporarily unavailable." },
      { status: 503 },
    )
  }
  if (!credit.allowed) {
    await refundQuoteRenderAttempt(input.sessionId).catch(() => undefined)
    return NextResponse.json(
      {
        error: "AI home previews are temporarily unavailable.",
        quoteRendersRemaining: Math.min(
          MAX_RENDERS_PER_QUOTE,
          quoteAttempt.remaining + 1,
        ),
      },
      { status: 402 },
    )
  }

  try {
    let result
    try {
      result = await generateText({ model: google(IMAGE_MODEL), messages })
    } catch (primaryError) {
      console.error(`primary image model ${IMAGE_MODEL} failed, falling back:`, (primaryError as Error).message)
      result = await generateText({ model: google(FALLBACK_IMAGE_MODEL), messages })
    }

    const file = result.files.find((candidate) => candidate.mediaType.startsWith("image/"))
    if (!file) {
      await refundFailedRender(input.sessionId, credit.metered, true)
      return NextResponse.json({ error: "The visualizer didn't return an image. Please try again." }, { status: 502 })
    }

    let afterDataUrl = `data:${file.mediaType};base64,${file.base64}`
    try {
      const { suppressFaintBleed } = await import("@/lib/gutter-composite")
      const cleaned = await suppressFaintBleed(base.bytes, Buffer.from(file.base64, "base64"))
      afterDataUrl = `data:${cleaned.mediaType};base64,${cleaned.bytes.toString("base64")}`
    } catch (error) {
      console.error("gutter composite cleanup failed:", (error as Error).message)
    }

    return NextResponse.json({
      before: `data:${base.mediaType};base64,${Buffer.from(base.bytes).toString("base64")}`,
      after: afterDataUrl,
      source: base.source,
      year: base.year,
      rendersRemaining: credit.remaining,
      quoteRendersRemaining: quoteAttempt.remaining,
    })
  } catch (error) {
    await refundFailedRender(input.sessionId, credit.metered, true)
    console.error("visualize-gutters generation failed:", (error as Error).message)
    return NextResponse.json(
      {
        error: "We couldn't generate the preview right now. Please try again.",
        quoteRendersRemaining: Math.min(
          MAX_RENDERS_PER_QUOTE,
          quoteAttempt.remaining + 1,
        ),
      },
      { status: 502 },
    )
  }
}

function buildPrompt(input: RenderInput) {
  const colorTarget = input.colorHex
    ? `The finish must match ${input.colorHex} as closely as realistic lighting permits.`
    : "Match the selected named finish accurately."

  return (
    `Create a realistic product visualization by editing this exterior property photo.\n\n` +
    `SELECTED GUTTER PRODUCT:\n` +
    `- Product: ${input.product}\n` +
    `- Material: ${input.material}\n` +
    `- Profile: ${input.profile}\n` +
    `- Size: ${input.size}\n` +
    `- Color: ${input.color}${input.colorHex ? ` (${input.colorHex})` : ""}\n` +
    `${colorTarget}\n\n` +
    `CHANGE ONLY THE VISIBLE GUTTERS AND DOWNSPOUTS. Follow the house's existing roof edges, ` +
    `eaves, gutter runs, corners, and visible drainage/downspout locations. Keep gutters level ` +
    `along existing horizontal eaves. Do not place gutters on diagonal rake or gable edges. ` +
    `Do not add a gutter run or downspout where the source photo does not support one.\n\n` +
    `PRESERVE EVERYTHING ELSE EXACTLY: roof and shingles, walls and siding, trim, windows, doors, ` +
    `garage doors, landscaping, trees, driveway, walkways, sky, lighting, shadows, reflections, ` +
    `camera position, framing, perspective, people, vehicles, signs, and neighboring properties. ` +
    `Do not redesign the house, replace or recolor the roof, add structures, remove objects, alter ` +
    `the yard, or invent unsupported gutter runs. Return one photorealistic image of the same ` +
    `property with only the selected gutters and downspouts realistically visualized.`
  )
}
