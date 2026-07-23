import type { Metadata } from "next"
import { cookies } from "next/headers"
import { ContractorDashboard } from "@/components/contractor-dashboard"
import { CompanyConfigProvider } from "@/components/company-config-provider"
import {
  CONTRACTOR_COOKIE,
  readContractorSession,
} from "@/lib/contractor-auth"
import { contractorTenantId } from "@/lib/contractor-platform"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Contractor dashboard",
  robots: { index: false, follow: false },
}

export default async function ContractorPage() {
  let authenticated = false
  try {
    authenticated =
      readContractorSession(
        (await cookies()).get(CONTRACTOR_COOKIE)?.value,
      ) === contractorTenantId()
  } catch {
    authenticated = false
  }
  return (
    <CompanyConfigProvider>
      <ContractorDashboard authenticated={authenticated} />
    </CompanyConfigProvider>
  )
}
