"use client"

import { useState } from "react"
import { MapPin, Ruler, Lock, ShieldCheck, CornerDownRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  billableGutterLength,
  downspoutCount,
  type RoofMeasurement,
} from "@/lib/roof-quote"
import { newEventId, trackEvent } from "@/lib/meta-pixel"
import { useCompanyConfig } from "@/components/company-config-provider"

interface LeadStepProps {
  address: string
  quoteSessionId: string
  addressToken: string
  measurement: RoofMeasurement
  gutterLength: number | null
  onGutterLengthChange: (linearFeet: number | null) => void
  onSubmit: (lead: { name: string; phone: string; email: string }) => void
}

/** Digits-only length check for a US phone number. */
function isValidPhone(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 10
}

export function LeadStep({
  address,
  quoteSessionId,
  addressToken,
  measurement,
  gutterLength,
  onGutterLengthChange,
  onSubmit,
}: LeadStepProps) {
  const config = useCompanyConfig()
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [manualLength, setManualLength] = useState(
    gutterLength ? String(gutterLength) : "",
  )
  const [submitting, setSubmitting] = useState(false)

  const estimatedLinearFeet = billableGutterLength(measurement)
  const totalLinearFeet = gutterLength ?? estimatedLinearFeet
  const downspouts = downspoutCount(totalLinearFeet)
  const canSubmit =
    name.trim().length > 1 && isValidPhone(phone) && /\S+@\S+\.\S+/.test(email)

  async function handleSubmit() {
    const lead = { name: name.trim(), phone: phone.trim(), email: email.trim() }
    setSubmitting(true)

    // Shared id lets Meta dedupe the browser pixel event against the
    // server-side Conversions API event fired from /api/lead.
    const eventId = newEventId()
    // Fire the browser-side Lead conversion.
    trackEvent(
      "Lead",
      {
        content_name: "Instant Gutter Quote",
        content_category: "gutter-installation",
      },
      eventId,
    )

    // Email the lead and record the server-side conversion.
    // Never block the customer's quote on this — proceed to pricing regardless.
    try {
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...lead,
          sessionId: quoteSessionId,
          addressToken,
          roofAreaSqFt: totalLinearFeet,
          squares: downspouts,
          pitch: measurement.pitch,
          source: measurement.source,
          eventId,
          eventSourceUrl:
            typeof window !== "undefined" ? window.location.href : undefined,
        }),
      })
    } catch {
      // Ignore network errors; the customer still gets their quote.
    } finally {
      setSubmitting(false)
      onSubmit(lead)
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.05fr]">
        {/* Teaser: gutter length estimated, pricing locked */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border p-5">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-accent-foreground">
              <Ruler className="size-3.5" />
              Gutter run estimated
            </div>
            <h2 className="mt-3 text-balance font-heading text-2xl font-extrabold tracking-tight text-foreground">
              Your instant gutter quote is ready.
            </h2>
            <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="size-4 shrink-0" />
              <span className="text-pretty">{address}</span>
            </div>
          </div>

          <div className="p-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-sm text-muted-foreground">
                  Estimated gutter run
                </div>
                <div className="mt-1 font-heading text-3xl font-extrabold tracking-tight text-foreground">
                  {totalLinearFeet.toLocaleString()}
                  <span className="text-lg font-bold text-muted-foreground">
                    {" "}
                    ft
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CornerDownRight className="size-3.5" />
                  About {downspouts} downspouts included
                </div>
              </div>
            </div>

            {/* Locked pricing preview */}
            <div className="mt-5 rounded-xl border border-dashed border-border bg-muted/40 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Lock className="size-4 text-accent" />
                Your installed gutter pricing
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-7 w-28 rounded-md bg-foreground/10 blur-[2px]" />
                <span className="text-sm text-muted-foreground">
                  Enter your details to reveal
                </span>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-border bg-background p-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-foreground">
                  Only want part of the house?
                </span>
                <span className="mb-2 block text-xs leading-relaxed text-muted-foreground">
                  Enter the linear feet you want quoted, or leave this blank for
                  the whole-home eave estimate.
                </span>
                <div className="flex h-11 items-center rounded-lg border border-input bg-card px-3.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={manualLength}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^0-9]/g, "")
                      setManualLength(next)
                      const parsed = Number.parseInt(next, 10)
                      onGutterLengthChange(
                        Number.isFinite(parsed) && parsed > 0 ? parsed : null,
                      )
                    }}
                    placeholder={String(estimatedLinearFeet)}
                    aria-label="Manual gutter length in linear feet"
                    className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <span className="ml-2 text-sm text-muted-foreground">ft</span>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Lead form */}
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="font-heading text-xl font-bold text-foreground">
            See your instant quote
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Tell us where to send your detailed estimate. A licensed {config.companyName}
            {" "}gutter specialist will follow up to confirm final pricing and
            answer any questions — no obligation.
          </p>

          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (canSubmit && !submitting) handleSubmit()
            }}
          >
            <Field
              label="Full name"
              value={name}
              onChange={setName}
              placeholder="Jordan Rivera"
              autoComplete="name"
            />
            <Field
              label="Phone"
              type="tel"
              value={phone}
              onChange={setPhone}
              placeholder="(904) 555-0123"
              autoComplete="tel"
            />
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              autoComplete="email"
            />

            <Button
              type="submit"
              disabled={!canSubmit || submitting}
              className="h-12 w-full rounded-full bg-accent text-base font-semibold text-accent-foreground hover:bg-accent/90"
            >
              {submitting ? "Preparing your quote…" : "See my instant quote"}
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="size-3.5 shrink-0" />
              We respect your privacy and never sell your information.
            </p>
          </form>
        </div>
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
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  autoComplete?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className="h-11 w-full rounded-lg border border-input bg-background px-3.5 text-base text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30 placeholder:text-muted-foreground"
      />
    </label>
  )
}
