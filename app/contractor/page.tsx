import type { Metadata } from "next"
import { ContractorDashboard } from "@/components/contractor-dashboard"
import { CompanyConfigProvider } from "@/components/company-config-provider"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Contractor dashboard",
  robots: { index: false, follow: false },
}

export default function ContractorPage() {
  return <CompanyConfigProvider><ContractorDashboard /></CompanyConfigProvider>
}
