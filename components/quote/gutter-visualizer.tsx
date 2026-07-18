"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Sparkles, ImageOff, RotateCcw, Home, Satellite } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Angle = "street" | "satellite"

interface VisualizeResult {
  before: string
  after: string
  angle: Angle
  year?: number
}

const MAX_RENDERS = 4

interface GutterVisualizerProps {
  address: string
  materialName: string
  colorName: string
  colorHex: string
  coords: { lat: number; lon: number } | null
}

export function GutterVisualizer({
  address,
  materialName,
  colorName,
  colorHex,
  coords,
}: GutterVisualizerProps) {
  const [angle, setAngle] = useState<Angle>("street")
  const coordKey = coords ? `${coords.lat.toFixed(6)},${coords.lon.toFixed(6)}` : "address"
  const cacheKey = `${materialName}::${colorName}::${angle}::${coordKey}`
  const cache = useRef<Map<string, VisualizeResult>>(new Map())

  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [result, setResult] = useState<VisualizeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renderCount, setRenderCount] = useState(0)
  const rendersLeft = MAX_RENDERS - renderCount
  const limitReached = rendersLeft <= 0

  useEffect(() => {
    const cached = cache.current.get(cacheKey)
    if (cached) {
      setResult(cached)
      setStatus("done")
    } else {
      setResult(null)
      setStatus("idle")
    }
    setError(null)
  }, [cacheKey])

  const generate = useCallback(async () => {
    if (renderCount >= MAX_RENDERS) {
      setError(
        `You've used all ${MAX_RENDERS} previews for this quote. Contact us to see more color options.`,
      )
      setStatus("error")
      return
    }
    setStatus("loading")
    setError(null)
    try {
      const res = await fetch("/api/visualize-gutters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          material: materialName,
          color: colorName,
          colorHex,
          coords,
          angle,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? "We couldn't generate the preview.")
        setStatus("error")
        return
      }
      const next: VisualizeResult = data
      cache.current.set(cacheKey, next)
      setResult(next)
      setRenderCount((c) => c + 1)
      setStatus("done")
    } catch {
      setError("Network error while generating the preview.")
      setStatus("error")
    }
  }, [address, materialName, colorName, colorHex, coords, angle, cacheKey, renderCount])

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-accent" />
          <div>
            <h3 className="font-heading text-base font-bold text-foreground">
              See the gutter color on your home
            </h3>
            <p className="text-xs text-muted-foreground">
              {materialName} in{" "}
              <span className="font-medium text-foreground">{colorName}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-border bg-muted p-0.5"
            role="group"
            aria-label="Choose preview angle"
          >
            {(
              [
                { value: "street", label: "Street", Icon: Home },
                { value: "satellite", label: "Aerial", Icon: Satellite },
              ] as const
            ).map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setAngle(value)}
                aria-pressed={angle === value}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  angle === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          {status === "done" && (
            <Button
              variant="outline"
              size="sm"
              onClick={generate}
              disabled={limitReached}
              className="gap-1.5 bg-transparent"
            >
              <RotateCcw className="size-3.5" />
              Regenerate
            </Button>
          )}
        </div>
      </div>

      <div className="relative mt-4 aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-muted">
        {status === "idle" && !limitReached && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-pretty text-sm text-muted-foreground">
              Generate a photorealistic preview showing {colorName} gutters and
              downspouts on this home.
            </p>
            <Button onClick={generate} className="gap-2">
              <Sparkles className="size-4" />
              Preview on my home
            </Button>
            <p className="text-pretty text-xs text-muted-foreground">
              If Street View catches the wrong house, switch to Aerial. It uses
              the confirmed map pin.
            </p>
          </div>
        )}

        {status === "idle" && limitReached && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <ImageOff className="size-6 text-muted-foreground" />
            <p className="text-pretty text-sm text-muted-foreground">
              You&apos;ve used all {MAX_RENDERS} previews for this quote.
            </p>
          </div>
        )}

        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <Loader2 className="size-6 animate-spin text-accent" />
            <p className="text-sm text-muted-foreground">
              Rendering your home with {colorName} gutters&hellip;
            </p>
            <p className="text-xs text-muted-foreground">This can take a few seconds.</p>
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <ImageOff className="size-6 text-muted-foreground" />
            <p className="text-pretty text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={generate} className="bg-transparent">
              Try again
            </Button>
          </div>
        )}

        {status === "done" && result && (
          <BeforeAfter before={result.before} after={result.after} afterLabel={colorName} />
        )}
      </div>

      {status === "done" && result && (
        <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
          AI-generated visualization from{" "}
          {result.angle === "street" ? "a street-level" : "an aerial"} photo of your
          home{result.year ? ` (${result.year})` : ""}. For illustration only.
        </p>
      )}

      {renderCount > 0 && (
        <p className="mt-2 text-center text-[11px] font-medium text-muted-foreground">
          {limitReached
            ? `${MAX_RENDERS} of ${MAX_RENDERS} previews used`
            : `${rendersLeft} of ${MAX_RENDERS} preview${rendersLeft === 1 ? "" : "s"} left`}
        </p>
      )}
    </div>
  )
}

function BeforeAfter({
  before,
  after,
  afterLabel,
}: {
  before: string
  after: string
  afterLabel: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(50)
  const dragging = useRef(false)

  const setFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pct = ((clientX - rect.left) / rect.width) * 100
    setPos(Math.max(0, Math.min(100, pct)))
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return
      setFromClientX(e.clientX)
    }
    const onUp = () => {
      dragging.current = false
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [setFromClientX])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 cursor-ew-resize select-none"
      onPointerDown={(e) => {
        dragging.current = true
        setFromClientX(e.clientX)
      }}
    >
      <img
        src={before || "/placeholder.svg"}
        alt="Your home today"
        className="pointer-events-none absolute inset-0 size-full object-cover"
        draggable={false}
      />
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      >
        <img
          src={after || "/placeholder.svg"}
          alt={`Your home with ${afterLabel} gutters`}
          className="size-full object-cover"
          draggable={false}
        />
      </div>

      <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">
        New
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Now
      </span>

      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-background shadow"
        style={{ left: `${pos}%` }}
      >
        <div className="absolute top-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background bg-accent text-accent-foreground shadow-md">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
            <path d="m9 6 6 6-6 6" />
          </svg>
        </div>
      </div>
    </div>
  )
}
