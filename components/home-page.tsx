"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { FlaskConical, Settings2 } from "lucide-react"
import { CompanyConfigProvider } from "@/components/company-config-provider"
import { IS_DEPLOYED_COMPANY_SITE } from "@/lib/company-config"
import { SiteHeader } from "@/components/site-header"
import { QuoteTool } from "@/components/quote/quote-tool"
import {
  TrustBar,
  HowItWorks,
  Reviews,
  SiteFooter,
} from "@/components/marketing-sections"

export function HomePage() {
  const [estimateGenerated, setEstimateGenerated] = useState(false)
  const [contractorPreview, setContractorPreview] = useState(false)

  useEffect(() => {
    setContractorPreview(
      !IS_DEPLOYED_COMPANY_SITE &&
      new URLSearchParams(window.location.search).get("preview") === "contractor",
    )
  }, [])

  return (
    <CompanyConfigProvider>
      <div className="flex min-h-screen flex-col bg-background">
        {contractorPreview && (
          <div className="sticky top-0 z-[100] flex flex-wrap items-center justify-between gap-3 bg-[#142e24] px-4 py-3 text-sm text-white shadow-lg sm:px-6">
            <span className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4 text-[#d9f45b]" /> Contractor test mode · leads and tracking are disabled</span>
            <Link href="/setup" className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 font-semibold hover:bg-white/20"><Settings2 className="size-4" /> Return to Setup Studio</Link>
          </div>
        )}
        <SiteHeader />
        <main className="flex-1">
          <QuoteTool contractorPreview={contractorPreview} onEstimateGeneratedChange={setEstimateGenerated} />
          <TrustBar />
          {!estimateGenerated && <HowItWorks />}
          <Reviews />
        </main>
        <SiteFooter />
      </div>
    </CompanyConfigProvider>
  )
}
