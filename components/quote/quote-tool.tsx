"use client"

import { useEffect, useState } from "react"
import {
  measureRoof,
  type MaterialId,
  type RoofMeasurement,
} from "@/lib/roof-quote"
import { useCompanyConfig } from "@/components/company-config-provider"
import { enabledProducts } from "@/lib/company-config"
import { Stepper } from "./stepper"
import { AddressStep } from "./address-step"
import { ConfirmStep } from "./confirm-step"
import { MeasuringStep } from "./measuring-step"
import { LeadStep } from "./lead-step"
import { MaterialsStep } from "./materials-step"
import { SuccessStep } from "./success-step"
import { UnavailableStep } from "./unavailable-step"

type Stage =
  | "address"
  | "confirm"
  | "measuring"
  | "lead"
  | "materials"
  | "success"
  | "unavailable"

const STAGE_TO_STEP: Record<Stage, number> = {
  address: 0,
  confirm: 0,
  measuring: 1,
  lead: 2,
  materials: 3,
  success: 3,
  unavailable: 1,
}

export function QuoteTool({
  onEstimateGeneratedChange,
}: {
  onEstimateGeneratedChange?: (generated: boolean) => void
}) {
  const config = useCompanyConfig()
  const materials = enabledProducts(config)
  const [stage, setStage] = useState<Stage>("address")
  const [address, setAddress] = useState("")
  const [measurement, setMeasurement] = useState<RoofMeasurement | null>(null)
  const [confirmedCoords, setConfirmedCoords] = useState<{
    lat: number
    lon: number
  } | null>(null)
  const [selectedId, setSelectedId] = useState<MaterialId | null>(null)
  const [gutterLength, setGutterLength] = useState<number | null>(null)
  // Building height used for pricing. Defaults to the detected story count when
  // a measurement lands, but the customer can override it on the quote step.
  const [stories, setStories] = useState<number | null>(null)
  const [contact, setContact] = useState({ name: "", email: "", phone: "" })
  const [unavailableReason, setUnavailableReason] = useState<
    "not-found" | "error" | "out-of-area"
  >("not-found")

  // Step 1: capture the address and show the aerial confirmation before we
  // spend a measurement on it.
  function handleAddress(value: string) {
    setAddress(value)
    setStage("confirm")
  }

  // Step 2: once the customer confirms the aerial view is their home, run the
  // roof measurement. If they dragged the confirmation pin onto the correct
  // roof, `coords` carries the corrected location to measure instead.
  async function runMeasurement(coords?: { lat: number; lon: number }) {
    setStage("measuring")
    setConfirmedCoords(coords ?? null)
    const result = await measureRoof(address, coords)
    if (result.status === "ok") {
      setMeasurement(result.measurement)
      setStories(result.measurement.stories ?? 1)
      setStage("lead")
    } else {
      setUnavailableReason(result.status)
      setStage("unavailable")
    }
  }

  function handleRestart() {
    setStage("address")
    setAddress("")
    setMeasurement(null)
    setConfirmedCoords(null)
    setSelectedId(null)
    setGutterLength(null)
    setStories(null)
    setContact({ name: "", email: "", phone: "" })
  }

  const selectedMaterial = materials.find((m) => m.id === selectedId) ?? null
  const estimateGenerated = stage !== "address"

  useEffect(() => {
    onEstimateGeneratedChange?.(estimateGenerated)
  }, [estimateGenerated, onEstimateGeneratedChange])

  return (
    <section
      id="quote-tool"
      className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14"
    >
      <div className="mb-8">
        <Stepper current={STAGE_TO_STEP[stage]} />
      </div>

      {stage === "address" && (
        <AddressStep onSubmit={handleAddress} initialValue={address} />
      )}

      {stage === "confirm" && (
        <ConfirmStep
          address={address}
          onConfirm={runMeasurement}
          onEdit={() => setStage("address")}
        />
      )}

      {stage === "measuring" && <MeasuringStep address={address} />}

      {stage === "unavailable" && (
        <UnavailableStep
          address={address}
          reason={unavailableReason}
          onBack={handleRestart}
          onManualEstimate={(m) => {
            setMeasurement(m)
            setStories(m.stories ?? 1)
            setStage("lead")
          }}
        />
      )}

      {stage === "lead" && measurement && (
        <LeadStep
          address={address}
          measurement={measurement}
          gutterLength={gutterLength}
          onGutterLengthChange={setGutterLength}
          onSubmit={(lead) => {
            setContact(lead)
            // Pre-select the recommended gutter system so pricing is visible
            // immediately on the quote step.
            if (!selectedId) {
              const recommended =
                materials.find((m) => m.badge)?.id ?? materials[0]?.id
              if (!recommended) return
              setSelectedId(recommended)
            }
            setStage("materials")
          }}
        />
      )}

      {stage === "materials" && measurement && (
        <MaterialsStep
          address={address}
          measurement={measurement}
          selected={selectedId}
          onSelect={setSelectedId}
          gutterLength={gutterLength}
          onGutterLengthChange={setGutterLength}
          stories={stories ?? measurement.stories ?? 1}
          onStoriesChange={setStories}
          confirmedCoords={confirmedCoords}
          onContinue={() => setStage("success")}
        />
      )}

      {stage === "success" && measurement && selectedMaterial && (
        <SuccessStep
          name={contact.name}
          email={contact.email}
          material={selectedMaterial}
          measurement={measurement}
          gutterLength={gutterLength}
          stories={stories ?? measurement.stories ?? 1}
          onRestart={handleRestart}
        />
      )}
    </section>
  )
}
