"use client"

import { CheckCircle2, Mail, CalendarClock, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCompanyConfig } from "@/components/company-config-provider"
import {
  formatCurrency,
  quoteForMaterial,
  type RoofMaterial,
  type RoofMeasurement,
} from "@/lib/roof-quote"

interface SuccessStepProps {
  name: string
  email: string
  material: RoofMaterial
  measurement: RoofMeasurement
  gutterLength: number | null
  stories: number
  onRestart: () => void
}

export function SuccessStep({
  name,
  email,
  material,
  measurement,
  gutterLength,
  stories,
  onRestart,
}: SuccessStepProps) {
  const config = useCompanyConfig()
  const quote = quoteForMaterial(
    measurement,
    material,
    gutterLength ?? undefined,
    stories,
    config.downspoutPrice,
  )
  const firstName = name.trim().split(" ")[0] || "there"

  return (
    <div className="mx-auto max-w-xl text-center">
      <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-accent/10">
        <CheckCircle2 className="size-16 text-accent" />
      </div>
      <h2 className="mt-4 text-balance font-heading text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
        You&apos;re all set, {firstName}!
      </h2>
      <p className="mx-auto mt-3 max-w-md text-pretty leading-relaxed text-muted-foreground">
        Your {material.name} gutter estimate of{" "}
        <span className="font-semibold text-foreground">
          {quote.low === quote.high
            ? formatCurrency(quote.low)
            : `${formatCurrency(quote.low)}–${formatCurrency(quote.high)}`}
        </span>{" "}
        is confirmed. Here&apos;s what happens next.
      </p>

      <div className="mt-7 space-y-3 text-left">
        <NextStep
          icon={Mail}
          title="Check your inbox"
          body={`We've sent your detailed written quote to ${email}.`}
        />
        <NextStep
          icon={CalendarClock}
          title="Free gutter inspection"
          body={`A ${config.companyName} gutter specialist will reach out within one business day to verify the gutter run, downspout locations, and final pricing.`}
        />
      </div>

      <Button
        variant="outline"
        onClick={onRestart}
        className="mt-8 h-11 gap-2 rounded-full"
      >
        <RotateCcw className="size-4" />
        Start a new estimate
      </Button>
    </div>
  )
}

function NextStep({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Mail
  title: string
  body: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10">
        <Icon className="size-5 text-accent" />
      </span>
      <div>
        <div className="font-heading text-sm font-bold text-foreground">{title}</div>
        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}
