"use client"

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { MapPin, Loader2, ImageOff, Check, PenLine, Move, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Aerial confirmation. After the customer selects an address, we show a live
 * satellite image (via /api/aerial) with a pin on the property so they can
 * confirm we're about to estimate the right house before running the quote.
 *
 * The pin is DRAGGABLE: geocoding sometimes lands the pin on a neighbor's roof
 * (especially on large lots or newer streets), so the customer can nudge it
 * onto their actual house. We convert the dragged pixel position back into a
 * corrected lat/lon and measure that exact point. If we can't resolve precise
 * coordinates for the address we fall back to the old static baked-in pin image
 * (no dragging), which still measures by address.
 */

// The aerial image is requested at these logical dimensions (16:10). All
// pixel↔coordinate math is done in this logical space regardless of the
// image's rendered CSS size, then applied proportionally.
const LOGICAL_W = 640
const LOGICAL_H = 400
const ZOOM = 20

type Center = { lat: number; lon: number; zoom: number }

/** Web-Mercator projection into Google's 256px world space. */
function project(lat: number, lng: number): { x: number; y: number } {
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999)
  const x = 256 * (0.5 + lng / 360)
  const y = 256 * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI))
  return { x, y }
}

/** Inverse Web-Mercator projection from 256px world space back to lat/lng. */
function unproject(x: number, y: number): { lat: number; lng: number } {
  const lng = (x / 256 - 0.5) * 360
  const m = 0.5 - y / 256
  const lat = (Math.asin(Math.tanh(2 * Math.PI * m)) * 180) / Math.PI
  return { lat, lng }
}

/**
 * Convert the pin's fractional position within the image (0..1, where 0.5,0.5
 * is the image center) into a corrected lat/lon, given the image's true center
 * and zoom.
 */
function pinToLatLon(center: Center, fx: number, fy: number): { lat: number; lon: number } {
  const scale = 2 ** center.zoom
  const world = project(center.lat, center.lon)
  const worldX = world.x + ((fx - 0.5) * LOGICAL_W) / scale
  const worldY = world.y + ((fy - 0.5) * LOGICAL_H) / scale
  const { lat, lng } = unproject(worldX, worldY)
  return { lat, lon: lng }
}

