"use client"

import { useState } from "react"
import { ArrowLeft, MapPin, SatelliteDish, MapPinOff, CheckCircle2, Ruler } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  measurementFromManualInput,
  type RoofMeasurement,
} from "@/lib/roof-quote"
import { useCompanyConfig } from "@/components/company-config-provider"
import { STATE_NAMES } from "@/lib/company-config"

interface UnavailableStepProps {
  address: string
  reason: "not-found" | "error" | "out-of-area"
  onBack: () => void
  onManualEstimate: (measurement: RoofMeasurement) => void
}

function formatCounties(counties: string[]): string {
  if (counties.length <= 1) return counties.join("")
  return `${counties.slice(0, -1).join(", ")} and ${counties[counties.length - 1]}`
}

export function UnavailableStep({
  address,
  reason,
  onBack,
  onManualEstimate,
}: UnavailableStepProps) {
  const config = useCompanyConfig()
  const outOfArea = reason === "out-of-area"
  // For in-area misses, lead with the manual estimate; out-of-area is lead-only.
  const [view, setView] = useState<"estimate" | "lead">(
    outOfArea ? "lead" : "estimate",
  )

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [submitted, setSubmitted] = useState(false)

  const [livingArea, setLivingArea] = useState("")
  const [stories, setStories] = useState("1")

  const canSubmit = name.trim().length > 1 && /\S+@\S+\.\S+/.test(email)
  const areaNum = Number.parseInt(livingArea.replace(/[^0-9]/g, ""), 10)
  const canEstimate = Number.isFinite(areaNum) && areaNum >= 400

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent/15">
          <CheckCircle2 className="size-7 text-accent" />
        </div>
        <h2 className="mt-5 font-heading text-2xl font-bold text-foreground">
          You&apos;re on our list, {name.split(" ")[0]}
        </h2>
        <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
          {outOfArea ? (
            <>
              We&apos;ll reach out if we expand gutter service to{" "}
              <span className="font-medium text-foreground">{address}</span>. This
              is a demo — no data is stored or sent.
            </>
          ) : (
            <>
              A local gutter specialist will estimate your gutter run manually and
              email a full written estimate for{" "}
              <span className="font-medium text-foreground">{address}</span>{" "}
              shortly. This is a demo — no data is stored or sent.
            </>
          )}
        </p>
        <Button
          onClick={onBack}
          variant="outline"
          className="mt-6 rounded-full bg-transparent"
        >
          Try another address
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Try another address
      </button>

      <div className="rounded-2xl border border-border bg-card p-6 sm:p-7">
        <div className="flex size-12 items-center justify-center rounded-full bg-secondary">
          {outOfArea ? (
            <MapPinOff className="size-6 text-muted-foreground" />
          ) : view === "estimate" ? (
            <Ruler className="size-6 text-muted-foreground" />
          ) : (
            <SatelliteDish className="size-6 text-muted-foreground" />
          )}
        </div>
        <h2 className="mt-4 font-heading text-2xl font-bold text-foreground">
          {outOfArea
            ? "That address is outside our service area"
            : view === "estimate"
              ? "Let's estimate it from your home size"
              : "We couldn't auto-estimate this home"}
        </h2>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4 shrink-0" />
          {address}
        </p>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
          {outOfArea
            ? `We currently provide instant quotes in ${formatCounties(
                config.counties,
              )} counties in ${STATE_NAMES[config.state] ?? config.state}. Leave your details and we'll reach out if we expand to your area.`
            : view === "estimate"
              ? "We couldn't find this property in public GIS records — common for newer construction. Enter a few details and we'll give you an instant gutter ballpark you can refine later."
              : reason === "error"
                ? "Our measurement service is busy right now, so we couldn't pull this property's footprint from public records. Leave your details and a specialist will estimate it manually and send a full written quote."
                : "Leave your details and a local gutter specialist will estimate your gutters manually and send a full written quote."}
        </p>

        {view === "estimate" ? (
          <>
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (canEstimate) {
                  onManualEstimate(
                    measurementFromManualInput({
                      livingAreaSqFt: areaNum,
                      stories: Number.parseInt(stories, 10),
                      pitch: "6/12",
                    }),
                  )
                }
              }}
            >
              <Field
                label="Approx. home size (heated sq ft)"
                value={livingArea}
                onChange={setLivingArea}
                placeholder="1,800"
                inputMode="numeric"
                autoComplete="off"
              />
              <div className="grid grid-cols-2 gap-4">
                <SelectField label="Stories" value={stories} onChange={setStories}>
                  <option value="1">1 story</option>
                  <option value="2">2 stories</option>
                  <option value="3">3 stories</option>
                </SelectField>
                <SelectField label="Gutter need" value="replace" onChange={() => {}}>
                  <option value="replace">Replace existing</option>
                  <option value="new">New installation</option>
                </SelectField>
              </div>
              <Button
                type="submit"
                disabled={!canEstimate}
                className="h-12 w-full rounded-full bg-accent text-base font-semibold text-accent-foreground hover:bg-accent/90"
              >
                See my estimate
              </Button>
            </form>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Ballpark only — based on the details you enter. Your home size is on
              your county property record or a real estate listing.
            </p>
            {!outOfArea && (
              <button
                type="button"
                onClick={() => setView("lead")}
                className="mt-4 block w-full text-center text-sm font-medium text-accent underline-offset-2 hover:underline"
              >
                Prefer we estimate it for you? Request a manual quote
              </button>
            )}
          </>
        ) : (
          <>
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (canSubmit) setSubmitted(true)
              }}
            >
              <Field label="Full name" value={name} onChange={setName} placeholder="Jordan Rivera" autoComplete="name" />
              <Field
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                autoComplete="email"
              />
              <Field
                label="Phone (optional)"
                type="tel"
                value={phone}
                onChange={setPhone}
                placeholder="(555) 123-4567"
                autoComplete="tel"
              />
              <Button
                type="submit"
                disabled={!canSubmit}
                className="h-12 w-full rounded-full bg-accent text-base font-semibold text-accent-foreground hover:bg-accent/90"
              >
                {outOfArea ? "Notify me" : "Request a manual quote"}
              </Button>
            </form>
            {!outOfArea && (
              <button
                type="button"
                onClick={() => setView("estimate")}
                className="mt-4 block w-full text-center text-sm font-medium text-accent underline-offset-2 hover:underline"
              >
                Or get an instant estimate from your home size
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  inputMode,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  autoComplete?: string
  inputMode?: "numeric" | "text"
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className="h-11 w-full rounded-lg border border-input bg-background px-3.5 text-base text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30 placeholder:text-muted-foreground"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-lg border border-input bg-background px-3.5 text-base text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
      >
        {children}
      </select>
    </label>
  )
}
