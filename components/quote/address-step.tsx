"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { MapPin, Search, ShieldCheck, Clock, BadgeCheck, Loader2, Droplets } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCompanyConfig } from "@/components/company-config-provider"
import { STATE_NAMES } from "@/lib/company-config"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function AddressStep({
  onSubmit,
  initialValue = "",
}: {
  onSubmit: (address: string) => void
  initialValue?: string
}) {
  const config = useCompanyConfig()
  const [value, setValue] = useState(initialValue)
  const [debounced, setDebounced] = useState("")
  const [focused, setFocused] = useState(false)
  // Set true when the user picks a suggestion or dismisses, so the list stays
  // closed until they type again (instead of relying on fragile blur timing).
  const [dismissed, setDismissed] = useState(false)

  // Debounce the typed value before hitting the geocoder.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 250)
    return () => clearTimeout(t)
  }, [value])

  const query = debounced.length >= 3 ? debounced : ""
  const { data, isLoading } = useSWR(
    query ? `/api/address-suggest?q=${encodeURIComponent(query)}` : null,
    fetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  )

  const realSuggestions: string[] = data?.suggestions ?? []
  const isTyping = value.trim().length >= 3
  // Show suggestions whenever the user is actively typing a query and hasn't
  // dismissed the list. Not gated on focus, so mobile keyboards/scroll don't
  // wipe the results out from under the user.
  const showReal = isTyping && !dismissed
  const canSubmit = value.trim().length > 4

  function submit(address: string) {
    if (address.trim().length > 4) {
      setDismissed(true)
      onSubmit(address.trim())
    }
  }

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
        Enter your address and we&apos;ll estimate your gutter run from public
        property &amp; GIS records, then show real pricing for seamless gutter
        options. No phone calls. No pressure.
      </p>
      <p className="mx-auto mt-3 text-sm font-medium text-muted-foreground">
        Now serving {config.counties.length} {config.counties.length === 1 ? "county" : "counties"} in {STATE_NAMES[config.state] ?? config.state}.
      </p>

      <form
        className="relative mx-auto mt-8 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault()
          submit(value)
        }}
      >
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm sm:flex-row sm:items-center sm:rounded-full">
          <div className="flex flex-1 items-center gap-2 px-3">
            <MapPin className="size-5 shrink-0 text-accent" />
            <input
              type="text"
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setDismissed(false)
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder="Enter your home address"
              aria-label="Home address"
              autoComplete="off"
              className="h-11 w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            />
            {showReal && isLoading && (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            )}
          </div>
          <Button
            type="submit"
            disabled={!canSubmit}
            className="h-12 gap-2 rounded-full bg-accent px-6 text-base font-semibold text-accent-foreground hover:bg-accent/90"
          >
            <Search className="size-4" />
            Get my quote
          </Button>
        </div>

        {showReal && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-border bg-card text-left shadow-lg">
            {realSuggestions.length > 0 ? (
              realSuggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => {
                      setValue(s)
                      submit(s)
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    <MapPin className="size-4 shrink-0 text-muted-foreground" />
                    {s}
                  </button>
                </li>
              ))
            ) : (
              <li className="px-4 py-3 text-sm text-muted-foreground">
                {isLoading
                  ? "Searching addresses…"
                  : "No matching addresses found. Keep typing or press Get my quote."}
              </li>
            )}
          </ul>
        )}

      </form>

      <ul className="mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-accent" /> No obligation
        </li>
        <li className="flex items-center gap-2">
          <BadgeCheck className="size-4 text-accent" /> Licensed &amp; insured
        </li>
        <li className="flex items-center gap-2">
          <Clock className="size-4 text-accent" /> Free &amp; instant
        </li>
      </ul>
    </div>
  )
}
