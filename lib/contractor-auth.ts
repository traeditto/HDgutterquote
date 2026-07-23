import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

export const CONTRACTOR_COOKIE = "gutterquote_contractor"

function sessionSecret() {
  const value = process.env.PLATFORM_SESSION_SECRET
  if (!value || value.length < 32) {
    throw new Error(
      "PLATFORM_SESSION_SECRET must contain at least 32 characters.",
    )
  }
  return value
}

export function createContractorSession(tenantId: string) {
  const payload = Buffer.from(
    JSON.stringify({
      tenantId,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7,
    }),
  ).toString("base64url")
  const signature = createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url")
  return `${payload}.${signature}`
}

export function readContractorSession(value?: string) {
  if (!value) return null
  const [payload, supplied, extra] = value.split(".")
  if (!payload || !supplied || extra) return null

  const expected = createHmac("sha256", sessionSecret())
    .update(payload)
    .digest()
  const actual = Buffer.from(supplied, "base64url")
  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    return null
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { tenantId?: string; expiresAt?: number }
    return parsed.tenantId &&
      parsed.expiresAt &&
      parsed.expiresAt > Date.now()
      ? parsed.tenantId
      : null
  } catch {
    return null
  }
}
