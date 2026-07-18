"use client"

import { createContext, useContext, useEffect, useState } from "react"
import {
  DEFAULT_CONFIG,
  loadCompanyConfig,
  type CompanyConfig,
} from "@/lib/company-config"

const CompanyConfigContext = createContext<CompanyConfig>(DEFAULT_CONFIG)

export function CompanyConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG)

  useEffect(() => {
    setConfig(loadCompanyConfig())
  }, [])

  return (
    <CompanyConfigContext.Provider value={config}>
      <div
        style={{
          "--primary": config.primaryColor,
          "--accent": config.accentColor,
          "--ring": config.accentColor,
          "--brand": config.accentColor,
        } as React.CSSProperties}
      >
        {children}
      </div>
    </CompanyConfigContext.Provider>
  )
}

export function useCompanyConfig() {
  return useContext(CompanyConfigContext)
}
