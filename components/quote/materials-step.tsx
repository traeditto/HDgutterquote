"use client"

import { useState } from "react"
import { Check, Ruler, CornerDownRight, ArrowRight, ExternalLink, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { GutterVisualizer } from "@/components/quote/gutter-visualizer"
import { useCompanyConfig } from "@/components/company-config-provider"
import { enabledProducts, type GutterProductKind } from "@/lib/company-config"
import {
  billableGutterLength,
  downspoutCount,
  formatCurrency,
  quoteAll,
  sourceLabel,
  type MaterialId,
  type RoofMeasurement,
} from "@/lib/roof-quote"

interface MaterialsStepProps {
  address: string
  quoteSessionId: string
  addressToken: string
  measurement: RoofMeasurement
  selected: MaterialId | null
  onSelect: (id: MaterialId) => void
  gutterLength: number | null
  onGutterLengthChange: (linearFeet: number | null) => void
  stories: number
  onStoriesChange: (stories: number) => void
  contractorPreview?: boolean
  onContinue: () => void
}

export function MaterialsStep({
  address,
  quoteSessionId,
  addressToken,
  measurement,
  selected,
  onSelect,
  gutterLength,
  onGutterLengthChange,
  stories,
  onStoriesChange,
  contractorPreview = false,
  onContinue,
}: MaterialsStepProps) {
  const config = useCompanyConfig()
  const materials = enabledProducts(config)
  // Selected gutter finish per material (index into material.colors).
  const [colorIndex, setColorIndex] = useState<Record<string, number>>({})
  const [manualLength, setManualLength] = useState(
    gutterLength ? String(gutterLength) : "",
  )

  const estimatedLinearFeet = billableGutterLength(measurement)
  const totalLinearFeet = gutterLength ?? estimatedLinearFeet
  const downspouts = downspoutCount(totalLinearFeet)
  const quotes = quoteAll(
    measurement,
    materials,
    totalLinearFeet,
    stories,
    config.downspoutPrice,
  )
  const selectedMaterial = materials.find((material) => material.id === selected)

  const stats = [
    {
      icon: Ruler,
      label: gutterLength ? "Quoted gutter run" : "Estimated gutter run",
      value: `${totalLinearFeet.toLocaleString()} ft`,
    },
    {
      icon: CornerDownRight,
      label: selectedMaterial?.kind === "guard-only" ? "Installation type" : "Estimated downspouts",
      value: selectedMaterial?.kind === "guard-only" ? "Guard only" : `${downspouts}`,
    },
  ]

  return (
    <div className="mx-auto max-w-5xl">
      <div className="text-center">
        <h2 className="text-balance font-heading text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
          Your gutter estimate is ready. Pick an option.
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-pretty text-muted-foreground">
          Estimated pricing for{" "}
          <span className="font-medium text-foreground">{address}</span>. Select an
          option to see the installed price range.
        </p>
        <p className="mx-auto mt-2 text-xs text-muted-foreground">
          Home outline estimated from {sourceLabel(measurement.source)}.
        </p>
      </div>

      <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_180px] sm:items-end">
          <div>
            <h3 className="font-heading text-base font-bold text-foreground">
              Quoting only part of the house?
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Use the whole-home eave estimate, or enter the linear feet you want
              priced for a section like the front, back, or one side.
            </p>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Gutter length
            </span>
            <div className="flex h-11 items-center rounded-lg border border-input bg-background px-3.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
              <input
                type="text"
                inputMode="numeric"
                value={manualLength}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^0-9]/g, "")
                  setManualLength(next)
                  const parsed = Number.parseInt(next, 10)
                  onGutterLengthChange(Number.isFinite(parsed) && parsed > 0 ? parsed : null)
                }}
                placeholder={String(estimatedLinearFeet)}
                aria-label="Manual gutter length in linear feet"
                className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
              />
              <span className="ml-2 text-sm text-muted-foreground">ft</span>
            </div>
          </label>
        </div>
        {gutterLength && (
          <button
            type="button"
            onClick={() => {
              setManualLength("")
              onGutterLengthChange(null)
            }}
            className="mt-3 text-sm font-medium text-accent underline-offset-2 hover:underline"
          >
            Use whole-home estimate instead
          </button>
        )}
      </div>

      {/* Building height — drives per-foot gutter and downspout pricing */}
      <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <h3 className="font-heading text-base font-bold text-foreground">
              How many stories is the home?
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Taller homes require more careful access and, for new gutter systems,
              longer downspouts. We prefilled the height we detected — adjust it if
              that&apos;s not right.
            </p>
          </div>
          <div
            role="radiogroup"
            aria-label="Number of stories"
            className="flex shrink-0 rounded-lg border border-input bg-background p-1"
          >
            {[
              { value: 1, label: "1 story" },
              { value: 2, label: "2 story" },
              { value: 3, label: "3+ story" },
            ].map((opt) => {
              const isActive = stories === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => onStoriesChange(opt.value)}
                  className={cn(
                    "rounded-md px-3.5 py-2 text-sm font-semibold transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Measurement summary */}
      <div className="mx-auto mt-6 grid max-w-md grid-cols-2 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-border bg-card p-4 text-center"
          >
            <s.icon className="mx-auto size-5 text-accent" />
            <div className="mt-2 font-heading text-lg font-bold text-foreground">
              {s.value}
            </div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Material cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {quotes.map(({ material, low, high }) => {
          const isSelected = selected === material.id
          const activeColor = colorIndex[material.id] ?? 0
          const selectedColor = material.colors[activeColor]
          const selectedColorName = selectedColor?.name
          const categoryLabel = material.kind === "guard-only"
            ? "Guard for existing gutters"
            : material.kind === "gutter-with-guard"
              ? "New gutter + guard"
              : "New gutter system"
          const sourceUrl = material.sourceUrl && /^https?:\/\//i.test(material.sourceUrl)
            ? material.sourceUrl
            : undefined
          return (
            <div
              key={material.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(material.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onSelect(material.id)
                }
              }}
              aria-pressed={isSelected}
              className={cn(
                "group relative flex cursor-pointer gap-4 overflow-hidden rounded-2xl border bg-card p-4 text-left transition-all",
                isSelected
                  ? "border-accent ring-2 ring-accent/40"
                  : "border-border hover:border-accent/50 hover:shadow-sm",
              )}
            >
              {material.kind === "guard-only" ? (
                <div
                  className="relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted sm:size-28"
                  style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, rgba(0,0,0,.06) 5px 6px)" }}
                >
                  <ShieldCheck className="size-10 text-accent" />
                </div>
              ) : (
                <div
                  className="relative size-24 shrink-0 overflow-hidden rounded-xl border border-border sm:size-28"
                  style={{ backgroundColor: selectedColor?.hex ?? "#f5f2ea" }}
                >
                  <div className="absolute inset-x-0 top-1/2 h-4 -translate-y-1/2 bg-background/45 shadow-inner" />
                  <div className="absolute left-5 top-0 h-full w-3 bg-background/35" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-heading text-base font-bold text-foreground">
                    {material.name}
                  </h3>
                  {material.badge && (
                    <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                      {material.badge}
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {material.description}
                </p>
                <p className="mt-1.5 text-[11px] font-semibold text-accent">{categoryLabel}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>{material.warrantyYears > 0 ? `${material.warrantyYears}-yr manufacturer warranty` : "Manufacturer warranty to be confirmed"}</span>
                  <span>{material.workmanshipYears > 0 ? `${material.workmanshipYears}-yr workmanship warranty` : "Workmanship warranty to be confirmed"}</span>
                </div>

                {/* Finish options */}
                {material.kind !== "guard-only" && <div className="mt-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>Finish:</span>
                    <span className="font-medium text-foreground">
                      {selectedColorName}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {material.colors.map((color, i) => {
                      const isActiveColor = i === activeColor
                      return (
                        <button
                          key={color.name}
                          type="button"
                          title={color.name}
                          aria-label={color.name}
                          aria-pressed={isActiveColor}
                          onClick={(e) => {
                            e.stopPropagation()
                            setColorIndex((prev) => ({
                              ...prev,
                              [material.id]: i,
                            }))
                          }}
                          className={cn(
                            "size-5 rounded-full border transition-transform",
                            isActiveColor
                              ? "ring-2 ring-accent ring-offset-1 ring-offset-card"
                              : "border-border hover:scale-110",
                          )}
                          style={{ backgroundColor: color.hex }}
                        />
                      )
                    })}
                  </div>
                </div>}

                {sourceUrl && (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-accent underline-offset-2 hover:underline"
                  >
                    Manufacturer details <ExternalLink className="size-3" />
                  </a>
                )}

                <div className="mt-3 font-heading text-lg font-extrabold text-foreground">
                  {low === high ? (
                    formatCurrency(low)
                  ) : (
                    <>
                      {formatCurrency(low)}
                      <span className="text-muted-foreground"> – </span>
                      {formatCurrency(high)}
                    </>
                  )}
                </div>
              </div>

              <span
                className={cn(
                  "absolute right-3 top-3 flex size-6 items-center justify-center rounded-full border transition-colors",
                  isSelected
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-background text-transparent group-hover:border-accent/50",
                )}
              >
                <Check className="size-4" />
              </span>
            </div>
          )
        })}
      </div>

      {selected &&
        (() => {
          const material = materials.find((m) => m.id === selected)
          if (!material) return null
          if (material.kind === "guard-only") {
            return (
              <div className="mt-8 rounded-2xl border border-border bg-card p-5 text-center">
                <ShieldCheck className="mx-auto size-7 text-accent" />
                <h3 className="mt-2 font-heading text-base font-bold text-foreground">Protection for the existing gutter system</h3>
                <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">Guard appearance and compatibility vary by roof edge and gutter condition. The contractor will confirm fit, preparation, and the exact installed product during the free inspection.</p>
              </div>
            )
          }
          const color = material.colors[colorIndex[material.id] ?? 0]
          const visualization = visualizationSpecs(material.name, material.kind)
          return (
            <div className="mt-8">
              <GutterVisualizer
                disabled={contractorPreview}
                quoteSessionId={quoteSessionId}
                addressToken={addressToken}
                productName={material.name}
                material={visualization.material}
                profile={visualization.profile}
                size={visualization.size}
                colorName={color?.name ?? "Standard finish"}
                colorHex={color?.hex ?? "#f5f2ea"}
              />
            </div>
          )
        })()}

      <div className="mt-8 flex flex-col items-center gap-3">
        <Button
          onClick={onContinue}
          disabled={!selected}
          className="h-12 w-full max-w-sm gap-2 rounded-full bg-accent text-base font-semibold text-accent-foreground hover:bg-accent/90"
        >
          Book my free gutter inspection
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function visualizationSpecs(name: string, kind: GutterProductKind) {
  const size = name.match(/\b\d+(?:\.\d+)?[- ]inch\b/i)?.[0].replace("-", " ") ?? "the selected product size"
  const material = /aluminum/i.test(name)
    ? "aluminum"
    : /steel/i.test(name)
      ? "steel"
      : "the material specified by the selected product"
  const profile = /half[- ]round/i.test(name)
    ? "half-round"
    : /leafguard|one[- ]piece|hood/i.test(name)
      ? "integrated hooded one-piece"
      : kind === "gutter-with-guard"
        ? "seamless gutter with the selected guard profile"
        : "seamless K-style"
  return { material, profile, size }
}
