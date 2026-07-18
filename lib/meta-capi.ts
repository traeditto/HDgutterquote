// Meta Conversions API (CAPI) — server-side event delivery.
//
// Sends conversion events directly from our server to Meta, which is more
// resilient to ad blockers and browser tracking limits than the pixel alone.
// Events share an `eventId` with the browser pixel so Meta deduplicates them.
//
// Required env:
//   NEXT_PUBLIC_META_PIXEL_ID  — the pixel/dataset id (also used by the pixel)
//   META_CAPI_ACCESS_TOKEN     — a Conversions API access token
// Optional env:
//   META_TEST_EVENT_CODE       — routes events to "Test Events" while testing

import { createHash } from "crypto"
import { DEFAULT_CONFIG } from "@/lib/company-config"

const PIXEL_ID = DEFAULT_CONFIG.metaPixelId || process.env.NEXT_PUBLIC_META_PIXEL_ID
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE
const API_VERSION = "v21.0"

/** SHA-256 hash normalized user data, as required by Meta for matching. */
function hash(value: string | undefined | null): string | undefined {
  const normalized = (value ?? "").trim().toLowerCase()
  if (!normalized) return undefined
  return createHash("sha256").update(normalized).digest("hex")
}

/** Digits-only phone, including country code where possible, then hashed. */
function hashPhone(phone: string | undefined | null): string | undefined {
  const digits = (phone ?? "").replace(/\D/g, "")
  if (!digits) return undefined
  // Assume US if a 10-digit number is provided (Meta expects a country code).
  const withCountry = digits.length === 10 ? `1${digits}` : digits
  return createHash("sha256").update(withCountry).digest("hex")
}

export interface CapiUser {
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
  city?: string
  state?: string
  zip?: string
  /** _fbp cookie value (browser pixel). */
  fbp?: string
  /** _fbc cookie value (click id). */
  fbc?: string
  /** Client IP address. */
  ip?: string
  /** Client user agent. */
  userAgent?: string
}

export interface CapiEvent {
  eventName: string
  eventId: string
  /** The page URL where the event happened. */
  eventSourceUrl?: string
  user: CapiUser
  customData?: Record<string, unknown>
}

/**
 * Split a full name into first/last for hashed matching.
 */
export function splitName(name: string | undefined | null): {
  firstName?: string
  lastName?: string
} {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { firstName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") }
}

/**
 * Send a single event to the Conversions API. Never throws — logs and returns
 * false on failure so lead capture is never blocked by tracking.
 */
export async function sendCapiEvent(event: CapiEvent): Promise<boolean> {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.log("[v0] Meta CAPI not configured — event skipped")
    return false
  }

  const { user } = event
  const userData: Record<string, unknown> = {
    em: hash(user.email),
    ph: hashPhone(user.phone),
    fn: hash(user.firstName),
    ln: hash(user.lastName),
    ct: hash(user.city),
    st: hash(user.state),
    zp: hash(user.zip),
    fbp: user.fbp,
    fbc: user.fbc,
    client_ip_address: user.ip,
    client_user_agent: user.userAgent,
  }
  // Drop undefined keys so Meta doesn't reject the payload.
  for (const key of Object.keys(userData)) {
    if (userData[key] === undefined) delete userData[key]
  }

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: event.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        action_source: "website",
        event_source_url: event.eventSourceUrl,
        user_data: userData,
        custom_data: event.customData,
      },
    ],
  }
  if (TEST_EVENT_CODE) body.test_event_code = TEST_EVENT_CODE

  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    )
    if (!res.ok) {
      const text = await res.text()
      console.log("[v0] Meta CAPI error:", res.status, text)
      return false
    }
    return true
  } catch (err) {
    console.log("[v0] Meta CAPI exception:", err)
    return false
  }
}
