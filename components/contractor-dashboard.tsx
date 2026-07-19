"use client"

import Link from "next/link"
import { FormEvent, useEffect, useState } from "react"
import { ArrowLeft, CreditCard, LoaderCircle, LockKeyhole, LogOut, MapPin, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCompanyConfig } from "@/components/company-config-provider"

type Activity = {
  sessionId: string
  address: string
  stage: string
  firstSeenAt: string
  updatedAt: string
  name?: string
  email?: string
  phone?: string
}

type DashboardData = {
  activities: Activity[]
  renderCredits: number | null
  storageConfigured: boolean
  billingConfigured: boolean
  retentionDays: number
}

const KEY_STORAGE = "gutterquote-contractor-access-key"

const STAGE_LABELS: Record<string, string> = {
  "address-entered": "Address entered",
  "measurement-started": "Measurement started",
  measured: "Home measured",
  "measurement-unavailable": "Measurement unavailable",
  "out-of-area": "Outside service area",
  "lead-submitted": "Lead submitted",
  "quote-viewed": "Quote viewed",
}

export function ContractorDashboard() {
  const config = useCompanyConfig()
  const [key, setKey] = useState("")
  const [draftKey, setDraftKey] = useState("")
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [buying, setBuying] = useState(false)

  useEffect(() => {
    const saved = window.sessionStorage.getItem(KEY_STORAGE) || ""
    if (saved) setKey(saved)
  }, [])

  async function load(accessKey = key) {
    if (!accessKey) return
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/contractor/activity", {
        headers: { "x-contractor-access-key": accessKey },
        cache: "no-store",
      })
      const result = await response.json()
      if (!response.ok) throw new Error(response.status === 401 ? "That access key is not valid." : result.error || "Dashboard data could not be loaded.")
      setData(result as DashboardData)
      setKey(accessKey)
      window.sessionStorage.setItem(KEY_STORAGE, accessKey)
    } catch (reason) {
      setData(null)
      setError(reason instanceof Error ? reason.message : "Dashboard data could not be loaded.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (key) void load(key)
    // Load only when a stored key is restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  async function buyCredits() {
    setBuying(true)
    setError("")
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "x-contractor-access-key": key },
      })
      const result = await response.json()
      if (!response.ok || !result.url) throw new Error(result.error || "Checkout could not be started.")
      window.location.assign(result.url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Checkout could not be started.")
      setBuying(false)
    }
  }

  function signOut() {
    window.sessionStorage.removeItem(KEY_STORAGE)
    setKey("")
    setDraftKey("")
    setData(null)
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-muted/30 px-4 py-12">
        <div className="mx-auto max-w-md rounded-3xl border border-border bg-card p-7 shadow-sm">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><LockKeyhole className="size-6" /></span>
          <h1 className="mt-5 font-heading text-2xl font-extrabold">Contractor dashboard</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Enter the private dashboard key issued when this company site was deployed.</p>
          <form className="mt-6 space-y-3" onSubmit={(event: FormEvent) => { event.preventDefault(); void load(draftKey.trim()) }}>
            <label className="block text-sm font-semibold">Dashboard access key
              <input type="password" value={draftKey} onChange={(event) => setDraftKey(event.target.value)} autoComplete="current-password" className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-4 outline-none focus:border-accent" />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={!draftKey.trim() || loading} className="h-12 w-full rounded-xl">
              {loading ? <><LoaderCircle className="size-4 animate-spin" /> Opening dashboard…</> : "Open dashboard"}
            </Button>
          </form>
          <Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Return to quote site</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-sm font-semibold text-accent">{config.companyName}</p><h1 className="font-heading text-3xl font-extrabold">Contractor dashboard</h1></div>
          <div className="flex gap-2"><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button><Button variant="outline" onClick={signOut}><LogOut className="size-4" /> Sign out</Button></div>
        </header>

        {error && <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
        {!data.storageConfigured && <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Persistent activity storage is not configured. Add the Upstash Redis variables listed in the project setup guide.</div>}

        <section className="mt-7 grid gap-4 sm:grid-cols-3">
          <Stat label="Addresses captured" value={String(data.activities.length)} detail={`Retained for ${data.retentionDays} days`} />
          <Stat label="Completed leads" value={String(data.activities.filter((activity) => activity.stage === "lead-submitted" || activity.stage === "quote-viewed").length)} detail={`Sent to ${config.email}`} />
          <div className="rounded-2xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">AI rendering balance</p><p className="mt-2 font-heading text-3xl font-extrabold">{data.renderCredits === null ? "Unmetered" : data.renderCredits}</p><p className="mt-1 text-xs text-muted-foreground">Gemini home previews remaining</p><Button className="mt-4 w-full" onClick={buyCredits} disabled={!data.billingConfigured || buying}>{buying ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />} Buy rendering credits</Button>{!data.billingConfigured && <p className="mt-2 text-xs text-muted-foreground">Stripe credit packs are not configured yet.</p>}</div>
        </section>

        <section className="mt-7 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border p-5"><h2 className="font-heading text-xl font-bold">Recent quote activity</h2><p className="mt-1 text-sm text-muted-foreground">Addresses appear as soon as a customer starts, even if they leave before submitting contact details.</p></div>
          {data.activities.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">No customer addresses have been entered yet.</div> : (
            <div className="divide-y divide-border">
              {data.activities.map((activity) => (
                <article key={activity.sessionId} className="grid gap-3 p-5 md:grid-cols-[1fr_180px_180px] md:items-center">
                  <div><p className="flex items-start gap-2 font-semibold"><MapPin className="mt-0.5 size-4 shrink-0 text-accent" /> {activity.address}</p>{(activity.name || activity.email || activity.phone) && <p className="mt-1 pl-6 text-sm text-muted-foreground">{[activity.name, activity.email, activity.phone].filter(Boolean).join(" · ")}</p>}</div>
                  <span className="w-fit rounded-full bg-muted px-3 py-1 text-xs font-semibold">{STAGE_LABELS[activity.stage] || activity.stage}</span>
                  <time className="text-sm text-muted-foreground md:text-right">{new Date(activity.updatedAt).toLocaleString()}</time>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 font-heading text-3xl font-extrabold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>
}