export function ConfirmStep({
  address,
  addressToken,
  sessionId,
  onConfirm,
  onEdit,
}: {
  address: string
  addressToken: string
  sessionId: string
  onConfirm: (coords?: { lat: number; lon: number }) => void
  onEdit: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  // The resolved image center; null until located. When it stays null we render
  // the non-draggable fallback image.
  const [center, setCenter] = useState<Center | null>(null)
  const [locating, setLocating] = useState(true)
  // Pin position as a fraction of the image (0.5,0.5 = center = geocoded point).
  const [pin, setPin] = useState({ x: 0.5, y: 0.5 })
  const [dragging, setDragging] = useState(false)

  const frameRef = useRef<HTMLDivElement>(null)

  // Resolve the exact center coordinate so we can offer a draggable pin.
  useEffect(() => {
    let cancelled = false
    setLocating(true)
    setLoaded(false)
    setFailed(false)
    setPin({ x: 0.5, y: 0.5 })

    const query = new URLSearchParams({
      sessionId,
      addressToken,
      format: "json",
      zoom: String(ZOOM),
    })
    fetch(`/api/aerial?${query}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data && typeof data.lat === "number" && typeof data.lon === "number") {
          setCenter({ lat: data.lat, lon: data.lon, zoom: data.zoom ?? ZOOM })
        } else {
          setCenter(null)
        }
      })
      .catch(() => {
        if (!cancelled) setCenter(null)
      })
      .finally(() => {
        if (!cancelled) setLocating(false)
      })

    return () => {
      cancelled = true
    }
  }, [address, addressToken, sessionId])

  const moved = Math.abs(pin.x - 0.5) > 0.01 || Math.abs(pin.y - 0.5) > 0.01

  function updatePinFromEvent(e: ReactPointerEvent) {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return
    const fx = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    const fy = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1)
    setPin({ x: fx, y: fy })
  }

  function handlePointerDown(e: ReactPointerEvent) {
    if (!center) return
    e.preventDefault()
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture can fail (e.g. synthetic events); dragging still works
      // via the frame-level move/up handlers, so ignore.
    }
    setDragging(true)
    updatePinFromEvent(e)
  }

  function handlePointerUp(e: ReactPointerEvent) {
    if (!dragging) return
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // Mirror the capture guard above.
    }
    setDragging(false)
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (!dragging) return
    updatePinFromEvent(e)
  }

  function handleConfirm() {
    if (center) {
      onConfirm(pinToLatLon(center, pin.x, pin.y))
    } else {
      onConfirm()
    }
  }

  // Draggable path uses a marker-less image centered on the resolved point;
  // fallback path uses the address with the baked-in server pin.
  const imageQuery = new URLSearchParams({
    sessionId,
    addressToken,
    zoom: String(ZOOM),
    w: String(LOGICAL_W),
    h: String(LOGICAL_H),
  })
  if (center) {
    imageQuery.set("lat", String(center.lat))
    imageQuery.set("lon", String(center.lon))
    imageQuery.set("pin", "off")
  }
  const src = `/api/aerial?${imageQuery}`

  return (
    <div className="mx-auto max-w-xl text-center">
      <h2 className="text-balance text-2xl font-bold text-foreground sm:text-3xl">
        Is this your home?
      </h2>
      <p className="mt-2 text-pretty text-sm text-muted-foreground">
        {center
          ? "Drag the pin onto your house if it's on the wrong property, then confirm."
          : "Confirm we've got the right property so your gutter estimate is accurate."}
      </p>

      <div
        ref={frameRef}
        className="relative mx-auto mt-6 aspect-[16/10] w-full touch-none select-none overflow-hidden rounded-2xl border border-border bg-muted shadow-sm"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {(!loaded || locating) && !failed && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted">
            <Loader2 className="size-6 animate-spin text-accent" />
          </div>
        )}

        {failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <ImageOff className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t load an aerial view, but we can still measure this
              address.
            </p>
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src || "/placeholder.svg"}
              alt={`Aerial satellite view of ${address}`}
              className="pointer-events-none size-full object-cover"
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />

            {/* Draggable pin (only when we have exact coordinates). */}
            {center && loaded && (
              <button
                type="button"
                aria-label="Drag to reposition onto your house"
                onPointerDown={handlePointerDown}
                className="absolute z-20 -translate-x-1/2 -translate-y-full cursor-grab touch-none rounded-full active:cursor-grabbing"
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
              >
                <MapPin
                  className={`size-9 fill-accent text-accent-foreground drop-shadow-md transition-transform ${
                    dragging ? "scale-110" : ""
                  }`}
                  strokeWidth={2.5}
                />
              </button>
            )}

            {/* Drag hint chip. */}
            {center && loaded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/80 px-3 py-1 text-xs font-medium text-background backdrop-blur-sm">
                  <Move className="size-3.5" />
                  {moved ? "Measuring this spot" : "Drag the pin if needed"}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-foreground">
        <MapPin className="size-4 shrink-0 text-accent" />
        <span className="text-pretty">{address}</span>
      </div>

      {center && moved && (
        <button
          type="button"
          onClick={() => setPin({ x: 0.5, y: 0.5 })}
          className="mx-auto mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <RotateCcw className="size-3.5" />
          Reset pin to original location
        </button>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button size="lg" onClick={handleConfirm} className="gap-2">
          <Check className="size-4" />
          Yes, estimate my gutters
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={onEdit}
          className="gap-2 bg-transparent"
        >
          <PenLine className="size-4" />
          No, edit address
        </Button>
      </div>
    </div>
  )
}
