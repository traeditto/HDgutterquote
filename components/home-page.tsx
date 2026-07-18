"use client"

import { useState } from "react"
import { CompanyConfigProvider } from "@/components/company-config-provider"
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

  return (
    <CompanyConfigProvider>
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="flex-1">
          <QuoteTool onEstimateGeneratedChange={setEstimateGenerated} />
          <TrustBar />
          {!estimateGenerated && <HowItWorks />}
          <Reviews />
        </main>
        <SiteFooter />
      </div>
    </CompanyConfigProvider>
  )
}
