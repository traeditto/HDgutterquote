// Meta (Facebook) Pixel client-side helpers.
//
// The base pixel script is injected by <MetaPixel /> in the root layout, which
// exposes the global `fbq`. These helpers fire standard events and, crucially,
// share an `eventID` with the server-side Conversions API so Meta can
// deduplicate the browser event against the server event.

import { DEFAULT_CONFIG } from "@/lib/company-config"

export const META_PIXEL_ID = DEFAULT_CONFIG.metaPixelId || process.env.NEXT_PUBLIC_META_PIXEL_ID

type FbqArgs =
  | [track: "track" | "trackCustom", event: string]
  | [track: "track" | "trackCustom", event: string, data: Record<string, unknown>]
  | [
      track: "track" | "trackCustom",
      event: string,
      data: Record<string, unknown>,
      options: { eventID?: string },
    ]

declare global {
  interface Window {
    fbq?: (...args: FbqArgs | [string, ...unknown[]]) => void
    _fbq?: unknown
    /** Shared PageView event id set by the inline pixel script, mirrored to CAPI. */
    __metaPageViewId?: string
  }
}

/** True when the pixel is configured and the script has loaded. */
function pixelReady(): boolean {
  return typeof window !== "undefined" && typeof window.fbq === "function"
}

/** Generate a shared event id used to dedupe Pixel and CAPI events. */
export function newEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

/**
 * Fire a standard Pixel event. Pass the same `eventId` to the server-side CAPI
 * call so Meta collapses the two into a single conversion.
 */
export function trackEvent(
  event: string,
  data: Record<string, unknown> = {},
  eventId?: string,
): void {
  if (!pixelReady()) return
  window.fbq?.("track", event, data, eventId ? { eventID: eventId } : undefined)
}
