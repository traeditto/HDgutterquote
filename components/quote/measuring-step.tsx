"use client"

import { useEffect, useState } from "react"
import { MapPin, Loader2 } from "lucide-react"

const PHASES = [
  "Geocoding your address…",
  "Searching county GIS records…",
  "Matching building footprint…",
  "Estimating gutter run & downspouts…",
]

export function MeasuringStep({ address }: { address: string }) {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const timers = PHASES.map((_, i) =>
      setTimeout(() => setPhase(i), i * 650),
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div className="mx-auto max-w-xl text-center">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl border border-border shadow-sm">
        <img
          src="/aerial-roof.png"
          alt="Aerial satellite view of the property being estimated"
          className="size-full object-cover"
        />
        {/* Scanning overlay */}
        <div className="pointer-events-none absolute inset-0 bg-primary/20" />
        <div className="scan-line pointer-events-none absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-accent/40 to-transparent" />
        {/* Detected home outline */}
        <svg
          viewBox="0 0 100 100"
          className="pointer-events-none absolute inset-0 size-full"
          aria-hidden="true"
        >
          <polygon
            points="32,38 68,38 72,62 28,62"
            fill="oklch(0.7 0.17 47 / 0.15)"
            stroke="oklch(0.7 0.17 47)"
            strokeWidth="1"
            strokeDasharray="3 2"
            className="dash-anim"
          />
        </svg>
      </div>

      <div className="mt-6 flex items-center justify-center gap-2 text-sm font-medium text-foreground">
        <MapPin className="size-4 text-accent" />
        {address}
      </div>

      <div className="mt-5 flex items-center justify-center gap-2 text-lg font-semibold text-foreground">
        <Loader2 className="size-5 animate-spin text-accent" />
        {PHASES[phase]}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Estimating your gutter run from public GIS &amp; property records — this only
        takes a moment.
      </p>
    </div>
  )
}
