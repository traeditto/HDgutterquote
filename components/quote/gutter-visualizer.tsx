"use client"

import { useCallback, useEffect, useState } from "react"
import { Camera, CheckCircle2, ImageOff, Loader2, RotateCcw, Sparkles, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ImageSource = "streetview" | "upload"
type StreetViewStatus = "checking" | "available" | "unavailable"

interface VisualizeResult {
  before: string
  after: string
  source: ImageSource
  year?: number
  quoteRendersRemaining?: number
}

const MAX_RENDERS = 4
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

interface GutterVisualizerProps {
  disabled?: boolean
  quoteSessionId: string
  addressToken: string
  productName: string
  material: string
  profile: string
  size: string
  colorName: string
  colorHex: string
}

export function GutterVisualizer({
  disabled = false,
  quoteSessionId,
  addressToken,
  productName,
  material,
  profile,
  size,
  colorName,
  colorHex,
}: GutterVisualizerProps) {
  const [source, setSource] = useState<ImageSource>("streetview")
  const [streetViewStatus, setStreetViewStatus] = useState<StreetViewStatus>("checking")
  const [streetViewMessage, setStreetViewMessage] = useState("")
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [result, setResult] = useState<VisualizeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renderCount, setRenderCount] = useState(0)
  const rendersLeft = MAX_RENDERS - renderCount
  const limitReached = rendersLeft <= 0

  useEffect(() => {
    if (disabled || !quoteSessionId || !addressToken) return
    const controller = new AbortController()
    setStreetViewStatus("checking")
    setStreetViewMessage("")
    void fetch("/api/visualize-gutters/streetview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: quoteSessionId, addressToken }),
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json() as { available?: boolean; error?: string }
      if (controller.signal.aborted) return
      if (response.ok && data.available) {
        setStreetViewStatus("available")
        return
      }
      setStreetViewStatus("unavailable")
      setSource("upload")
      setStreetViewMessage(
        "Street View is unavailable for this property. Upload a clear exterior photo showing the roof edges, gutters, and downspouts.",
      )
    }).catch(() => {
      if (controller.signal.aborted) return
      setStreetViewStatus("unavailable")
      setSource("upload")
      setStreetViewMessage(
        "Street View could not be loaded. Upload a clear exterior photo showing the roof edges, gutters, and downspouts.",
      )
    })
    return () => controller.abort()
  }, [addressToken, disabled, quoteSessionId])

  // Never retain a render after any input that affects the requested product
  // or source image changes.
  useEffect(() => {
    setResult(null)
    setStatus("idle")
    setError(null)
  }, [source, productName, material, profile, size, colorName, colorHex, uploadFile])

  const generate = useCallback(async () => {
    if (disabled) return
    if (renderCount >= MAX_RENDERS) {
      setError(`You've used all ${MAX_RENDERS} previews for this quote. Contact us to see more color options.`)
      setStatus("error")
      return
    }
    if (source === "streetview" && streetViewStatus !== "available") return
    if (source === "upload" && !uploadFile) {
      setError("Upload a clear JPG, PNG, or WebP exterior photo before continuing.")
      setStatus("error")
      return
    }

    setStatus("loading")
    setError(null)
    const form = new FormData()
    form.set("source", source)
    form.set("sessionId", quoteSessionId)
    form.set("addressToken", addressToken)
    form.set("product", productName)
    form.set("material", material)
    form.set("profile", profile)
    form.set("size", size)
    form.set("color", colorName)
    form.set("colorHex", colorHex)
    if (source === "upload" && uploadFile) form.set("photo", uploadFile)

    try {
      const response = await fetch("/api/visualize-gutters", { method: "POST", body: form })
      const data = await response.json() as VisualizeResult & {
        error?: string
        code?: string
        quoteRendersRemaining?: number
      }
      if (typeof data.quoteRendersRemaining === "number") {
        setRenderCount(
          Math.max(
            0,
            MAX_RENDERS - Math.min(MAX_RENDERS, data.quoteRendersRemaining),
          ),
        )
      }
      if (!response.ok) {
        if (source === "streetview" && data.code === "streetview-unavailable") {
          setStreetViewStatus("unavailable")
          setStreetViewMessage(
            "Street View is unavailable for this property. Upload a clear exterior photo showing the roof edges, gutters, and downspouts.",
          )
          setSource("upload")
        }
        if (data.code === "quote-render-limit") {
          setRenderCount(MAX_RENDERS)
        }
        setError(data.error ?? "We couldn't generate the preview.")
        setStatus("error")
        return
      }
      setResult(data)
      if (typeof data.quoteRendersRemaining !== "number") {
        setRenderCount((count) => count + 1)
      }
      setStatus("done")
    } catch {
      setError("Network error while generating the preview.")
      setStatus("error")
    }
  }, [
    addressToken,
    colorHex,
    colorName,
    disabled,
    material,
    productName,
    profile,
    quoteSessionId,
    renderCount,
    size,
    source,
    streetViewStatus,
    uploadFile,
  ])

  const buttonLabel = source === "streetview" ? "Preview with Street View" : "Preview with my photo"
  const canRender = !limitReached && status !== "loading" && (
    source === "streetview" ? streetViewStatus === "available" : Boolean(uploadFile)
  )

  if (disabled) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-accent" />
          <div>
            <h3 className="font-heading text-base font-bold text-foreground">
              Gutter visualization
            </h3>
            <p className="text-xs text-muted-foreground">
              Available on the approved customer site
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
          AI rendering is disabled in contractor preview mode, so testing never
          calls Gemini or consumes paid rendering credits.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-accent" />
          <div>
            <h3 className="font-heading text-base font-bold text-foreground">See the gutter color on your home</h3>
            <p className="text-xs text-muted-foreground">
              {productName} in <span className="font-medium text-foreground">{colorName}</span>
            </p>
          </div>
        </div>
        {status === "done" && (
          <Button variant="outline" size="sm" onClick={generate} disabled={!canRender} className="gap-1.5 bg-transparent">
            <RotateCcw className="size-3.5" />
            Regenerate
          </Button>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Choose visualization image source">
        <SourceOption
          selected={source === "streetview"}
          disabled={streetViewStatus === "unavailable"}
          onSelect={() => setSource("streetview")}
          icon={Camera}
          title="Street View — Recommended"
          description={streetViewStatus === "checking" ? "Checking property imagery…" : "Use Google's outdoor street-level property image."}
        />
        <SourceOption
          selected={source === "upload"}
          onSelect={() => setSource("upload")}
          icon={Upload}
          title="Upload photo — Secondary option"
          description="Use your own clear exterior property photo."
        />
      </div>

      {streetViewMessage && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-950">
          {streetViewMessage}
        </div>
      )}

      {source === "upload" && (
        <label className="mt-4 block rounded-xl border border-dashed border-border bg-muted/35 p-4 text-center">
          <Upload className="mx-auto size-6 text-muted-foreground" />
          <span className="mt-2 block text-sm font-semibold text-foreground">Upload a clear exterior photo</span>
          <span className="mt-1 block text-xs text-muted-foreground">JPG, PNG, or WebP · maximum 8 MB</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            className="mt-3 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-accent file:px-4 file:py-2 file:font-semibold file:text-accent-foreground"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null
              if (!file) {
                setUploadFile(null)
                setUploadError("")
                return
              }
              if (!ALLOWED_UPLOAD_TYPES.has(file.type) || file.size > MAX_UPLOAD_BYTES) {
                setUploadFile(null)
                setUploadError("Upload a JPG, PNG, or WebP image no larger than 8 MB.")
                event.target.value = ""
                return
              }
              setUploadError("")
              setUploadFile(file)
            }}
          />
          {uploadFile && (
            <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
              <CheckCircle2 className="size-3.5 text-emerald-600" />
              {uploadFile.name}
            </span>
          )}
        </label>
      )}

      <div className="mt-4 min-h-44 rounded-xl border border-border bg-muted/30 p-4">
        {status === "loading" && (
          <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="size-6 animate-spin text-accent" />
            <p className="text-sm text-muted-foreground">Rendering your home with {colorName} gutters&hellip;</p>
            <p className="text-xs text-muted-foreground">This can take a few seconds.</p>
          </div>
        )}

        {status !== "loading" && status !== "done" && (
          <div className="flex min-h-36 flex-col items-center justify-center gap-3 px-2 text-center">
            {status === "error" && <ImageOff className="size-6 text-muted-foreground" />}
            <p className="max-w-xl text-pretty text-sm text-muted-foreground">
              {(source === "upload" && uploadError) || error || (source === "streetview"
                ? "Use the verified property's Street View image for a realistic gutter preview."
                : "Upload a clear exterior photo that shows the visible roof edges and drainage locations.")}
            </p>
            <Button onClick={generate} disabled={!canRender} className="gap-2">
              <Sparkles className="size-4" />
              {buttonLabel}
            </Button>
          </div>
        )}

        {status === "done" && result && <ImageComparison before={result.before} after={result.after} />}
      </div>

      {status === "done" && result && (
        <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
          AI-generated visualization from {result.source === "streetview" ? "a Street View" : "your uploaded"} photo
          {result.year ? ` (${result.year})` : ""}. For illustration only.
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

function SourceOption({
  selected,
  disabled = false,
  onSelect,
  icon: Icon,
  title,
  description,
}: {
  selected: boolean
  disabled?: boolean
  onSelect: () => void
  icon: typeof Camera
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
        selected ? "border-accent bg-accent/10 ring-1 ring-accent/30" : "border-border hover:border-accent/50",
        disabled && "cursor-not-allowed opacity-55",
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0 text-accent" />
      <span>
        <b className="block text-sm text-foreground">{title}</b>
        <small className="mt-1 block leading-relaxed text-muted-foreground">{description}</small>
      </span>
    </button>
  )
}

function ImageComparison({ before, after }: { before: string; after: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <figure className="overflow-hidden rounded-lg border border-border bg-background">
        <figcaption className="border-b border-border px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Original</figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={before} alt="Original property exterior" className="aspect-[4/3] w-full object-cover" />
      </figure>
      <figure className="overflow-hidden rounded-lg border border-border bg-background">
        <figcaption className="border-b border-border px-3 py-2 text-xs font-bold uppercase tracking-wide text-foreground">New gutters</figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={after} alt="Property with selected new gutters" className="aspect-[4/3] w-full object-cover" />
      </figure>
    </div>
  )
}
