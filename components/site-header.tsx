"use client"

import { Phone } from "lucide-react"
import { BrandMark } from "@/components/brand-mark"
import { useCompanyConfig } from "@/components/company-config-provider"
import { IS_DEPLOYED_COMPANY_SITE } from "@/lib/company-config"

export function SiteHeader() {
  const config = useCompanyConfig()
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5" aria-label={`${config.companyName} home`}>
          <BrandMark name={config.companyName} logo={config.logo} />
        </a>

        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          <a href="#how-it-works" className="transition-colors hover:text-foreground">
            How it works
          </a>
          <a href="#materials" className="transition-colors hover:text-foreground">
            Materials
          </a>
          <a href="#reviews" className="transition-colors hover:text-foreground">
            Reviews
          </a>
          {!IS_DEPLOYED_COMPANY_SITE && (
            <a href="/setup" className="transition-colors hover:text-foreground">Company setup</a>
          )}
        </nav>

        <a
          href={`tel:${config.phone.replace(/\D/g, "")}`}
          className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Phone className="size-4 text-accent" />
          <span className="hidden sm:inline">{config.phone}</span>
          <span className="sm:hidden">Call</span>
        </a>
      </div>
    </header>
  )
}
