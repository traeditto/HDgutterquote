import sharp from "sharp"

/**
 * Cleans up an AI gutter render by suppressing "faint bleed" — the weak,
 * ghosted color the image model tends to smear up the diagonal gable/rake
 * edges even when told not to.
 *
 * How it works (geometry-free, so there is nothing to misdetect):
 *   - We diff the model's output ("after") against the pristine original photo
 *     ("before") pixel by pixel.
 *   - A real gutter/downspout is a STRONG, saturated color change (large delta).
 *     Faint bleed on a rake edge is a WEAK tint (small delta).
 *   - We build a per-pixel alpha from the change magnitude: weak changes fade
 *     back to the original photo, strong changes keep the rendered gutter, with
 *     a smooth ramp between so gutter edges stay soft.
 *   - final = before * (1 - alpha) + after * alpha
 *
 * Because low-delta regions (where the bleed lives) revert to the original,
 * there is never a visible seam: those pixels were already nearly identical to
 * the original. Anything the model changed only faintly — including the gable
 * ghosting — is erased, while the bold gutter run and downspouts survive.
 */

/** Below this RGB distance a change is treated as pure noise/bleed → dropped. */
const BLEED_FLOOR = 34
/** At/above this RGB distance a change is a real gutter → fully kept. */
const GUTTER_CEILING = 80

export async function suppressFaintBleed(
  beforeBytes: Uint8Array,
  afterBytes: Uint8Array,
): Promise<{ bytes: Buffer; mediaType: string }> {
  const afterBuf = Buffer.from(afterBytes)
  const beforeBuf = Buffer.from(beforeBytes)

  // Work at the rendered image's resolution; align the original to match.
  const meta = await sharp(afterBuf).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height) {
    return { bytes: afterBuf, mediaType: "image/png" }
  }

  const after = await sharp(afterBuf).ensureAlpha().raw().toBuffer()
  const before = await sharp(beforeBuf)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer()

  const out = Buffer.alloc(width * height * 4)
  const range = GUTTER_CEILING - BLEED_FLOOR

  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    const dr = after[o] - before[o]
    const dg = after[o + 1] - before[o + 1]
    const db = after[o + 2] - before[o + 2]
    const delta = Math.sqrt(dr * dr + dg * dg + db * db)

    let alpha = (delta - BLEED_FLOOR) / range
    if (alpha < 0) alpha = 0
    else if (alpha > 1) alpha = 1

    const inv = 1 - alpha
    out[o] = before[o] * inv + after[o] * alpha
    out[o + 1] = before[o + 1] * inv + after[o + 1] * alpha
    out[o + 2] = before[o + 2] * inv + after[o + 2] * alpha
    out[o + 3] = 255
  }

  const bytes = await sharp(out, { raw: { width, height, channels: 4 } })
    .jpeg({ quality: 90 })
    .toBuffer()

  return { bytes, mediaType: "image/jpeg" }
}
