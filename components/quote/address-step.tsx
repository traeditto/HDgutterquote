"use client"

import { useEffect, useState } from "react"
import { BadgeCheck, CheckCircle2, Clock, Droplets, Loader2, MapPin, Search, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCompanyConfig } from "@/components/company-config-provider"
import { STATE_NAMES } from "@/lib/company-config"

type AddressSuggestion = {
  placeId: string
  text: string
  mainText: string
  secondaryText: string
}

export type VerifiedPropertyAddress = {
  placeId: string
  address: string
  state: string
  county: string
  token: string
}

type DerivedLocation = { address: string; state: string; county: string }
type LookupState = "idle" | "searching" | "resolving"

function newSessionToken() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function AddressStep({
  onSubmit,
  quoteSessionId,
  contractorPreview = false,
  initialValue = "",
  initialVerification = null,
}: {
  onSubmit: (address: VerifiedPropertyAddress) => void
  quoteSessionId: string
  contractorPreview?: boolean
  initialValue?: string
  initialVerification?: VerifiedPropertyAddress | null
}) {
  const config = useCompanyConfig()
  const [value, setValue] = useState(initialVerification?.address || initialValue)
  const [addressSessionToken, setAddressSessionToken] = useState("")
  const [verified, setVerified] = useState<VerifiedPropertyAddress | null>(initialVerification)
  const [derivedLocation, setDerivedLocation] = useState<DerivedLocation | null>(initialVerification)
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [lookupState, setLookupState] = useState<LookupState>("idle")
  const [error, setError] = useState("")
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1)

  useEffect(() => setAddressSessionToken(newSessionToken()), [])

  useEffect(() => {
    const input = value.trim()
    if (verified || derivedLocation || !addressSessionToken || input.length < 3) {
      if (input.length < 3) setSuggestions([])
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setLookupState("searching")
      try {
        const response = await fetch("/api/address/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input, sessionToken: addressSessionToken }),
          signal: controller.signal,
        })
        const result = await response.json() as { suggestions?: AddressSuggestion[]; error?: string }
        if (!response.ok) throw new Error(result.error || "Address suggestions are unavailable.")
        const nextSuggestions = result.suggestions ?? []
        setSuggestions(nextSuggestions)
        setHighlightedSuggestion(-1)
        setError(nextSuggestions.length ? "" : "No matching United States property address was found.")
      } catch (reason) {
        if (controller.signal.aborted) return
        setSuggestions([])
        setError(reason instanceof Error ? reason.message : "Address suggestions are unavailable.")
      } finally {
        if (!controller.signal.aborted) setLookupState("idle")
      }
    }, 300)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [addressSessionToken, derivedLocation, value, verified])

  function updateAddress(nextValue: string) {
    if (verified) setAddressSessionToken(newSessionToken())
    setValue(nextValue)
    setVerified(null)
    setDerivedLocation(null)
    setSuggestions([])
    setError("")
    setHighlightedSuggestion(-1)
  }

  async function selectAddress(suggestion: AddressSuggestion) {
    if (!quoteSessionId || !addressSessionToken) return
    setLookupState("resolving")
    setSuggestions([])
    setError("")
    try {
      const response = await fetch("/api/address/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeId: suggestion.placeId,
          sessionToken: addressSessionToken,
          quoteSessionId,
          testMode: contractorPreview,
          ...(contractorPreview ? { testServiceArea: { state: config.state, counties: config.counties } } : {}),
        }),
      })
      const result = await response.json() as {
        placeId?: string
        address?: string
        state?: string
        county?: string
        token?: string
        error?: string
      }
      if (!response.ok || !result.address || !result.state || !result.county || !result.token) {
        setValue(result.address || suggestion.text)
        setDerivedLocation(result.address && result.state && result.county
          ? { address: result.address, state: result.state, county: result.county }
          : null)
        setVerified(null)
        setError(result.error || "The property address could not be verified.")
        return
      }
      const next: VerifiedPropertyAddress = {
        placeId: result.placeId || suggestion.placeId,
        address: result.address,
        state: result.state,
        county: result.county,
        token: result.token,
      }
      setValue(next.address)
      setDerivedLocation(next)
      setVerified(next)
    } catch (reason) {
      setValue(suggestion.text)
      setDerivedLocation(null)
      setVerified(null)
      setError(reason instanceof Error ? reason.message : "The property address could not be verified.")
    } finally {
      // Place Details completes a Google autocomplete session. Any retry must
      // start a fresh session, including after an out-of-area selection.
      setAddressSessionToken(newSessionToken())
      setLookupState("idle")
    }
  }

  const canSubmit = Boolean(verified && quoteSessionId && lookupState === "idle")

  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="mx-auto mb-5 flex size-24 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-sm">
        <Droplets className="size-12 text-accent" />
      </span>
      <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
        <Clock className="size-3.5" />
        Instant estimate in under 60 seconds
      </span>
      <h1 className="mt-5 text-balance font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl md:text-5xl">
        What will new gutters cost for your home?
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
        Select your property from Google&apos;s address suggestions. We&apos;ll verify the service area before measuring the home and showing local gutter pricing.
      </p>
      <p className="mx-auto mt-3 text-sm font-medium text-muted-foreground">
        Now serving {config.counties.length} {config.counties.length === 1 ? "county or equivalent" : "counties and equivalents"} in {STATE_NAMES[config.state] ?? config.state}.
      </p>

      <form
        className="relative mx-auto mt-8 max-w-xl"
        onSubmit={(event) => {
          event.preventDefault()
          if (verified && canSubmit) onSubmit(verified)
          else setError("Select your property from the Google address suggestions before continuing.")
        }}
      >
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm sm:flex-row sm:items-center sm:rounded-full">
          <div className="flex flex-1 items-center gap-2 px-3">
            <MapPin className="size-5 shrink-0 text-accent" />
            <input
              type="text"
              value={value}
              onChange={(event) => updateAddress(event.target.value)}
              onKeyDown={(event) => {
                if (!suggestions.length) return
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  setHighlightedSuggestion((current) => Math.min(current + 1, suggestions.length - 1))
                } else if (event.key === "ArrowUp") {
                  event.preventDefault()
                  setHighlightedSuggestion((current) => Math.max(current - 1, 0))
                } else if (event.key === "Enter" && highlightedSuggestion >= 0) {
                  event.preventDefault()
                  void selectAddress(suggestions[highlightedSuggestion])
                } else if (event.key === "Escape") {
                  setSuggestions([])
                }
              }}
              placeholder="Start typing your street address"
              aria-label="Property address"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
              aria-controls="google-address-suggestions"
              aria-activedescendant={highlightedSuggestion >= 0 ? `address-suggestion-${highlightedSuggestion}` : undefined}
              autoComplete="street-address"
              className="h-11 w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            />
            {(lookupState === "searching" || lookupState === "resolving") && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
            {verified && <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />}
          </div>
          <Button
            type="submit"
            disabled={!canSubmit}
            className="h-12 gap-2 rounded-full bg-accent px-6 text-base font-semibold text-accent-foreground hover:bg-accent/90"
          >
            <Search className="size-4" />
            Continue
          </Button>
        </div>

        {suggestions.length > 0 && (
          <div id="google-address-suggestions" role="listbox" className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-border bg-card text-left shadow-lg">
            {suggestions.map((suggestion, index) => (
              <button
                type="button"
                id={`address-suggestion-${index}`}
                role="option"
                aria-selected={highlightedSuggestion === index}
                key={suggestion.placeId}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void selectAddress(suggestion)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-sm text-foreground transition-colors hover:bg-muted ${highlightedSuggestion === index ? "bg-muted" : ""}`}
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span><b className="block">{suggestion.mainText}</b><small className="text-muted-foreground">{suggestion.secondaryText}</small></span>
              </button>
            ))}
            <div className="border-t border-border bg-white px-4 py-2 text-right">
              {/* Google requires its logo when Places predictions appear without a Google map. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" className="ml-auto h-[15px] w-auto" />
            </div>
          </div>
        )}
      </form>

      {derivedLocation && (
        <div className={`mx-auto mt-4 flex max-w-xl items-start gap-3 rounded-xl border p-4 text-left ${verified ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
          {verified ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" /> : <MapPin className="mt-0.5 size-5 shrink-0 text-amber-700" />}
          <span><b className="block">{verified ? "Address verified in our service area" : "Address is outside our current service area"}</b><small className="mt-1 block">{derivedLocation.county}, {derivedLocation.state}</small></span>
        </div>
      )}

      {error && <p className="mx-auto mt-3 max-w-xl text-sm font-medium text-destructive">{error}</p>}

      <p className="mx-auto mt-3 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
        {contractorPreview
          ? "Test mode: this address and any contact details are not saved or emailed."
          : `When you continue, this verified property address is saved for ${config.companyName} even if you do not finish the quote. Contact details are collected later.`}
      </p>

      <ul className="mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-accent" /> No obligation</li>
        <li className="flex items-center gap-2"><BadgeCheck className="size-4 text-accent" /> Licensed &amp; insured</li>
        <li className="flex items-center gap-2"><Clock className="size-4 text-accent" /> Free &amp; instant</li>
      </ul>
    </div>
  )
}
