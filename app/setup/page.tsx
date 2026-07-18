import { redirect } from "next/navigation"
import { SetupBuilder } from "@/components/setup/setup-builder"
import { IS_DEPLOYED_COMPANY_SITE } from "@/lib/company-config"

export default function SetupPage() {
  if (IS_DEPLOYED_COMPANY_SITE) redirect("/")
  return <SetupBuilder />
}
